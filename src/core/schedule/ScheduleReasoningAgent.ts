import type { Recommendation, SchedulingIntent, ScoredSlot } from "../types";
import type { ScheduleStore } from "../store/ScheduleStore";
import { generateCandidates, type GenerateOptions } from "./candidateGenerator";
import { scoreSlot } from "./scorer";
import { overlaps } from "../time";

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

    // Give overlapping top picks DISTINCT rooms so they're independently
    // bookable up to physical capacity (the dedup above can hand the same free
    // room to two providers at the same time).
    assignDistinctOperatories(slots, store);

    // Honesty flag: if the best slot couldn't satisfy the requested time window
    // (or there were no slots at all), this is a best-effort answer, not a match.
    const top = slots[0];
    const bestEffort = top ? !timeWindowSatisfied(top) : true;

    return { slots, bestEffort };
  }
}

/**
 * Reassign each recommended slot to a room that's free of both existing
 * appointments AND the rooms already handed to earlier (higher-ranked) picks,
 * preserving any X-ray requirement. Keeps the current room when it's still free.
 * If no room is available (genuine capacity limit), leaves the slot as-is —
 * booking it will then legitimately conflict.
 */
function assignDistinctOperatories(slots: ScoredSlot[], store: ScheduleStore): void {
  const appts = store.getAppointments();
  const operatories = store.getOperatories();
  const claimed: { operatoryId: string; start: string; end: string }[] = [];

  for (const s of slots) {
    const { start, end, type } = s.slot;
    const needsXray = type === "extraction" || type === "emergency";

    const isFree = (opId: string): boolean => {
      const op = operatories.find((o) => o.id === opId);
      if (!op) return false;
      if (needsXray && !op.equipment.includes("xray")) return false;
      const apptClash = appts.some((a) => a.operatoryId === opId && overlaps(start, end, a.start, a.end));
      const peerClash = claimed.some((c) => c.operatoryId === opId && overlaps(start, end, c.start, c.end));
      return !apptClash && !peerClash;
    };

    let chosen = s.slot.operatoryId;
    if (!isFree(chosen)) {
      const alt = operatories.find((o) => isFree(o.id));
      if (alt) chosen = alt.id;
    }
    s.slot.operatoryId = chosen;
    claimed.push({ operatoryId: chosen, start, end });
  }
}

/** Did the top slot actually honor the requested time window? */
function timeWindowSatisfied(s: ScoredSlot): boolean {
  const factor = s.factors.find((f) => f.name === "time_window_match");
  return factor ? factor.matched : true;
}
