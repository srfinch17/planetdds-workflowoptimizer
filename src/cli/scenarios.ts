import dotenv from "dotenv";
dotenv.config({ override: true }); // load .env (authoritative) for the online path
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../core/intent/RuleBasedIntentExtractor";
import { LlmIntentExtractor } from "../core/intent/LlmIntentExtractor";
import { TieredIntentExtractor } from "../core/intent/TieredIntentExtractor";
import { AnthropicClient } from "../core/llm/anthropicClient";
import { CostTracker } from "../core/llm/costTracker";
import { ScheduleReasoningAgent } from "../core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import { loadDefaultTriageSkill } from "../core/skills/triage";
import { weekdayOf } from "../core/time";
import type { IntentExtractor } from "../core/intent/IntentExtractor";

export interface Scenario {
  title: string;
  request: string;
  refDate: string;
  narration: string; // what to say while it runs
}

/**
 * The three canonical demo scenarios. Each is a story:
 *   1. easy → resolved free, offline, no API call
 *   2. ambiguous → "mornings are better" still ranks mornings on top
 *   3. urgent + impossible exact ask → triage + honest best-effort
 */
export const SCENARIOS: Scenario[] = [
  {
    title: "Happy path (resolved offline, $0)",
    request: "Can I come in next Thursday after 3?",
    refDate: "2026-05-31",
    narration: "Clear request — the rule-based parser resolves it with no API call.",
  },
  {
    title: "Ambiguity (preference-aware ranking)",
    request: "sometime next week, mornings are better but I'm flexible",
    refDate: "2026-05-31",
    narration: "Soft preference, not a hard filter — morning slots rank to the top.",
  },
  {
    title: "Urgent + no perfect match (honest best-effort)",
    request: "my tooth is killing me, can I come in this evening?",
    refDate: "2026-06-04",
    narration: "Urgent triage, but the clinic has no evening hours — so it offers the closest and says so.",
  },
  {
    title: "EMERGENCY override (force a callback)",
    request: "I got hit in the face, a tooth got knocked out and my mouth won't stop bleeding",
    refDate: "2026-06-04",
    narration: "Reads as a medical emergency — the system overrides scheduling and forces an immediate callback directive.",
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATA_DIR = fileURLToPath(new URL("../core/data", import.meta.url));

export async function runScenarios(): Promise<void> {
  const store = new JsonScheduleStore(DATA_DIR, { persist: false });
  const costTracker = new CostTracker();

  // Online only if a key is present AND offline isn't forced. Otherwise the LLM
  // stub is never reached (tiered offline mode short-circuits before it).
  const hasKey = (process.env.ANTHROPIC_API_KEY ?? "").trim().length > 0;
  const offline = process.env.SCHEDULER_OFFLINE === "true" || !hasKey;
  const llm: IntentExtractor = offline
    ? { extract: async () => { throw new Error("LLM unavailable (offline)"); } }
    : new LlmIntentExtractor(new AnthropicClient(), costTracker);

  const triageSkill = loadDefaultTriageSkill();
  const tiered = new TieredIntentExtractor(new RuleBasedIntentExtractor(triageSkill), llm, { offline });
  const assistant = new SchedulingAssistant(tiered, new ScheduleReasoningAgent(), store, 3, triageSkill);

  console.log("");
  console.log(`=== Scheduling Assistant — demo scenarios ${offline ? "(OFFLINE mode)" : "(ONLINE)"} ===`);

  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i]!;
    console.log("");
    console.log(`--- Scenario ${i + 1}: ${s.title} ---`);
    console.log(`  ${s.narration}`);
    console.log(`  Patient: "${s.request}"`);

    const { intent, recommendation, escalation } = await assistant.handle(s.request, { refDate: s.refDate });
    console.log(`  Path taken: ${tiered.lastPath}  |  intent source: ${intent.source}`);

    if (escalation.level !== "none") {
      const tag = escalation.level === "emergency" ? "🚨 EMERGENCY" : "⚠ URGENT CALLBACK";
      console.log(`  ${tag} (triggered by "${escalation.matched}") → ${escalation.headline}`);
      console.log(`      ${escalation.message}`);
      console.log(`      [office callback queued]`);
    }

    if (recommendation.slots.length === 0) {
      console.log("  → No bookable slots.");
      continue;
    }
    if (recommendation.bestEffort) {
      console.log("  → No exact match for the requested time — closest available:");
    } else {
      console.log("  → Top recommendations:");
    }
    for (const slot of recommendation.slots) {
      const prov = store.getProviders().find((p) => p.id === slot.slot.providerId)?.name ?? slot.slot.providerId;
      console.log(`      [${slot.score}] ${weekdayOf(slot.slot.start)} ${fmtDate(slot.slot.start)} ${fmtTime(slot.slot.start)}  ${prov}`);
      console.log(`            ${slot.explanation}`);
    }
  }

  console.log("");
  console.log("=== Cost summary ===");
  console.log(`  Requests served: ${SCENARIOS.length}`);
  console.log(`  API calls made:  ${tiered.pathCounts.llm}`);
  console.log(`  Path breakdown:  ${JSON.stringify(tiered.pathCounts)}`);
  console.log(`  Estimated spend: $${costTracker.usd.toFixed(6)}`);
  console.log("");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function fmtTime(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  const period = h! >= 12 ? "PM" : "AM";
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Auto-run only when this file is the direct entry point — never on import
// (so the test can import SCENARIOS without triggering a live run).
const entry = process.argv[1] ?? "";
if (entry.endsWith("scenarios.ts") || entry.endsWith("scenarios.js")) {
  runScenarios().catch((err) => {
    console.error("Scenario run failed:", err);
    process.exit(1);
  });
}
