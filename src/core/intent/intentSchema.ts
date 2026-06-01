import { z } from "zod";
import type { SchedulingIntent } from "../types";

// "HH:mm" 24-hour, and "YYYY-MM-DD". Cheap structural guards so malformed LLM
// output is rejected at the boundary instead of corrupting the scheduler.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const weekday = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const timeOrNull = z.string().regex(TIME_RE, "expected HH:mm").nullable();
const dateOrNull = z.string().regex(DATE_RE, "expected YYYY-MM-DD").nullable();

/**
 * Zod schema mirroring SchedulingIntent. This is the trust boundary: anything
 * coming from the LLM is UNTRUSTED until it passes through here. If validation
 * fails, the tiered extractor falls back to the deterministic rule-based result
 * rather than feeding garbage into the scheduler.
 */
export const intentSchema = z.object({
  appointmentType: z.string().nullable(),
  urgency: z.enum(["routine", "soon", "urgent"]),
  earliestDate: dateOrNull,
  latestDate: dateOrNull,
  daysOfWeek: z.array(weekday),
  timeEarliest: timeOrNull,
  timeLatest: timeOrNull,
  partOfDay: z.enum(["morning", "afternoon", "evening"]).nullable(),
  preferredProviderId: z.string().nullable(),
  rawRequest: z.string(),
  source: z.enum(["rules", "llm"]),
  confidence: z.number().min(0).max(1),
});

export type ParseIntentResult =
  | { ok: true; intent: SchedulingIntent }
  | { ok: false; error: string };

/** Validate unknown input against the intent schema, never throwing. */
export function parseIntent(input: unknown): ParseIntentResult {
  const result = intentSchema.safeParse(input);
  if (result.success) {
    return { ok: true, intent: result.data };
  }
  // Flatten Zod's issues into one readable line for logs/fallback messages.
  const error = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error };
}
