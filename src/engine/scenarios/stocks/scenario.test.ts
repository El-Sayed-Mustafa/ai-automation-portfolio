import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import {
  BREAKER_STARTS,
  STOCKS_DEFAULT_INPUT,
  STOCKS_FAULTS,
  STOCKS_PRESETS,
  STOCKS_STEPS,
  stocksScenario,
  validateStocksInput,
  type StocksFaultId,
  type StocksInput,
} from "./scenario";

function execute(options: { input?: Partial<StocksInput>; faults?: StocksFaultId[]; answers?: string[] } = {}) {
  const session = new RunSession(stocksScenario, {
    runId: "test-run",
    input: { ...STOCKS_DEFAULT_INPUT, ...options.input },
    faults: options.faults,
  });
  const answers = [...(options.answers ?? ["requeue"])];
  while (session.isWaiting) {
    const answer = answers.shift();
    if (answer === undefined) break;
    session.resume(answer);
  }
  return { session, events: session.events, state: reduceRun(STOCKS_STEPS, session.events) };
}

function statuses(state: RunState) {
  return Object.fromEntries(STOCKS_STEPS.map((id) => [id, state.steps[id].status]));
}

function changesTo(events: readonly RunEvent[], table: string) {
  return events.filter((e) => e.type === "state.changed" && e.table === table) as Extract<RunEvent, { type: "state.changed" }>[];
}

function logs(state: RunState) {
  return state.logs.map((entry) => entry.message).join("\n");
}

describe("a normal slot with one moving stock", () => {
  const { state, events, session } = execute();

  it("finishes without needing a person", () => {
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
  });

  it("prices every stock from the primary provider and never asks the fallback", () => {
    expect(state.steps["alpaca.snapshots"].output).toMatchObject({ returned: 6, of: 6, without_a_price: [] });
    expect(state.steps["tiingo.fallback"].status).toBe("skipped");
    expect(changesTo(events, "quotes")).toHaveLength(6);
    expect(changesTo(events, "polls")[0].after).toMatchObject({ alpaca_count: 6, tiingo_count: 0, missing: [], errors: [] });
  });

  it("queues the scan in the same step that saves the prices", () => {
    const step = state.steps["quotes.save"];
    expect(step.changes.map((change) => change.table)).toEqual([...Array(6).fill("quotes"), "polls", "jobs"]);
    expect(step.changes.at(-1)?.key).toBe("scan:2026-03-16T14:15:00Z");
  });

  it("records one alert for the stock that crossed the move rule", () => {
    expect(state.steps["scan.compute"].output).toMatchObject({ fired: [{ symbol: "DEMO1", rule: "move_up", value: 3.4 }] });
    const [alert] = changesTo(events, "alerts");
    expect(alert.key).toBe("2026-03-16/DEMO1/move_up");
    expect(alert.after).toMatchObject({ price: 103.4, value: 3.4, sent_at: null });
  });

  it("does not send to Telegram, and says why", () => {
    expect(state.steps["notify.decide"].output).toMatchObject({ unsent: 1, send_job: null });
    expect(state.steps["telegram.send"].status).toBe("skipped");
    expect(state.steps["telegram.send"].skipReason).toMatch(/switched off in the running system/);
    expect(state.outcome).toMatch(/Telegram sending is off in the running system/);
  });

  it("skips the recovery steps, with a reason", () => {
    expect(state.steps["heartbeat.report"].status).toBe("skipped");
    expect(state.steps["operator.requeue"].status).toBe("skipped");
    expect(state.steps["heartbeat.report"].skipReason).toMatch(/reports ok/);
  });

  it("uses the job key and timings the schedule defines", () => {
    const [job] = changesTo(events, "jobs");
    expect(job.after).toMatchObject({
      key: "poll_quotes:2026-03-16T14:15:00Z",
      kind: "poll_quotes",
      queue: "realtime",
      status: "queued",
      max_attempts: 3,
      run_after: "2026-03-16T14:15:05Z",
      expires_at: "2026-03-16T14:19:00Z",
    });
  });

  it("is deterministic", () => {
    expect(execute().events).toEqual(events);
  });
});

