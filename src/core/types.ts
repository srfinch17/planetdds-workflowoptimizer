// Shared domain types. Defined once, imported everywhere.
// These shapes are the contract between every agent and the data store.

export type Urgency = "routine" | "soon" | "urgent";
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface Provider {
  id: string;
  name: string;
  role: "dentist" | "hygienist";
  specialties: string[];
  workdays: Weekday[];
  hours: { start: string; end: string }; // "HH:mm"
}

export interface Operatory {
  id: string;
  name: string;
  equipment: string[];
}

export interface AppointmentType {
  type: string;
  durationMin: number;
  defaultUrgency: Urgency;
}

export interface Patient {
  id: string;
  name: string;
  preferredProviderId: string | null;
  phone?: string;
}

export interface Appointment {
  id: string;
  providerId: string;
  operatoryId: string;
  patientId: string;
  start: string; // ISO local "YYYY-MM-DDTHH:mm:ss"
  end: string;
  type: string;
}

// A constraint on when a provider is available.
// HARD constraint: enforced deterministically, never left to the LLM.
export interface AvailabilityRule {
  id: string;
  providerId: string;
  // dayoff: provider does NOT work this weekday. workday: provider DOES work
  // this weekday (can add a day not in base hours). block: a recurring time
  // block on working days (e.g. lunch). closure: the whole office is closed for
  // a date range (providerId "office") — overrides everything.
  kind: "block" | "dayoff" | "workday" | "closure";
  recurrence?: "daily";
  weekday?: Weekday;
  start?: string; // "HH:mm" — block start, or custom working-hours start for a workday
  end?: string; // "HH:mm" — block end, or custom working-hours end for a workday
  startDate?: string; // "YYYY-MM-DD" — closure start (inclusive)
  endDate?: string; // "YYYY-MM-DD" — closure end (inclusive)
  reason: string;
  createdAt?: string; // ISO; newest rule wins when two rules conflict (missing = oldest)
}

// The structured output of the Intent Agent.
export interface SchedulingIntent {
  appointmentType: string | null;
  urgency: Urgency;
  earliestDate: string | null; // ISO date "YYYY-MM-DD"
  latestDate: string | null;
  daysOfWeek: Weekday[];
  timeEarliest: string | null; // "HH:mm"
  timeLatest: string | null; // "HH:mm"
  partOfDay: "morning" | "afternoon" | "evening" | null;
  preferredProviderId: string | null;
  rawRequest: string;
  source: "rules" | "llm"; // which path produced this (offline transparency)
  confidence: number; // 0..1
}

// A candidate slot that satisfies all HARD constraints (pre-scoring).
export interface CandidateSlot {
  providerId: string;
  operatoryId: string;
  start: string; // ISO local
  end: string;
  type: string;
}

// One scoring dimension, kept for explainability.
export interface ScoreFactor {
  name: string;
  weight: number;
  matched: boolean;
  detail: string; // human-readable reason
  contribution: number; // points this factor added to the score
  // true when this factor was satisfied only because the patient expressed NO
  // constraint on it (e.g. "any time works"). Such factors still score, but are
  // kept out of the headline explanation so it highlights real matches.
  neutral?: boolean;
}

// A ranked recommendation: a slot + why it ranked where it did.
export interface ScoredSlot {
  slot: CandidateSlot;
  score: number; // 0..100
  factors: ScoreFactor[];
  explanation: string; // plain-English, built from the matched factors
}

// The reasoning agent's answer: the top-N ranked slots, plus an honesty flag.
export interface Recommendation {
  slots: ScoredSlot[];
  // true when NO slot fully satisfied the requested time window — we returned
  // the closest-scoring slots anyway rather than nothing. Keeps the demo honest.
  bestEffort: boolean;
  // When the patient named a provider, this echoes it so the UI can group the
  // results into "your dentist" (matching slots, listed first) vs alternatives.
  preferredProviderId?: string | null;
}

// --- Emergency escalation ---
// A patient message (voice/text/chat — all arrive as text) can describe a
// clinical emergency. Detection is tiered, most-severe first:
//   "emergency" = potential medical emergency (airway/breathing/swallowing,
//                 uncontrolled bleeding) → advise 911 + immediate office callback.
//   "callback"  = urgent same-day dental need (swelling/abscess, knocked-out
//                 tooth, severe pain) → office calls back ASAP to arrange care.
//   "none"      = normal scheduling.
export type EscalationLevel = "emergency" | "callback" | "none";

export interface Escalation {
  level: EscalationLevel;
  headline: string; // short banner title
  message: string; // patient-facing directive
  callbackRequired: boolean; // true → put on the staff callback queue
  matched: string | null; // the symptom phrase that triggered it (explainability)
}
