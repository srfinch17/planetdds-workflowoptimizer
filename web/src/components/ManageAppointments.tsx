import { useState } from 'react'
import {
  fmtWeekday,
  fmtDate,
  fmtTime,
  getAvailability,
  postCancel,
  postReschedule,
  type AppointmentSummary,
  type PatientMatch,
  type SchedulingIntent,
  type CandidateSlot,
} from '../api'
import { typeIcon } from '../apptIcons'

/**
 * Cancel / reschedule an existing appointment. The patient was already
 * identified (by name or phone) server-side; here we just list their upcoming
 * appointments and let staff act on one. Cancel takes a confirm click;
 * reschedule reuses the normal availability + booking path for the new time.
 */
export function ManageAppointments({
  action,
  patientMatch,
  appointments,
  intent,
  today,
  onChanged,
}: {
  action: 'cancel' | 'reschedule'
  patientMatch: PatientMatch
  appointments: AppointmentSummary[]
  intent: SchedulingIntent
  today: string
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // Per-appointment outcome, so cancelling/rescheduling several in a row each
  // keep their own status (a single value would let later actions wipe earlier ones).
  const [done, setDone] = useState<Record<string, { kind: 'cancelled' | 'rescheduled'; confirmation?: string }>>({})
  const [reschedulingId, setReschedulingId] = useState<string | null>(null)
  const [newSlots, setNewSlots] = useState<CandidateSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  if (!patientMatch.found) {
    return (
      <section className="card manage">
        <p className="manage__notfound">
          🔍 We couldn’t find an appointment under that name or number. Please call the office, or
          start a new booking above.
        </p>
      </section>
    )
  }
  if (appointments.length === 0) {
    return (
      <section className="card manage">
        <p className="manage__notfound">
          <strong>{patientMatch.name}</strong> has no upcoming appointments to {action}.
        </p>
      </section>
    )
  }

  async function cancel(id: string) {
    setError(null)
    try {
      await postCancel(id, patientMatch.patientId ?? '')
      setDone((m) => ({ ...m, [id]: { kind: 'cancelled' } }))
      setConfirmingId(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function startReschedule(appt: AppointmentSummary) {
    setReschedulingId(appt.id)
    setNewSlots([])
    setLoadingSlots(true)
    setError(null)
    try {
      // Never search before today — a reschedule can only move an appointment
      // forward, even if the model returned a stale earliest date.
      const from = intent.earliestDate && intent.earliestDate > today ? intent.earliestDate : today
      const to = intent.latestDate && intent.latestDate > from ? intent.latestDate : addDays(today, 60)
      const { slotsByDay } = await getAvailability({ from, to, type: appt.type, days: intent.daysOfWeek })
      const flat = Object.keys(slotsByDay)
        .sort()
        .flatMap((d) => slotsByDay[d])
      // Keep the same dentist when they have openings; only offer others if not.
      const samePrv = flat.filter((s) => s.providerId === appt.providerId)
      setNewSlots((samePrv.length ? samePrv : flat).slice(0, 12))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingSlots(false)
    }
  }

  async function doReschedule(oldId: string, slot: CandidateSlot) {
    setError(null)
    try {
      const r = await postReschedule(oldId, slot, patientMatch.patientId ?? '')
      setDone((m) => ({ ...m, [oldId]: { kind: 'rescheduled', confirmation: r.confirmationNumber } }))
      setReschedulingId(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="card manage">
      <span className="field-label">
        {action === 'cancel' ? '🗑️ Cancel an appointment' : '🔁 Reschedule an appointment'}
      </span>
      <p className="manage__who">
        Found <strong>{patientMatch.name}</strong> — {appointments.length} upcoming appointment
        {appointments.length > 1 ? 's' : ''}.
      </p>

      <ul className="manage-list">
        {appointments.map((a) => {
          const outcome = done[a.id]
          return (
            <li key={a.id} className={`manage-row${outcome ? ' manage-row--done' : ''}`}>
              <span className="manage-row__info">
                {typeIcon(a.type)} <strong>{a.type}</strong> with {a.providerName} · {fmtWeekday(a.start)}{' '}
                {fmtDate(a.start)} {yearOf(a.start)} at {fmtTime(a.start)}
              </span>
              {outcome ? (
                <span className="manage-row__status">
                  {outcome.kind === 'cancelled'
                    ? '✓ Cancelled'
                    : `✓ Rescheduled${outcome.confirmation ? ' · ' + outcome.confirmation : ''}`}
                </span>
              ) : action === 'cancel' ? (
                confirmingId === a.id ? (
                  <span className="manage-row__confirm">
                    <button className="btn btn--danger" onClick={() => cancel(a.id)}>
                      Confirm cancel
                    </button>
                    <button className="btn btn--ghost" onClick={() => setConfirmingId(null)}>
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button className="btn btn--danger-outline" onClick={() => setConfirmingId(a.id)}>
                    Cancel
                  </button>
                )
              ) : (
                <button
                  className="btn btn--primary"
                  onClick={() => startReschedule(a)}
                  disabled={reschedulingId === a.id}
                >
                  {reschedulingId === a.id ? 'Pick a new time below' : 'Reschedule'}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {action === 'reschedule' && reschedulingId && !done[reschedulingId] && (
        <div className="reschedule-slots">
          <span className="field-label">🕐 New times{loadingSlots ? ' — finding…' : ''}</span>
          {!loadingSlots && newSlots.length === 0 && (
            <p className="open-times__empty">No open times in that window — try a different request.</p>
          )}
          <div className="reschedule-slots__times">
            {newSlots.map((s) => (
              <button
                key={`${s.providerId}@${s.start}`}
                className="open-slot reschedule-slot"
                title="Move the appointment to this time"
                onClick={() => doReschedule(reschedulingId, s)}
              >
                <span className="open-slot__time">
                  {fmtWeekday(s.start)} {fmtDate(s.start)} {yearOf(s.start)} · {fmtTime(s.start)}
                </span>
                <span className="open-slot__cta">move&nbsp;→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="banner banner--error">{error}</div>}
    </section>
  )
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Appointments can be months out, so always show the year — "Feb 15" alone is
// ambiguous across years.
function yearOf(iso: string): string {
  return String(new Date(iso).getFullYear())
}
