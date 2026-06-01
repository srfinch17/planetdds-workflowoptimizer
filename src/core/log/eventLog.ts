import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only event log — the system's audit trail and the data behind the
 * activity dashboard. A PORT, like ScheduleStore: the whole app depends on this
 * interface, not on how events are stored. Today it's a JSONL file; in
 * production the same interface fronts a database or an observability pipeline
 * (CloudWatch / Datadog / OpenTelemetry) with no change to the call sites.
 *
 * PHI NOTE: events can contain raw patient messages, which are health
 * information. Fine for this mock-data demo. In production this log must be
 * encrypted at rest, access-controlled, retention-limited, and likely redacted.
 */
export type EventType = "schedule_request" | "escalation" | "booking" | "rule_added" | "error";

export interface LogEvent {
  id: string;
  ts: string; // ISO timestamp
  type: EventType;
  correlationId?: string; // links related events (e.g. a booking to its request)
  data: Record<string, unknown>;
}

export interface LogStats {
  total: number;
  byType: Record<string, number>;
  byPath: Record<string, number>; // intent path on schedule_request events
  escalations: { emergency: number; callback: number };
  bookings: { booked: number; conflict: number };
  errors: number;
  perMinute: { t: string; count: number }[]; // schedule_requests bucketed by minute
}

export interface RecentOptions {
  type?: EventType;
  limit?: number;
}

export interface EventLog {
  record(type: EventType, data: Record<string, unknown>, correlationId?: string): LogEvent;
  recent(opts?: RecentOptions): LogEvent[]; // newest-first
  all(): LogEvent[]; // oldest-first
  find(id: string): LogEvent | undefined;
  stats(): LogStats;
  reset(): void;
}

let seq = 0;
function nextId(): string {
  return `evt-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

export interface JsonlEventLogOptions {
  filePath?: string; // omit for memory-only (tests)
  maxBuffer?: number; // cap the in-memory buffer (default 5000)
}

/**
 * JSONL-file-backed EventLog with an in-memory buffer for fast reads. JSONL
 * (one JSON object per line) is append-only — no read-modify-write of the whole
 * file per event — and trivially greppable/tailable.
 */
export class JsonlEventLog implements EventLog {
  private events: LogEvent[] = [];
  private readonly filePath?: string;
  private readonly maxBuffer: number;

  constructor(opts: JsonlEventLogOptions = {}) {
    this.filePath = opts.filePath;
    this.maxBuffer = opts.maxBuffer ?? 5000;
    if (this.filePath) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.load();
    }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    const text = readFileSync(this.filePath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.events.push(JSON.parse(trimmed) as LogEvent);
      } catch {
        // Skip a corrupt/partial line rather than crash the whole log.
      }
    }
    if (this.events.length > this.maxBuffer) {
      this.events = this.events.slice(-this.maxBuffer);
    }
  }

  record(type: EventType, data: Record<string, unknown>, correlationId?: string): LogEvent {
    const event: LogEvent = { id: nextId(), ts: new Date().toISOString(), type, data };
    if (correlationId) event.correlationId = correlationId;
    this.events.push(event);
    if (this.events.length > this.maxBuffer) this.events.shift();
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf-8");
      } catch {
        // Logging must never break the request it's recording.
      }
    }
    return event;
  }

  recent(opts: RecentOptions = {}): LogEvent[] {
    let list = this.events;
    if (opts.type) list = list.filter((e) => e.type === opts.type);
    const newestFirst = [...list].reverse();
    return opts.limit ? newestFirst.slice(0, opts.limit) : newestFirst;
  }

  all(): LogEvent[] {
    return [...this.events];
  }

  find(id: string): LogEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  stats(): LogStats {
    const byType: Record<string, number> = {};
    const byPath: Record<string, number> = {};
    const escalations = { emergency: 0, callback: 0 };
    const bookings = { booked: 0, conflict: 0 };
    const perMinuteMap = new Map<string, number>();
    let errors = 0;

    for (const e of this.events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.type === "schedule_request") {
        const path = typeof e.data.path === "string" ? e.data.path : "unknown";
        byPath[path] = (byPath[path] ?? 0) + 1;
        const minute = e.ts.slice(0, 16); // "YYYY-MM-DDTHH:mm"
        perMinuteMap.set(minute, (perMinuteMap.get(minute) ?? 0) + 1);
      } else if (e.type === "escalation") {
        if (e.data.level === "emergency") escalations.emergency += 1;
        else if (e.data.level === "callback") escalations.callback += 1;
      } else if (e.type === "booking") {
        if (e.data.outcome === "conflict") bookings.conflict += 1;
        else bookings.booked += 1;
      } else if (e.type === "error") {
        errors += 1;
      }
    }

    const perMinute = [...perMinuteMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, count]) => ({ t, count }));

    return { total: this.events.length, byType, byPath, escalations, bookings, errors, perMinute };
  }

  reset(): void {
    this.events = [];
    if (this.filePath) {
      try {
        writeFileSync(this.filePath, "", "utf-8");
      } catch {
        /* ignore */
      }
    }
  }
}
