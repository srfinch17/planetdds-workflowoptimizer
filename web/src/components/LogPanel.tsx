import { useCallback, useEffect, useState } from 'react'
import {
  getLogs,
  getLogStats,
  replayLog,
  resetLogs,
  LOG_EXPORT_JSON,
  LOG_EXPORT_CSV,
  type LogEvent,
  type LogStats,
  type EventType,
  type ReplayResult,
} from '../api'

const TYPE_FILTERS: { label: string; value: EventType | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Requests', value: 'schedule_request' },
  { label: 'Bookings', value: 'booking' },
  { label: 'Escalations', value: 'escalation' },
  { label: 'Rules', value: 'rule_added' },
  { label: 'Errors', value: 'error' },
]

const TYPE_LABEL: Record<string, string> = {
  schedule_request: 'request',
  booking: 'booking',
  escalation: 'escalation',
  rule_added: 'rule',
  error: 'error',
}

/**
 * Observability panel: live activity feed + an at-a-glance activity chart, with
 * export, a destructive "clear", and a per-request "replay" (re-runs a logged
 * request through current code and reports whether the result changed).
 */
export function LogPanel() {
  const [events, setEvents] = useState<LogEvent[]>([])
  const [stats, setStats] = useState<LogStats | null>(null)
  const [filter, setFilter] = useState<EventType | 'all'>('all')
  const [replay, setReplay] = useState<ReplayResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([getLogs(filter === 'all' ? undefined : filter, 100), getLogStats()])
      .then(([l, s]) => {
        setEvents(l.events)
        setStats(s)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  async function onReplay(id: string) {
    try {
      setReplay(await replayLog(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onClear() {
    if (!window.confirm('Clear the entire event log? This cannot be undone.')) return
    await resetLogs()
    setReplay(null)
    load()
  }

  const maxMinute = Math.max(1, ...(stats?.perMinute.map((p) => p.count) ?? [1]))

  return (
    <section className="card logpanel">
      <div className="logpanel__head">
        <span className="field-label">📡 Activity &amp; audit log</span>
        <div className="logpanel__actions">
          <button className="btn btn--sm" onClick={load}>
            Refresh
          </button>
          <a className="btn btn--sm" href={LOG_EXPORT_JSON} download>
            Export JSON
          </a>
          <a className="btn btn--sm" href={LOG_EXPORT_CSV} download>
            Export CSV
          </a>
          <button className="btn btn--sm btn--danger" onClick={onClear}>
            Clear logs
          </button>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {stats && (
        <div className="log-stats">
          <div className="log-chart" aria-label="schedule requests per minute">
            {stats.perMinute.length === 0 ? (
              <span className="tile-sub">No requests logged yet.</span>
            ) : (
              stats.perMinute.map((p) => (
                <div key={p.t} className="log-bar" title={`${p.t} — ${p.count}`}>
                  <div className="log-bar__fill" style={{ height: `${(p.count / maxMinute) * 100}%` }} />
                  <span className="log-bar__label">{p.t.slice(11)}</span>
                </div>
              ))
            )}
          </div>
          <div className="log-totals">
            <span className="pill">requests {stats.byType.schedule_request ?? 0}</span>
            <span className="pill pill--good">booked {stats.bookings.booked}</span>
            <span className="pill">rescheduled {stats.bookings.rescheduled}</span>
            <span className="pill">cancelled {stats.bookings.cancelled}</span>
            <span className="pill pill--warn">conflicts {stats.bookings.conflict}</span>
            <span className="pill pill--bad">emergencies {stats.escalations.emergency}</span>
            <span className="pill pill--warn">callbacks {stats.escalations.callback}</span>
            <span className="pill">rules {stats.byType.rule_added ?? 0}</span>
            <span className="pill pill--bad">errors {stats.errors}</span>
          </div>
        </div>
      )}

      <div className="log-filters">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            className={`chip chip--clickable ${filter === f.value ? 'chip--active' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {replay && (
        <div className={`banner ${replay.changed ? 'banner--error' : ''} replay-result`}>
          <strong>Replay:</strong> “{replay.request}” →{' '}
          {replay.changed ? '⚠ result CHANGED vs the logged run' : '✓ identical to the logged run'}
          <button className="btn btn--sm" onClick={() => setReplay(null)}>
            dismiss
          </button>
        </div>
      )}

      <ul className="log-list">
        {events.length === 0 && <li className="tile-sub">No events yet.</li>}
        {events.map((e) => (
          <li key={e.id} className={`log-row log-row--${e.type}`}>
            <span className="log-time">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="log-type">{TYPE_LABEL[e.type] ?? e.type}</span>
            <span className="log-summary">{summarize(e)}</span>
            {e.type === 'schedule_request' && (
              <button className="btn btn--sm" onClick={() => onReplay(e.id)}>
                replay
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function summarize(e: LogEvent): string {
  const d = e.data
  switch (e.type) {
    case 'schedule_request':
      return `"${d.request}" · ${d.path} · ${d.slotCount} slots${
        d.escalationLevel && d.escalationLevel !== 'none' ? ` · ${d.escalationLevel}` : ''
      }`
    case 'booking': {
      const t = `${d.providerId} @ ${String(d.start).slice(11, 16)} (${d.patientId})`
      if (d.outcome === 'conflict') return `conflict: ${d.providerId} @ ${String(d.start).slice(11, 16)}`
      if (d.outcome === 'cancelled') return `cancelled · ${t}`
      if (d.outcome === 'rescheduled') return `rescheduled → ${t}`
      return `booked · ${t}`
    }
    case 'escalation':
      return `${d.level} — "${d.matched}"`
    case 'rule_added':
      return d.outcome === 'rejected' ? `rejected: "${d.sentence}"` : `added: "${d.sentence}"`
    case 'error':
      return String(d.message ?? 'error')
    default:
      return ''
  }
}
