import { Hono } from "hono";
import type { ScheduleStore } from "../core/store/ScheduleStore";
import type { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import type { TieredIntentExtractor } from "../core/intent/TieredIntentExtractor";
import type { CostTracker } from "../core/llm/costTracker";
import type { CandidateSlot, AvailabilityRule, EscalationLevel } from "../core/types";
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
}

/**
 * Build the backend. Returns a Hono app; the caller decides whether to serve it
 * on a port (index.ts) or drive it directly in a test.
 */
export function createApp(deps: AppDeps): Hono {
  const { store, assistant, tiered, costTracker, eventLog, ruleLlm } = deps;
  const app = new Hono();
  const latency = new LatencyMeter(); // how fast we answer, server-side
  const callbacks: CallbackRecord[] = []; // the staff "call this patient back" queue

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

    const costBefore = costTracker.usd;
    const callsBefore = costTracker.totals.calls;
    const t0 = performance.now();
    const { intent, recommendation, escalation } = await assistant.handle(request, { refDate });
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

  // The raw schedule state the calendar renders from.
  app.get("/api/state", (c) => {
    return c.json({
      providers: store.getProviders(),
      operatories: store.getOperatories(),
      patients: store.getPatients(),
      appointmentTypes: store.getAppointmentTypes(),
      appointments: store.getAppointments(),
      rules: store.getRules(),
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
    });
  });

  // Book a previously-recommended slot. Mutates the store; the calendar re-reads.
  app.post("/api/book", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const slot = body.slot as CandidateSlot | undefined;
    const patientId = typeof body.patientId === "string" ? body.patientId : "";
    const correlationId = typeof body.requestId === "string" ? body.requestId : undefined;
    if (!slot || !slot.providerId || !slot.start || !slot.end || !patientId) {
      return c.json({ error: "slot (with start/end) and patientId are required" }, 400);
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
    eventLog.record(
      "booking",
      {
        outcome: "booked",
        appointmentId: appointment.id,
        providerId: appointment.providerId,
        operatoryId: appointment.operatoryId,
        start: appointment.start,
        patientId,
      },
      correlationId,
    );
    return c.json({ appointment, appointments: store.getAppointments() });
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
    return c.json({ rule, source: parsed.source, rules: store.getRules() });
  });

  // Reset the whole system to its seed defaults — drops runtime bookings + rules,
  // clears the log and the callback queue. A testing convenience.
  app.post("/api/reset", (c) => {
    store.reload();
    eventLog.reset();
    callbacks.length = 0;
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
