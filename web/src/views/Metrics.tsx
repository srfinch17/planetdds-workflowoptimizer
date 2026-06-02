import { useCallback, useEffect, useState } from 'react'
import { getState, getMetrics, type StateResponse, type MetricsResponse } from '../api'
import { Dashboard } from '../components/Dashboard'
import { LogPanel } from '../components/LogPanel'
import { todayISO } from '../today'

// Utilization is shown for the real current day.
const UTIL_DAY = todayISO()

/**
 * Metrics Dashboard: the cost/efficiency story + the activity/audit log. Read-only
 * — the operational controls live on the Admin tab.
 */
export function Metrics() {
  const [state, setState] = useState<StateResponse | null>(null)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([getState(), getMetrics()])
      .then(([s, m]) => {
        setState(s)
        setMetrics(m)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return (
    <div className="calendar-panel">
      <div className="calendar-toolbar">
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {state && metrics && <Dashboard metrics={metrics} state={state} day={UTIL_DAY} />}

      <LogPanel />
    </div>
  )
}
