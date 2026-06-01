import { Hono } from "hono";
import type { ScheduleStore } from "../core/store/ScheduleStore";
import type { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import type { TieredIntentExtractor } from "../core/intent/TieredIntentExtractor";
import type { CostTracker } from "../core/llm/costTracker";
import type { CandidateSlot, AvailabilityRule } from "../core/types";
import type { LlmClient } from "../core/llm/anthropicClient";
import { parseRuleSentence } from "../core/rules/ruleParser";
import { overlaps } from "../core/time";
import { LatencyMeter } from "./metrics";

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
  ruleLlm?: LlmClient; // optional: lets POST /api/rules fall back to the LLM when present
}

/**
 * Build the backend. Returns a Hono app; the caller decides whether to serve it
 * on a port (index.ts) or drive it directly in a test.
 */
export function createApp(deps: AppDeps): Hono {
  const { store, assistant, tiered, costTracker, ruleLlm } = deps;
  const app = new Hono();
  const latency = new LatencyMeter(); // how fast we answer, server-side

  // Turn an unstructured patient request into ranked, explainable slots.
  // refDate is optional so the demo can pin "today" for reproducible scenarios.
  app.post("/api/schedule", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const request = typeof body.request === "string" ? body.request.trim() : "";
    if (request.length === 0) {
      return c.json({ error: "request must be a non-empty string" }, 400);
    }
    const refDate = typeof body.refDate === "string" ? body.refDate : undefined;

    const t0 = performance.now();
    const { intent, recommendation } = await assistant.handle(request, { refDate });
    latency.record(performance.now() - t0);
    // tiered.lastPath was just set by this exact call — surfaces the cost story.
    return c.json({ intent, recommendation, pathTaken: tiered.lastPath });
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
    });
  });

  // Book a previously-recommended slot. Mutates the store; the calendar re-reads.
  app.post("/api/book", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const slot = body.slot as CandidateSlot | undefined;
    const patientId = typeof body.patientId === "string" ? body.patientId : "";
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
      return c.json({ error: "That slot was just taken — please pick another." }, 409);
    }
    const appointment = store.book(slot, patientId);
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
      return c.json({ error: parsed.error }, 422);
    }
    const rule: AvailabilityRule = { ...parsed.rule, id: nextRuleId(store.getRules()) };
    store.addRule(rule);
    return c.json({ rule, source: parsed.source, rules: store.getRules() });
  });

  return app;
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
