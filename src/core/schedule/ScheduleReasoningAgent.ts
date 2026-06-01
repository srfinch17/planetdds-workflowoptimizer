import type { Recommendation, SchedulingIntent, ScoredSlot } from "../types";
import type { ScheduleStore } from "../store/ScheduleStore";
import { generateCandidates, type GenerateOptions } from "./candidateGenerator";
import { scoreSlot } from "./scorer";

/**
 * The Schedule-Reasoning specialist. Fully deterministic: no LLM here.
 *
 * It does NOT decide *what* the patient wants (that's the Intent Agent's job).
 * Given a structured intent, it answers "of the bookable slots, which top few
 * best fit — and why?" by composing two pure steps:
 *   1. generateCandidates  → every slot that passes ALL hard constraints
 *   2. scoreSlot           → a 0-100 fit score + explainable factors per slot
 * then dedupes, ranks, and returns the top N. Same input → same output, always.
 */
export class ScheduleReasoningAgent {
  recommend(
    intent: SchedulingIntent,
    store: ScheduleStore,
    n: number,
    opts: GenerateOptions = {},
  ): Recommendation {
    const refDate = opts.refDate;
    const candidates = generateCandidates(intent, store, opts);
    const scored = candidates.map((slot) => scoreSlot(slot, intent, store, { refDate }));

    // Collapse duplicates: the same provider+time shows up once per operatory.
    // Keep the single highest-scoring representative for each provider+time.
    const bestByKey = new Map<string, ScoredSlot>();
    for (const s of scored) {
      const key = `${s.slot.providerId}@${s.slot.start}`;
      const existing = bestByKey.get(key);
      if (!existing || s.score > existing.score) bestByKey.set(key, s);
    }

    const ranked = [...bestByKey.values()].sort(
      (a, b) => b.score - a.score || a.slot.start.localeCompare(b.slot.start),
    );

    const slots = ranked.slice(0, n);

    // Honesty flag: if the best slot couldn't satisfy the requested time window
    // (or there were no slots at all), this is a best-effort answer, not a match.
    const top = slots[0];
    const bestEffort = top ? !timeWindowSatisfied(top) : true;

    return { slots, bestEffort };
  }
}

/** Did the top slot actually honor the requested time window? */
function timeWindowSatisfied(s: ScoredSlot): boolean {
  const factor = s.factors.find((f) => f.name === "time_window_match");
  return factor ? factor.matched : true;
}
