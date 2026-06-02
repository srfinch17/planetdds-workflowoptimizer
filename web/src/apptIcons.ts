// A quick visual cue per appointment type, so the eye can read "what's
// scheduled" before it reads the label. Keep this the single source of truth —
// every surface that shows an appointment type pulls its icon from here.
const ICONS: Record<string, string> = {
  cleaning: '🪥',
  checkup: '🔎',
  filling: '🩹',
  extraction: '🦷',
  emergency: '🚨',
}

/** Emoji for an appointment type; a neutral calendar mark for anything unknown. */
export function typeIcon(type: string): string {
  return ICONS[type.toLowerCase()] ?? '📅'
}
