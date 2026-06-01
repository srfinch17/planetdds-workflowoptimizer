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
  kind: "block" | "dayoff";
  recurrence?: "daily";
  weekday?: Weekday;
  start?: string; // "HH:mm" (for kind "block")
  end?: string; // "HH:mm" (for kind "block")
  reason: string;
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
}
