import type { ExtractionMode } from '../api'

/**
 * The header's live engine-mode indicator + control. The glowing dot's color
 * shows the current intent-extraction mode; the dropdown changes it.
 *   agentic   = always use the LLM
 *   mixed     = rules first, LLM only when unsure (default)
 *   rules only = never call the LLM
 */
export function ModeIndicator({
  mode,
  setMode,
  online,
}: {
  mode: ExtractionMode
  setMode: (m: ExtractionMode) => void
  online: boolean
}) {
  return (
    <label
      className={`mode-ind mode-ind--${mode}`}
      title="Intent-extraction engine. Agentic forces the LLM; mixed escalates only when needed; rules-only never calls it."
    >
      <span className="mode-dot" />
      <select value={mode} onChange={(e) => setMode(e.target.value as ExtractionMode)} aria-label="Engine mode">
        <option value="llm" disabled={!online}>
          agentic{online ? '' : ' (offline)'}
        </option>
        <option value="tiered">mixed</option>
        <option value="rules">rules only</option>
      </select>
    </label>
  )
}
