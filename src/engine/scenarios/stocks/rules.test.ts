import { describe, expect, test } from "vitest";
import {
  CircuitBreaker,
  DEFAULT_RULES,
  LEASE_EXPIRED_ERROR,
  POLL_EXPIRES_MS,
  POLL_START_MS,
  QUEUES,
  backoffBounds,
  backoffSeconds,
  claim,
  complete,
  deadJobProblems,
  enqueue,
  fail,
  floorSlot,
  insertAlert,
  isRetryableStatus,
  noPricesError,
  pollOccurrence,
  pollQuotes,
  reap,
  requeue,
  signals,
  slotIso,
  type AlertRow,
  type JobRow,
  type JobRunRow,
  type StockMetrics,
} from "./rules";

const SLOT = Date.UTC(2026, 2, 16, 14, 35, 0);

function queueWith(...keys: string[]) {
  const jobs: JobRow[] = [];
  const runs: JobRunRow[] = [];
  for (const key of keys) enqueue(jobs, { kind: "poll_quotes", key }, 0);
  return { jobs, runs };
}

describe("enqueueing", () => {
  test("a key is queued once, however often it is offered", () => {
    const jobs: JobRow[] = [];
    expect(enqueue(jobs, { kind: "poll_quotes", key: "poll_quotes:a" }, 0)).not.toBeNull();
    expect(enqueue(jobs, { kind: "poll_quotes", key: "poll_quotes:a" }, 5)).toBeNull();
    expect(jobs).toHaveLength(1);
  });

  test("a new job starts queued with three attempts allowed", () => {
    const jobs: JobRow[] = [];
    const job = enqueue(jobs, { kind: "scan", key: "scan:a" }, 100)!;
    expect(job).toMatchObject({ status: "queued", attempts: 0, max_attempts: 3, run_after: 100, queue: "realtime" });
  });

  test("the poll of a slot starts five seconds in and expires after four minutes", () => {
    const occurrence = pollOccurrence(SLOT);
    expect(occurrence.key).toBe("poll_quotes:2026-03-16T14:35:00Z");
    expect(occurrence.run_after - SLOT).toBe(POLL_START_MS);
    expect(occurrence.expires_at - SLOT).toBe(POLL_EXPIRES_MS);
    expect(occurrence.payload).toEqual({ slot: "2026-03-16T14:35:00Z" });
  });

  test("a time is floored to its five-minute slot", () => {
    expect(slotIso(floorSlot(SLOT + 4 * 60_000 + 59_000))).toBe("2026-03-16T14:35:00Z");
    expect(slotIso(floorSlot(SLOT + 5 * 60_000))).toBe("2026-03-16T14:40:00Z");
  });
});

describe("claiming", () => {
  test("takes the oldest due job and gives it a lease", () => {
    const { jobs, runs } = queueWith("a", "b");
    jobs[0].run_after = 2_000;
    jobs[1].run_after = 1_000;
    const job = claim(jobs, runs, "realtime", "w1", QUEUES.realtime.lease, 5_000)!;
    expect(job.key).toBe("b");
    expect(job).toMatchObject({ status: "running", attempts: 1, locked_by: "w1", locked_until: 5_000 + 180_000 });
    expect(runs).toEqual([expect.objectContaining({ job_id: job.id, attempt: 1, worker: "w1", status: "running" })]);
  });

  test("a job is not claimed before it is due, after it has expired, or from another queue", () => {
    const jobs: JobRow[] = [];
    const runs: JobRunRow[] = [];
    enqueue(jobs, { kind: "poll_quotes", key: "later", run_after: 9_000 }, 0);
    enqueue(jobs, { kind: "poll_quotes", key: "stale", expires_at: 1_000 }, 0);
    enqueue(jobs, { kind: "sync_daily", key: "batch", queue: "batch" }, 0);
    expect(claim(jobs, runs, "realtime", "w1", 180, 5_000)).toBeNull();
    expect(claim(jobs, runs, "batch", "w1", 1800, 5_000)?.key).toBe("batch");
  });

  test("two workers never get the same job", () => {
    const { jobs, runs } = queueWith("only");
    expect(claim(jobs, runs, "realtime", "w1", 180, 0)).not.toBeNull();
    expect(claim(jobs, runs, "realtime", "w2", 180, 0)).toBeNull();
  });
});

