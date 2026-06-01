import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonlEventLog } from "../src/core/log/eventLog";

const tmpDirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "evtlog-"));
  tmpDirs.push(dir);
  return join(dir, "events.jsonl");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("JsonlEventLog (in-memory mode)", () => {
  it("records events and returns them newest-first", () => {
    const log = new JsonlEventLog({});
    const a = log.record("schedule_request", { request: "one" });
    const b = log.record("booking", { outcome: "booked" });
    expect(a.id).toBeTruthy();
    expect(a.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const recent = log.recent();
    expect(recent[0]!.id).toBe(b.id); // newest first
    expect(recent[1]!.id).toBe(a.id);
  });

  it("filters by type and respects limit", () => {
    const log = new JsonlEventLog({});
    log.record("schedule_request", { request: "a" });
    log.record("schedule_request", { request: "b" });
    log.record("booking", { outcome: "booked" });
    expect(log.recent({ type: "schedule_request" })).toHaveLength(2);
    expect(log.recent({ limit: 1 })).toHaveLength(1);
  });

  it("stores a correlationId when given", () => {
    const log = new JsonlEventLog({});
    const req = log.record("schedule_request", { request: "x" });
    const booking = log.record("booking", { outcome: "booked" }, req.id);
    expect(booking.correlationId).toBe(req.id);
  });

  it("computes stats: counts by type, escalations, bookings, errors", () => {
    const log = new JsonlEventLog({});
    log.record("schedule_request", { path: "rules", escalationLevel: "none" });
    log.record("schedule_request", { path: "llm", escalationLevel: "none" });
    log.record("escalation", { level: "emergency" });
    log.record("booking", { outcome: "booked" });
    log.record("booking", { outcome: "conflict" });
    log.record("error", { message: "boom" });
    const s = log.stats();
    expect(s.total).toBe(6);
    expect(s.byType.schedule_request).toBe(2);
    expect(s.byPath.rules).toBe(1);
    expect(s.byPath.llm).toBe(1);
    expect(s.escalations.emergency).toBe(1);
    expect(s.bookings.booked).toBe(1);
    expect(s.bookings.conflict).toBe(1);
    expect(s.errors).toBe(1);
  });

  it("reset() clears everything", () => {
    const log = new JsonlEventLog({});
    log.record("schedule_request", { request: "x" });
    log.reset();
    expect(log.recent()).toHaveLength(0);
    expect(log.stats().total).toBe(0);
  });
});

describe("JsonlEventLog (file-backed persistence)", () => {
  it("appends to a file and a new instance loads the history back", () => {
    const file = tempFile();
    const log1 = new JsonlEventLog({ filePath: file });
    log1.record("schedule_request", { request: "persisted one" });
    log1.record("booking", { outcome: "booked" });
    expect(existsSync(file)).toBe(true);

    // Fresh instance over the same file → history is restored.
    const log2 = new JsonlEventLog({ filePath: file });
    expect(log2.all()).toHaveLength(2);
    expect(log2.recent()[0]!.data.outcome).toBe("booked");
  });

  it("reset() truncates the file too", () => {
    const file = tempFile();
    const log = new JsonlEventLog({ filePath: file });
    log.record("schedule_request", { request: "x" });
    log.reset();
    const reloaded = new JsonlEventLog({ filePath: file });
    expect(reloaded.all()).toHaveLength(0);
  });
});
