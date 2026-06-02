import * as chrono from "chrono-node";
import type { ScheduleStore } from "../store/ScheduleStore";
import type { Weekday } from "../types";
import type { LlmClient } from "../llm/anthropicClient";
import type { CostTracker } from "../llm/costTracker";
import { parseLlmRule, resolveProviderId, type RuleDraft } from "./ruleSchema";

const WEEKDAY_WORDS: Record<string, Weekday> = {
  mon: "Mon", monday: "Mon",
  tue: "Tue", tues: "Tue", tuesday: "Tue",
  wed: "Wed", weds: "Wed", wednesday: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu",
  fri: "Fri", friday: "Fri",
  sat: "Sat", saturday: "Sat",
  sun: "Sun", sunday: "Sun",
};

/**
 * The OFFLINE rule parser — the cost-saver and the "Claude is offline" path for
 * rule teaching, mirroring the intent extractor. Recognizes the two common
 * shapes deterministically; returns null when it can't, so the caller can
 * decide whether to escalate to the LLM. Same precise-vocabulary point as the
 * scheduler: hard constraints are STRUCTURED DATA, the parser just translates.
 */
export function regexParseRule(sentence: string, store: ScheduleStore): RuleDraft | null {
  const text = sentence.toLowerCase();

  // --- office closure (no provider): "office closed Aug 4–6 for plumbing" ---
  if (/\b(office|practice|clinic)\b/.test(text) && /\b(closed|close|closure|shut|shutdown)\b/.test(text)) {
    const range = parseClosureDates(sentence);
    if (range) {
      return {
        providerId: "office",
        kind: "closure",
        startDate: range.start,
        endDate: range.end,
        reason: closureReason(text),
      };
    }
  }

  const providerId = findProvider(text, store);
  if (!providerId) return null;

  // --- day off: "never works Fridays", "is off on Mondays", "doesn't work Fri" ---
  if (/\b(never works?|doesn'?t work|does not work|off on|out on|no hours|not in)\b/.test(text)) {
    const weekday = findWeekday(text);
    if (weekday) {
      return { providerId, kind: "dayoff", weekday, reason: `off on ${weekday}` };
    }
  }

  // --- workday add: "now works Saturdays", "works on Saturdays", optional hours ---
  if (/\b(works?|working|is available|available)\b/.test(text)) {
    const weekday = findWeekday(text);
    if (weekday) {
      const span = text.match(
        /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|till|-|–|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
      );
      const rule: RuleDraft = { providerId, kind: "workday", weekday, reason: `works ${weekday}` };
      if (span) {
        rule.start = toHHmm(span[1]!, span[2], span[3]);
        rule.end = toHHmm(span[4]!, span[5], span[6]);
      }
      return rule;
    }
  }

  // --- time block: "lunch from 11 to 12:30", "blocked 2 to 3 every day" ---
  const span = text.match(
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|till|-|–|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (span) {
    const start = toHHmm(span[1]!, span[2], span[3]);
    const end = toHHmm(span[4]!, span[5], span[6]);
    // The data model's blocks are daily-recurring (no single-date block concept),
    // so a parsed time block is always recorded as a daily block.
    const reason = labelFor(text);
    return { providerId, kind: "block", recurrence: "daily", start, end, reason };
  }

  return null;
}

export type ParseRuleSentenceResult =
  | { ok: true; rule: RuleDraft; source: "rules" | "llm" }
  | { ok: false; error: string };

export interface ParseRuleOptions {
  llm?: LlmClient;
  costTracker?: CostTracker;
}

/**
 * Turn an admin's English sentence into a structured rule.
 *   1. Try the free deterministic regex parser (offline, $0).
 *   2. If it can't parse AND an LLM is available, ask the model to translate —
 *      then validate its JSON through the Zod boundary before trusting it.
 *   3. Otherwise return a helpful error the UI shows as "couldn't parse."
 * The LLM never invents a constraint that bypasses validation.
 */
export async function parseRuleSentence(
  sentence: string,
  store: ScheduleStore,
  opts: ParseRuleOptions = {},
): Promise<ParseRuleSentenceResult> {
  const offline = regexParseRule(sentence, store);
  if (offline) return { ok: true, rule: offline, source: "rules" };

  if (!opts.llm) {
    return {
      ok: false,
      error: "Couldn't parse that rule. Try e.g. \"Dr. Smith takes lunch from 11 to 12:30 every day\" or \"Dr. Pana never works Fridays.\"",
    };
  }

  try {
    const system = buildSystemPrompt(store);
    const completion = await opts.llm.complete({ system, user: sentence });
    opts.costTracker?.record(completion.usage);
    const json = extractJson(completion.text);
    const validated = parseLlmRule(json, store);
    if (!validated.ok) return { ok: false, error: validated.error };
    return { ok: true, rule: validated.rule, source: "llm" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "rule parsing failed" };
  }
}

// --- helpers ---

function findProvider(text: string, store: ScheduleStore): string | null {
  for (const p of store.getProviders()) {
    const surname = p.name.split(/\s+/).pop()!.toLowerCase();
    if (new RegExp(`\\b${surname}\\b`).test(text)) return p.id;
  }
  return null;
}

function findWeekday(text: string): Weekday | null {
  // Match the longest weekday word present (so "thursday" wins over "thu").
  const tokens = text.match(/[a-z]+/g) ?? [];
  for (const t of tokens) {
    const w = WEEKDAY_WORDS[t] ?? WEEKDAY_WORDS[t.replace(/s$/, "")];
    if (w) return w;
  }
  return null;
}

function labelFor(text: string): string {
  if (/\blunch\b/.test(text)) return "lunch";
  if (/\bbreak\b/.test(text)) return "break";
  if (/\bmeeting\b/.test(text)) return "meeting";
  if (/\badmin\b/.test(text)) return "admin time";
  return "blocked";
}

/** Parse a closure date range with chrono ("Aug 4 to 6", "August 4"). */
function parseClosureDates(sentence: string): { start: string; end: string } | null {
  const results = chrono.parse(sentence, new Date(), { forwardDate: true });
  if (results.length === 0) return null;
  const r = results[0]!;
  const start = localDate(r.start.date());
  const end = r.end ? localDate(r.end.date()) : start;
  return { start, end };
}
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function closureReason(text: string): string {
  const m = text.match(/\bfor\s+([a-z][a-z\s]{2,30})/);
  return m ? `closed — ${m[1]!.trim()}` : "office closed";
}

/**
 * Normalize a matched time to "HH:mm". Explicit am/pm wins; otherwise a clinic
 * heuristic: a bare 1–7 means afternoon (offices open ~8–17). Same rule the
 * intent parser uses, kept local so the two modules stay independent.
 */
function toHHmm(hourTok: string, minTok: string | undefined, ampm: string | undefined): string {
  let h = parseInt(hourTok, 10);
  const m = minTok ? parseInt(minTok, 10) : 0;
  if (ampm === "pm") h = h === 12 ? 12 : h + 12;
  else if (ampm === "am") h = h === 12 ? 0 : h;
  else if (h >= 1 && h <= 7) h += 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildSystemPrompt(store: ScheduleStore): string {
  const providers = store
    .getProviders()
    .map((p) => `- ${p.name} (id ${p.id})`)
    .join("\n");
  return [
    "You convert one English sentence from a dental-office admin into a single scheduling rule.",
    "Return ONLY a JSON object, no prose. Shape:",
    '{ "providerName": string, "kind": "block" | "dayoff", "recurrence": "daily" | null,',
    '  "weekday": "Mon|Tue|Wed|Thu|Fri|Sat|Sun" | null, "start": "HH:mm" | null,',
    '  "end": "HH:mm" | null, "reason": string }',
    'Use "block" for a recurring time the provider is unavailable (lunch, meeting); include start+end (24h).',
    'Use "dayoff" for a whole weekday the provider does NOT work; include weekday.',
    'Use "workday" for a weekday the provider DOES now work (adding a day); include weekday, and start+end only if custom hours are given.',
    'Use "closure" when the whole OFFICE is closed for dates (e.g. "office closed Aug 4-6"); set providerName to "office" and include startDate + endDate as YYYY-MM-DD.',
    "Providers:",
    providers,
  ].join("\n");
}

/** Pull the first {...} object out of the model's text (it may wrap it). */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in LLM response");
  return JSON.parse(text.slice(start, end + 1));
}
