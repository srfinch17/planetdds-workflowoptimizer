import { Hono } from "hono";
import type { ScheduleStore } from "../core/store/ScheduleStore";
import type { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import type { TieredIntentExtractor } from "../core/intent/TieredIntentExtractor";
import type { CostTracker } from "../core/llm/costTracker";
import type { CandidateSlot } from "../core/types";

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
}

/**
 * Build the backend. Returns a Hono app; the caller decides whether to serve it
 * on a port (index.ts) or drive it directly in a test.
 */
export function createApp(deps: AppDeps): Hono {
  const { store, assistant, tiered, costTracker } = deps;
  const app = new Hono();

  // Turn an unstructured patient request into ranked, explainable slots.
  // refDate is optional so the demo can pin "today" for reproducible scenarios.
  app.post("/api/schedule", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const request = typeof body.request === "string" ? body.request.trim() : "";
    if (request.length === 0) {
      return c.json({ error: "request must be a non-empty string" }, 400);
    }
    const refDate = typeof body.refDate === "string" ? body.refDate : undefined;

    const { intent, recommendation } = await assistant.handle(request, { refDate });
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

  // Cost/efficiency snapshot. requestsServed vs apiCalls IS the savings number.
  app.get("/api/metrics", (c) => {
    const counts = tiered.pathCounts;
    const requestsServed = counts.rules + counts.llm + counts["offline-fallback"] + counts["llm-failed-fallback"];
    return c.json({
      requestsServed,
      apiCalls: counts.llm, // only the llm path actually hits Anthropic
      pathCounts: counts,
      estimatedUsd: costTracker.usd,
      tokenTotals: costTracker.totals,
    });
  });

  // Book a previously-recommended slot. Mutates the store; the calendar re-reads.
  app.post("/api/book", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const slot = body.slot as CandidateSlot | undefined;
    const patientId = typeof body.patientId === "string" ? body.patientId : "";
    if (!slot || !slot.providerId || !slot.start || !patientId) {
      return c.json({ error: "slot and patientId are required" }, 400);
    }
    const appointment = store.book(slot, patientId);
    return c.json({ appointment, appointments: store.getAppointments() });
  });

  // Plain-English rule teaching — wired in Floor 5 (Task 22). Honest stub now.
  app.post("/api/rules", (c) => {
    return c.json({ error: "not implemented yet — natural-language rules land in Floor 5" }, 501);
  });

  return app;
}
