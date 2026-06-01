import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../core/intent/RuleBasedIntentExtractor";
import { ScheduleReasoningAgent } from "../core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import { weekdayOf } from "../core/time";
import type { ScheduleStore } from "../core/store/ScheduleStore";
import type { AssistantResult } from "../core/orchestrator/SchedulingAssistant";
import type { SchedulingIntent } from "../core/types";

const DATA_DIR = fileURLToPath(new URL("../core/data", import.meta.url));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function main(): Promise<void> {
  const { request, refDate } = parseArgs(process.argv.slice(2));

  if (!request) {
    console.log('Usage: npm run cli -- "Can I come in next Thursday after 3?" [--ref=2026-06-01]');
    process.exit(1);
  }

  // Read-only for the CLI demo: never persist accidental writes to seed data.
  const store = new JsonScheduleStore(DATA_DIR, { persist: false });
  const assistant = new SchedulingAssistant(
    new RuleBasedIntentExtractor(),
    new ScheduleReasoningAgent(),
    store,
  );

  const result = await assistant.handle(request, refDate ? { refDate } : {});
  printResult(request, result, store);
}

function parseArgs(args: string[]): { request: string; refDate: string | null } {
  let refDate: string | null = null;
  const words: string[] = [];
  for (const a of args) {
    const m = a.match(/^--ref=(\d{4}-\d{2}-\d{2})$/);
    if (m) refDate = m[1]!;
    else words.push(a);
  }
  return { request: words.join(" ").trim(), refDate };
}

function printResult(request: string, result: AssistantResult, store: ScheduleStore): void {
  const { intent, recommendation } = result;

  console.log("");
  console.log(`Patient request: "${request}"`);
  console.log("");
  printIntent(intent, store);
  console.log("");

  if (recommendation.slots.length === 0) {
    console.log("No bookable slots were found for this request.");
    return;
  }

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
  console.log("");
}

function printIntent(intent: SchedulingIntent, store: ScheduleStore): void {
  const pct = Math.round(intent.confidence * 100);
  console.log(`Understood intent  [source: ${intent.source} | confidence: ${pct}%]`);
  console.log(`  date:      ${dateLine(intent)}`);
  console.log(`  time:      ${timeLine(intent)}`);
  console.log(`  type:      ${intent.appointmentType ?? "(any)"}`);
  console.log(`  urgency:   ${intent.urgency}`);
  console.log(`  provider:  ${providerLine(intent, store)}`);
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
