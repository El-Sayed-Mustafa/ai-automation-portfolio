import { describe, expect, test } from "vitest";
import {
  CONTROL,
  DEMO_SETTINGS,
  GATE_ORDER,
  NO_PARTIAL,
  closePaperTrade,
  decideExit,
  evaluateCandidate,
  evaluateToken,
  evaluateTrade,
  executionBand,
  familyPnlPct,
  isBadPriceTick,
  pairedBootstrap,
  perStrategyGuards,
  poolSwitched,
  realOrderRefusal,
  recentOpportunityExists,
  roundTripCostPct,
  seededRandom,
  universalExit,
  type Gate,
  type PaperTrade,
  type PositionState,
  type TokenSnapshot,
} from "./rules";

const good: TokenSnapshot = {
  symbol: "DEMO",
  address: "addr",
  pairAddress: "pool",
  isMajor: false,
  impersonatesMajor: false,
  price: 0.0004,
  liquidityUsd: 48_000,
  volume5mUsd: 6_400,
  observedMinutes: 24,
  spike: 4.2,
  change5mPct: 3.4,
  sellRoute: true,
  holdersKnown: true,
};

describe("scanner gates", () => {
  test("a token that passes every gate is an opportunity", () => {
    expect(evaluateToken(good)).toMatchObject({ verdict: "opportunity", rejectedGate: null });
  });

  const cases: [Gate, Partial<TokenSnapshot>][] = [
    ["stable_major", { isMajor: true }],
    ["impersonation", { impersonatesMajor: true }],
    ["missing_data", { price: null }],
    ["liquidity", { liquidityUsd: 9_000 }],
    ["volume_dust", { volume5mUsd: 50 }],
    ["observation", { observedMinutes: 2 }],
    ["no_spike", { spike: 1.4 }],
    ["momentum", { change5mPct: 0.1 }],
    ["momentum", { change5mPct: 30 }],
    ["not_swappable", { sellRoute: false }],
    ["low_confidence", { holdersKnown: false, observedMinutes: 6, liquidityUsd: 70_000 }],
  ];

  test.each(cases)("rejects at %s and names the gate", (gate, change) => {
    expect(evaluateToken({ ...good, ...change })).toMatchObject({ verdict: "rejected", rejectedGate: gate });
  });

  test("the risk ceiling rejects a thin, vertical token", () => {
    const risky = { ...good, liquidityUsd: 25_000, change5mPct: 9, spike: 9 };
    expect(evaluateToken(risky)).toMatchObject({ verdict: "rejected", rejectedGate: "risk" });
  });

  test("the first failing gate is the one recorded", () => {
    // Everything is wrong with this token; the earliest gate in the order wins.
    const hopeless = { ...good, isMajor: true, price: null, liquidityUsd: 1, sellRoute: false, spike: 0 };
    expect(evaluateToken(hopeless).rejectedGate).toBe(GATE_ORDER[0]);
    expect(evaluateToken({ ...hopeless, isMajor: false }).rejectedGate).toBe("missing_data");
  });

  test("a signal for the same token is not raised twice inside the window", () => {
    const seen = [{ address: "addr", atMinute: 0 }];
    expect(recentOpportunityExists(seen, "addr", 12)).toBe(true);
    expect(recentOpportunityExists(seen, "addr", DEMO_SETTINGS.signalDedupeMinutes)).toBe(false);
    expect(recentOpportunityExists(seen, "other", 12)).toBe(false);
  });
});

