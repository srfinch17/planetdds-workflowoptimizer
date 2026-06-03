import { type CallbackRecord } from '../api'

// The staff worklist: patients whose messages triaged as emergency/urgent and
// who must be called back ASAP. This is the "override" made operational — the
// office sees exactly who to phone, newest first.
export function CallbackQueue({ callbacks }: { callbacks: CallbackRecord[] }) {
  return (
    <section className="card callback-queue">
      <span className="field-label">
        📞 Emergency callback queue{' '}
        {callbacks.length > 0 && <span className="cb-count">{callbacks.length}</span>}
      </span>
      {callbacks.length === 0 ? (
        <p className="tile-sub">No callbacks pending. Emergency/urgent requests appear here for staff to phone back.</p>
      ) : (
        <ul className="cb-list">
          {callbacks.map((cb) => (
            <li key={cb.id} className={`cb-item cb-item--${cb.level}`}>
              <div className="cb-item__head">
                <span className={`pill pill--${cb.level === 'emergency' ? 'bad' : 'warn'}`}>
                  {cb.level === 'emergency' ? '🚨 EMERGENCY' : '⚠️ URGENT'}
                </span>
                <span className="cb-time">{new Date(cb.createdAt).toLocaleTimeString()}</span>
              </div>
              {cb.patientName || cb.patientPhone ? (
                <p className="cb-contact">
                  📞 <strong>{cb.patientName ?? 'Name not given'}</strong>
                  {cb.patientPhone ? ` · ${cb.patientPhone}` : ' · no number on file'}
                </p>
              ) : (
                <p className="cb-contact cb-contact--missing">
                  ⚠️ No callback number — patient hasn’t left contact info yet.
                </p>
              )}
              <p className="cb-request">“{cb.request}”</p>
              {cb.matched && <span className="tile-sub">detected: {cb.matched}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
