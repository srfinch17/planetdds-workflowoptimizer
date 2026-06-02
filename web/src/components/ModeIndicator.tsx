import { Dropdown } from './Dropdown'
import type { ExtractionMode } from '../api'

/**
 * The header's live engine-mode indicator + control. The glowing dot's color
 * shows the current intent-extraction mode; the dropdown changes it.
 *   agentic    = always use the LLM
 *   mixed      = rules first, LLM only when unsure (default)
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
  const options = [
    { value: 'llm', label: <Opt cls="llm" text={online ? 'agentic' : 'agentic (offline)'} />, disabled: !online },
    { value: 'tiered', label: <Opt cls="tiered" text="mixed" /> },
    { value: 'rules', label: <Opt cls="rules" text="rules only" /> },
  ]
  return (
    <Dropdown
      className="mode-dd"
      ariaLabel="Engine mode"
      value={mode}
      onChange={(v) => setMode(v as ExtractionMode)}
      options={options}
    />
  )
}

function Opt({ cls, text }: { cls: string; text: string }) {
  return (
    <>
      <span className={`dot dot--${cls}`} />
      {text}
    </>
  )
}
