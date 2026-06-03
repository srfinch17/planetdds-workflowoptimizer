import { useCallback, useEffect, useRef, useState } from 'react'
import {
  postSchedule,
  postCallbackContact,
  getState,
  postBook,
  postCancel,
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
import { ManageAppointments } from '../components/ManageAppointments'
import { BookingReview, BookingConfirmed } from '../components/BookingPanel'
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
// Per-dentist color slots, matching Calendar/MonthCalendar (Smith=a · Pana=b · Jones=c).
const PROV_COLORS = ['a', 'b', 'c', 'a', 'b', 'c']

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
  // Booking phase machine: RESULTS (cards + calendar) → REVIEW (a slot picked,
  // not yet booked) → BOOKED (confirmed). Nothing is booked until they confirm.
  const [pendingBooking, setPendingBooking] = useState<CandidateSlot | null>(null)
  const [confirmed, setConfirmed] = useState<{
    slot: CandidateSlot
    confirmationNumber: string
    appointmentId: string
    patientId: string
  } | null>(null)
  const [bookingBusy, setBookingBusy] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [viewDay, setViewDay] = useState<string | null>(null) // day shown in the detail grid
  const [daySlots, setDaySlots] = useState<Record<string, CandidateSlot[]>>({}) // open slots per day
  const [selectableDays, setSelectableDays] = useState<Set<string> | null>(null) // null = no restriction
  // Callback contact: when a request escalates to a staff callback, the office
  // needs a number. `callbackDone` is true once we have one (stated, in the bar,
  // or just sent); otherwise the escalation banner prompts for it.
  const [callbackDone, setCallbackDone] = useState(false)
  const [callbackBusy, setCallbackBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null) // focused when a booking/callback needs patient details

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
  // Per-dentist color slot, by roster order — the SAME a/b/c mapping the calendar
  // and Available-times grid use, so a dentist reads as one color everywhere.
  const providerColor = (id: string) =>
    PROV_COLORS[Math.max(0, providers.findIndex((p) => p.id === id)) % PROV_COLORS.length]
  const slotKey = (s: ScoredSlot) => `${s.slot.providerId}@${s.slot.start}`

  async function findAppointments() {
    setLoading(true)
    setError(null)
    setResult(null)
    setPendingBooking(null)
    setConfirmed(null)
    setBookingError(null)
    setDaySlots({})
    setSelectableDays(null)
    setCallbackDone(false)
    try {
      // Send the patient bar too — if this escalates to a callback, the server
      // uses it as the contact to call back.
      const res = await postSchedule(request.trim(), TODAY, mode, {
        name: patientName.trim() || undefined,
        phone: patientPhone.trim() || undefined,
      })
      setResult(res)
      // If the patient stated their name/phone in the request, pre-fill the
      // booking form; otherwise leave it for them to type.
      if (res.intent.patientName) setPatientName(res.intent.patientName)
      if (res.intent.patientPhone) setPatientPhone(res.intent.patientPhone)
      // A callback needs a number to be actionable. We've captured one if it was
      // stated in the request or already in the bar; otherwise prompt for it.
      if (res.escalation.callbackRequired) {
        const haveNumber = !!(res.intent.patientPhone || patientPhone.trim())
        setCallbackDone(haveNumber)
        if (!haveNumber) {
          nameRef.current?.focus()
          nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      const recDay = res.recommendation.slots[0]?.slot.start.slice(0, 10) ?? res.intent.earliestDate ?? TODAY
      setViewDay(recDay)
      await loadAvailability(res, recDay)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Attach the patient's contact info to the queued callback (when an emergency
  // fired before they left a number). Uses the patient-details bar values.
  async function sendCallbackContact() {
    if (!result?.callbackId) return
    if (!patientPhone.trim()) {
      nameRef.current?.focus()
      return
    }
    setCallbackBusy(true)
    setError(null)
    try {
      await postCallbackContact(result.callbackId, patientName.trim(), patientPhone.trim())
      setCallbackDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCallbackBusy(false)
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

  const canBook = patientName.trim().length > 0 && phoneDigits(patientPhone).length === 10

  // Step 1: pick a slot → go to the REVIEW step. Nothing is booked yet.
  function bookSlot(slot: CandidateSlot) {
    if (!canBook) {
      setError('Add your name and a complete phone number first, then pick a time.')
      nameRef.current?.focus()
      nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setError(null)
    setBookingError(null)
    setPendingBooking(slot)
  }

  // Step 2: actually book the reviewed slot. The confirmation number is created
  // HERE — not when they first clicked. On a conflict (slot taken since the
  // search) we drop back to the results with a refreshed, honest calendar.
  async function confirmBooking() {
    if (!pendingBooking) return
    setBookingBusy(true)
    setBookingError(null)
    try {
      const res = await postBook(
        pendingBooking,
        { name: patientName.trim(), phone: patientPhone.trim() },
        result?.requestId,
      )
      setConfirmed({
        slot: pendingBooking,
        confirmationNumber: res.confirmationNumber,
        appointmentId: res.appointment.id,
        patientId: res.appointment.patientId,
      })
      setPendingBooking(null)
      loadState()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const day = pendingBooking.start.slice(0, 10)
      const type = pendingBooking.type
      setPendingBooking(null)
      setError(msg)
      try {
        const refreshed = await getAvailability({ from: day, to: day, type })
        setDaySlots((prev) => ({ ...prev, ...refreshed.slotsByDay }))
      } catch {
        /* ignore refresh failure */
      }
    } finally {
      setBookingBusy(false)
    }
  }

  // Back to a clean search. The patient's name/phone are kept so booking a few
  // in a row (great for demoing/testing) stays quick.
  function resetToSearch() {
    setConfirmed(null)
    setPendingBooking(null)
    setResult(null)
    setDaySlots({})
    setSelectableDays(null)
    setViewDay(null)
    setBookingError(null)
    setError(null)
  }

  // "Book another appointment": KEEP the booking just made, go start a fresh one.
  function bookAnother() {
    resetToSearch()
  }

  // "Cancel & start over": really cancel the appointment (frees the slot), then reset.
  async function cancelBookingAndReset() {
    if (!confirmed) return
    setBookingBusy(true)
    try {
      await postCancel(confirmed.appointmentId, confirmed.patientId)
    } catch {
      /* reset the view even if the cancel call fails */
    }
    resetToSearch()
    setBookingBusy(false)
  }

  const slots = result?.recommendation.slots ?? []
  const rankOf = new Map(slots.map((s, i) => [slotKey(s), i + 1]))

  // Split into "your dentist" vs alternatives when a provider was requested.
  const pref = result?.recommendation.preferredProviderId ?? null
  const mine = pref ? slots.filter((s) => s.slot.providerId === pref) : []
  const others = pref ? slots.filter((s) => s.slot.providerId !== pref) : slots

  const calendarDay = slots[0]?.slot.start.slice(0, 10) ?? result?.intent.earliestDate ?? TODAY
  const dayShown = viewDay ?? calendarDay
  const recommendedDays = new Set(slots.map((s) => s.slot.start.slice(0, 10)))
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
      colorClass={providerColor(s.slot.providerId)}
      isPreferred={!!pref && s.slot.providerId === pref}
      onBook={() => bookSlot(s.slot)}
    />
  )

  // A confirmed booking takes over the whole page — the request box and patient
  // details disappear; there's just the confirmation (or cancel & start over).
  if (confirmed) {
    return (
      <div className="intake intake--confirmed">
        <BookingConfirmed
          slot={confirmed.slot}
          providerName={providerName(confirmed.slot.providerId)}
          confirmationNumber={confirmed.confirmationNumber}
          busy={bookingBusy}
          onBookAnother={bookAnother}
          onCancel={cancelBookingAndReset}
        />
      </div>
    )
  }

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
            onChange={(e) => setPatientPhone(formatPhone(e.target.value))}
            placeholder="(555) 555 - 5555"
            inputMode="tel"
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
          {callbackDone ? (
            <div className="escalation__contact escalation__contact--ok">
              ✓ The office has your callback details
              {result.intent.patientPhone || patientPhone.trim()
                ? ` — they'll call ${patientName.trim() || 'you'} at ${result.intent.patientPhone || patientPhone.trim()}`
                : ''}
              .{result.escalation.matched ? ` · detected “${result.escalation.matched}”` : ''}
            </div>
          ) : (
            <div className="escalation__contact escalation__contact--need">
              <span className="escalation__tag">
                📞 So the office can call you back, enter your <strong>name &amp; phone</strong> in Patient details above:
              </span>
              <button
                className="btn btn--primary btn--sm"
                disabled={callbackBusy || patientPhone.trim().length === 0}
                onClick={sendCallbackContact}
              >
                {callbackBusy ? 'Sending…' : 'Send my number to the office'}
              </button>
            </div>
          )}
        </section>
      )}

      {result && (
        <>
          {pendingBooking ? (
            <BookingReview
              slot={pendingBooking}
              providerName={providerName(pendingBooking.providerId)}
              busy={bookingBusy}
              error={bookingError}
              onConfirm={confirmBooking}
              onCancel={() => setPendingBooking(null)}
            />
          ) : (
            <>
          <IntentSummary result={result} providerName={providerName} />

          {result.intent.action !== 'book' && result.patientMatch ? (
            <ManageAppointments
              action={result.intent.action}
              patientMatch={result.patientMatch}
              appointments={result.appointments ?? []}
              intent={result.intent}
              today={TODAY}
              onChanged={loadState}
            />
          ) : (
          <>
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
                patientView
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
                patientView
                onBookSlot={(key) => {
                  const s = openByKey.get(key)
                  if (s) bookSlot(s)
                }}
              />
            </section>
          )}
          </>
          )}
            </>
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

// Phone helpers: format as the patient types → "(555) 555 - 5555", and require a
// complete 10-digit number before a booking is allowed.
function phoneDigits(s: string): string {
  return s.replace(/\D/g, '')
}
function formatPhone(input: string): string {
  const d = phoneDigits(input).slice(0, 10)
  if (d.length === 0) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)} - ${d.slice(6)}`
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

  if (intent.action !== 'book') chips.push({ label: `action: ${intent.action}`, tone: 'bad' })
  if (intent.action === 'book')
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
  colorClass,
  isPreferred,
  onBook,
}: {
  rank: number
  slot: ScoredSlot
  providerName: string
  colorClass: string
  isPreferred: boolean
  onBook: () => void
}) {
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
        <strong className={`prov-name prov-name--${colorClass}`}>{providerName}</strong>
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

      <button className="btn btn--book" onClick={onBook}>
        📌 Book this slot
      </button>
    </article>
  )
}
