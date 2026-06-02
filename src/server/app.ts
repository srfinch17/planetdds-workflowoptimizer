import { Hono } from "hono";
import type { ScheduleStore } from "../core/store/ScheduleStore";
import type { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import type { TieredIntentExtractor } from "../core/intent/TieredIntentExtractor";
import type { CostTracker } from "../core/llm/costTracker";
import type { CandidateSlot, AvailabilityRule, EscalationLevel, SchedulingIntent, Weekday } from "../core/types";
import { generateCandidates } from "../core/schedule/candidateGenerator";
import type { LlmClient } from "../core/llm/anthropicClient";
import { parseRuleSentence } from "../core/rules/ruleParser";
import { overlaps } from "../core/time";
import type { EventLog, EventType } from "../core/log/eventLog";
import { LatencyMeter } from "./metrics";

const LOG_TYPES: EventType[] = ["schedule_request", "escalation", "booking", "rule_added", "error"];

/** A request that triaged as an emergency/urgent, queued for staff to call back. */
interface CallbackRecord {
  id: string;
  request: string;
  level: EscalationLevel;
  headline: string;
  matched: string | null;
  createdAt: string;
}

/** An appointment an office closure cancelled — staff must reschedule it. */
interface RescheduleRecord {
  id: string;
  appointment: ReturnType<ScheduleStore["book"]>;
  reason: string;
  flaggedAt: string;
}

/**
 * Everything the HTTP layer needs, injected. Nothing here knows about ports,
 * .env, or the Anthropic client — those live only in index.ts. That separation
 * is the whole point: the API key is a server-side secret, and the routing
 * logic stays pure enough to test in-process with app.request() (no socket).
 */
export interface AppDeps {
  store: ScheduleStore;
  assistant: SchedulingAssistant;
  tiered: TieredIntentExtractor; // same instance the assistant uses → lastPath/pathCounts
  costTracker: CostTracker;
  eventLog: EventLog; // audit trail + activity dashboard
  ruleLlm?: LlmClient; // optional: lets POST /api/rules fall back to the LLM when present
  online?: boolean; // true when an API key is present (LLM reachable)
}

/**
 * Build the backend. Returns a Hono app; the caller decides whether to serve it
 * on a port (index.ts) or drive it directly in a test.
 */
export function createApp(deps: AppDeps): Hono {
  const { store, assistant, tiered, costTracker, eventLog, ruleLlm, online } = deps;
  const app = new Hono();
  const latency = new LatencyMeter(); // how fast we answer, server-side
  const callbacks: CallbackRecord[] = []; // the staff "call this patient back" queue
  const reschedule: RescheduleRecord[] = []; // appts an office closure cancelled

  // Any unhandled throw becomes a logged error event + a clean 500.
  app.onError((err, c) => {
    eventLog.record("error", { message: err instanceof Error ? err.message : String(err), path: c.req.path });
    return c.json({ error: "internal server error" }, 500);
  });

  // Turn an unstructured patient request into ranked, explainable slots.
  // refDate is optional so the demo can pin "today" for reproducible scenarios.
  app.post("/api/schedule", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const request = typeof body.request === "string" ? body.request.trim() : "";
    if (request.length === 0) {
      return c.json({ error: "request must be a non-empty string" }, 400);
    }
    const refDate = typeof body.refDate === "string" ? body.refDate : undefined;
    const mode = body.mode === "llm" || body.mode === "rules" ? body.mode : undefined;

    const costBefore = costTracker.usd;
    const callsBefore = costTracker.totals.calls;
    const t0 = performance.now();
    const { intent, recommendation, escalation } = await assistant.handle(request, { refDate, mode });
    const latencyMs = Math.round((performance.now() - t0) * 10) / 10;
    latency.record(latencyMs);

    // Log the full decision so it can be audited or replayed later.
    const recSummary = recommendation.slots.map((s) => ({
      start: s.slot.start,
      providerId: s.slot.providerId,
      operatoryId: s.slot.operatoryId,
      score: s.score,
    }));
    const scheduleEvent = eventLog.record("schedule_request", {
      request,
      refDate: refDate ?? null,
      path: tiered.lastPath,
      intent,
      escalationLevel: escalation.level,
      bestEffort: recommendation.bestEffort,
      slotCount: recommendation.slots.length,
      recommendations: recSummary,
      latencyMs,
      llmCall: costTracker.totals.calls - callsBefore,
      costUsd: Math.round((costTracker.usd - costBefore) * 1e6) / 1e6,
    });

    // Emergency override: a request flagged for callback is queued for staff
    // immediately, so the office knows to phone the patient back ASAP.
    if (escalation.callbackRequired) {
      callbacks.unshift({
        id: `cb-${Date.now()}`,
        request,
        level: escalation.level,
        headline: escalation.headline,
        matched: escalation.matched,
        createdAt: new Date().toISOString(),
      });
      // Separate immutable audit event for the safety trail, linked to the request.
      eventLog.record(
        "escalation",
        { level: escalation.level, matched: escalation.matched, headline: escalation.headline, request },
        scheduleEvent.id,
      );
    }

    // tiered.lastPath was just set by this exact call — surfaces the cost story.
    return c.json({ intent, recommendation, pathTaken: tiered.lastPath, escalation, requestId: scheduleEvent.id });
  });

  // The staff callback queue (newest first) — the office's emergency worklist.
  app.get("/api/callbacks", (c) => {
    return c.json({ callbacks });
  });

  // Open slots for booking, grouped by day. Same candidate generator the
  // recommender uses (so eligibility, X-ray rooms, hours, lunch all hold), but
  // returns EVERY opening in a date window — not just the top 3 — so the UI can
  // let a patient pick any matching day and any open time. 30-minute booking
  // granularity, deduped to one opening per provider+time.
  app.get("/api/availability", (c) => {
    const from = c.req.query("from");
    if (!from) return c.json({ error: "from (YYYY-MM-DD) is required" }, 400);
    const to = c.req.query("to") || from;
    const type = c.req.query("type") || null;
    const daysOfWeek = (c.req.query("days") || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean) as Weekday[];

    const intent: SchedulingIntent = {
      appointmentType: type,
      urgency: "routine",
      earliestDate: from,
      latestDate: to,
      daysOfWeek,
      timeEarliest: null,
      timeLatest: null,
      partOfDay: null,
      preferredProviderId: null,
      patientName: null,
      patientPhone: null,
      rawRequest: "",
      source: "rules",
      confidence: 1,
    };

    const seen = new Set<string>();
    const slotsByDay: Record<string, CandidateSlot[]> = {};
    for (const slot of generateCandidates(intent, store, { refDate: from })) {
      if (Number(slot.start.slice(14, 16)) % 30 !== 0) continue; // grid-aligned
      const key = `${slot.providerId}@${slot.start}`;
      if (seen.has(key)) continue; // one opening per provider+time
      seen.add(key);
      const day = slot.start.slice(0, 10);
      (slotsByDay[day] ??= []).push(slot);
    }
    for (const list of Object.values(slotsByDay)) list.sort((a, b) => a.start.localeCompare(b.start));
    return c.json({ slotsByDay });
  });

  // The raw schedule state the calendar renders from.
  app.get("/api/state", (c) => {
    return c.json({
      providers: store.getProviders(),
      operatories: store.getOperatories(),
      patients: store.getPatients(),
      appointmentTypes: store.getAppointmentTypes(),
      appointments: store.getAppointments(),
      rules: store.getRules(),
      reschedule, // appts an office closure flagged for staff to rebook
    });
  });

  // Cost/efficiency snapshot. requestsServed vs apiCalls IS the savings number,
  // and costPer1000 projects the current mix out to a relatable scale.
  app.get("/api/metrics", (c) => {
    const counts = tiered.pathCounts;
    const requestsServed = counts.rules + counts.llm + counts["offline-fallback"] + counts["llm-failed-fallback"];
    const apiCalls = counts.llm; // only the llm path actually hits Anthropic
    const freeHandled = requestsServed - apiCalls;
    const usd = costTracker.usd;
    return c.json({
      requestsServed,
      apiCalls,
      freeHandled,
      freeSharePct: requestsServed === 0 ? 0 : Math.round((freeHandled / requestsServed) * 100),
      pathCounts: counts,
      estimatedUsd: usd,
      // Projected spend per 1,000 requests at the mix seen so far.
      costPer1000Usd: requestsServed === 0 ? 0 : (usd / requestsServed) * 1000,
      avgLatencyMs: Math.round(latency.avgMs * 10) / 10,
      tokenTotals: costTracker.totals,
      emergencyCallbacks: callbacks.length, // emergencies/urgent escalations queued
      online: online ?? false, // is the LLM reachable (key present)?
    });
  });

  // Book a previously-recommended slot. Mutates the store; the calendar re-reads.
  app.post("/api/book", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const slot = body.slot as CandidateSlot | undefined;
    const correlationId = typeof body.requestId === "string" ? body.requestId : undefined;
    const patientName = typeof body.patientName === "string" ? body.patientName.trim() : "";
    const patientPhone = typeof body.patientPhone === "string" ? body.patientPhone.trim() : "";

    // Identify the patient: an existing id, or create one from name + phone.
    let patientId = typeof body.patientId === "string" ? body.patientId : "";
    if (!patientId && patientName) {
      patientId = `pat-${Date.now().toString(36)}`;
      store.addPatient({ id: patientId, name: patientName, phone: patientPhone || undefined, preferredProviderId: null });
    }
    if (!slot || !slot.providerId || !slot.start || !slot.end || !patientId) {
      return c.json({ error: "slot (with start/end) and a patient name are required" }, 400);
    }
    // Re-validate at booking time: a recommendation set can contain overlapping
    // options, and time passes between search and click. Never double-book a
    // provider or an operatory.
    const conflict = store.getAppointments().some(
      (a) =>
        (a.providerId === slot.providerId || a.operatoryId === slot.operatoryId) &&
        overlaps(slot.start, slot.end, a.start, a.end),
    );
    if (conflict) {
      eventLog.record(
        "booking",
        { outcome: "conflict", providerId: slot.providerId, start: slot.start, patientId },
        correlationId,
      );
      return c.json({ error: "That slot was just taken — please pick another." }, 409);
    }
    const appointment = store.book(slot, patientId);
    const confirmationNumber = `DDS-${appointment.id.replace(/\D/g, "")}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    eventLog.record(
      "booking",
      {
        outcome: "booked",
        appointmentId: appointment.id,
        providerId: appointment.providerId,
        start: appointment.start,
        patientId,
        patientName: patientName || undefined,
        confirmationNumber,
      },
      correlationId,
    );
    return c.json({ appointment, appointments: store.getAppointments(), confirmationNumber });
  });

  // Plain-English rule teaching. The parser translates the sentence into a
  // STRUCTURED rule (regex offline, LLM fallback when ruleLlm is present), which
  // the deterministic scheduler then enforces. Validation lives in the parser;
  // a sentence it can't turn into a rule is a 422, not a silent no-op.
  app.post("/api/rules", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";
    if (sentence.length === 0) {
      return c.json({ error: "sentence must be a non-empty string" }, 400);
    }
    const parsed = await parseRuleSentence(sentence, store, { llm: ruleLlm, costTracker });
    if (!parsed.ok) {
      eventLog.record("rule_added", { outcome: "rejected", sentence, error: parsed.error });
      return c.json({ error: parsed.error }, 422);
    }
    const rule: AvailabilityRule = {
      ...parsed.rule,
      id: nextRuleId(store.getRules()),
      createdAt: new Date().toISOString(),
    };

    // Contradiction check: an existing workday/dayoff rule for the same provider
    // + weekday of the OPPOSITE kind. Newest-wins would silently override it, so
    // (unless override:true) we ask the admin to confirm first.
    if ((rule.kind === "workday" || rule.kind === "dayoff") && body.override !== true) {
      const opposite = rule.kind === "workday" ? "dayoff" : "workday";
      const existing = store
        .getRules()
        .find((r) => r.providerId === rule.providerId && r.weekday === rule.weekday && r.kind === opposite);
      if (existing) {
        return c.json(
          {
            conflict: {
              existingRule: existing,
              message: `This contradicts an existing rule ("${existing.reason}"). Override it?`,
            },
          },
          409,
        );
      }
    }

    store.addRule(rule);
    eventLog.record("rule_added", { outcome: "added", sentence, rule, source: parsed.source });

    // An office closure cancels every appointment in its window and flags them
    // for staff to reschedule (the office MUST be closed — nothing else to do).
    let rescheduled = 0;
    if (rule.kind === "closure" && rule.startDate && rule.endDate) {
      for (const a of [...store.getAppointments()]) {
        const day = a.start.slice(0, 10);
        if (day >= rule.startDate && day <= rule.endDate) {
          const cancelled = store.cancelAppointment(a.id);
          if (cancelled) {
            reschedule.unshift({
              id: `rs-${cancelled.id}`,
              appointment: cancelled,
              reason: rule.reason,
              flaggedAt: new Date().toISOString(),
            });
            rescheduled += 1;
          }
        }
      }
      eventLog.record("rule_added", { outcome: "closure", rule, rescheduled });
    }
    return c.json({ rule, source: parsed.source, rules: store.getRules(), rescheduled });
  });

  // Delete a rule by id (admin removing/superseding a scheduling rule).
  app.delete("/api/rules/:id", (c) => {
    const id = c.req.param("id");
    const removed = store.removeRule(id);
    if (!removed) return c.json({ error: "no rule with that id" }, 404);
    eventLog.record("rule_added", { outcome: "removed", ruleId: id });
    return c.json({ rules: store.getRules() });
  });

  // Reset the whole system to its seed defaults — drops runtime bookings + rules,
  // clears the log and the callback queue. A testing convenience.
  app.post("/api/reset", (c) => {
    store.reload();
    eventLog.reset();
    callbacks.length = 0;
    reschedule.length = 0;
    // "Reset to default" means a clean slate everywhere — including the cost /
    // efficiency dashboard, not just the store and the log.
    costTracker.reset();
    latency.reset();
    (Object.keys(tiered.pathCounts) as (keyof typeof tiered.pathCounts)[]).forEach((k) => {
      tiered.pathCounts[k] = 0;
    });
    return c.json({ ok: true });
  });

  // --- Observability: the event log surfaced as an API ---

  // Recent events (newest first), optionally filtered by ?type= and ?limit=.
  app.get("/api/logs", (c) => {
    const typeParam = c.req.query("type");
    const type = LOG_TYPES.includes(typeParam as EventType) ? (typeParam as EventType) : undefined;
    const limitParam = Number(c.req.query("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100;
    return c.json({ events: eventLog.recent({ type, limit }) });
  });

  // Aggregates for the activity dashboard (counts by type/path, escalations, etc.).
  app.get("/api/logs/stats", (c) => {
    return c.json(eventLog.stats());
  });

  // Replay a logged schedule request through the CURRENT code and diff the
  // result — a built-in regression check ("did anything I changed re-rank this?").
  app.post("/api/logs/replay", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    const event = id ? eventLog.find(id) : undefined;
    if (!event || event.type !== "schedule_request") {
      return c.json({ error: "no schedule_request event with that id" }, 404);
    }
    const request = String(event.data.request ?? "");
    const refDate = typeof event.data.refDate === "string" ? event.data.refDate : undefined;

    // Replay re-runs the REAL pipeline (so it reflects current behavior), which
    // would otherwise bump path counts and the cost meter. Snapshot those and
    // roll them back afterward — a diagnostic must not skew business metrics.
    const pathSnapshot = { ...tiered.pathCounts };
    const lastPathSnapshot = tiered.lastPath;
    const costSnapshot = costTracker.snapshot();

    const { recommendation, escalation } = await assistant.handle(request, { refDate });

    (Object.keys(pathSnapshot) as (keyof typeof tiered.pathCounts)[]).forEach((k) => {
      tiered.pathCounts[k] = pathSnapshot[k];
    });
    tiered.lastPath = lastPathSnapshot;
    costTracker.restore(costSnapshot);

    const current = recommendation.slots.map((s) => ({
      start: s.slot.start,
      providerId: s.slot.providerId,
      operatoryId: s.slot.operatoryId,
      score: s.score,
    }));
    const original = (event.data.recommendations as unknown[]) ?? [];
    const changed =
      JSON.stringify(current) !== JSON.stringify(original) ||
      escalation.level !== event.data.escalationLevel;
    return c.json({
      request,
      refDate: refDate ?? null,
      original: { recommendations: original, escalationLevel: event.data.escalationLevel ?? "none" },
      current: { recommendations: current, escalationLevel: escalation.level },
      changed,
    });
  });

  // Download the full log for management / external analysis.
  app.get("/api/logs/export", (c) => {
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const events = eventLog.all();
    if (format === "csv") {
      const rows = [
        "id,ts,type,correlationId,data",
        ...events.map((e) =>
          [e.id, e.ts, e.type, e.correlationId ?? "", csvCell(JSON.stringify(e.data))].join(","),
        ),
      ];
      c.header("Content-Type", "text/csv");
      c.header("Content-Disposition", 'attachment; filename="events.csv"');
      return c.body(rows.join("\n"));
    }
    c.header("Content-Type", "application/json");
    c.header("Content-Disposition", 'attachment; filename="events.json"');
    return c.body(JSON.stringify(events, null, 2));
  });

  // Wipe the log (clears dev/test noise before a demo). Destructive by design.
  app.post("/api/logs/reset", (c) => {
    eventLog.reset();
    return c.json({ ok: true });
  });

  return app;
}

/** Quote a CSV cell that may contain commas/quotes/newlines. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Next id like "rule-003" by incrementing the max numeric suffix. */
function nextRuleId(existing: AvailabilityRule[]): string {
  let max = 0;
  for (const r of existing) {
    const n = Number(r.id.split("-").pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `rule-${String(max + 1).padStart(3, "0")}`;
}
