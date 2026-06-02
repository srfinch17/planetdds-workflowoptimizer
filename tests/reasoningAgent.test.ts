import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { ScheduleReasoningAgent } from "../src/core/schedule/ScheduleReasoningAgent";
import type { SchedulingIntent } from "../src/core/types";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });

function intent(overrides: Partial<SchedulingIntent>): SchedulingIntent {
  return {
    appointmentType: "checkup",
    urgency: "routine",
    earliestDate: "2026-06-04",
    latestDate: "2026-06-04",
    daysOfWeek: [],
    timeEarliest: null,
    timeLatest: null,
    partOfDay: null,
    preferredProviderId: null,
    rawRequest: "test",
    source: "rules",
    confidence: 1,
    ...overrides,
  };
}

const agent = new ScheduleReasoningAgent();
const opts = { refDate: "2026-06-04" };

describe("ScheduleReasoningAgent.recommend", () => {
  it("returns at most N slots, sorted descending by score", () => {
    const rec = agent.recommend(intent({ timeEarliest: "15:00" }), store, 3, opts);
    expect(rec.slots.length).toBeGreaterThan(0);
    expect(rec.slots.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < rec.slots.length; i++) {
      expect(rec.slots[i - 1]!.score).toBeGreaterThanOrEqual(rec.slots[i]!.score);
    }
  });

  it("dedupes so the same provider+time is never offered twice", () => {
    // Many operatories produce the same provider+start; collapse to one.
    const rec = agent.recommend(intent({}), store, 10, opts);
    const keys = rec.slots.map((s) => `${s.slot.providerId}@${s.slot.start}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives same-time recommendations DISTINCT operatories so they're independently bookable", () => {
    // At 15:00 op-1 is taken by Smith's checkup; Pana and Jones must not BOTH
    // be assigned op-2 — they should get different free rooms (op-2 and op-3).
    const rec = agent.recommend(intent({ timeEarliest: "15:00" }), store, 3, opts);
    const byStart = new Map<string, string[]>();
    for (const s of rec.slots) {
      const list = byStart.get(s.slot.start) ?? [];
      list.push(s.slot.operatoryId);
      byStart.set(s.slot.start, list);
    }
    for (const rooms of byStart.values()) {
      expect(new Set(rooms).size).toBe(rooms.length); // no shared room at the same time
    }
  });

  it("flags bestEffort=false when a real match exists", () => {
    const rec = agent.recommend(intent({ timeEarliest: "15:00" }), store, 3, opts);
    expect(rec.bestEffort).toBe(false);
  });

  it("flags bestEffort=true but still returns closest slots when nothing matches the time window", () => {
    // No provider works past 17:00, so a 9pm request can never match.
    const rec = agent.recommend(intent({ timeEarliest: "21:00" }), store, 3, opts);
    expect(rec.bestEffort).toBe(true);
    expect(rec.slots.length).toBeGreaterThan(0);
  });

  it("never returns empty: when the requested window is fully booked, it widens to the nearest opening", () => {
    // An extraction (90 min, X-ray room, Dr. Smith only) has no opening in the
    // dense week of 2026-06-11 — but the patient should still get the soonest
    // real extraction slot, flagged best-effort, not an empty result.
    const rec = agent.recommend(
      intent({
        appointmentType: "extraction",
        earliestDate: "2026-06-11",
        latestDate: "2026-06-11",
        daysOfWeek: ["Thu"],
      }),
      store,
      3,
      { refDate: "2026-06-02" },
    );
    expect(rec.slots.length).toBeGreaterThan(0);
    expect(rec.bestEffort).toBe(true);
    // Whatever it offers is still a valid extraction: Dr. Smith, in an X-ray room.
    const xrayOps = new Set(
      store.getOperatories().filter((o) => o.equipment.includes("xray")).map((o) => o.id),
    );
    for (const s of rec.slots) {
      expect(s.slot.providerId).toBe("prov-smith");
      expect(xrayOps.has(s.slot.operatoryId)).toBe(true);
    }
  });

  it("when a provider is requested, leads with their slots then includes alternatives", () => {
    const rec = agent.recommend(intent({ preferredProviderId: "prov-smith" }), store, 3, opts);
    expect(rec.preferredProviderId).toBe("prov-smith");
    // The requested provider leads the list...
    expect(rec.slots[0]!.slot.providerId).toBe("prov-smith");
    // ...and at least one alternative from a different provider is offered.
    expect(rec.slots.some((s) => s.slot.providerId !== "prov-smith")).toBe(true);
    // The preferred slots come before any alternative.
    const firstOtherIdx = rec.slots.findIndex((s) => s.slot.providerId !== "prov-smith");
    const lastPrefIdx = rec.slots.map((s) => s.slot.providerId === "prov-smith").lastIndexOf(true);
    expect(firstOtherIdx).toBeGreaterThan(lastPrefIdx === -1 ? Infinity : lastPrefIdx);
  });

  it("no provider requested → flat top-N (no preferredProviderId)", () => {
    const rec = agent.recommend(intent({}), store, 3, opts);
    expect(rec.preferredProviderId ?? null).toBeNull();
    expect(rec.slots.length).toBeLessThanOrEqual(3);
  });
});
