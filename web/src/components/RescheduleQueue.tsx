import { fmtWeekday, fmtDate, fmtTime, type RescheduleRecord, type Provider, type Patient } from '../api'
import { typeIcon } from '../apptIcons'

/**
 * Appointments a dated adjustment cancelled — an office closure or a single
 * provider's time-off. They can't be auto-rebooked (the provider/office is out),
 * so staff phone each patient to reschedule. Surfaced here so nothing falls
 * through the cracks.
 */
export function RescheduleQueue({
  records,
  providers,
  patients,
  onDismiss,
}: {
  records: RescheduleRecord[]
  providers: Provider[]
  patients: Patient[]
  // Clear an entry once staff have rebooked the patient (or otherwise handled it).
  onDismiss?: (id: string) => void
}) {
  const provName = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  // Patients (curated + named fillers) resolve to a real name; the fallback is
  // just defensive for any unmapped id — never a raw "pat-…" id on screen.
  const patName = (id: string) => {
    const named = patients.find((p) => p.id === id)
    if (named) return named.name
    const n = id.match(/(\d+)$/)
    return n ? `Patient #${n[1]}` : 'Patient'
  }

  return (
    <section className="card callback-queue">
      <span className="field-label">
        🔁 Needs rescheduling{' '}
        {records.length > 0 && <span className="cb-count">{records.length}</span>}
      </span>
      {records.length === 0 ? (
        <p className="tile-sub">Nothing pending. Office closures and provider time-off move affected appointments here.</p>
      ) : (
        <ul className="cb-list">
          {records.map((r) => (
            <li key={r.id} className="cb-item cb-item--callback">
              <div className="cb-item__head">
                <span className="pill pill--warn">reschedule</span>
                <span className="cb-time">{r.reason}</span>
                {onDismiss && (
                  <button
                    className="btn btn--sm btn--ghost cb-dismiss"
                    title="Rebooked the patient (or handled it) — clear this entry"
                    onClick={() => onDismiss(r.id)}
                  >
                    ✓ Done
                  </button>
                )}
              </div>
              <p className="cb-request">
                {patName(r.appointment.patientId)} · {provName(r.appointment.providerId)} ·{' '}
                {fmtWeekday(r.appointment.start)} {fmtDate(r.appointment.start)} {fmtTime(r.appointment.start)} ·{' '}
                {typeIcon(r.appointment.type)} {r.appointment.type}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
