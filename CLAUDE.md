# PlanetDDS Agentic Scheduler — Project Memory

> **This file auto-loads when working in this repo. It is the single source of truth for
> resuming work.** The granular, task-by-task build steps live in the implementation plan:
> `docs/superpowers/plans/2026-05-31-agentic-scheduler.md` — read it for code-level detail.

## What this is (and why it matters)

A **final-round interview take-home** for **Planet DDS** (dental SaaS). Scott is a TypeScript
and Anthropic-API beginner who must build this AND present/defend it live in front of 4–8
engineers + execs. **He needs to understand every piece cold — never optimize for speed over
his understanding.** Teach as you build.

- **Presentation:** Thursday **2026-06-04, 11:00 AM**.
- **Build runway:** Sun May 31 eve + all Mon Jun 1 + all Tue Jun 2 (day). **Tue night = laptop
  setup + practice (HARD STOP on building).** Wed = drive Phoenix→ + practice to his son.
- **Assignment chosen:** Assignment **2** of 2 in `Interview Agentic Assignment.docx` —
  *"Intelligent Agentic Workflow Optimizer"* (appointment scheduling). **Assignment 1
  (claim-scrubbing RCM) is explicitly OUT of scope** — they said pick one; he picked #2.

## The task (verbatim requirements)

Turn an unstructured patient request ("Can I come in next Thursday after 3?") into the **top-3
ranked, explainable appointment slots**. Must: accept unstructured requests; use an LLM/NLP
agent to extract intent/constraints/preferences (date, time window, urgency); coordinate with a
schedule-reasoning agent over a **mock JSON schedule**; apply scoring to rank top 3; return
**clear explainable** recommendations. Outcome must show it reduces manual effort, improves
speed/accuracy, and produces **consistent, explainable** decisions. Mock data = CSV/JSON.

## Architecture (locked)

