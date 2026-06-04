import { type MetricsResponse, type StateResponse, type Weekday } from '../api'

// Stated assumption, shown honestly on the tile: a front-desk human eyeballing
// the calendar and trading messages takes on the order of a few minutes per
// request. We use 3 minutes as the manual baseline for the speed comparison.
const MANUAL_BASELINE_MS = 180_000

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
function weekdayOf(day: string): Weekday {
  return WEEKDAYS[new Date(`${day}T12:00:00`).getDay()] as Weekday
}

function Donut({ pct }: { pct: number }) {
  const r = 42
  const c = 2 * Math.PI * r
  const free = Math.max(0, Math.min(100, pct))
  const dash = (free / 100) * c
  return (
    <svg viewBox="0 0 110 110" className="donut" role="img" aria-label={`${free}% handled free`}>
      <circle cx="55" cy="55" r={r} className="donut-track" />
      <circle
        cx="55"
        cy="55"
        r={r}
        className="donut-value"
        strokeDasharray={`${dash} ${c - dash}`}
        transform="rotate(-90 55 55)"
      />
      <text x="55" y="52" className="donut-num">
        {free}%
      </text>
      <text x="55" y="69" className="donut-label">
        free
      </text>
    </svg>
  )
}

interface Util {
  name: string
  role: string
  pct: number
  booked: number
  available: number
  off: boolean
}

function utilization(state: StateResponse, day: string): Util[] {
  const wd = weekdayOf(day)
  return state.providers.map((p) => {
    const off =
      !p.workdays.includes(wd) ||
      state.rules.some((r) => r.providerId === p.id && r.kind === 'dayoff' && r.weekday === wd) ||
      // one-time absences: a provider time-off or an office-wide closure on this day
      state.rules.some(
        (r) =>
          ((r.kind === 'timeoff' && r.providerId === p.id) || r.kind === 'closure') &&
          !!r.startDate &&
          !!r.endDate &&
          day >= r.startDate &&
          day <= r.endDate,
      )
    if (off) return { name: p.name, role: p.role, pct: 0, booked: 0, available: 0, off: true }
    const open = toMin(p.hours.start)
    const close = toMin(p.hours.end)
    const lunch = state.rules
      .filter((r) => r.providerId === p.id && r.kind === 'block' && r.start && r.end)
      .reduce((s, r) => s + (toMin(r.end!) - toMin(r.start!)), 0)
    const available = close - open - lunch
    const booked = state.appointments
      .filter((a) => a.providerId === p.id && a.start.slice(0, 10) === day)
      .reduce((s, a) => s + (toMin(a.end.slice(11, 16)) - toMin(a.start.slice(11, 16))), 0)
    return {
      name: p.name,
      role: p.role,
      pct: available > 0 ? Math.round((booked / available) * 100) : 0,
      booked,
      available,
      off: false,
    }
  })
}

export function Dashboard({
  metrics,
  state,
  day,
}: {
  metrics: MetricsResponse
  state: StateResponse
  day: string
}) {
  const speedup =
    metrics.avgLatencyMs > 0 ? Math.round(MANUAL_BASELINE_MS / metrics.avgLatencyMs) : null
  const utils = utilization(state, day)

  return (
    <div className="dash">
      <div className="dash-tiles">
        <div className="card tile tile--donut">
          <span className="tile-label">📡 Handled without an API call</span>
          <Donut pct={metrics.freeSharePct} />
          <span className="tile-sub">
            {metrics.freeHandled} of {metrics.requestsServed} requests · {metrics.apiCalls} LLM call
            {metrics.apiCalls === 1 ? '' : 's'}
          </span>
        </div>

        <div className="card tile">
          <span className="tile-label">💸 Est. cost / 1,000 requests</span>
          <span className="tile-big">${metrics.costPer1000Usd.toFixed(2)}</span>
          <span className="tile-sub">at the current mix · ${metrics.estimatedUsd.toFixed(4)} spent so far</span>
        </div>

        <div className="card tile">
          <span className="tile-label">⚡ Avg time to recommend</span>
          <span className="tile-big">
            {metrics.avgLatencyMs > 0 ? `${metrics.avgLatencyMs} ms` : '—'}
          </span>
          <span className="tile-sub">
            {speedup ? `≈ ${speedup}× faster than ~3 min by hand` : 'vs ~3 min by hand'}
          </span>
        </div>

        <div className="card tile">
          <span className="tile-label">📈 Requests served</span>
          <span className="tile-big">{metrics.requestsServed}</span>
          <span className="tile-sub">this session</span>
        </div>
      </div>

      <div className="card util">
        <span className="tile-label">🦷 Provider utilization · {day}</span>
        <div className="util-rows">
          {utils.map((u, i) => {
            const color = ['a', 'b', 'c'][i % 3]
            return (
              <div key={u.name} className="util-row">
                <div className="util-name">
                  <span className={`util-dot util-dot--${color}`} />
                  {u.name} <small>{u.role}</small>
                </div>
                <div className="util-bar">
                  <div
                    className={`util-bar__fill util-bar__fill--${color}`}
                    style={{ width: `${Math.min(100, u.pct)}%` }}
                  />
                </div>
                <div className="util-val">{u.off ? 'off' : `${u.pct}%`}</div>
              </div>
            )
          })}
        </div>
        <span className="tile-sub">booked minutes ÷ available minutes (working hours minus lunch)</span>
      </div>
    </div>
  )
}
