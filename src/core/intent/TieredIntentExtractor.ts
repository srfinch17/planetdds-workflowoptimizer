import type { SchedulingIntent } from "../types";
import type { IntentContext, IntentExtractor } from "./IntentExtractor";

/** Which tier actually produced the intent — surfaced on the dashboard. */
export type IntentPath = "rules" | "llm" | "offline-fallback" | "llm-failed-fallback";

export interface TieredOptions {
  // Rule-based confidence at/above which we trust rules and skip the LLM.
  confidenceThreshold?: number;
  // When true, never touch the network — the "Claude is offline" switch.
  offline?: boolean;
}

const DEFAULT_THRESHOLD = 0.6;

/**
 * The tiered brain — all three design goals in one place:
 *   1. COST: always try the free deterministic parser first; only pay for the
 *      LLM when the rule-based confidence is too low to trust.
 *   2. OFFLINE: if the offline flag is set, never attempt the network at all.
 *   3. GRACEFUL DEGRADATION: if the LLM call throws, silently fall back to the
 *      rule-based result rather than failing the patient.
 * It records the path of every request so "requests served vs API calls made"
 * is a measured number, not a claim.
 */
export class TieredIntentExtractor implements IntentExtractor {
  private readonly threshold: number;
  private readonly offline: boolean;

  lastPath: IntentPath | null = null;
  readonly pathCounts: Record<IntentPath, number> = {
    rules: 0,
    llm: 0,
    "offline-fallback": 0,
    "llm-failed-fallback": 0,
  };

  constructor(
    private readonly rule: IntentExtractor,
    private readonly llm: IntentExtractor,
    opts: TieredOptions = {},
  ) {
    this.threshold = opts.confidenceThreshold ?? DEFAULT_THRESHOLD;
    this.offline = opts.offline ?? process.env.SCHEDULER_OFFLINE === "true";
  }

  async extract(request: string, ctx: IntentContext): Promise<SchedulingIntent> {
    // Tier 1 — always run the free deterministic parser.
    const ruleIntent = await this.rule.extract(request, ctx);

    // Confident enough? Done — no API call.
    if (ruleIntent.confidence >= this.threshold) {
      return this.record("rules", ruleIntent);
    }

    // Low confidence but offline — return rules rather than reaching out.
    if (this.offline) {
      return this.record("offline-fallback", ruleIntent);
    }

    // Tier 2 — escalate to the LLM, but never let a failure reach the patient.
    try {
      const llmIntent = await this.llm.extract(request, ctx);
      return this.record("llm", llmIntent);
    } catch {
      return this.record("llm-failed-fallback", ruleIntent);
    }
  }

  private record(path: IntentPath, intent: SchedulingIntent): SchedulingIntent {
    this.lastPath = path;
    this.pathCounts[path] += 1;
    return intent;
  }
}
