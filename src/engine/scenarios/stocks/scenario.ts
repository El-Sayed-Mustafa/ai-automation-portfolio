import type { Scenario, ScenarioContext } from "../../session";
import type { Json } from "../../types";
import {
  CONNECT_TIMEOUT_SECONDS,
  CircuitBreaker,
  DEAD_WINDOW_HOURS,
  DEFAULT_RULES,
  HEARTBEAT_EVERY_SECONDS,
  QUEUES,
  TICK_EVERY_SECONDS,
  backoffBounds,
  backoffSeconds,
  claim,
  complete,
  deadJobProblems,
  enqueue,
  fail,
  floorSlot,
  insertAlert,
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
  type PollResult,
  type StockMetrics,
} from "./rules";

export const STOCKS_SCENARIO_ID = "stocks.slot-to-alert";

export const STOCKS_STEPS = [
  "tick.enqueue",
  "job.claim",
  "breaker.gate",
  "alpaca.snapshots",
  "tiingo.fallback",
  "quotes.save",
  "job.outcome",
  "heartbeat.report",
  "operator.requeue",
  "scan.compute",
  "alerts.insert",
  "notify.decide",
  "snapshot.publish",
  "telegram.send",
] as const;

export const STOCKS_FAULTS = [
  "duplicate-tick",
  "worker-killed",
  "alpaca-down",
  "alpaca-partial",
  "both-down",
  "repeat-alert",
  "stale-close",
  "telegram-on",
  "telegram-down",
] as const;

export type StocksFaultId = (typeof STOCKS_FAULTS)[number];

/** Where the primary provider's circuit breaker stands when the slot begins. */
export const BREAKER_STARTS = ["closed", "closed, two failures counted", "open", "half-open"] as const;
export type BreakerStart = (typeof BREAKER_STARTS)[number];

export interface StocksInput {
  breaker: BreakerStart;
  /** The watched stock's change since the previous close, in percent. */
  changePct: number;
  /** The watched stock's volume so far today, as a multiple of its usual volume by this time. */
  relativeVolume: number;
  minutesIntoSession: number;
}

export const STOCKS_PRESETS: { id: string; label: string; description: string; input: StocksInput }[] = [
  {
    id: "move",
    label: "A stock moves 3.4%",
    description: "A normal slot in which one stock crosses the 3% move rule.",
    input: { breaker: "closed", changePct: 3.4, relativeVolume: 1.2, minutesIntoSession: 45 },
  },
  {
    id: "quiet",
    label: "A quiet slot",
    description: "Prices are saved and no rule fires.",
    input: { breaker: "closed", changePct: 0.6, relativeVolume: 1.0, minutesIntoSession: 45 },
  },
  {
    id: "volume",
    label: "Unusual volume",
    description: "A small move on more than twice the usual volume.",
    input: { breaker: "closed", changePct: 1.1, relativeVolume: 2.4, minutesIntoSession: 45 },
  },
  {
    id: "two-failures",
    label: "Two failures counted",
    description: "The primary provider has failed twice in a row. One more failure opens the circuit.",
    input: { breaker: "closed, two failures counted", changePct: 3.4, relativeVolume: 1.2, minutesIntoSession: 45 },
  },
  {
    id: "open",
    label: "Circuit open",
    description: "The primary provider is being skipped and the poll goes straight to the fallback.",
    input: { breaker: "open", changePct: 3.4, relativeVolume: 1.2, minutesIntoSession: 45 },
  },
  {
    id: "half-open",
    label: "Trial call",
    description: "The pause is over, so this poll carries the one trial call that decides whether the circuit closes.",
    input: { breaker: "half-open", changePct: 3.4, relativeVolume: 1.2, minutesIntoSession: 45 },
  },
];

export const STOCKS_DEFAULT_INPUT: StocksInput = STOCKS_PRESETS[0].input;

