import * as chrono from "chrono-node";
import type { ScheduleStore } from "../store/ScheduleStore";
import type { SchedulingIntent, Urgency, Weekday } from "../types";
import type { IntentContext, IntentExtractor } from "./IntentExtractor";
import { weekdayOf } from "../time";
import { classifyUrgency, type TriageSkill } from "../skills/triage";

const URGENCY_RANK: Record<Urgency, number> = { routine: 0, soon: 1, urgent: 2 };
function mostSevere(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

/**
 * The OFFLINE BRAIN — and the cost-saver.
 *
 * Turns a raw request into a structured SchedulingIntent using only
 * deterministic parsing: chrono-node for dates, regex/keyword tables for the
 * rest. NO LLM, NO network. This same class powers "Claude is offline" mode
 * AND lets the system skip the API entirely on requests it can resolve with
 * high confidence — the two reasons it exists are really one mechanism.
 *
 * `confidence` reports how much of the request it actually pinned down, so the
 * tiered layer can decide whether to escalate to the LLM.
 */
export class RuleBasedIntentExtractor implements IntentExtractor {
  /**
   * @param triageSkill Optional dental-triage Agent Skill. When supplied, the
   * symptom-based urgency it derives is combined with the timing keywords (the
   * more severe wins). Omit it and urgency is keyword-only — existing behavior.
   */
  constructor(private readonly triageSkill?: TriageSkill) {}

  extract(request: string, ctx: IntentContext): SchedulingIntent {
    const text = request.toLowerCase();

    const { earliestDate, latestDate, daysOfWeek, dateResolved } = this.parseDates(request, ctx);
    const { timeEarliest, timeLatest, partOfDay, timeResolved } = parseTimeWindow(text);
    const appointmentType = parseType(text);
    // Timing keywords ("today", "asap") + the triage skill's clinical judgment
    // ("swelling" → urgent). The skill can only raise severity, never lower it.
    const keywordUrgency = parseUrgency(text);
    const urgency = this.triageSkill
      ? mostSevere(keywordUrgency, classifyUrgency(text, this.triageSkill).urgency)
      : keywordUrgency;
    const preferredProviderId = parseProvider(text, ctx.store);

    // Confidence = how many independent signals we managed to resolve.
    const signals = [
      dateResolved,
      timeResolved,
      appointmentType !== null,
      preferredProviderId !== null,
      urgency !== "routine",
    ].filter(Boolean).length;
    const confidence = clamp(0.3 + 0.18 * signals, 0, 0.95);

    return {
      appointmentType,
      urgency,
      earliestDate,
      latestDate,
      daysOfWeek,
      timeEarliest,
      timeLatest,
      partOfDay,
      preferredProviderId,
      rawRequest: request,
      source: "rules",
      confidence,
    };
  }

  private parseDates(
    request: string,
    ctx: IntentContext,
  ): {
    earliestDate: string | null;
    latestDate: string | null;
    daysOfWeek: Weekday[];
    dateResolved: boolean;
  } {
    const ref = new Date(`${ctx.refDate}T12:00:00`); // noon anchor avoids tz edges
    const results = chrono.parse(request, ref, { forwardDate: true });
    if (results.length === 0) {
      return { earliestDate: null, latestDate: null, daysOfWeek: [], dateResolved: false };
    }

    // MORE THAN ONE date reference ("a tuesday or thursday in late july" →
    // tuesday + thursday + july) is beyond what this deterministic parser can
    // faithfully combine. Grabbing results[0] would pin the wrong day (often
    // ~today) and silently drop the rest. Declare the date UNRESOLVED so the
    // tiered extractor escalates to the LLM (which reconciles them correctly);
    // offline we then search unconstrained rather than confidently wrong.
    if (results.length > 1) {
      return { earliestDate: null, latestDate: null, daysOfWeek: [], dateResolved: false };
    }

    const first = results[0]!;
    const startDate = localDateStr(first.start.date());

    // An explicit range ("between Mon and Wed") carries an end component.
    if (first.end) {
      return {
        earliestDate: startDate,
        latestDate: localDateStr(first.end.date()),
        daysOfWeek: [],
        dateResolved: true,
      };
    }

    // A NAMED weekday ("next Thursday") is one specific day → pin it and
    // constrain to that weekday so only that day is searched.
    if (first.start.isCertain("weekday")) {
      return {
        earliestDate: startDate,
        latestDate: startDate,
        daysOfWeek: [weekdayOf(`${startDate}T00:00:00`)],
        dateResolved: true,
      };
    }

    // A relative SPAN ("next week"/"next month") points at the start of the
    // span — widen latestDate and DON'T constrain the weekday, so the whole
    // span is searched. Bare single days ("today"/"tomorrow") stay one day.
    const matched = first.text.toLowerCase();
    let latestDate = startDate;
    if (/\bweek\b/.test(matched)) latestDate = addDaysStr(startDate, 6);
    else if (/\bmonth\b/.test(matched)) latestDate = addDaysStr(startDate, 27);

    return { earliestDate: startDate, latestDate, daysOfWeek: [], dateResolved: true };
  }
}

// --- time window ---

function parseTimeWindow(text: string): {
  timeEarliest: string | null;
  timeLatest: string | null;
  partOfDay: "morning" | "afternoon" | "evening" | null;
  timeResolved: boolean;
} {
  let partOfDay: "morning" | "afternoon" | "evening" | null = null;
  if (/\bmornings?\b/.test(text)) partOfDay = "morning";
  else if (/\bafternoons?\b/.test(text)) partOfDay = "afternoon";
  else if (/\b(evenings?|nights?)\b/.test(text)) partOfDay = "evening";

  let timeEarliest: string | null = null;
  let timeLatest: string | null = null;

  const after = text.match(/\b(?:after|from|later than|past)\s+(noon|midday|\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (after) timeEarliest = toHHmm(after[1]!, after[2], after[3]);

  const before = text.match(/\b(?:before|by|until|til|till|earlier than)\s+(noon|midday|\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (before) timeLatest = toHHmm(before[1]!, before[2], before[3]);

  const timeResolved = timeEarliest !== null || timeLatest !== null || partOfDay !== null;
  return { timeEarliest, timeLatest, partOfDay, timeResolved };
}

/**
 * Normalize a matched time to "HH:mm". Explicit am/pm wins; otherwise apply a
 * clinic-hours heuristic: bare 1–7 means afternoon (dental offices open 8–17),
 * 8–11 means morning, 12 means noon.
 */
function toHHmm(hourTok: string, minTok: string | undefined, ampm: string | undefined): string {
  if (hourTok === "noon" || hourTok === "midday") return "12:00";
  let h = parseInt(hourTok, 10);
  const m = minTok ? parseInt(minTok, 10) : 0;
  if (ampm === "pm") h = h === 12 ? 12 : h + 12;
  else if (ampm === "am") h = h === 12 ? 0 : h;
  else if (h >= 1 && h <= 7) h += 12; // bare "after 3" → 15:00
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// --- keyword tables ---

function parseType(text: string): string | null {
  if (/\b(clean|cleaned|cleaning|hygiene)\b/.test(text)) return "cleaning";
  if (/\b(check ?-? ?up|exam)\b/.test(text)) return "checkup";
  if (/\b(cavity|filling|fill)\b/.test(text)) return "filling";
  if (/\b(extract|extraction|pull|wisdom)\b/.test(text)) return "extraction";
  // Only genuine symptom/trauma words imply an emergency visit — NOT a bare
  // mention of "tooth"/"teeth", which appears in routine requests too
  // ("get my teeth cleaned", "a tooth checkup").
  if (/\b(ache|aching|hurts?|pain|killing|broke|broken|chipped|cracked|emergency)\b/.test(text)) {
    return "emergency";
  }
  return null;
}

function parseUrgency(text: string): Urgency {
  if (
    /\b(pain|killing|kill|emergency|asap|urgent|today|broke|broken|swollen|swelling|bleeding|abscess|throbbing|right now)\b/.test(
      text,
    )
  ) {
    return "urgent";
  }
  if (/\b(soon|this week|as soon|quickly|sooner)\b/.test(text)) return "soon";
  return "routine";
}

function parseProvider(text: string, store: ScheduleStore): string | null {
  for (const p of store.getProviders()) {
    const surname = p.name.split(/\s+/).pop()!.toLowerCase(); // "Dr. Smith" → "smith"
    if (new RegExp(`\\b${surname}\\b`).test(text)) return p.id;
  }
  return null;
}

// --- helpers ---

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
