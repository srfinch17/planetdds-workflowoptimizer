import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, cpSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonScheduleStore } from "../src/core/store/JsonScheduleStore";
import type { CandidateSlot } from "../src/core/types";

const SEED_DIR = fileURLToPath(new URL("../src/core/data", import.meta.url));

describe("JsonScheduleStore", () => {
  let tempDir: string;
  let store: JsonScheduleStore;

  beforeEach(() => {
    // Copy seed data to a throwaway temp dir so tests never mutate the real seeds.
    tempDir = mkdtempSync(join(tmpdir(), "scheduler-test-"));
    cpSync(SEED_DIR, tempDir, { recursive: true });
    store = new JsonScheduleStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads seed data", () => {
    expect(store.getProviders()).toHaveLength(3);
    expect(store.getOperatories()).toHaveLength(3);
    const appts = store.getAppointments();
    expect(appts.length).toBeGreaterThanOrEqual(2); // 2 demo seeds + a year of mock data
    expect(appts.find((a) => a.id === "appt-001")).toBeTruthy();
    expect(store.getRules()).toHaveLength(2);
    expect(store.getProviders()[0]!.name).toBe("Dr. Smith");
  });

  it("book() appends an appointment, returns it with a generated id, and persists", () => {
    const before = store.getAppointments().length;
    const slot: CandidateSlot = {
      providerId: "prov-jones",
      operatoryId: "op-3",
      start: "2026-06-04T10:00:00", // a protected demo day → this slot is free
      end: "2026-06-04T10:30:00",
      type: "cleaning",
    };
    const appt = store.book(slot, "pat-doe");

    expect(appt.id).toBeTruthy();
    expect(appt.patientId).toBe("pat-doe");
    expect(appt.providerId).toBe("prov-jones");
    expect(store.getAppointments()).toHaveLength(before + 1);

    // persisted to disk?
    const onDisk = JSON.parse(readFileSync(join(tempDir, "appointments.json"), "utf-8"));
    expect(onDisk).toHaveLength(before + 1);
  });

  it("addRule() appends and persists a rule", () => {
    store.addRule({
      id: "rule-test",
      providerId: "prov-jones",
      kind: "dayoff",
      weekday: "Mon",
      reason: "test rule",
    });
    expect(store.getRules()).toHaveLength(3);
    const onDisk = JSON.parse(readFileSync(join(tempDir, "rules.json"), "utf-8"));
    expect(onDisk).toHaveLength(3);
  });
});
