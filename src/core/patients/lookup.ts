import type { Appointment, AppointmentSummary, Patient } from "../types";
import type { ScheduleStore } from "../store/ScheduleStore";

/** Digits only, so phone numbers compare regardless of formatting. */
function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Find the patient a cancel/reschedule request refers to, by the name OR phone
 * they stated. Phone is tried first — a number is harder to mishear than a name,
 * which matters once requests arrive via voice-to-text. Phone matches on the
 * trailing digits (so "555-0120" finds "949-555-0120"); name matches on an exact
 * case-insensitive full name. Returns null when neither resolves to one patient.
 */
export function identifyPatient(
  name: string | null,
  phone: string | null,
  store: ScheduleStore,
): Patient | null {
  const patients = store.getPatients();

  if (phone) {
    const want = digits(phone);
    if (want.length >= 7) {
      const byPhone = patients.find((p) => p.phone && digits(p.phone).endsWith(want));
      if (byPhone) return byPhone;
    }
  }

  if (name) {
    const want = name.trim().toLowerCase();
    const byName = patients.filter((p) => p.name.toLowerCase() === want);
    if (byName.length === 1) return byName[0]!;
  }

  return null;
}

/**
 * A patient's UPCOMING appointments (on/after the reference date), soonest
 * first, enriched with the provider's display name. Past appointments are left
 * out — you can't cancel or move something that already happened.
 */
export function upcomingAppointments(
  patientId: string,
  refDate: string,
  store: ScheduleStore,
): AppointmentSummary[] {
  const providerName = (id: string) => store.getProviders().find((p) => p.id === id)?.name ?? id;
  return store
    .getAppointments()
    .filter((a: Appointment) => a.patientId === patientId && a.start.slice(0, 10) >= refDate)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => ({
      id: a.id,
      start: a.start,
      end: a.end,
      type: a.type,
      providerId: a.providerId,
      providerName: providerName(a.providerId),
    }));
}
