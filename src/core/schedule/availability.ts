import type { AvailabilityRule, Provider } from "../types";
import { weekdayOf } from "../time";

export interface DayAvailability {
  works: boolean;
  hours: { start: string; end: string };
}

/** The office-wide closure covering a date, if any (overrides all providers). */
export function officeClosure(date: string, rules: AvailabilityRule[]): AvailabilityRule | undefined {
  return rules.find(
    (r) => r.kind === "closure" && !!r.startDate && !!r.endDate && date >= r.startDate && date <= r.endDate,
  );
}

/**
 * A one-time time-off (specific date range) for THIS provider, if any. It's an
 * adjustment, not a recurring rule, so it overrides the provider's normal
 * availability — including any recurring workday rule — for the dates it covers.
 */
export function providerTimeOff(
  providerId: string,
  date: string,
  rules: AvailabilityRule[],
): AvailabilityRule | undefined {
  return rules.find(
    (r) =>
      r.kind === "timeoff" &&
      r.providerId === providerId &&
      !!r.startDate &&
      !!r.endDate &&
      date >= r.startDate &&
      date <= r.endDate,
  );
}

/**
 * Resolve whether a provider works on a given date, and with what hours.
 *
 * Base availability is the provider's static workdays/hours. Rules then layer
 * on top: a `workday` rule ADDS a weekday the provider doesn't normally work, a
 * `dayoff` rule REMOVES one. When two rules touch the same weekday, the NEWEST
 * (by createdAt) wins — so "Dr. Pana now works Saturdays" overrides an older
 * "Dr. Pana never works Saturdays". `block` rules (lunch) are handled separately
 * by the candidate generator.
 */
export function resolveAvailability(
  provider: Provider,
  date: string,
  rules: AvailabilityRule[],
): DayAvailability {
  const wd = weekdayOf(`${date}T00:00:00`);

  // A specific-date time-off wins outright — the provider is out that day,
  // regardless of their recurring schedule.
  if (providerTimeOff(provider.id, date, rules)) {
    return { works: false, hours: provider.hours };
  }

  const relevant = rules
    .filter((r) => r.providerId === provider.id && (r.kind === "workday" || r.kind === "dayoff") && r.weekday === wd)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  let works = provider.workdays.includes(wd);
  let hours = provider.hours;

  const top = relevant[0];
  if (top) {
    works = top.kind === "workday";
    if (top.kind === "workday" && top.start && top.end) {
      hours = { start: top.start, end: top.end };
    }
  }
  return { works, hours };
}
