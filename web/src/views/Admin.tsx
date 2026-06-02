import { useCallback, useEffect, useState } from 'react'
import {
  getState,
  getMetrics,
  getCallbacks,
  resetSystem,
  type StateResponse,
  type MetricsResponse,
  type CallbackRecord,
} from '../api'
import { Calendar } from '../components/Calendar'
import { MonthCalendar } from '../components/MonthCalendar'
import { Dashboard } from '../components/Dashboard'
import { RuleTeacher } from '../components/RuleTeacher'
import { RulesList } from '../components/RulesList'
import { CallbackQueue } from '../components/CallbackQueue'
import { LogPanel } from '../components/LogPanel'

// The seed calendar has its appointments on this Thursday — a sensible default
// so the grid opens with something to look at.
const DEFAULT_DAY = '2026-06-04'
const TODAY = '2026-06-01'
const MIN_MONTH = '2026-06'
const MAX_MONTH = '2027-06'

/**
 * Admin Dashboard. For Floor 3 this is the live calendar (the operational
 * picture); Floor 4 adds the cost/efficiency metric tiles above it. It owns its
 * own data fetch so "book on Intake, come here, see it" works by re-reading
 * live server state.
 */
export function Admin() {
  const [day, setDay] = useState(DEFAULT_DAY)
  const [state, setState] = useState<StateResponse | null>(null)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([getState(), getMetrics(), getCallbacks()])
      .then(([s, m, cb]) => {
        setState(s)
        setMetrics(m)
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

      {state && metrics && <Dashboard metrics={metrics} state={state} day={day} />}

      <CallbackQueue callbacks={callbacks} />

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

      <LogPanel />
    </div>
  )
}
