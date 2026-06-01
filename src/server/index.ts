import "dotenv/config";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { JsonScheduleStore } from "../core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../core/intent/RuleBasedIntentExtractor";
import { LlmIntentExtractor } from "../core/intent/LlmIntentExtractor";
import { TieredIntentExtractor } from "../core/intent/TieredIntentExtractor";
import { AnthropicClient } from "../core/llm/anthropicClient";
import { CostTracker } from "../core/llm/costTracker";
import { ScheduleReasoningAgent } from "../core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../core/orchestrator/SchedulingAssistant";
import { loadDefaultTriageSkill } from "../core/skills/triage";
import type { IntentExtractor } from "../core/intent/IntentExtractor";

// This is the ONLY place the API key is read. It stays in this process; the
// browser talks to these routes, never to Anthropic directly.
const DATA_DIR = fileURLToPath(new URL("../core/data", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// persist:false → booking updates the in-memory calendar live during the demo
// but never rewrites the seed JSON, so every fresh start is identical.
const store = new JsonScheduleStore(DATA_DIR, { persist: false });
const costTracker = new CostTracker();

// Online only when a key is present and offline isn't forced. Otherwise the LLM
// extractor is a throw-stub the tiered layer never reaches (it short-circuits
// to the rule-based result first).
const offline = process.env.SCHEDULER_OFFLINE === "true" || !process.env.ANTHROPIC_API_KEY;

// One Anthropic client, shared by intent extraction AND rule translation, so
// both share the same key and cost meter. Null when offline → both fall back.
const client = offline ? null : new AnthropicClient();
const llm: IntentExtractor = client
  ? new LlmIntentExtractor(client, costTracker)
  : {
      extract: async () => {
        throw new Error("LLM unavailable (offline)");
      },
    };

// The dental-triage Agent Skill drives clinical urgency from this file alone.
const triageSkill = loadDefaultTriageSkill();
const tiered = new TieredIntentExtractor(new RuleBasedIntentExtractor(triageSkill), llm, { offline });
const assistant = new SchedulingAssistant(tiered, new ScheduleReasoningAgent(), store);

const app = createApp({ store, assistant, tiered, costTracker, ruleLlm: client ?? undefined });

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log("");
  console.log(`Scheduling Assistant API listening on http://localhost:${info.port}`);
  console.log(`  mode: ${offline ? "OFFLINE (rule-based only, $0)" : "ONLINE (LLM escalation enabled)"}`);
  console.log(`  try: curl -s http://localhost:${info.port}/api/state | head`);
  console.log("");
});
