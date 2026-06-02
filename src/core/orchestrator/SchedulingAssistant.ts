import type { ScheduleStore } from "../store/ScheduleStore";
import type { IntentExtractor } from "../intent/IntentExtractor";
import type { ScheduleReasoningAgent } from "../schedule/ScheduleReasoningAgent";
import type { Recommendation, SchedulingIntent, Escalation, AppointmentSummary, PatientMatch } from "../types";
import type { ExtractionMode } from "../intent/IntentExtractor";
import { assessEscalation, type TriageSkill } from "../skills/triage";
import { identifyPatient, upcomingAppointments } from "../patients/lookup";
import { toIso } from "../time";

export interface AssistantResult {
  intent: SchedulingIntent;
  recommendation: Recommendation;
  escalation: Escalation; // level "none" unless an emergency was detected
  // Present only for cancel/reschedule: who we matched (or didn't), and that
  // patient's upcoming appointments to act on.
  patientMatch?: PatientMatch;
  appointments?: AppointmentSummary[];
}

const EMPTY_RECOMMENDATION: Recommendation = { slots: [], bestEffort: false, preferredProviderId: null };

const NO_ESCALATION: Escalation = {
  level: "none",
  headline: "",
  message: "",
  callbackRequired: false,
  matched: null,
};

/**
 * The orchestrator (orchestrator-workers pattern).
 *
 * This is a deterministic WORKFLOW, not an agent. It DOES dispatch on the
 * extracted `action` (book / cancel / reschedule), but only on a value that has
 * already been validated against a fixed enum at the Zod boundary — so the
 * branch is finite and predictable, never free-form control flow handed to the
 * model. Within each branch the steps are fixed. It coordinates two specialists:
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
    // Optional dental-triage skill. When present, every request is checked for
    // an emergency BEFORE anything else, so a true emergency can override normal
    // scheduling with a callback directive.
    private readonly triageSkill?: TriageSkill,
  ) {}

  async handle(
    rawRequest: string,
    opts: { refDate?: string; mode?: ExtractionMode } = {},
  ): Promise<AssistantResult> {
    const refDate = opts.refDate ?? toIso(new Date()).slice(0, 10);

    // Step 0 — emergency check FIRST. This is the safety override: a request
    // that reads as a medical emergency triggers a callback directive regardless
    // of what slots exist.
    const escalation = this.triageSkill ? assessEscalation(rawRequest, this.triageSkill) : NO_ESCALATION;

    // Step 1 — understand the request (await so a sync rule-based or async LLM
    // extractor both work through the same call site).
    const intent = await this.extractor.extract(rawRequest, { refDate, store: this.store, mode: opts.mode });

    // Cancel / reschedule both work the same way here: identify the patient (by
    // name or phone) and list their upcoming appointments. The ACTION only
    // changes what the UI offers — a Cancel button vs. a Reschedule flow that
    // reuses the normal availability + booking path. No slots are ranked.
    if (intent.action === "cancel" || intent.action === "reschedule") {
      const patient = identifyPatient(intent.patientName, intent.patientPhone, this.store);
      const patientMatch: PatientMatch = patient
        ? { found: true, patientId: patient.id, name: patient.name }
        : { found: false, patientId: null, name: null };
      const appointments = patient ? upcomingAppointments(patient.id, refDate, this.store) : [];
      return { intent, recommendation: EMPTY_RECOMMENDATION, escalation, patientMatch, appointments };
    }

    // Step 2 (book) — rank the bookable slots deterministically. Still computed
    // for an emergency, so staff can offer the soonest opening on the callback.
    const recommendation = this.reasoningAgent.recommend(intent, this.store, this.topN, { refDate });

    return { intent, recommendation, escalation };
  }
}
