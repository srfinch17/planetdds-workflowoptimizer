import { useCallback, useEffect, useState } from 'react'
import {
  postSchedule,
  getState,
  getMetrics,
  postBook,
  fmtWeekday,
  fmtDate,
  fmtTime,
  type ScheduleResponse,
  type ScoredSlot,
  type Provider,
  type Appointment,
  type AvailabilityRule,
  type ExtractionMode,
} from '../api'
import { Calendar } from '../components/Calendar'
import { MonthCalendar } from '../components/MonthCalendar'

// One-click example requests. The Dr. Smith one shows the "your dentist vs.
// alternatives" grouping; the last one trips the emergency escalation.
const EXAMPLES = [
  'Can I come in next Thursday after 3?',
  'I usually see Dr. Smith — anything next week?',
  'squeeze me in soon — mornings ideally, but nothing too early',
  'a cleaning in about six months, mornings preferred',
  'my tooth is killing me, can I come in this evening?',
]

const MODES: { value: ExtractionMode; label: string; help: string }[] = [
  { value: 'tiered', label: 'Auto', help: 'Rules first; the LLM handles only what the rules can’t.' },
  { value: 'llm', label: 'LLM only', help: 'Force the LLM to extract every request (pure AI).' },
  { value: 'rules', label: 'Rules only', help: 'Never call the LLM — deterministic parser only.' },
]

// The seed calendar has data around early June 2026, and chrono reads "next
// Thursday" relative to this date. Pinning it keeps results reproducible.
const DEFAULT_REF_DATE = '2026-05-31'
const TODAY = '2026-06-01'
const MIN_MONTH = '2026-06'
const MAX_MONTH = '2027-06'