describe("presets", () => {
  it.each(STOCKS_PRESETS.map((preset) => [preset.id, preset.input] as const))("%s runs to the end", (_id, input) => {
    const { session, state } = execute({ input });
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
  });

  it("a quiet slot saves prices and records no alert", () => {
    const { state, events } = execute({ input: STOCKS_PRESETS.find((preset) => preset.id === "quiet")!.input });
    expect(changesTo(events, "quotes")).toHaveLength(6);
    expect(changesTo(events, "alerts")).toHaveLength(0);
    expect(state.outcome).toMatch(/No rule fired\.$/);
    expect(state.steps["telegram.send"].skipReason).toBe("There is nothing unsent.");
  });

  it("unusual volume fires only after thirty minutes of session", () => {
    const volume = STOCKS_PRESETS.find((preset) => preset.id === "volume")!.input;
    expect(execute({ input: volume }).state.steps["scan.compute"].output).toMatchObject({ fired: [{ symbol: "DEMO1", rule: "volume", value: 2.4 }] });
    expect(execute({ input: { ...volume, minutesIntoSession: 25 } }).state.steps["scan.compute"].output).toMatchObject({ fired: [] });
  });
});

describe("the circuit breaker", () => {
  it("a first failure is recorded, counted, and covered by the fallback", () => {
    const { state, events } = execute({ faults: ["alpaca-down"] });
    expect(state.status).toBe("success");
    expect(state.steps["alpaca.snapshots"].status).toBe("failed");
    expect(logs(state)).toMatch(/Failure 1 of 3 in a row; the circuit stays closed/);
    expect(state.steps["tiingo.fallback"].output).toEqual({ asked_for: 6, returned: 6 });
    expect(changesTo(events, "polls")[0].after).toMatchObject({ alpaca_count: 0, tiingo_count: 6, errors: [expect.stringMatching(/^alpaca: .*ConnectTimeout$/)] });
    expect(state.outcome).toMatch(/0 from the primary provider, 6 from the fallback/);
  });

  it("the third failure in a row opens the circuit", () => {
    const { state } = execute({ input: { breaker: "closed, two failures counted" }, faults: ["alpaca-down"] });
    expect(logs(state)).toMatch(/Third failure in a row: the circuit is open/);
    expect(state.status).toBe("success");
  });

  it("an open circuit skips the primary provider without waiting for it", () => {
    const open = execute({ input: { breaker: "open" } });
    expect(open.state.steps["breaker.gate"].output).toMatchObject({ allowed: false, state: "open", next_try_in_seconds: 180 });
    expect(open.state.steps["alpaca.snapshots"].status).toBe("skipped");
    expect(open.state.steps["tiingo.fallback"].output).toEqual({ asked_for: 6, returned: 6 });
    // No five-second timeout is paid: the slot is saved sooner than with a closed circuit and a dead provider.
    const failing = execute({ faults: ["alpaca-down"] });
    expect(open.state.clock).toBeLessThan(failing.state.clock - 4_000);
  });

  it("a trial call that succeeds closes the circuit", () => {
    const { state } = execute({ input: { breaker: "half-open" } });
    expect(state.steps["breaker.gate"].output).toMatchObject({ allowed: true, state: "half-open", trial_call: true });
    expect(state.steps["alpaca.snapshots"].status).toBe("success");
    expect(logs(state)).toMatch(/alpaca circuit closed/);
  });

  it("a trial call that fails opens it for another pause", () => {
    const { state } = execute({ input: { breaker: "half-open" }, faults: ["alpaca-down"] });
    expect(logs(state)).toMatch(/The trial call failed\. The circuit is open for another 300 s/);
    expect(state.status).toBe("success");
  });

  it("the fallback is asked only for the stocks the primary missed", () => {
    const { state, events } = execute({ faults: ["alpaca-partial"] });
    expect(state.steps["alpaca.snapshots"].output).toMatchObject({ returned: 4, without_a_price: ["DEMO5", "DEMO6"] });
    expect(state.steps["tiingo.fallback"].input).toMatchObject({ tickers: ["demo5", "demo6"] });
    expect(changesTo(events, "polls")[0].after).toMatchObject({ alpaca_count: 4, tiingo_count: 2, missing: [] });
    const sources = Object.fromEntries(changesTo(events, "quotes").map((change) => [(change.after as { symbol: string }).symbol, (change.after as { source: string }).source]));
    expect(sources).toMatchObject({ DEMO1: "alpaca", DEMO5: "tiingo", DEMO6: "tiingo" });
  });
});

