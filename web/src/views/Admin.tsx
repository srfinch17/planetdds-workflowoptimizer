import { useCallback, useEffect, useState } from 'react'
import {
  getState,
  getCallbacks,
  resetSystem,
  type StateResponse,
  type CallbackRecord,
} from '../api'
import { Calendar } from '../components/Calendar'
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
          <span className="field-label">📆 {day} — day detail</span>
          <Calendar providers={state.providers} appointments={state.appointments} rules={state.rules} day={day} />
        </section>
      )}

      <RuleTeacher onApplied={reload} />

      {state && <RulesList providers={state.providers} rules={state.rules} onChange={reload} />}
    </div>
  )
}
