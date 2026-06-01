import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { generateCandidates } from "../src/core/schedule/candidateGenerator";
import { overlaps, weekdayOf, withinHours } from "../src/core/time";
import type { SchedulingIntent } from "../src/core/types";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));

function intent(overrides: Partial<SchedulingIntent>): SchedulingIntent {
  return {
    appointmentType: "checkup",
    urgency: "routine",
    earliestDate: null,
    latestDate: null,
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

describe("generateCandidates (hard constraints)", () => {
  const store = new JsonScheduleStore(SEED_DIR, { persist: false });

  it("produces bookable slots for a checkup on Thu 2026-06-04", () => {
    const got = generateCandidates(
      intent({ appointmentType: "checkup", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((c) => weekdayOf(c.start) === "Thu")).toBe(true);
  });

  it("never overlaps an existing appointment for the same provider or operatory", () => {
    const got = generateCandidates(
      intent({ appointmentType: "checkup", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    const appts = store.getAppointments();
    for (const c of got) {
      for (const a of appts) {
        const sharesResource = a.providerId === c.providerId || a.operatoryId === c.operatoryId;
        if (sharesResource) {
          expect(overlaps(c.start, c.end, a.start, a.end)).toBe(false);
        }
      }
    }
  });

  it("respects Dr. Smith's 11:00-12:30 lunch block", () => {
    const got = generateCandidates(
      intent({ appointmentType: "checkup", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    const smith = got.filter((c) => c.providerId === "prov-smith");
    for (const c of smith) {
      expect(overlaps(c.start, c.end, "2026-06-04T11:00:00", "2026-06-04T12:30:00")).toBe(false);
    }
  });

  it("keeps every slot inside the provider's working hours", () => {
    const got = generateCandidates(
      intent({ appointmentType: "checkup", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    const providers = Object.fromEntries(store.getProviders().map((p) => [p.id, p]));
    for (const c of got) {
      const p = providers[c.providerId]!;
      expect(withinHours(c.start, c.end, p.hours.start, p.hours.end)).toBe(true);
    }
  });

  it("offers no Dr. Pana slots on a Friday (workday + day-off rule)", () => {
    const got = generateCandidates(
      intent({ appointmentType: "checkup", earliestDate: "2026-06-05", latestDate: "2026-06-05" }),
      store,
    );
    expect(got.some((c) => c.providerId === "prov-pana")).toBe(false);
  });
});
