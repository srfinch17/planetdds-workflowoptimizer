import * as chrono from "chrono-node";
import type { ScheduleStore } from "../store/ScheduleStore";
import type { SchedulingAction, SchedulingIntent, Urgency, Weekday } from "../types";
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

    const action = parseAction(text);

    const { earliestDate, latestDate, daysOfWeek, dateResolved } = this.parseDates(request, ctx);
    const { timeEarliest, timeLatest, partOfDay, timeResolved } = parseTimeWindow(text);
    const appointmentType = parseType(text);
    // Timing keywords ("today", "asap") + the triage skill's clinical judgment
    // ("swelling" → urgent). The skill can only raise severity, never lower it.
    const keywordUrgency = parseUrgency(text);
    const urgency = this.triageSkill
      ? mostSevere(keywordUrgency, classifyUrgency(text, this.triageSkill).urgency)
      : keywordUrgency;
    // Patient details parse off the ORIGINAL request (names are capitalized).
    const { patientName, patientPhone } = parsePatient(request);
    // Strip the patient's OWN name before matching providers, so "Frank Jones"
    // (the patient) isn't read as a request for Dr. Jones. A separate, explicit
    // "Dr. Jones" later in the text still matches.
    const providerText = patientName ? text.replace(patientName.toLowerCase(), " ") : text;
    const preferredProviderId = parseProvider(providerText, ctx.store);

    // Confidence = how many independent signals we resolved. This measures
    // BOOKING completeness (date / time / type / provider / urgency).
    const signals = [
      dateResolved,
      timeResolved,
      appointmentType !== null,
      preferredProviderId !== null,
      urgency !== "routine",
    ].filter(Boolean).length;
    let confidence = clamp(0.3 + 0.18 * signals, 0, 0.95);

    // Cancel / reschedule have a DIFFERENT notion of completeness: they need an
    // action + WHO to act on, not a date/time/type. Once the patient is
    // identified (name or phone), the rules already have everything required —
    // so keep it on the free deterministic path instead of paying for an LLM
    // call that would only confirm the same thing. When the patient is NOT
    // identified (e.g. a lowercase "this is jane doe" the capitalized-name regex
    // misses), stay low so the tiered router escalates to the LLM to recover it.
    if (action === "cancel" || action === "reschedule") {
      confidence = patientName !== null || patientPhone !== null ? 0.9 : 0.3;
    }

    // A booking request where the patient clearly SELF-IDENTIFIES (left a phone
    // number, or a "this is …" / "my name is …" lead) but we couldn't parse a
    // NAME deterministically — a lowercase or voice-garbled name the capitalized
    // regex misses. We're not actually confident, even if date/time/provider all
    // resolved: cap below the escalation threshold so the tiered router lets the
    // LLM recover the name (and phone). Offline, this simply degrades to manual
    // entry — the LLM is the best-effort path, never a hard requirement.
    if (action === "book" && patientName === null && selfIdentifies(request)) {
      confidence = Math.min(confidence, 0.5);
    }

    return {
      action,
      appointmentType,
      urgency,
      earliestDate,
      latestDate,
      daysOfWeek,
      timeEarliest,
      timeLatest,
      partOfDay,
      preferredProviderId,
      patientName,
      patientPhone,
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

    // A BARE MONTH NAME ("August", "in August", "mid August"). chrono pins it to
    // the 1st of the month and SILENTLY DROPS any "early/mid/late" qualifier, so
    // without this it would resolve to a single day (often a weekend with no
    // hours) and the reasoning agent would best-effort fall back to ~today — i.e.
    // "mid August" returns June. Detect it (month is certain; day, weekday and
    // year are not — which also distinguishes it from "next month", where the
    // year IS certain) and search the whole month, or the requested third of it.
    if (
      first.start.isCertain("month") &&
      !first.start.isCertain("day") &&
      !first.start.isCertain("weekday") &&
      !first.start.isCertain("year")
    ) {
      const d = first.start.date();
      const year = d.getFullYear();
      const monthIdx = d.getMonth(); // 0-based
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      const third = monthThird(request.toLowerCase(), first.text.toLowerCase());
      let firstDay = 1;
      let lastDay = daysInMonth;
      if (third === "early") lastDay = Math.min(10, daysInMonth);
      else if (third === "mid") (firstDay = 11), (lastDay = Math.min(20, daysInMonth));
      else if (third === "late") firstDay = 21;
      const mm = String(monthIdx + 1).padStart(2, "0");
      let earliest = `${year}-${mm}-${String(firstDay).padStart(2, "0")}`;
      const latest = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
      // Never search into the past for a bare current-month reference.
      if (earliest < ctx.refDate && ctx.refDate <= latest) earliest = ctx.refDate;
      return { earliestDate: earliest, latestDate: latest, daysOfWeek: [], dateResolved: true };
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

/**
 * Classify what the patient wants to DO. Cancel is checked first (most specific
 * and destructive); "change/move/switch" count as reschedule only when they're
 * clearly about an appointment, so "change to a cleaning" stays a normal booking.
 */
function parseAction(text: string): SchedulingAction {
  if (/\bcancel(l?ed|l?ing|lation)?\b/.test(text)) return "cancel";
  if (/\b(reschedul|re-?schedul|move|push|switch|rebook)/.test(text)) return "reschedule";
  if (/\bchange\b/.test(text) && /\b(appointment|appt|booking|visit)\b/.test(text)) return "reschedule";
  return "book";
}

/**
 * Pull the patient's own name + phone out of the request when they volunteer it
 * ("this is Frank Jones, 222-333-4455 ..."). Parsed from the ORIGINAL string so
 * a capitalized name can be told apart from ordinary words — that's what keeps
 * "this is killing me" from being read as a name.
 */
// A US-style 10-digit number, optional country code + separators. The strict
// 3-3-4 grouping means a bare date like "2026-07-21" can't masquerade as one,
// and a PARTIAL number (too few digits) won't match at all — so a phone is only
// captured when it's complete, exactly the "easy to test for completeness" rule.
const PHONE_RE = /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

// Words that commonly follow "this is …" / "i'm …" but are NOT names — so
// "this is killing me" / "this is urgent" / "this is an emergency" don't read as
// a self-identification. (A real lowercase name like "scott" isn't in here.)
const NON_NAME_AFTER_CUE = new Set([
  "killing", "hurting", "really", "very", "so", "an", "a", "the", "going", "getting",
  "calling", "having", "in", "out", "here", "there", "urgent", "fine", "good", "bad",
  "not", "my", "your", "for", "about", "gonna", "just", "still", "kind", "sort",
]);

/**
 * Does the patient appear to be SELF-IDENTIFYING — leaving contact details we
 * should try to capture? A complete phone number is an unambiguous signal; so is
 * a "this is …" / "my name is …" lead followed by a plausible name token (not a
 * symptom/filler word). Used to decide whether to let the LLM recover a name the
 * deterministic parser couldn't (lowercase, voice-garbled). Conservative on the
 * name cue to avoid escalating non-identifying phrases.
 */
function selfIdentifies(request: string): boolean {
  if (PHONE_RE.test(request)) return true;
  const m = request.match(/\b(?:this is|my name is|i['’]?m|i am|name['’]?s|name is)\s+([A-Za-z][\w'’.-]*)/i);
  return m ? !NON_NAME_AFTER_CUE.has(m[1]!.toLowerCase()) : false;
}

function parsePatient(request: string): { patientName: string | null; patientPhone: string | null } {
  const phone = request.match(PHONE_RE);
  const patientPhone = phone ? phone[0].trim() : null;

  // An intro phrase ("this is", "my name is", "I'm") followed by 1-3 Capitalized
  // words. Requiring an initial capital rejects "this is killing me".
  const name = request.match(
    /(?:[Tt]his is|[Mm]y name is|[Ii]['’]?m|[Ii] am|[Nn]ame['’]?s)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
  );
  const patientName = name ? name[1]!.trim() : null;

  return { patientName, patientPhone };
}

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

/**
 * Which third of a named month did the patient ask for? chrono discards the
 * "early/mid/late" qualifier, so we recover it from the original text by looking
 * for the modifier sitting next to the month name. Returns null for a bare month.
 */
function monthThird(lowerRequest: string, monthName: string): "early" | "mid" | "late" | null {
  const m = monthName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b(?:early|beginning|start|first half)(?:\\s+of)?\\s+(?:the\\s+)?${m}`).test(lowerRequest)) return "early";
  if (new RegExp(`\\b(?:mid|middle|halfway)(?:\\s+(?:of|through))?\\s*-?\\s*${m}`).test(lowerRequest)) return "mid";
  if (new RegExp(`\\b(?:late|end|second half)(?:\\s+of)?\\s+(?:the\\s+)?${m}`).test(lowerRequest)) return "late";
  return null;
}

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
