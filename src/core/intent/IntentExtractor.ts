import type { ScheduleStore } from "../store/ScheduleStore";
import type { SchedulingIntent } from "../types";

/**
 * Everything an extractor needs from the outside world, passed in so the
 * extractor stays pure and testable.
 */
export interface IntentContext {
  refDate: string; // "YYYY-MM-DD" anchor for relative phrases ("next Thursday")
  store: ScheduleStore; // for mapping provider names → ids
}

/**
 * The contract every intent extractor honors. The orchestrator depends on THIS,
 * not on any concrete extractor, so the rule-based, LLM, and tiered versions
 * are interchangeable. `extract` may be sync (rules) or async (LLM), so callers
 * await it either way.
 */
export interface IntentExtractor {
  extract(request: string, ctx: IntentContext): SchedulingIntent | Promise<SchedulingIntent>;
}