describe("finishing", () => {
  test("completing marks the job done and the run ok", () => {
    const { jobs, runs } = queueWith("a");
    const job = claim(jobs, runs, "realtime", "w1", 180, 0)!;
    expect(complete(job, runs, "w1", 900)).toBe(true);
    expect(job).toMatchObject({ status: "done", finished_at: 900, locked_by: null, locked_until: null });
    expect(runs[0]).toMatchObject({ status: "ok", finished_at: 900 });
  });

  test("a failure goes back to the queue with a backoff, and the third one buries the job", () => {
    const { jobs, runs } = queueWith("a");
    let now = 0;
    const outcomes: (string | null)[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const job = claim(jobs, runs, "realtime", "w1", 180, now)!;
      outcomes.push(fail(job, runs, "w1", "RuntimeError: no prices", now));
      now = job.run_after;
    }
    expect(outcomes).toEqual(["queued", "queued", "dead"]);
    expect(jobs[0]).toMatchObject({ status: "dead", attempts: 3, last_error: "RuntimeError: no prices" });
    expect(runs.map((run) => run.status)).toEqual(["error", "error", "error"]);
  });

  test("an error that would only repeat buries the job at once", () => {
    const { jobs, runs } = queueWith("a");
    const job = claim(jobs, runs, "realtime", "w1", 180, 0)!;
    expect(fail(job, runs, "w1", "ProviderError: HTTP 403", 10, false)).toBe("dead");
    expect(job.attempts).toBe(1);
  });

  test("the wait doubles each attempt, half of it fixed and half random, up to an hour", () => {
    expect(backoffBounds(1)).toEqual({ min: 15, max: 30 });
    expect(backoffBounds(2)).toEqual({ min: 30, max: 60 });
    expect(backoffBounds(3)).toEqual({ min: 60, max: 120 });
    expect(backoffBounds(20)).toEqual({ min: 1800, max: 3600 });
    expect(backoffSeconds(1, 0)).toBe(15);
    expect(backoffSeconds(1, 1)).toBe(30);
    expect(backoffSeconds(2)).toBe(45);
    expect(backoffSeconds(1, 7)).toBe(30);
  });
});

describe("leases", () => {
  test("a job whose worker vanished is put back when the lease runs out, and its run is marked lost", () => {
    const { jobs, runs } = queueWith("a");
    claim(jobs, runs, "realtime", "w1", 180, 5_000);
    expect(reap(jobs, runs, 100_000).lost).toHaveLength(0);
    const { lost } = reap(jobs, runs, 185_001);
    expect(lost).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "queued", run_after: 185_001, last_error: LEASE_EXPIRED_ERROR, locked_by: null });
    expect(runs[0].status).toBe("lost");
  });

  test("a late completion from the first worker is ignored", () => {
    const { jobs, runs } = queueWith("a");
    const first = claim(jobs, runs, "realtime", "w1", 180, 0)!;
    reap(jobs, runs, 181_000);
    const second = claim(jobs, runs, "realtime", "w2", 180, 181_000)!;
    expect(second.attempts).toBe(2);
    expect(complete(first, runs, "w1", 182_000)).toBe(false);
    expect(jobs[0].status).toBe("running");
    // The lost run stays lost: the log should show the job ran twice.
    expect(runs[0].status).toBe("lost");
  });

  test("a lease that expires on the last attempt buries the job", () => {
    const { jobs, runs } = queueWith("a");
    jobs[0].max_attempts = 1;
    claim(jobs, runs, "realtime", "w1", 180, 0);
    reap(jobs, runs, 181_000);
    expect(jobs[0].status).toBe("dead");
  });

  test("a queued job past its expiry is never run late", () => {
    const jobs: JobRow[] = [];
    enqueue(jobs, { kind: "poll_quotes", key: "slot", expires_at: 240_000 }, 0);
    expect(reap(jobs, [], 239_999).expired).toHaveLength(0);
    expect(reap(jobs, [], 240_000).expired).toHaveLength(1);
    expect(jobs[0].status).toBe("expired");
  });
});

