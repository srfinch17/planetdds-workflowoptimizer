import type { AvailabilityRule, Provider } from "../types";
import { weekdayOf } from "../time";

export interface DayAvailability {
  works: boolean;
  hours: { start: string; end: string };
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
