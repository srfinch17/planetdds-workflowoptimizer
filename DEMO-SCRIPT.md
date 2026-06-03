# Demo run-sheet — Agentic Scheduling Assistant

A top-to-bottom script. Each step = **what to type / click**, then **what to say**.
Audience lenses: **Rahul** (dental domain / Denticon), **Marcus** (agentic / evals / cost),
**Rohit** (robustness / trust & safety). Demo-safe phrasings are exact — they're verified.

## 0 · Setup (before they're in the room)
- Terminal 1 (project **root**): `npm run server` · Terminal 2 (`cd web`): `npm run dev`
  → open http://localhost:5173
- Header engine mode = **mixed** (rules-first, LLM on demand). Theme = your call.
- Click **Admin → Reset to default** once, so metrics / log / calendar start clean.
- One-liner intro: *"It's one conversational box. A patient types what they want — book,
  change, cancel, or an emergency — and a pair of agents turn it into action. Every line of
  this was written by prompting Claude."*

## 1 · The hook — unstructured → ranked → booked (≈90s)
- **Type:** `This is Frank Jones, 949-555-0199, I need a cleaning next Thursday afternoon`
- **Say:** *"Messy, conversational. It extracts name, phone, type, date, and a soft time
  preference, pre-fills the patient bar, and returns the top-3 slots — each with the exact
  points every factor contributed. The explanation is generated FROM the scoring, so it can
  never lie about why a slot ranked where it did."*
- Point at the **Understood as** chips, the **+points** on a card, and the **color-coded
  dentist names** (each matches its calendar column).
- **Privacy beat (Rohit):** scroll the day grid — *"The patient sees only green 'book' or red
  'unavailable.' No other patient's procedure, no lunch, no clinical detail — that's all
  confined to the Admin view. Privacy is the default, not an afterthought."* (The phone field
  also masks to `(949) 555 - 0199` and a booking needs a full 10 digits.)
