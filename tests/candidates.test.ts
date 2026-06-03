import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { generateCandidates } from "../src/core/schedule/candidateGenerator";
import { overlaps, weekdayOf, withinHours } from "../src/core/time";
import type { Provider, Operatory, AppointmentType, SchedulingIntent } from "../src/core/types";
import type { ScheduleStore } from "../src/core/store/ScheduleStore";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));

function intent(overrides: Partial<SchedulingIntent>): SchedulingIntent {
  return {
    action: "book",
    appointmentType: "checkup",
    urgency: "routine",
    earliestDate: null,
    latestDate: null,
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

// A synthetic store with arbitrary providers/types — lets us prove the
// data-driven role eligibility independent of the seed (which is all dentists).
function prov(id: string, role: "dentist" | "hygienist", specialties: string[]): Provider {
  return { id, name: id, role, specialties, workdays: ["Thu"], hours: { start: "08:00", end: "17:00" } };
}
function makeStore(providers: Provider[], types: AppointmentType[]): ScheduleStore {
  const operatories: Operatory[] = [{ id: "op-1", name: "Op 1", equipment: ["xray"] }];
  const noop = () => {};
  return {
    getProviders: () => providers,
    getOperatories: () => operatories,
    getPatients: () => [],
    getAppointmentTypes: () => types,
    getAppointments: () => [],
    getRules: () => [],
    addRule: noop,
    removeRule: () => false,
    addPatient: noop,
    book: () => {
      throw new Error("not used");
    },
    cancelAppointment: () => undefined,
    reload: noop,
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
    // Only same-day appointments can overlap a candidate (cross-date can't).
    const appts = store.getAppointments().filter((a) => a.start.slice(0, 10) === "2026-06-04");
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

describe("generateCandidates (provider eligibility)", () => {
  const store = new JsonScheduleStore(SEED_DIR, { persist: false });

  // The seed is now all dentists (Dr. Jones included), so role eligibility is
  // proven with a SYNTHETIC hygienist — the data-driven `eligibleRoles` logic
  // still holds: drop in a hygienist and the generator keeps them out of
  // dentist-only procedures, but still offers them a cleaning.
  it("role eligibility: a hygienist is excluded from a dentists-only type, allowed for a cleaning", () => {
    const roleStore = makeStore(
      [prov("d1", "dentist", ["general"]), prov("h1", "hygienist", ["cleaning"])],
      [
        { type: "filling", durationMin: 60, defaultUrgency: "soon", eligibleRoles: ["dentist"] },
        { type: "cleaning", durationMin: 30, defaultUrgency: "routine", eligibleRoles: ["dentist", "hygienist"] },
      ],
    );
    const fillings = generateCandidates(
      intent({ appointmentType: "filling", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      roleStore,
    );
    expect(fillings.length).toBeGreaterThan(0);
    expect(fillings.some((c) => c.providerId === "h1")).toBe(false); // hygienist NOT offered a filling
    const cleanings = generateCandidates(
      intent({ appointmentType: "cleaning", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      roleStore,
    );
    expect(cleanings.some((c) => c.providerId === "h1")).toBe(true); // hygienist IS offered a cleaning
  });

  it("offers only Dr. Smith for an extraction (requires the extraction specialty)", () => {
    const got = generateCandidates(
      intent({ appointmentType: "extraction", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((c) => c.providerId === "prov-smith")).toBe(true);
  });

  it("offers Dr. Jones (a dentist) for a cleaning", () => {
    const got = generateCandidates(
      intent({ appointmentType: "cleaning", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    expect(got.some((c) => c.providerId === "prov-jones")).toBe(true);
  });

  it("applies no eligibility filter when the appointment type is unknown", () => {
    const got = generateCandidates(
      intent({ appointmentType: null, earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    expect(got.some((c) => c.providerId === "prov-jones")).toBe(true);
  });
});

describe("generateCandidates (operatory equipment)", () => {
  const store = new JsonScheduleStore(SEED_DIR, { persist: false });
  // op-1/op-2 are X-ray-equipped; op-3 is not.
  const xrayOps = new Set(
    store.getOperatories().filter((o) => o.equipment.includes("xray")).map((o) => o.id),
  );

  it("books an extraction only into an X-ray-equipped operatory", () => {
    const got = generateCandidates(
      intent({ appointmentType: "extraction", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((c) => xrayOps.has(c.operatoryId))).toBe(true);
    expect(got.some((c) => c.operatoryId === "op-3")).toBe(false);
  });

  it("lets a checkup use any operatory, including the non-imaging room", () => {
    const got = generateCandidates(
      intent({ appointmentType: "checkup", earliestDate: "2026-06-04", latestDate: "2026-06-04" }),
      store,
    );
    expect(got.some((c) => c.operatoryId === "op-3")).toBe(true);
  });
});