describe("entry", () => {
  test("the cost of a round trip comes from the two quotes", () => {
    expect(roundTripCostPct(1, 0.988)).toBeCloseTo(1.2);
    expect(roundTripCostPct(1, null)).toBeNull();
  });

  test("cost sorts a trade into a band, and an unknown cost is the worst band", () => {
    expect(executionBand(1.2)).toBe("A");
    expect(executionBand(2.2)).toBe("B");
    expect(executionBand(3.6)).toBe("C");
    expect(executionBand(null)).toBe("C");
  });

  test("the risk manager approves a sound trade and sizes it by the smaller of two limits", () => {
    const decision = evaluateTrade({ price: 1, liquidityUsd: 48_000, riskScore: 30, hasQuote: true, priceImpactPct: 0.6, walletBalanceSol: 0.5 });
    expect(decision).toEqual({ approved: true, reason: "approved", sizeSol: 0.025 });
    expect(evaluateTrade({ price: 1, liquidityUsd: 48_000, riskScore: 30, hasQuote: true, priceImpactPct: 0.6, walletBalanceSol: 50 }).sizeSol).toBe(DEMO_SETTINGS.risk.maxTradeSol);
  });

  test.each([
    [{ price: null }, "no valid price"],
    [{ liquidityUsd: 100 }, "liquidity is under the floor"],
    [{ riskScore: 90 }, "risk score is over the ceiling"],
    [{ hasQuote: false }, "no quote"],
    [{ priceImpactPct: 9 }, "price impact 9.0% is over the limit"],
    [{ walletBalanceSol: 0 }, "position size is zero"],
  ])("refuses %j with a reason", (change, reason) => {
    const base = { price: 1, liquidityUsd: 48_000, riskScore: 30, hasQuote: true, priceImpactPct: 0.6, walletBalanceSol: 0.5 };
    expect(evaluateTrade({ ...base, ...change })).toMatchObject({ approved: false, reason, sizeSol: 0 });
  });

  test("a guard on one strategy does not block another on the same token", () => {
    const trades: PaperTrade[] = [{ id: 1, strategy: "control", address: "addr", status: "open", openedAtMinute: 0, closedAtMinute: null }];
    expect(perStrategyGuards(trades, "addr", "control", 5)).toBe("already holding (this strategy)");
    expect(perStrategyGuards(trades, "addr", "shadow", 5)).toBeNull();
  });

  test("a full strategy and a recent trade are both refused", () => {
    const full: PaperTrade[] = Array.from({ length: DEMO_SETTINGS.guards.maxOpenPositions }, (_, index) => ({ id: index, strategy: "control", address: `t${index}`, status: "open", openedAtMinute: 0, closedAtMinute: null }));
    expect(perStrategyGuards(full, "addr", "control", 5)).toBe("position cap (this strategy)");
    const recent: PaperTrade[] = [{ id: 1, strategy: "control", address: "addr", status: "closed_sl", openedAtMinute: 0, closedAtMinute: 4 }];
    expect(perStrategyGuards(recent, "addr", "control", 10)).toBe("cooldown (this strategy)");
    expect(perStrategyGuards(recent, "addr", "control", DEMO_SETTINGS.guards.cooldownMinutes)).toBeNull();
  });
});

describe("real-money switches", () => {
  const on = { riskApproved: true, dryRun: false, tradingEnabled: true, walletKeySet: true };

  test("the defaults refuse a real order", () => {
    expect(realOrderRefusal({ riskApproved: true, dryRun: true, tradingEnabled: false, walletKeySet: false })).toMatch(/DRY_RUN is on/);
  });

  test("each switch refuses on its own, in order", () => {
    expect(realOrderRefusal({ ...on, riskApproved: false })).toMatch(/risk manager/);
    expect(realOrderRefusal({ ...on, dryRun: true })).toMatch(/DRY_RUN/);
    expect(realOrderRefusal({ ...on, tradingEnabled: false })).toMatch(/TRADING_ENABLED/);
    expect(realOrderRefusal({ ...on, walletKeySet: false })).toMatch(/wallet key/);
    expect(realOrderRefusal(on)).toBeNull();
  });
});

