import { useEffect, useState } from 'react'
import {
  postSchedule,
  getState,
  postBook,
  fmtWeekday,
  fmtDate,
  fmtTime,
  type ScheduleResponse,
  type ScoredSlot,
  type Provider,
  type Patient,
} from '../api'

// The three rehearsed demo requests, as one-click fillers.
const EXAMPLES = [
  'Can I come in next Thursday after 3?',
  "sometime next week, mornings are better but I'm flexible",
  'my tooth is killing me, can I come in this evening?',
]

// The seed calendar has data around early June 2026, and chrono reads "next
// Thursday" relative to this date. Pinning it keeps the live demo reproducible.
const DEFAULT_REF_DATE = '2026-05-31'

/**
 * Patient Intake: an unstructured request in, the top-3 explainable slots out.
 * Everything shown about a slot (score, factors, explanation) comes straight
 * from the backend — the UI never invents a reason.
 */
export function Intake() {
  const [request, setRequest] = useState(EXAMPLES[0])
  const [refDate, setRefDate] = useState(DEFAULT_REF_DATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScheduleResponse | null>(null)

  const [providers, setProviders] = useState<Provider[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState('')
  const [booked, setBooked] = useState<Record<string, boolean>>({})

  // Load reference data once so we can show provider names and a patient picker.
  useEffect(() => {
    getState()
      .then((s) => {
        setProviders(s.providers)
        setPatients(s.patients)
        if (s.patients[0]) setPatientId(s.patients[0].id)
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  const slotKey = (s: ScoredSlot) => `${s.slot.providerId}@${s.slot.start}`

  async function findAppointments() {
    setLoading(true)
    setError(null)
    setResult(null)
    setBooked({})
    try {
      const res = await postSchedule(request.trim(), refDate || undefined)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function book(s: ScoredSlot) {
    if (!patientId) return
    try {
      await postBook(s.slot, patientId)
      setBooked((b) => ({ ...b, [slotKey(s)]: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="intake">
      <section className="card request-card">
        <label className="field-label" htmlFor="request">
          Patient request
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

        <div className="request-actions">
          <label className="ref-date">
            Reference date
            <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </label>
          <button className="btn btn--primary" onClick={findAppointments} disabled={loading || !request.trim()}>
            {loading ? 'Finding…' : 'Find appointments'}
          </button>
        </div>
      </section>

      {error && <div className="banner banner--error">{error}</div>}

      {result && (
        <>
          <IntentSummary result={result} providerName={providerName} />

          <section className="results">
            <div className="results-head">
              <h3>{result.recommendation.bestEffort ? 'Closest available' : 'Top recommendations'}</h3>
              {result.recommendation.bestEffort && (
                <span className="banner-inline banner-inline--warn">
                  No slot fully matched the requested time — showing the closest we could do, honestly.
                </span>
              )}
            </div>

            {result.recommendation.slots.length === 0 ? (
              <div className="banner">No bookable slots for this request.</div>
            ) : (
              <div className="slot-grid">
                {result.recommendation.slots.map((s, i) => (
                  <SlotCard
                    key={slotKey(s)}
                    rank={i + 1}
                    slot={s}
                    providerName={providerName(s.slot.providerId)}
                    booked={!!booked[slotKey(s)]}
                    canBook={!!patientId}
                    onBook={() => book(s)}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="patient-row">
            <label>
              Booking as
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
  if (intent.preferredProviderId) chips.push({ label: `prefers ${providerName(intent.preferredProviderId)}` })

  return (
    <section className="card intent-card">
      <div className="intent-head">
        <span className="field-label">Understood as</span>
        <div className="intent-meta">
          <span className={`pill pill--${pathTaken === 'rules' ? 'good' : 'brand'}`}>
            path: {pathTaken ?? 'n/a'}
          </span>
          <span className="pill">source: {intent.source}</span>
          <span className="pill">confidence: {(intent.confidence * 100).toFixed(0)}%</span>
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
  booked,
  canBook,
  onBook,
}: {
  rank: number
  slot: ScoredSlot
  providerName: string
  booked: boolean
  canBook: boolean
  onBook: () => void
}) {
  const matched = slot.factors.filter((f) => f.matched && f.contribution > 0)
  return (
    <article className="card slot-card">
      <div className="slot-card__head">
        <span className="slot-rank">#{rank}</span>
        <span className="slot-score" title="Deterministic score 0–100">
          {slot.score}
        </span>
      </div>
      <div className="slot-when">
        <strong>
          {fmtWeekday(slot.slot.start)} {fmtDate(slot.slot.start)}
        </strong>
        <span>{fmtTime(slot.slot.start)}</span>
      </div>
      <div className="slot-who">
        {providerName} · {slot.slot.type}
      </div>

      <p className="slot-explanation">{slot.explanation}</p>

      <ul className="factor-list">
        {matched.map((f) => (
          <li key={f.name}>
            <span className="factor-name">{f.detail}</span>
            <span className="factor-points">+{f.contribution}</span>
          </li>
        ))}
      </ul>

      <button className="btn btn--book" onClick={onBook} disabled={booked || !canBook}>
        {booked ? '✓ Booked' : 'Book this slot'}
      </button>
    </article>
  )
}
