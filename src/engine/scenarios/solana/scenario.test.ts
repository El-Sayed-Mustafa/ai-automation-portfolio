import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import { DEMO_SETTINGS } from "./rules";
import {
  DEMO_TOKEN,
  PRICE_PATHS,
  SOLANA_DEFAULT_INPUT,
  SOLANA_FAULTS,
  SOLANA_PRESETS,
  SOLANA_STEPS,
  solanaScenario,
  validateSolanaInput,
  type SolanaFaultId,
  type SolanaInput,
} from "./scenario";

function execute(options: { input?: Partial<SolanaInput>; faults?: SolanaFaultId[]; answers?: string[] } = {}) {
  const session = new RunSession(solanaScenario, {
    runId: "test-run",
    input: { ...SOLANA_DEFAULT_INPUT, ...options.input },
    faults: options.faults,
  });
  const answers = [...(options.answers ?? ["keep"])];
  while (session.isWaiting) {
    const answer = answers.shift();
    if (answer === undefined) break;
    session.resume(answer);
  }
  return { session, events: session.events, state: reduceRun(SOLANA_STEPS, session.events) };
}

function statuses(state: RunState) {
  return Object.fromEntries(SOLANA_STEPS.map((id) => [id, state.steps[id].status]));
}

function changesTo(events: readonly RunEvent[], table: string) {
  return events.filter((e) => e.type === "state.changed" && e.table === table) as Extract<RunEvent, { type: "state.changed" }>[];
}

function logs(state: RunState) {
  return state.logs.map((entry) => entry.message).join("\n");
}

function preset(id: string): SolanaInput {
  return SOLANA_PRESETS.find((item) => item.id === id)!.input;
}

