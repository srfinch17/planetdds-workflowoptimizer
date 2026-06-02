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

  it("reads 'get my teeth cleaned' as a cleaning, not an emergency", () => {
    const intent = extractor.extract("can you get my teeth cleaned next Monday", ctx);
    expect(intent.appointmentType).toBe("cleaning");
  });

  it("does not treat a bare mention of 'tooth' as an emergency", () => {
    const intent = extractor.extract("I have a tooth question for Wednesday", ctx);
    expect(intent.appointmentType).not.toBe("emergency");
  });

  it("classifies the action: cancel / reschedule / book", () => {
    expect(extractor.extract("This is Jane Doe, please cancel my appointment", ctx).action).toBe("cancel");
    expect(extractor.extract("I need to reschedule my appointment to next Tuesday", ctx).action).toBe("reschedule");
    expect(extractor.extract("change my appointment to Friday morning", ctx).action).toBe("reschedule");
    expect(extractor.extract("I need a cleaning next Thursday", ctx).action).toBe("book");
  });

  it("pulls the patient's name and phone from the request when they state them", () => {
    const intent = extractor.extract(
      "This is Frank Jones, phone number 222-333-4455, I have a toothache how soon can you get me in?",
      ctx,
    );
    expect(intent.patientName).toBe("Frank Jones");
    expect(intent.patientPhone).toBe("222-333-4455");
  });

  it("leaves patient name/phone null when the request doesn't include them", () => {
    const intent = extractor.extract("I need a cleaning next Thursday", ctx);
    expect(intent.patientName).toBeNull();
    expect(intent.patientPhone).toBeNull();
  });

  it("does not mistake a date phrase for a name after 'this is'", () => {
    const intent = extractor.extract("this is killing me, my tooth hurts", ctx);
    expect(intent.patientName).toBeNull();
  });

  it("does not read a patient's surname as a provider preference", () => {
    // "Frank Jones" is the patient — NOT a request for Dr. Jones.
    const intent = extractor.extract("This is Frank Jones, I'd like a cleaning next Thursday", ctx);
    expect(intent.patientName).toBe("Frank Jones");
    expect(intent.preferredProviderId).toBeNull();
  });

  it("still honors an explicit provider request even when the patient shares the name", () => {
    const intent = extractor.extract("This is Frank Jones, I usually see Dr. Jones", ctx);
    expect(intent.patientName).toBe("Frank Jones");
    expect(intent.preferredProviderId).toBe("prov-jones");
  });

  it("defers on a multi-reference date instead of confidently grabbing the first one", () => {
    // "a tuesday or thursday in late july" → chrono finds THREE references
    // (tuesday, thursday, july). The parser must not pin the first ("tuesday",
    // ~today) and silently drop "late july" — it should declare the date
    // unresolved with low confidence so the tiered router escalates to the LLM.
    const intent = extractor.extract("i need a cleaning on a tuesday or thursday in late july", ctx);
    expect(intent.appointmentType).toBe("cleaning"); // the easy signal still resolves
    expect(intent.earliestDate).toBeNull(); // no false concrete date
    expect(intent.daysOfWeek).toEqual([]); // didn't keep only "tuesday"
    expect(intent.confidence).toBeLessThan(0.6); // below the escalation threshold
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
