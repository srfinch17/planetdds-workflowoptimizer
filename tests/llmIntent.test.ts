import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { LlmIntentExtractor, LlmExtractionError } from "../src/core/intent/LlmIntentExtractor";
import { CostTracker } from "../src/core/llm/costTracker";
import type { LlmClient } from "../src/core/llm/anthropicClient";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });
const ctx = { refDate: "2026-05-31", store };

/** A fake LLM that returns canned text + usage — no key, no network. */
function fakeClient(text: string, usage = { inputTokens: 1200, outputTokens: 80 }): LlmClient {
  return { complete: async () => ({ text, usage }) };
}

const goodJson = JSON.stringify({
  appointmentType: "cleaning",
  urgency: "routine",
  earliestDate: "2026-06-08",
  latestDate: "2026-06-12",
  daysOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  timeEarliest: null,
  timeLatest: "12:00",
  partOfDay: "morning",
  preferredProviderName: "Smith",
});

describe("LlmIntentExtractor", () => {
  it("parses a valid JSON response into a SchedulingIntent stamped source=llm", async () => {
    const tracker = new CostTracker();
    const ex = new LlmIntentExtractor(fakeClient(goodJson), tracker);
    const intent = await ex.extract("sometime next week, mornings before noon, with Dr Smith", ctx);

    expect(intent.source).toBe("llm");
    expect(intent.appointmentType).toBe("cleaning");
    expect(intent.partOfDay).toBe("morning");
    expect(intent.timeLatest).toBe("12:00");
    expect(intent.preferredProviderId).toBe("prov-smith"); // name → id mapping
    expect(intent.rawRequest).toMatch(/mornings/);
    expect(intent.confidence).toBeGreaterThan(0);
    expect(tracker.usd).toBeGreaterThan(0); // the call was metered
  });

  it("extracts JSON even when the model wraps it in prose / code fences", async () => {
    const wrapped = "Sure! Here is the intent:\n```json\n" + goodJson + "\n```\nHope that helps.";
    const ex = new LlmIntentExtractor(fakeClient(wrapped), new CostTracker());
    const intent = await ex.extract("whatever", ctx);
    expect(intent.appointmentType).toBe("cleaning");
  });

  it("maps an unknown provider name to null rather than failing", async () => {
    const json = JSON.stringify({ ...JSON.parse(goodJson), preferredProviderName: "Nonexistent" });
    const ex = new LlmIntentExtractor(fakeClient(json), new CostTracker());
    const intent = await ex.extract("whatever", ctx);
    expect(intent.preferredProviderId).toBeNull();
  });

  it("throws LlmExtractionError on non-JSON output", async () => {
    const ex = new LlmIntentExtractor(fakeClient("I cannot help with that."), new CostTracker());
    await expect(ex.extract("hi", ctx)).rejects.toBeInstanceOf(LlmExtractionError);
  });

  it("throws LlmExtractionError when the JSON violates the schema", async () => {
    const bad = JSON.stringify({ urgency: "whenever-is-fine" });
    const ex = new LlmIntentExtractor(fakeClient(bad), new CostTracker());
    await expect(ex.extract("hi", ctx)).rejects.toBeInstanceOf(LlmExtractionError);
  });
});

describe("CostTracker", () => {
  it("accumulates tokens and computes a positive dollar estimate", () => {
    const t = new CostTracker();
    t.record({ inputTokens: 1_000_000, outputTokens: 0 });
    expect(t.usd).toBeCloseTo(1.0, 6); // $1.00 / MTok input (Haiku 4.5)
    t.record({ inputTokens: 0, outputTokens: 1_000_000 });
    expect(t.usd).toBeCloseTo(6.0, 6); // + $5.00 / MTok output
    expect(t.totals.calls).toBe(2);
    expect(t.totals.inputTokens).toBe(1_000_000);
    expect(t.totals.outputTokens).toBe(1_000_000);
  });

  it("counts cached reads far cheaper than fresh input", () => {
    const t = new CostTracker();
    t.record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
    expect(t.usd).toBeCloseTo(0.1, 6); // $0.10 / MTok cache read
  });

  it("resets to zero", () => {
    const t = new CostTracker();
    t.record({ inputTokens: 500, outputTokens: 500 });
    t.reset();
    expect(t.usd).toBe(0);
    expect(t.totals.calls).toBe(0);
  });
});
