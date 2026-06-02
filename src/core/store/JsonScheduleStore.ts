import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Provider,
  Operatory,
  Patient,
  AppointmentType,
  Appointment,
  AvailabilityRule,
  CandidateSlot,
} from "../types";
import type { ScheduleStore } from "./ScheduleStore";

/**
 * JSON-file-backed implementation of ScheduleStore.
 *
 * Loads all data into memory on construction. `book` and `addRule` mutate the
 * in-memory arrays and (when persist=true) write them back to disk, so the
 * demo calendar updates live. For tests, point it at a temp copy of the seed
 * data so the real seeds are never touched.
 */
export class JsonScheduleStore implements ScheduleStore {
  private providers!: Provider[];
  private operatories!: Operatory[];
  private patients!: Patient[];
  private appointmentTypes!: AppointmentType[];
  private appointments!: Appointment[];
  private rules!: AvailabilityRule[];

  constructor(
    private readonly dataDir: string,
    private readonly opts: { persist?: boolean } = {},
  ) {
    this.reload();
  }

  /** (Re)load all data from the seed JSON — resets the in-memory store to defaults. */
  reload(): void {
    this.providers = this.read("providers.json");
    this.operatories = this.read("operatories.json");
    this.patients = this.read("patients.json");
    this.appointmentTypes = this.read("appointmentTypes.json");
    this.appointments = this.read("appointments.json");
    this.rules = this.read("rules.json");
  }

  private read<T>(file: string): T {
    return JSON.parse(readFileSync(join(this.dataDir, file), "utf-8")) as T;
  }

  private write(file: string, data: unknown): void {
    if (this.opts.persist === false) return;
    writeFileSync(join(this.dataDir, file), JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  getProviders(): Provider[] {
    return this.providers;
  }
  getOperatories(): Operatory[] {
    return this.operatories;
  }
  getPatients(): Patient[] {
    return this.patients;
  }
  getAppointmentTypes(): AppointmentType[] {
    return this.appointmentTypes;
  }
  getAppointments(): Appointment[] {
    return this.appointments;
  }
  getRules(): AvailabilityRule[] {
    return this.rules;
  }

  addRule(rule: AvailabilityRule): void {
    this.rules.push(rule);
    this.write("rules.json", this.rules);
  }

  addPatient(patient: Patient): void {
    this.patients.push(patient);
    this.write("patients.json", this.patients);
  }

  cancelAppointment(id: string): Appointment | undefined {
    const appt = this.appointments.find((a) => a.id === id);
    if (!appt) return undefined;
    this.appointments = this.appointments.filter((a) => a.id !== id);
    this.write("appointments.json", this.appointments);
    return appt;
  }

  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    const removed = this.rules.length < before;
    if (removed) this.write("rules.json", this.rules);
    return removed;
  }

  book(slot: CandidateSlot, patientId: string): Appointment {
    const appt: Appointment = {
      id: nextId("appt", this.appointments.map((a) => a.id)),
      providerId: slot.providerId,
      operatoryId: slot.operatoryId,
      patientId,
      start: slot.start,
      end: slot.end,
      type: slot.type,
    };
    this.appointments.push(appt);
    this.write("appointments.json", this.appointments);
    return appt;
  }
}

/** Generate the next id like "appt-003" by incrementing the max numeric suffix. */
function nextId(prefix: string, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const n = Number(id.split("-").pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
