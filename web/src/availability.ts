import type { Provider, AvailabilityRule, Weekday } from './api'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
