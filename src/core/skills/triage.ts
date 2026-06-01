import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Urgency } from "../types";

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
  note: string;
}

export interface TriageSkill {
  name: string;
  description: string;
  rules: TriageRule[];
}

export interface TriageResult {
  urgency: Urgency;
  matched: string | null; // the symptom keyword that fired (for explainability)
  note: string | null;
}

const URGENCIES: Urgency[] = ["routine", "soon", "urgent"];

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
 * Classify a request's urgency using the skill's table. Rows are evaluated in
 * order; the first rule with a whole-word keyword match wins. No match → routine.
 */
export function classifyUrgency(request: string, skill: TriageSkill): TriageResult {
  const text = request.toLowerCase();
  for (const rule of skill.rules) {
    for (const kw of rule.keywords) {
      if (wordMatch(text, kw)) {
        return { urgency: rule.urgency, matched: kw, note: rule.note };
      }
    }
  }
  return { urgency: "routine", matched: null, note: null };
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

/** Parse the markdown "| symptoms | urgency | note |" table into rules. */
function parseTriageTable(body: string): TriageRule[] {
  const rules: TriageRule[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").map((c) => c.trim());
    // split("|") yields leading/trailing empties → drop them.
    const cols = cells.slice(1, -1);
    if (cols.length < 2) continue;
    const [symptoms, urgencyTok, note = ""] = cols;
    // Skip the header row and the |---|---| separator.
    if (!symptoms || symptoms.toLowerCase() === "symptoms") continue;
    if (/^-+$/.test(symptoms.replace(/\s/g, ""))) continue;
    const urgency = urgencyTok?.toLowerCase() as Urgency;
    if (!URGENCIES.includes(urgency)) continue;
    const keywords = symptoms
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (keywords.length === 0) continue;
    rules.push({ keywords, urgency, note });
  }
  return rules;
}

/** Whole-word (or whole-phrase) match, so "sore" doesn't fire inside "score". */
function wordMatch(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}
