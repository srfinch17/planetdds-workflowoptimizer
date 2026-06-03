import dotenv from "dotenv";
dotenv.config({ override: true }); // .env is authoritative for the online (LLM) path
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
import type { ExtractionMode, IntentExtractor } from "../core/intent/IntentExtractor";
import type { ScheduleStore } from "../core/store/ScheduleStore";
import type { AssistantResult } from "../core/orchestrator/SchedulingAssistant";
import type { SchedulingIntent } from "../core/types";

const DATA_DIR = fileURLToPath(new URL("../core/data", import.meta.url));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// CLI mode names mirror the web UI's engine switch. They map onto the tiered
// extractor's routing: mixed = rules-first with LLM fallback (the default),
// agentic = always use the LLM, rules = never use the LLM.
type CliMode = "agentic" | "mixed" | "rules";
const MODE_MAP: Record<CliMode, ExtractionMode> = { agentic: "llm", mixed: "tiered", rules: "rules" };

async function main(): Promise<void> {
  const { request, refDate, mode } = parseArgs(process.argv.slice(2));

  if (!request) {
    console.log('Usage: npm run cli -- "Can I come in next Thursday after 3?" [--mode=mixed|agentic|rules] [--ref=2026-06-01]');
    console.log("  --mode=mixed   (default) rules first, escalate to Claude only when unsure");
    console.log("  --mode=agentic always use Claude (needs ANTHROPIC_API_KEY)");
    console.log("  --mode=rules   never use Claude — the offline, $0 deterministic path");
    process.exit(1);
  }

  // Read-only for the CLI: never persist accidental writes to the seed data.
  const store = new JsonScheduleStore(DATA_DIR, { persist: false });
  const costTracker = new CostTracker();

  // Online only when a non-empty key is present and offline isn't forced. When
  // offline the LLM is a throw-stub the tiered layer short-circuits past — so
  // every mode still returns an answer for $0 (agentic degrades to rules).
  const hasKey = (process.env.ANTHROPIC_API_KEY ?? "").trim().length > 0;
  const offline = process.env.SCHEDULER_OFFLINE === "true" || !hasKey;
  const llm: IntentExtractor = offline
    ? { extract: async () => { throw new Error("LLM unavailable (offline)"); } }
    : new LlmIntentExtractor(new AnthropicClient(), costTracker);

  // Same full stack the web app and the test suite use: rules + LLM behind the
  // tiered router, with the dental-triage skill wired so emergencies escalate.
  const triageSkill = loadDefaultTriageSkill();
  const tiered = new TieredIntentExtractor(new RuleBasedIntentExtractor(triageSkill), llm, { offline });
  const assistant = new SchedulingAssistant(tiered, new ScheduleReasoningAgent(), store, 3, triageSkill);

  if (mode === "agentic" && offline) {
    console.log('Note: no API key (offline) — "agentic" mode degrades to the deterministic rules path.');
    console.log("      Set ANTHROPIC_API_KEY in .env to actually call Claude.\n");
  }

  const result = await assistant.handle(request, { refDate: refDate ?? undefined, mode: MODE_MAP[mode] });
  printResult(request, result, store, { mode, path: tiered.lastPath, offline, costUsd: costTracker.usd });
}

function parseArgs(args: string[]): { request: string; refDate: string | null; mode: CliMode } {
  let refDate: string | null = null;
  let mode: CliMode = "mixed"; // default matches the web app's "mixed" engine setting
  const words: string[] = [];
  for (const a of args) {
    const ref = a.match(/^--ref=(\d{4}-\d{2}-\d{2})$/);
    const md = a.match(/^--mode=(.+)$/);
    if (ref) {
      refDate = ref[1]!;
    } else if (md) {
      const v = md[1]!.toLowerCase();
      if (v === "agentic" || v === "llm") mode = "agentic";
      else if (v === "mixed" || v === "tiered") mode = "mixed";
      else if (v === "rules" || v === "offline") mode = "rules";
      else {
        console.log(`Unknown --mode "${md[1]}". Use: agentic | mixed | rules.`);
        process.exit(1);
      }
    } else {
      words.push(a);
    }
  }
  return { request: words.join(" ").trim(), refDate, mode };
}

interface RunMeta {
  mode: CliMode;
  path: string | null; // which tier actually answered (rules / llm / offline-fallback / …)
  offline: boolean;
  costUsd: number;
}