**Orchestrator–workers pattern** (cite Anthropic's "Building Effective Agents"):
- **Scheduling Assistant** = deterministic orchestrator (workflow, fixed path — NOT an LLM,
  because control flow never branches).
- **Intent Agent** = LLM-backed (cheap Haiku) with a **deterministic rule-based fallback**.
- **Schedule-Reasoning Agent** = fully deterministic constraint eval + weighted scoring.
- Mock data is JSON behind a **`ScheduleStore` interface** (future = Google Calendar/EHR drop-in).
- A **Hono backend** holds the API key (NEVER in the browser); **React/Vite** frontend.

### Three goals, one design
1. **Cost-conscious:** LLM called only when the rule parser can't resolve the request. Dashboard
   shows % handled free + est. cost/1000 requests. Model = Claude Haiku + prompt caching.
2. **Self-trained "skills":** precise vocabulary matters — hard constraints = **structured data**
   enforced deterministically; the LLM only *translates* an admin's English sentence into a rule.
   A real Anthropic **Agent Skill** (dental-triage) is reserved for **fuzzy clinical judgment**,
   NOT hard rules. Do not blur this in the demo — an engineer will catch it.
3. **Offline mode:** the rule-based parser IS the offline path (graceful degradation, built into
   the foundation via the Tiered extractor). `chrono-node` does deterministic date parsing.

## Defense cheat-sheet (the questions the panel will ask)
- **"What makes it agentic vs a script?"** Two agents reason over ambiguity; orchestration is a
  workflow because steps are fixed — reserving autonomy for where it's needed is a deliberate call.
- **"How is it consistent?"** Ranking is deterministic code → identical output for identical input.
- **"Cost?"** Haiku + prompt caching + only-when-needed; metrics visible on the dashboard.
- **"API down?"** Rule-based parser is the offline fallback.
- **"Trust the LLM?"** Every LLM response validated against a Zod schema; failure → fallback.
- **"Explainable?"** Explanations generated FROM the scoring factors → always faithful.

## Tech stack
TypeScript, Node 26, `tsx`, Vitest, Zod, `@anthropic-ai/sdk` (Claude Haiku), `chrono-node`,
`dotenv`, Hono (backend), React + Vite (frontend). `.env` holds `ANTHROPIC_API_KEY` and is
**gitignored from commit #1**. Scott bought $20 of API credits (far more than needed).

## Build floors (each leaves a complete, demoable system)
- **0–1:** skeleton + git + CLI core (request→intent→candidates→ranked top-3+explanation).
  **Floor 1 alone fully satisfies the assignment.**
- **2:** Zod validation, tiered/offline intent, 3 rehearsed demo scenarios.
- **3:** Hono backend + React UI + live calendar.
- **4:** admin dashboard (cost/efficiency + utilization metrics).
- **5:** plain-English rule-teaching + dental-triage Agent Skill.

## Demo scenarios (rehearse these 3)
1. Happy path: "Can I come in next Thursday after 3?" → clean Thu ≥15:00 match.
2. Ambiguity: "sometime next week, mornings are better but I'm flexible" → LLM resolves.
3. Urgent/no-match: "my tooth is killing me, anything today" when full → triage urgent,
   best-effort closest slots, explanation states it couldn't do better. (This is the showstopper.)

## CURRENT STATUS (update this as you go)
- [x] Discovery + architecture brainstorming (done in chat).
- [x] Implementation plan written: `docs/superpowers/plans/2026-05-31-agentic-scheduler.md`.
- [x] **FLOOR 1 COMPLETE** (Tasks 1–10). Working CLI demo, 25 tests passing. The whole
  assignment is satisfied offline/deterministically — no API key needed yet.
  - Core: time, JsonScheduleStore, candidateGenerator (hard constraints), scorer
    (5 weighted factors, explainable), ScheduleReasoningAgent (rank top-3 + bestEffort),
    RuleBasedIntentExtractor (chrono + keywords = offline brain), SchedulingAssistant
    (deterministic orchestrator), CLI (`src/cli/index.ts`).
  - Demo: `npm run cli -- "Can I come in next Thursday after 3?" --ref=2026-05-31`
    and `npm run cli -- "my tooth is killing me, anything today" --ref=2026-06-04`.
  - `--ref=YYYY-MM-DD` pins the reference date; use `2026-05-31` so "next Thursday" = 6/4
    (where the seed calendar has data). chrono reads "next Thu" as NEXT week's Thursday.
- [x] **FLOOR 2 COMPLETE** (Tasks 11–14). 49 tests passing.
  - Zod `parseIntent` (untrusted-input boundary), `LlmIntentExtractor` (DI'd `LlmClient`,
    prompt caching, throws `LlmExtractionError` on bad output), `CostTracker` (USD meter),
    `TieredIntentExtractor` (rules-first → LLM escalation → offline/failure fallback, records
    `lastPath` + `pathCounts`), and 3 canonical demo scenarios (`npm run scenarios`).
  - **Money slide:** `npm run scenarios` runs offline (no key) → "3 requests served, 0 API
    calls, $0.000000". All three stories (happy / ambiguous-mornings / urgent-best-effort) work.
  - LLM path is built + unit-tested with a FAKE client, but a REAL live API call has NOT been
    made yet (no key in dev env). **Tue night: set `.env` ANTHROPIC_API_KEY and run
    `npm run scenarios` with a genuinely ambiguous request to confirm the live `llm` path.**
- [x] **FLOOR 3 — Task 15 COMPLETE.** 55 tests passing (49 + 6 server).
  - `src/server/app.ts` = `createApp(deps)` factory (DI: store, assistant, tiered, costTracker)
    → testable in-process via `app.request()` (no socket). `src/server/index.ts` = the ONLY
    file that reads `.env`/the API key + serves on a port (`@hono/node-server`, default 3000).
  - Routes: `POST /api/schedule` {request, refDate?} → {intent, recommendation, pathTaken};
    `GET /api/state` (calendar data); `GET /api/metrics` (requestsServed vs apiCalls, $); 
    `POST /api/book` {slot, patientId}; `POST /api/rules` → 501 stub (Floor 5 wires it).
  - Store is `persist:false` in the server → booking updates the in-memory calendar live but
    never rewrites seed JSON (every demo cold-start is identical). Installed `@hono/node-server`.
  - Run: `npm run server` (boots OFFLINE with no key — rules path, $0). Smoke-tested live:
    Thu 6/4 3 PM, pathTaken=rules, apiCalls=0.
- [ ] **NEXT ACTION:** **Task 16** (Vite + React scaffold in `web/`, dev proxy `/api` →
  localhost:3000, Intake + Admin tabs), then 17 (intake view), 18 (live calendar) → Floor 3 done.
  Continue **inline, with teaching**.
- Execution mode chosen: **inline together** (NOT subagent-driven — Scott must see/own every step).
- Git: local repo initialized on `main`, remote connected to
  `https://github.com/srfinch17/planetdds-workflowoptimizer.git`. Commits NOT pushed yet
  (pushing needs Scott's GitHub auth — ask before pushing). Latest commit = Floor 2 complete.
- Known simplification (note for defense): candidateGenerator does NOT yet filter provider
  role/specialty vs appointment type, so a hygienist (Dr. Jones) can surface for an
  "emergency". Easy future hard-constraint; out of scope for Floor 1. Flag it honestly if asked.

## Environment notes
- Dev on Scott's PC (this machine, most tools present). Node v26.1.0, npm 11.7.0 confirmed.
- Demo on a **pristine Windows 11 laptop** — will need Node + Git + VS Code installed Tue night,
  then `git clone`, `npm install`, create `.env` manually. **Do a full cold-start dry run Tue night.**
