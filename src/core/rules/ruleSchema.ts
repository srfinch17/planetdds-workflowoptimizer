import { z } from "zod";
import type { ScheduleStore } from "../store/ScheduleStore";
import type { AvailabilityRule, Weekday } from "../types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A rule WITHOUT its id — the parser produces this; the store assigns the id. */
export type RuleDraft = Omit<AvailabilityRule, "id">;

/**
 * The contract the LLM must return. This is the untrusted-input boundary for
 * rule teaching: whatever the model emits is validated here before it can
 * become a hard scheduling constraint. A block needs both times; a dayoff needs
 * a weekday — enforced so a malformed rule can never silently corrupt the calendar.
 */
export const llmRuleSchema = z
  .object({
    providerName: z.string().min(1),
    kind: z.enum(["block", "dayoff", "workday"]),
    recurrence: z.enum(["daily"]).nullish(),
    weekday: z.enum(WEEKDAYS).nullish(),
    start: z.string().regex(HHMM).nullish(),
    end: z.string().regex(HHMM).nullish(),
    reason: z.string().nullish(),
  })
  .refine((r) => r.kind !== "block" || (!!r.start && !!r.end), {
    message: "a block rule requires both start and end times",
  })
  .refine((r) => r.kind !== "dayoff" || !!r.weekday, {
    message: "a dayoff rule requires a weekday",
  })
  .refine((r) => r.kind !== "workday" || !!r.weekday, {
    message: "a workday rule requires a weekday",
  });

export type LlmRuleDraft = z.infer<typeof llmRuleSchema>;

export type ParseRuleResult =
  | { ok: true; rule: RuleDraft }
  | { ok: false; error: string };

/** Resolve "Dr. Smith" → "prov-smith" by matching the surname token. */
export function resolveProviderId(name: string, store: ScheduleStore): string | null {
  const needle = name.trim().toLowerCase();
  for (const p of store.getProviders()) {
    const full = p.name.toLowerCase();
    const surname = p.name.split(/\s+/).pop()!.toLowerCase();
    if (full === needle || needle.includes(surname)) return p.id;
  }
  return null;
}

/**
 * Validate a raw LLM rule object and resolve its provider name to an id.
 * Returns a clean RuleDraft or a human-readable error (never throws).
 */
export function parseLlmRule(input: unknown, store: ScheduleStore): ParseRuleResult {
  const parsed = llmRuleSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return { ok: false, error: msg || "invalid rule" };
  }
  const d = parsed.data;
  const providerId = resolveProviderId(d.providerName, store);
  if (!providerId) {
    return { ok: false, error: `unknown provider "${d.providerName}"` };
  }
  return { ok: true, rule: draftFrom(d, providerId) };
}

/** Assemble a normalized RuleDraft from a validated LLM draft + resolved id. */
function draftFrom(d: LlmRuleDraft, providerId: string): RuleDraft {
  if (d.kind === "block") {
    return {
      providerId,
      kind: "block",
      recurrence: "daily",
      start: d.start!,
      end: d.end!,
      reason: d.reason?.trim() || "blocked",
    };
  }
  if (d.kind === "workday") {
    const rule: RuleDraft = {
      providerId,
      kind: "workday",
      weekday: d.weekday as Weekday,
      reason: d.reason?.trim() || `works ${d.weekday}`,
    };
    if (d.start && d.end) {
      rule.start = d.start;
      rule.end = d.end;
    }
    return rule;
  }
  return {
    providerId,
    kind: "dayoff",
    weekday: d.weekday as Weekday,
    reason: d.reason?.trim() || "day off",
  };
}
