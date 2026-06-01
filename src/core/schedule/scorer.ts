import type { CandidateSlot, ScoredSlot, ScoreFactor, SchedulingIntent } from "../types";
import type { ScheduleStore } from "../store/ScheduleStore";
import { weekdayOf } from "../time";

const HORIZON_DAYS = 5;

export interface ScoreOptions {
  refDate?: string; // anchor for "soonness"
}

/**
 * Score a single candidate slot against the patient's intent. Deterministic:
 * the same slot + intent always yields the same score. The explanation is
 * built from the SAME factors that drive the score, so it can never lie about
 * why a slot ranked where it did.
 */
export function scoreSlot(
  slot: CandidateSlot,
  intent: SchedulingIntent,
  store: ScheduleStore,
  opts: ScoreOptions = {},
): ScoredSlot {
  const refDate = opts.refDate ?? new Date().toISOString().slice(0, 10);

  const factors: ScoreFactor[] = [
    timeWindowFactor(slot, intent),
    datePreferenceFactor(slot, intent),
    urgencyFactor(slot, intent, refDate),
    preferredProviderFactor(slot, intent, store),
    equipmentFactor(slot, store),
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0));

  // Highlights = factors that satisfied a REAL constraint (neutral details
  // start with "No ", so we drop those from the human explanation).
  const highlights = factors
    .filter((f) => f.matched && f.contribution > 0 && !f.detail.startsWith("No "))
    .map((f) => f.detail);

  const explanation =
    `${weekdayOf(slot.start)} at ${formatTime(slot.start)}` +
    (highlights.length ? ` — ${highlights.join("; ")}` : "");

  return { slot, score, factors, explanation };
}

function timeWindowFactor(slot: CandidateSlot, intent: SchedulingIntent): ScoreFactor {
  const weight = 35;
  const mins = minutesOfDay(slot.start);
  const hasConstraint = Boolean(intent.timeEarliest || intent.timeLatest || intent.partOfDay);
  if (!hasConstraint) {
    return factor("time_window_match", weight, true, weight, "No specific time requested");
  }
  let ok = true;
  if (intent.timeEarliest && mins < minutesFromHHmm(intent.timeEarliest)) ok = false;
  if (intent.timeLatest && mins > minutesFromHHmm(intent.timeLatest)) ok = false;
  if (intent.partOfDay && !inPartOfDay(mins, intent.partOfDay)) ok = false;
  const want = intent.timeEarliest
    ? `after ${formatTimeHHmm(intent.timeEarliest)}`
    : intent.timeLatest
      ? `before ${formatTimeHHmm(intent.timeLatest)}`
      : `in the ${intent.partOfDay}`;
  const detail = ok
    ? `${formatTime(slot.start)} fits your preference for ${want}`
    : `${formatTime(slot.start)} is outside your requested time (${want})`;
  return factor("time_window_match", weight, ok, ok ? weight : 0, detail);
}

function datePreferenceFactor(slot: CandidateSlot, intent: SchedulingIntent): ScoreFactor {
  const weight = 20;
  if (intent.daysOfWeek.length === 0) {
    return factor("date_preference", weight, true, weight, "No specific day requested");
  }
  const wd = weekdayOf(slot.start);
  const ok = intent.daysOfWeek.includes(wd);
  const detail = ok
    ? `falls on ${wd}, a day you asked for`
    : `is on ${wd}, not one of your requested days`;
  return factor("date_preference", weight, ok, ok ? weight : 0, detail);
}

function urgencyFactor(slot: CandidateSlot, intent: SchedulingIntent, refDate: string): ScoreFactor {
  const weight = 25;
  const days = daysBetween(refDate, slot.start.slice(0, 10));
  const soonness = clamp(1 - days / HORIZON_DAYS, 0, 1); // sooner = higher
  const contribution = weight * soonness;
  if (intent.urgency === "urgent") {
    const ok = soonness >= 0.7;
    const detail = `Urgent: prioritizing the earliest opening (${days === 0 ? "today" : `in ${days} day(s)`})`;
    return factor("urgency_fit", weight, ok, contribution, detail);
  }
  return factor("urgency_fit", weight, true, contribution, `Available in ${days} day(s)`);
}

function preferredProviderFactor(
  slot: CandidateSlot,
  intent: SchedulingIntent,
  store: ScheduleStore,
): ScoreFactor {
  const weight = 15;
  if (!intent.preferredProviderId) {
    return factor("preferred_provider", weight, true, weight, "No provider preference");
  }
  const ok = slot.providerId === intent.preferredProviderId;
  const name = providerName(slot.providerId, store);
  const detail = ok
    ? `with ${name}, your preferred provider`
    : `with ${name} (you asked for ${providerName(intent.preferredProviderId, store)})`;
  return factor("preferred_provider", weight, ok, ok ? weight : 0, detail);
}

function equipmentFactor(slot: CandidateSlot, store: ScheduleStore): ScoreFactor {
  const weight = 5;
  const needsXray = slot.type === "extraction" || slot.type === "emergency";
  if (!needsXray) {
    return factor("operatory_equipment", weight, true, weight, "No special equipment needed");
  }
  const op = store.getOperatories().find((o) => o.id === slot.operatoryId);
  const ok = Boolean(op?.equipment.includes("xray"));
  const detail = ok ? "in an X-ray-equipped room" : "room lacks X-ray equipment";
  return factor("operatory_equipment", weight, ok, ok ? weight : 0, detail);
}

// --- helpers ---

function factor(
  name: string,
  weight: number,
  matched: boolean,
  contribution: number,
  detail: string,
): ScoreFactor {
  return { name, weight, matched, contribution, detail };
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function minutesFromHHmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}
function inPartOfDay(mins: number, part: "morning" | "afternoon" | "evening"): boolean {
  if (part === "morning") return mins < 12 * 60;
  if (part === "afternoon") return mins >= 12 * 60 && mins < 17 * 60;
  return mins >= 17 * 60;
}
function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(`${dateA}T00:00:00`).getTime();
  const b = new Date(`${dateB}T00:00:00`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function providerName(id: string, store: ScheduleStore): string {
  return store.getProviders().find((p) => p.id === id)?.name ?? id;
}
function formatTime(iso: string): string {
  return formatTimeHHmm(iso.slice(11, 16));
}
function formatTimeHHmm(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h! >= 12 ? "PM" : "AM";
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
