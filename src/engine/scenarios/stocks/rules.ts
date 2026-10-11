/**
 * Rules of the market-data platform, re-implemented from its Python source.
 *
 * Each block names the file it mirrors. The originals run against PostgreSQL
 * and a monotonic clock; here the same decisions run against plain rows and a
 * clock that is passed in, so a scenario can replay them deterministically.
 */

// ---------------------------------------------------------------------------
// Job queue: app/jobs/queue.py
// ---------------------------------------------------------------------------

/** Seconds before the first retry, doubling each time. app/jobs/queue.py:14-15 */
export const BACKOFF_BASE = 30;
export const BACKOFF_CAP = 3600;
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Worker threads and lease in seconds, per queue. app/worker.py:33 */
export const QUEUES = { realtime: { threads: 2, lease: 180 }, batch: { threads: 1, lease: 1800 } } as const;
export type QueueName = keyof typeof QUEUES;

/** The scheduler looks for due work this often. app/worker.py:34 */
export const TICK_EVERY_SECONDS = 5;

export type JobStatus = "queued" | "running" | "done" | "dead" | "expired";
export type RunStatus = "running" | "ok" | "error" | "lost";

export interface JobRow {
  id: number;
  key: string;
  kind: string;
  queue: QueueName;
  payload: Record<string, string | boolean>;
  status: JobStatus;
  /** Milliseconds on the scenario clock. */
  run_after: number;
  expires_at: number | null;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_until: number | null;
  last_error: string | null;
  finished_at: number | null;
}

export interface JobRunRow {
  job_id: number;
  attempt: number;
  worker: string;
  status: RunStatus;
  started_at: number;
  finished_at: number | null;
  error: string | null;
}

export interface NewJob {
  kind: string;
  key: string;
  queue?: QueueName;
  payload?: Record<string, string | boolean>;
  run_after?: number;
  expires_at?: number | null;
  max_attempts?: number;
}

/**
 * INSERT ... ON CONFLICT (key) DO NOTHING. Returns the new row, or null when a
 * job with this key already exists. app/jobs/queue.py:28-36
 */
export function enqueue(jobs: JobRow[], job: NewJob, now: number): JobRow | null {
  if (jobs.some((row) => row.key === job.key)) return null;
  const row: JobRow = {
    id: jobs.reduce((max, existing) => Math.max(max, existing.id), 0) + 1,
    key: job.key,
    kind: job.kind,
    queue: job.queue ?? "realtime",
    payload: job.payload ?? {},
    status: "queued",
    run_after: job.run_after ?? now,
    expires_at: job.expires_at ?? null,
    attempts: 0,
    max_attempts: job.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    locked_by: null,
    locked_until: null,
    last_error: null,
    finished_at: null,
  };
  jobs.push(row);
  return row;
}

/**
 * The oldest due job of a queue, taken for `leaseSeconds`. The SQL uses
 * FOR UPDATE SKIP LOCKED so two workers never take the same row; in a single
 * thread that is simply "the first match". app/jobs/queue.py:41-63
 */
export function claim(jobs: JobRow[], runs: JobRunRow[], queue: QueueName, worker: string, leaseSeconds: number, now: number): JobRow | null {
  const due = jobs
    .filter((row) => row.status === "queued" && row.queue === queue && row.run_after <= now && (row.expires_at === null || row.expires_at > now))
    .sort((a, b) => a.run_after - b.run_after || a.id - b.id)[0];
  if (!due) return null;
  due.status = "running";
  due.attempts += 1;
  due.locked_by = worker;
  due.locked_until = now + leaseSeconds * 1000;
  runs.push({ job_id: due.id, attempt: due.attempts, worker, status: "running", started_at: now, finished_at: null, error: null });
  return due;
}

function currentRun(runs: JobRunRow[], job: JobRow): JobRunRow | undefined {
  return runs.find((run) => run.job_id === job.id && run.attempt === job.attempts && run.status === "running");
}

/**
 * Marks the job done. False when the lease ran out meanwhile and the job was
 * handed to another worker: the guard is "still running AND still mine".
 * A run already marked lost stays lost. app/jobs/queue.py:66-77
 */
export function complete(job: JobRow, runs: JobRunRow[], worker: string, now: number): boolean {
  const run = currentRun(runs, job);
  if (run) {
    run.status = "ok";
    run.finished_at = now;
  }
  if (job.status !== "running" || job.locked_by !== worker) return false;
  job.status = "done";
  job.finished_at = now;
  job.locked_by = null;
  job.locked_until = null;
  job.last_error = null;
  return true;
}

/** Lowest and highest wait before a retry. app/jobs/queue.py:80-84 */
export function backoffBounds(attempt: number): { min: number; max: number } {
  const ceiling = Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** (attempt - 1));
  return { min: ceiling / 2, max: ceiling };
}

