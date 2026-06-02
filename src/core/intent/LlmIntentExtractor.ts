import type { ScheduleStore } from "../store/ScheduleStore";
import type { SchedulingIntent } from "../types";
import type { IntentContext, IntentExtractor } from "./IntentExtractor";
import type { LlmClient } from "../llm/anthropicClient";
import type { CostTracker } from "../llm/costTracker";
import { parseIntent } from "./intentSchema";

/** Thrown when the model's output can't be turned into a valid intent. The
 * tiered extractor catches this and falls back to the rule-based result. */
export class LlmExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmExtractionError";
  }
}

// How confident we treat a successful LLM extraction. Not 1.0: the model can be
// wrong, and downstream code should know this wasn't a hard deterministic parse.
const LLM_CONFIDENCE = 0.85;

/**
 * LLM-backed intent extractor — the SMART tier, used only when the rule-based
 * parser isn't confident enough (the tiered layer decides that). It asks the
 * model for the semantic fields, then maps the provider name to an id locally
 * and validates the whole thing through the Zod boundary. The model never gets
 * to invent ids or set system fields; it only interprets language.
 */
export class LlmIntentExtractor implements IntentExtractor {
  constructor(
    private readonly client: LlmClient,
    private readonly costTracker: CostTracker,
  ) {}

  async extract(request: string, ctx: IntentContext): Promise<SchedulingIntent> {
    const system = buildSystemPrompt(ctx.store);
    const user = buildUserMessage(request, ctx.refDate);

    const { text, usage } = await this.client.complete({ system, user });
    this.costTracker.record(usage); // meter every call for the cost dashboard

    const raw = extractJson(text);
    if (raw === null) {
      throw new LlmExtractionError(`Model did not return JSON. Got: ${truncate(text)}`);
    }

    // The model returns provider NAME; we resolve the id deterministically.
    const providerName: unknown = (raw as Record<string, unknown>)["preferredProviderName"];
    const preferredProviderId =
      typeof providerName === "string" ? resolveProviderId(providerName, ctx.store) : null;

    // Clamp the appointment type to one the clinic actually offers — the model
    // can pick a known type or null, never invent one.
    const knownTypes = new Set(ctx.store.getAppointmentTypes().map((t) => t.type));
    const rawType: unknown = (raw as Record<string, unknown>)["appointmentType"];
    const appointmentType = typeof rawType === "string" && knownTypes.has(rawType) ? rawType : null;

    const candidate: SchedulingIntent = {
      appointmentType,
      urgency: (raw as any).urgency,
      earliestDate: (raw as any).earliestDate ?? null,
      latestDate: (raw as any).latestDate ?? null,
      daysOfWeek: (raw as any).daysOfWeek ?? [],
      timeEarliest: (raw as any).timeEarliest ?? null,
      timeLatest: (raw as any).timeLatest ?? null,
      partOfDay: (raw as any).partOfDay ?? null,
      preferredProviderId,
      rawRequest: request,
      source: "llm",
      confidence: LLM_CONFIDENCE,
    };

    const result = parseIntent(candidate);
    if (!result.ok) {
      throw new LlmExtractionError(`Model output failed validation: ${result.error}`);
    }
    return result.intent;
  }
}

/** Build the constant system prompt (cached). Lists the clinic's providers so
 * the model can name one, plus the exact JSON contract it must return. */
function buildSystemPrompt(store: ScheduleStore): string {
  const providers = store
    .getProviders()
    .map((p) => `- ${p.name} (${p.role})`)
    .join("\n");

  return [
    "You convert a dental patient's free-text scheduling request into a strict JSON object.",
    "Return ONLY the JSON object — no prose, no code fences.",
    "",
    "Providers at this clinic:",
    providers,
    "",
    "JSON fields (use null when not stated):",
    '- appointmentType: one of "cleaning","checkup","filling","extraction","emergency", or null',
    '- urgency: "routine" | "soon" | "urgent"',
    "- earliestDate: \"YYYY-MM-DD\" or null",
    "- latestDate: \"YYYY-MM-DD\" or null",
    '- daysOfWeek: array of any of "Mon","Tue","Wed","Thu","Fri","Sat","Sun" (empty if none)',
    '- timeEarliest: "HH:mm" (24h) or null   // "after 3pm" => "15:00"',
    '- timeLatest: "HH:mm" (24h) or null     // "before noon" => "12:00"',
    '- partOfDay: "morning" | "afternoon" | "evening" | null',
    "- preferredProviderName: the provider's name exactly as listed above, or null",
    "",
    "Resolve all relative dates against the reference date you are given.",
    "Interpret a vague part of a month as a date RANGE (earliestDate..latestDate),",
    'consistently: "early" = the 1st-10th, "mid" = the 11th-20th, "late" = the',
    '21st-end of the month. e.g. with reference year 2026, "late July" =>',
    'earliestDate "2026-07-21", latestDate "2026-07-31".',
  ].join("\n");
}

function buildUserMessage(request: string, refDate: string): string {
  return `Reference date (today): ${refDate}\nPatient request: ${request}`;
}

/** Pull the first balanced {...} JSON object out of arbitrary model text. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function resolveProviderId(name: string, store: ScheduleStore): string | null {
  const needle = name.toLowerCase();
  for (const p of store.getProviders()) {
    const full = p.name.toLowerCase();
    const surname = p.name.split(/\s+/).pop()!.toLowerCase();
    if (full === needle || full.includes(needle) || needle.includes(surname)) return p.id;
  }
  return null;
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
