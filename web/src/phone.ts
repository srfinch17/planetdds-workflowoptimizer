// Phone formatting, shared by the patient Intake bar and the Admin booking
// dialog so a number is entered the same way everywhere: format as you type to
// "(555) 555 - 5555", and check for a complete 10-digit number.

export function phoneDigits(s: string): string {
  return s.replace(/\D/g, '')
}

export function formatPhone(input: string): string {
  const d = phoneDigits(input).slice(0, 10)
  if (d.length === 0) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)} - ${d.slice(6)}`
}
