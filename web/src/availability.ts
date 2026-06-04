import type { Provider, AvailabilityRule, Weekday } from './api'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The office-wide closure covering a date, if any (overrides all providers). */
export function officeClosure(date: string, rules: AvailabilityRule[]): AvailabilityRule | undefined {
  return rules.find(
    (r) => r.kind === 'closure' && !!r.startDate && !!r.endDate && date >= r.startDate && date <= r.endDate,
  )
}

/** A one-time time-off (specific dates) for this provider, if any. */
export function providerTimeOff(
  providerId: string,
  date: string,
  rules: AvailabilityRule[],
): AvailabilityRule | undefined {
  return rules.find(
    (r) =>
      r.kind === 'timeoff' &&
      r.providerId === providerId &&
      !!r.startDate &&
      !!r.endDate &&
      date >= r.startDate &&
      date <= r.endDate,
  )
}

/**
 * Mirror of the server's resolveAvailability: base workdays/hours, with
 * workday/dayoff rules layered on top (newest createdAt wins). Keeps the
 * calendars in sync with how the backend actually schedules.
 */
export function worksOn(
  provider: Provider,
  date: string,
  rules: AvailabilityRule[],
): { works: boolean; hours: { start: string; end: string } } {
  const wd = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()] as Weekday
  // A specific-date time-off wins outright — out that day regardless of schedule.
  if (providerTimeOff(provider.id, date, rules)) return { works: false, hours: provider.hours }
  const relevant = rules
    .filter((r) => r.providerId === provider.id && (r.kind === 'workday' || r.kind === 'dayoff') && r.weekday === wd)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  let works = provider.workdays.includes(wd)
  let hours = provider.hours
  const top = relevant[0]
  if (top) {
    works = top.kind === 'workday'
    if (top.kind === 'workday' && top.start && top.end) hours = { start: top.start, end: top.end }
  }
  return { works, hours }
}
