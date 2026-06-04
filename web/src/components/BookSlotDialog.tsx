import { useEffect, useState } from 'react'
import { fmtWeekday, fmtDate, fmtTime, type SlotOption } from '../api'
import { typeIcon } from '../apptIcons'
import { formatPhone } from '../phone'

/**
 * A small modal for staff to book an open slot directly from the Admin
 * calendar — e.g. while on a callback with the patient. The clicked time is a
 * 30-minute opening; the PROCEDURE dropdown lists only the types that actually
 * fit there (longer ones appear only when the following slot is free and the
 * provider/room is eligible — the server computed that). Picking a procedure
 * fixes the real duration + room before booking. Pure presentation: it hands a
 * (name, phone, chosen option) back; the parent owns the booking call.
 */
export function BookSlotDialog({
  providerName,
  start,
  options,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  providerName: string
  start: string
  options: SlotOption[]
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (name: string, phone: string, option: SlotOption) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [type, setType] = useState(options[0]?.type ?? '')

  const selected = options.find((o) => o.type === type) ?? options[0]

  // Esc closes the dialog, matching native dialog behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  const canConfirm = name.trim().length > 0 && !!selected && !busy
  const submit = () => {
    if (canConfirm && selected) onConfirm(name.trim(), phone.trim(), selected)
  }

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
            <strong>{providerName}</strong> · {fmtWeekday(start)} {fmtDate(start)} {new Date(start).getFullYear()} ·{' '}
            {fmtTime(start)}
            {selected && (
              <>
                {' '}
                – {fmtTime(selected.end)} · {typeIcon(selected.type)} {selected.type} ({selected.durationMin}m)
              </>
            )}
          </span>
        </div>

        <label className="book-dialog__field">
          <span>Procedure</span>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
            {options.map((o) => (
              <option key={o.type} value={o.type}>
                {typeIcon(o.type)} {o.type} · {o.durationMin}m
              </option>
            ))}
          </select>
        </label>

        <label className="book-dialog__field">
          <span>Patient name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </label>
        <label className="book-dialog__field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="(555) 555 - 5555 (optional)"
            inputMode="tel"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </label>

        {error && <div className="banner banner--error">{error}</div>}

        <div className="book-dialog__actions">
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={!canConfirm}>
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </div>
      </div>
    </div>
  )
}
