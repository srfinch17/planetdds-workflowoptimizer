import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { scoreSlot } from "../src/core/schedule/scorer";
import type { CandidateSlot, SchedulingIntent } from "../src/core/types";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });

function intent(overrides: Partial<SchedulingIntent>): SchedulingIntent {
  return {
    action: "book",
    appointmentType: "checkup",
    urgency: "routine",
    earliestDate: "2026-06-04",
    latestDate: "2026-06-04",
    daysOfWeek: [],
    timeEarliest: null,
    timeLatest: null,
    partOfDay: null,
    preferredProviderId: null,
    patientName: null,
    patientPhone: null,
    rawRequest: "test",
    source: "rules",
    confidence: 1,
    ...overrides,
  };
}

const slotA: CandidateSlot = {
  providerId: "prov-smith",
  operatoryId: "op-1",
  start: "2026-06-04T15:30:00",
  end: "2026-06-04T16:00:00",
  type: "checkup",
};
const slotB: CandidateSlot = {
  providerId: "prov-jones",
  operatoryId: "op-3",
  start: "2026-06-04T09:00:00",
  end: "2026-06-04T09:30:00",
  type: "checkup",
};

describe("scoreSlot", () => {
  const want = intent({ timeEarliest: "15:00", preferredProviderId: "prov-smith" });
  const opts = { refDate: "2026-06-04" };

  it("ranks the slot matching time window + preferred provider higher", () => {
    const a = scoreSlot(slotA, want, store, opts);
    const b = scoreSlot(slotB, want, store, opts);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("explanation cites the matched time window and preferred provider", () => {
    const a = scoreSlot(slotA, want, store, opts);
    expect(a.explanation).toMatch(/Smith/);
    expect(a.explanation).toMatch(/3:30 PM/);
    expect(a.factors.find((f) => f.name === "time_window_match")!.matched).toBe(true);
    expect(a.factors.find((f) => f.name === "preferred_provider")!.matched).toBe(true);
  });

  it("score stays within 0..100", () => {
    const a = scoreSlot(slotA, want, store, opts);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});