/**
 * Seconds to wait before a retry: half fixed, half random ("equal jitter").
 * The original draws the random half; `jitter` (0 to 1) stands in for that
 * draw so a scenario can be replayed. app/jobs/queue.py:80-84
 */
export function backoffSeconds(attempt: number, jitter = 0.5): number {
  const { min, max } = backoffBounds(attempt);
  return min + Math.min(1, Math.max(0, jitter)) * (max - min);
}

/**
 * Records a failure: back to the queue after a backoff, or dead after the
 * last attempt. With retry=false (an error that would only repeat) it is dead
 * at once. Returns the new status, or null if the job was no longer this
 * worker's. app/jobs/queue.py:87-100
 */
export function fail(job: JobRow, runs: JobRunRow[], worker: string, error: string, now: number, retry = true, jitter = 0.5): JobStatus | null {
  const run = currentRun(runs, job);
  if (run) {
    run.status = "error";
    run.finished_at = now;
    run.error = error;
  }
  if (job.status !== "running" || job.locked_by !== worker) return null;
  const dead = job.attempts >= job.max_attempts || !retry;
  job.status = dead ? "dead" : "queued";
  job.finished_at = dead ? now : null;
  job.run_after = now + backoffSeconds(job.attempts, jitter) * 1000;
  job.last_error = error;
  job.locked_by = null;
  job.locked_until = null;
  return job.status;
}

export const LEASE_EXPIRED_ERROR = "lease expired: the worker stopped or the job ran too long";

/**
 * Returns jobs whose lease ran out to the queue (or buries them after the
 * last attempt), and marks queued jobs past their expiry as expired.
 * Runs on every scheduler tick. app/jobs/queue.py:103-119
 */
export function reap(jobs: JobRow[], runs: JobRunRow[], now: number): { lost: JobRow[]; expired: JobRow[] } {
  const lost = jobs.filter((row) => row.status === "running" && row.locked_until !== null && row.locked_until < now);
  for (const job of lost) {
    const run = currentRun(runs, job);
    if (run) {
      run.status = "lost";
      run.finished_at = now;
    }
    const dead = job.attempts >= job.max_attempts;
    job.status = dead ? "dead" : "queued";
    job.finished_at = dead ? now : null;
    job.run_after = now;
    job.last_error = LEASE_EXPIRED_ERROR;
    job.locked_by = null;
    job.locked_until = null;
  }
  const expired = jobs.filter((row) => row.status === "queued" && row.expires_at !== null && row.expires_at <= now);
  for (const job of expired) {
    job.status = "expired";
    job.finished_at = now;
  }
  return { lost, expired };
}

/**
 * Gives a dead job exactly one more attempt. Its expiry is not touched, so a
 * job tied to a time slot that has passed is expired by the next reap instead
 * of running late. app/jobs/queue.py:122-128
 */
export function requeue(jobs: JobRow[], key: string, now: number): JobRow | null {
  const job = jobs.find((row) => row.key === key && row.status === "dead");
  if (!job) return null;
  job.status = "queued";
  job.max_attempts = job.attempts + 1;
  job.run_after = now;
  job.finished_at = null;
  return job;
}

// ---------------------------------------------------------------------------
// Schedule: app/jobs/schedule.py, app/market.py
// ---------------------------------------------------------------------------

export const SLOT_MS = 5 * 60_000;
/** A poll starts just after its slot, so the slot's first trades are in. app/jobs/schedule.py:16 */
export const POLL_START_MS = 5_000;
/** Any later and the price would no longer be this slot's. app/jobs/schedule.py:17 */
export const POLL_EXPIRES_MS = 4 * 60_000;

export function floorSlot(ms: number): number {
  return ms - (ms % SLOT_MS);
}

/** The slot in the text form the platform uses in job keys: 2026-10-06T15:05:00Z. app/market.py:12-14 */
export function slotIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The poll occurrence for one slot. Its key is deterministic, so ticking twice queues it once. app/jobs/schedule.py:51-56 */
export function pollOccurrence(slotMs: number): Required<Pick<NewJob, "kind" | "key" | "queue" | "payload" | "run_after">> & { expires_at: number } {
  const slot = slotIso(slotMs);
  return {
    kind: "poll_quotes",
    key: `poll_quotes:${slot}`,
    queue: "realtime",
    payload: { slot },
    run_after: slotMs + POLL_START_MS,
    expires_at: slotMs + POLL_EXPIRES_MS,
  };
}

// ---------------------------------------------------------------------------
// Circuit breaker: app/circuit.py
// ---------------------------------------------------------------------------

export type BreakerState = "closed" | "open" | "half-open";

