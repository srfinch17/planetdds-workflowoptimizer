import type {
  Appointment,
  AppointmentType,
  CandidateSlot,
  Provider,
  SchedulingIntent,
  Weekday,
} from "../types";
import type { ScheduleStore } from "../store/ScheduleStore";
import { addMinutes, overlaps, toIso, weekdayOf, withinHours } from "../time";
import { resolveAvailability, officeClosure } from "./availability";

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
  const apptType = intent.appointmentType
    ? store.getAppointmentTypes().find((t) => t.type === intent.appointmentType)
    : undefined;

  const startDate = intent.earliestDate ?? refDate;
  const endDate = intent.latestDate ?? addDays(startDate, horizon);
  const dates = datesInRange(startDate, endDate);
  const allowedWeekdays = new Set(intent.daysOfWeek);

  // Index appointments by day: only the same day's appointments can conflict
  // with a slot, so this turns an O(allAppointments) scan per slot into O(few).
  // With ~a year of seeded data this is the difference between snappy and slow.
  const apptsByDate = new Map<string, Appointment[]>();
  for (const a of store.getAppointments()) {
    const key = a.start.slice(0, 10);
    const list = apptsByDate.get(key);
    if (list) list.push(a);
    else apptsByDate.set(key, [a]);
  }
  const rules = store.getRules();
  const candidates: CandidateSlot[] = [];

  for (const date of dates) {
    const wd = weekdayOf(`${date}T00:00:00`);
    if (allowedWeekdays.size > 0 && !allowedWeekdays.has(wd)) continue;
    // Office-wide closure: nobody is bookable this day, regardless of provider.
    if (officeClosure(date, rules)) continue;
    const appts = apptsByDate.get(date) ?? [];

    for (const provider of store.getProviders()) {
      // Hard: a provider must be qualified for this appointment type (role +
      // specialty), so a hygienist never surfaces for an extraction/emergency.
      if (!providerCanPerform(provider, apptType)) continue;

      // Hard: resolve base workdays + add/remove-workday rules (newest wins).
      const av = resolveAvailability(provider, date, rules);
      if (!av.works) continue;

      // Block rules (e.g., lunch) for this provider, materialized on this date.
      const blocks = rules
        .filter((r) => r.providerId === provider.id && r.kind === "block" && r.start && r.end)
        .map((r) => ({ start: `${date}T${r.start}:00`, end: `${date}T${r.end}:00` }));

      for (const operatory of store.getOperatories()) {
        let cursor = `${date}T${av.hours.start}:00`;
        const dayEnd = `${date}T${av.hours.end}:00`;

        while (new Date(cursor).getTime() <= new Date(dayEnd).getTime()) {
          const slotStart = cursor;
          const slotEnd = addMinutes(slotStart, duration);

          // Stop once the slot would run past the provider's hours.
          if (new Date(slotEnd).getTime() > new Date(dayEnd).getTime()) break;

          if (
            withinHours(slotStart, slotEnd, av.hours.start, av.hours.end) &&
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

/**
 * Is this provider qualified to perform this appointment type? Eligibility is
 * data-driven (policy lives in appointmentTypes.json, not here): an unknown type
 * imposes no restriction, otherwise the provider's role must be allowed and they
 * must list any required specialty.
 */
function providerCanPerform(provider: Provider, apptType: AppointmentType | undefined): boolean {
  if (!apptType) return true;
  if (apptType.eligibleRoles && !apptType.eligibleRoles.includes(provider.role)) return false;
  if (apptType.requiredSpecialty && !provider.specialties.includes(apptType.requiredSpecialty)) return false;
  return true;
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
