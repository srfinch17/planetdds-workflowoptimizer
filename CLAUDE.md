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
3. **Offline mode:** the rule-based parser IS the offline path (graceful
   degradation via the Tiered extractor). `chrono-node` does deterministic date parsing.

## Key design points
- **Agentic vs. script:** two agents reason over ambiguity; orchestration is a
  workflow because steps are fixed — autonomy is reserved for where it's needed.
- **Consistent:** ranking is deterministic code → identical output for identical input.
- **Trustworthy LLM output:** every LLM response is validated against a Zod schema;
  failure → deterministic fallback.
- **Explainable:** explanations are generated FROM the scoring factors → always faithful.
- **Emergency safety:** a request that reads as a medical emergency escalates
  *before* scheduling and forces a staff callback — deterministic, works offline.

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
- `web/` — React + Vite app; `vite.config.ts` proxies `/api` → :3000.
- `tests/` — Vitest suite. `docs/` — implementation plan. `API.md` — HTTP reference.

## How to run
```bash
npm install
npm run cli -- "Can I come in next Thursday after 3?" --ref=2026-05-31
npm run scenarios     # four example runs (happy / ambiguous / urgent / emergency)
npm test              # full suite
npm run typecheck     # tsc --noEmit
```
Web (two terminals): `npm run server` (backend :3000) + `cd web && npm run dev`
(frontend :5173). Open http://localhost:5173 — Patient Intake + Admin Dashboard.

**Reference-date gotcha:** `--ref=YYYY-MM-DD` pins "today". Use `2026-05-31` so
"next Thursday" resolves to 6/4, where the seed calendar has data. (chrono reads
"next Thursday" as *next week's* Thursday.)

**Online (optional):** put `ANTHROPIC_API_KEY=...` in `.env`. With a key,
ambiguous requests escalate to Haiku; without one, everything runs deterministically
for $0. `.env` is authoritative (loaded with override) so a stray empty env var
can't force offline mode. Logs reset: `npm run logs:reset`.

## Example scenarios
1. Happy path: "Can I come in next Thursday after 3?" → clean Thu ≥15:00 match.
2. Ambiguity: "sometime next week, mornings are better but I'm flexible".
3. Urgent / no-match: "my tooth is killing me, can I come in this evening?" →
   urgent triage, honest best-effort closest slots, callback queued.
4. Emergency: "a tooth got knocked out and my mouth won't stop bleeding" →
   911 directive + immediate staff callback (overrides normal scheduling).

## Current status
**Feature-complete.** ~93 tests passing, `npm run typecheck` clean, web build clean.
Implemented: CLI core; Zod validation; tiered/offline intent; Hono backend; React
UI (intake + live calendar + admin dashboard); cost/efficiency metrics;
plain-English rule teaching; dental-triage Agent Skill; emergency escalation with
a staff callback queue; and an append-only event log (`EventLog` port) surfaced as
an observability API (`/api/logs`, stats, replay, export, reset) with an Admin
activity panel.

## Known simplifications (intentional)
- `candidateGenerator` does not yet filter provider role/specialty vs. appointment
  type, so a hygienist could surface for an "emergency." Easy future hard-constraint.
- The `/api/logs/replay` metric-restore assumes a single user (no request firing
  concurrently with a replay) — fine in practice, not hardened for concurrency.

## PHI note
Event-log entries can contain raw patient messages (health information). All data
here is mock, so it's safe; a production deployment must encrypt the log at rest,
access-control it, limit retention, and likely redact.