/**
 * After a provider fails a few times in a row, stop calling it for a while;
 * after the pause, let one trial call through. app/circuit.py:15-56
 */
export class CircuitBreaker {
  failures = 0;
  /** Set while open or half-open. */
  openedAt: number | null = null;
  /** When the half-open trial call started. */
  trialAt: number | null = null;

  constructor(
    readonly threshold = 3,
    readonly pauseSeconds = 300,
    /** Seconds on a monotonic clock. */
    private readonly clock: () => number = () => 0,
  ) {}

  get state(): BreakerState {
    if (this.openedAt === null) return "closed";
    return this.clock() - this.openedAt >= this.pauseSeconds ? "half-open" : "open";
  }

  /** True if a call may go ahead now. In half-open, only one caller gets the trial. */
  allow(): boolean {
    if (this.openedAt === null) return true;
    const now = this.clock();
    if (now - this.openedAt < this.pauseSeconds) return false;
    // A trial is under way (or vanished; a new one is allowed after another pause).
    if (this.trialAt !== null && now - this.trialAt < this.pauseSeconds) return false;
    this.trialAt = now;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.trialAt = null;
  }

  failure(): void {
    this.failures += 1;
    if (this.trialAt !== null || this.failures >= this.threshold) {
      this.openedAt = this.clock();
      this.trialAt = null;
    }
  }

  /** Seconds until the next trial call; 0 when calls go through. */
  secondsLeft(): number {
    return this.openedAt === null ? 0 : Math.max(0, this.pauseSeconds - (this.clock() - this.openedAt));
  }
}

// ---------------------------------------------------------------------------
// Providers and the poll: app/providers.py, app/jobs/prices.py
// ---------------------------------------------------------------------------

/** Seconds each provider gets in one poll. app/jobs/prices.py:14 */
export const PROVIDER_BUDGET_SECONDS = 15;
/** Seconds to connect before a call gives up. app/providers.py:31 */
export const CONNECT_TIMEOUT_SECONDS = 5;
/** Statuses worth another try later; any other non-200 would fail the same way again. app/providers.py:34 */
export const RETRYABLE_STATUS: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.includes(status);
}

export interface PollResult {
  /** symbol -> price */
  rows: Record<string, number>;
  fromAlpaca: number;
  fromTiingo: number;
  missing: string[];
  errors: string[];
  askedTiingoFor: string[];
  alpacaSkipped: boolean;
}

export interface ProviderAnswer {
  /** Prices returned, by symbol. */
  prices: Record<string, number>;
  /** Set when the call raised instead of answering. */
  error?: string;
}

/**
 * One poll: the primary provider first, the fallback only for what the
 * primary missed. It fails (and is retried) only if no price came back at
 * all. app/jobs/prices.py:23-69
 */
export function pollQuotes(
  symbols: string[],
  breaker: CircuitBreaker,
  alpaca: () => ProviderAnswer,
  tiingo: ((missing: string[]) => ProviderAnswer) | null,
): PollResult {
  const rows: Record<string, number> = {};
  const errors: string[] = [];
  let alpacaSkipped = false;
  if (!breaker.allow()) {
    alpacaSkipped = true;
    errors.push(`alpaca: skipped after repeated failures, next try in ${breaker.secondsLeft().toFixed(0)}s`);
  } else {
    const answer = alpaca();
    if (answer.error !== undefined) {
      breaker.failure();
      errors.push(`alpaca: ${answer.error}`);
    } else {
      breaker.success();
      for (const symbol of symbols) {
        const price = answer.prices[symbol];
        // A snapshot without a trade price is dropped. app/providers.py:71-85
        if (typeof price === "number" && price > 0) rows[symbol] = price;
      }
    }
  }
  const fromAlpaca = Object.keys(rows).length;
  const askedTiingoFor = symbols.filter((symbol) => !(symbol in rows));
  if (askedTiingoFor.length > 0 && tiingo) {
    const answer = tiingo(askedTiingoFor);
    if (answer.error !== undefined) {
      errors.push(`tiingo: ${answer.error}`);
    } else {
      const wanted = new Set(askedTiingoFor);
      for (const [symbol, price] of Object.entries(answer.prices)) {
        // Only symbols that were asked for are accepted.
        if (wanted.has(symbol) && price > 0) rows[symbol] = price;
      }
    }
  }
  return {
    rows,
    fromAlpaca,
    fromTiingo: Object.keys(rows).length - fromAlpaca,
    missing: symbols.filter((symbol) => !(symbol in rows)),
    errors,
    askedTiingoFor: tiingo ? askedTiingoFor : [],
    alpacaSkipped,
  };
}

/** The error a poll raises when it priced nothing. app/jobs/prices.py:68-69 */
export function noPricesError(errors: string[]): string {
  return `RuntimeError: no prices: ${errors.join("; ") || "no provider keys configured"}`;
}

