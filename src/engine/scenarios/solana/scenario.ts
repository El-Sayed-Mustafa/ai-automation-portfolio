import type { Scenario, ScenarioContext } from "../../session";
import type { Json } from "../../types";
import {
  CONTROL,
  DEMO_SETTINGS,
  NO_PARTIAL,
  closePaperTrade,
  decideExit,
  evaluateCandidate,
  evaluateToken,
  evaluateTrade,
  executionBand,
  familyPnlPct,
  isBadPriceTick,
  perStrategyGuards,
  poolSwitched,
  realOrderRefusal,
  recentOpportunityExists,
  roundTripCostPct,
  universalExit,
  type ExitProfile,
  type PairedTrade,
  type PaperTrade,
  type TokenSnapshot,
} from "./rules";

export const SOLANA_SCENARIO_ID = "solana.signal-to-evidence";

export const SOLANA_STEPS = [
  "scan.discover",
  "scan.snapshot",
  "scan.gates",
  "signal.record",
  "entry.quote",
  "risk.check",
  "strategies.open",
  "pilot.guard",
  "monitor.tick",
  "exit.decide",
  "position.close",
  "report.compare",
  "candidate.evaluate",
  "owner.decide",
] as const;

export const SOLANA_FAULTS = [
  "source-down",
  "quota-exhausted",
  "no-sell-route",
  "duplicate-signal",
  "position-cap",
  "bad-tick",
  "pool-switch",
  "rug",
  "double-close",
  "snapshot-missing",
] as const;

export type SolanaFaultId = (typeof SOLANA_FAULTS)[number];

export const PRICE_PATHS = ["runner", "spike and fade", "slow bleed", "chop"] as const;
export type PricePath = (typeof PRICE_PATHS)[number];

export interface SolanaInput {
  path: PricePath;
  liquidityUsd: number;
  /** Five-minute volume as a multiple of the token's own baseline. */
  spike: number;
  /** What a buy followed at once by a sell would lose, in percent. */
  roundTripCostPct: number;
}

export const SOLANA_PRESETS: { id: string; label: string; description: string; input: SolanaInput }[] = [
  {
    id: "runner",
    label: "A runner",
    description: "The price keeps climbing. Letting the full size run beats taking half off early.",
    input: { path: "runner", liquidityUsd: 48_000, spike: 4.2, roundTripCostPct: 1.2 },
  },
  {
    id: "fade",
    label: "Spike and fade",
    description: "The price jumps and gives most of it back. Taking half off at the top looks clever.",
    input: { path: "spike and fade", liquidityUsd: 48_000, spike: 6.1, roundTripCostPct: 1.2 },
  },
  {
    id: "bleed",
    label: "Slow bleed",
    description: "The price drifts down. Both rules cut the loss at the same point.",
    input: { path: "slow bleed", liquidityUsd: 48_000, spike: 3.1, roundTripCostPct: 1.2 },
  },
  {
    id: "chop",
    label: "Chop",
    description: "Nothing happens for 45 minutes and both positions time out.",
    input: { path: "chop", liquidityUsd: 48_000, spike: 2.8, roundTripCostPct: 1.2 },
  },
  {
    id: "thin",
    label: "Thin pool",
    description: "Liquidity is under the floor, so the scanner rejects the token and records why.",
    input: { path: "runner", liquidityUsd: 9_000, spike: 4.2, roundTripCostPct: 1.2 },
  },
  {
    id: "expensive",
    label: "Expensive to trade",
    description: "A round trip costs too much for the shadow strategy, which only observes; the control still trades.",
    input: { path: "runner", liquidityUsd: 48_000, spike: 4.2, roundTripCostPct: 3.6 },
  },
];

export const SOLANA_DEFAULT_INPUT: SolanaInput = SOLANA_PRESETS[0].input;

