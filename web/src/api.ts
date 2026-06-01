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
  preferredProviderId?: string | null
}

export type IntentPath = 'rules' | 'llm' | 'offline-fallback' | 'llm-failed-fallback' | null

export type EscalationLevel = 'emergency' | 'callback' | 'none'

export interface Escalation {
  level: EscalationLevel
  headline: string
  message: string
  callbackRequired: boolean
  matched: string | null
}

export interface ScheduleResponse {
  intent: SchedulingIntent
  recommendation: Recommendation
  pathTaken: IntentPath
  escalation: Escalation
  requestId: string
}

export type EventType = 'schedule_request' | 'escalation' | 'booking' | 'rule_added' | 'error'

export interface LogEvent {
  id: string
  ts: string
  type: EventType
  correlationId?: string
  data: Record<string, unknown>
}

export interface LogStats {
  total: number
  byType: Record<string, number>
  byPath: Record<string, number>
  escalations: { emergency: number; callback: number }
  bookings: { booked: number; conflict: number }
  errors: number
  perMinute: { t: string; count: number }[]
}

export interface ReplayResult {
  request: string
  refDate: string | null
  original: { recommendations: unknown[]; escalationLevel: string }
  current: { recommendations: { start: string; providerId: string; operatoryId: string; score: number }[]; escalationLevel: string }
  changed: boolean
}

export interface CallbackRecord {
  id: string
  request: string
  level: EscalationLevel
  headline: string
  matched: string | null
  createdAt: string
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

export interface MetricsResponse {
  requestsServed: number
  apiCalls: number
  freeHandled: number
  freeSharePct: number
  pathCounts: Record<string, number>
  estimatedUsd: number
  costPer1000Usd: number
  avgLatencyMs: number
  emergencyCallbacks: number
  tokenTotals: {
    calls: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
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

export function getMetrics(): Promise<MetricsResponse> {
  return fetch('/api/metrics').then((r) => jsonOrThrow<MetricsResponse>(r))
}

export function getCallbacks(): Promise<{ callbacks: CallbackRecord[] }> {
  return fetch('/api/callbacks').then((r) => jsonOrThrow<{ callbacks: CallbackRecord[] }>(r))
}

export function postRule(
  sentence: string,
): Promise<{ rule: AvailabilityRule; source: 'rules' | 'llm'; rules: AvailabilityRule[] }> {
  return fetch('/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sentence }),
  }).then((r) => jsonOrThrow(r))
}

export function postBook(
  slot: CandidateSlot,
  patientId: string,
  requestId?: string,
): Promise<{ appointment: Appointment; appointments: Appointment[] }> {
  return fetch('/api/book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot, patientId, requestId }),
  }).then((r) => jsonOrThrow(r))
}

export function getLogs(type?: EventType, limit = 100): Promise<{ events: LogEvent[] }> {
  const q = new URLSearchParams()
  if (type) q.set('type', type)
  q.set('limit', String(limit))
  return fetch(`/api/logs?${q}`).then((r) => jsonOrThrow<{ events: LogEvent[] }>(r))
}

export function getLogStats(): Promise<LogStats> {
  return fetch('/api/logs/stats').then((r) => jsonOrThrow<LogStats>(r))
}

export function replayLog(id: string): Promise<ReplayResult> {
  return fetch('/api/logs/replay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  }).then((r) => jsonOrThrow<ReplayResult>(r))
}

export function resetLogs(): Promise<{ ok: boolean }> {
  return fetch('/api/logs/reset', { method: 'POST' }).then((r) => jsonOrThrow<{ ok: boolean }>(r))
}

// Export is a direct download link (Vite proxies it to the backend).
export const LOG_EXPORT_JSON = '/api/logs/export?format=json'
export const LOG_EXPORT_CSV = '/api/logs/export?format=csv'

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
