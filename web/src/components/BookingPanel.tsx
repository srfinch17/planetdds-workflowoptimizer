import { fmtWeekday, fmtDate, fmtTime, type CandidateSlot } from '../api'
import { typeIcon } from '../apptIcons'

function dateLine(slot: CandidateSlot): string {
  return `${fmtWeekday(slot.start)}, ${fmtDate(slot.start)} ${new Date(slot.start).getFullYear()}`
}
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/**
 * Step 1 of booking: review what the patient picked and confirm. NOTHING is
 * reserved until they hit Confirm — the parent calls /api/book then. "Start
 * over" just drops back to the results; no appointment was ever created.
 */
export function BookingReview({
  slot,
  providerName,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  slot: CandidateSlot
  providerName: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <section className="card booking-review">
      <span className="field-label">📋 Review your booking</span>
      <div className="booking-review__slot">
        <span className="booking-review__what">
          {typeIcon(slot.type)} <strong>{slot.type}</strong> with <strong>{providerName}</strong>
        </span>
        <span className="booking-review__when">
          {dateLine(slot)} · {fmtTime(slot.start)}
        </span>
      </div>
      <p className="booking-review__ask">Book this time? Nothing is reserved until you confirm.</p>
      {error && <div className="banner banner--error">{error}</div>}
      <div className="booking-review__actions">
        <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          ↺ Start over
        </button>
        <button className="btn btn--primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Booking…' : '✓ Confirm booking'}
        </button>
      </div>
    </section>
  )
}

/**
 * Step 2: the booking is confirmed. Replaces the whole results/calendar area
 * with a clean "you're booked" summary. "Cancel & start over" really cancels the
 * appointment (frees the slot) and resets to a fresh search.
 */
export function BookingConfirmed({
  slot,
  providerName,
  confirmationNumber,
  busy,
  onBookAnother,
  onCancel,
}: {
  slot: CandidateSlot
  providerName: string
  confirmationNumber: string
  busy: boolean
  onBookAnother: () => void // keep this booking, go start a fresh one
  onCancel: () => void // cancel this booking and start over
}) {
  return (
    <section className="card booking-confirmed">
      <div className="booking-confirmed__check" aria-hidden>
        ✓
      </div>
      <h3 className="booking-confirmed__title">You’re booked!</h3>
      <p className="booking-confirmed__detail">
        <strong>{dateLine(slot)}</strong> at <strong>{fmtTime(slot.start)}</strong>
        <br />
        with <strong>{providerName}</strong> for {typeIcon(slot.type)} {article(slot.type)} <strong>{slot.type}</strong>.
      </p>
      <p className="booking-confirmed__conf">
        Confirmation <strong>{confirmationNumber}</strong>
      </p>
      <p className="booking-confirmed__reminder">
        📱 We’ll text you a reminder one hour before your appointment.
      </p>
      <div className="booking-confirmed__actions">
        <button className="btn btn--primary" onClick={onBookAnother} disabled={busy}>
          ➕ Book another appointment
        </button>
        <button className="btn btn--danger-outline" onClick={onCancel} disabled={busy}>
          {busy ? 'Cancelling…' : '↺ Cancel this booking & start over'}
        </button>
      </div>
    </section>
  )
}
