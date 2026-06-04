// Typed client for the Hono backend. These shapes MIRROR src/core/types.ts on
// the server — keeping them in sync by hand is fine for a demo this size. All
// calls go to same-origin "/api/..." which Vite proxies to localhost:3000.

export type Urgency = 'routine' | 'soon' | 'urgent'
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

export type SchedulingAction = 'book' | 'cancel' | 'reschedule'

export interface SchedulingIntent {
  action: SchedulingAction
  appointmentType: string | null
  urgency: Urgency
  earliestDate: string | null
  latestDate: string | null
  daysOfWeek: Weekday[]
  timeEarliest: string | null
  timeLatest: string | null
  partOfDay: 'morning' | 'afternoon' | 'evening' | null
  preferredProviderId: string | null
  patientName: string | null
  patientPhone: string | null
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

export interface AppointmentSummary {
  id: string
  start: string
  end: string
  type: string
  providerId: string
  providerName: string
}

export interface PatientMatch {
  found: boolean
  patientId: string | null
  name: string | null
}

export interface ScheduleResponse {
  intent: SchedulingIntent
  recommendation: Recommendation
  pathTaken: IntentPath
  escalation: Escalation
  requestId: string
  // Set when this request queued a staff callback — lets the patient attach
  // their contact info to it if they didn't state a name/phone.
  callbackId: string | null
  // Present for cancel/reschedule requests.
  patientMatch: PatientMatch | null
  appointments: AppointmentSummary[] | null
}

export type EventType = 'schedule_request' | 'escalation' | 'booking' | 'rule_added' | 'queue_dismissed' | 'error'

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
  bookings: { booked: number; conflict: number; cancelled: number; rescheduled: number }
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
  patientName: string | null // who to call back (null = no contact left yet)
  patientPhone: string | null
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
  phone?: string
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

export type RuleKind = 'block' | 'dayoff' | 'workday' | 'closure' | 'timeoff'

export interface AvailabilityRule {
  id: string
  providerId: string
  kind: RuleKind
  recurrence?: 'daily'
  weekday?: Weekday
  start?: string
  end?: string
  startDate?: string
  endDate?: string
  reason: string
  createdAt?: string
}

// Recurring/structural constraints are "rules"; one-time dated overrides
// (an office closure or a single provider's time-off) are "adjustments".
export function ruleCategory(kind: RuleKind): 'rule' | 'adjustment' {
  return kind === 'closure' || kind === 'timeoff' ? 'adjustment' : 'rule'
}

export interface RescheduleRecord {
  id: string
  appointment: Appointment
  reason: string
  flaggedAt: string
}

export interface StateResponse {
  providers: Provider[]
  operatories: Operatory[]
  patients: Patient[]
  appointmentTypes: { type: string; durationMin: number; defaultUrgency: Urgency }[]
  appointments: Appointment[]
  rules: AvailabilityRule[]
  reschedule: RescheduleRecord[]
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
  online: boolean
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

export type ExtractionMode = 'tiered' | 'llm' | 'rules'

export function postSchedule(
  request: string,
  refDate?: string,
  mode?: ExtractionMode,
  patient?: { name?: string; phone?: string },
  appointmentType?: string,
): Promise<ScheduleResponse> {
  return fetch('/api/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Send the patient-details bar too: if a request escalates to a callback,
    // the server uses it as the contact to call back. appointmentType is the
    // patient's procedure pick when their request didn't name one.
    body: JSON.stringify({ request, refDate, mode, patientName: patient?.name, patientPhone: patient?.phone, appointmentType }),
  }).then((r) => jsonOrThrow<ScheduleResponse>(r))
}

// One open 30-minute start + the procedures that can actually be booked there
// (longer ones only when the following slot is free and the provider/room is
// eligible). Powers the Admin per-slot booking dropdown.
export interface SlotOption {
  type: string
  durationMin: number
  operatoryId: string
  end: string
}
export interface OpenSlot {
  providerId: string
  start: string
  options: SlotOption[]
}

export function getSlotOptions(from: string, to?: string): Promise<{ slotsByDay: Record<string, OpenSlot[]> }> {
  const q = new URLSearchParams({ from })
  if (to) q.set('to', to)
  return fetch(`/api/slot-options?${q}`).then((r) => jsonOrThrow<{ slotsByDay: Record<string, OpenSlot[]> }>(r))
}

// Attach the patient's contact info to a queued callback (when an escalation
// fired before they gave a name/number).
export function postCallbackContact(
  id: string,
  name: string,
  phone: string,
): Promise<{ ok: boolean; callbacks: CallbackRecord[] }> {
  return fetch('/api/callbacks/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name, phone }),
  }).then((r) => jsonOrThrow(r))
}

