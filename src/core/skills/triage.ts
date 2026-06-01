import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Urgency, Escalation, EscalationLevel } from "../types";

/**
 * A loaded dental-triage Agent Skill. The judgment lives in the SKILL.md file;
 * this module just reads it and matches symptoms. Swap the file → swap the
 * behavior, with no code change. This is the "extensible intelligence" layer,
 * kept strictly separate from hard scheduling constraints (which are data the
 * scheduler enforces exactly).
 */
export interface TriageRule {
  keywords: string[];
  urgency: Urgency;
  escalation: "emergency" | "callback" | null;
  note: string;
}

export interface TriageSkill {
  name: string;
  description: string;
  rules: TriageRule[];
}

export interface TriageResult {
  urgency: Urgency;
  escalation: "emergency" | "callback" | null;
  matched: string | null; // the symptom keyword that fired (for explainability)
  note: string | null;
}

const URGENCIES: Urgency[] = ["routine", "soon", "urgent"];
const ESCALATIONS = ["emergency", "callback"] as const;

/** Read and parse a SKILL.md from a skill directory. */
export function loadTriageSkill(skillDir: string): TriageSkill {
  const raw = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
  const { frontmatter, body } = splitFrontmatter(raw);
  return {
    name: frontmatter.name ?? "triage",
    description: frontmatter.description ?? "",
    rules: parseTriageTable(body),
  };
}

/** The default dental-triage skill that ships with the app. */
export function loadDefaultTriageSkill(): TriageSkill {
  const dir = fileURLToPath(new URL("./dental-triage", import.meta.url));
  return loadTriageSkill(dir);
}

/**
 * Match a request against the skill's table. Rows are evaluated in order (most
 * severe first), so the first whole-word keyword match wins — that single rule
 * gives BOTH the urgency (for ranking) and the escalation (for the callback
 * directive). No match → routine, no escalation.
 */
export function triageRequest(request: string, skill: TriageSkill): TriageResult {
  const text = request.toLowerCase();
  for (const rule of skill.rules) {
    for (const kw of rule.keywords) {
      if (wordMatch(text, kw)) {
        return { urgency: rule.urgency, escalation: rule.escalation, matched: kw, note: rule.note };
      }
    }
  }
  return { urgency: "routine", escalation: null, matched: null, note: null };
}

/** Back-compat helper: just the urgency half of triageRequest. */
export function classifyUrgency(request: string, skill: TriageSkill): TriageResult {
  return triageRequest(request, skill);
}

// Patient-facing directives per escalation level. The LEVEL is the skill's
// clinical judgment; this wording is how the office chooses to communicate it.
const EMERGENCY_HEADLINE = "Possible medical emergency";
const EMERGENCY_MESSAGE =
  "Your symptoms may need emergency care right now. If you have trouble breathing or swallowing, or bleeding that won't stop, call 911 or go to the nearest emergency room. Our office has been alerted and will call you back immediately.";
const CALLBACK_HEADLINE = "Urgent — we'll call you right back";
const CALLBACK_MESSAGE =
  "This looks like it needs urgent attention. Our office has been alerted and will call you back as soon as possible to arrange an emergency visit today. The soonest available times are listed below in the meantime.";

/**
 * Decide whether a request should escalate, and produce the patient-facing
 * directive. Pure and deterministic — works offline, on text from any channel
 * (voice transcript, SMS, web chat). This is the override: when it returns a
 * level other than "none", the office is told to call the patient back ASAP.
 */
export function assessEscalation(request: string, skill: TriageSkill): Escalation {
  const { escalation, matched } = triageRequest(request, skill);
  const level: EscalationLevel = escalation ?? "none";
  if (level === "emergency") {
    return { level, headline: EMERGENCY_HEADLINE, message: EMERGENCY_MESSAGE, callbackRequired: true, matched };
  }
  if (level === "callback") {
    return { level, headline: CALLBACK_HEADLINE, message: CALLBACK_MESSAGE, callbackRequired: true, matched };
  }
  return { level: "none", headline: "", message: "", callbackRequired: false, matched: null };
}

// --- parsing helpers ---

function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const frontmatter: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) frontmatter[kv[1]!] = kv[2]!.trim();
  }
  return { frontmatter, body: m[2] ?? "" };
}

/**
 * Parse the markdown triage table into rules. Supports both the 4-column form
 * "| symptoms | urgency | escalation | note |" and the older 3-column form
 * "| symptoms | urgency | note |" (escalation absent → null).
 */
function parseTriageTable(body: string): TriageRule[] {
  const rules: TriageRule[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").map((c) => c.trim());
    // split("|") yields leading/trailing empties → drop them.
    const cols = cells.slice(1, -1);
    if (cols.length < 2) continue;

    const symptoms = cols[0]!;
    const urgencyTok = cols[1];
    // Skip the header row and the |---|---| separator.
    if (!symptoms || symptoms.toLowerCase() === "symptoms") continue;
    if (/^-+$/.test(symptoms.replace(/\s/g, ""))) continue;
    const urgency = urgencyTok?.toLowerCase() as Urgency;
    if (!URGENCIES.includes(urgency)) continue;

    // 4-col: cols[2] = escalation, cols[3] = note. 3-col: cols[2] = note.
    let escalation: "emergency" | "callback" | null = null;
    let note = cols[2] ?? "";
    if (cols.length >= 4) {
      const tok = cols[2]!.toLowerCase();
      escalation = (ESCALATIONS as readonly string[]).includes(tok) ? (tok as "emergency" | "callback") : null;
      note = cols[3] ?? "";
    }

    const keywords = symptoms
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (keywords.length === 0) continue;
    rules.push({ keywords, urgency, escalation, note });
  }
  return rules;
}

/** Whole-word (or whole-phrase) match, so "sore" doesn't fire inside "score". */
function wordMatch(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}