describe("requeueing a dead job", () => {
  function deadJob(expiresAt: number | null) {
    const jobs: JobRow[] = [];
    const runs: JobRunRow[] = [];
    enqueue(jobs, { kind: "poll_quotes", key: "slot", expires_at: expiresAt, max_attempts: 1 }, 0);
    const job = claim(jobs, runs, "realtime", "w1", 180, 0)!;
    fail(job, runs, "w1", "boom", 1_000);
    return { jobs, runs };
  }

  test("grants exactly one more attempt and keeps the earlier runs", () => {
    const { jobs, runs } = deadJob(null);
    const job = requeue(jobs, "slot", 2_000)!;
    expect(job).toMatchObject({ status: "queued", max_attempts: 2, run_after: 2_000, finished_at: null });
    expect(runs).toHaveLength(1);
    expect(claim(jobs, runs, "realtime", "w1", 180, 2_000)?.attempts).toBe(2);
  });

  test("only a dead job can be requeued", () => {
    const { jobs } = queueWith("a");
    expect(requeue(jobs, "a", 0)).toBeNull();
    expect(requeue(jobs, "missing", 0)).toBeNull();
  });

  test("a requeued job tied to a slot that has passed is expired instead of run", () => {
    const { jobs, runs } = deadJob(240_000);
    requeue(jobs, "slot", 600_000);
    expect(claim(jobs, runs, "realtime", "w1", 180, 600_000)).toBeNull();
    expect(reap(jobs, runs, 600_000).expired).toHaveLength(1);
    expect(jobs[0].status).toBe("expired");
  });
});

describe("circuit breaker", () => {
  function breakerAt() {
    const clock = { now: 0 };
    return { clock, breaker: new CircuitBreaker(3, 300, () => clock.now) };
  }

  test("stays closed until the third failure in a row", () => {
    const { breaker } = breakerAt();
    breaker.failure();
    breaker.failure();
    expect(breaker.state).toBe("closed");
    expect(breaker.allow()).toBe(true);
    breaker.failure();
    expect(breaker.state).toBe("open");
    expect(breaker.allow()).toBe(false);
    expect(breaker.secondsLeft()).toBe(300);
  });

  test("a success resets the count", () => {
    const { breaker } = breakerAt();
    breaker.failure();
    breaker.failure();
    breaker.success();
    breaker.failure();
    breaker.failure();
    expect(breaker.state).toBe("closed");
  });

  test("after the pause one caller gets the trial and the others are refused", () => {
    const { breaker, clock } = breakerAt();
    for (let index = 0; index < 3; index += 1) breaker.failure();
    clock.now = 299;
    expect(breaker.allow()).toBe(false);
    clock.now = 300;
    expect(breaker.state).toBe("half-open");
    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(false);
  });

  test("a trial that succeeds closes the circuit", () => {
    const { breaker, clock } = breakerAt();
    for (let index = 0; index < 3; index += 1) breaker.failure();
    clock.now = 300;
    breaker.allow();
    breaker.success();
    expect(breaker.state).toBe("closed");
    expect(breaker.failures).toBe(0);
  });

  test("a trial that fails opens it for another pause", () => {
    const { breaker, clock } = breakerAt();
    for (let index = 0; index < 3; index += 1) breaker.failure();
    clock.now = 305;
    breaker.allow();
    breaker.failure();
    expect(breaker.state).toBe("open");
    expect(breaker.secondsLeft()).toBe(300);
    clock.now = 604;
    expect(breaker.allow()).toBe(false);
    clock.now = 605;
    expect(breaker.allow()).toBe(true);
  });

  test("a trial that never reports is replaced after another pause", () => {
    const { breaker, clock } = breakerAt();
    for (let index = 0; index < 3; index += 1) breaker.failure();
    clock.now = 300;
    expect(breaker.allow()).toBe(true);
    clock.now = 599;
    expect(breaker.allow()).toBe(false);
    clock.now = 600;
    expect(breaker.allow()).toBe(true);
  });
});

