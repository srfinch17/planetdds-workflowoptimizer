import { useEffect, useState } from 'react'
import { fmtWeekday, fmtDate, fmtTime, type CandidateSlot } from '../api'
import { typeIcon } from '../apptIcons'

/**
 * A small modal for staff to book an open slot directly from the Admin
 * calendar — e.g. while on a callback with the patient. Pure presentation: it
 * collects a name + phone for ONE slot and hands them back; the parent owns the
 * actual booking call, refresh, and error. The slot context lives in the header
 * so it always reads "who, when, what" while you type the name.
 */
export function BookSlotDialog({
  slot,
  providerName,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  slot: CandidateSlot
  providerName: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (name: string, phone: string) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  // Esc closes the dialog, matching native dialog behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  const canConfirm = name.trim().length > 0 && !busy

  return (
    <div className="book-dialog__backdrop" onClick={() => !busy && onCancel()}>
      <div
        className="book-dialog card"
        role="dialog"
        aria-modal="true"
        aria-label="Book this slot"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="book-dialog__head">
          <span className="book-dialog__title">📅 Book this slot</span>
          <span className="book-dialog__slot">
            {typeIcon(slot.type)} <strong>{providerName}</strong> · {fmtWeekday(slot.start)} {fmtDate(slot.start)}{' '}
            {new Date(slot.start).getFullYear()} · {fmtTime(slot.start)} · {slot.type}
          </span>
        </div>

        <label className="book-dialog__field">
          <span>Patient name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) onConfirm(name.trim(), phone.trim())
            }}
          />
        </label>
        <label className="book-dialog__field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) onConfirm(name.trim(), phone.trim())
            }}
          />
        </label>

        {error && <div className="banner banner--error">{error}</div>}

        <div className="book-dialog__actions">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={() => onConfirm(name.trim(), phone.trim())}
            disabled={!canConfirm}
          >
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </div>
    </div>
  )
}