export function validateStocksInput(raw: Partial<Record<keyof StocksInput, unknown>>): {
  ok: boolean;
  value: StocksInput;
  errors: Partial<Record<keyof StocksInput, string>>;
} {
  const errors: Partial<Record<keyof StocksInput, string>> = {};
  const number = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN);

  const breaker = BREAKER_STARTS.includes(raw.breaker as BreakerStart) ? (raw.breaker as BreakerStart) : null;
  if (!breaker) errors.breaker = "Choose one of the listed states.";

  const changePct = number(raw.changePct);
  if (!Number.isFinite(changePct) || changePct < 0 || changePct > 20) errors.changePct = "Use a number from 0 to 20.";

  const relativeVolume = number(raw.relativeVolume);
  if (!Number.isFinite(relativeVolume) || relativeVolume < 0 || relativeVolume > 20) errors.relativeVolume = "Use a number from 0 to 20.";

  const minutes = number(raw.minutesIntoSession);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 385) errors.minutesIntoSession = "Use a whole number of minutes from 5 to 385.";

  return {
    ok: Object.keys(errors).length === 0,
    value: {
      breaker: breaker ?? STOCKS_DEFAULT_INPUT.breaker,
      changePct: Number.isFinite(changePct) ? Math.round(changePct * 100) / 100 : STOCKS_DEFAULT_INPUT.changePct,
      relativeVolume: Number.isFinite(relativeVolume) ? Math.round(relativeVolume * 100) / 100 : STOCKS_DEFAULT_INPUT.relativeVolume,
      minutesIntoSession: Number.isInteger(minutes) ? minutes : STOCKS_DEFAULT_INPUT.minutesIntoSession,
    },
    errors,
  };
}

// -- Invented world ----------------------------------------------------------

/** A regular session: 09:30 to 16:00 New York time, in UTC on the demo day. */
export const DEMO_SESSION = "2026-03-16";
const SESSION_OPEN = Date.UTC(2026, 2, 16, 13, 30, 0);
/** The real platform watches 170 stocks. Six invented tickers keep the trace readable. */
export const DEMO_SYMBOLS = ["DEMO1", "DEMO2", "DEMO3", "DEMO4", "DEMO5", "DEMO6"] as const;
export const WATCHED = "DEMO1";
const PREVIOUS_CLOSE: Record<string, number> = { DEMO1: 100, DEMO2: 48.2, DEMO3: 212.5, DEMO4: 75.1, DEMO5: 19.84, DEMO6: 330 };
const QUIET_CHANGE: Record<string, number> = { DEMO2: 0.4, DEMO3: -0.7, DEMO4: 0.2, DEMO5: -0.3, DEMO6: 0.9 };
/** With the stale-close fault this stock's stored close is days old, which makes an ordinary price look like a move. */
const STALE_SYMBOL = "DEMO3";
const STALE_CLOSE = 203.4;
const WORKERS = { first: "worker-1:realtime-0", second: "worker-1:realtime-1" } as const;

/** Simulated durations in milliseconds. They set the pace of the replay and are not measurements. */
const LATENCY = {
  tick: 1_000,
  claim: 300,
  alpacaOk: 900,
  tiingoAll: 1_400,
  tiingoFew: 450,
  tiingoFail: 400,
  save: 160,
  finish: 20,
  scan: 600,
  alert: 40,
  snapshot: 60,
  telegram: 700,
  /** How long a person takes to read the e-mail and act. */
  operator: 6 * 60_000,
} as const;

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