export function getState(): Promise<StateResponse> {
  return fetch('/api/state').then((r) => jsonOrThrow<StateResponse>(r))
}

// Open slots for booking, grouped by day. Used to (a) know which days a
// constrained request can actually book, and (b) list every open time on a day.
export function getAvailability(params: {
  from: string
  to?: string
  type?: string | null
  days?: Weekday[]
}): Promise<{ slotsByDay: Record<string, CandidateSlot[]> }> {
  const q = new URLSearchParams()
  q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  if (params.type) q.set('type', params.type)
  if (params.days && params.days.length) q.set('days', params.days.join(','))
  return fetch(`/api/availability?${q}`).then((r) =>
    jsonOrThrow<{ slotsByDay: Record<string, CandidateSlot[]> }>(r),
  )
}

export function getMetrics(): Promise<MetricsResponse> {
  return fetch('/api/metrics').then((r) => jsonOrThrow<MetricsResponse>(r))
}

export function getCallbacks(): Promise<{ callbacks: CallbackRecord[] }> {
  return fetch('/api/callbacks').then((r) => jsonOrThrow<{ callbacks: CallbackRecord[] }>(r))
}

// Dismiss a callback once staff have phoned the patient and handled it (the
// entry is removed and the dismissal is logged).
export function dismissCallback(id: string): Promise<{ ok: boolean; callbacks: CallbackRecord[] }> {
  return fetch(`/api/callbacks/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) =>
    jsonOrThrow<{ ok: boolean; callbacks: CallbackRecord[] }>(r),
  )
}

// Dismiss a "needs rescheduling" entry once staff have rebooked the patient.
export function dismissReschedule(id: string): Promise<{ ok: boolean; reschedule: RescheduleRecord[] }> {
  return fetch(`/api/reschedule/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) =>
    jsonOrThrow<{ ok: boolean; reschedule: RescheduleRecord[] }>(r),
  )
}

export type RuleConflict = { existingRule: AvailabilityRule; message: string }
export type PostRuleResult =
  | { ok: true; rule: AvailabilityRule; source: 'rules' | 'llm'; rules: AvailabilityRule[]; rescheduled: number }
  | { ok: false; conflict: RuleConflict }

export async function postRule(sentence: string, override = false): Promise<PostRuleResult> {
  const res = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sentence, override }),
  })
  if (res.status === 409) {
    const body = (await res.json()) as { conflict: RuleConflict }
    return { ok: false, conflict: body.conflict }
  }
  const data = await jsonOrThrow<{
    rule: AvailabilityRule
    source: 'rules' | 'llm'
    rules: AvailabilityRule[]
    rescheduled?: number
  }>(res)
  return { ok: true, ...data, rescheduled: data.rescheduled ?? 0 }
}

export function deleteRule(id: string): Promise<{ rules: AvailabilityRule[] }> {
  return fetch(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) =>
    jsonOrThrow<{ rules: AvailabilityRule[] }>(r),
  )
}

export function resetSystem(): Promise<{ ok: boolean }> {
  return fetch('/api/reset', { method: 'POST' }).then((r) => jsonOrThrow<{ ok: boolean }>(r))
}

export function postBook(
  slot: CandidateSlot,
  patient: { name: string; phone?: string },
  requestId?: string,
): Promise<{ appointment: Appointment; appointments: Appointment[]; confirmationNumber: string }> {
  return fetch('/api/book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slot, patientName: patient.name, patientPhone: patient.phone, requestId }),
  }).then((r) => jsonOrThrow(r))
}

export function postCancel(
  appointmentId: string,
  patientId: string,
): Promise<{ ok: boolean; appointments: Appointment[] }> {
  return fetch('/api/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appointmentId, patientId }),
  }).then((r) => jsonOrThrow(r))
}

export function postReschedule(
  oldAppointmentId: string,
  slot: CandidateSlot,
  patientId: string,
): Promise<{ appointment: Appointment; cancelledId: string; appointments: Appointment[]; confirmationNumber: string }> {
  return fetch('/api/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oldAppointmentId, slot, patientId }),
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
