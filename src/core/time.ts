// Pure date/time helpers. All timestamps are local wall-clock ISO strings
// of the form "YYYY-MM-DDTHH:mm:ss" (no timezone — single-clinic demo).
//
// NOTE: `new Date("2026-06-04T09:00:00")` (no trailing Z) is parsed as LOCAL
// time by JS, and getDay()/getHours() return local components — exactly the
// wall-clock behavior we want.

import type { Weekday } from "./types";

const WEEKDAYS: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Format a Date back into "YYYY-MM-DDTHH:mm:ss" using its LOCAL components. */
export function toIso(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Short weekday name ("Mon".."Sun") for an ISO timestamp. */
export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[new Date(iso).getDay()]!;
}

/**
 * Do two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap?
 * Half-open means back-to-back appointments (one ends exactly when the next
 * starts) do NOT count as overlapping.
 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const a0 = new Date(aStart).getTime();
  const a1 = new Date(aEnd).getTime();
  const b0 = new Date(bStart).getTime();
  const b1 = new Date(bEnd).getTime();
  return a0 < b1 && b0 < a1;
}

/** Return a new ISO timestamp advanced by `minutes`. */
export function addMinutes(iso: string, minutes: number): string {
  return toIso(new Date(new Date(iso).getTime() + minutes * 60_000));
}

/**
 * Does a slot [slotStart, slotEnd] fit entirely within a clinic window
 * [openTime, closeTime] on the slot's own date? Times are "HH:mm".
 */
export function withinHours(
  slotStart: string,
  slotEnd: string,
  openTime: string,
  closeTime: string,
): boolean {
  const datePart = slotStart.slice(0, 10); // "YYYY-MM-DD"
  const open = new Date(`${datePart}T${openTime}:00`).getTime();
  const close = new Date(`${datePart}T${closeTime}:00`).getTime();
  const start = new Date(slotStart).getTime();
  const end = new Date(slotEnd).getTime();
  return start >= open && end <= close;
}
