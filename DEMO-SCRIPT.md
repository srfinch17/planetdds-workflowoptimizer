# Demo run-sheet — Agentic Scheduling Assistant

A top-to-bottom script. Each step = **what to type / click**, then **what to say**.
Audience lenses: **Rahul** (dental domain / Denticon), **Marcus** (agentic / evals / cost),
**Rohit** (robustness / trust & safety). Demo-safe phrasings are exact — they're verified.

## 0 · Setup (before they're in the room)
- Terminal 1: `npm run server` · Terminal 2: `cd web && npm run dev` → open http://localhost:5173
- Header mode = **mixed** (rules-first, LLM on demand). Theme = your call.
- Click **Admin → Reset to default** once, so metrics/log start clean.
- One-liner intro: *"It's one conversational box. A patient types what they want — book, change, cancel, an emergency — and agents turn it into action. Every line of this was written by prompting Claude."*

## 1 · The hook — unstructured → ranked, explainable (≈60s)
- **Type:** `This is Frank Jones, 949-555-0199, I need a cleaning next Thursday afternoon`
- **Say:** *"Messy, conversational. Watch — it extracts name, phone, type, date, and a soft time preference; pre-fills the booking form; and returns the top-3 slots, each with the exact reasons it scored where it did. The explanation is generated FROM the scoring factors, so it can never lie about why."*
- Point at the **Understood as** chips and the **+points** on a card.

## 2 · The cost story — Marcus (≈45s)
- Click **Metrics**.
- **Say:** *"The real cost lever isn't a cheaper model — it's that the LLM only fires when the deterministic parser can't resolve the request. This dashboard is the receipt: % handled free, projected $/1000. Most requests cost nothing."*
- **If he asks about prompt caching:** *"It's wired, but I measured it — at this prompt size it's below Haiku's minimum cacheable length, so it's a no-op today. I don't claim it as the savings. The savings are the tiered routing, and that's a real number on this screen."* (This honesty is the point.)

## 3 · Rules vs. Skills, and emergency safety — Rahul + Rohit (≈60s)
- **Type:** `a tooth got knocked out and my mouth won't stop bleeding`
- **Say:** *"A medical-emergency reading escalates BEFORE scheduling — 911 directive + a staff callback queued — deterministically, and it works offline. That clinical judgment lives in a real Anthropic Agent Skill (a swappable SKILL.md), separate from the hard scheduling constraints, which are structured data the scheduler enforces exactly."*
- **Then Admin → teach a rule:** `Dr. Smith doesn't work on Fridays` → show it took effect.
- **Say (Rahul):** *"Staff teach rules in plain English; the parser turns them into structured constraints. Eligibility is data too — a hygienist can't take an extraction, imaging needs an X-ray room. It's all behind a `ScheduleStore` interface, so Denticon is a drop-in adapter."*

## 4 · The full lifecycle — book / change / cancel (≈75s)
- **Type:** `This is Jane Doe, reschedule my appointment to next week`
- **Say:** *"Same box. It identifies the patient by name OR phone — phone wins, because voice-to-text garbles names, not numbers — lists their upcoming appointments, and reschedules by reusing the availability + booking path, keeping the same dentist. Booking the new slot cancels the old one in one step."*
- Click **Reschedule** on one → pick a new time → show the "✓ Rescheduled · confirmation."
- **Then:** `This is Jane Doe, cancel my appointment` → click **Cancel** → **Confirm cancel.**
- **Optional (Admin):** teach `the office is closed June 15 to 17` → show the **Needs Rescheduling** queue fill.

## 5 · The engineering rigor — Marcus + Rohit (≈60s, pick 1–2)
- **Evals:** in a terminal, `npm run eval` → *"If you can't measure it, you're guessing. This scores the free deterministic path field-by-field — 97.6% — and shows exactly where the LLM tier earns its keep."*
- **Injection containment (Rohit):** *"The model can only ever return a Zod-validated intent shape — no free-text channel. A prompt-injection attempt to dump the system prompt comes back as a bounded, harmless intent. There's a test for it."* (`tests/llmSafety.test.ts`)
- **Offline (Rohit):** *"Pull the API key and everything still works for $0 — rules-first degradation. Verified."*
- **Determinism:** *"Ranking is pure code — identical input, identical output, every time."*

## 6 · Close
- *"Architecture: a deterministic orchestrator coordinating two specialists — an intent agent (rules + LLM fallback) and a pure schedule-reasoning agent. The LLM interprets language; code makes every decision. Reproducible, explainable, cheap, and honest about its limits."*

---

## Q&A — straight answers (don't get caught flat-footed)
- **"Is this really agentic or just a parser?"** → *Two agents reason over ambiguity (intent extraction + fuzzy clinical triage). Orchestration is a deterministic workflow on purpose — autonomy only where it earns it. It dispatches on a Zod-validated action enum, never free-form model control flow.*
- **"Security?"** → *Mutation endpoints check the appointment belongs to the supplied patient (no cross-patient cancels). But it's not auth — there's no session. Production: scope mutations to the authenticated patient + PHI access control. Flagged in CLAUDE.md, not pretended away.*
- **"Identity?"** → *Name/phone matching, not verification. Mock-appropriate; production needs real auth.*
- **"How does it scale / fit Denticon?"** → *`ScheduleStore` interface — swap JSON for Denticon's DB, no other code changes. Candidate generation indexes by day to stay fast over a year of data.*
- **"Timezones / multi-location?"** → *Single-clinic local time today; a real integration carries TZ. Known simplification.*
- **"What breaks it?"** → *Honestly: a bare 'late July' on the offline rules path degrades (no LLM to reconcile fuzzy dates) — the 'Understood as' panel always shows what it heard, so it's never silently wrong.*

## Don't-panic notes
- If the app shows `ECONNREFUSED`, the backend stopped — `npm run server` again (also resets metrics to $0).
- Reset between practice runs: **Admin → Reset to default** (clears bookings, rules, logs, metrics).
- Best seed names for cancel/reschedule: **Jane Doe**, **Marcus Brown**, **Petra Novak** (each has 2–3 upcoming).
