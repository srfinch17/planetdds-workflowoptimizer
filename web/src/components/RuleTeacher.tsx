import { useState } from 'react'
import { postRule, type AvailabilityRule } from '../api'

const EXAMPLES = [
  'Dr. Pana now works Saturdays',
  'Dr. Jones takes lunch from 12 to 1 every day',
  'Dr. Smith never works Wednesdays',
  'Dr. Jones is taking off June 11 for a family emergency',
  'The office is closed Aug 4 to 6 for plumbing',
]

/**
 * Lets an admin teach a scheduling rule in plain English. The sentence is
 * translated to a STRUCTURED rule server-side (regex first, LLM fallback), then
 * shown back for transparency. onApplied tells the parent to re-read state so
 * the calendar greys the new block immediately.
 */
export function RuleTeacher({ onApplied }: { onApplied: () => void }) {
  const [sentence, setSentence] = useState(EXAMPLES[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<{ rule: AvailabilityRule; source: string; rescheduled: number } | null>(null)

  async function teach() {
    setBusy(true)
    setError(null)
    setApplied(null)
    try {
      let res = await postRule(sentence.trim())
      if (!res.ok) {
        // The new rule contradicts an existing one — confirm an override.
        if (!window.confirm(res.conflict.message)) {
          setBusy(false)
          return
        }
        res = await postRule(sentence.trim(), true)
        if (!res.ok) {
          setBusy(false)
          return
        }
      }
      setApplied({ rule: res.rule, source: res.source, rescheduled: res.rescheduled })
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card rule-teacher">
      <span className="field-label">🧩 Teach a rule or adjustment (plain English)</span>
      <div className="teach-row">
        <textarea
          className="rule-input"
          rows={2}
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          placeholder='e.g. "Dr. Smith never works Fridays"'
        />
        <button className="btn btn--primary" onClick={teach} disabled={busy || !sentence.trim()}>
          {busy ? 'Teaching…' : 'Add rule'}
        </button>
      </div>

      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip chip--clickable" onClick={() => setSentence(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {applied && (
        <div className="rule-applied">
          <span className="pill pill--good">added · translated by {applied.source}</span>
          {applied.rescheduled > 0 && (
            <span className="pill pill--warn">
              {applied.rescheduled} appointment{applied.rescheduled === 1 ? '' : 's'} → reschedule queue
            </span>
          )}
          <code>{JSON.stringify(applied.rule)}</code>
        </div>
      )}
    </section>
  )
}
