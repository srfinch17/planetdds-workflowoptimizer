// Generates ~12 months of realistic mock appointments into src/core/data/appointments.json.
// Deterministic (seeded RNG) so the calendar looks the same every run. Preserves the
// original demo-day appointments (appt-001/002 on 2026-06-04) and skips the rehearsed
// scenario window so the canonical demo + tests stay valid.
//
// Run:  node scripts/genAppointments.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA = fileURLToPath(new URL("../src/core/data/", import.meta.url));
const read = (f) => JSON.parse(readFileSync(DATA + f, "utf-8"));

const providers = read("providers.json");
const operatories = read("operatories.json");
const patients = read("patients.json");
const types = read("appointmentTypes.json");
const rules = read("rules.json");

const BASE = "2026-06-01";
const END = "2027-06-30";

// Keep the one fragile demo day sparse: scenario 1 ("next Thursday after 3") and
// the double-book test need several open ≥3pm slots on 2026-06-04. The rest of
// that week fills normally (scenario 2 only needs some open morning, which the
// ~45% density leaves plenty of).
const PROTECTED = new Set(["2026-06-04"]);

// Weighted appointment-type mix (emergencies are rare).
const TYPE_WEIGHTS = [
  ["cleaning", 40],
  ["checkup", 30],
  ["filling", 20],
  ["extraction", 6],
  ["emergency", 4],
];
const durationOf = (t) => types.find((x) => x.type === t).durationMin;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// --- deterministic RNG (mulberry32) ---
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260601);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function pickType() {
  const total = TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [t, w] of TYPE_WEIGHTS) {
    if ((r -= w) <= 0) return t;
  }
  return "cleaning";
}

// --- date helpers ---
const dayMs = 24 * 60 * 60 * 1000;
const toDate = (s) => new Date(`${s}T00:00:00`);
const iso = (d) => d.toISOString().slice(0, 10);
const weekdayOf = (s) => WEEKDAYS[toDate(s).getDay()];
const minToHHmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hhmmToMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

// Booking density by how far out the day is (0 = today). Busiest in the next two
// weeks and around the ~6-month mark; lighter in between. ~45–55% so plenty stays open.
function density(offsetDays) {
  if (offsetDays <= 14) return 0.62;
  if (offsetDays >= 165 && offsetDays <= 205) return 0.6;
  return 0.42;
}

// Keep the two original demo appointments.
const existing = read("appointments.json").filter((a) => a.id === "appt-001" || a.id === "appt-002");
const out = [...existing];
// Track booked intervals per provider and per operatory, keyed by date.
const busy = []; // { date, providerId, operatoryId, startMin, endMin }
for (const a of out) {
  busy.push({
    date: a.start.slice(0, 10),
    providerId: a.providerId,
    operatoryId: a.operatoryId,
    startMin: hhmmToMin(a.start.slice(11, 16)),
    endMin: hhmmToMin(a.end.slice(11, 16)),
  });
}

let seq = 2;
const overlap = (aS, aE, bS, bE) => aS < bE && bS < aE;