function printResult(request: string, result: AssistantResult, store: ScheduleStore, meta: RunMeta): void {
  const { intent, recommendation, escalation } = result;

  console.log("");
  console.log(`Patient request: "${request}"`);
  console.log(`Engine mode: ${meta.mode}${meta.offline ? " (offline — $0)" : ""}  |  path taken: ${meta.path}`);
  console.log("");
  printIntent(intent, store);
  console.log("");

  // Safety override: an emergency/urgent triage is reported BEFORE any slots.
  if (escalation.level !== "none") {
    const tag = escalation.level === "emergency" ? "🚨 EMERGENCY" : "⚠ URGENT CALLBACK";
    console.log(`${tag} (triggered by "${escalation.matched}")`);
    console.log(`  ${escalation.message}`);
    console.log(`  [office callback queued]`);
    console.log("");
  }

  // Cancel / reschedule take the patient-lookup branch (no slot ranking).
  if (intent.action === "cancel" || intent.action === "reschedule") {
    printManage(result);
  } else if (recommendation.slots.length === 0) {
    console.log("No bookable slots were found for this request.");
  } else {
    const header = recommendation.bestEffort
      ? `Closest available (no exact match for the requested time):`
      : `Top ${recommendation.slots.length} recommendation(s):`;
    console.log(header);
    recommendation.slots.forEach((s, i) => {
      const wd = weekdayOf(s.slot.start);
      const date = formatDate(s.slot.start);
      const time = to12h(s.slot.start.slice(11, 16));
      const prov = providerNameOf(s.slot.providerId, store);
      console.log("");
      console.log(`  ${i + 1}. [score ${s.score}]  ${wd} ${date} at ${time}  with ${prov}`);
      for (const f of s.factors) {
        const mark = f.matched ? "+" : "-";
        console.log(`        ${mark} ${f.name} (+${Math.round(f.contribution)}): ${f.detail}`);
      }
    });
  }

  if (!meta.offline && meta.costUsd > 0) {
    console.log("");
    console.log(`Estimated spend for this request: $${meta.costUsd.toFixed(6)}`);
  }
  console.log("");
}

function printManage(result: AssistantResult): void {
  const action = result.intent.action;
  const match = result.patientMatch;
  if (!match || !match.found) {
    console.log(`(${action}) Could not identify a patient from that name/phone — ask them to confirm details.`);
    return;
  }
  const appts = result.appointments ?? [];
  console.log(`(${action}) Patient: ${match.name} — ${appts.length} upcoming appointment(s):`);
  appts.forEach((a, i) => {
    const wd = weekdayOf(a.start);
    console.log(`  ${i + 1}. ${a.type} with ${a.providerName} · ${wd} ${formatDate(a.start)} at ${to12h(a.start.slice(11, 16))}  [id ${a.id}]`);
  });
  console.log(`  → In the web UI the staff member ${action === "cancel" ? "confirms a cancel" : "picks a new time"}; the CLI just shows the lookup.`);
}

function printIntent(intent: SchedulingIntent, store: ScheduleStore): void {
  const pct = Math.round(intent.confidence * 100);
  console.log(`Understood intent  [action: ${intent.action} | source: ${intent.source} | confidence: ${pct}%]`);
  console.log(`  date:      ${dateLine(intent)}`);
  console.log(`  time:      ${timeLine(intent)}`);
  console.log(`  type:      ${intent.appointmentType ?? "(any)"}`);
  console.log(`  urgency:   ${intent.urgency}`);
  console.log(`  provider:  ${providerLine(intent, store)}`);
  if (intent.patientName || intent.patientPhone) {
    console.log(`  patient:   ${intent.patientName ?? "(no name)"}${intent.patientPhone ? ` · ${intent.patientPhone}` : ""}`);
  }
}

function dateLine(intent: SchedulingIntent): string {
  if (!intent.earliestDate) return "(no date given)";
  const wd = weekdayOf(`${intent.earliestDate}T00:00:00`);
  if (intent.latestDate && intent.latestDate !== intent.earliestDate) {
    return `${intent.earliestDate} .. ${intent.latestDate}`;
  }
  return `${intent.earliestDate} (${wd})`;
}

function timeLine(intent: SchedulingIntent): string {
  const parts: string[] = [];
  if (intent.timeEarliest) parts.push(`after ${to12h(intent.timeEarliest)}`);
  if (intent.timeLatest) parts.push(`before ${to12h(intent.timeLatest)}`);
  if (intent.partOfDay) parts.push(intent.partOfDay);
  return parts.length ? parts.join(", ") : "(any)";
}

function providerLine(intent: SchedulingIntent, store: ScheduleStore): string {
  if (!intent.preferredProviderId) return "(no preference)";
  return providerNameOf(intent.preferredProviderId, store);
}

function providerNameOf(id: string, store: ScheduleStore): string {
  return store.getProviders().find((x) => x.id === id)?.name ?? id;
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h! >= 12 ? "PM" : "AM";
  const h12 = h! % 12 === 0 ? 12 : h! % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// formatDate is exported-style helper kept for readability of the explanation header.
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

main().catch((err) => {
  console.error("Scheduler failed:", err);
  process.exit(1);
});
