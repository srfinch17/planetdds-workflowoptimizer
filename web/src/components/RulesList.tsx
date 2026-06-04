import { deleteRule, ruleCategory, type AvailabilityRule, type Provider } from '../api'

function providerName(id: string, providers: Provider[]): string {
  return providers.find((p) => p.id === id)?.name ?? id
}

/** A compact date label: "Jun 11" for a single day, "Jun 11–13" for a range. */
function dateLabel(startDate?: string, endDate?: string): string {
  if (!startDate) return ''
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return endDate && endDate !== startDate ? `${fmt(startDate)}–${fmt(endDate)}` : fmt(startDate)
}

function describe(r: AvailabilityRule): string {
  if (r.kind === 'dayoff') return `off on ${r.weekday}`
  if (r.kind === 'workday') return `works ${r.weekday}${r.start && r.end ? ` · ${r.start}–${r.end}` : ''}`
  if (r.kind === 'closure') return `office closed ${dateLabel(r.startDate, r.endDate)} · ${r.reason}`
  if (r.kind === 'timeoff') return `out ${dateLabel(r.startDate, r.endDate)} · ${r.reason}`
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
      <span className="field-label">📋 Rules &amp; adjustments</span>
      {sorted.length === 0 ? (
        <p className="tile-sub">No rules yet — teach one above.</p>
      ) : (
        <ul className="rules-ul">
          {sorted.map((r) => {
            const sup = isSuperseded(r)
            const adjustment = ruleCategory(r.kind) === 'adjustment'
            return (
              <li key={r.id} className={`rule-row ${sup ? 'rule-row--sup' : ''}`}>
                <span className="rule-prov">{r.kind === 'closure' ? 'Office' : providerName(r.providerId, providers)}</span>
                <span className="rule-desc">{describe(r)}</span>
                <span className={`pill ${adjustment ? 'pill--brand' : ''}`}>
                  {adjustment ? 'adjustment' : 'rule'}
                </span>
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
