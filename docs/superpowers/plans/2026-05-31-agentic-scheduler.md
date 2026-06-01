# Agentic Scheduling Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal, agentic appointment-scheduling assistant that turns an unstructured patient request ("Can I come in next Thursday after 3?") into the top-3 ranked, explainable appointment slots — using an LLM only where language understanding is genuinely needed, and deterministic code everywhere else.

**Architecture:** Orchestrator–workers pattern. A deterministic **Scheduling Assistant** (orchestrator) coordinates two specialist agents: an **Intent Agent** (LLM-backed, with a deterministic rule-based fallback for cost control and offline operation) and a **Schedule-Reasoning Agent** (fully deterministic constraint evaluation + weighted scoring). Mock data is JSON. A small Node backend holds the API key; a React/Vite frontend provides the patient intake + admin dashboard.

**Tech Stack:** TypeScript, Node 26, `tsx` (dev runner), Vitest (tests), Zod (LLM output validation), `@anthropic-ai/sdk` (Claude Haiku), `chrono-node` (deterministic natural-language date parsing — powers the offline path), `dotenv`. Frontend: React + Vite. Backend: Hono (tiny HTTP server).

---

## Why this design works

The core principles behind the system:

1. **Agentic, not a script.** Two specialist agents reason over ambiguity (language interpretation, constraint trade-offs). The orchestration is a *workflow* (fixed path) because the steps never branch — per Anthropic's "Building Effective Agents," use a workflow when control flow is fixed and reserve agentic autonomy for where it's needed. Drawing that line is a deliberate judgment call, not a limitation.
2. **Consistent.** Ranking is pure deterministic code. Same request + same schedule → identical recommendations every time. An LLM alone can't guarantee that.
3. **Cost-effective.** The LLM (cheap Haiku model) is called only when the deterministic parser can't fully resolve a request. The dashboard shows the % of requests handled for free and the est. cost per 1,000 requests.
4. **Resilient when the API is down.** The rule-based parser *is* the offline mode. Graceful degradation is built into the foundation (Tiered extractor), not bolted on.
5. **Trustworthy LLM output.** Every LLM response is validated against a Zod schema. The LLM is treated as an untrusted input boundary; validation failure triggers the deterministic fallback.
6. **Explainable.** Explanations are generated from the actual scoring factors, so they're always faithful to the real decision — not narrated after the fact by an LLM.
7. **Extensible.** The schedule data sits behind a `ScheduleStore` interface; swapping mock JSON for Google Calendar, an EHR, or a practice-management DB is a drop-in change. Practice-specific clinical judgment (urgency triage) lives in a swappable Agent Skill.

**Honesty guardrail (do not blur this distinction):** Hard availability constraints ("Dr. Pana never works Fridays") are stored as **structured data** and enforced deterministically — never delegated to an LLM's memory. The LLM only *translates* an admin's English sentence into that structured rule. A real Agent **Skill** is reserved for genuinely *fuzzy* judgment (clinical urgency triage), not hard rules.

---

## Build Floors (always-demoable layering)

Each floor leaves a complete, working system. The floors are sequential; each builds on the last.

| Floor | Delivers | Tasks |
|-------|----------|-------|
| **0** | Project skeleton, git, deps, mock data | T1–T3 |
| **1** | CLI core: request → intent → candidates → ranked top-3 + explanation | T4–T10 |
| **2** | Zod validation, tiered/offline intent, 3 edge-case scenarios | T11–T14 |
| **3** | Hono backend + React/Vite UI with live calendar | T15–T18 |
| **4** | Admin dashboard: cost/efficiency metrics + utilization | T19–T20 |
| **5** | NL "teach a rule" feature + dental-triage Agent Skill flex | T21–T23 |

---

## File Structure