function snap<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function* run({ input, faults, t }: ScenarioContext<StocksInput>): Generator<void, void, string> {
  const slotMs = floorSlot(SESSION_OPEN + input.minutesIntoSession * 60_000);
  const slot = slotIso(slotMs);
  const at = () => slotMs + t.time;
  const stamp = (ms: number) => slotIso(ms);
  const seconds = () => at() / 1000;

  const jobs: JobRow[] = [];
  const runs: JobRunRow[] = [];
  const alerts: AlertRow[] = [];
  const view = (job: JobRow) =>
    snap({
      ...job,
      run_after: stamp(job.run_after),
      expires_at: job.expires_at === null ? null : stamp(job.expires_at),
      locked_until: job.locked_until === null ? null : stamp(job.locked_until),
      finished_at: job.finished_at === null ? null : stamp(job.finished_at),
    });

  // -- 1. Scheduler tick ---------------------------------------------------
  t.advance(LATENCY.tick);
  const occurrence = pollOccurrence(slotMs);
  t.start("tick.enqueue", {
    now: stamp(at()),
    session: { day: DEMO_SESSION, open: stamp(SESSION_OPEN), close: stamp(SESSION_OPEN + 390 * 60_000) },
    slot,
  });
  const pollJob = enqueue(jobs, occurrence, at());
  if (!pollJob) throw new Error("The poll job could not be queued.");
  t.change("jobs", "insert", pollJob.key, null, view(pollJob));
  t.log("info", `Queued ${pollJob.key}: runs 5 s into the slot and expires after 4 minutes.`);
  let duplicates = 0;
  if (faults.has("duplicate-tick")) {
    t.advance(TICK_EVERY_SECONDS * 1000);
    if (enqueue(jobs, occurrence, at()) === null) duplicates += 1;
    t.log("info", "A second tick offered the same key. ON CONFLICT (key) DO NOTHING: nothing was queued twice.");
  }
  t.log("info", "The same tick queues the slot's bar sync and returns any job whose lease has run out. This run follows the poll.");
  t.ok({ queued: pollJob.key, run_after: stamp(pollJob.run_after), expires_at: stamp(occurrence.expires_at), duplicates_ignored: duplicates });

  // -- 2. Claim --------------------------------------------------------------
  t.advance(Math.max(0, pollJob.run_after - at()) + LATENCY.claim);
  let worker: string = WORKERS.first;
  t.start("job.claim", { queue: "realtime", worker, lease_seconds: QUEUES.realtime.lease });
  {
    const before = view(pollJob);
    const claimed = claim(jobs, runs, "realtime", worker, QUEUES.realtime.lease, at());
    if (!claimed) throw new Error("The poll job was not due.");
    t.change("jobs", "update", pollJob.key, before, view(pollJob));
    t.change("job_runs", "insert", `${pollJob.key}#${pollJob.attempts}`, null, snap({ ...runs.at(-1), started_at: stamp(at()) }));
  }
  if (faults.has("worker-killed")) {
    t.advance(500);
    t.log("error", "The worker process was killed 0.5 s into the job. Nothing records that it stopped: the row still says running.");
    const wait = pollJob.locked_until! - at() + TICK_EVERY_SECONDS * 1000;
    t.fail("WORKER_LOST", "The worker stopped while holding the job. The lease is the only thing that will free it.", wait);
    t.advance(wait);
    const before = view(pollJob);
    reap(jobs, runs, at());
    t.start("job.claim", { queue: "realtime", worker: WORKERS.second, lease_seconds: QUEUES.realtime.lease, reaped: pollJob.key });
    t.change("jobs", "update", pollJob.key, before, view(pollJob));
    t.change("job_runs", "update", `${pollJob.key}#1`, snap({ status: "running" }), snap({ status: "lost", finished_at: stamp(at()) }));
    t.log("warn", `Lease expired after ${QUEUES.realtime.lease} s. The tick marked the run lost and put the job back in the queue.`);
    worker = WORKERS.second;
    t.advance(LATENCY.claim);
    const beforeClaim = view(pollJob);
    if (!claim(jobs, runs, "realtime", worker, QUEUES.realtime.lease, at())) throw new Error("The reclaimed job was not due.");
    t.change("jobs", "update", pollJob.key, beforeClaim, view(pollJob));
    t.change("job_runs", "insert", `${pollJob.key}#${pollJob.attempts}`, null, snap({ ...runs.at(-1), started_at: stamp(at()) }));
    t.log("info", "Another worker thread claimed it. The job runs at least once, so everything it writes has to be safe to repeat.");
  }
  t.log("info", "Claimed with FOR UPDATE SKIP LOCKED: a row another worker is taking is passed over, not waited for.");
  t.ok({ key: pollJob.key, attempt: pollJob.attempts, max_attempts: pollJob.max_attempts, locked_until: stamp(pollJob.locked_until!) });

  // -- The poll itself, as the job function runs it --------------------------
  const breaker = new CircuitBreaker(3, 300, seconds);
  if (input.breaker === "closed, two failures counted") breaker.failures = 2;
  if (input.breaker === "open") {
    breaker.failures = 3;
    breaker.openedAt = seconds() - 120;
  }
  if (input.breaker === "half-open") {
    breaker.failures = 3;
    breaker.openedAt = seconds() - 300;
  }

  const price = (symbol: string) =>
    round(PREVIOUS_CLOSE[symbol] * (1 + (symbol === WATCHED ? input.changePct : QUIET_CHANGE[symbol]) / 100));
  const allPrices = Object.fromEntries(DEMO_SYMBOLS.map((symbol) => [symbol, price(symbol)]));
  const alpacaDown = faults.has("alpaca-down") || faults.has("both-down");
  const tiingoDown = faults.has("both-down");
  const alpacaAnswer = () =>
    alpacaDown
      ? { prices: {}, error: "https://data.alpaca.markets/v2/stocks/snapshots: ConnectTimeout" }
      : { prices: faults.has("alpaca-partial") ? Object.fromEntries(DEMO_SYMBOLS.slice(0, 4).map((symbol) => [symbol, allPrices[symbol]])) : allPrices };
  const tiingoAnswer = (missing: string[]) =>
    tiingoDown
      ? { prices: {}, error: "https://api.tiingo.com/iex/: HTTP 503 Service Unavailable" }
      : { prices: Object.fromEntries(missing.map((symbol) => [symbol, allPrices[symbol]])) };

  /** Narrates one attempt of the poll as steps 3 to 5 and returns what it priced. */
  const narratePoll = (): PollResult => {
    const stateBefore = breaker.state;
    const failuresBefore = breaker.failures;
    const leftBefore = breaker.secondsLeft();
    t.start("breaker.gate", { provider: "alpaca", state: stateBefore, failures_in_a_row: failuresBefore, threshold: 3, pause_seconds: 300 });
    const result = pollQuotes([...DEMO_SYMBOLS], breaker, alpacaAnswer, tiingoAnswer);
    if (result.alpacaSkipped) {
      t.log("warn", `alpaca: skipped after repeated failures, next try in ${leftBefore.toFixed(0)}s`);
      t.ok({ allowed: false, state: stateBefore, next_try_in_seconds: round(leftBefore, 0) }, "The circuit is open, so this poll does not wait for the primary provider.");
    } else {
      if (stateBefore === "half-open") t.log("info", "The pause is over. This poll gets the one trial call; any other caller is refused until it reports.");
      t.ok({ allowed: true, state: stateBefore, trial_call: stateBefore === "half-open" });
    }

    if (result.alpacaSkipped) {
      t.skip("alpaca.snapshots", "The circuit is open: the primary provider is not called.");
    } else {
      t.start("alpaca.snapshots", {
        request: "GET /v2/stocks/snapshots",
        symbols: DEMO_SYMBOLS.length,
        headers: { "APCA-API-KEY-ID": "••••••••", "APCA-API-SECRET-KEY": "••••••••" },
        budget_seconds: 15,
      });
      if (alpacaDown) {
        t.advance(CONNECT_TIMEOUT_SECONDS * 1000);
        const opened = breaker.state === "open";
        t.log(
          "error",
          stateBefore === "half-open"
            ? "The trial call failed. The circuit is open for another 300 s."
            : opened
              ? "Third failure in a row: the circuit is open. The next polls go to the fallback for 300 s without waiting."
              : `Connection gave up after ${CONNECT_TIMEOUT_SECONDS} s. Failure ${breaker.failures} of 3 in a row; the circuit stays closed.`,
        );
        t.fail("PROVIDER_ERROR", "alpaca: the connection timed out. The error is recorded with the poll; the fallback may still cover it.");
      } else {
        t.advance(LATENCY.alpacaOk);
        if (failuresBefore > 0) t.log("info", "alpaca circuit closed: the failure count is back to zero.");
        if (result.askedTiingoFor.length > 0) t.log("warn", `No usable price for ${result.askedTiingoFor.join(", ")}.`);
        t.ok({ returned: result.fromAlpaca, of: DEMO_SYMBOLS.length, without_a_price: result.askedTiingoFor });
      }
    }

    if (result.askedTiingoFor.length === 0) {
      t.skip("tiingo.fallback", "The primary provider priced every stock, so the fallback is not asked.");
    } else {
      t.start("tiingo.fallback", {
        request: "GET /iex/",
        tickers: result.askedTiingoFor.map((symbol) => symbol.toLowerCase()),
        headers: { Authorization: "Token ••••••••" },
        budget_seconds: 15,
      });
      if (tiingoDown) {
        t.advance(LATENCY.tiingoFail);
        t.fail("PROVIDER_ERROR", "tiingo: HTTP 503. Both providers have failed, so this attempt has no prices.");
      } else {
        t.advance(result.askedTiingoFor.length === DEMO_SYMBOLS.length ? LATENCY.tiingoAll : LATENCY.tiingoFew);
        t.log("info", "Only the symbols that were asked for are accepted from the answer.");
        t.ok({ asked_for: result.askedTiingoFor.length, returned: result.fromTiingo });
      }
    }
    return result;
  };

  let poll = narratePoll();

  // -- 6. Save ---------------------------------------------------------------
  const pollRow = () => ({ slot, alpaca_count: poll.fromAlpaca, tiingo_count: poll.fromTiingo, missing: poll.missing, errors: poll.errors });
  const scanKey = `scan:${slot}`;
  if (Object.keys(poll.rows).length > 0) {
    t.start("quotes.save", { transaction: ["upsert quotes on (symbol, slot)", "upsert polls on (slot)", "enqueue the scan"], rows: Object.keys(poll.rows).length });
    for (const symbol of DEMO_SYMBOLS) {
      if (symbol in poll.rows) {
        const source = poll.askedTiingoFor.includes(symbol) ? "tiingo" : "alpaca";
        t.change("quotes", "insert", `${symbol}@${slot}`, null, snap({ symbol, slot, price: poll.rows[symbol], source }));
      }
    }
    t.change("polls", "insert", slot, null, snap(pollRow()));
    const scanJob = enqueue(jobs, { kind: "scan", key: scanKey, payload: { slot }, expires_at: slotMs + 5 * 60_000 }, at());
    if (scanJob) t.change("jobs", "insert", scanJob.key, null, view(scanJob));
    t.advance(LATENCY.save);
    t.log("info", "The scan is queued in the same transaction as the prices: it exists if and only if they do.");
    t.ok({ prices: Object.keys(poll.rows).length, alpaca: poll.fromAlpaca, tiingo: poll.fromTiingo, missing: poll.missing, errors: poll.errors });
  } else {
    t.skip("quotes.save", "No price came back, so there is nothing to save and no scan is queued.");
  }

  // -- 7. Complete, retry or bury ---------------------------------------------
  let dead = false;
  let rerun: string | null = null;
  for (;;) {
    t.start("job.outcome", { key: pollJob.key, attempt: pollJob.attempts, max_attempts: pollJob.max_attempts, worker });
    if (rerun) t.log("warn", rerun);
    const before = view(pollJob);
    if (Object.keys(poll.rows).length > 0) {
      complete(pollJob, runs, worker, at());
      t.change("jobs", "update", pollJob.key, before, view(pollJob));
      t.advance(LATENCY.finish);
      t.log("info", `Saved ${round((at() - slotMs) / 1000, 1)} s after the slot began (simulated).`);
      t.ok({ status: "done", attempt: pollJob.attempts });
      break;
    }
    const error = noPricesError(poll.errors);
    const attempt = pollJob.attempts;
    const outcome = fail(pollJob, runs, worker, error, at());
    t.change("jobs", "update", pollJob.key, before, view(pollJob));
    t.advance(LATENCY.finish);
    if (outcome === "dead") {
      dead = true;
      t.log("error", `Attempt ${attempt} of ${pollJob.max_attempts} failed. The job is dead and will not run again by itself.`);
      t.fail("JOB_DEAD", error);
      break;
    }
    const wait = backoffSeconds(attempt);
    const bounds = backoffBounds(attempt);
    t.log("warn", `Attempt ${attempt} failed. Retry in ${wait} s. The platform draws this between ${bounds.min} and ${bounds.max} s at random; the simulation uses the middle.`);
    t.fail("JOB_FAILED", error, wait * 1000);
    t.advance(wait * 1000 + LATENCY.claim);
    claim(jobs, runs, "realtime", worker, QUEUES.realtime.lease, at());
    poll = pollQuotes([...DEMO_SYMBOLS], breaker, alpacaAnswer, tiingoAnswer);
    t.advance((poll.alpacaSkipped ? 0 : CONNECT_TIMEOUT_SECONDS * 1000) + LATENCY.tiingoFail);
    const primary = poll.alpacaSkipped
      ? "the circuit is open, so the primary provider was skipped"
      : breaker.state === "open"
        ? "the primary provider timed out for the third time in a row, which opened its circuit"
        : `the primary provider timed out again (failure ${breaker.failures} of 3 in a row)`;
    rerun = `Attempt ${pollJob.attempts} ran the poll again: ${primary}, and the fallback answered 503.`;
  }

  // -- 8-9. A dead job: report it, then a person decides ------------------------
  if (dead) {
    t.advance(24_000);
    t.start("heartbeat.report", { every_seconds: HEARTBEAT_EVERY_SECONDS, checks: ["worker threads", "dead jobs", "poll silence", "backup age", "disk space", "API health"] });
    const problems = deadJobProblems(jobs, at());
    t.log("error", `POST <monitoring check>/fail with ${problems.length} problem line(s). The monitoring service e-mails the owner.`);
    t.ok({ ping: "/fail", body: problems });

    t.start("operator.requeue", { key: pollJob.key, status: pollJob.status, attempts: pollJob.attempts, last_error: pollJob.last_error });
    t.wait("The poll for this slot is dead and you have been e-mailed. The providers are answering again. What do you do?", [
      { id: "requeue", label: "Requeue the job", description: "python -m app.worker --requeue <key>: one more attempt." },
      { id: "leave", label: "Leave it dead", description: `It stays in the report for ${DEAD_WINDOW_HOURS} hours.` },
    ]);
    const decision = yield;
    t.resumed(decision);
    if (decision === "requeue") {
      t.advance(LATENCY.operator);
      const before = view(pollJob);
      requeue(jobs, pollJob.key, at());
      t.change("jobs", "update", pollJob.key, before, view(pollJob));
      t.log("info", "Requeued: status queued, max_attempts raised by exactly one. The earlier runs stay in job_runs.");
      t.advance(TICK_EVERY_SECONDS * 1000);
      const beforeReap = view(pollJob);
      reap(jobs, runs, at());
      t.change("jobs", "update", pollJob.key, beforeReap, view(pollJob));
      t.log("warn", "The job's four-minute expiry has passed, so the next tick marked it expired instead of running it: a price fetched now would not be this slot's.");
      t.ok({ requeued: true, status: pollJob.status }, "Requeueing a job tied to a time slot clears the alert without redoing stale work.");
      t.skipRemaining("The slot has no prices, so there is nothing to scan.");
      t.finish(
        "failed",
        `Slot ${slot.slice(11, 16)} was never priced: both providers failed on all ${pollJob.attempts} attempts. The dead job was reported, and requeueing it expired it instead of running it late. Quotes missed this way are not backfilled.`,
        { slot, priced: 0, job: pollJob.status, attempts: pollJob.attempts },
      );
      return;
    }
    t.log("info", `Left as it is. The heartbeat keeps naming it for ${DEAD_WINDOW_HOURS} hours, then it drops out of the report.`);
    t.ok({ requeued: false, status: pollJob.status });
    t.skipRemaining("The slot has no prices, so there is nothing to scan.");
    t.finish(
      "failed",
      `Slot ${slot.slice(11, 16)} was never priced: both providers failed on all ${pollJob.attempts} attempts. The job is dead and stays in the heartbeat's report for ${DEAD_WINDOW_HOURS} hours. Quotes missed this way are not backfilled.`,
      { slot, priced: 0, job: pollJob.status, attempts: pollJob.attempts },
    );
    return;
  }
  t.skip("heartbeat.report", "No job died. The heartbeat still pings once a minute, and it reports ok.");
  t.skip("operator.requeue", "Nothing needs a person.");

  // -- 10. Scan --------------------------------------------------------------
  t.advance(LATENCY.claim);
  const staleClose = faults.has("stale-close");
  const metrics: StockMetrics[] = DEMO_SYMBOLS.filter((symbol) => symbol in poll.rows).map((symbol) => {
    const previous = staleClose && symbol === STALE_SYMBOL ? STALE_CLOSE : PREVIOUS_CLOSE[symbol];
    const current = poll.rows[symbol];
    return {
      symbol,
      price: current,
      prev_close: previous,
      change_pct: round(((current - previous) / previous) * 100),
      gap_pct: round(symbol === WATCHED ? Math.min(input.changePct, 1.2) : 0.1),
      rvol: symbol === WATCHED ? input.relativeVolume : 1,
      volume_minutes: input.minutesIntoSession,
      high_52w: round(previous * 1.4),
      low_52w: round(previous * 0.7),
      rsi: 55,
      rsi_prev: 54,
      sma: round(previous * 0.9),
    };
  });
  const scanJob = claim(jobs, runs, "realtime", worker, QUEUES.realtime.lease, at());
  if (!scanJob || scanJob.key !== scanKey) throw new Error("The scan job was not next in the queue.");
  t.start("scan.compute", { job: scanKey, attempt: scanJob.attempts, stocks: metrics.length, rules: snap(DEFAULT_RULES) });
  t.advance(LATENCY.scan);
  const fired = metrics.flatMap((stock) => signals(stock).map(([rule, value]) => ({ symbol: stock.symbol, rule, value, price: stock.price })));
  if (staleClose) {
    t.log("warn", `${STALE_SYMBOL}: last night's daily sync died, so its stored close is days old. The scanner does not check the age of that close.`);
  }
  t.log("info", fired.length > 0 ? `Rules fired: ${fired.map((item) => `${item.symbol} ${item.rule}`).join(", ")}.` : "No rule fired.");
  t.ok(
    { stocks: metrics.length, watched: snap(metrics.find((stock) => stock.symbol === WATCHED) ?? null), fired: snap(fired) },
    staleClose && fired.some((item) => item.symbol === STALE_SYMBOL) ? `${STALE_SYMBOL} looks like a move only because its previous close is stale.` : undefined,
  );

  // -- 11. Alerts ------------------------------------------------------------
  if (faults.has("repeat-alert")) {
    alerts.push({ session: DEMO_SESSION, symbol: WATCHED, rule: "move_up", triggered_at: stamp(slotMs - 20 * 60_000), price: 103.1, value: 3.1, sent_at: null });
  }
  t.start("alerts.insert", { session: DEMO_SESSION, candidates: snap(fired.map((item) => `${item.symbol} ${item.rule}`)), key: ["session", "symbol", "rule"] });
  const created: string[] = [];
  const repeats: string[] = [];
  for (const item of fired) {
    const row: AlertRow = { session: DEMO_SESSION, symbol: item.symbol, rule: item.rule, triggered_at: stamp(at()), price: item.price, value: item.value, sent_at: null };
    if (insertAlert(alerts, row)) {
      created.push(`${item.symbol} ${item.rule}`);
      t.change("alerts", "insert", `${DEMO_SESSION}/${item.symbol}/${item.rule}`, null, snap(row));
    } else {
      repeats.push(`${item.symbol} ${item.rule}`);
      t.log("info", `${item.symbol} ${item.rule} already fired today. ON CONFLICT DO NOTHING: the first alert stands and no second one is written.`);
    }
    t.advance(LATENCY.alert);
  }
  if (fired.length === 0) t.log("info", "Nothing to insert.");
  t.ok({ new: created, already_fired_today: repeats });

  // -- 12. Notify? -----------------------------------------------------------
  const sending = faults.has("telegram-on") || faults.has("telegram-down");
  const unsent = [...new Set(alerts.filter((row) => row.sent_at === null).map((row) => row.symbol))];
  const sendKey = `send_alerts:${slot}`;
  t.start("notify.decide", { unsent_symbols: unsent, send_alerts: sending });
  let sendJob: JobRow | null = null;
  if (unsent.length === 0) {
    t.log("info", "No unsent alert this session.");
  } else if (!sending) {
    t.log("info", "send_alerts is off. In the running system the older poller is still the only Telegram sender, so no send job is queued.");
  } else {
    sendJob = enqueue(jobs, { kind: "send_alerts", key: sendKey, payload: { day: DEMO_SESSION } }, at());
    if (sendJob) t.change("jobs", "insert", sendJob.key, null, view(sendJob));
    t.log("info", "Sending is switched on for this run, so a send job is queued in the scan's transaction.");
  }
  t.ok({ unsent: unsent.length, send_job: sendJob ? sendJob.key : null });

  // -- 13. Snapshot ------------------------------------------------------------
  t.start("snapshot.publish", { generated_at: stamp(at()), stocks: metrics.length });
  t.change("scan_snapshot", "update", "1", snap({ generated_at: stamp(slotMs - 5 * 60_000 + 6_400) }), snap({ generated_at: stamp(at()), session: DEMO_SESSION, stocks: metrics.length }));
  t.advance(LATENCY.snapshot);
  complete(scanJob, runs, worker, at());
  t.log("info", "One row holds what the dashboard reads. An older scan can never overwrite a newer one.");
  t.ok({ served_by: "GET /api/v1/stocks", scan_job: scanJob.status });

  // -- 14. Telegram ------------------------------------------------------------
  const priced = `Slot ${slot.slice(11, 16)} priced: ${poll.fromAlpaca} from the primary provider, ${poll.fromTiingo} from the fallback.`;
  const alertLine = created.length > 0 ? `New alert: ${created.join(", ")}.` : repeats.length > 0 ? "The rule had already fired today, so no second alert was written." : "No rule fired.";
  if (!sendJob) {
    t.skip("telegram.send", unsent.length === 0 ? "There is nothing unsent." : "Sending is switched off in the running system. The alert is on the dashboard only.");
    t.finish("success", `${priced} ${alertLine}${unsent.length > 0 ? " Telegram sending is off in the running system, so it is on the dashboard only." : ""}`, {
      slot,
      alpaca: poll.fromAlpaca,
      tiingo: poll.fromTiingo,
      new_alerts: created,
      sent: 0,
    });
    return;
  }

  t.advance(LATENCY.claim);
  const pending = alerts.filter((row) => row.sent_at === null);
  for (;;) {
    claim(jobs, runs, "realtime", worker, QUEUES.realtime.lease, at());
    t.start("telegram.send", {
      job: sendKey,
      attempt: sendJob.attempts,
      query: "SELECT ... FROM alerts WHERE session = :d AND sent_at IS NULL ... FOR UPDATE SKIP LOCKED",
      rows: pending.length,
      request: "POST https://api.telegram.org/bot••••••••/sendMessage",
    });
    t.advance(LATENCY.telegram);
    if (!faults.has("telegram-down")) {
      for (const row of pending) {
        const before = snap(row);
        row.sent_at = stamp(at());
        t.change("alerts", "update", `${row.session}/${row.symbol}/${row.rule}`, before, snap(row));
      }
      complete(sendJob, runs, worker, at());
      t.log("info", "One message for the session's unsent alerts, then sent_at is set in the same transaction. No real message is sent by this simulation.");
      t.ok({ sent: pending.length, lines: pending.map((row) => `${row.symbol} ${row.rule}`) });
      t.finish("success", `${priced} ${alertLine} Sent as one Telegram message and marked sent. In the running system this step is switched off.`, {
        slot,
        alpaca: poll.fromAlpaca,
        tiingo: poll.fromTiingo,
        new_alerts: created,
        sent: pending.length,
      });
      return;
    }
    const attempt = sendJob.attempts;
    const outcome = fail(sendJob, runs, worker, "RuntimeError: Telegram unreachable: ConnectTimeout", at());
    t.log("warn", "The transaction rolled back, so the alerts are still unsent. The error names the failure, never the URL, which carries the bot token.");
    if (outcome === "dead") {
      t.log("error", "Third failure. The send job is dead; the next heartbeat reports it, and the next scan queues a new send job because the alerts are still unsent.");
      t.fail("JOB_DEAD", "Telegram unreachable on every attempt.");
      t.finish(
        "failed",
        `${priced} ${alertLine} It was recorded but not delivered: Telegram was unreachable three times, so the send job is dead and reported. The alert stays unsent, and the next scan queues a new send job.`,
        { slot, alpaca: poll.fromAlpaca, tiingo: poll.fromTiingo, new_alerts: created, sent: 0 },
      );
      return;
    }
    const wait = backoffSeconds(attempt);
    t.fail("TELEGRAM_ERROR", "Telegram unreachable: ConnectTimeout", wait * 1000);
    t.advance(wait * 1000 + LATENCY.claim);
  }
}

export const stocksScenario: Scenario<StocksInput> = {
  id: STOCKS_SCENARIO_ID,
  stepIds: STOCKS_STEPS,
  run,
};
