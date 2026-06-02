import { describe, it, expect } from "vitest";
import { resolveAvailability } from "../src/core/schedule/availability";
import type { AvailabilityRule, Provider } from "../src/core/types";

const pana: Provider = {
  id: "prov-pana",
  name: "Dr. Pana",
  role: "dentist",
  specialties: [],
  workdays: ["Mon", "Tue", "Wed", "Thu"],
  hours: { start: "09:00", end: "16:00" },
};
const SAT = "2026-06-06"; // a Saturday
const rule = (over: Partial<AvailabilityRule>): AvailabilityRule => ({
  id: "r",
  providerId: "prov-pana",
  kind: "dayoff",
  reason: "",
  ...over,
});

describe("resolveAvailability", () => {
  it("uses base workdays when no rule applies", () => {
    expect(resolveAvailability(pana, SAT, []).works).toBe(false); // Pana doesn't work Saturdays by default
    expect(resolveAvailability(pana, "2026-06-08", []).works).toBe(true); // Monday
  });

  it("a workday rule ADDS a day the provider doesn't normally work", () => {
    const rules = [rule({ kind: "workday", weekday: "Sat", createdAt: "2026-06-01T10:00:00Z" })];
    expect(resolveAvailability(pana, SAT, rules).works).toBe(true);
  });

  it("custom hours on a workday rule are used", () => {
    const rules = [
      rule({ kind: "workday", weekday: "Sat", start: "10:00", end: "14:00", createdAt: "2026-06-01T10:00:00Z" }),
    ];
    expect(resolveAvailability(pana, SAT, rules).hours).toEqual({ start: "10:00", end: "14:00" });
  });

  it("newest rule wins on conflict (Pana now works Saturdays overrides an older never-Saturdays)", () => {
    const rules = [
      rule({ kind: "dayoff", weekday: "Sat", createdAt: "2026-06-01T09:00:00Z" }),
      rule({ kind: "workday", weekday: "Sat", createdAt: "2026-06-02T09:00:00Z" }),
    ];
    expect(resolveAvailability(pana, SAT, rules).works).toBe(true);

    const reversed = [
      rule({ kind: "workday", weekday: "Sat", createdAt: "2026-06-01T09:00:00Z" }),
      rule({ kind: "dayoff", weekday: "Sat", createdAt: "2026-06-02T09:00:00Z" }),
    ];
    expect(resolveAvailability(pana, SAT, reversed).works).toBe(false);
  });
});