describe("monitor guards", () => {
  test("a collapse in price with healthy liquidity is a bad read", () => {
    expect(isBadPriceTick(0.04, 48_000, 1, 80, 20_000)).toBe(true);
    expect(isBadPriceTick(0.04, null, 1, 80, 20_000)).toBe(true);
  });

  test("the same collapse with the pool drained is real, and goes to the liquidity exits instead", () => {
    expect(isBadPriceTick(0.04, 900, 1, 80, 20_000)).toBe(false);
    expect(universalExit(900)).toBe("closed_rug");
  });

  test("an ordinary fall is not a bad tick, a non-positive price always is, and a missing one is handled elsewhere", () => {
    expect(isBadPriceTick(0.7, 48_000, 1, 80, 20_000)).toBe(false);
    expect(isBadPriceTick(0, 48_000, 1, 80, 20_000)).toBe(true);
    expect(isBadPriceTick(null, 48_000, 1, 80, 20_000)).toBe(false);
  });

  test("a tick from another pool is recognised", () => {
    expect(poolSwitched("a", "b")).toBe(true);
    expect(poolSwitched("a", "a")).toBe(false);
    expect(poolSwitched(null, "b")).toBe(false);
  });

  test("liquidity exits apply to every strategy", () => {
    expect(universalExit(48_000)).toBeNull();
    expect(universalExit(9_999)).toBe("closed_liq_exit");
    expect(universalExit(null)).toBeNull();
  });

  test("a trade is closed once, and the caller is told whether it was the one", () => {
    const trade: PaperTrade = { id: 1, strategy: "control", address: "addr", status: "open", openedAtMinute: 0, closedAtMinute: null };
    expect(closePaperTrade(trade, "closed_trail", 12)).toBe(true);
    expect(closePaperTrade(trade, "closed_rug", 13)).toBe(false);
    expect(trade).toMatchObject({ status: "closed_trail", closedAtMinute: 12 });
  });
});

describe("exit ladder", () => {
  const flat: PositionState = { ageMin: 5, pnlPct: 0, peakPnlPct: 0, partialTaken: false, liquidityUsd: 48_000, peakLiquidityUsd: 48_000 };

  test("holds while nothing matches", () => {
    expect(decideExit(flat, CONTROL)).toEqual({ action: "hold" });
  });

  test("the control takes half off at the target, once; the shadow never does", () => {
    const up = { ...flat, pnlPct: 27, peakPnlPct: 27 };
    expect(decideExit(up, CONTROL)).toMatchObject({ action: "partial", fraction: 0.5 });
    expect(decideExit({ ...up, partialTaken: true }, CONTROL)).toEqual({ action: "hold" });
    expect(decideExit(up, NO_PARTIAL)).toEqual({ action: "hold" });
  });

  test("once armed, the stop is the higher of the trail and the lock", () => {
    // Peak +10: trail at +2, lock at +6. The lock is higher.
    expect(decideExit({ ...flat, pnlPct: 6.5, peakPnlPct: 10 }, NO_PARTIAL)).toEqual({ action: "hold" });
    expect(decideExit({ ...flat, pnlPct: 6, peakPnlPct: 10 }, NO_PARTIAL)).toMatchObject({ action: "close", status: "closed_trail" });
    // Peak +50: trail at +42, lock at +30. The trail is higher.
    expect(decideExit({ ...flat, pnlPct: 43, peakPnlPct: 50 }, NO_PARTIAL)).toEqual({ action: "hold" });
    expect(decideExit({ ...flat, pnlPct: 42, peakPnlPct: 50 }, NO_PARTIAL)).toMatchObject({ action: "close", status: "closed_trail" });
  });

  test("an unarmed position stops out; an armed one is managed by its trail instead", () => {
    expect(decideExit({ ...flat, pnlPct: -12 }, CONTROL)).toMatchObject({ action: "close", status: "closed_sl" });
    expect(decideExit({ ...flat, pnlPct: -11.9 }, CONTROL)).toEqual({ action: "hold" });
  });

  test("time gates: harvest, loss cut and the maximum hold", () => {
    expect(decideExit({ ...flat, ageMin: 15, pnlPct: 5.5, peakPnlPct: 5.5 }, CONTROL)).toMatchObject({ status: "closed_harvest" });
    expect(decideExit({ ...flat, ageMin: 14, pnlPct: 5.5, peakPnlPct: 5.5 }, CONTROL)).toEqual({ action: "hold" });
    expect(decideExit({ ...flat, ageMin: 15, pnlPct: -9 }, CONTROL)).toMatchObject({ status: "closed_loss_cut" });
    expect(decideExit({ ...flat, ageMin: 45, pnlPct: 1 }, CONTROL)).toMatchObject({ status: "closed_max_hold" });
    expect(decideExit({ ...flat, ageMin: 60, pnlPct: 30, peakPnlPct: 31 }, NO_PARTIAL)).toMatchObject({ status: "closed_max_hold" });
  });

  test("liquidity leaving the pool closes the position before any price rule", () => {
    expect(decideExit({ ...flat, pnlPct: 3, liquidityUsd: 30_000 }, CONTROL)).toMatchObject({ status: "closed_liq_drop" });
  });

  test("a partial exit and its remainder count as one trade, weighted by size", () => {
    expect(familyPnlPct([{ fraction: 0.5, pnlPct: 27 }, { fraction: 0.5, pnlPct: 18 }])).toBe(22.5);
    expect(familyPnlPct([{ fraction: 1, pnlPct: -9 }])).toBe(-9);
    expect(familyPnlPct([])).toBe(0);
  });
});

