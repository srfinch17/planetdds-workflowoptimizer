import { useCallback, useEffect, useRef, useState } from 'react'
import {
  postSchedule,
  getState,
  postBook,
  getAvailability,
  fmtWeekday,
  fmtDate,
  fmtTime,
  type ScheduleResponse,
  type ScoredSlot,
  type CandidateSlot,
  type Provider,
  type Appointment,
  type AvailabilityRule,
  type ExtractionMode,
} from '../api'
import { Calendar } from '../components/Calendar'
import { MonthCalendar } from '../components/MonthCalendar'
import { typeIcon } from '../apptIcons'
import { todayISO, thisMonth, monthsAhead } from '../today'

// One-click example requests. The Dr. Smith one shows the "your dentist vs.
// alternatives" grouping; the last one trips the emergency escalation.
const EXAMPLES = [
  'Can I come in next Thursday after 3?',
  'I usually see Dr. Smith — anything next week?',
  'squeeze me in soon — mornings ideally, but nothing too early',
  'a cleaning in about six months, mornings preferred',
  'my tooth is killing me, can I come in this evening?',
]

// "Today" is always the real system date — relative phrases ("next Thursday")
// are anchored to it, and the calendar can't open in the past.
const TODAY = todayISO()
const MIN_MONTH = thisMonth()
const MAX_MONTH = monthsAhead(12)

