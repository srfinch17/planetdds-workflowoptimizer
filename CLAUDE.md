# Agentic Scheduling Assistant — Project Notes

> **This file auto-loads when working in this repo.** It's the quick orientation;
> the granular, task-by-task build steps live in the implementation plan at
> `docs/superpowers/plans/2026-05-31-agentic-scheduler.md`, and the HTTP contract
> in `API.md`.

## What this is

An agentic appointment-scheduling assistant. It turns an unstructured patient
request ("Can I come in next Thursday after 3?") into the **top-3 ranked,
explainable appointment slots** over a JSON-backed schedule: an LLM/NLP agent
extracts intent (date, time window, urgency, type, provider), a deterministic
agent enforces hard constraints and scores candidates, and the result is
consistent and explainable. Mock data is JSON.

## Architecture

**Orchestrator–workers pattern** (per Anthropic's "Building Effective Agents"):
- **SchedulingAssistant** = deterministic orchestrator (a workflow, fixed path —
  not an LLM, because control flow never branches).
- **Intent Agent** = LLM-backed (cheap Haiku) with a **deterministic rule-based
  fallback** for cost control and offline operation.
- **Schedule-Reasoning Agent** = fully deterministic constraint eval + weighted scoring.
- Mock data sits behind a **`ScheduleStore` interface** (Google Calendar / EHR /
  practice-management DB is a drop-in replacement).
- A **Hono backend** holds the API key (never in the browser); **React/Vite** frontend.
- The project is **API-first**: `src/core/` is pure, `src/server/` is a thin HTTP
  adapter, and web/CLI/tests are all clients.

### Three goals, one design
1. **Cost-conscious:** the LLM is called only when the rule parser can't resolve
   the request. The dashboard shows % handled free + est. cost/1000 requests.
   Model = Claude Haiku + prompt caching.
2. **Rules vs. skills (precise vocabulary):** hard constraints are **structured
   data** enforced deterministically; the LLM only *translates* an admin's English
   sentence into a rule. A real Anthropic **Agent Skill** (dental-triage) supplies
   **fuzzy clinical judgment** (urgency + emergency escalation), never hard rules.
   Clinical eligibility is data too (`appointmentTypes.json`): each type declares
   the `eligibleRoles` / `requiredSpecialty` / `requiredEquipment` it needs, so a
   hygienist never surfaces for an extraction and an extraction only books into an
   X-ray-equipped operatory — enforced in the candidate generator, not hardcoded.
3. **Offline mode:** the rule-based parser IS the offline path (graceful
   degradation via the Tiered extractor). `chrono-node` does deterministic date parsing.

## Key design points
- **Agentic vs. script:** two agents reason over ambiguity; orchestration is a
  workflow because steps are fixed — autonomy is reserved for where it's needed.
- **Consistent:** ranking is deterministic code → identical output for identical input.
- **Trustworthy LLM output:** every LLM response is validated against a Zod schema;
  failure → deterministic fallback. The model returns a provider *name* (never an
  id), `appointmentType` is clamped to a known type or null, and `source`/
  `confidence` are server-set — so a prompt-injected model is **structurally
  contained**: it can only ever produce a bounded `SchedulingIntent`, never free
  text or smuggled fields. Covered by `tests/llmSafety.test.ts`.
- **Never empty:** if the requested window is fully booked (common once a hard
  constraint like X-ray-only rooms bites on a busy week), the reasoning agent
  widens the search to the soonest real opening and flags it `bestEffort` — a real
  scheduler offers the nearest slot, never "nothing."
- **Explainable:** explanations are generated FROM the scoring factors → always faithful.
- **Emergency safety:** a request that reads as a medical emergency escalates
  *before* scheduling and forces a staff callback — deterministic, works offline.
- **Measured, not asserted:** `npm run eval` scores the deterministic extractor
  against a labeled set (`src/eval/cases.json`) and reports field-level accuracy —
  a regression guard for parsing, and an honest picture of where the LLM tier earns
  its keep (multi-day phrasings like "Wednesday or Thursday" are exactly the tail).
- **Bilingual:** with a key, a Spanish request ("una limpieza el próximo jueves por
  la mañana") extracts correctly — relevant for a real practice's patient base.

## Tech stack
TypeScript, Node, `tsx`, Vitest, Zod, `@anthropic-ai/sdk` (Claude Haiku),
`chrono-node`, `dotenv`, Hono (backend), React + Vite (frontend). `.env` holds
`ANTHROPIC_API_KEY` and is gitignored.

## Project structure
- `src/core/` — pure engine: `time`, `store/` (ScheduleStore + JsonScheduleStore),
  `intent/` (rule-based, LLM, tiered extractors + Zod schema), `schedule/`
  (candidateGenerator, scorer, ScheduleReasoningAgent), `orchestrator/`
  (SchedulingAssistant), `llm/` (anthropicClient + costTracker), `rules/`
  (NL rule parser), `skills/` (dental-triage SKILL.md + triage loader),
  `log/` (EventLog + JsonlEventLog), `data/` (JSON seeds).
- `src/server/` — `app.ts` (`createApp(deps)` route factory, testable via
  `app.request()`), `index.ts` (reads `.env`, wires deps, serves on :3000),
  `metrics.ts`.
- `src/cli/` — `index.ts` (one-shot CLI), `scenarios.ts` (example runs).
- `src/eval/` — `runEval.ts` + `cases.json`: labeled extraction-accuracy harness.
- `web/` — React + Vite app; `vite.config.ts` proxies `/api` → :3000.
- `tests/` — Vitest suite. `docs/` — implementation plan. `API.md` — HTTP reference.

## How to run
```bash
npm install
npm run cli -- "Can I come in next Thursday after 3?"   # anchors to today; add --ref=YYYY-MM-DD to pin
npm run scenarios     # four example runs (happy / ambiguous / urgent / emergency)
npm run eval          # intent-extraction accuracy on a labeled set (offline, $0)
npm test              # full suite
npm run typecheck     # tsc --noEmit
```
Web (two terminals): `npm run server` (backend :3000) + `cd web && npm run dev`
(frontend :5173). Open http://localhost:5173 — Patient Intake + Admin Dashboard.

**"Today" is the real system date.** The web app and the engine both anchor to
the actual current date (see `web/src/today.ts`); seed appointments that have
slipped into the past just show as past, while future availability still comes
from each provider's working rules. The CLI's `--ref=YYYY-MM-DD` only pins
"today" for reproducing seed-anchored demos (e.g. `--ref=2026-05-31` so "next
Thursday" lands on 6/4 where the seed calendar is rich) — `npm run scenarios`
uses it for that reason. Without `--ref`, the CLI uses today too.

**Online (optional):** put `ANTHROPIC_API_KEY=...` in `.env`. With a key,
ambiguous requests escalate to Haiku; without one, everything runs deterministically
for $0. `.env` is authoritative (loaded with override) so a stray empty env var
can't force offline mode. Logs reset: `npm run logs:reset`.

## Example scenarios
1. Happy path: "Can I come in next Thursday after 3?" → clean Thu ≥15:00 match.
2. Provider preference: "I usually see Dr. Smith — anything next week?" → results
   split into "Your dentist" + "Other available dentists".
3. Ambiguity: "sometime next week, mornings are better but I'm flexible".
4. Far-future: "a cleaning in about six months, mornings preferred" → resolves to
   ~6 months out and books a 30-min morning slot.
5. Urgent / no-match: "my tooth is killing me, can I come in this evening?" →
   urgent triage, honest best-effort closest slots, callback queued.
6. Emergency: "a tooth got knocked out and my mouth won't stop bleeding" →
   911 directive + immediate staff callback (overrides normal scheduling).

## UI
- React + Vite, **three tabs: Patient Intake / Admin / Metrics**. Admin is operational
  (calendar, rule teaching, queues, reset); Metrics is the cost/efficiency dashboard +
  activity log.
- Design system is fully token-driven (`web/src/index.css`): IBM Plex Mono for
  data/labels, IBM Plex Sans for prose; neon-green primary accent, violet secondary,
  per-dentist colors (Smith green · Pana violet · Jones amber).
- **Header controls** use a shared custom `Dropdown` (`web/src/components/Dropdown.tsx`),
  not native `<select>`. The header's glowing dot is the live **engine-mode indicator +
  control** (`ModeIndicator`): agentic (always LLM, violet dot) / mixed (rules-first,
  green) / rules only (never LLM, amber). It sets each request's extraction mode; the
  "agentic" option is disabled when no API key is configured. Plus a **Light/Dark/System**
  theme dropdown.
- **Month-view calendar** (`web/src/components/MonthCalendar.tsx`): navigable ~12
  months, appointments as per-dentist color chips, click a day → day-detail grid.
  On Intake it auto-jumps to the recommendation month and rings the recommended day.
  When a request names days/dates, the calendar **greys out every day except the
  matching, bookable ones** (`selectableDays` prop) — "Tue or Thu in late July"
  leaves only those four days clickable; a vague request stays fully open.
- Booking is request-driven: recommendations render as cards, and on the day grid
  **every open time is a clickable green "★ book" button** (booked time shows
  rose/red, "taken") — so a patient can book ANY opening, not just the top 3, on any
  matching day. Open slots come from `GET /api/availability?from&to&type&days`, which
  runs the SAME candidate generator (eligibility/X-ray/hours all hold) and returns
  openings grouped by day. Slots are **30-minute** granularity (candidateGenerator
  `SLOT_STEP_MIN`) so recommendations and open times share the same grid rows.
- **Patient details** (name + phone) sit in a prominent bar at the top, with a
  ready-to-book status. Search works without them; booking requires them (clicking a
  slot without them focuses the field). Booking returns a confirmation number (DDS-####-XXXX).
- A request marked as extracted by the LLM shows a "🤖 Extracted by Claude" badge.

## Admin & availability
- **Plain-English rule teaching:** an admin types a sentence; the rule parser (chrono
  for dates, with an optional LLM assist) turns it into a structured `AvailabilityRule`.
- **Availability engine** (`src/core/schedule/availability.ts`): a provider's base
  workdays/hours can be modified by rules that ADD a workday (`workday`) or REMOVE one
  (`dayoff`); the latest rule wins (newest `createdAt`). `block` carves out a daily
  window (e.g. lunch). A contradicting rule returns 409 so the caller can confirm an override.
- **Office-wide closures** (`closure`, providerId `office`, a `startDate`/`endDate`
  range) override all providers; teaching one cancels every appointment in the window
  and moves them to a **"needs rescheduling" queue** (`/api/state.reschedule`).
- Admin can **view and delete rules** (with timestamps + a "superseded" badge) and
  **reset to default** (`POST /api/reset` re-seeds the store and clears logs,
  queues, AND the cost/efficiency metrics — a genuinely clean slate).

## Data
- `src/core/data/*.json` are the mock store. `appointments.json` holds ~a year of
  seeded appointments (~4,400) generated deterministically by `scripts/genAppointments.mjs`
  (re-run with `node scripts/genAppointments.mjs`). It keeps the canonical example day
  **2026-06-04** lightly loaded so the open-slot scenarios stay valid.
- Appointment durations are type-driven (cleaning 30m, filling 60m, extraction 90m);
  the candidate generator indexes appointments by day to stay fast against a full year.

## Current status
**Feature-complete.** 112 tests passing, `npm run typecheck` clean, web build clean.
Implemented: CLI core; Zod validation; tiered/offline intent + a per-request engine-mode
switch (agentic / mixed / rules); Hono backend; React UI (three tabs — intake + month +
day calendars + admin + metrics — with theming, custom dropdowns, per-dentist color-coding,
and per-type icons); provider-preference
grouping; booking with patient name/phone + confirmation numbers; cost/efficiency metrics;
plain-English rule teaching with add/remove workdays + office-wide closures + a reschedule
queue + view/delete/reset; dental-triage Agent Skill; emergency escalation with a staff
callback queue; data-driven clinical eligibility (role + specialty + operatory equipment per
appointment type, so a hygienist never surfaces for an extraction and imaging procedures
only book into X-ray rooms); prompt-injection containment + an offline extraction-accuracy
eval (`npm run eval`); a year of mock scheduling data with type-driven durations; and an
append-only event log (`EventLog` port) surfaced as an observability API (`/api/logs`,
stats, replay, export, reset) with a Metrics activity panel.

## Known simplifications (intentional)
- The `/api/logs/replay` metric-restore assumes a single user (no request firing
  concurrently with a replay) — fine in practice, not hardened for concurrency.

## PHI note
Event-log entries can contain raw patient messages (health information). All data
here is mock, so it's safe; a production deployment must encrypt the log at rest,
access-control it, limit retention, and likely redact.
