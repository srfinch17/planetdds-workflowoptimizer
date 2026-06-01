# Intelligent Agentic Workflow Optimizer — Appointment Scheduling

Turns an unstructured patient request — *"Can I come in next Thursday after 3?"* —
into the **top-3 ranked, explainable appointment slots**, over a mock JSON
schedule. Built for the Planet DDS take-home (Assignment 2).

## What it does

1. **Understands** the request: extracts date, time window, urgency, appointment
   type, and provider preference.
2. **Reasons** over the schedule: generates candidate slots that satisfy every
   hard constraint (provider hours, lunch blocks, days off, no double-booking),
   then scores them.
3. **Recommends** the top 3, each with a plain-English explanation built *from*
   the scoring factors — so the explanation can never drift from the decision.

## Architecture — orchestrator + workers

Following Anthropic's *Building Effective Agents*:

```
            ┌──────────────────────────────────────────────┐
  request → │  SchedulingAssistant  (deterministic workflow) │ → ranked slots
            └───────────────┬───────────────┬───────────────┘
                            │               │
              Intent Agent  │               │  Schedule-Reasoning Agent
        (tiered: rules → LLM)               (pure, deterministic scoring)
```

- **SchedulingAssistant** is a *workflow*, not an agent: the control flow never
  branches on model output — same two steps, same order, every time. That's what
  makes decisions reproducible.
- **Intent Agent** is tiered: a deterministic rule-based parser handles most
  requests for free; the LLM (Claude Haiku) is called *only* when the rules
  aren't confident. Every LLM response is validated against a Zod schema before
  it's trusted; on failure we fall back to the rule-based result.
- **Schedule-Reasoning Agent** is fully deterministic: hard constraints filter
  candidates, then a weighted score ranks them.
- The schedule lives behind a **`ScheduleStore` interface** (JSON today; Google
  Calendar / an EHR / Planet DDS's own DB is a drop-in replacement).

## Three design goals, one design

1. **Cost-conscious.** The LLM is the last resort, not the default. The
   dashboard shows the share of requests handled with **zero API calls** and the
   projected cost per 1,000 requests. Model is Haiku with prompt caching.
2. **Self-trained "skills" / precise vocabulary.** Hard constraints are
   **structured data** the scheduler enforces exactly. The LLM only *translates*
   an admin's English sentence into such a rule (see below). A real Anthropic
   **Agent Skill** supplies *fuzzy clinical judgment* (triage) — a different job.
3. **Offline mode.** The rule-based parser **is** the offline path. Pull the
   network and scheduling still works (a little less smart), by design.

## Rules vs. Skills — the distinction that matters

These look similar and are deliberately **not** the same thing:

| | Hard scheduling rules | Dental-triage Agent Skill |
|---|---|---|
| Example | "Dr. Smith: lunch 11:00–12:30 daily" | "swelling → urgent same-day" |
| Nature | Exact, structured data | Fuzzy clinical judgment |
| Who enforces | The deterministic scheduler, every time | Influences *priority* only, never bookability |
| LLM's role | Only *translates* English → structured rule | Knowledge lives in a swappable `SKILL.md` |
| Lives in | `src/core/rules/` + the JSON store | `src/core/skills/dental-triage/SKILL.md` |

The **Agent Skill** (`src/core/skills/dental-triage/SKILL.md`) is the
"extensible intelligence" layer. The scheduler loads it and matches the
patient's words against its triage table to set urgency, which then feeds slot
scoring. Because the judgment lives in the file, a different practice can drop in
their own `SKILL.md` — say, one that escalates *sensitivity* to urgent — and the
system's triage behavior changes with **zero code changes**. (`tests/triage.test.ts`
proves exactly this by swapping in a second skill file.)

## How to run

**CLI (no key needed — runs offline):**
```bash
npm install
npm run cli -- "Can I come in next Thursday after 3?" --ref=2026-05-31
npm run scenarios          # the three rehearsed demo stories
npm test                   # full suite
```
> `--ref=YYYY-MM-DD` pins the reference date; use `2026-05-31` so "next Thursday"
> lands on 6/4, where the seed calendar has data.

**Web (two terminals):**
```bash
npm run server             # backend on :3000 (holds the API key, if any)
cd web && npm run dev      # frontend on :5173 (proxies /api → :3000)
```
Open http://localhost:5173 — **Patient Intake** (request → ranked, explainable
slots → book) and **Admin Dashboard** (live calendar, cost/efficiency metrics,
plain-English rule teaching).

**Going online (optional):** create `.env` with `ANTHROPIC_API_KEY=...` (it's
gitignored). With a key present, ambiguous requests escalate to Haiku; without
one, everything runs on the deterministic path for $0.

## The defense cheat-sheet

- **Agentic vs. a script?** Two agents reason over ambiguity; orchestration is a
  workflow on purpose — autonomy is reserved for where it's actually needed.
- **Consistent?** Ranking is deterministic code → identical output for identical
  input.
- **Cost?** Haiku + prompt caching + only-when-needed; the gap between requests
  served and API calls is a measured number on the dashboard.
- **API down?** The rule-based parser is the offline fallback.
- **Trust the LLM?** Every response is validated against a Zod schema; failure →
  fallback.
- **Explainable?** Explanations are generated *from* the scoring factors, so
  they're always faithful to the decision.

## Tech

TypeScript · Node · Vitest · Zod · `@anthropic-ai/sdk` (Claude Haiku) ·
`chrono-node` · Hono (backend) · React + Vite (frontend).
