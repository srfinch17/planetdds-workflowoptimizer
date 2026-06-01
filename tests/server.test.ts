import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server/app";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";
import { TieredIntentExtractor } from "../src/core/intent/TieredIntentExtractor";
import { ScheduleReasoningAgent } from "../src/core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../src/core/orchestrator/SchedulingAssistant";
import { CostTracker } from "../src/core/llm/costTracker";
import type { Hono } from "hono";

const DATA_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));

// Build the app exactly the way index.ts will, but FORCED OFFLINE and with a
// throw-only LLM stub: the suite must pass with no key and no network. A
// persist:false store means booking mutates memory only — seed files untouched.
function buildApp(): { app: Hono; tiered: TieredIntentExtractor } {
  const store = new JsonScheduleStore(DATA_DIR, { persist: false });
  const costTracker = new CostTracker();
  const llm = {
    extract: async () => {
      throw new Error("LLM unavailable (offline test)");
    },
  };
  const tiered = new TieredIntentExtractor(new RuleBasedIntentExtractor(), llm, { offline: true });
  const assistant = new SchedulingAssistant(tiered, new ScheduleReasoningAgent(), store);
  const app = createApp({ store, assistant, tiered, costTracker });
  return { app, tiered };
}

describe("Hono backend API", () => {
  let app: Hono;

  beforeEach(() => {
    app = buildApp().app;
  });

  it("POST /api/schedule returns intent, recommendation, and the path taken", async () => {
    const res = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Can I come in next Thursday after 3?", refDate: "2026-05-31" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intent).toBeDefined();
    expect(body.intent.urgency).toBeDefined();
    expect(body.recommendation.slots.length).toBeGreaterThan(0);
    expect(body.pathTaken).toBe("rules"); // resolved free, no API call
  });

  it("POST /api/schedule with an empty request is a 400", async () => {
    const res = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/state exposes the calendar data", async () => {
    const res = await app.request("/api/state");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.length).toBeGreaterThan(0);
    expect(Array.isArray(body.operatories)).toBe(true);
    expect(Array.isArray(body.appointments)).toBe(true);
    expect(Array.isArray(body.rules)).toBe(true);
  });

  it("GET /api/metrics reports requests served vs API calls", async () => {
    await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "cleaning next Thursday", refDate: "2026-05-31" }),
    });
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requestsServed).toBeGreaterThanOrEqual(1);
    expect(body.apiCalls).toBe(0); // offline → rules path only
    expect(body.estimatedUsd).toBe(0);
    expect(body.pathCounts).toBeDefined();
  });

  it("POST /api/rules is stubbed 501 until Floor 5 wires the parser", async () => {
    const res = await app.request("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence: "Dr. Smith takes lunch from 11 to 12:30" }),
    });
    expect(res.status).toBe(501);
  });

  it("POST /api/book books a recommended slot and returns the updated list", async () => {
    // First get a real, bookable slot from the scheduler.
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Can I come in next Thursday after 3?", refDate: "2026-05-31" }),
    });
    const { recommendation } = await sched.json();
    const slot = recommendation.slots[0].slot;

    const before = await (await app.request("/api/state")).json();

    const res = await app.request("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, patientId: "pat-doe" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appointment).toBeDefined();
    expect(body.appointment.patientId).toBe("pat-doe");
    expect(body.appointments.length).toBe(before.appointments.length + 1);
  });
});
