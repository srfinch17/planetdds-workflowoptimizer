/**
 * Intent-extraction eval harness.
 *
 * Measures how well the DETERMINISTIC (offline, $0) rule-based extractor turns
 * labeled patient requests into the right structured fields. This is the
 * "if you can't measure it, you're guessing" lever: a regression in parsing
 * shows up as a number, not a vibe. Runs with no API key and no network.
 *
 *   npm run eval            # score the rule-based extractor against cases.json
 *
 * Each case lists only the fields it asserts, so a case can check, say, just
 * the weekday + time window without over-specifying. Scoring is per-field
 * (partial credit) plus a per-case "all fields correct" pass rate.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../core/intent/RuleBasedIntentExtractor";
import { loadDefaultTriageSkill } from "../core/skills/triage";
import type { SchedulingIntent } from "../core/types";

const DATA_DIR = fileURLToPath(new URL("../core/data", import.meta.url));
const CASES = fileURLToPath(new URL("./cases.json", import.meta.url));

type Expected = Partial<
  Pick<
    SchedulingIntent,
    | "appointmentType"
    | "urgency"
    | "daysOfWeek"
    | "partOfDay"
    | "timeEarliest"
    | "timeLatest"
    | "preferredProviderId"
  >
>;
interface EvalCase {
  request: string;
  refDate: string;
  expect: Expected;
}

function eq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

function main(): void {
  const cases: EvalCase[] = JSON.parse(readFileSync(CASES, "utf8"));
  const store = new JsonScheduleStore(DATA_DIR, { persist: false });
  const extractor = new RuleBasedIntentExtractor(loadDefaultTriageSkill());

  let fieldsTotal = 0;
  let fieldsCorrect = 0;
  let casesPassed = 0;

  console.log("");
  console.log("=== Intent-extraction eval — rule-based (offline, $0) ===");
  console.log("");

  for (const c of cases) {
    const intent = extractor.extract(c.request, { refDate: c.refDate, store, mode: "rules" });
    const misses: string[] = [];
    for (const [field, want] of Object.entries(c.expect)) {
      fieldsTotal++;
      const got = (intent as unknown as Record<string, unknown>)[field];
      if (eq(got, want)) fieldsCorrect++;
      else misses.push(`${field}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    const pass = misses.length === 0;
    if (pass) casesPassed++;
    console.log(`${pass ? "✓" : "✗"} "${c.request}"`);
    for (const m of misses) console.log(`    └─ ${m}`);
  }

  const fieldPct = ((fieldsCorrect / fieldsTotal) * 100).toFixed(1);
  const casePct = ((casesPassed / cases.length) * 100).toFixed(1);
  console.log("");
  console.log(`Field accuracy: ${fieldsCorrect}/${fieldsTotal} (${fieldPct}%)`);
  console.log(`Cases fully correct: ${casesPassed}/${cases.length} (${casePct}%)`);
  console.log("");
  console.log("Note: this scores the FREE deterministic path. In tiered mode, the");
  console.log("LLM is the fallback for exactly the cases the rules miss.");
}

main();
