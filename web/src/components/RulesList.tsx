import { deleteRule, type AvailabilityRule, type Provider } from '../api'

function providerName(id: string, providers: Provider[]): string {
  return providers.find((p) => p.id === id)?.name ?? id
}

function describe(r: AvailabilityRule): string {
  if (r.kind === 'dayoff') return `off on ${r.weekday}`
  if (r.kind === 'workday') return `works ${r.weekday}${r.start && r.end ? ` · ${r.start}–${r.end}` : ''}`
  return `${r.reason || 'block'} · ${r.start}–${r.end} daily`
}

/**
 * The current rules, with delete + a "superseded" badge. Because workday/dayoff
 * rules are newest-wins, an older rule contradicted by a newer one for the same
 * dentist + weekday is shown as superseded — so the admin can see (and prune)
 * what's actually in effect.
 */
export function RulesList({
  providers,
  rules,
  onChange,
}: {
  providers: Provider[]
  rules: AvailabilityRule[]
  onChange: () => void
}) {
  const isSuperseded = (r: AvailabilityRule): boolean =>
    (r.kind === 'workday' || r.kind === 'dayoff') &&
    rules.some(
      (o) =>
        o.id !== r.id &&
        o.providerId === r.providerId &&
        o.weekday === r.weekday &&
        (o.kind === 'workday' || o.kind === 'dayoff') &&
        (o.createdAt ?? '') > (r.createdAt ?? ''),
    )

  const sorted = [...rules].sort(
    (a, b) => a.providerId.localeCompare(b.providerId) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
  )

  return (
    <section className="card rules-list">
      <span className="field-label">📋 Current rules</span>
      {sorted.length === 0 ? (
        <p className="tile-sub">No rules yet — teach one above.</p>
      ) : (
        <ul className="rules-ul">
          {sorted.map((r) => {
            const sup = isSuperseded(r)
            return (
              <li key={r.id} className={`rule-row ${sup ? 'rule-row--sup' : ''}`}>
                <span className="rule-prov">{providerName(r.providerId, providers)}</span>
                <span className="rule-desc">{describe(r)}</span>
                {sup && <span className="pill pill--warn">superseded</span>}
                <span className="rule-when">
                  {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}
                </span>
                <button
                  className="btn btn--sm btn--danger"
                  title="Delete this rule"
                  onClick={async () => {
                    await deleteRule(r.id)
                    onChange()
                  }}
                >
                  🗑
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
