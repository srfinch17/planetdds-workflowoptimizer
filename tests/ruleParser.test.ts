import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { regexParseRule, parseRuleSentence } from "../src/core/rules/ruleParser";
import { parseLlmRule } from "../src/core/rules/ruleSchema";

const DATA_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));
const store = new JsonScheduleStore(DATA_DIR, { persist: false });

describe("regexParseRule (offline rule parsing)", () => {
  it("parses a recurring lunch block with times", () => {
    const rule = regexParseRule("Dr. Smith takes lunch from 11 to 12:30 every day", store);
    expect(rule).not.toBeNull();
    expect(rule!.providerId).toBe("prov-smith");
    expect(rule!.kind).toBe("block");
    expect(rule!.recurrence).toBe("daily");
    expect(rule!.start).toBe("11:00");
    expect(rule!.end).toBe("12:30");
    expect(rule!.reason.toLowerCase()).toContain("lunch");
  });

  it("parses a day-off rule with a weekday", () => {
    const rule = regexParseRule("Dr. Pana never works Fridays", store);
    expect(rule).not.toBeNull();
    expect(rule!.providerId).toBe("prov-pana");
    expect(rule!.kind).toBe("dayoff");
    expect(rule!.weekday).toBe("Fri");
  });

  it("returns null when it can't recognize the pattern", () => {
    expect(regexParseRule("the sky is a lovely shade of blue today", store)).toBeNull();
  });

  it("reads a specific-date absence as a one-time time-off ADJUSTMENT (not a dayoff)", () => {
    const rule = regexParseRule("Dr. Jones is taking off June 11 for a family emergency", store);
    expect(rule).not.toBeNull();
    expect(rule!.providerId).toBe("prov-jones");
    expect(rule!.kind).toBe("timeoff");
    // a bare single date collapses to a one-day window
    expect(rule!.startDate).toBe(rule!.endDate);
    expect(rule!.startDate!.slice(5)).toBe("06-11"); // June 11, any year chrono picks
    expect(rule!.reason).toMatch(/family emergency/i);
  });

  it("reads a date RANGE absence as a multi-day time-off", () => {
    const rule = regexParseRule("Dr. Smith is out August 3 to 5", store);
    expect(rule!.kind).toBe("timeoff");
    expect(rule!.startDate!.slice(5)).toBe("08-03");
    expect(rule!.endDate!.slice(5)).toBe("08-05");
  });

  it("still reads a recurring weekday absence as a dayoff RULE, not a time-off", () => {
    const rule = regexParseRule("Dr. Pana never works Fridays", store);
    expect(rule!.kind).toBe("dayoff");
    expect(rule!.weekday).toBe("Fri");
    expect(rule!.startDate).toBeUndefined();
  });
});

describe("parseRuleSentence (orchestration, offline)", () => {
  it("resolves a known sentence via the regex path, no LLM needed", async () => {
    const res = await parseRuleSentence("Dr. Smith takes lunch from 11 to 12:30 every day", store);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rule.providerId).toBe("prov-smith");
      expect(res.rule.kind).toBe("block");
      expect(res.source).toBe("rules");
    }
  });

  it("errors helpfully when offline and the regex can't parse and there is no LLM", async () => {
    const res = await parseRuleSentence("please do something clever with the schedule", store);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });
});

describe("parseLlmRule (Zod boundary for the LLM's JSON)", () => {
  it("accepts a valid block draft and resolves the provider name", () => {
    const res = parseLlmRule(
      { providerName: "Dr. Smith", kind: "block", recurrence: "daily", start: "11:00", end: "12:30", reason: "lunch" },
      store,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rule.providerId).toBe("prov-smith");
      expect(res.rule.kind).toBe("block");
    }
  });

  it("rejects a block draft missing its end time", () => {
    const res = parseLlmRule(
      { providerName: "Dr. Smith", kind: "block", start: "11:00", reason: "lunch" },
      store,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown provider name", () => {
    const res = parseLlmRule(
      { providerName: "Dr. Nobody", kind: "dayoff", weekday: "Fri", reason: "off" },
      store,
    );
    expect(res.ok).toBe(false);
  });

  it("accepts a timeoff draft and defaults endDate to startDate for a single day", () => {
    const res = parseLlmRule(
      { providerName: "Dr. Jones", kind: "timeoff", startDate: "2026-06-11", reason: "family emergency" },
      store,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rule.kind).toBe("timeoff");
      expect(res.rule.providerId).toBe("prov-jones");
      expect(res.rule.startDate).toBe("2026-06-11");
      expect(res.rule.endDate).toBe("2026-06-11");
    }
  });

  it("rejects a timeoff draft with no date", () => {
    const res = parseLlmRule({ providerName: "Dr. Jones", kind: "timeoff", reason: "out" }, store);
    expect(res.ok).toBe(false);
  });
});
