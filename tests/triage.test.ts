import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadTriageSkill, classifyUrgency, assessEscalation } from "../src/core/skills/triage";

const SKILL_DIR = fileURLToPath(new URL("../src/core/skills/dental-triage", import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/conservative-triage", import.meta.url));

const skill = loadTriageSkill(SKILL_DIR);

describe("dental-triage Agent Skill", () => {
  it("loads name + description from the SKILL.md frontmatter", () => {
    expect(skill.name).toBe("dental-triage");
    expect(skill.description.length).toBeGreaterThan(0);
    expect(skill.rules.length).toBeGreaterThan(0);
  });

  it("flags infection/trauma/acute pain as urgent (same-day)", () => {
    expect(classifyUrgency("my face is swollen and it hurts", skill).urgency).toBe("urgent");
    expect(classifyUrgency("I knocked out a tooth playing soccer", skill).urgency).toBe("urgent");
    expect(classifyUrgency("my tooth is throbbing and I can't sleep", skill).urgency).toBe("urgent");
  });

  it("treats lesser discomfort as soon", () => {
    expect(classifyUrgency("I lost a filling last night", skill).urgency).toBe("soon");
  });

  it("treats elective visits as routine, and defaults to routine on no match", () => {
    expect(classifyUrgency("just want a routine cleaning", skill).urgency).toBe("routine");
    expect(classifyUrgency("hello, how are you", skill).urgency).toBe("routine");
  });

  it("returns which symptom matched, for an explainable decision", () => {
    const res = classifyUrgency("there is swelling near my jaw", skill);
    expect(res.urgency).toBe("urgent");
    expect(res.matched).toBeTruthy();
  });

  it("escalates a true medical-emergency red flag (airway/bleeding) to level 'emergency'", () => {
    expect(assessEscalation("I can't breathe and my face is swelling fast", skill).level).toBe("emergency");
    expect(assessEscalation("my mouth won't stop bleeding after the fall", skill).level).toBe("emergency");
    const e = assessEscalation("I'm having trouble swallowing", skill);
    expect(e.level).toBe("emergency");
    expect(e.callbackRequired).toBe(true);
    expect(e.message).toMatch(/911|emergency room/i);
  });

  it("escalates urgent same-day dental symptoms to level 'callback'", () => {
    const e = assessEscalation("my face is swollen and my tooth is throbbing", skill);
    expect(e.level).toBe("callback");
    expect(e.callbackRequired).toBe(true);
    expect(e.message).toMatch(/call you back/i);
  });

  it("does NOT escalate routine or mild requests", () => {
    expect(assessEscalation("just want a routine cleaning", skill).level).toBe("none");
    expect(assessEscalation("my tooth is a little sensitive", skill).level).toBe("none");
    expect(assessEscalation("I lost a filling", skill).level).toBe("none");
    expect(assessEscalation("can I come in next Thursday after 3?", skill).callbackRequired).toBe(false);
  });

  it("checks emergency BEFORE lesser symptoms (most-severe-first ordering)", () => {
    // Mentions both a mild ache and an airway red flag → emergency wins.
    expect(assessEscalation("my tooth aches a bit but now I can't breathe", skill).level).toBe("emergency");
  });

  it("THE FLEX: swapping in a different practice's skill changes triage with zero code change", () => {
    const conservative = loadTriageSkill(FIXTURE_DIR);
    const request = "my tooth is a little sensitive to cold";
    // Default skill: sensitivity is only "soon".
    expect(classifyUrgency(request, skill).urgency).toBe("soon");
    // A more cautious practice's skill escalates the same words to urgent —
    // and we changed nothing but the SKILL.md file.
    expect(classifyUrgency(request, conservative).urgency).toBe("urgent");
  });
});