// `mode` is the engine setting from the header indicator (agentic/mixed/rules).
export function Intake({ mode }: { mode: ExtractionMode }) {
  const [request, setRequest] = useState(EXAMPLES[0])
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
  const [daySlots, setDaySlots] = useState<Record<string, CandidateSlot[]>>({}) // open slots per day
  const [selectableDays, setSelectableDays] = useState<Set<string> | null>(null) // null = no restriction
  const nameRef = useRef<HTMLInputElement>(null) // focused when a booking needs patient details

  const loadState = useCallback(() => {
    getState()
      .then((s) => {
        setProviders(s.providers)
        setAppointments(s.appointments)
        setRules(s.rules)
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
    setDaySlots({})
    setSelectableDays(null)
    try {
      const res = await postSchedule(request.trim(), TODAY, mode)
      setResult(res)
      // If the patient stated their name/phone in the request, pre-fill the
      // booking form; otherwise leave it for them to type.
      if (res.intent.patientName) setPatientName(res.intent.patientName)
      if (res.intent.patientPhone) setPatientPhone(res.intent.patientPhone)
      const recDay = res.recommendation.slots[0]?.slot.start.slice(0, 10) ?? res.intent.earliestDate ?? TODAY
      setViewDay(recDay)
      await loadAvailability(res, recDay)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Pull the open slots for the days this request can book into. A request that
  // names days/dates ("Tue or Thu in late July") restricts the calendar to those
  // days; a vague one leaves the calendar open and just loads the shown day.
  async function loadAvailability(res: ScheduleResponse, recDay: string) {
    const { intent } = res
    const type = intent.appointmentType
    const recDates = res.recommendation.slots.map((s) => s.slot.start.slice(0, 10))
    const constrained = intent.daysOfWeek.length > 0 || intent.earliestDate != null
    if (!constrained) {
      setSelectableDays(null) // vague request → every working day stays clickable
      const { slotsByDay } = await getAvailability({ from: recDay, to: recDay, type })
      setDaySlots(slotsByDay)
      return
    }
    const from = intent.earliestDate ?? TODAY
    const to = intent.latestDate ?? intent.earliestDate ?? addDaysStr(TODAY, 56)
    const { slotsByDay } = await getAvailability({ from, to, type, days: intent.daysOfWeek })
    const map: Record<string, CandidateSlot[]> = { ...slotsByDay }
    // Always allow the day(s) the system actually recommended — even a widened,
    // best-effort day that falls outside the requested window.
    for (const d of recDates) {
      if (!map[d]) {
        const extra = await getAvailability({ from: d, to: d, type })
        Object.assign(map, extra.slotsByDay)
      }
    }
    setDaySlots(map)
    setSelectableDays(new Set(Object.keys(map)))
  }

  async function selectDay(day: string) {
    setViewDay(day)
    if (!daySlots[day] && result) {
      const { slotsByDay } = await getAvailability({ from: day, to: day, type: result.intent.appointmentType })
      setDaySlots((prev) => ({ ...prev, ...slotsByDay }))
    }
  }

  const canBook = patientName.trim().length > 0 && patientPhone.trim().length > 0

  async function bookSlot(slot: CandidateSlot) {
    if (!canBook) {
      // Don't silently no-op — point the patient at the missing details.
      setError('Add your name and phone first, then click a time to book.')
      nameRef.current?.focus()
      nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setError(null)
    const key = `${slot.providerId}@${slot.start}`
    try {
      const res = await postBook(slot, { name: patientName.trim(), phone: patientPhone.trim() }, result?.requestId)
      setBooked((b) => ({ ...b, [key]: res.confirmationNumber }))
      loadState()
      // The slot is now taken — refresh the day's open list so it drops out.
      const day = slot.start.slice(0, 10)
      const refreshed = await getAvailability({ from: day, to: day, type: slot.type })
      setDaySlots((prev) => ({ ...prev, ...refreshed.slotsByDay }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const book = (s: ScoredSlot) => bookSlot(s.slot)

  const slots = result?.recommendation.slots ?? []
  const rankOf = new Map(slots.map((s, i) => [slotKey(s), i + 1]))

  // Split into "your dentist" vs alternatives when a provider was requested.
  const pref = result?.recommendation.preferredProviderId ?? null
  const mine = pref ? slots.filter((s) => s.slot.providerId === pref) : []
  const others = pref ? slots.filter((s) => s.slot.providerId !== pref) : slots

  const calendarDay = slots[0]?.slot.start.slice(0, 10) ?? result?.intent.earliestDate ?? TODAY
  const dayShown = viewDay ?? calendarDay
  const recommendedDays = new Set(slots.map((s) => s.slot.start.slice(0, 10)))
  const bookedKeys = new Set(Object.keys(booked).filter((k) => booked[k]))
  // EVERY open time on the shown day is a bookable ★ in the grid (not just the
  // top 3) — keyed provider@start so the day grid can place + book each one.
  const openSlotsForDay = daySlots[dayShown] ?? []
  const openByKey = new Map(openSlotsForDay.map((s) => [`${s.providerId}@${s.start}`, s]))
  const highlights = new Set(openByKey.keys())

  const renderCard = (s: ScoredSlot) => (
    <SlotCard
      key={slotKey(s)}
      rank={rankOf.get(slotKey(s)) ?? 0}
      slot={s}
      providerName={providerName(s.slot.providerId)}
      isPreferred={!!pref && s.slot.providerId === pref}
      confirmation={booked[slotKey(s)]}
      onBook={() => book(s)}
    />
  )

  return (
    <div className="intake">
      <section className="card request-card">
        <label className="field-label" htmlFor="request">
          💬 Patient request
        </label>
        <p className="request-hint">
          Tip: include your name and phone and we’ll fill them in for you — e.g.
          “This is Frank Jones, 222-333-4455, I have a toothache, how soon can you get me in?”
        </p>
        <textarea
          id="request"
          className="request-input"
          rows={2}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. This is Frank Jones, 222-333-4455 — can I come in next Thursday after 3?"
        />

        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip chip--clickable" onClick={() => setRequest(ex)}>
              {ex}
            </button>
          ))}
        </div>

        <div className="request-actions">
          <button
            className="btn btn--primary"
            onClick={findAppointments}
            disabled={loading || !request.trim()}
          >
            {loading ? 'Finding…' : '🔍 Find appointments'}
          </button>
        </div>
      </section>

      <section className="card patient-id">
        <span className="patient-id__label">🧑‍⚕️ Patient details</span>
        <label className="patient-id__field">
          👤
          <input
            ref={nameRef}
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Full name"
          />
        </label>
        <label className="patient-id__field">
          📞
          <input
            value={patientPhone}
            onChange={(e) => setPatientPhone(e.target.value)}
            placeholder="Phone"
          />
        </label>
        <span className={`patient-id__status ${canBook ? 'patient-id__status--ok' : ''}`}>
          {canBook ? '✓ ready to book' : 'needed to book a time'}
        </span>
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

          {providers.length > 0 && (
            <section className="calendar-panel">
              <span className="field-label">🗓️ Where these land — pick a day to view</span>
              <MonthCalendar
                appointments={appointments}
                providers={providers}
                rules={rules}
                selectedDate={dayShown}
                onSelectDate={selectDay}
                initialMonth={calendarDay.slice(0, 7)}
                minMonth={MIN_MONTH}
                maxMonth={MAX_MONTH}
                today={TODAY}
                recommendedDays={recommendedDays}
                selectableDays={selectableDays ?? undefined}
              />
              {selectableDays && (
                <p className="cal-hint">
                  Showing only the days this request asked for — greyed days aren’t available.
                </p>
              )}
              <span className="field-label">
                📆 {fmtWeekday(`${dayShown}T00:00:00`)} {fmtDate(`${dayShown}T00:00:00`)} — available times ·{' '}
                <span className="field-label__cta">★ click any to book</span>
              </span>
              <Calendar
                providers={providers}
                appointments={appointments}
                rules={rules}
                day={dayShown}
                highlights={highlights}
                recommendedKeys={new Set(slots.map(slotKey))}
                bookedKeys={bookedKeys}
                onBookSlot={(key) => {
                  const s = openByKey.get(key)
                  if (s) bookSlot(s)
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  onBook,
}: {
  rank: number
  slot: ScoredSlot
  providerName: string
  isPreferred: boolean
  confirmation?: string
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
        {isPreferred ? ' · your dentist' : ''} · {typeIcon(slot.slot.type)} {slot.slot.type}
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

      <button className="btn btn--book" onClick={onBook} disabled={booked}>
        {booked ? `✓ Booked · ${confirmation}` : '📌 Book this slot'}
      </button>
    </article>
  )
}