export function validateSolanaInput(raw: Partial<Record<keyof SolanaInput, unknown>>): {
  ok: boolean;
  value: SolanaInput;
  errors: Partial<Record<keyof SolanaInput, string>>;
} {
  const errors: Partial<Record<keyof SolanaInput, string>> = {};
  const number = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN);

  const path = PRICE_PATHS.includes(raw.path as PricePath) ? (raw.path as PricePath) : null;
  if (!path) errors.path = "Choose one of the listed price paths.";
  const liquidityUsd = number(raw.liquidityUsd);
  if (!Number.isFinite(liquidityUsd) || liquidityUsd < 0 || liquidityUsd > 5_000_000) errors.liquidityUsd = "Use a number from 0 to 5,000,000.";
  const spike = number(raw.spike);
  if (!Number.isFinite(spike) || spike < 0 || spike > 50) errors.spike = "Use a number from 0 to 50.";
  const cost = number(raw.roundTripCostPct);
  if (!Number.isFinite(cost) || cost < 0 || cost > 20) errors.roundTripCostPct = "Use a number from 0 to 20.";

  return {
    ok: Object.keys(errors).length === 0,
    value: {
      path: path ?? SOLANA_DEFAULT_INPUT.path,
      liquidityUsd: Number.isFinite(liquidityUsd) ? Math.round(liquidityUsd) : SOLANA_DEFAULT_INPUT.liquidityUsd,
      spike: Number.isFinite(spike) ? Math.round(spike * 10) / 10 : SOLANA_DEFAULT_INPUT.spike,
      roundTripCostPct: Number.isFinite(cost) ? Math.round(cost * 100) / 100 : SOLANA_DEFAULT_INPUT.roundTripCostPct,
    },
    errors,
  };
}

// -- Invented world ----------------------------------------------------------

/** An invented token. The address is not a valid one. */
export const DEMO_TOKEN = { symbol: "DEMO", address: "DemoToken1111111111111111111111111111111111", pair: "DemoPool11111111111111111111111111111111111" } as const;
const OTHER_POOL = "OtherPool1111111111111111111111111111111111";
const ENTRY_PRICE = 0.000412;
const WALLET_SOL = 0.5;

/** Profit and loss in percent at given minutes after entry; the path between them is a straight line. */
const PATH_POINTS: Record<PricePath, [minute: number, pnl: number][]> = {
  runner: [[0, 0], [5, 8], [12, 27], [25, 44], [30, 38], [40, 52], [46, 41], [60, 33]],
  "spike and fade": [[0, 0], [6, 27], [10, 9], [20, 2], [30, -3], [60, -6]],
  "slow bleed": [[0, 0], [8, -3], [15, -6], [22, -10], [30, -13], [60, -15]],
  chop: [[0, 0], [7, 2], [14, -2], [21, 1.5], [28, -1], [35, 2], [45, 1], [60, 0]],
};

function pnlAt(path: PricePath, minute: number): number {
  const points = PATH_POINTS[path];
  for (let index = 1; index < points.length; index += 1) {
    const [m0, p0] = points[index - 1];
    const [m1, p1] = points[index];
    if (minute <= m1) return Math.round((p0 + ((p1 - p0) * (minute - m0)) / (m1 - m0)) * 100) / 100;
  }
  return points.at(-1)![1];
}

/**
 * Earlier paired results, invented, as net percent per trade for the control
 * and for the candidate on the same signal. The run adds its own pair.
 */
const PRIOR_PAIRS: PairedTrade[] = [
  [6.2, 9.1], [-8.4, -8.4], [14.0, 21.5], [2.1, 1.0], [-9.0, -9.0], [22.4, 31.0], [3.3, 5.2], [-6.5, -7.1],
  [9.8, 12.4], [1.2, 1.2], [18.0, 26.3], [-9.0, -9.0], [4.4, 3.1], [7.7, 11.0], [-3.2, -3.2], [25.1, 29.8],
  [0.8, 2.2], [-9.0, -8.2], [11.5, 16.9], [5.0, 4.1], [-7.3, -7.3], [16.2, 23.0], [2.9, 4.8],
].map(([control, candidate]) => ({ control, candidate }));

const MINUTE = 60_000;
const LATENCY = { source: 400, snapshot: 300, gates: 250, write: 40, quote: 350, risk: 20, tick: 200, report: 300, evaluate: 500 } as const;

function snap<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

interface Leg {
  fraction: number;
  pnlPct: number;
  status: string;
  minute: number;
}

interface Held {
  profile: ExitProfile;
  trade: PaperTrade;
  peakPnl: number;
  minPnl: number;
  partialTaken: boolean;
  legs: Leg[];
  samples: number;
}

