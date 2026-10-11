import type { SandboxRunRecord } from "./protocol";
import type { DatabaseSync, SqliteModule } from "./sqlite";

/**
 * The record of sandbox runs: what was run, how it ended and how long it
 * took. It never holds what a visitor typed. A run's input can contain a name
 * or a message the visitor wrote, and this list is shown to everyone, so the
 * only description of the input kept here is the id of a preset or the word
 * "custom".
 */
const LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS sandbox_runs (
  run_id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  preset TEXT NOT NULL,
  faults TEXT NOT NULL,
  status TEXT NOT NULL,
  events INTEGER NOT NULL,
  statements INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sandbox_runs_recorded_at_idx ON sandbox_runs(recorded_at);
`;

export interface LedgerEntry {
  runId: string;
  scenarioId: string;
  preset: string;
  faults: string[];
  status: SandboxRunRecord["status"];
  events: number;
  statements: number;
  ms: number;
  /** Epoch milliseconds. */
  recordedAt: number;
}

export interface Ledger {
  readonly storage: "file" | "memory";
  /** Writes a run, or replaces what was known about it: a run is recorded again after each decision. */
  record(entry: LedgerEntry): void;
  recent(limit: number): SandboxRunRecord[];
  /** Deletes runs older than `ttlMs` and everything beyond the newest `maxRows`. Returns how many went. */
  cleanup(now: number, ttlMs: number, maxRows: number): number;
  count(): number;
  close(): void;
}

const STATUSES = new Set(["success", "failed", "cancelled", "waiting"]);

export function openLedger(sqlite: SqliteModule, location: string): Ledger {
  const db: DatabaseSync = new sqlite.DatabaseSync(location);
  db.exec(LEDGER_SCHEMA);

  const upsert = db.prepare(
    `INSERT INTO sandbox_runs (run_id, scenario_id, preset, faults, status, events, statements, duration_ms, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       status = excluded.status, events = excluded.events, statements = excluded.statements,
       duration_ms = excluded.duration_ms, recorded_at = excluded.recorded_at`,
  );
  const newest = db.prepare("SELECT * FROM sandbox_runs ORDER BY recorded_at DESC, rowid DESC LIMIT ?");
  const expire = db.prepare("DELETE FROM sandbox_runs WHERE recorded_at < ?");
  const trim = db.prepare("DELETE FROM sandbox_runs WHERE run_id NOT IN (SELECT run_id FROM sandbox_runs ORDER BY recorded_at DESC, rowid DESC LIMIT ?)");
  const total = db.prepare("SELECT count(*) AS n FROM sandbox_runs");

  return {
    storage: location === ":memory:" ? "memory" : "file",
    record(entry) {
      upsert.run(entry.runId, entry.scenarioId, entry.preset, JSON.stringify(entry.faults), entry.status, entry.events, entry.statements, entry.ms, entry.recordedAt);
    },
    recent(limit) {
      return (newest.all(limit) as Record<string, unknown>[]).map((row) => {
        const status = String(row.status);
        let faults: string[] = [];
        try {
          const parsed: unknown = JSON.parse(String(row.faults));
          if (Array.isArray(parsed)) faults = parsed.filter((item): item is string => typeof item === "string");
        } catch {
          // A row that cannot be read is shown without its faults rather than breaking the list.
        }
        return {
          run: String(row.run_id).slice(4, 12),
          scenarioId: String(row.scenario_id),
          preset: String(row.preset),
          faults,
          status: (STATUSES.has(status) ? status : "failed") as SandboxRunRecord["status"],
          events: Number(row.events),
          statements: Number(row.statements),
          ms: Number(row.duration_ms),
          at: new Date(Number(row.recorded_at)).toISOString(),
        };
      });
    },
    cleanup(now, ttlMs, maxRows) {
      const expired = Number(expire.run(now - ttlMs).changes);
      const trimmed = Number(trim.run(maxRows).changes);
      return expired + trimmed;
    },
    count() {
      return Number((total.get() as { n?: unknown } | undefined)?.n ?? 0);
    },
    close() {
      db.close();
    },
  };
}
