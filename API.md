# API Reference

The scheduling engine is exposed as a small REST API (Hono). **The web app is
just one client** — the same endpoints could be called by a practice's portal, a
phone-tree transcription service, or an EHR/PMS integration. The engine itself
(`src/core/`) is pure and depends only on interfaces (`ScheduleStore`,
`LlmClient`, `EventLog`), so the HTTP layer is a thin adapter over it.

- Base URL (dev): `http://localhost:3000`. The web dev server proxies `/api/*` here.
- All request/response bodies are JSON.
- The Anthropic API key lives **only** in the server process; it is never sent to a client.

## Conventions

**Status codes**
| Code | Meaning |
|---|---|
| 200 | OK |
| 400 | Bad request (missing/empty required field, malformed JSON) |
| 404 | Not found (unknown route, or replay id that isn't a schedule request) |
| 409 | Conflict (slot already booked — no double-booking) |
| 422 | Unprocessable (a rule sentence the parser couldn't turn into a rule) |
| 500 | Unhandled server error (also recorded as an `error` log event) |

Errors return `{ "error": "<human-readable message>" }`.

---

## Scheduling

### `POST /api/schedule`
Turn an unstructured patient request into ranked, explainable slots. Emergency
detection runs first (see escalation).

**Request**
```json
{ "request": "Can I come in next Thursday after 3?", "refDate": "2026-05-31" }
```
`refDate` (optional, `YYYY-MM-DD`) pins "today" for reproducible demos; defaults to the server's today.

**Response** `200`
```json
{
  "intent": { "appointmentType": null, "urgency": "routine", "earliestDate": "2026-06-04",
              "timeEarliest": "15:00", "source": "rules", "confidence": 0.66, "...": "..." },
  "recommendation": {
    "slots": [ { "slot": { "providerId": "prov-pana", "operatoryId": "op-2",
                           "start": "2026-06-04T15:00:00", "end": "2026-06-04T15:30:00", "type": "appointment" },
                "score": 80, "factors": [ /* per-factor breakdown */ ], "explanation": "Thu at 3:00 PM — ..." } ],
    "bestEffort": false
  },
  "pathTaken": "rules",
  "escalation": { "level": "none", "headline": "", "message": "", "callbackRequired": false, "matched": null },
  "requestId": "evt-..."
}
```
`pathTaken` ∈ `rules | llm | offline-fallback | llm-failed-fallback`. `requestId` is the log event id — pass it to `/api/book` to correlate the booking to this request. Errors: `400`.

---

## Schedule state & booking

### `GET /api/state`
Everything the calendar renders from.
```json
{ "providers": [...], "operatories": [...], "patients": [...],
  "appointmentTypes": [...], "appointments": [...], "rules": [...] }
```

### `POST /api/book`
Book a recommended slot. Re-validates against current appointments, so it can
never double-book a provider or operatory.

**Request**
```json
{ "slot": { "providerId": "prov-pana", "operatoryId": "op-2",
            "start": "2026-06-04T15:00:00", "end": "2026-06-04T15:30:00", "type": "appointment" },
  "patientId": "pat-doe", "requestId": "evt-..." }
```
`requestId` (optional) links the booking to the originating schedule request in the log.

**Response** `200`: `{ "appointment": {...}, "appointments": [ /* updated list */ ] }`
Errors: `400` (missing slot/patientId), `409` (slot already taken).

---

## Emergency escalation

Escalation is part of the `POST /api/schedule` response (`escalation.level` is
`emergency | callback | none`). When `callbackRequired` is true the request is
pushed onto the staff queue.

### `GET /api/callbacks`
The staff "call this patient back" worklist, newest first.
```json
{ "callbacks": [ { "id": "cb-...", "request": "...", "level": "emergency",
                   "headline": "Possible medical emergency", "matched": "won't stop bleeding",
                   "createdAt": "2026-06-04T..." } ] }
```

---

## Rule teaching

### `POST /api/rules`
Translate one plain-English sentence into a structured availability rule (regex
offline; LLM fallback when a key is present), validate it, and persist it.

**Request**: `{ "sentence": "Dr. Smith never works Wednesdays" }`
**Response** `200`: `{ "rule": { "id": "rule-003", "providerId": "prov-smith", "kind": "dayoff", "weekday": "Wed", "...": "..." }, "source": "rules", "rules": [ /* updated list */ ] }`
Errors: `400` (empty), `422` (couldn't parse — message suggests rephrasing).

---

## Metrics

### `GET /api/metrics`
Cost/efficiency snapshot for the dashboard.
```json
{ "requestsServed": 4, "apiCalls": 1, "freeHandled": 3, "freeSharePct": 75,
  "pathCounts": { "rules": 3, "llm": 1, "offline-fallback": 0, "llm-failed-fallback": 0 },
  "estimatedUsd": 0.0008, "costPer1000Usd": 0.2, "avgLatencyMs": 12.4,
  "emergencyCallbacks": 1, "tokenTotals": {...} }
```

---

## Observability (event log)

An append-only audit log behind the `EventLog` interface (JSONL file in this
build; a database or log pipeline in production). Event types:
`schedule_request`, `escalation`, `booking`, `rule_added`, `error`. Every event
has `{ id, ts, type, correlationId?, data }`.

### `GET /api/logs?type=<type>&limit=<n>`
Recent events, newest first. `type` optional (filters); `limit` defaults to 100.
```json
{ "events": [ { "id": "evt-...", "ts": "...", "type": "booking",
                "correlationId": "evt-...", "data": { "outcome": "booked", "...": "..." } } ] }
```

### `GET /api/logs/stats`
Aggregates for the activity dashboard: `total`, `byType`, `byPath`,
`escalations {emergency, callback}`, `bookings {booked, conflict}`, `errors`,
and `perMinute` (schedule requests bucketed by minute).

### `POST /api/logs/replay`
Re-run a logged schedule request through the **current** code and diff the
result — a built-in regression check.
**Request**: `{ "id": "evt-..." }`
**Response** `200`: `{ "request", "refDate", "original": {...}, "current": {...}, "changed": <bool> }`
Errors: `404` (id isn't a `schedule_request`).

### `GET /api/logs/export?format=json|csv`
Download the full log as a file (`json` default, or `csv`).

### `POST /api/logs/reset`
Wipe the log (memory + file). Destructive — used to clear dev/test noise.
`{ "ok": true }`

> **PHI note:** log events can contain raw patient messages (health information).
> Acceptable here because all data is mock. In production this log must be
> encrypted at rest, access-controlled, retention-limited, and likely redacted.

---

## Production roadmap (not built — talking points)

- **Versioning** — routes would move under `/api/v1/` with a documented contract (OpenAPI generated from the Zod schemas).
- **Auth & multi-tenancy** — API keys / OAuth, per-practice isolation.
- **Persistence** — swap the in-memory `JsonScheduleStore` for a database (the interface already makes this a drop-in).
- **Hardening** — idempotency keys, rate limiting, pagination, request tracing.