```
planetdds-workflowoptimizer/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  .env                      # ANTHROPIC_API_KEY — NEVER committed
  .env.example              # documents required vars, safe to commit
  README.md
  src/
    core/
      types.ts              # all shared TypeScript interfaces
      time.ts               # time/date helpers (slot math, weekday checks)
      data/                 # mock JSON data (seed)
        providers.json
        operatories.json
        patients.json
        appointmentTypes.json
        appointments.json   # the "calendar" (mutable at runtime)
        rules.json          # availability constraints (mutable at runtime)
      store/
        ScheduleStore.ts    # interface
        JsonScheduleStore.ts# reads/writes the JSON files
      intent/
        intentSchema.ts     # Zod schema + SchedulingIntent type
        RuleBasedIntentExtractor.ts
        LlmIntentExtractor.ts
        TieredIntentExtractor.ts
      schedule/
        candidateGenerator.ts  # enumerate slots satisfying HARD constraints
        scorer.ts              # weighted scoring + explanation strings
        ScheduleReasoningAgent.ts
      orchestrator/
        SchedulingAssistant.ts # the coordinator
      rules/
        ruleSchema.ts          # Zod schema for AvailabilityRule
        ruleParser.ts          # English sentence -> AvailabilityRule (LLM + fallback)
      llm/
        anthropicClient.ts     # wraps SDK, tracks token usage + cost
        costTracker.ts
      skills/
        dental-triage/
          SKILL.md             # the Agent Skill flex
    cli/
      index.ts                 # CLI entry: type a request, see ranked slots
    server/
      index.ts                 # Hono API: POST /api/schedule, /api/rules, GET /api/state, /api/metrics
  web/                         # Vite + React frontend (created in Floor 3)
  tests/
    ...
  docs/superpowers/plans/2026-05-31-agentic-scheduler.md
```

---

## Data Models (seed mock data)

These shapes are referenced by every later task. Times are local wall-clock ISO strings (no timezone math for the demo — single clinic, single zone).

**providers.json**
```json
[
  { "id": "prov-smith", "name": "Dr. Smith", "role": "dentist", "specialties": ["general", "extraction"], "workdays": ["Mon","Tue","Wed","Thu","Fri"], "hours": { "start": "08:00", "end": "17:00" } },
  { "id": "prov-pana", "name": "Dr. Pana", "role": "dentist", "specialties": ["general", "crown"], "workdays": ["Mon","Tue","Wed","Thu"], "hours": { "start": "09:00", "end": "16:00" } },
  { "id": "prov-jones", "name": "Dr. Jones", "role": "hygienist", "specialties": ["cleaning"], "workdays": ["Mon","Tue","Wed","Thu","Fri"], "hours": { "start": "08:00", "end": "16:00" } }
]
```

**operatories.json**
```json
[
  { "id": "op-1", "name": "Operatory 1", "equipment": ["xray"] },
  { "id": "op-2", "name": "Operatory 2", "equipment": ["xray"] },
  { "id": "op-3", "name": "Operatory 3", "equipment": [] }
]
```

**appointmentTypes.json**
```json
[
  { "type": "cleaning", "durationMin": 30, "defaultUrgency": "routine" },
  { "type": "checkup", "durationMin": 30, "defaultUrgency": "routine" },
  { "type": "filling", "durationMin": 45, "defaultUrgency": "soon" },
  { "type": "extraction", "durationMin": 60, "defaultUrgency": "soon" },
  { "type": "emergency", "durationMin": 45, "defaultUrgency": "urgent" }
]
```

**patients.json**
```json
[
  { "id": "pat-doe", "name": "Jane Doe", "preferredProviderId": "prov-smith" },
  { "id": "pat-roe", "name": "Richard Roe", "preferredProviderId": null }
]
```

**appointments.json** (existing bookings — the calendar; mutable)
```json
[
  { "id": "appt-001", "providerId": "prov-smith", "operatoryId": "op-1", "patientId": "pat-roe", "start": "2026-06-04T09:00:00", "end": "2026-06-04T09:30:00", "type": "cleaning" },
  { "id": "appt-002", "providerId": "prov-smith", "operatoryId": "op-1", "patientId": "pat-doe", "start": "2026-06-04T15:00:00", "end": "2026-06-04T15:30:00", "type": "checkup" }
]
```

**rules.json** (availability constraints; mutable — admin adds to this)
```json
[
  { "id": "rule-001", "providerId": "prov-smith", "kind": "block", "recurrence": "daily", "start": "11:00", "end": "12:30", "reason": "lunch" },
  { "id": "rule-002", "providerId": "prov-pana", "kind": "dayoff", "weekday": "Fri", "reason": "never works Fridays" }
]
```