export function Intake() {
  const [request, setRequest] = useState(EXAMPLES[0])
  const [refDate, setRefDate] = useState(DEFAULT_REF_DATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScheduleResponse | null>(null)

  const [providers, setProviders] = useState<Provider[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [rules, setRules] = useState<AvailabilityRule[]>([])
  const [patientName, setPatientName] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [booked, setBooked] = useState<Record<string, string>>({}) // slotKey → confirmation #
  const [viewDay, setViewDay] = useState<string | null>(null) // day shown in the detail grid
  const [mode, setMode] = useState<ExtractionMode>('tiered') // engine: Auto / LLM only / Rules only
  const [online, setOnline] = useState(true) // is the LLM reachable (key present)?

  const loadState = useCallback(() => {
    Promise.all([getState(), getMetrics()])
      .then(([s, m]) => {
        setProviders(s.providers)
        setAppointments(s.appointments)
        setRules(s.rules)
        setOnline(m.online)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  const slotKey = (s: ScoredSlot) => `${s.slot.providerId}@${s.slot.start}`

  async function findAppointments() {
    setLoading(true)
    setError(null)
    setResult(null)
    setBooked({})
    try {
      const res = await postSchedule(request.trim(), refDate || undefined, mode)
      setResult(res)
      setViewDay(res.recommendation.slots[0]?.slot.start.slice(0, 10) ?? res.intent.earliestDate ?? TODAY)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const canBook = patientName.trim().length > 0 && patientPhone.trim().length > 0

  async function book(s: ScoredSlot) {
    if (!canBook) return
    try {
      const res = await postBook(s.slot, { name: patientName.trim(), phone: patientPhone.trim() }, result?.requestId)
      setBooked((b) => ({ ...b, [slotKey(s)]: res.confirmationNumber }))
      loadState()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const slots = result?.recommendation.slots ?? []
  const rankOf = new Map(slots.map((s, i) => [slotKey(s), i + 1]))
  const slotByKey = new Map(slots.map((s) => [slotKey(s), s]))

  // Split into "your dentist" vs alternatives when a provider was requested.
  const pref = result?.recommendation.preferredProviderId ?? null
  const mine = pref ? slots.filter((s) => s.slot.providerId === pref) : []
  const others = pref ? slots.filter((s) => s.slot.providerId !== pref) : slots

  const calendarDay = slots[0]?.slot.start.slice(0, 10) ?? result?.intent.earliestDate ?? TODAY
  const dayShown = viewDay ?? calendarDay
  const highlights = new Set(slots.map(slotKey))
  const recommendedDays = new Set(slots.map((s) => s.slot.start.slice(0, 10)))
  const bookedKeys = new Set(Object.keys(booked).filter((k) => booked[k]))

  const renderCard = (s: ScoredSlot) => (
    <SlotCard
      key={slotKey(s)}
      rank={rankOf.get(slotKey(s)) ?? 0}
      slot={s}
      providerName={providerName(s.slot.providerId)}
      isPreferred={!!pref && s.slot.providerId === pref}
      confirmation={booked[slotKey(s)]}
      canBook={canBook}
      onBook={() => book(s)}
    />
  )

  return (
    <div className="intake">
      <section className="card request-card">
        <label className="field-label" htmlFor="request">
          💬 Patient request
        </label>
        <textarea
          id="request"
          className="request-input"
          rows={2}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Can I come in next Thursday after 3?"
        />

        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip chip--clickable" onClick={() => setRequest(ex)}>
              {ex}
            </button>
          ))}
        </div>

        <div className="engine-row">
          <span className="engine-label">🤖 Engine</span>
          <div className="engine-toggle">
            {MODES.map((m) => {
              const disabled = m.value === 'llm' && !online
              return (
                <button
                  key={m.value}
                  className={`engine-opt ${mode === m.value ? 'engine-opt--active' : ''}`}
                  onClick={() => setMode(m.value)}
                  disabled={disabled}
                  title={disabled ? 'No API key on the server — LLM-only is unavailable offline.' : m.help}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
          {!online && <span className="tile-sub">server offline — LLM unavailable</span>}
        </div>

        <div className="request-actions">
          <label className="ref-date">
            Reference date
            <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </label>
          <button
            className="btn btn--primary"
            onClick={findAppointments}
            disabled={loading || !request.trim()}
          >
            {loading ? 'Finding…' : '🔍 Find appointments'}
          </button>
        </div>
      </section>

      {error && <div className="banner banner--error">{error}</div>}

      {result && result.escalation.level !== 'none' && (
        <section className={`escalation escalation--${result.escalation.level}`} role="alert">
          <div className="escalation__title">
            {result.escalation.level === 'emergency' ? '🚨' : '⚠️'} {result.escalation.headline}
          </div>
          <p className="escalation__msg">{result.escalation.message}</p>
          <div className="escalation__tag">
            📞 Flagged for staff callback
            {result.escalation.matched ? ` · detected “${result.escalation.matched}”` : ''}
          </div>
        </section>
      )}

      {result && (
        <>
          <IntentSummary result={result} providerName={providerName} />

          <section className="results">
            <div className="results-head">
              <h3>{result.recommendation.bestEffort ? '🧭 Closest available' : '✨ Recommendations'}</h3>
              {result.recommendation.bestEffort && (
                <span className="banner-inline banner-inline--warn">
                  No slot fully matched the requested time — showing the closest we honestly could.
                </span>
              )}
            </div>

            {slots.length === 0 ? (
              <div className="banner">No bookable slots for this request.</div>
            ) : pref ? (
              <>
                <div className="rec-group">
                  <div className="rec-group__head">
                    <span className="rec-group__title">
                      🦷 Your dentist — <strong>{providerName(pref)}</strong>
                    </span>
                  </div>
                  {mine.length === 0 ? (
                    <p className="rec-empty">
                      {providerName(pref)} has no matching availability — see the alternatives below.
                    </p>
                  ) : (
                    <div className="slot-grid">{mine.map(renderCard)}</div>
                  )}
                </div>

                {others.length > 0 && (
                  <div className="rec-group">
                    <div className="rec-group__head">
                      <span className="rec-group__title">🔄 Other available dentists</span>
                    </div>
                    <div className="slot-grid">{others.map(renderCard)}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="slot-grid">{others.map(renderCard)}</div>
            )}
          </section>

          <div className="patient-row">
            <span className="tile-sub">Your details (to confirm the booking):</span>
            <label>
              👤
              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Full name"
              />
            </label>
            <label>
              📞
              <input
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                placeholder="Phone"
              />
            </label>
          </div>

          {providers.length > 0 && (
            <section className="calendar-panel">
              <span className="field-label">🗓️ Where these land — pick a day to view</span>
              <MonthCalendar
                appointments={appointments}
                providers={providers}
                rules={rules}
                selectedDate={dayShown}
                onSelectDate={setViewDay}
                initialMonth={calendarDay.slice(0, 7)}
                minMonth={MIN_MONTH}
                maxMonth={MAX_MONTH}
                today={TODAY}
                recommendedDays={recommendedDays}
              />
              <span className="field-label">📆 {dayShown} — click a ★ slot to book</span>
              <Calendar
                providers={providers}
                appointments={appointments}
                rules={rules}
                day={dayShown}
                highlights={highlights}
                bookedKeys={bookedKeys}
                onBookSlot={(key) => {
                  const s = slotByKey.get(key)
                  if (s) book(s)
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}

function IntentSummary({
  result,
  providerName,
}: {
  result: ScheduleResponse
  providerName: (id: string) => string
}) {
  const { intent, pathTaken } = result
  const chips: { label: string; tone?: string }[] = []

  chips.push({ label: `urgency: ${intent.urgency}`, tone: intent.urgency === 'urgent' ? 'bad' : undefined })
  if (intent.appointmentType) chips.push({ label: `type: ${intent.appointmentType}` })
  if (intent.earliestDate)
    chips.push({
      label:
        intent.latestDate && intent.latestDate !== intent.earliestDate
          ? `${intent.earliestDate} → ${intent.latestDate}`
          : `on ${intent.earliestDate}`,
    })
  if (intent.daysOfWeek.length) chips.push({ label: intent.daysOfWeek.join(', ') })
  if (intent.partOfDay) chips.push({ label: intent.partOfDay })
  if (intent.timeEarliest) chips.push({ label: `after ${intent.timeEarliest}` })
  if (intent.timeLatest) chips.push({ label: `before ${intent.timeLatest}` })
  if (intent.preferredProviderId)
    chips.push({ label: `prefers ${providerName(intent.preferredProviderId)}` })

  const pathHelp =
    pathTaken === 'rules'
      ? 'Resolved by the deterministic rule parser — no API call, $0.'
      : pathTaken === 'llm'
        ? 'Escalated to the LLM because the rule parser was not confident.'
        : 'Resolved on the offline fallback path.'

  return (
    <section className="card intent-card">
      <div className="intent-head">
        <span className="field-label">🧠 Understood as</span>
        {pathTaken === 'llm' && (
          <span className="ai-badge" title="The LLM (Claude) parsed this free-text request into structured intent.">
            🤖 Extracted by Claude
          </span>
        )}
        <div className="intent-meta">
          <span className={`pill pill--${pathTaken === 'rules' ? 'good' : 'brand'}`} title={pathHelp}>
            path: {pathTaken ?? 'n/a'}
          </span>
          <span className="pill" title="Which agent produced this intent.">
            source: {intent.source}
          </span>
          <span className="pill" title="How sure the parser is about the extracted intent.">
            confidence: {(intent.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="chips">
        {chips.map((c) => (
          <span key={c.label} className={`chip ${c.tone ? `chip--${c.tone}` : ''}`}>
            {c.label}
          </span>
        ))}
      </div>
    </section>
  )
}

function SlotCard({
  rank,
  slot,
  providerName,
  isPreferred,
  confirmation,
  canBook,
  onBook,
}: {
  rank: number
  slot: ScoredSlot
  providerName: string
  isPreferred: boolean
  confirmation?: string
  canBook: boolean
  onBook: () => void
}) {
  const booked = !!confirmation
  const matched = slot.factors.filter((f) => f.matched && f.contribution > 0)
  return (
    <article className="card slot-card">
      <div className="slot-card__head">
        <span className="slot-rank" title="Recommendation rank (1 = best fit)">
          #{rank}
        </span>
        <span
          className="slot-score"
          title="Match score 0–100: how well this time fits the request. It's the sum of the points listed below."
        >
          ⭐ {slot.score}
        </span>
      </div>
      <div className="slot-when">
        <strong>
          <span className="ico">📅</span>
          {fmtWeekday(slot.slot.start)} {fmtDate(slot.slot.start)}
        </strong>
        <span>
          <span className="ico">🕐</span>
          {fmtTime(slot.slot.start)}
        </span>
      </div>
      <div className="slot-who">
        <span className="ico">🦷</span>
        {providerName}
        {isPreferred ? ' · your dentist' : ''} · {slot.slot.type}
      </div>

      <p className="slot-explanation">{slot.explanation}</p>

      <ul className="factor-list">
        {matched.map((f) => (
          <li key={f.name}>
            <span className="factor-name">✓ {f.detail}</span>
            <span className="factor-points" title="Points this factor added to the score">
              +{f.contribution}
            </span>
          </li>
        ))}
      </ul>

      <button className="btn btn--book" onClick={onBook} disabled={booked || !canBook}>
        {booked ? `✓ Booked · ${confirmation}` : '📌 Book this slot'}
      </button>
    </article>
  )
}
