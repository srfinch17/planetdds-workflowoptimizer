import { useEffect, useState } from 'react'
import { Dropdown } from './Dropdown'

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
    <Dropdown
      className="theme-dd"
      ariaLabel="Color theme"
      value={choice}
      onChange={(v) => setChoice(v as Choice)}
      options={[
        { value: 'system', label: <Opt icon="🖥️" text="System" /> },
        { value: 'light', label: <Opt icon="☀️" text="Light" /> },
        { value: 'dark', label: <Opt icon="🌙" text="Dark" /> },
      ]}
    />
  )
}

function Opt({ icon, text }: { icon: string; text: string }) {
  return (
    <>
      <span className="dd-emoji">{icon}</span>
      {text}
    </>
  )
}