describe("one poll", () => {
  const symbols = ["AAA", "BBB", "CCC"];
  const all = { AAA: 10, BBB: 20, CCC: 30 };

  test("a healthy primary prices everything and the fallback is not asked", () => {
    let asked = false;
    const result = pollQuotes(symbols, new CircuitBreaker(), () => ({ prices: all }), () => ((asked = true), { prices: {} }));
    expect(result).toMatchObject({ fromAlpaca: 3, fromTiingo: 0, missing: [], errors: [], askedTiingoFor: [] });
    expect(asked).toBe(false);
  });

  test("the fallback is asked only for what the primary missed", () => {
    const result = pollQuotes(symbols, new CircuitBreaker(), () => ({ prices: { AAA: 10 } }), (missing) => ({ prices: Object.fromEntries(missing.map((s) => [s, 5])) }));
    expect(result.askedTiingoFor).toEqual(["BBB", "CCC"]);
    expect(result).toMatchObject({ fromAlpaca: 1, fromTiingo: 2, missing: [] });
  });

  test("a snapshot without a price is treated as missing", () => {
    const result = pollQuotes(symbols, new CircuitBreaker(), () => ({ prices: { ...all, BBB: 0 } }), (missing) => ({ prices: { [missing[0]]: 21 } }));
    expect(result.askedTiingoFor).toEqual(["BBB"]);
    expect(result.rows.BBB).toBe(21);
  });

  test("the fallback cannot add a symbol nobody asked for", () => {
    const result = pollQuotes(symbols, new CircuitBreaker(), () => ({ prices: { AAA: 10, BBB: 20 } }), () => ({ prices: { CCC: 30, ZZZ: 99 } }));
    expect(Object.keys(result.rows).sort()).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("a failing primary is recorded, counted by the breaker and covered by the fallback", () => {
    const breaker = new CircuitBreaker();
    const result = pollQuotes(symbols, breaker, () => ({ prices: {}, error: "ConnectTimeout" }), () => ({ prices: all }));
    expect(result.errors).toEqual(["alpaca: ConnectTimeout"]);
    expect(result).toMatchObject({ fromAlpaca: 0, fromTiingo: 3 });
    expect(breaker.failures).toBe(1);
  });

  test("an open breaker skips the primary without calling it", () => {
    const breaker = new CircuitBreaker(3, 300, () => 10);
    for (let index = 0; index < 3; index += 1) breaker.failure();
    let called = false;
    const result = pollQuotes(symbols, breaker, () => ((called = true), { prices: all }), () => ({ prices: all }));
    expect(called).toBe(false);
    expect(result.alpacaSkipped).toBe(true);
    expect(result.errors).toEqual(["alpaca: skipped after repeated failures, next try in 300s"]);
    expect(result.fromTiingo).toBe(3);
  });

  test("with both providers down nothing is priced and the error names both", () => {
    const result = pollQuotes(symbols, new CircuitBreaker(), () => ({ prices: {}, error: "ConnectTimeout" }), () => ({ prices: {}, error: "HTTP 503" }));
    expect(result.rows).toEqual({});
    expect(noPricesError(result.errors)).toBe("RuntimeError: no prices: alpaca: ConnectTimeout; tiingo: HTTP 503");
  });

  test("timeouts and overload are worth retrying; a refusal is not", () => {
    for (const status of [408, 429, 500, 503]) expect(isRetryableStatus(status)).toBe(true);
    for (const status of [400, 401, 403, 404]) expect(isRetryableStatus(status)).toBe(false);
  });
});

describe("scanner rules", () => {
  const quiet: StockMetrics = {
    symbol: "AAA",
    price: 100,
    prev_close: 99.5,
    change_pct: 0.5,
    gap_pct: 0.2,
    rvol: 1.1,
    volume_minutes: 45,
    high_52w: 140,
    low_52w: 70,
    rsi: 55,
    rsi_prev: 54,
    sma: 90,
  };

  test("a quiet stock fires nothing", () => {
    expect(signals(quiet)).toEqual([]);
  });

  test("a move of three percent fires in its direction", () => {
    expect(signals({ ...quiet, change_pct: 3.0 })).toEqual([["move_up", 3.0]]);
    expect(signals({ ...quiet, change_pct: -3.4 })).toEqual([["move_down", -3.4]]);
    expect(signals({ ...quiet, change_pct: 2.99 })).toEqual([]);
  });

  test("unusual volume waits for thirty minutes of session", () => {
    expect(signals({ ...quiet, rvol: 2.4, volume_minutes: 29 })).toEqual([]);
    expect(signals({ ...quiet, rvol: 2.4, volume_minutes: 30 })).toEqual([["volume", 2.4]]);
  });

  test("RSI fires on entering a zone, not while staying in it", () => {
    expect(signals({ ...quiet, rsi: 71, rsi_prev: 69 })).toEqual([["rsi_high", 71]]);
    expect(signals({ ...quiet, rsi: 72, rsi_prev: 71 })).toEqual([]);
    expect(signals({ ...quiet, rsi: 29, rsi_prev: 31 })).toEqual([["rsi_low", 29]]);
  });

  test("a cross of the moving average fires once, on the cross", () => {
    expect(signals({ ...quiet, prev_close: 89, sma: 90, price: 91 })).toEqual([["sma_up", 90]]);
    expect(signals({ ...quiet, prev_close: 91, sma: 90, price: 89 })).toEqual([["sma_down", 90]]);
  });

  test("a new 52-week extreme fires", () => {
    expect(signals({ ...quiet, price: 141 })).toEqual([["high_52w", 140]]);
    expect(signals({ ...quiet, price: 69, prev_close: 69.2, sma: null })).toEqual([["low_52w", 70]]);
  });

  test("a rule that is switched off stays silent", () => {
    const rules = { ...DEFAULT_RULES, move: { ...DEFAULT_RULES.move, enabled: false } };
    expect(signals({ ...quiet, change_pct: 9 }, rules)).toEqual([]);
  });

  test("missing figures fire nothing instead of raising", () => {
    expect(signals({ ...quiet, change_pct: null, gap_pct: null, rvol: null, rsi: null, sma: null, high_52w: null, low_52w: null })).toEqual([]);
  });
});

describe("alerts", () => {
  const alert: AlertRow = { session: "2026-03-16", symbol: "AAA", rule: "move_up", triggered_at: "t", price: 103.4, value: 3.4, sent_at: null };

  test("a rule fires once per stock per session", () => {
    const alerts: AlertRow[] = [];
    expect(insertAlert(alerts, alert)).toBe(true);
    expect(insertAlert(alerts, { ...alert, price: 104, value: 4 })).toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].value).toBe(3.4);
  });

  test("another rule, another stock or another session is a new alert", () => {
    const alerts: AlertRow[] = [alert];
    expect(insertAlert(alerts, { ...alert, rule: "volume" })).toBe(true);
    expect(insertAlert(alerts, { ...alert, symbol: "BBB" })).toBe(true);
    expect(insertAlert(alerts, { ...alert, session: "2026-03-17" })).toBe(true);
  });
});

describe("heartbeat", () => {
  test("names each dead job and its error for a day, then stops", () => {
    const { jobs, runs } = queueWith("poll_quotes:x");
    jobs[0].max_attempts = 1;
    fail(claim(jobs, runs, "realtime", "w1", 180, 0)!, runs, "w1", "RuntimeError: no prices", 1_000);
    expect(deadJobProblems(jobs, 60_000)).toEqual(["dead job poll_quotes:x: RuntimeError: no prices"]);
    expect(deadJobProblems(jobs, 1_000 + 24 * 3_600_000)).toEqual([]);
  });
});
