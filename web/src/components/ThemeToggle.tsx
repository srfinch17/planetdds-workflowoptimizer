import { useEffect, useState } from 'react'

type Choice = 'light' | 'dark' | 'system'

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
function resolve(choice: Choice): 'light' | 'dark' {
  return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice
}

/**
 * Header dropdown to pick Light / Dark / System. Applies the choice to
 * <html data-theme>, persists it to localStorage, and (in System mode) tracks
 * the OS setting live. The initial paint is handled by an inline script in
 * index.html so there's no flash of the wrong theme on load.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>(
    () => (localStorage.getItem('theme') as Choice) || 'system',
  )

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolve(choice)
    }
    apply()
    localStorage.setItem('theme', choice)

    if (choice === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [choice])

  return (
    <label className="theme-toggle" title="Color theme">
      <span className="theme-toggle__icon">{resolve(choice) === 'dark' ? '🌙' : '☀️'}</span>
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value as Choice)}
        aria-label="Color theme"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  )
}
