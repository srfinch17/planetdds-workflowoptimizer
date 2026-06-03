import { useCallback, useEffect, useState } from 'react'
import {
  getState,
  getCallbacks,
  getAvailability,
  postBook,
  resetSystem,
  type StateResponse,
  type CallbackRecord,
  type CandidateSlot,
} from '../api'
import { Calendar } from '../components/Calendar'
import { BookSlotDialog } from '../components/BookSlotDialog'
import { MonthCalendar } from '../components/MonthCalendar'
import { RuleTeacher } from '../components/RuleTeacher'
import { RulesList } from '../components/RulesList'
import { CallbackQueue } from '../components/CallbackQueue'
import { RescheduleQueue } from '../components/RescheduleQueue'
import { todayISO, thisMonth, monthsAhead } from '../today'

// The calendar opens on the real today; month navigation runs from this month
// to a year out, so you can never land in the past.
const TODAY = todayISO()
const DEFAULT_DAY = TODAY
const MIN_MONTH = thisMonth()
const MAX_MONTH = monthsAhead(12)

/**
 * Admin Dashboard. For Floor 3 this is the live calendar (the operational
 * picture); Floor 4 adds the cost/efficiency metric tiles above it. It owns its
 * own data fetch so "book on Intake, come here, see it" works by re-reading
 * live server state.
 */
export function Admin() {
  const [day, setDay] = useState(DEFAULT_DAY)
  const [state, setState] = useState<StateResponse | null>(null)
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Admin-side booking: the open slots on the day grid are clickable so staff
  // can book a patient directly (e.g. while on a callback). The type drives
  // which openings are offered, so duration + eligibility stay correct.
  const [bookType, setBookType] = useState('cleaning')
  const [daySlots, setDaySlots] = useState<CandidateSlot[]>([]) // open slots for the shown day
  const [pending, setPending] = useState<CandidateSlot | null>(null) // slot being booked
  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)
  const [bookConfirm, setBookConfirm] = useState<string | null>(null) // transient "✓ Booked …"

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([getState(), getCallbacks()])
      .then(([s, cb]) => {
        setState(s)
        setCallbacks(cb.callbacks)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Re-read on mount (every time the tab is opened, since the inactive view
  // unmounts) so a booking made on Intake shows up here.
  useEffect(() => {
    reload()
  }, [reload])

  // Refresh the bookable open slots whenever the shown day or the chosen
  // appointment type changes (and once the schedule state is loaded).
  const loadDaySlots = useCallback(() => {
    getAvailability({ from: day, to: day, type: bookType })
      .then(({ slotsByDay }) => setDaySlots(slotsByDay[day] ?? []))
      .catch(() => setDaySlots([]))
  }, [day, bookType])

  useEffect(() => {
    if (state) loadDaySlots()
  }, [state, loadDaySlots])

  // The "✓ Booked" confirmation is a transient acknowledgement — clear it after
  // a few seconds so it doesn't linger as stale once staff move on.
  useEffect(() => {
    if (!bookConfirm) return
    const t = setTimeout(() => setBookConfirm(null), 5000)
    return () => clearTimeout(t)
  }, [bookConfirm])

  const providerName = (id: string) => state?.providers.find((p) => p.id === id)?.name ?? id

  // The open slots become bookable highlights on the grid, keyed provider@start.
  const openByKey = new Map(daySlots.map((s) => [`${s.providerId}@${s.start}`, s]))
  const openHighlights = new Set(openByKey.keys())

  async function confirmBooking(name: string, phone: string) {
    if (!pending) return
    setBooking(true)
    setBookError(null)
    try {
      const res = await postBook(pending, { name, phone: phone || undefined })
      setBookConfirm(`✓ Booked ${name} · ${res.confirmationNumber}`)
      setPending(null)
      reload() // new appointment shows as a booked block; loadDaySlots re-runs after
    } catch (e) {
      setBookError(e instanceof Error ? e.message : String(e))
    } finally {
      setBooking(false)
    }
  }

  return (
    <div className="calendar-panel">
      <div className="calendar-toolbar">
        <label>
          Day
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          className="btn btn--danger"
          onClick={async () => {
            if (!window.confirm('Reset everything to the default test data? Drops all runtime bookings, rules, logs, and callbacks.')) return
            await resetSystem()
            reload()
          }}
        >
          ↺ Reset to default
        </button>
        <div className="calendar-legend">
          <span>
            <span className="legend-swatch legend-swatch--appt" />
            booked
          </span>
          <span>
            <span className="legend-swatch legend-swatch--rule" />
            blocked (lunch / off)
          </span>
          <span>
            <span className="legend-swatch legend-swatch--open" />
            open · click to book
          </span>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <CallbackQueue callbacks={callbacks} />

      {state && <RescheduleQueue records={state.reschedule} providers={state.providers} patients={state.patients} />}

      {state && (
        <section className="calendar-panel">
          <span className="field-label">🗓️ Practice schedule — click a day to drill in</span>
          <MonthCalendar
            appointments={state.appointments}
            providers={state.providers}
            rules={state.rules}
            selectedDate={day}
            onSelectDate={setDay}
            initialMonth={day.slice(0, 7)}
            minMonth={MIN_MONTH}
            maxMonth={MAX_MONTH}
            today={TODAY}
          />
        </section>
      )}

      {state && (
        <section className="calendar-panel">
          <div className="daydetail-head">
            <span className="field-label">
              📆 {day} — day detail · <span className="field-label__cta">click an open slot to book</span>
            </span>
            <label className="book-type">
              <span>Booking</span>
              <select value={bookType} onChange={(e) => setBookType(e.target.value)}>
                {state.appointmentTypes.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.type} · {t.durationMin}m
                  </option>
                ))}
              </select>
            </label>
          </div>
          {bookConfirm && <div className="banner banner--ok">{bookConfirm}</div>}
          <Calendar
            providers={state.providers}
            appointments={state.appointments}
            rules={state.rules}
            day={day}
            highlights={openHighlights}
            onBookSlot={(key) => {
              const s = openByKey.get(key)
              if (s) {
                setBookError(null)
                setBookConfirm(null)
                setPending(s)
              }
            }}
          />
        </section>
      )}

      {pending && (
        <BookSlotDialog
          slot={pending}
          providerName={providerName(pending.providerId)}
          busy={booking}
          error={bookError}
          onCancel={() => {
            if (!booking) {
              setPending(null)
              setBookError(null)
            }
          }}
          onConfirm={confirmBooking}
        />
      )}

      <RuleTeacher onApplied={reload} />

      {state && <RulesList providers={state.providers} rules={state.rules} onChange={reload} />}
    </div>
  )
}
