import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";
import { ScheduleReasoningAgent } from "../src/core/schedule/ScheduleReasoningAgent";
import { SchedulingAssistant } from "../src/core/orchestrator/SchedulingAssistant";
import { weekdayOf } from "../src/core/time";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });

const assistant = new SchedulingAssistant(
  new RuleBasedIntentExtractor(),
  new ScheduleReasoningAgent(),
  store,
);

describe("SchedulingAssistant.handle (orchestration)", () => {
  it("turns a raw request into a structured intent + ranked recommendation", async () => {
    const result = await assistant.handle("Can I come in next Thursday after 3?", {
      refDate: "2026-05-31",
    });

    // It extracted intent.
    expect(result.intent.source).toBe("rules");
    expect(result.intent.timeEarliest).toBe("15:00");

    // It ranked 1-3 real slots.
    expect(result.recommendation.slots.length).toBeGreaterThan(0);
    expect(result.recommendation.slots.length).toBeLessThanOrEqual(3);

    // The top slot honors the request: a Thursday at/after 3pm.
    const first = result.recommendation.slots[0]!;
    expect(weekdayOf(first.slot.start)).toBe("Thu");
    expect(first.slot.start.slice(11, 16) >= "15:00").toBe(true);
  });
});