// ---------------------------------------------------------------------------
// Scanner rules: app/scanner.py
// ---------------------------------------------------------------------------

export interface ScannerRules {
  move: { enabled: boolean; pct: number };
  gap: { enabled: boolean; pct: number };
  volume: { enabled: boolean; ratio: number; min_minutes: number };
  range_52w: { enabled: boolean };
  rsi: { enabled: boolean; period: number; high: number; low: number };
  sma: { enabled: boolean; period: number };
}

/** app/scanner.py:17-24 */
export const DEFAULT_RULES: ScannerRules = {
  move: { enabled: true, pct: 3.0 },
  gap: { enabled: true, pct: 3.0 },
  volume: { enabled: true, ratio: 2.0, min_minutes: 30 },
  range_52w: { enabled: true },
  rsi: { enabled: true, period: 14, high: 70, low: 30 },
  sma: { enabled: true, period: 50 },
};

export interface StockMetrics {
  symbol: string;
  price: number;
  prev_close: number | null;
  change_pct: number | null;
  gap_pct: number | null;
  rvol: number | null;
  volume_minutes: number;
  high_52w: number | null;
  low_52w: number | null;
  rsi: number | null;
  rsi_prev: number | null;
  sma: number | null;
}

export type Signal = [rule: string, value: number];

/** The rules that fire for one stock. app/scanner.py:160-189 */
export function signals(stock: StockMetrics, rules: ScannerRules = DEFAULT_RULES): Signal[] {
  const out: Signal[] = [];
  const { price, change_pct: change, gap_pct: gap } = stock;
  if (rules.move.enabled && change !== null && Math.abs(change) >= rules.move.pct) out.push([change > 0 ? "move_up" : "move_down", change]);
  if (rules.gap.enabled && gap !== null && Math.abs(gap) >= rules.gap.pct) out.push([gap > 0 ? "gap_up" : "gap_down", gap]);
  if (rules.volume.enabled && stock.rvol && stock.rvol >= rules.volume.ratio && stock.volume_minutes >= rules.volume.min_minutes) {
    out.push(["volume", stock.rvol]);
  }
  if (rules.range_52w.enabled && stock.high_52w && price > stock.high_52w) out.push(["high_52w", stock.high_52w]);
  if (rules.range_52w.enabled && stock.low_52w && price < stock.low_52w) out.push(["low_52w", stock.low_52w]);
  const { rsi, rsi_prev: previous } = stock;
  if (rules.rsi.enabled && rsi !== null && previous !== null) {
    // Fires on entering the zone, not while staying in it.
    if (rsi >= rules.rsi.high && rules.rsi.high > previous) out.push(["rsi_high", rsi]);
    else if (rsi <= rules.rsi.low && rules.rsi.low < previous) out.push(["rsi_low", rsi]);
  }
  const { sma, prev_close: prev } = stock;
  if (rules.sma.enabled && sma && prev) {
    if (prev <= sma && sma < price) out.push(["sma_up", sma]);
    else if (prev >= sma && sma > price) out.push(["sma_down", sma]);
  }
  return out;
}

export interface AlertRow {
  session: string;
  symbol: string;
  rule: string;
  triggered_at: string;
  price: number;
  value: number;
  sent_at: string | null;
}

/**
 * INSERT ... ON CONFLICT DO NOTHING on the key (session, symbol, rule): a rule
 * fires once per stock per session. Returns true when the alert is new.
 * app/jobs/scan.py:139-144, app/db/models.py:125-138
 */
export function insertAlert(alerts: AlertRow[], alert: AlertRow): boolean {
  if (alerts.some((row) => row.session === alert.session && row.symbol === alert.symbol && row.rule === alert.rule)) return false;
  alerts.push(alert);
  return true;
}

// ---------------------------------------------------------------------------
// Heartbeat: app/monitor.py
// ---------------------------------------------------------------------------

/** The worker checks itself and reports this often. app/worker.py:35 */
export const HEARTBEAT_EVERY_SECONDS = 60;
/** A dead job is reported this long, unless it is requeued and done. app/monitor.py:31 */
export const DEAD_WINDOW_HOURS = 24;

/** One line per dead job still inside the reporting window. app/monitor.py:75-77 */
export function deadJobProblems(jobs: JobRow[], now: number): string[] {
  const since = now - DEAD_WINDOW_HOURS * 3_600_000;
  return jobs
    .filter((job) => job.status === "dead" && job.finished_at !== null && job.finished_at > since)
    .sort((a, b) => (a.finished_at ?? 0) - (b.finished_at ?? 0))
    .map((job) => `dead job ${job.key}: ${(job.last_error ?? "").slice(0, 160)}`);
}
