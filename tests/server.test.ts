import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server/app";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";
import { TieredIntentExtractor } from "../src/core/intent/TieredIntentExtractor";
import { ScheduleReasoningAgent } from "../src/core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../src/core/orchestrator/SchedulingAssistant";
import { CostTracker } from "../src/core/llm/costTracker";
import { loadDefaultTriageSkill } from "../src/core/skills/triage";
import { JsonlEventLog } from "../src/core/log/eventLog";
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
  const skill = loadDefaultTriageSkill();
  const tiered = new TieredIntentExtractor(new RuleBasedIntentExtractor(skill), llm, { offline: true });
  const assistant = new SchedulingAssistant(tiered, new ScheduleReasoningAgent(), store, 3, skill);
  const eventLog = new JsonlEventLog({}); // memory-only: no file writes in tests
  const app = createApp({ store, assistant, tiered, costTracker, eventLog });
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
    expect(body.requestsServed).toBeGreaterThanOrEqual(1);
    expect(body.apiCalls).toBe(0); // offline → rules path only
    expect(body.freeHandled).toBe(body.requestsServed); // everything was free
    expect(body.freeSharePct).toBe(100);
    expect(body.estimatedUsd).toBe(0);
    expect(body.costPer1000Usd).toBe(0);
    expect(typeof body.avgLatencyMs).toBe("number");
    expect(body.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(body.pathCounts).toBeDefined();
  });

  it("GET /api/availability returns open slots grouped by day for booking", async () => {
    const res = await app.request("/api/availability?from=2026-06-04&to=2026-06-04&type=cleaning");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Object.keys(body.slotsByDay)).toContain("2026-06-04");
    const slots = body.slotsByDay["2026-06-04"];
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(s.start.slice(0, 10)).toBe("2026-06-04"); // on the requested day
      expect(s.type).toBe("cleaning"); // of the requested type
      expect(Number(s.start.slice(14, 16)) % 30).toBe(0); // 30-min booking granularity
    }
    // No two openings share the same provider + start time.
    const keys = slots.map((s: any) => `${s.providerId}@${s.start}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("GET /api/availability honors a weekday filter (only matching days appear)", async () => {
    const res = await app.request("/api/availability?from=2026-06-01&to=2026-06-12&type=cleaning&days=Thu");
    const body = (await res.json()) as any;
    for (const day of Object.keys(body.slotsByDay)) {
      // 4 = Thursday
      expect(new Date(`${day}T00:00:00`).getDay()).toBe(4);
    }
    expect(Object.keys(body.slotsByDay).length).toBeGreaterThan(0);
  });

  it("POST /api/cancel removes an appointment (when the patient owns it)", async () => {
    const state = (await (await app.request("/api/state")).json()) as any;
    const target = state.appointments.find((a: any) => a.start.slice(0, 10) >= "2026-06-09");
    const before = state.appointments.length;
    const res = await app.request("/api/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appointmentId: target.id, patientId: target.patientId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.appointments.length).toBe(before - 1);
    expect(body.appointments.find((a: any) => a.id === target.id)).toBeUndefined();
  });

  it("POST /api/cancel REJECTS cancelling another patient's appointment (403)", async () => {
    const state = (await (await app.request("/api/state")).json()) as any;
    const target = state.appointments.find((a: any) => a.start.slice(0, 10) >= "2026-06-09");
    const res = await app.request("/api/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appointmentId: target.id, patientId: "pat-someone-else" }),
    });
    expect(res.status).toBe(403);
    // ...and it was NOT cancelled.
    const after = (await (await app.request("/api/state")).json()) as any;
    expect(after.appointments.find((a: any) => a.id === target.id)).toBeTruthy();
  });

  it("POST /api/cancel 404s on an unknown appointment", async () => {
    const res = await app.request("/api/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appointmentId: "appt-does-not-exist", patientId: "pat-doe" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/reschedule books a new slot for the same patient and cancels the old", async () => {
    const state = (await (await app.request("/api/state")).json()) as any;
    const old = state.appointments.find((a: any) => a.type === "cleaning" && a.start.slice(0, 10) >= "2026-06-09");
    const avail = (await (await app.request("/api/availability?from=2026-06-04&to=2026-06-04&type=cleaning")).json()) as any;
    const slot = avail.slotsByDay["2026-06-04"][0];
    const res = await app.request("/api/reschedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldAppointmentId: old.id, slot, patientId: old.patientId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.confirmationNumber).toMatch(/^DDS-/);
    expect(body.appointment.patientId).toBe(old.patientId); // same patient
    expect(body.appointments.find((a: any) => a.id === old.id)).toBeUndefined(); // old gone
    expect(body.appointments.find((a: any) => a.id === body.appointment.id)).toBeTruthy(); // new there
  });

  it("POST /api/reschedule REJECTS moving another patient's appointment (403)", async () => {
    const state = (await (await app.request("/api/state")).json()) as any;
    const old = state.appointments.find((a: any) => a.type === "cleaning" && a.start.slice(0, 10) >= "2026-06-09");
    const avail = (await (await app.request("/api/availability?from=2026-06-04&to=2026-06-04&type=cleaning")).json()) as any;
    const slot = avail.slotsByDay["2026-06-04"][0];
    const res = await app.request("/api/reschedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldAppointmentId: old.id, slot, patientId: "pat-someone-else" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/reset returns the metrics dashboard to a clean slate", async () => {
    await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "cleaning next Thursday", refDate: "2026-05-31" }),
    });
    const before = (await (await app.request("/api/metrics")).json()) as any;
    expect(before.requestsServed).toBeGreaterThanOrEqual(1);

    await app.request("/api/reset", { method: "POST" });

    const after = (await (await app.request("/api/metrics")).json()) as any;
    expect(after.requestsServed).toBe(0);
    expect(after.apiCalls).toBe(0);
    expect(after.estimatedUsd).toBe(0);
    expect(after.avgLatencyMs).toBe(0);
  });

  it("POST /api/schedule escalates a medical emergency and queues a staff callback", async () => {
    const res = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: "a tooth got knocked out and my mouth won't stop bleeding",
        refDate: "2026-06-04",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.escalation.level).toBe("emergency");
    expect(body.escalation.callbackRequired).toBe(true);

    const queue = (await (await app.request("/api/callbacks")).json()) as any;
    expect(queue.callbacks.length).toBe(1);
    expect(queue.callbacks[0].level).toBe("emergency");
  });

  it("POST /api/schedule does NOT queue a callback for a normal request", async () => {
    await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "routine cleaning next Thursday", refDate: "2026-05-31" }),
    });
    const queue = (await (await app.request("/api/callbacks")).json()) as any;
    expect(queue.callbacks.length).toBe(0);
  });

  it("a queued callback captures the patient's name/phone from the request body (who to call)", async () => {
    const res = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: "my tooth broke off, when can I come in?",
        refDate: "2026-06-04",
        patientName: "Bart Simpson",
        patientPhone: "949-555-0142",
      }),
    });
    const body = (await res.json()) as any;
    expect(body.escalation.callbackRequired).toBe(true);
    expect(body.callbackId).toBeTruthy(); // returned so the patient can attach contact later

    const queue = (await (await app.request("/api/callbacks")).json()) as any;
    expect(queue.callbacks[0].patientName).toBe("Bart Simpson");
    expect(queue.callbacks[0].patientPhone).toBe("949-555-0142");
  });

  it("a queued callback captures contact stated IN the request text", async () => {
    await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: "this is Bart Simpson, 949-555-0142, my tooth broke off",
        refDate: "2026-06-04",
      }),
    });
    const queue = (await (await app.request("/api/callbacks")).json()) as any;
    expect(queue.callbacks[0].patientName).toBe("Bart Simpson");
    expect(queue.callbacks[0].patientPhone).toBe("949-555-0142");
  });

  it("POST /api/callbacks/contact attaches contact to a callback that was queued blind", async () => {
    // The reported bug: an escalation with NO name/phone leaves staff with no one to call.
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "my tooth broke off, when can I come in?", refDate: "2026-06-04" }),
    });
    const body = (await sched.json()) as any;
    expect(body.escalation.callbackRequired).toBe(true);
    const id = body.callbackId as string;
    expect(id).toBeTruthy();

    let queue = (await (await app.request("/api/callbacks")).json()) as any;
    expect(queue.callbacks[0].patientPhone).toBeNull(); // queued blind — nobody to call yet

    const attach = await app.request("/api/callbacks/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: "Homer Simpson", phone: "949-555-0143" }),
    });
    expect(attach.status).toBe(200);

    queue = (await (await app.request("/api/callbacks")).json()) as any;
    expect(queue.callbacks[0].patientName).toBe("Homer Simpson");
    expect(queue.callbacks[0].patientPhone).toBe("949-555-0143");
  });

  it("POST /api/rules parses a sentence (offline regex) and adds the rule", async () => {
    const before = (await (await app.request("/api/state")).json()) as any;
    const res = await app.request("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence: "Dr. Jones takes lunch from 12 to 1 every day" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.rule.providerId).toBe("prov-jones");
    expect(body.rule.kind).toBe("block");
    expect(body.rule.id).toBeDefined(); // store assigned an id
    expect(body.rules.length).toBe(before.rules.length + 1);
  });

  it("POST /api/rules returns 422 when it can't parse and there's no LLM", async () => {
    const res = await app.request("/api/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentence: "make the schedule better somehow" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("POST /api/book rejects a slot that conflicts with an existing booking (409)", async () => {
    const slotA = {
      providerId: "prov-pana",
      operatoryId: "op-2",
      start: "2026-06-04T15:00:00",
      end: "2026-06-04T15:30:00",
      type: "appointment",
    };
    // Overlaps slotA for the same provider (15:15–15:45 vs 15:00–15:30).
    const slotB = { ...slotA, start: "2026-06-04T15:15:00", end: "2026-06-04T15:45:00" };

    const first = await app.request("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: slotA, patientId: "pat-doe" }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: slotB, patientId: "pat-roe" }),
    });
    expect(second.status).toBe(409); // no double-booking
  });

  it("POST /api/book books a recommended slot and returns the updated list", async () => {
    // First get a real, bookable slot from the scheduler.
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Can I come in next Thursday after 3?", refDate: "2026-05-31" }),
    });
    const { recommendation } = (await sched.json()) as any;
    const slot = recommendation.slots[0].slot;

    const before = (await (await app.request("/api/state")).json()) as any;

    const res = await app.request("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, patientId: "pat-doe" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.appointment).toBeDefined();
    expect(body.appointment.patientId).toBe("pat-doe");
    expect(body.appointments.length).toBe(before.appointments.length + 1);
  });

  it("POST /api/book reuses an existing patient by name instead of forking a duplicate", async () => {
    // Regression: booking under a name that already exists (no patientId, as the
    // Intake form sends) used to mint a SECOND "Jane Doe". A later cancel-by-name
    // then matched two patients, went ambiguous, and reported "not found".
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "Can I come in next Thursday after 3?", refDate: "2026-05-31" }),
    });
    const { recommendation } = (await sched.json()) as any;
    const slot = recommendation.slots[0].slot;

    const before = (await (await app.request("/api/state")).json()) as any;
    const janeBefore = before.patients.filter((p: any) => p.name === "Jane Doe");
    expect(janeBefore.length).toBe(1); // seed has exactly one Jane Doe

    const res = await app.request("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, patientName: "Jane Doe", patientPhone: "949-555-7777" }),
    });
    expect(res.status).toBe(200);
    const booked = (await res.json()) as any;
    // Reused the seed patient's id rather than creating a new one.
    expect(booked.appointment.patientId).toBe(janeBefore[0].id);

    const after = (await (await app.request("/api/state")).json()) as any;
    expect(after.patients.filter((p: any) => p.name === "Jane Doe").length).toBe(1); // still one

    // The original symptom: cancel-by-name must still resolve her.
    const cancel = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "this is Jane Doe, cancel my appointment" }),
    });
    const cancelBody = (await cancel.json()) as any;
    expect(cancelBody.patientMatch.found).toBe(true);
  });

  it("logs a schedule_request and exposes it via GET /api/logs (+ stats)", async () => {
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "cleaning next Thursday", refDate: "2026-05-31" }),
    });
    const { requestId } = (await sched.json()) as any;
    expect(requestId).toBeTruthy();

    const logs = (await (await app.request("/api/logs?type=schedule_request")).json()) as any;
    expect(logs.events.length).toBe(1);
    expect(logs.events[0].id).toBe(requestId);
    expect(logs.events[0].data.request).toContain("cleaning");

    const stats = (await (await app.request("/api/logs/stats")).json()) as any;
    expect(stats.byType.schedule_request).toBe(1);
  });

  it("links a booking to its originating request via correlationId", async () => {
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "next Thursday after 3", refDate: "2026-05-31" }),
    });
    const { recommendation, requestId } = (await sched.json()) as any;
    await app.request("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: recommendation.slots[0].slot, patientId: "pat-doe", requestId }),
    });
    const logs = (await (await app.request("/api/logs?type=booking")).json()) as any;
    expect(logs.events[0].correlationId).toBe(requestId);
    expect(logs.events[0].data.outcome).toBe("booked");
  });

  it("replays a logged request and reports whether the result changed", async () => {
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "next Thursday after 3", refDate: "2026-05-31" }),
    });
    const { requestId } = (await sched.json()) as any;
    const res = await app.request("/api/logs/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: requestId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.changed).toBe(false); // same code, same data → identical
    expect(body.current.recommendations.length).toBeGreaterThan(0);
  });

  it("replay is a diagnostic and must NOT skew live metrics", async () => {
    const sched = await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "cleaning next Thursday", refDate: "2026-05-31" }),
    });
    const { requestId } = (await sched.json()) as any;
    const before = (await (await app.request("/api/metrics")).json()) as any;

    await app.request("/api/logs/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: requestId }),
    });

    const after = (await (await app.request("/api/metrics")).json()) as any;
    expect(after.requestsServed).toBe(before.requestsServed); // replay didn't count as a request
    expect(after.estimatedUsd).toBe(before.estimatedUsd); // and didn't skew cost
  });

  it("POST /api/logs/reset clears the log", async () => {
    await app.request("/api/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "cleaning", refDate: "2026-05-31" }),
    });
    await app.request("/api/logs/reset", { method: "POST" });
    const stats = (await (await app.request("/api/logs/stats")).json()) as any;
    expect(stats.total).toBe(0);
  });
});
