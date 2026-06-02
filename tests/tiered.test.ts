import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";
import { TieredIntentExtractor } from "../src/core/intent/TieredIntentExtractor";
import type { IntentExtractor } from "../src/core/intent/IntentExtractor";
import type { SchedulingIntent } from "../src/core/types";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });
const ctx = { refDate: "2026-05-31", store };

const rule = new RuleBasedIntentExtractor();

function llmIntent(): SchedulingIntent {
  return {
    action: "book",
    appointmentType: "checkup",
    urgency: "routine",
    earliestDate: "2026-06-08",
    latestDate: "2026-06-12",
    daysOfWeek: [],
    timeEarliest: null,
    timeLatest: null,
    partOfDay: "morning",
    preferredProviderId: null,
    patientName: null,
    patientPhone: null,
    rawRequest: "ambiguous",
    source: "llm",
    confidence: 0.85,
  };
}

const CLEAR = "Can I come in next Thursday after 3?"; // rules resolve this confidently
const VAGUE = "umm i dunno, sometime, can you help"; // rules can't pin anything down

describe("TieredIntentExtractor (rules-first, LLM escalation, offline fallback)", () => {
  it("(a) resolves a clear request with rules and NEVER calls the LLM", async () => {
    const llm: IntentExtractor = { extract: vi.fn(async () => llmIntent()) };
    const tiered = new TieredIntentExtractor(rule, llm, { offline: false });

    const intent = await tiered.extract(CLEAR, ctx);

    expect(intent.source).toBe("rules");
    expect(llm.extract).not.toHaveBeenCalled();
    expect(tiered.lastPath).toBe("rules");
  });

  it("(b) escalates a vague request to the LLM when online", async () => {
    const llm: IntentExtractor = { extract: vi.fn(async () => llmIntent()) };
    const tiered = new TieredIntentExtractor(rule, llm, { offline: false });

    const intent = await tiered.extract(VAGUE, ctx);

    expect(intent.source).toBe("llm");
    expect(llm.extract).toHaveBeenCalledTimes(1);
    expect(tiered.lastPath).toBe("llm");
  });

  it("(c) offline mode: a vague request stays on rules and never hits the network", async () => {
    const llm: IntentExtractor = { extract: vi.fn(async () => llmIntent()) };
    const tiered = new TieredIntentExtractor(rule, llm, { offline: true });

    const intent = await tiered.extract(VAGUE, ctx);

    expect(intent.source).toBe("rules");
    expect(llm.extract).not.toHaveBeenCalled();
    expect(tiered.lastPath).toBe("offline-fallback");
  });

  it("(d) LLM failure falls back to rules without throwing", async () => {
    const llm: IntentExtractor = {
      extract: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const tiered = new TieredIntentExtractor(rule, llm, { offline: false });

    const intent = await tiered.extract(VAGUE, ctx);

    expect(intent.source).toBe("rules");
    expect(tiered.lastPath).toBe("llm-failed-fallback");
  });

  it("tallies path counts for the dashboard", async () => {
    const llm: IntentExtractor = { extract: vi.fn(async () => llmIntent()) };
    const tiered = new TieredIntentExtractor(rule, llm, { offline: false });

    await tiered.extract(CLEAR, ctx); // rules
    await tiered.extract(VAGUE, ctx); // llm

    expect(tiered.pathCounts.rules).toBe(1);
    expect(tiered.pathCounts.llm).toBe(1);
  });
});