for (let d = toDate(BASE); iso(d) <= END; d = new Date(d.getTime() + dayMs)) {
  const date = iso(d);
  if (PROTECTED.has(date)) continue;
  const wd = weekdayOf(date);
  const offset = Math.round((toDate(date) - toDate(BASE)) / dayMs);
  const dayDensity = density(offset);

  for (const p of providers) {
    if (!p.workdays.includes(wd)) continue;
    if (rules.some((r) => r.providerId === p.id && r.kind === "dayoff" && r.weekday === wd)) continue;

    const blocks = rules
      .filter((r) => r.providerId === p.id && r.kind === "block" && r.start && r.end)
      .map((r) => [hhmmToMin(r.start), hhmmToMin(r.end)]);

    const open = hhmmToMin(p.hours.start);
    const close = hhmmToMin(p.hours.end);

    for (let cursor = open; cursor < close; ) {
      if (rand() > dayDensity) {
        cursor += 30;
        continue;
      }
      const type = pickType();
      const dur = durationOf(type);
      const startMin = cursor;
      const endMin = startMin + dur;
      if (endMin > close) break;
      if (blocks.some(([bs, be]) => overlap(startMin, endMin, bs, be))) {
        cursor += 30;
        continue;
      }
      if (busy.some((b) => b.date === date && b.providerId === p.id && overlap(startMin, endMin, b.startMin, b.endMin))) {
        cursor += 30;
        continue;
      }
      // Find a free operatory (extractions/emergencies want an X-ray room).
      const needsXray = type === "extraction" || type === "emergency";
      const room = operatories.find((o) => {
        if (needsXray && !o.equipment.includes("xray")) return false;
        return !busy.some((b) => b.date === date && b.operatoryId === o.id && overlap(startMin, endMin, b.startMin, b.endMin));
      });
      if (!room) {
        cursor += 30;
        continue;
      }
      seq += 1;
      pick(patients); // keep the RNG draw so the calendar stays byte-identical;
                      // the bulk calendar uses anonymous fillers (see below).
      out.push({
        id: `appt-${String(seq).padStart(3, "0")}`,
        providerId: p.id,
        operatoryId: room.id,
        patientId: `pat-anon-${String(seq).padStart(4, "0")}`,
        start: `${date}T${minToHHmm(startMin)}:00`,
        end: `${date}T${minToHHmm(endMin)}:00`,
        type,
      });
      busy.push({ date, providerId: p.id, operatoryId: room.id, startMin, endMin });
      cursor = endMin; // jump past the appointment we just placed
    }
  }
}

// The bulk calendar above belongs to anonymous fillers, so no single patient
// owns hundreds. Give each NAMED patient a small, realistic set of UPCOMING
// appointments by relabeling a spread of generated ones — this only changes who
// an appointment belongs to, never when/where it is, so the calendar's shape
// (and every availability test) is unchanged. Now "this is Jane Doe, cancel my
// appointment" resolves to her 2 appointments, not 200.
{
  const future = out.filter(
    (a) => a.start.slice(0, 10) >= "2026-06-09" && a.id !== "appt-001" && a.id !== "appt-002",
  );
  const PER = 2;
  for (let i = 0; i < patients.length; i++) {
    for (let k = 0; k < PER; k++) {
      const n = i * PER + k;
      const idx = Math.floor((future.length * (n + 1)) / (patients.length * PER + 1));
      if (future[idx]) future[idx].patientId = patients[i].id;
    }
  }
}

// Clinical integrity: a provider can only perform types their role + specialty
// allow (a hygienist doesn't do fillings; only a dentist with the extraction
// specialty extracts). The bulk loop placed appointments by time without
// checking this, so relabel any ineligible type to one the provider CAN do —
// KEEPING the slot (start/end/provider/room) exactly, so occupancy and every
// availability test are unchanged. Net effect: Dr. Jones (hygienist) shows only
// cleanings/checkups, extractions only appear with Dr. Smith.
{
  const T = Object.fromEntries(types.map((t) => [t.type, t]));
  const P = Object.fromEntries(providers.map((p) => [p.id, p]));
  const eligible = (t, p) =>
    (!t.eligibleRoles || t.eligibleRoles.includes(p.role)) &&
    (!t.requiredSpecialty || p.specialties.includes(t.requiredSpecialty));
  for (const a of out) {
    const p = P[a.providerId];
    const t = T[a.type];
    if (!p || !t || eligible(t, p)) continue;
    // cleaning (hygienist-safe) and filling (dentist) need no special room, so
    // the existing operatory stays valid.
    a.type = p.role === "hygienist" ? "cleaning" : "filling";
  }
}

writeFileSync(DATA + "appointments.json", JSON.stringify(out, null, 2) + "\n", "utf-8");
console.log(`Wrote ${out.length} appointments (${BASE} → ${END}) to appointments.json`);
