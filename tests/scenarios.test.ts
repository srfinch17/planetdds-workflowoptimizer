import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";
import { ScheduleReasoningAgent } from "../src/core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../src/core/orchestrator/SchedulingAssistant";
import { SCENARIOS } from "../src/cli/scenarios";
import { weekdayOf } from "../src/core/time";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });

// Drive scenarios through the deterministic rule path so the suite passes with
// no key and no network (scenario 2 may use the LLM live, but its STRUCTURE is
// what we assert here, not any model-specific text).
const assistant = new SchedulingAssistant(
  new RuleBasedIntentExtractor(),
  new ScheduleReasoningAgent(),
  store,
);

const minutes = (iso: string): number => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return h! * 60 + m!;
};

describe("canonical demo scenarios", () => {
  it("exports exactly three scenarios with requests and reference dates", () => {
    expect(SCENARIOS).toHaveLength(3);
    for (const s of SCENARIOS) {
      expect(s.request.length).toBeGreaterThan(0);
      expect(s.refDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("1) happy path: a Thursday slot at/after 3pm, a real match", async () => {
    const s = SCENARIOS[0]!;
    const { recommendation } = await assistant.handle(s.request, { refDate: s.refDate });
    const top = recommendation.slots[0]!;
    expect(weekdayOf(top.slot.start)).toBe("Thu");
    expect(minutes(top.slot.start)).toBeGreaterThanOrEqual(15 * 60);
    expect(recommendation.bestEffort).toBe(false);
  });

  it("2) ambiguity: 'mornings are better' ranks a morning slot on top", async () => {
    const s = SCENARIOS[1]!;
    const { intent, recommendation } = await assistant.handle(s.request, { refDate: s.refDate });
    expect(intent.partOfDay).toBe("morning");
    expect(recommendation.slots.length).toBeGreaterThan(0);
    expect(minutes(recommendation.slots[0]!.slot.start)).toBeLessThan(12 * 60);
  });

  it("3) urgent + no perfect match: urgent triage, best-effort, honest", async () => {
    const s = SCENARIOS[2]!;
    const { intent, recommendation } = await assistant.handle(s.request, { refDate: s.refDate });
    expect(intent.urgency).toBe("urgent");
    expect(recommendation.bestEffort).toBe(true); // can't honor the exact ask
    expect(recommendation.slots.length).toBeGreaterThan(0); // but still offers the closest
  });
});
