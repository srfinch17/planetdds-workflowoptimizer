import { useCallback, useEffect, useState } from 'react'
import { getState, type StateResponse } from '../api'
import { Calendar } from '../components/Calendar'

// The seed calendar has its appointments on this Thursday — a sensible default
// so the grid opens with something to look at.
const DEFAULT_DAY = '2026-06-04'

/**
 * Admin Dashboard. For Floor 3 this is the live calendar (the operational
 * picture); Floor 4 adds the cost/efficiency metric tiles above it. It owns its
 * own data fetch so "book on Intake, come here, see it" works by re-reading
 * live server state.
 */
export function Admin() {
  const [day, setDay] = useState(DEFAULT_DAY)
  const [state, setState] = useState<StateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    getState()
      .then((s) => {
        setState(s)
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
        <div className="calendar-legend">
          <span>
            <span className="legend-swatch" style={{ background: '#dbe7fb', border: '1px solid #bdd2f5' }} />
            booked
          </span>
          <span>
            <span className="legend-swatch" style={{ background: '#eceff4', border: '1px solid #dde3ec' }} />
            blocked (lunch / off)
          </span>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {state && (
        <Calendar providers={state.providers} appointments={state.appointments} rules={state.rules} day={day} />
      )}
    </div>
  )
}
