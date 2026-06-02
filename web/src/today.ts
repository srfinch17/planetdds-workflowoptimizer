// Single source of truth for "now" in the UI. The app always treats the real
// system date as today — seed data that has slipped into the past just shows as
// past; future availability still comes from each provider's working rules.
//
// Dates are built from LOCAL calendar fields (not toISOString, which is UTC and
// can land a day off near midnight) so "today" matches the user's wall clock.

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Real current date as "YYYY-MM-DD". */
export function todayISO(): string {
  return fmt(new Date())
}

/** Current month as "YYYY-MM". */
export function thisMonth(): string {
  return todayISO().slice(0, 7)
}

/** The month `n` months from now as "YYYY-MM" (the calendar's forward horizon). */
export function monthsAhead(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  return fmt(d).slice(0, 7)
}
