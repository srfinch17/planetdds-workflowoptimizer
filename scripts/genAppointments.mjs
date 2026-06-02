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
      out.push({
        id: `appt-${String(seq).padStart(3, "0")}`,
        providerId: p.id,
        operatoryId: room.id,
        patientId: pick(patients).id,
        start: `${date}T${minToHHmm(startMin)}:00`,
        end: `${date}T${minToHHmm(endMin)}:00`,
        type,
      });
      busy.push({ date, providerId: p.id, operatoryId: room.id, startMin, endMin });
      cursor = endMin; // jump past the appointment we just placed
    }
  }
}

writeFileSync(DATA + "appointments.json", JSON.stringify(out, null, 2) + "\n", "utf-8");
console.log(`Wrote ${out.length} appointments (${BASE} → ${END}) to appointments.json`);
