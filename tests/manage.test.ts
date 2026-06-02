import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import { identifyPatient, upcomingAppointments } from "../src/core/patients/lookup";
import { SchedulingAssistant } from "../src/core/orchestrator/SchedulingAssistant";
import { RuleBasedIntentExtractor } from "../src/core/intent/RuleBasedIntentExtractor";
import { TieredIntentExtractor } from "../src/core/intent/TieredIntentExtractor";
import { ScheduleReasoningAgent } from "../src/core/schedule/ScheduleReasoningAgent";
import { loadDefaultTriageSkill } from "../src/core/skills/triage";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));

describe("patient lookup (name or phone)", () => {
  const store = new JsonScheduleStore(SEED_DIR, { persist: false });

  it("matches by exact name", () => {
    expect(identifyPatient("Jane Doe", null, store)?.id).toBe("pat-doe");
  });
  it("matches by phone on trailing digits, ignoring formatting", () => {
    expect(identifyPatient(null, "555-0101", store)?.id).toBe("pat-doe");
    expect(identifyPatient(null, "(949) 555-0101", store)?.id).toBe("pat-doe");
  });
  it("returns null for an unknown patient", () => {
    expect(identifyPatient("Homer Simpson", "000-000-0000", store)).toBeNull();
  });
  it("lists only upcoming appointments, soonest first, with provider names", () => {
    const appts = upcomingAppointments("pat-doe", "2026-06-02", store);
    expect(appts.length).toBeGreaterThanOrEqual(2);
    expect(appts.every((a) => a.start.slice(0, 10) >= "2026-06-02")).toBe(true);
    for (let i = 1; i < appts.length; i++) expect(appts[i - 1]!.start <= appts[i]!.start).toBe(true);
    expect(appts[0]!.providerName).toBeTruthy();
  });
});

describe("SchedulingAssistant — cancel / reschedule", () => {
  const store = new JsonScheduleStore(SEED_DIR, { persist: false });
  const skill = loadDefaultTriageSkill();
  const llm = { extract: async () => { throw new Error("offline"); } };
  const tiered = new TieredIntentExtractor(new RuleBasedIntentExtractor(skill), llm, { offline: true });
  const assistant = new SchedulingAssistant(tiered, new ScheduleReasoningAgent(), store, 3, skill);

  it("cancel: identifies the patient, lists their appointments, ranks no slots", async () => {
    const r = await assistant.handle("This is Jane Doe, cancel my appointment", { refDate: "2026-06-02" });
    expect(r.intent.action).toBe("cancel");
    expect(r.patientMatch?.found).toBe(true);
    expect(r.patientMatch?.name).toBe("Jane Doe");
    expect(r.appointments?.length).toBeGreaterThanOrEqual(1);
    expect(r.recommendation.slots).toHaveLength(0);
  });

  it("reschedule: same patient identification path", async () => {
    const r = await assistant.handle("This is Jane Doe, I need to reschedule my appointment", { refDate: "2026-06-02" });
    expect(r.intent.action).toBe("reschedule");
    expect(r.patientMatch?.found).toBe(true);
    expect(r.appointments?.length).toBeGreaterThanOrEqual(1);
  });

  it("reports not-found for an unknown patient", async () => {
    const r = await assistant.handle("This is Homer Simpson, cancel my appointment", { refDate: "2026-06-02" });
    expect(r.patientMatch?.found).toBe(false);
    expect(r.appointments).toEqual([]);
  });
});