- **Book it:** click **Book this slot** on a card → a **review step** ("Book {when} with
  {who}? Confirm / Start over") → **Confirm booking** → the page becomes a clean full-page
  **"You're booked!"** with the confirmation number + "we'll text a reminder an hour before."
- **Say:** *"Confirm-first — nothing's reserved until they confirm, and the moment they do the
  calendar's gone, so there's nothing stale to click. From here: book another, or cancel and
  start over."*

## 2 · The cost story — Marcus (≈45s)
- Click **Metrics**.
- **Say:** *"The real cost lever isn't a cheaper model — the LLM only fires when the
  deterministic parser can't resolve the request. This dashboard is the receipt: % handled
  free, projected $/1000. Most requests cost nothing."*
- **If prompt caching comes up:** *"It's wired, but I measured it — at this prompt size it's
  below Haiku's minimum cacheable length, so it's a no-op today. I don't claim it as the
  savings. The savings are the tiered routing, and that's a real number on this screen."*
  (This honesty is the point.)

## 3 · Emergency safety — Rohit + Rahul (≈75s)
- **Type:** `a tooth got knocked out and it's bleeding badly`
- **Say:** *"This reads as a medical emergency, so it takes over the whole screen BEFORE
  scheduling — a 911 directive and a staff callback — deterministically, works offline. And
  critically, it makes the patient leave a name and number, because a 'we'll call you back'
  with nobody to call is useless."*
- Enter a name + number on the takeover → **Send my number** → "✓ the office will call
  you at…". Then **Admin** → show the **Emergency callback queue** with that name + number.
- **The Agent-Skill flex:** *"That clinical judgment lives in a real Anthropic Agent Skill —
  a swappable SKILL.md. Widening it — say, making 'bleeding badly' an emergency instead of a
  lesser callback — is a one-line data edit, no code change. The hard scheduling constraints
  are separate structured data the scheduler enforces exactly."*
- **The 'Understood as' demo panel:** *"On every terminal screen there's a small 'Understood
  as' panel — urgency, type, which tier handled it, confidence — flagged 'hidden in a real
  deployment.' It's demo scaffolding so you can watch the agent's reasoning; we'd strip it
  for a customer."*

## 4 · Rules vs. data, taught in English — Rahul (≈60s)
- **Admin → teach a rule:** `Dr. Smith doesn't work on Fridays` → show it took effect.
- **Say:** *"Staff teach availability in plain English; the parser turns each sentence into a
  structured constraint the scheduler enforces. Clinical eligibility is data too — an
  extraction needs a provider with the extraction specialty AND an X-ray-equipped room.
  It's all behind a `ScheduleStore` interface, so Denticon is a drop-in adapter."*
- **If hygienists come up:** *"For this demo all three providers are dentists — I dropped the
  hygienist role so there's never a 'did you need a dentist or a hygienist?' step. But the
  role-eligibility machinery is intact and data-driven: add a hygienist back and the engine
  keeps them out of dentist-only procedures. There's a unit test for exactly that."*
- **Admin direct booking:** click an open slot on the day grid → a small dialog (name +
  masked phone) → **Confirm booking.** *"Staff can book straight from the calendar — same
  booking path, same constraints — handy when they're already on a callback."*
- **Optional:** teach `the office is closed June 15 to 17` → show the **Needs Rescheduling**
  queue fill.

## 5 · The full lifecycle — change / cancel (≈45s)
- **Type:** `This is Jane Doe, reschedule my appointment to next week`
- **Say:** *"Same box. It identifies the patient by name OR phone — phone wins, because
  voice-to-text garbles names, not numbers — lists their upcoming appointments, and
  reschedules by reusing the availability + booking path. Booking the new slot cancels the
  old one together."*
- Click **Reschedule** on one → pick a new time → "✓ Rescheduled · confirmation."
- **Then:** `This is Jane Doe, cancel my appointment` → **Cancel** → **Confirm cancel.**
- *(Honest aside, if it fits: this cancel/reschedule view is the older inline layout; the
  booking and emergency flows got the cleaner full-page treatment, and matching it is the
  next polish pass.)*

## 6 · Engineering rigor — Marcus + Rohit (≈60s, pick 1–2)
- **Evals:** `npm run eval` → *"If you can't measure it, you're guessing. Scores the free
  deterministic path field-by-field — 97.6% — and shows exactly where the LLM tier earns its
  keep."*
- **CLI tiers:** `npm run cli -- "Can I come in next Thursday after 3?" --mode=agentic`
  → *"Same engine, no browser, and you can force the tier — agentic / mixed / rules — to show
  the routing and the live cost."*
- **Injection containment (Rohit):** *"The model can only ever return a Zod-validated intent
  shape — no free-text channel. A prompt-injection attempt comes back as a bounded, harmless
  intent. There's a test."* (`tests/llmSafety.test.ts`)
- **Offline (Rohit):** *"Pull the API key and everything still works for $0 — rules-first
  degradation. Verified."*
- **Determinism:** *"Ranking is pure code — identical input, identical output."*
- **143 tests green, typecheck clean.**

## 7 · Close
- *"Architecture: a deterministic orchestrator coordinating two specialists — an intent agent
  (rules + LLM fallback) and a pure schedule-reasoning agent. The LLM interprets language;
  code makes every decision. Reproducible, explainable, cheap, private by default, and honest
  about its limits."*

---

## Q&A — straight answers (don't get caught flat-footed)
- **"Is this really agentic or just a parser?"** → *Two agents reason over ambiguity (intent
  extraction + fuzzy clinical triage). Orchestration is a deterministic workflow on purpose —
  autonomy only where it earns it. It dispatches on a Zod-validated action enum, never
  free-form model control flow.*
- **"Security?"** → *Mutation endpoints check the appointment belongs to the supplied patient
  (no cross-patient cancels), 403 otherwise. But it's not auth — there's no session.
  Production: scope mutations to the authenticated patient + PHI access control. Flagged in
  CLAUDE.md, not pretended away.*
- **"Patient privacy?"** → *Patients see only 'book' / 'unavailable' — never another patient's
  name, procedure, or schedule. All clinical detail is Admin-only. An emergency makes the
  patient leave a callback number so staff know who to phone. The event log is PHI and would
  need encryption / access control / retention limits in prod.*
- **"Identity?"** → *Name/phone matching, not verification. Mock-appropriate; production needs
  real auth.*
- **"How does it scale / fit Denticon?"** → *`ScheduleStore` interface — swap JSON for
  Denticon's DB, no other code changes. Candidate generation indexes by day to stay fast over
  a year of data; provider AND operatory are booked as independent resources.*
- **"Timezones / multi-location?"** → *Single-clinic local time today; a real integration
  carries TZ. Known simplification.*
- **"What breaks it?"** → *Honestly: a bare 'late July' on the offline rules path degrades (no
  LLM to reconcile fuzzy dates) — but the 'Understood as' panel always shows what it heard, so
  it's never silently wrong.*

## Don't-panic notes
- If the app shows `ECONNREFUSED`, the backend stopped — `npm run server` again (also resets
  metrics to $0).
- Reset between practice runs: **Admin → Reset to default** (clears bookings, rules, logs,
  metrics, callback queue).
- **Booking is confirm-first** — after clicking "Book this slot," remember to click **Confirm
  booking** on the review step; it's not booked on the first click.
- Best seed names for cancel/reschedule: **Jane Doe**, **Marcus Brown**, **Petra Novak**
  (each has 2–3 upcoming).
- Emergency phrasings that hit the **red** emergency (911): *"…bleeding badly"*, *"…won't stop
  bleeding"*, *"can't breathe."* Trauma-only like *"my tooth broke off"* is the **amber**
  urgent-callback — both take over the page and capture a number.
