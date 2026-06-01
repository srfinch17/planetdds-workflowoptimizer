import type { ScheduleStore } from "../store/ScheduleStore";
import type { IntentExtractor } from "../intent/IntentExtractor";
import type { ScheduleReasoningAgent } from "../schedule/ScheduleReasoningAgent";
import type { Recommendation, SchedulingIntent } from "../types";
import { toIso } from "../time";

export interface AssistantResult {
  intent: SchedulingIntent;
  recommendation: Recommendation;
}

/**
 * The orchestrator (orchestrator-workers pattern).
 *
 * This is a deterministic WORKFLOW, not an agent: the control flow never
 * branches on model output — it always does the same two steps in the same
 * order. It coordinates two specialists:
 *   1. an IntentExtractor (rules, LLM, or tiered) → WHAT the patient wants
 *   2. the ScheduleReasoningAgent (pure)          → which slots best fit, and why
 * Keeping orchestration dumb and deterministic is what makes the system's
 * decisions reproducible and easy to defend.
 */
export class SchedulingAssistant {
  constructor(
    private readonly extractor: IntentExtractor,
    private readonly reasoningAgent: ScheduleReasoningAgent,
    private readonly store: ScheduleStore,
    private readonly topN = 3,
  ) {}

  async handle(rawRequest: string, opts: { refDate?: string } = {}): Promise<AssistantResult> {
    const refDate = opts.refDate ?? toIso(new Date()).slice(0, 10);

    // Step 1 — understand the request (await so a sync rule-based or async LLM
    // extractor both work through the same call site).
    const intent = await this.extractor.extract(rawRequest, { refDate, store: this.store });

    // Step 2 — rank the bookable slots deterministically.
    const recommendation = this.reasoningAgent.recommend(intent, this.store, this.topN, { refDate });

    return { intent, recommendation };
  }
}
