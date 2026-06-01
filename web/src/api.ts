// Typed client for the Hono backend. These shapes MIRROR src/core/types.ts on
// the server — keeping them in sync by hand is fine for a demo this size. All
// calls go to same-origin "/api/..." which Vite proxies to localhost:3000.

export type Urgency = 'routine' | 'soon' | 'urgent'
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

export interface SchedulingIntent {
  appointmentType: string | null
  urgency: Urgency
  earliestDate: string | null
  latestDate: string | null
  daysOfWeek: Weekday[]
  timeEarliest: string | null
  timeLatest: string | null
  partOfDay: 'morning' | 'afternoon' | 'evening' | null
  preferredProviderId: string | null
  rawRequest: string
  source: 'rules' | 'llm'
  confidence: number
}

export interface ScoreFactor {
  name: string
  weight: number
  matched: boolean
  detail: string
  contribution: number
}

export interface CandidateSlot {
  providerId: string
  operatoryId: string
  start: string
  end: string
  type: string
}

export interface ScoredSlot {
  slot: CandidateSlot
  score: number
  factors: ScoreFactor[]
  explanation: string
}

export interface Recommendation {
  slots: ScoredSlot[]
  bestEffort: boolean
}

export type IntentPath = 'rules' | 'llm' | 'offline-fallback' | 'llm-failed-fallback' | null

export interface ScheduleResponse {
  intent: SchedulingIntent
  recommendation: Recommendation
  pathTaken: IntentPath
}

export interface Provider {
  id: string
  name: string
  role: 'dentist' | 'hygienist'
  specialties: string[]
  workdays: Weekday[]
  hours: { start: string; end: string }
}

export interface Operatory {
  id: string
  name: string
  equipment: string[]
}

export interface Patient {
  id: string
  name: string
  preferredProviderId: string | null
}

export interface Appointment {
  id: string
  providerId: string
  operatoryId: string
  patientId: string
  start: string
  end: string
  type: string
}

export interface AvailabilityRule {
  id: string
  providerId: string
  kind: 'block' | 'dayoff'
  recurrence?: 'daily'
  weekday?: Weekday
  start?: string
  end?: string
  reason: string
}

export interface StateResponse {
  providers: Provider[]
  operatories: Operatory[]
  patients: Patient[]
  appointmentTypes: { type: string; durationMin: number; defaultUrgency: Urgency }[]
  appointments: Appointment[]
  rules: AvailabilityRule[]
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error ?? ''
    } catch {
      /* ignore non-JSON bodies */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export function postSchedule(request: string, refDate?: string): Promise<ScheduleResponse> {
  return fetch('/api/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request, refDate }),
  }).then((r) => jsonOrThrow<ScheduleResponse>(r))
}

export function getState(): Promise<StateResponse> {
  return fetch('/api/state').then((r) => jsonOrThrow<StateResponse>(r))
}

export function postBook(
  slot: CandidateSlot,
  patientId: string,
): Promise<{ appointment: Appointment; appointments: Appointment[] }> {
  return fetch('/api/book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot, patientId }),
  }).then((r) => jsonOrThrow(r))
}

// --- formatting helpers (slot.start is local ISO "YYYY-MM-DDTHH:mm:ss") ---

export function fmtWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short' })
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
