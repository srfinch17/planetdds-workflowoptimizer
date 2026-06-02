import { useMemo, useState } from 'react'
import type { Appointment, Provider, AvailabilityRule } from '../api'
import { worksOn, officeClosure } from '../availability'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
// Color slot per dentist, by their order in the roster.
const PALETTE = ['a', 'b', 'c', 'a', 'b', 'c']

function ym(date: string): string {
  return date.slice(0, 7)
}
function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function compactTime(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(':').map(Number)
  const ap = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${ap}` : `${h12}:${pad(m)}${ap}`
}

export interface MonthCalendarProps {
  appointments: Appointment[]
  providers: Provider[]
  rules: AvailabilityRule[]
  selectedDate?: string | null
  onSelectDate?: (date: string) => void
  initialMonth?: string // "YYYY-MM"
  minMonth?: string
  maxMonth?: string
  today?: string
  recommendedDays?: Set<string>
}

/**
 * A navigable month grid (iPhone/Google-calendar style). Existing appointments
 * appear as color-coded chips (one color per dentist); a day with any working
 * provider is clickable to drill in and book. Pure presentational — the parent
 * owns the selected date + supplies the data.
 */
export function MonthCalendar({
  appointments,
  providers,
  rules,
  selectedDate,
  onSelectDate,
  initialMonth,
  minMonth,
  maxMonth,
  today,
  recommendedDays,
}: MonthCalendarProps) {
  const [month, setMonth] = useState(() => {
    let m = initialMonth ?? selectedDate?.slice(0, 7) ?? today?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)
    if (minMonth && m < minMonth) m = minMonth // never open in the past
    if (maxMonth && m > maxMonth) m = maxMonth
    return m
  })

  const colorOf = (providerId: string) => {
    const idx = providers.findIndex((p) => p.id === providerId)
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length]
  }

  // Group this month's appointments by day, sorted by time.
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (ym(a.start) !== month) continue
      const key = a.start.slice(0, 10)
      const list = map.get(key)
      if (list) list.push(a)
      else map.set(key, [a])
    }
    for (const list of map.values()) list.sort((x, y) => x.start.localeCompare(y.start))
    return map
  }, [appointments, month])

  const worksThatDay = (date: string): boolean =>
    !officeClosure(date, rules) && providers.some((p) => worksOn(p, date, rules).works)

  const [yy, mm] = month.split('-').map(Number)
  const first = new Date(yy, mm - 1, 1)
  const leading = first.getDay()
  const daysInMonth = new Date(yy, mm, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < leading; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${yy}-${pad(mm)}-${pad(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)

  const shift = (delta: number) => {
    const next = new Date(yy, mm - 1 + delta, 1)
    setMonth(`${next.getFullYear()}-${pad(next.getMonth() + 1)}`)
  }
  const canPrev = !minMonth || month > minMonth
  const canNext = !maxMonth || month < maxMonth

  return (
    <div className="month-cal">
      <div className="month-cal__head">
        <button className="btn btn--sm" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month">
          ‹
        </button>
        <span className="month-cal__title">
          {MONTHS[mm - 1]} {yy}
        </span>
        <button className="btn btn--sm" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month">
          ›
        </button>
        <span className="month-cal__legend">
          {providers.map((p) => (
            <span key={p.id} className={`mc-key mc-key--${colorOf(p.id)}`}>
              {p.name.split(/\s+/).pop()}
            </span>
          ))}
        </span>
      </div>

      <div className="month-cal__dow">
        {DOW.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div className="month-cal__grid">
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="mc-cell mc-cell--pad" />
          const appts = byDay.get(date) ?? []
          const open = worksThatDay(date)
          const classes = ['mc-cell']
          if (!open) classes.push('mc-cell--off')
          if (date === today) classes.push('mc-cell--today')
          if (date === selectedDate) classes.push('mc-cell--selected')
          if (recommendedDays?.has(date)) classes.push('mc-cell--rec')
          const clickable = open && !!onSelectDate
          return (
            <button
              key={i}
              className={classes.join(' ')}
              disabled={!clickable}
              onClick={clickable ? () => onSelectDate!(date) : undefined}
              title={open ? `${appts.length} booked · click to view ${date}` : 'closed'}
            >
              <span className="mc-num">{Number(date.slice(8))}</span>
              <span className="mc-events">
                {appts.slice(0, 3).map((a) => (
                  <span key={a.id} className={`mc-ev mc-ev--${colorOf(a.providerId)}`}>
                    {compactTime(a.start)} {a.type}
                  </span>
                ))}
                {appts.length > 3 && <span className="mc-more">+{appts.length - 3} more</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