describe("evidence", () => {
  const strong = Array.from({ length: 40 }, (_, index) => ({ control: (index % 5) * 2 - 2, candidate: (index % 5) * 2 - 2 + 1.5 + (index % 3) * 0.5 }));

  test("the generator is deterministic", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(a()).toBeGreaterThanOrEqual(0);
    expect(a()).toBeLessThan(1);
  });

  test("a consistent edge wins nearly every resample; no edge wins about half", () => {
    expect(pairedBootstrap(Array(30).fill(1.5), 500, seededRandom(1))).toBe(1);
    const mixed = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 2 : -2));
    const share = pairedBootstrap(mixed, 2000, seededRandom(1));
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
    expect(pairedBootstrap([], 100, seededRandom(1))).toBe(0);
  });

  test("a candidate with a steady edge on a large enough sample is promoted", () => {
    const report = evaluateCandidate(strong);
    expect(report.checks.map((check) => [check.id, check.passed])).toEqual([
      ["sample", true],
      ["edge", true],
      ["halves", true],
      ["tail", true],
      ["bootstrap", true],
      ["winners", true],
    ]);
    expect(report.promote).toBe(true);
  });

  test("the same edge on too few trades is not", () => {
    const report = evaluateCandidate(strong.slice(0, 12));
    expect(report.promote).toBe(false);
    expect(report.checks.find((check) => check.id === "sample")).toMatchObject({ passed: false, detail: "12 of at least 30" });
  });

  test("an edge that comes from three lucky trades fails the tail check", () => {
    const lucky = Array.from({ length: 36 }, (_, index) => ({ control: 1, candidate: index < 3 ? 60 : 0.8 }));
    const report = evaluateCandidate(lucky);
    expect(report.checks.find((check) => check.id === "edge")?.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "tail")?.passed).toBe(false);
    expect(report.promote).toBe(false);
  });

  test("an edge that exists in only one half of the period fails", () => {
    const fading = Array.from({ length: 36 }, (_, index) => ({ control: 1, candidate: index < 18 ? 5 : 0.5 }));
    expect(evaluateCandidate(fading).checks.find((check) => check.id === "halves")?.passed).toBe(false);
  });

  test("a candidate that wins on average by giving up the big winners fails", () => {
    const flattened = Array.from({ length: 36 }, (_, index) => (index % 6 === 0 ? { control: 30, candidate: 12 } : { control: -4, candidate: 2 }));
    const report = evaluateCandidate(flattened);
    expect(report.checks.find((check) => check.id === "edge")?.passed).toBe(true);
    expect(report.checks.find((check) => check.id === "winners")).toMatchObject({ passed: false, detail: "0 against 6" });
  });
});