describe("a runner, held by two strategies", () => {
  const { state, events, session } = execute();

  it("completes every step", () => {
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
    expect(Object.values(statuses(state)).every((status) => status === "success")).toBe(true);
  });

  it("records the scanner's verdict for the token", () => {
    const [verdict] = changesTo(events, "scan_evaluations");
    expect(verdict.after).toMatchObject({ verdict: "opportunity", rejectedGate: null });
  });

  it("opens one paper position per strategy on the same signal", () => {
    const opens = changesTo(events, "paper_trades").filter((change) => change.op === "insert");
    expect(opens.map((change) => (change.after as { strategy: string }).strategy)).toEqual(["control", "no-partial shadow"]);
    expect(state.steps["strategies.open"].output).toMatchObject({ paper: true });
  });

  it("never builds a real order", () => {
    expect(state.steps["pilot.guard"].output).toEqual({ real_order: false, refused_because: "DRY_RUN is on: no transaction is built" });
    expect(changesTo(events, "real_exec")).toHaveLength(0);
  });

  it("the control sells half on the way up and both exit on the trail", () => {
    expect(logs(state)).toMatch(/control sold half at \+27%/);
    expect(state.steps["exit.decide"].output).toMatchObject({
      exits: [
        { strategy: "control", status: "closed_trail" },
        { strategy: "no-partial shadow", status: "closed_trail" },
      ],
    });
  });

  it("compares the two on the same signal after costs, weighting the partial exit by size", () => {
    // Control: half at +27, half at +42.83, less a 1.2% round trip. Shadow: all of it at +42.83.
    expect(state.steps["report.compare"].output).toEqual({ control_net_pct: 33.71, shadow_net_pct: 41.63, edge_points: 7.92 });
  });

  it("does not let one good trade promote the rule", () => {
    const report = state.steps["candidate.evaluate"].output as { pairs: number; promote: boolean; checks: { id: string; passed: boolean }[] };
    expect(report.pairs).toBe(24);
    expect(report.promote).toBe(false);
    expect(report.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(["sample"]);
    expect(state.outcome).toMatch(/The shadow stays on paper\. The evaluator does not pass it yet \(enough paired trades: 24 of at least 30\)/);
  });

  it("is deterministic, including the resampling", () => {
    expect(execute().events).toEqual(events);
  });
});

describe("the same rule on other markets", () => {
  it("on a spike that fades, taking half off wins", () => {
    const { state } = execute({ input: preset("fade") });
    expect(state.steps["report.compare"].output).toMatchObject({ control_net_pct: 21.3, shadow_net_pct: 16.8, edge_points: -4.5 });
  });

  it("on a slow bleed both are cut at the same point", () => {
    const { state } = execute({ input: preset("bleed") });
    expect(state.steps["exit.decide"].output).toMatchObject({ exits: [{ status: "closed_loss_cut" }, { status: "closed_loss_cut" }] });
    expect(state.steps["report.compare"].output).toMatchObject({ edge_points: 0 });
  });

  it("in chop both time out", () => {
    const { state } = execute({ input: preset("chop") });
    expect(state.steps["exit.decide"].output).toMatchObject({ exits: [{ status: "closed_max_hold", minute: 45 }, { status: "closed_max_hold", minute: 45 }] });
  });

  it.each(PRICE_PATHS.map((path) => [path] as const))("%s finishes", (path) => {
    const { session, state } = execute({ input: { path } });
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
  });
});

describe("no trade", () => {
  it("a thin pool is rejected at the liquidity gate, and the rejection is recorded", () => {
    const { state, events } = execute({ input: preset("thin") });
    expect(state.status).toBe("success");
    expect(changesTo(events, "scan_evaluations")[0].after).toMatchObject({ verdict: "rejected", rejectedGate: "liquidity" });
    expect(changesTo(events, "paper_trades")).toHaveLength(0);
    expect(statuses(state)["signal.record"]).toBe("skipped");
    expect(state.outcome).toMatch(/rejected the token at the "liquidity" gate/);
  });

  it("a token that cannot be sold back is rejected before anything is opened", () => {
    const { state, events } = execute({ faults: ["no-sell-route"] });
    expect(changesTo(events, "scan_evaluations")[0].after).toMatchObject({ rejectedGate: "not_swappable" });
    expect(changesTo(events, "paper_trades")).toHaveLength(0);
    expect(state.outcome).toMatch(/not_swappable/);
  });

  it("a signal raised a few minutes ago is not raised again", () => {
    const { state, events } = execute({ faults: ["duplicate-signal"] });
    expect(state.steps["signal.record"].output).toEqual({ recorded: false, reason: "signalled recently" });
    expect(changesTo(events, "opportunities")).toHaveLength(0);
    expect(changesTo(events, "paper_trades")).toHaveLength(0);
  });

  it("the risk manager refuses a trade whose price impact is too high, for every strategy", () => {
    const { state, events } = execute({ input: { roundTripCostPct: 8 } });
    expect(state.steps["risk.check"].output).toMatchObject({ approved: false, reason: "price impact 4.0% is over the limit" });
    expect(changesTo(events, "entry_rejections")[0].after).toMatchObject({ gate: "risk" });
    expect(changesTo(events, "paper_trades")).toHaveLength(0);
  });
});

describe("strategies decide separately", () => {
  it("an expensive trade is observation only for the shadow; the control still trades", () => {
    const { state, events } = execute({ input: preset("expensive") });
    expect(state.steps["entry.quote"].output).toMatchObject({ execution_band: "C" });
    const opens = changesTo(events, "paper_trades").filter((change) => change.op === "insert");
    expect(opens.map((change) => (change.after as { strategy: string }).strategy)).toEqual(["control"]);
    expect(changesTo(events, "entry_rejections")[0].after).toMatchObject({ strategy: "no-partial shadow", gate: "execution_cost" });
    expect(statuses(state)["candidate.evaluate"]).toBe("skipped");
    expect(state.outcome).toMatch(/adds nothing to the comparison/);
  });

  it("a full control does not stop the shadow from taking the signal", () => {
    const { state, events } = execute({ faults: ["position-cap"] });
    const opens = changesTo(events, "paper_trades").filter((change) => change.op === "insert");
    expect(opens.map((change) => (change.after as { strategy: string }).strategy)).toEqual(["no-partial shadow"]);
    expect(changesTo(events, "entry_rejections")[0].after).toMatchObject({ strategy: "control", reason: "position cap (this strategy)" });
    expect(state.status).toBe("success");
  });
});

describe("the monitor", () => {
  it("ignores an implausible tick instead of booking it as an exit", () => {
    const clean = execute();
    const { state } = execute({ faults: ["bad-tick"] });
    expect(logs(state)).toMatch(/Minute 7: a price 96% under the reference while liquidity is healthy/);
    expect(state.steps["monitor.tick"].warning).toMatch(/ignored instead of being booked/);
    // The result is the same as without the bad tick.
    expect(state.steps["report.compare"].output).toEqual(clean.state.steps["report.compare"].output);
  });

  it("ignores a tick that came from a different pool", () => {
    const { state } = execute({ faults: ["pool-switch"] });
    expect(logs(state)).toMatch(/Minute 4: the price came from a different pool than the one locked at entry/);
    expect(state.status).toBe("success");
  });

  it("closes every position as a rug when liquidity is pulled, and caps the loss at the position", () => {
    const { state } = execute({ faults: ["rug"] });
    expect(state.steps["exit.decide"].output).toMatchObject({ exits: [{ status: "closed_rug", minute: 11, pnl_pct: -99 }, { status: "closed_rug", minute: 11, pnl_pct: -99 }] });
    expect(state.steps["report.compare"].output).toEqual({ control_net_pct: -100, shadow_net_pct: -100, edge_points: 0 });
  });

  it("a second closer changes nothing", () => {
    const clean = execute();
    const { state, events } = execute({ faults: ["double-close"] });
    expect(logs(state)).toMatch(/Its update matched 0 rows, so nothing was closed or reported twice/);
    expect(changesTo(events, "paper_trades").filter((change) => change.op === "update")).toHaveLength(2);
    expect(state.steps["report.compare"].output).toEqual(clean.state.steps["report.compare"].output);
  });

  it("a token with no snapshot is never closed: the gap is shown, not hidden", () => {
    const { state, events } = execute({ faults: ["snapshot-missing"] });
    expect(state.status).toBe("failed");
    expect(state.steps["monitor.tick"].error?.code).toBe("NO_SNAPSHOT");
    expect(changesTo(events, "paper_trades").filter((change) => change.op === "update")).toHaveLength(0);
    expect(state.outcome).toMatch(/no counter and no timeout/);
    expect(statuses(state)["report.compare"]).toBe("skipped");
  });
});

describe("scanning on fewer sources", () => {
  it("one failing source is logged and the scan goes on", () => {
    const { state } = execute({ faults: ["source-down"] });
    expect(state.steps["scan.discover"].output).toMatchObject({ sources_used: 2, skipped: ["boosted profiles C: request failed (ignored)"] });
    expect(state.status).toBe("success");
  });

  it("a source whose quota is gone is skipped while its circuit is open", () => {
    const { state } = execute({ faults: ["quota-exhausted"] });
    expect(state.steps["scan.discover"].output).toMatchObject({ sources_used: 2 });
    expect(logs(state)).toMatch(/Its circuit opened/);
  });
});

describe("the person's decision", () => {
  it("is asked with the evaluator's verdict in front of them", () => {
    const { session, state } = execute({ answers: [] });
    expect(session.isWaiting).toBe(true);
    const waiting = state.steps["owner.decide"].waiting!;
    expect(waiting.prompt).toMatch(/did 7\.92 points better\. The evaluator says: Not yet\. Failing: enough paired trades: 24 of at least 30\./);
    expect(waiting.choices.map((choice) => choice.id)).toEqual(["keep", "adopt", "retire"]);
  });

  it("adopting against the evaluator is recorded as the mistake it is", () => {
    const { state } = execute({ answers: ["adopt"] });
    expect(state.status).toBe("failed");
    expect(state.steps["owner.decide"].output).toEqual({ decision: "adopted", against_the_evaluator: true });
    expect(state.outcome).toMatch(/one good trade is not evidence/);
  });

  it("retiring keeps the record", () => {
    const { state } = execute({ answers: ["retire"] });
    expect(state.status).toBe("success");
    expect(state.outcome).toMatch(/a rejected hypothesis is a result too/);
  });
});

describe("every fault", () => {
  it.each(SOLANA_FAULTS.map((fault) => [fault] as const))("%s ends in a finished run", (fault) => {
    const { session, state } = execute({ faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(PRICE_PATHS.flatMap((path) => SOLANA_FAULTS.map((fault) => [path, fault] as const)))("%s with %s is consistent", (path, fault) => {
    const { session, state } = execute({ input: { path }, faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
  });
});

describe("what the demo must not contain", () => {
  it("uses an invented token and never a credential", () => {
    const { events } = execute();
    const text = JSON.stringify(events);
    expect(DEMO_TOKEN.address).toMatch(/^DemoToken1+$/);
    expect(text).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{43,44}(?<!1{20})/);
    expect(text).not.toMatch(/api[-_]?key=[A-Za-z0-9]/i);
  });

  it("states its thresholds as invented settings, in one place", () => {
    expect(DEMO_SETTINGS.exits.partialFraction).toBe(0.5);
    expect(Object.keys(DEMO_SETTINGS)).toEqual(["scanner", "signalDedupeMinutes", "bands", "risk", "guards", "monitor", "exits", "evidence"]);
  });
});

describe("input validation", () => {
  it("accepts the defaults and every preset", () => {
    for (const item of SOLANA_PRESETS) expect(validateSolanaInput(item.input)).toMatchObject({ ok: true, errors: {} });
  });

  it("reports each field that is out of range and falls back to the defaults", () => {
    const result = validateSolanaInput({ path: "moon", liquidityUsd: -1, spike: 900, roundTripCostPct: "abc" as unknown as number });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["liquidityUsd", "path", "roundTripCostPct", "spike"]);
    expect(result.value.path).toBe("runner");
  });
});
