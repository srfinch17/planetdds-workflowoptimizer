import { fmtTime, type Provider, type Appointment, type AvailabilityRule } from '../api'
import { worksOn, officeClosure } from '../availability'

// The grid window: clinic-wide open/close in 30-minute rows. Per-provider hours
// inside this window are shaded "closed" so the grid is honest about who's in.
const OPEN_MIN = 8 * 60 // 08:00
const CLOSE_MIN = 17 * 60 // 17:00
const STEP = 30
const ROWS = (CLOSE_MIN - OPEN_MIN) / STEP // 18 rows

// Color slot per dentist, by their order in the roster — the SAME mapping the
// month calendar uses, so a given doctor reads as one color across both views.
const PALETTE = ['a', 'b', 'c', 'a', 'b', 'c']
const colorAt = (idx: number) => PALETTE[idx % PALETTE.length]

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function isoToMin(iso: string): number {
  return hhmmToMin(iso.slice(11, 16))
}
// Grid line for a given minute (clamped into the visible window). Row 1 is the
// header, so the first time slot starts at line 2.
function line(min: number): number {
  const clamped = Math.max(OPEN_MIN, Math.min(CLOSE_MIN, min))
  return 2 + Math.round((clamped - OPEN_MIN) / STEP)
}

export interface CalendarProps {
  providers: Provider[]
  appointments: Appointment[]
  rules: AvailabilityRule[]
  day: string // "YYYY-MM-DD"
  highlights?: Set<string> // `${providerId}@${startISO}` — recommended slots to light up
  bookedKeys?: Set<string> // recommended slots already booked (shown as ✓)
  onBookSlot?: (key: string) => void // when set, highlights become Book buttons
}

/**
 * A hand-rolled day grid: providers across the top, time down the side.
 * Everything is positioned by CSS grid line math — no calendar library, so it
 * can't surprise us live. Layers, back to front: background cells → closed/
 * day-off shading → rule blocks (lunch) → booked appointments → recommendation
 * highlights. It renders purely from props; the parent owns the data + refresh.
 */
export function Calendar({
  providers,
  appointments,
  rules,
  day,
  highlights,
  bookedKeys,
  onBookSlot,
}: CalendarProps) {
  const dayAppts = appointments.filter((a) => a.start.slice(0, 10) === day)
  const closed = officeClosure(day, rules)

  const timeLabels: string[] = []
  for (let i = 0; i < ROWS; i++) {
    const min = OPEN_MIN + i * STEP
    timeLabels.push(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`)
  }

  return (
    <div
      className="calendar"
      style={{
        gridTemplateColumns: `60px repeat(${providers.length}, minmax(110px, 1fr))`,
        gridTemplateRows: `34px repeat(${ROWS}, 26px)`,
      }}
    >
      <div className="cal-corner" />
      {providers.map((p, idx) => (
        <div key={p.id} className={`cal-head cal-head--${colorAt(idx)}`} style={{ gridColumn: 2 + idx, gridRow: 1 }}>
          {p.name}
          <small>{p.role}</small>
        </div>
      ))}

      {timeLabels.map((t, i) => (
        <div key={t} className="cal-time" style={{ gridColumn: 1, gridRow: 2 + i }}>
          {t}
        </div>
      ))}

      {providers.map((_, idx) =>
        timeLabels.map((_t, i) => (
          <div key={`bg-${idx}-${i}`} className={`cal-cell cal-cell--${colorAt(idx)}`} style={{ gridColumn: 2 + idx, gridRow: 2 + i }} />
        )),
      )}

      {providers.map((p, idx) => {
        const col = 2 + idx
        const av = worksOn(p, day, rules)
        if (closed || !av.works) {
          return (
            <div key={`off-${p.id}`} className="cal-block cal-block--off" style={{ gridColumn: col, gridRow: `2 / ${2 + ROWS}` }}>
              {closed ? '🔒 office closed' : 'day off'}
            </div>
          )
        }
        // Shade the hours this provider isn't in (within the clinic window).
        const open = hhmmToMin(av.hours.start)
        const close = hhmmToMin(av.hours.end)
        const shades = []
        if (open > OPEN_MIN) {
          shades.push(
            <div key={`pre-${p.id}`} className="cal-block cal-block--closed" style={{ gridColumn: col, gridRow: `2 / ${line(open)}` }} />,
          )
        }
        if (close < CLOSE_MIN) {
          shades.push(
            <div key={`post-${p.id}`} className="cal-block cal-block--closed" style={{ gridColumn: col, gridRow: `${line(close)} / ${2 + ROWS}` }} />,
          )
        }
        return shades
      })}

      {providers.map((p, idx) =>
        rules
          .filter((r) => r.providerId === p.id && r.kind === 'block' && r.start && r.end)
          .map((r) => (
            <div
              key={r.id}
              className="cal-block cal-block--rule"
              style={{ gridColumn: 2 + idx, gridRow: `${line(hhmmToMin(r.start!))} / ${line(hhmmToMin(r.end!))}` }}
            >
              {r.reason}
            </div>
          )),
      )}

      {dayAppts.map((a) => {
        const idx = providers.findIndex((p) => p.id === a.providerId)
        if (idx < 0) return null
        return (
          <div
            key={a.id}
            className="cal-block cal-block--appt"
            style={{ gridColumn: 2 + idx, gridRow: `${line(isoToMin(a.start))} / ${line(isoToMin(a.end))}` }}
          >
            <strong>{a.type}</strong>
            <small>{fmtTime(a.start)}</small>
          </div>
        )
      })}

      {highlights &&
        [...highlights].map((key) => {
          const at = key.lastIndexOf('@')
          const pid = key.slice(0, at)
          const start = key.slice(at + 1)
          if (start.slice(0, 10) !== day) return null
          const idx = providers.findIndex((p) => p.id === pid)
          if (idx < 0) return null
          const style = {
            gridColumn: 2 + idx,
            gridRow: `${line(isoToMin(start))} / ${line(isoToMin(start) + STEP)}`,
          }
          const isBooked = bookedKeys?.has(key) ?? false
          // When the parent passes onBookSlot, recommended slots are clickable
          // Book buttons; otherwise they're static highlights (e.g. on Admin).
          if (onBookSlot) {
            return (
              <button
                key={`hl-${key}`}
                className={`cal-block cal-block--hl${isBooked ? ' is-booked' : ''}`}
                style={style}
                disabled={isBooked}
                title={isBooked ? 'Booked' : 'Book this recommended slot'}
                onClick={() => onBookSlot(key)}
              >
                {isBooked ? '✓ booked' : '★ book'}
              </button>
            )
          }
          return (
            <div key={`hl-${key}`} className="cal-block cal-block--hl" style={style}>
              ★ recommended
            </div>
          )
        })}
    </div>
  )
}
