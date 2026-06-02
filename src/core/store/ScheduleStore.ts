import type {
  Provider,
  Operatory,
  Patient,
  AppointmentType,
  Appointment,
  AvailabilityRule,
  CandidateSlot,
} from "../types";

/**
 * The contract every schedule backend must satisfy.
 *
 * The whole system depends only on THIS interface, never on a concrete
 * implementation. Today it's JSON-backed; swapping in Google Calendar, an
 * EHR, or Planet DDS's own scheduling DB means writing a new class with these
 * same methods — no other code changes. That's the extensibility story.
 */
export interface ScheduleStore {
  getProviders(): Provider[];
  getOperatories(): Operatory[];
  getPatients(): Patient[];
  getAppointmentTypes(): AppointmentType[];
  getAppointments(): Appointment[];
  getRules(): AvailabilityRule[];

  /** Persist a new availability rule (e.g., admin-added "Dr. X lunch 11-12:30"). */
  addRule(rule: AvailabilityRule): void;

  /** Remove an availability rule by id. Returns true if one was removed. */
  removeRule(id: string): boolean;

  /** Add a patient record (e.g. a walk-up booking with name + phone). */
  addPatient(patient: Patient): void;

  /** Book a candidate slot for a patient; returns the created appointment. */
  book(slot: CandidateSlot, patientId: string): Appointment;

  /** Remove an appointment by id (e.g. an office closure cancels it). */
  cancelAppointment(id: string): Appointment | undefined;

  /** Reset the store to the seed defaults (drops runtime bookings/rules). */
  reload(): void;
}