describe("the queue", () => {
  it("a second tick queues nothing twice", () => {
    const { state, events } = execute({ faults: ["duplicate-tick"] });
    expect(state.steps["tick.enqueue"].output).toMatchObject({ duplicates_ignored: 1 });
    expect(changesTo(events, "jobs").filter((change) => change.op === "insert" && change.key.startsWith("poll_quotes:"))).toHaveLength(1);
  });

  it("a killed worker's job is reclaimed when its lease runs out and then completes", () => {
    const { state, events } = execute({ faults: ["worker-killed"] });
    const claim = state.steps["job.claim"];
    expect(claim.attempts).toHaveLength(2);
    expect(claim.attempts[0]).toMatchObject({ status: "failed", error: { code: "WORKER_LOST" } });
    expect(claim.output).toMatchObject({ attempt: 2 });
    expect(changesTo(events, "job_runs").some((change) => (change.after as { status?: string }).status === "lost")).toBe(true);
    expect(state.status).toBe("success");
    expect(state.steps["job.outcome"].output).toMatchObject({ status: "done", attempt: 2 });
    // The job still finished inside its four-minute window.
    const done = events.find((event) => event.type === "step.succeeded" && event.stepId === "job.outcome")!;
    expect(done.at).toBeLessThan(240_000);
    expect(done.at).toBeGreaterThan(180_000);
  });

  it("with both providers down the job is retried with backoff and buried after the third attempt", () => {
    const { state, session } = execute({ faults: ["both-down"], answers: [] });
    expect(session.isWaiting).toBe(true);
    const outcome = state.steps["job.outcome"];
    expect(outcome.attempts).toHaveLength(3);
    expect(outcome.attempts.map((attempt) => attempt.error?.code)).toEqual(["JOB_FAILED", "JOB_FAILED", "JOB_DEAD"]);
    const waits = outcome.attempts.slice(0, 2).map((attempt) => (attempt.retryAt ?? 0) - (attempt.endedAt ?? 0));
    expect(waits).toEqual([22_500, 45_000]);
    expect(outcome.error?.message).toBe(
      "RuntimeError: no prices: alpaca: https://data.alpaca.markets/v2/stocks/snapshots: ConnectTimeout; tiingo: https://api.tiingo.com/iex/: HTTP 503 Service Unavailable",
    );
    // Three attempts are three failures in a row, so the last one also opens the primary provider's circuit.
    expect(logs(state)).toMatch(/Attempt 3 ran the poll again: the primary provider timed out for the third time in a row, which opened its circuit/);
    expect(state.steps["quotes.save"].status).toBe("skipped");
  });

  it("the heartbeat names the dead job before anyone is asked to act", () => {
    const { state } = execute({ faults: ["both-down"], answers: [] });
    expect(state.steps["heartbeat.report"].output).toMatchObject({ ping: "/fail", body: [expect.stringMatching(/^dead job poll_quotes:2026-03-16T14:15:00Z: RuntimeError: no prices/)] });
    expect(state.steps["operator.requeue"].status).toBe("waiting");
    expect(state.steps["operator.requeue"].waiting?.choices.map((choice) => choice.id)).toEqual(["requeue", "leave"]);
  });

  it("requeueing a job whose slot has passed expires it instead of running it late", () => {
    const { state, events } = execute({ faults: ["both-down"], answers: ["requeue"] });
    expect(state.status).toBe("failed");
    const jobStates = changesTo(events, "jobs")
      .filter((change) => change.key.startsWith("poll_quotes:") && change.op === "update")
      .map((change) => (change.after as { status: string }).status);
    expect(jobStates.slice(-3)).toEqual(["dead", "queued", "expired"]);
    const requeued = changesTo(events, "jobs").find(
      (change) => change.op === "update" && (change.after as { status: string }).status === "queued" && (change.before as { status: string }).status === "dead",
    )!;
    expect(requeued.after).toMatchObject({ max_attempts: 4, attempts: 3 });
    expect(state.outcome).toMatch(/requeueing it expired it instead of running it late/);
    expect(changesTo(events, "quotes")).toHaveLength(0);
    expect(statuses(state)["scan.compute"]).toBe("skipped");
  });

  it("once the circuit is already open, the retries skip the primary provider", () => {
    const { state } = execute({ input: { breaker: "closed, two failures counted" }, faults: ["both-down"], answers: [] });
    expect(state.steps["job.outcome"].error?.message).toMatch(/^RuntimeError: no prices: alpaca: skipped after repeated failures, next try in \d+s; tiingo: /);
  });

  it("leaving the job dead keeps it in the report", () => {
    const { state } = execute({ faults: ["both-down"], answers: ["leave"] });
    expect(state.status).toBe("failed");
    expect(state.steps["operator.requeue"].output).toMatchObject({ requeued: false, status: "dead" });
    expect(state.outcome).toMatch(/stays in the heartbeat's report for 24 hours/);
  });
});

describe("alerts", () => {
  it("a rule that already fired today is not recorded twice", () => {
    const { state, events } = execute({ faults: ["repeat-alert"] });
    expect(state.steps["alerts.insert"].output).toEqual({ new: [], already_fired_today: ["DEMO1 move_up"] });
    expect(changesTo(events, "alerts")).toHaveLength(0);
    expect(state.outcome).toMatch(/had already fired today/);
  });

  it("a stale daily close produces a false alert, and the run says so", () => {
    const { state, events } = execute({ input: { changePct: 0.6 }, faults: ["stale-close"] });
    expect(state.steps["scan.compute"].warning).toMatch(/only because its previous close is stale/);
    expect(changesTo(events, "alerts").map((change) => change.key)).toEqual(["2026-03-16/DEMO3/move_up"]);
  });

  it("when sending is switched on, the alerts are sent once and marked sent", () => {
    const { state, events } = execute({ faults: ["telegram-on"] });
    expect(state.status).toBe("success");
    expect(state.steps["telegram.send"].output).toMatchObject({ sent: 1, lines: ["DEMO1 move_up"] });
    const update = changesTo(events, "alerts").find((change) => change.op === "update")!;
    expect((update.before as { sent_at: unknown }).sent_at).toBeNull();
    expect((update.after as { sent_at: unknown }).sent_at).toEqual(expect.any(String));
    expect(state.outcome).toMatch(/In the running system this step is switched off/);
  });

  it("when Telegram is unreachable the alerts stay unsent and the send job dies after three attempts", () => {
    const { state, events } = execute({ faults: ["telegram-down"] });
    expect(state.status).toBe("failed");
    expect(state.steps["telegram.send"].attempts).toHaveLength(3);
    expect(changesTo(events, "alerts").filter((change) => change.op === "update")).toHaveLength(0);
    expect(state.outcome).toMatch(/recorded but not delivered/);
    // The prices and the alert were still saved.
    expect(changesTo(events, "quotes")).toHaveLength(6);
    expect(changesTo(events, "alerts").filter((change) => change.op === "insert")).toHaveLength(1);
  });
});

describe("every fault", () => {
  it.each(STOCKS_FAULTS.map((fault) => [fault] as const))("%s ends in a finished run", (fault) => {
    const { session, state } = execute({ faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(["success", "failed"]).toContain(state.status);
    expect(state.outcome).toBeTruthy();
    // Every step has settled one way or another.
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(BREAKER_STARTS.flatMap((breaker) => STOCKS_FAULTS.map((fault) => [breaker, fault] as const)))("%s with %s is consistent", (breaker, fault) => {
    const { session, state } = execute({ input: { breaker }, faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
  });
});

describe("recorded payloads", () => {
  it("never contain a credential", () => {
    for (const fault of [undefined, ...STOCKS_FAULTS]) {
      const { events } = execute({ faults: fault ? [fault] : [] });
      const text = JSON.stringify(events);
      expect(text).not.toMatch(/bot\d{6,}:[A-Za-z0-9_-]{20,}/);
      expect(text).not.toMatch(/Token [a-f0-9]{20,}/);
      expect(text).toContain("••••••••");
    }
  });
});

describe("input validation", () => {
  it("accepts the defaults and every preset", () => {
    expect(validateStocksInput(STOCKS_DEFAULT_INPUT)).toMatchObject({ ok: true, errors: {} });
    for (const preset of STOCKS_PRESETS) expect(validateStocksInput(preset.input).ok).toBe(true);
  });

  it("reports each field that is out of range", () => {
    const result = validateStocksInput({ breaker: "ajar", changePct: -3, relativeVolume: 99, minutesIntoSession: 4.5 });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["breaker", "changePct", "minutesIntoSession", "relativeVolume"]);
    // The value is still usable: bad fields fall back to the defaults.
    expect(result.value.breaker).toBe("closed");
  });

  it("reads numbers typed as text and rounds them", () => {
    expect(validateStocksInput({ ...STOCKS_DEFAULT_INPUT, changePct: "3.456" as unknown as number }).value.changePct).toBe(3.46);
  });
});