---

## Core Types (`src/core/types.ts`)

Defined once, used everywhere. Establish these before any logic task.

```ts
export type Urgency = "routine" | "soon" | "urgent";
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export interface Provider {
  id: string; name: string; role: "dentist" | "hygienist";
  specialties: string[]; workdays: Weekday[];
  hours: { start: string; end: string };
}
export interface Operatory { id: string; name: string; equipment: string[]; }
export interface AppointmentType { type: string; durationMin: number; defaultUrgency: Urgency; }
export interface Patient { id: string; name: string; preferredProviderId: string | null; }
export interface Appointment {
  id: string; providerId: string; operatoryId: string; patientId: string;
  start: string; end: string; type: string;
}
export interface AvailabilityRule {
  id: string; providerId: string;
  kind: "block" | "dayoff";
  recurrence?: "daily"; weekday?: Weekday;
  start?: string; end?: string; reason: string;
}

// Output of the Intent Agent
export interface SchedulingIntent {
  appointmentType: string | null;
  urgency: Urgency;
  earliestDate: string | null;   // ISO date "2026-06-04"
  latestDate: string | null;
  daysOfWeek: Weekday[];
  timeEarliest: string | null;   // "15:00"
  timeLatest: string | null;
  partOfDay: "morning" | "afternoon" | "evening" | null;
  preferredProviderId: string | null;
  rawRequest: string;
  source: "rules" | "llm";       // which path produced this (offline transparency)
  confidence: number;            // 0..1
}

// Candidate + scored slot
export interface CandidateSlot {
  providerId: string; operatoryId: string;
  start: string; end: string; type: string;
}
export interface ScoreFactor {
  name: string; weight: number; matched: boolean;
  detail: string; contribution: number;
}
export interface ScoredSlot {
  slot: CandidateSlot; score: number;
  factors: ScoreFactor[]; explanation: string;
}
```

---

## TASKS

> Each task: write the test, watch it fail, implement, watch it pass, commit. Use Vitest: `npx vitest run <path>`.

### Task 1: Project skeleton + git + tooling

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1: Init project & git**
```bash
cd "C:\Users\srfin\Dropbox\Dev\repos\planetdds-workflowoptimizer"
git init
npm init -y
npm install @anthropic-ai/sdk zod chrono-node dotenv hono
npm install -D typescript tsx vitest @types/node
```
- [ ] **Step 2: Write `.gitignore`** (CRITICAL — protects the API key)
```
node_modules/
dist/
.env
web/node_modules/
web/dist/
*.log
```
- [ ] **Step 3: Write `.env.example`**
```
# Copy to .env and fill in. .env is gitignored — never commit the real key.
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
ANTHROPIC_MODEL=claude-haiku-4-5
SCHEDULER_OFFLINE=false
```
- [ ] **Step 4: Write `tsconfig.json`** — strict mode on (`"strict": true`), `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"target": "ES2022"`, `"types": ["node"]`. Set `"type": "module"` in package.json.
- [ ] **Step 5: Add npm scripts** to package.json: `"cli": "tsx src/cli/index.ts"`, `"server": "tsx src/server/index.ts"`, `"test": "vitest run"`, `"test:watch": "vitest"`.
- [ ] **Step 6: Connect remote & first commit**
```bash
git remote add origin https://github.com/srfinch17/planetdds-workflowoptimizer.git
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "chore: project skeleton, tooling, and secrets hygiene"
```
**Design note:** Explain why `.env` is gitignored from commit #1 — a leaked key in a public repo is the one genuinely embarrassing mistake.

### Task 2: Seed mock data

**Files:** Create all JSON files under `src/core/data/` (contents from the Data Models section above).

- [ ] **Step 1:** Create the 6 JSON files verbatim from the Data Models section.
- [ ] **Step 2: Commit**
```bash
git add src/core/data/
git commit -m "feat: seed mock clinic data (providers, operatories, appointments, rules)"
```

### Task 3: Core types

**Files:** Create `src/core/types.ts` (contents from Core Types section).

