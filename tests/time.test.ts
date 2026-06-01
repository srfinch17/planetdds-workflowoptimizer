import { describe, it, expect } from "vitest";
import { weekdayOf, overlaps, addMinutes, withinHours } from "../src/core/time";

describe("time helpers", () => {
  it("weekdayOf returns the short weekday name", () => {
    expect(weekdayOf("2026-06-04T09:00:00")).toBe("Thu");
    expect(weekdayOf("2026-05-31T09:00:00")).toBe("Sun");
  });

  it("overlaps detects intersecting intervals (half-open: touching is NOT overlap)", () => {
    // b starts inside a -> overlap
    expect(
      overlaps("2026-06-04T09:00:00", "2026-06-04T09:30:00", "2026-06-04T09:15:00", "2026-06-04T09:45:00"),
    ).toBe(true);
    // b starts exactly when a ends -> NOT an overlap (back-to-back appointments are fine)
    expect(
      overlaps("2026-06-04T09:00:00", "2026-06-04T09:30:00", "2026-06-04T09:30:00", "2026-06-04T10:00:00"),
    ).toBe(false);
    // completely separate
    expect(
      overlaps("2026-06-04T09:00:00", "2026-06-04T09:30:00", "2026-06-04T11:00:00", "2026-06-04T11:30:00"),
    ).toBe(false);
  });

  it("addMinutes advances an ISO timestamp", () => {
    expect(addMinutes("2026-06-04T09:00:00", 30)).toBe("2026-06-04T09:30:00");
    expect(addMinutes("2026-06-04T08:45:00", 60)).toBe("2026-06-04T09:45:00");
  });

  it("withinHours checks the slot fits inside a clinic window", () => {
    // slot must START at/after open AND END at/before close
    expect(withinHours("2026-06-04T08:30:00", "2026-06-04T09:00:00", "08:00", "17:00")).toBe(true);
    expect(withinHours("2026-06-04T16:30:00", "2026-06-04T17:00:00", "08:00", "17:00")).toBe(true);
    expect(withinHours("2026-06-04T16:45:00", "2026-06-04T17:15:00", "08:00", "17:00")).toBe(false);
    expect(withinHours("2026-06-04T07:45:00", "2026-06-04T08:15:00", "08:00", "17:00")).toBe(false);
  });
});