function* run({ input, faults, t }: ScenarioContext<SolanaInput>): Generator<void, void, string> {
  const settings = DEMO_SETTINGS;
  const trades: PaperTrade[] = [];
  const opportunities: { address: string; atMinute: number }[] = [];

  // -- 1. Discover -------------------------------------------------------------
  t.start("scan.discover", { sources: ["trending list A", "trending pools B", "boosted profiles C"], cycle: "one scan" });
  const sourceErrors: string[] = [];
  if (faults.has("quota-exhausted")) {
    sourceErrors.push("trending list A: skipped, its quota circuit is open");
    t.log("warn", "Source A answered that its monthly quota is used up. Its circuit opened: every call to it is a no-op until the cooldown ends, and the log says so once.");
  }
  if (faults.has("source-down")) {
    sourceErrors.push("boosted profiles C: request failed (ignored)");
    t.log("error", "Source C failed. Discovery must never break the scan, so the error is logged and the other sources are used.");
  }
  t.advance(LATENCY.source * (3 - sourceErrors.length));
  const candidates = 41 - sourceErrors.length * 12;
  t.log("info", `${candidates} candidate tokens after removing duplicates. This run follows one of them.`);
  t.ok({ candidates, sources_used: 3 - sourceErrors.length, skipped: sourceErrors }, sourceErrors.length > 0 ? "The scan ran on fewer sources than usual." : undefined);

  // -- 2. Snapshot -------------------------------------------------------------
  const snapshot: TokenSnapshot = {
    symbol: DEMO_TOKEN.symbol,
    address: DEMO_TOKEN.address,
    pairAddress: DEMO_TOKEN.pair,
    isMajor: false,
    impersonatesMajor: false,
    price: ENTRY_PRICE,
    liquidityUsd: input.liquidityUsd,
    volume5mUsd: 6_400,
    observedMinutes: 24,
    spike: input.spike,
    change5mPct: 3.4,
    sellRoute: !faults.has("no-sell-route"),
    holdersKnown: true,
  };
  t.start("scan.snapshot", { request: "batched market snapshots", tokens: candidates, batch_size: 30 });
  t.advance(LATENCY.snapshot);
  t.log("info", "When a token trades in several pools, the one with the deepest liquidity is kept. A snapshot without a price or liquidity is discarded.");
  t.ok(snap({ symbol: snapshot.symbol, price: snapshot.price, liquidity_usd: snapshot.liquidityUsd, volume_5m_usd: snapshot.volume5mUsd, change_5m_pct: snapshot.change5mPct, pool: "deepest of 2" }));

  // -- 3. Gates ----------------------------------------------------------------
  t.start("scan.gates", snap({ symbol: snapshot.symbol, spike: snapshot.spike, observed_minutes: snapshot.observedMinutes, sell_route_probe: "buy quote and sell quote" }));
  t.advance(LATENCY.gates);
  const evaluation = evaluateToken(snapshot);
  t.change("scan_evaluations", "insert", `${snapshot.symbol}@scan-1`, null, snap(evaluation));
  t.log("info", "Every token's verdict is stored, rejected or not, with the gate that stopped it. That table is the funnel the research reads.");
  if (evaluation.verdict === "rejected") {
    t.log("warn", `Rejected at "${evaluation.rejectedGate}": ${evaluation.reason}.`);
    t.ok(snap(evaluation));
    t.skipRemaining("The scanner rejected the token, so no signal was raised.");
    t.finish("success", `No trade: the scanner rejected the token at the "${evaluation.rejectedGate}" gate (${evaluation.reason}). The verdict is recorded, so the rejection is data too.`, {
      verdict: "rejected",
      gate: evaluation.rejectedGate,
    });
    return;
  }
  t.ok(snap(evaluation));

  // -- 4. Signal ---------------------------------------------------------------
  if (faults.has("duplicate-signal")) opportunities.push({ address: snapshot.address, atMinute: -12 });
  t.start("signal.record", { token: snapshot.symbol, dedupe_window_minutes: settings.signalDedupeMinutes });
  t.advance(LATENCY.write);
  if (recentOpportunityExists(opportunities, snapshot.address, 0)) {
    t.log("info", "This token was already signalled 12 minutes ago. It is not signalled again inside the window.");
    t.ok({ recorded: false, reason: "signalled recently" });
    t.skipRemaining("The signal was a duplicate, so nothing downstream ran.");
    t.finish("success", "No trade: the same token was signalled 12 minutes earlier, and a signal is raised once per window. Nothing was opened twice.", { verdict: "duplicate" });
    return;
  }
  opportunities.push({ address: snapshot.address, atMinute: 0 });
  t.change("opportunities", "insert", `${snapshot.symbol}#1`, null, snap({ token: snapshot.symbol, reason: evaluation.reason, risk_score: evaluation.riskScore, entry_snapshot: `${snapshot.symbol}@scan-1` }));
  t.ok({ recorded: true, opportunity: `${snapshot.symbol}#1` });

  // -- 5. Entry context --------------------------------------------------------
  const sizeProbe = Math.min(settings.risk.maxTradeSol, (WALLET_SOL * settings.risk.maxWalletPct) / 100);
  const cost = roundTripCostPct(sizeProbe, sizeProbe * (1 - input.roundTripCostPct / 100));
  const band = executionBand(cost);
  t.start("entry.quote", { buy: `${sizeProbe} SOL for ${snapshot.symbol}`, return_leg: "the exact token amount the buy would receive, back to SOL" });
  t.advance(LATENCY.quote * 2);
  t.log("info", "The cost of a trade is measured, not assumed: the sell is quoted for exactly what the buy would deliver.");
  t.ok({ round_trip_cost_pct: cost === null ? null : round(cost), execution_band: band, bands: "A cheap, B acceptable, C observation only" });

  // -- 6. Risk -----------------------------------------------------------------
  const decision = evaluateTrade({ price: snapshot.price, liquidityUsd: snapshot.liquidityUsd, riskScore: evaluation.riskScore, hasQuote: true, priceImpactPct: round(input.roundTripCostPct / 2), walletBalanceSol: WALLET_SOL });
  t.start("risk.check", { risk_score: evaluation.riskScore, price_impact_pct: round(input.roundTripCostPct / 2), wallet_sol: WALLET_SOL });
  t.advance(LATENCY.risk);
  if (!decision.approved) {
    t.change("entry_rejections", "insert", `${snapshot.symbol}#1/risk`, null, snap({ gate: "risk", reason: decision.reason }));
    t.log("warn", `Refused: ${decision.reason}. The refusal is stored with its reason.`);
    t.ok(snap(decision));
    t.skipRemaining("The risk manager refused the trade for every strategy.");
    t.finish("success", `No trade: the risk manager refused it (${decision.reason}). One refusal stops every strategy, and it is recorded.`, { verdict: "risk", reason: decision.reason });
    return;
  }
  t.ok(snap(decision));

  // -- 7. Strategies open ------------------------------------------------------
  if (faults.has("position-cap")) {
    for (let index = 0; index < settings.guards.maxOpenPositions; index += 1) {
      trades.push({ id: 400 + index, strategy: CONTROL.name, address: `OtherToken${index}`, status: "open", openedAtMinute: -30, closedAtMinute: null });
    }
  }
  t.start("strategies.open", { strategies: [CONTROL.name, NO_PARTIAL.name], signal: `${snapshot.symbol}#1`, size_sol: decision.sizeSol });
  const held: Held[] = [];
  for (const profile of [CONTROL, NO_PARTIAL]) {
    const guard = perStrategyGuards(trades, snapshot.address, profile.name, 0);
    const bandRefusal = profile === NO_PARTIAL && band === "C" ? "execution band C is observation only for this strategy" : null;
    const refusal = guard ?? bandRefusal;
    if (refusal) {
      t.change("entry_rejections", "insert", `${snapshot.symbol}#1/${profile.name}`, null, snap({ strategy: profile.name, gate: guard ? "guard" : "execution_cost", reason: refusal }));
      t.log("warn", `${profile.name}: not opened (${refusal}).`);
      continue;
    }
    const trade: PaperTrade = { id: 500 + held.length + 1, strategy: profile.name, address: snapshot.address, status: "open", openedAtMinute: 0, closedAtMinute: null };
    trades.push(trade);
    held.push({ profile, trade, peakPnl: 0, minPnl: 0, partialTaken: false, legs: [], samples: 0 });
    t.change("paper_trades", "insert", String(trade.id), null, snap({ id: trade.id, strategy: profile.name, token: snapshot.symbol, pool: "locked at entry", entry_price: ENTRY_PRICE, size_sol: decision.sizeSol, execution_band: band, status: "open" }));
    t.advance(LATENCY.write);
  }
  t.log("info", "Guards are scoped to one strategy, so a strategy that is full or cooling down does not stop another from taking the same signal.");
  if (held.length === 0) {
    t.ok({ opened: [] });
    t.skipRemaining("No strategy opened a position.");
    t.finish("success", "No trade: every strategy's own guard refused the signal, and each refusal is recorded with its reason.", { verdict: "guards" });
    return;
  }
  t.ok({ opened: held.map((item) => `${item.profile.name} (trade ${item.trade.id})`), paper: true });

  // -- 8. Real-money switches ----------------------------------------------------
  const refusal = realOrderRefusal({ riskApproved: true, dryRun: true, tradingEnabled: false, walletKeySet: false });
  t.start("pilot.guard", { DRY_RUN: true, TRADING_ENABLED: false, wallet_key: "not set" });
  t.advance(LATENCY.risk);
  t.log("info", "Paper is the default. A real order has to pass each switch in turn, and this simulation never does.");
  t.ok({ real_order: false, refused_because: refusal });

  // -- 9-11. Hold, decide, close ------------------------------------------------
  const lockedPair = snapshot.pairAddress;
  const notes: string[] = [];
  let lastMinute = 0;
  let stranded = false;
  t.start("monitor.tick", { positions: held.length, fetch: "one batched request for every open position", check_every: "about a minute in this replay" });
  const exits: { item: Held; status: string; reason: string; minute: number; pnl: number }[] = [];
  for (let minute = 1; minute <= 75 && held.some((item) => item.trade.status === "open"); minute += 1) {
    lastMinute = minute;
    t.advance(MINUTE);
    if (faults.has("snapshot-missing") && minute >= 9) {
      if (minute === 9) {
        t.log("error", "No snapshot came back for the token. The loop skips a position without a snapshot and tries again next cycle.");
        notes.push("no snapshot from minute 9 onwards");
      }
      if (minute === 75) stranded = true;
      continue;
    }
    let pnl = pnlAt(input.path, minute);
    let liquidity = input.liquidityUsd;
    let pair: string = lockedPair;
    if (faults.has("pool-switch") && minute === 4) pair = OTHER_POOL;
    if (poolSwitched(lockedPair, pair)) {
      t.log("warn", `Minute ${minute}: the price came from a different pool than the one locked at entry. The tick is ignored.`);
      notes.push("one tick from another pool ignored");
      continue;
    }
    if (faults.has("bad-tick") && minute === 7) pnl = -96;
    if (faults.has("rug") && minute >= 11) {
      liquidity = 900;
      pnl = -88;
    }
    for (const item of held.filter((entry) => entry.trade.status === "open")) {
      const reference = ENTRY_PRICE * (1 + Math.max(0, item.peakPnl) / 100);
      const price = ENTRY_PRICE * (1 + pnl / 100);
      if (isBadPriceTick(price, liquidity, reference, settings.monitor.badTickDropPct, settings.scanner.minLiquidityUsd)) {
        if (item === held[0]) {
          t.log("warn", `Minute ${minute}: a price ${Math.abs(pnl)}% under the reference while liquidity is healthy. A real crash drains the pool, so this is a bad read and it is ignored.`);
          notes.push("one implausible tick ignored");
        }
        continue;
      }
      item.samples += 1;
      item.peakPnl = Math.max(item.peakPnl, pnl);
      item.minPnl = Math.min(item.minPnl, pnl);
      const universal = universalExit(liquidity);
      if (universal) {
        exits.push({ item, status: universal, reason: universal === "closed_rug" ? "liquidity was pulled" : "liquidity collapsed", minute, pnl: universal === "closed_rug" ? -99 : pnl });
        item.trade.status = "closing";
        continue;
      }
      const exit = decideExit({ ageMin: minute, pnlPct: pnl, peakPnlPct: item.peakPnl, partialTaken: item.partialTaken, liquidityUsd: liquidity, peakLiquidityUsd: input.liquidityUsd }, item.profile);
      if (exit.action === "partial") {
        item.partialTaken = true;
        item.legs.push({ fraction: exit.fraction, pnlPct: pnl, status: "closed_partial", minute });
        t.log("info", `Minute ${minute}: ${item.profile.name} sold half at +${pnl}% (${exit.reason}).`);
      } else if (exit.action === "close") {
        exits.push({ item, status: exit.status, reason: exit.reason, minute, pnl });
        item.trade.status = "closing";
      }
    }
  }
  for (const item of held) {
    t.change("position_samples", "insert", `trade ${item.trade.id}`, null, snap({ samples: item.samples, peak_pnl_pct: item.peakPnl, lowest_pnl_pct: item.minPnl, note: "one row per check in the real system" }));
  }
  t.log("info", "The market state behind every decision is stored, so an exit can be replayed later against a different rule.");

  if (stranded) {
    t.fail("NO_SNAPSHOT", "The position is still open after 75 minutes. Time-based exits cannot fire for a position that is skipped every cycle, and nothing counts the skips.");
    t.skipRemaining("The positions never closed, so there is nothing to compare.");
    t.finish(
      "failed",
      `Both positions are still open after ${lastMinute} minutes. A held token that stops returning a snapshot is skipped each cycle with no counter and no timeout, so the maximum-hold exit never runs. This is a real gap in the code, shown as it is.`,
      { open_positions: held.length, minutes: lastMinute },
    );
    return;
  }
  t.ok({ minutes_held: lastMinute, guards: notes.length > 0 ? notes : ["nothing ignored"] }, notes.length > 0 ? "A tick was ignored instead of being booked as an exit." : undefined);

  t.start("exit.decide", { rule: "first matching rule wins", ladder: ["partial take", "liquidity drawdown", "trail once armed", "stop while unarmed", "harvest", "loss cut", "maximum hold"] });
  for (const exit of exits) t.log("info", `${exit.item.profile.name}: ${exit.status} at minute ${exit.minute} (${exit.reason}).`);
  t.ok(snap({ exits: exits.map((exit) => ({ strategy: exit.item.profile.name, status: exit.status, minute: exit.minute, pnl_pct: exit.pnl })) }));

  t.start("position.close", { statement: "UPDATE paper_trades SET ... WHERE id = ? AND status = 'open'", closes: exits.length });
  for (const exit of exits) {
    const { item } = exit;
    item.trade.status = "open";
    const closed = closePaperTrade(item.trade, exit.status, exit.minute);
    const remaining = 1 - item.legs.reduce((sum, leg) => sum + leg.fraction, 0);
    item.legs.push({ fraction: remaining, pnlPct: exit.pnl, status: exit.status, minute: exit.minute });
    t.change("paper_trades", "update", String(item.trade.id), snap({ status: "open" }), snap({ status: exit.status, exit_pnl_pct: exit.pnl, closed_at_minute: exit.minute, mfe_pct: item.peakPnl, mae_pct: item.minPnl, closed_by_this_call: closed }));
    if (faults.has("double-close") && item === exits[0].item) {
      const second = closePaperTrade(item.trade, exit.status, exit.minute);
      t.log("warn", `A second closer (the dashboard's emergency button, say) tried to close trade ${item.trade.id} in the same moment. Its update matched ${second ? 1 : 0} rows, so nothing was closed or reported twice.`);
    }
    t.advance(LATENCY.write);
  }
  t.ok({ closed: exits.map((exit) => exit.item.trade.id), each_closed_once: true });

  // -- 12. Compare ---------------------------------------------------------------
  // A position cannot lose more than it holds, whatever the costs.
  const result = (item: Held) => Math.max(-100, round(familyPnlPct(item.legs) - (cost ?? 0)));
  const control = held.find((item) => item.profile === CONTROL);
  const candidate = held.find((item) => item.profile === NO_PARTIAL);
  t.start("report.compare", { same_signal: `${snapshot.symbol}#1`, cost_pct: cost === null ? null : round(cost), partial_exits: "weighted into one result per trade" });
  t.advance(LATENCY.report);
  if (!control || !candidate) {
    const only = (control ?? candidate)!;
    t.log("info", `Only ${only.profile.name} traded this signal, so there is no pair to compare.`);
    t.ok({ [only.profile.name]: result(only), pair: null });
    t.skipRemaining("A comparison needs both strategies on the same signal.");
    t.finish("success", `${only.profile.name} closed at ${result(only) >= 0 ? "+" : ""}${result(only)}% after costs (${only.trade.status}). The other strategy did not take the signal, so this trade adds nothing to the comparison between them.`, {
      [only.profile.name]: result(only),
      paired: false,
    });
    return;
  }
  const pair: PairedTrade = { control: result(control), candidate: result(candidate) };
  const edge = round(pair.candidate - pair.control);
  t.log("info", `Same token, same entry, same minute: control ${pair.control >= 0 ? "+" : ""}${pair.control}%, shadow ${pair.candidate >= 0 ? "+" : ""}${pair.candidate}%.`);
  t.ok({ control_net_pct: pair.control, shadow_net_pct: pair.candidate, edge_points: edge });

  // -- 13. Evaluate ---------------------------------------------------------------
  const pairs = [...PRIOR_PAIRS, pair];
  t.start("candidate.evaluate", { prior_pairs: PRIOR_PAIRS.length, this_run: 1, note: "The earlier pairs are invented for this demo." });
  t.advance(LATENCY.evaluate);
  const report = evaluateCandidate(pairs);
  for (const check of report.checks) t.log(check.passed ? "info" : "warn", `${check.passed ? "Pass" : "Fail"}: ${check.label} (${check.detail}).`);
  t.ok(snap(report), report.promote ? undefined : "The evidence does not support changing the rule yet.");

  // -- 14. A person decides --------------------------------------------------------
  const failed = report.checks.filter((check) => !check.passed).map((check) => `${check.label.toLowerCase()}: ${check.detail}`);
  const verdict = report.promote ? "Every check passes." : `Not yet. Failing: ${failed.join("; ")}.`;
  t.start("owner.decide", { verdict, this_trade_edge_points: edge });
  t.wait(`On this trade the shadow rule ${edge > 0 ? `did ${edge} points better` : edge < 0 ? `did ${Math.abs(edge)} points worse` : "did the same"}. The evaluator says: ${verdict} What do you do with it?`, [
    { id: "keep", label: "Keep it in shadow", description: "It keeps trading on paper beside the control." },
    { id: "adopt", label: "Adopt it now", description: "Replace the control's exit rule with it." },
    { id: "retire", label: "Retire it", description: "Stop running it. Its trades stay in the record." },
  ]);
  const choice = yield;
  t.resumed(choice);
  const summary = `Control ${pair.control >= 0 ? "+" : ""}${pair.control}%, shadow ${pair.candidate >= 0 ? "+" : ""}${pair.candidate}% on the same signal, after costs.`;
  if (choice === "adopt") {
    t.log("warn", "Nothing in the code stops this. The evaluator reports and a person decides; the discipline is in following it.");
    t.ok({ decision: "adopted", against_the_evaluator: !report.promote });
    t.finish(
      report.promote ? "success" : "failed",
      report.promote
        ? `${summary} Every check passes on ${report.pairs} paired trades, and the rule was adopted.`
        : `${summary} The rule was adopted on ${report.pairs} paired trades although the evaluator did not pass it (${failed.join("; ")}). That is the mistake the method exists to prevent: one good trade is not evidence.`,
      { control: pair.control, shadow: pair.candidate, pairs: report.pairs, decision: "adopted" },
    );
    return;
  }
  if (choice === "retire") {
    t.log("info", "A retired strategy stops opening positions. Its trades and the sensors it used stay, so the question can be asked again later.");
    t.ok({ decision: "retired" });
    t.finish("success", `${summary} The shadow was retired after ${report.pairs} paired trades. Its record is kept: a rejected hypothesis is a result too.`, {
      control: pair.control,
      shadow: pair.candidate,
      pairs: report.pairs,
      decision: "retired",
    });
    return;
  }
  t.ok({ decision: "kept in shadow", pairs: report.pairs });
  t.finish("success", `${summary} The shadow stays on paper. ${report.promote ? "Every check passes, so it can be promoted when the owner chooses." : `The evaluator does not pass it yet (${failed.join("; ")}).`}`, {
    control: pair.control,
    shadow: pair.candidate,
    pairs: report.pairs,
    decision: "kept",
  });
}

export const solanaScenario: Scenario<SolanaInput> = {
  id: SOLANA_SCENARIO_ID,
  stepIds: SOLANA_STEPS,
  run,
};