- [ ] **Step 1:** Paste the types from the Core Types section.
- [ ] **Step 2: Commit** `git add src/core/types.ts && git commit -m "feat: shared domain types"`

### Task 4: Time helpers (TDD)

**Files:** Create `src/core/time.ts`; Test `tests/time.test.ts`

- [ ] **Step 1: Failing test** — covers `weekdayOf(iso)`, `overlaps(aStart,aEnd,bStart,bEnd)`, `addMinutes(iso, n)`, `withinHours(iso, start, end)`.
```ts
import { describe, it, expect } from "vitest";
import { weekdayOf, overlaps, addMinutes, withinHours } from "../src/core/time";
describe("time", () => {
  it("weekdayOf returns short weekday", () => {
    expect(weekdayOf("2026-06-04T09:00:00")).toBe("Thu");
  });
  it("overlaps detects intersection", () => {
    expect(overlaps("2026-06-04T09:00:00","2026-06-04T09:30:00","2026-06-04T09:15:00","2026-06-04T09:45:00")).toBe(true);
    expect(overlaps("2026-06-04T09:00:00","2026-06-04T09:30:00","2026-06-04T09:30:00","2026-06-04T10:00:00")).toBe(false);
  });
  it("addMinutes advances ISO", () => {
    expect(addMinutes("2026-06-04T09:00:00", 30)).toBe("2026-06-04T09:30:00");
  });
  it("withinHours respects clinic window", () => {
    expect(withinHours("2026-06-04T08:30:00","08:00","17:00")).toBe(true);
    expect(withinHours("2026-06-04T17:30:00","08:00","17:00")).toBe(false);
  });
});
```
- [ ] **Step 2:** Run `npx vitest run tests/time.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `time.ts` with those four pure functions. Use plain `Date` parsing on the local ISO strings; format back with a small `toIso(date)` helper to keep `YYYY-MM-DDTHH:mm:ss`. Weekday map: `["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]`.
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: deterministic time/slot helpers with tests"`

### Task 5: ScheduleStore interface + JsonScheduleStore (TDD)

**Files:** Create `src/core/store/ScheduleStore.ts`, `src/core/store/JsonScheduleStore.ts`; Test `tests/store.test.ts`

- [ ] **Step 1: Define interface** in `ScheduleStore.ts`:
```ts
import { Provider, Operatory, Patient, AppointmentType, Appointment, AvailabilityRule, CandidateSlot } from "../types";
export interface ScheduleStore {
  getProviders(): Provider[];
  getOperatories(): Operatory[];
  getPatients(): Patient[];
  getAppointmentTypes(): AppointmentType[];
  getAppointments(): Appointment[];
  getRules(): AvailabilityRule[];
  addRule(rule: AvailabilityRule): void;
  book(slot: CandidateSlot, patientId: string): Appointment;
}
```
- [ ] **Step 2: Failing test** — load store from the seed `data/` dir, assert provider count = 3, appointments = 2; `book()` appends an appointment and returns it with a generated id; `addRule()` appends.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement `JsonScheduleStore` — constructor takes a data directory path, reads the 6 JSON files into memory. `book`/`addRule` mutate in-memory arrays AND write back to disk (so the demo calendar updates live). Generate ids with a counter + prefix.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat: ScheduleStore interface + JSON-backed implementation"`
**Design note:** The interface is the "future integration point" — Google Calendar/EHR slot in here unchanged.

### Task 6: Candidate generator — HARD constraints (TDD)

**Files:** Create `src/core/schedule/candidateGenerator.ts`; Test `tests/candidates.test.ts`

This is the heart of "reason over constraints." Generates every open slot that satisfies *hard* constraints (no scoring yet).

- [ ] **Step 1: Failing test.** Given the seed data and an intent for a 30-min "checkup" on 2026-06-04 (Thu), assert: candidates exist; none overlap an existing appointment for the same provider/operatory; none fall inside Dr. Smith's 11:00–12:30 lunch block; none are assigned to Dr. Pana on a Friday; all fall within provider hours.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `generateCandidates(intent, store)`:
  - Determine duration from `appointmentTypes` (default 30 if type unknown).
  - Determine the date range to search (intent dates, else next 5 business days).
  - For each provider × operatory × candidate date × time-grid (15-min increments):
    - Skip if weekday not in provider.workdays.
    - Skip if a `dayoff` rule matches (provider + weekday).
    - Skip if slot not within provider.hours.
    - Skip if slot overlaps a `block` rule (e.g., lunch).
    - Skip if slot overlaps an existing appointment for that provider OR that operatory.
  - Return `CandidateSlot[]`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: hard-constraint candidate slot generation"`

### Task 7: Scorer — soft preferences + explanations (TDD)

**Files:** Create `src/core/schedule/scorer.ts`; Test `tests/scorer.test.ts`

Deterministic weighted scoring. Produces the `factors` + human `explanation`.

- [ ] **Step 1: Failing test.** A slot at Thu 15:30 for an intent "after 15:00, prefers Dr. Smith" should score higher than a slot at 09:00 with a different provider. Explanation string should mention the matched time window and preferred provider.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `scoreSlot(slot, intent, store): ScoredSlot`. Weighted factors (each contributes weight × matched):
  - `time_window_match` (weight 35): slot start satisfies timeEarliest/timeLatest/partOfDay.
  - `date_preference` (weight 20): earlier within the requested range scores higher (soonest-first), or matches requested weekday.
  - `urgency_fit` (weight 25): for `urgent`, strongly reward the soonest available; for `routine`, neutral.
  - `preferred_provider` (weight 15): matches intent.preferredProviderId.
  - `operatory_equipment` (weight 5): has xray if type needs it (extraction/emergency).
  Sum contributions → `score` (0..100 normalized). Build `explanation` by joining the `detail` strings of matched factors into one plain-English sentence.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: deterministic weighted slot scoring with explanations"`
**Design note:** Explanations are derived from the same factors that drive the score — guaranteed faithful.

### Task 8: ScheduleReasoningAgent — rank top N (TDD)

**Files:** Create `src/core/schedule/ScheduleReasoningAgent.ts`; Test `tests/reasoningAgent.test.ts`

- [ ] **Step 1: Failing test.** `recommend(intent, store, 3)` returns ≤3 `ScoredSlot`s, sorted descending by score, deduped so the same time isn't offered across many operatories (collapse to best operatory per provider+time).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: call `generateCandidates`, `scoreSlot` each, dedupe by `providerId+start` keeping highest score, sort desc, slice N. Also implement a `bestEffort` flag in the return when nothing matched the time window (for the "no good match" edge case) — return the closest-by-score slots anyway with an honest explanation.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: schedule-reasoning agent ranks top-3 with best-effort fallback"`

### Task 9: RuleBasedIntentExtractor (TDD — this is the offline brain)

**Files:** Create `src/core/intent/RuleBasedIntentExtractor.ts`; Test `tests/ruleIntent.test.ts`

Uses `chrono-node` for date/time parsing + keyword matching for urgency/type/provider. No LLM.

- [ ] **Step 1: Failing test.** "Can I come in next Thursday after 3?" → daysOfWeek includes "Thu" (or earliestDate set to that Thursday), timeEarliest "15:00", source "rules", confidence ≥ 0.6. "my tooth is killing me, anything today" → urgency "urgent", appointmentType "emergency", earliestDate today.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement using `chrono.parse(request, refDate)` to extract dates/times; map parsed time to `timeEarliest`/`timeLatest` (e.g., "after 3" → earliest 15:00; "before noon" → latest 12:00; "morning/afternoon/evening" → partOfDay). Keyword tables: urgency (`pain|killing|emergency|asap|today|broken` → urgent), type (`clean|cleaning` → cleaning, `tooth|ache|hurt` → emergency, etc.), provider names → ids. Set `confidence` based on how many fields were resolved.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: deterministic rule-based intent extraction (offline path)"`
**Design note:** This single class is your offline mode *and* your cost-saver — same code serves both.

### Task 10: Orchestrator + CLI (Floor 1 demoable!) (TDD + manual)

**Files:** Create `src/core/orchestrator/SchedulingAssistant.ts`, `src/cli/index.ts`; Test `tests/assistant.test.ts`

- [ ] **Step 1: Failing test.** `SchedulingAssistant` constructed with a rule-based extractor + reasoning agent + store; `handle("Can I come in next Thursday after 3?")` returns 1–3 `ScoredSlot`s whose first slot is on a Thursday at/after 15:00.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `SchedulingAssistant.handle(rawRequest)`: extract intent → reasoning agent recommend(3) → return `{ intent, recommendations }`. Then build `cli/index.ts`: read a request from argv (or a prompt), run the assistant, pretty-print the intent + the ranked slots with explanations.
- [ ] **Step 4:** Run test → PASS. Then manual: `npm run cli -- "Can I come in next Thursday after 3?"` and eyeball the output.
- [ ] **Step 5: Commit** `git commit -am "feat: scheduling assistant orchestrator + CLI (Floor 1 complete)"`

> **FLOOR 1 COMPLETE.** A complete, working CLI delivering the core feature. Everything below is upside.

### Task 11: Zod intent schema + validation (TDD)

**Files:** Create `src/core/intent/intentSchema.ts`; Test `tests/intentSchema.test.ts`

- [ ] **Step 1: Failing test.** A well-formed object parses; a malformed one (bad urgency enum, wrong types) throws/returns an error result.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Define a Zod schema mirroring `SchedulingIntent`; export `parseIntent(unknown): { ok: true; intent } | { ok: false; error }`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: Zod schema validates intent shape"`

### Task 12: LLM intent extractor + cost tracking (TDD with mocked SDK)

**Files:** Create `src/core/llm/anthropicClient.ts`, `src/core/llm/costTracker.ts`, `src/core/intent/LlmIntentExtractor.ts`; Test `tests/llmIntent.test.ts`

- [ ] **Step 1: Failing test** (mock the Anthropic SDK call): given a fake API response containing JSON intent, `LlmIntentExtractor.extract` returns a validated `SchedulingIntent` with `source: "llm"`; if the fake response is malformed, it throws a typed error (so the tiered layer can fall back). Cost tracker accumulates input/output tokens and computes a dollar estimate.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `anthropicClient` wrapping `@anthropic-ai/sdk` with **prompt caching** on the system prompt (the schema/instructions are constant — cache them to cut cost), model from `ANTHROPIC_MODEL`. Use a tool/JSON-structured prompt that asks Claude to return the intent fields. Pipe the raw text through `parseIntent` (Task 11). `costTracker` maps token counts → USD using Haiku pricing constants. `LlmIntentExtractor` calls the client, validates, stamps `source: "llm"`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: LLM intent extractor with Zod validation, prompt caching, cost tracking"`
**Design note:** Prompt caching + Haiku + only-when-needed = the three cost levers, all visible.

### Task 13: TieredIntentExtractor — graceful degradation (TDD)

**Files:** Create `src/core/intent/TieredIntentExtractor.ts`; Test `tests/tiered.test.ts`

- [ ] **Step 1: Failing test.** (a) A simple request the rule parser resolves with high confidence → never calls the LLM (assert mock not called), source "rules". (b) An ambiguous request with low rule confidence + online → calls LLM, source "llm". (c) `SCHEDULER_OFFLINE=true` or LLM throws → falls back to rule-based result without throwing.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: run rule-based first; if `confidence >= THRESHOLD` return it; else if offline flag set → return rule-based (flagged low confidence); else try LLM, on success return it, on failure return rule-based. Record which path was taken (for the dashboard).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: tiered intent extraction (rules-first, LLM escalation, offline fallback)"`

### Task 14: Three demo scenarios as a fixture/test

**Files:** Create `tests/scenarios.test.ts`, `src/cli/scenarios.ts`

- [ ] **Step 1:** Encode the 3 canonical demo scenarios as tests AND a `scenarios` CLI subcommand that runs them in sequence with narration:
  1. **Happy path:** "Can I come in next Thursday after 3?" → clean Thu ≥15:00 match.
  2. **Ambiguity:** "sometime next week, mornings are better but I'm flexible" → LLM resolves; morning slots ranked top.
  3. **Urgent/no-perfect-match:** "my tooth is killing me, anything today" when today is full → triage urgent, best-effort closest slots, explanation states it couldn't do better.
- [ ] **Step 2:** Run → PASS (scenarios 1 & 3 work offline; scenario 2 may use LLM — gate it so the test passes offline by asserting structure, not exact LLM text).
- [ ] **Step 3: Commit** `git commit -am "feat: three canonical demo scenarios (happy, ambiguous, urgent best-effort)"`

> **FLOOR 2 COMPLETE.** Robust, validated, offline-capable, with three example scenarios.

### Task 15: Hono backend API

**Files:** Create `src/server/index.ts`

- [ ] **Step 1:** Build a Hono server exposing:
  - `POST /api/schedule` `{ request: string }` → `{ intent, recommendations, pathTaken }`
  - `GET /api/state` → providers, operatories, appointments, rules (for calendar render)
  - `POST /api/rules` `{ sentence: string }` → parsed rule + updated rules (Floor 5 wires the parser; stub returns 501 until then)
  - `GET /api/metrics` → cost/efficiency snapshot from costTracker + path counts
  - `POST /api/book` `{ slot, patientId }` → books and returns updated appointments
  The API key stays server-side here — **never** sent to the browser.
- [ ] **Step 2:** Manual check: `npm run server`, curl `POST /api/schedule`.
- [ ] **Step 3: Commit** `git commit -am "feat: Hono backend API wrapping the scheduling core"`
**Design note:** Why a backend at all? Because the API key must never live in browser code.

### Task 16: Vite + React app scaffold

**Files:** Create `web/` via `npm create vite@latest web -- --template react-ts`; configure dev proxy `/api` → `http://localhost:3000`.

- [ ] **Step 1:** Scaffold, install, set Vite proxy in `web/vite.config.ts`.
- [ ] **Step 2:** Strip boilerplate; create an App shell with two tabs: **Intake** and **Admin**.
- [ ] **Step 3: Commit** `git commit -am "chore: Vite/React frontend scaffold with API proxy"`

### Task 17: Patient Intake view

**Files:** `web/src/views/Intake.tsx`, supporting components.

- [ ] **Step 1:** A text box + "Find appointments" button → POST `/api/schedule` → render the extracted intent (as chips) and the 3 ranked slots as cards, each showing score, the matched factors, and the plain-English explanation. A "Book" button per card → POST `/api/book`.
- [ ] **Step 2:** Manual check end-to-end.
- [ ] **Step 3: Commit** `git commit -am "feat: patient intake UI with explainable ranked recommendations"`

### Task 18: Live calendar view

**Files:** `web/src/components/Calendar.tsx`

- [ ] **Step 1:** Render a day/week grid (providers as columns, time as rows) from `GET /api/state`. Show existing appointments as blocks and grey out rule blocks (lunch / days off). When recommendations return, highlight the recommended slots on the grid. Hand-rolled grid (no heavy calendar dep) for robustness.
- [ ] **Step 2:** Manual check: booking a slot updates the grid.
- [ ] **Step 3: Commit** `git commit -am "feat: live calendar grid with recommendation highlighting"`

> **FLOOR 3 COMPLETE.** The full UI is live.

### Task 19: Cost/efficiency metrics tracking

**Files:** extend `src/core/llm/costTracker.ts`, add `src/server` metrics aggregation.

- [ ] **Step 1:** Track per-session: total requests, # handled by rules (free) vs LLM, total tokens, est. USD, est. cost per 1,000 requests, avg latency. Expose via `GET /api/metrics`.
- [ ] **Step 2: Commit** `git commit -am "feat: cost and efficiency metrics aggregation"`

### Task 20: Admin dashboard view

**Files:** `web/src/views/Admin.tsx`, chart components.

- [ ] **Step 1:** Dashboard tiles: donut of rules-handled (free) vs LLM; "est. cost / 1,000 requests"; avg time-to-recommendation vs a manual baseline; provider utilization bars. Lightweight charts (hand-rolled SVG or a tiny chart lib).
- [ ] **Step 2:** Manual check with attention to polish.
- [ ] **Step 3: Commit** `git commit -am "feat: admin dashboard with cost + utilization metrics"`

> **FLOOR 4 COMPLETE.** The management dashboard is done.

### Task 21: AvailabilityRule schema + NL rule parser (TDD)

**Files:** Create `src/core/rules/ruleSchema.ts`, `src/core/rules/ruleParser.ts`; Test `tests/ruleParser.test.ts`

- [ ] **Step 1: Failing test.** "Dr. Smith takes lunch from 11 to 12:30 every day" → `{ providerId: "prov-smith", kind: "block", recurrence: "daily", start: "11:00", end: "12:30" }`. "Dr. Pana never works Fridays" → `{ providerId: "prov-pana", kind: "dayoff", weekday: "Fri" }`. Validate with Zod.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `parseRuleSentence(sentence, store)`: LLM call (reuse anthropicClient) → JSON → Zod validate → resolve provider name to id. Offline fallback: regex for the two common patterns (block with times, dayoff with weekday). On low confidence, return an error the UI surfaces as "couldn't parse — try rephrasing."
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: natural-language to structured availability rule parser"`
**Design note (CRITICAL):** The LLM only *translates* the sentence; the resulting rule is structured data the deterministic scheduler enforces every time. Hard constraints are never left to LLM memory.

### Task 22: Wire NL rule into API + Admin UI

**Files:** finish `POST /api/rules` in `src/server/index.ts`; add a rule-input box to `web/src/views/Admin.tsx`.

- [ ] **Step 1:** Admin types a sentence → POST `/api/rules` → parser → `store.addRule` → calendar greys out the new block live. Show the parsed structured rule back to the admin (transparency).
- [ ] **Step 2:** Manual demo check.
- [ ] **Step 3: Commit** `git commit -am "feat: admins teach scheduling rules in plain English (live)"`

### Task 23: Dental-triage Agent Skill

**Files:** Create `src/core/skills/dental-triage/SKILL.md`; reference it from the urgency-triage path.

- [ ] **Step 1:** Author a real Agent Skill (`SKILL.md` with name/description frontmatter) encoding clinical urgency triage judgment (e.g., throbbing/swelling/trauma → urgent same-day; sensitivity/routine → soon/routine). 
- [ ] **Step 2:** Wire it as the knowledge the urgency-classification step loads (its content becomes the system context for the triage decision). Demonstrate: drop in a different practice's skill → triage behavior changes with zero code change.
- [ ] **Step 3:** Add a short README section explaining the skill as the "extensible intelligence" layer and how it differs from hard rules.
- [ ] **Step 4: Commit** `git commit -am "feat: dental-triage Agent Skill as extensible clinical-judgment layer"`

> **FLOOR 5 COMPLETE.** Full system: agentic, cheap, offline-capable, explainable, with a live UI, a management dashboard, plain-English rule teaching, and a genuine Agent Skill.

---

## README (write last, Task 24)

A crisp README is an important deliverable. Include: the architecture diagram (orchestrator + 2 agents), how to run (CLI + web), the cost/offline design rationale, the rule-vs-skill distinction, and "future integrations" (Google Calendar/EHR behind ScheduleStore). Commit: `docs: README with architecture, run instructions, and design rationale`.

---

## Self-Review vs Requirements

| Requirement | Covered by |
|---|---|
| Accept unstructured requests | Task 10 CLI, Task 17 Intake UI |
| LLM/NLP agent extracts intent/constraints/preferences (incl. urgency) | Tasks 9, 11, 12, 13 |
| Coordinate with schedule-reasoning agent over mock JSON | Tasks 5, 6, 8 |
| Reasoning/scoring to rank top-3 | Tasks 7, 8 |
| Clear, explainable recommendations | Tasks 7 (factors→explanation), 17 (UI) |
| Reduces manual effort | Whole pipeline + dashboard baseline metric (Task 20) |
| Improves speed/accuracy | Latency metric (Task 19/20), deterministic correctness |
| Consistent, explainable decisions | Deterministic scoring (Task 7), faithful explanations |
| Mock data (CSV/JSON) | Task 2 (JSON) |

**Gaps:** none against the requirements. Floors 3–5 are upside beyond the minimum (which Floor 1 already delivers).
