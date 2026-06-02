import { describe, it, expect } from "vitest";
import { parseIntent } from "../src/core/intent/intentSchema";
import type { SchedulingIntent } from "../src/core/types";

const valid: SchedulingIntent = {
  appointmentType: "checkup",
  urgency: "routine",
  earliestDate: "2026-06-04",
  latestDate: "2026-06-04",
  daysOfWeek: ["Thu"],
  timeEarliest: "15:00",
  timeLatest: null,
  partOfDay: null,
  preferredProviderId: "prov-smith",
  patientName: null,
  patientPhone: null,
  rawRequest: "next thursday after 3",
  source: "llm",
  confidence: 0.9,
};

describe("parseIntent (Zod validation boundary)", () => {
  it("accepts a well-formed intent and returns ok:true", () => {
    const result = parseIntent(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.intent.appointmentType).toBe("checkup");
  });

  it("rejects a bad urgency enum", () => {
    const result = parseIntent({ ...valid, urgency: "kinda-soon" });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong types (confidence as a string)", () => {
    const result = parseIntent({ ...valid, confidence: "high" });
    expect(result.ok).toBe(false);
  });

  it("rejects an out-of-range confidence", () => {
    const result = parseIntent({ ...valid, confidence: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid weekday in daysOfWeek", () => {
    const result = parseIntent({ ...valid, daysOfWeek: ["Thu", "Funday"] });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed time string", () => {
    const result = parseIntent({ ...valid, timeEarliest: "3pm" });
    expect(result.ok).toBe(false);
  });

  it("returns an error message when invalid", () => {
    const result = parseIntent({ nonsense: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.error).toBe("string");
  });
});
