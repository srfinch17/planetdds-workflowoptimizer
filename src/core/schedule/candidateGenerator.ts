import type { CandidateSlot, SchedulingIntent, Weekday } from "../types";
import type { ScheduleStore } from "../store/ScheduleStore";
import { addMinutes, overlaps, toIso, weekdayOf, withinHours } from "../time";

const SLOT_STEP_MIN = 15; // granularity of candidate start times
const DEFAULT_DURATION_MIN = 30;
const DEFAULT_HORIZON_DAYS = 5; // how far ahead to search when no latestDate given

export interface GenerateOptions {
  refDate?: string; // "today" for searches with no explicit earliest date
  horizonDays?: number;
}

/**
 * Enumerate every slot that satisfies ALL hard constraints. No scoring here —
 * this answers only "is this slot legally bookable?". Pure deterministic code.
 */
export function generateCandidates(
  intent: SchedulingIntent,
  store: ScheduleStore,
  opts: GenerateOptions = {},
): CandidateSlot[] {
  const refDate = opts.refDate ?? toIso(new Date()).slice(0, 10);
  const horizon = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;

  const duration = durationFor(intent.appointmentType, store) ?? DEFAULT_DURATION_MIN;
  const type = intent.appointmentType ?? "appointment";

  const startDate = intent.earliestDate ?? refDate;
  const endDate = intent.latestDate ?? addDays(startDate, horizon);
  const dates = datesInRange(startDate, endDate);
  const allowedWeekdays = new Set(intent.daysOfWeek);

  const appts = store.getAppointments();
  const rules = store.getRules();
  const candidates: CandidateSlot[] = [];

  for (const date of dates) {
    const wd = weekdayOf(`${date}T00:00:00`);
    if (allowedWeekdays.size > 0 && !allowedWeekdays.has(wd)) continue;

    for (const provider of store.getProviders()) {
      // Hard: provider must work this weekday.
      if (!provider.workdays.includes(wd)) continue;
      // Hard: a day-off rule removes the provider entirely for this weekday.
      if (rules.some((r) => r.providerId === provider.id && r.kind === "dayoff" && r.weekday === wd)) {
        continue;
      }

      // Block rules (e.g., lunch) for this provider, materialized on this date.
      const blocks = rules
        .filter((r) => r.providerId === provider.id && r.kind === "block" && r.start && r.end)
        .map((r) => ({ start: `${date}T${r.start}:00`, end: `${date}T${r.end}:00` }));

      for (const operatory of store.getOperatories()) {
        let cursor = `${date}T${provider.hours.start}:00`;
        const dayEnd = `${date}T${provider.hours.end}:00`;

        while (new Date(cursor).getTime() <= new Date(dayEnd).getTime()) {
          const slotStart = cursor;
          const slotEnd = addMinutes(slotStart, duration);

          // Stop once the slot would run past the provider's hours.
          if (new Date(slotEnd).getTime() > new Date(dayEnd).getTime()) break;

          if (
            withinHours(slotStart, slotEnd, provider.hours.start, provider.hours.end) &&
            !blocks.some((b) => overlaps(slotStart, slotEnd, b.start, b.end)) &&
            !appts.some(
              (a) =>
                (a.providerId === provider.id || a.operatoryId === operatory.id) &&
                overlaps(slotStart, slotEnd, a.start, a.end),
            )
          ) {
            candidates.push({
              providerId: provider.id,
              operatoryId: operatory.id,
              start: slotStart,
              end: slotEnd,
              type,
            });
          }

          cursor = addMinutes(cursor, SLOT_STEP_MIN);
        }
      }
    }
  }

  return candidates;
}

function durationFor(type: string | null, store: ScheduleStore): number | null {
  if (!type) return null;
  const match = store.getAppointmentTypes().find((t) => t.type === type);
  return match ? match.durationMin : null;
}

/** All dates "YYYY-MM-DD" from start to end inclusive. */
function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  let d = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (d.getTime() <= last.getTime()) {
    out.push(toIso(d).slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

function addDays(date: string, days: number): string {
  return toIso(new Date(new Date(`${date}T00:00:00`).getTime() + days * 24 * 60 * 60 * 1000)).slice(0, 10);
}
