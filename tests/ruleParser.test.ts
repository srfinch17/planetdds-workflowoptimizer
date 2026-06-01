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
});
