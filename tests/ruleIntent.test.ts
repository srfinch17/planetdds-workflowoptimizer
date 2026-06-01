import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(SEED_DIR, { persist: false });
const extractor = new RuleBasedIntentExtractor();

// refDate is a Sunday; "next Thursday" should resolve to that week's Thursday.
const ctx = { refDate: "2026-05-31", store };

describe("RuleBasedIntentExtractor (offline brain)", () => {
  it("parses 'Can I come in next Thursday after 3?'", () => {
    const intent = extractor.extract("Can I come in next Thursday after 3?", ctx);
    expect(intent.daysOfWeek).toContain("Thu");
    expect(intent.timeEarliest).toBe("15:00");
    expect(intent.source).toBe("rules");
    expect(intent.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("parses 'my tooth is killing me, anything today' as an urgent emergency today", () => {
    const intent = extractor.extract("my tooth is killing me, anything today", ctx);
    expect(intent.urgency).toBe("urgent");
    expect(intent.appointmentType).toBe("emergency");
    expect(intent.earliestDate).toBe("2026-05-31");
  });

  it("maps a named provider to their id", () => {
    const intent = extractor.extract("I'd like to see Dr. Smith for a cleaning", ctx);
    expect(intent.preferredProviderId).toBe("prov-smith");
    expect(intent.appointmentType).toBe("cleaning");
  });

  it("maps 'before noon' to a latest time and 'morning' to partOfDay", () => {
    const a = extractor.extract("something before noon next Tuesday", ctx);
    expect(a.timeLatest).toBe("12:00");
    const b = extractor.extract("a morning appointment please", ctx);
    expect(b.partOfDay).toBe("morning");
  });

  it("always stamps source=rules and a raw request copy", () => {
    const intent = extractor.extract("whatever works", ctx);
    expect(intent.source).toBe("rules");
    expect(intent.rawRequest).toBe("whatever works");
  });
});
