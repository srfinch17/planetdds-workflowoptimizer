import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface DropdownOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

/**
 * A small custom dropdown — a styled trigger + a floating menu — so we're not
 * stuck with the un-stylable native <select> popup. Closes on click-outside or
 * Escape. The trigger shows the selected option's label.
 */
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  align = 'right',
}: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  ariaLabel?: string
  className?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <div className={`dd ${className}`} ref={ref}>
      <button
        type="button"
        className="dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dd-current">{current?.label}</span>
        <span className={`dd-caret ${open ? 'dd-caret--open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={`dd-menu dd-menu--${align}`} role="listbox">
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`dd-opt ${o.value === value ? 'dd-opt--active' : ''} ${o.disabled ? 'dd-opt--disabled' : ''}`}
              onClick={() => {
                if (o.disabled) return
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
