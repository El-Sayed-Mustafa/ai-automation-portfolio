/**
 * Rules of the trading research platform, re-implemented in structure.
 *
 * The order of the gates, the shape of the exit ladder, the guards and the
 * statistics mirror the project's Python source, and each block names the file
 * it follows. Every number in DEMO_SETTINGS is invented: the project's real
 * parameters are private and are not reproduced here or anywhere on this site.
 */

/** Invented thresholds. None of these is a value the real platform uses. */
export const DEMO_SETTINGS = {
  scanner: {
    minLiquidityUsd: 20_000,
    minVolume5mUsd: 400,
    minObservationMinutes: 5,
    minSpike: 2.5,
    minChange5mPct: 0.5,
    maxChange5mPct: 12,
    maxRisk: 65,
    minConfidence: 40,
  },
  signalDedupeMinutes: 45,
  bands: { a: 1.5, b: 3.0 },
  risk: { maxPriceImpactPct: 3, maxTradeSol: 0.05, maxWalletPct: 5 },
  guards: { maxOpenPositions: 5, cooldownMinutes: 20 },
  monitor: { badTickDropPct: 80, rugLiquidityUsd: 2_000 },
  exits: {
    partialTriggerPct: 25,
    partialFraction: 0.5,
    armPct: 6,
    trailDistancePct: 8,
    lockGivebackFraction: 0.4,
    stopDistancePct: 12,
    liquidityDrawdownPct: 30,
    harvestStartMin: 15,
    harvestMinPnlPct: 5,
    lossGateStartMin: 15,
    lossGatePnlPct: -9,
    maxHoldMin: 45,
    runnerMaxHoldMin: 60,
  },
  evidence: { minPairs: 30, bootstrapShare: 0.95, dropTop: 3, bigWinnerPct: 20, resamples: 1000 },
} as const;

// ---------------------------------------------------------------------------
// Scanner gates: app/scanners/token_scanner.py:128-242
// ---------------------------------------------------------------------------

/** The gates in the order the platform applies them. The first one that rejects is recorded with the token. */
export const GATE_ORDER = [
  "stable_major",
  "impersonation",
  "missing_data",
  "liquidity",
  "volume_dust",
  "observation",
  "no_spike",
  "momentum",
  "not_swappable",
  "risk",
  "low_confidence",
] as const;
export type Gate = (typeof GATE_ORDER)[number];

export interface TokenSnapshot {
  symbol: string;
  address: string;
  /** The pool the price was read from. Locked at entry. */
  pairAddress: string;
  isMajor: boolean;
  impersonatesMajor: boolean;
  price: number | null;
  liquidityUsd: number | null;
  volume5mUsd: number;
  observedMinutes: number;
  /** Five-minute volume as a multiple of the token's own recent baseline. */
  spike: number;
  change5mPct: number;
  /** True when both a buy and a sell route were quoted. */
  sellRoute: boolean;
  holdersKnown: boolean;
}

/** Additive penalties, capped at 100. The structure follows app/scanners/token_scanner.py:49-84; the weights are invented. */
export function riskScore(snapshot: TokenSnapshot): number {
  let score = 20;
  const liquidity = snapshot.liquidityUsd ?? 0;
  if (liquidity < 30_000) score += 25;
  else if (liquidity < 60_000) score += 10;
  if (!snapshot.holdersKnown) score += 10;
  if (snapshot.change5mPct > 8) score += 20;
  if (snapshot.spike > 8) score += 15;
  return Math.min(100, score);
}

/** Starts at 100 and subtracts for what is not known. app/scanners/token_scanner.py:87-125; weights invented. */
export function dataConfidence(snapshot: TokenSnapshot): number {
  let score = 100;
  if (!snapshot.holdersKnown) score -= 40;
  if (snapshot.observedMinutes < 10) score -= 25;
  if (snapshot.liquidityUsd === null) score -= 40;
  return Math.max(0, score);
}

export interface ScanEvaluation {
  symbol: string;
  verdict: "opportunity" | "rejected";
  rejectedGate: Gate | null;
  reason: string;
  riskScore: number;
  confidence: number;
}

/** Every token gets a verdict, and a rejected one names the gate that stopped it. */
export function evaluateToken(snapshot: TokenSnapshot, settings: typeof DEMO_SETTINGS.scanner = DEMO_SETTINGS.scanner): ScanEvaluation {
  const risk = riskScore(snapshot);
  const confidence = dataConfidence(snapshot);
  const reject = (gate: Gate, reason: string): ScanEvaluation => ({ symbol: snapshot.symbol, verdict: "rejected", rejectedGate: gate, reason, riskScore: risk, confidence });

  if (snapshot.isMajor) return reject("stable_major", "stable or major token");
  if (snapshot.impersonatesMajor) return reject("impersonation", "uses the name of a major token");
  if (snapshot.price === null || snapshot.liquidityUsd === null) return reject("missing_data", "missing price or liquidity");
  if (snapshot.liquidityUsd < settings.minLiquidityUsd) return reject("liquidity", `liquidity $${snapshot.liquidityUsd.toLocaleString("en-US")} is under the floor`);
  if (snapshot.volume5mUsd < settings.minVolume5mUsd) return reject("volume_dust", "five-minute volume is dust");
  if (snapshot.observedMinutes < settings.minObservationMinutes) return reject("observation", `seen for ${snapshot.observedMinutes} min, which is too short a history`);
  if (snapshot.spike < settings.minSpike) return reject("no_spike", `no volume spike (x${snapshot.spike.toFixed(1)} against its own baseline)`);
  if (snapshot.change5mPct < settings.minChange5mPct) return reject("momentum", `five-minute change ${snapshot.change5mPct.toFixed(1)}% is too flat`);
  if (snapshot.change5mPct > settings.maxChange5mPct) return reject("momentum", `five-minute change ${snapshot.change5mPct.toFixed(1)}% is already vertical`);
  if (!snapshot.sellRoute) return reject("not_swappable", "no route to sell it back");
  if (risk > settings.maxRisk) return reject("risk", `risk score ${risk} is over the ceiling`);
  if (confidence < settings.minConfidence) return reject("low_confidence", `data confidence ${confidence} is under the floor`);
  return {
    symbol: snapshot.symbol,
    verdict: "opportunity",
    rejectedGate: null,
    reason: `volume spike x${snapshot.spike.toFixed(1)}, five-minute change +${snapshot.change5mPct.toFixed(1)}%`,
    riskScore: risk,
    confidence,
  };
}

/** A token signalled recently is not signalled again. app/scanners/token_scanner.py:313-315 */
export function recentOpportunityExists(opportunities: { address: string; atMinute: number }[], address: string, nowMinute: number, windowMinutes: number = DEMO_SETTINGS.signalDedupeMinutes): boolean {
  return opportunities.some((item) => item.address === address && nowMinute - item.atMinute < windowMinutes && nowMinute >= item.atMinute);
}

// ---------------------------------------------------------------------------
// Entry: app/strategies/runner.py:54-59, 97-176; app/strategies/v23_profile.py:40-47
// ---------------------------------------------------------------------------

/** What a buy followed at once by a sell would lose, from the two quotes. */
export function roundTripCostPct(amountIn: number, amountBack: number | null): number | null {
  if (amountBack === null || amountIn <= 0) return null;
  return ((amountIn - amountBack) / amountIn) * 100;
}

export type ExecutionBand = "A" | "B" | "C";

/** Cheap, acceptable, or observation only. */
export function executionBand(costPct: number | null, bands: { a: number; b: number } = DEMO_SETTINGS.bands): ExecutionBand {
  if (costPct === null) return "C";
  if (costPct <= bands.a) return "A";
  return costPct <= bands.b ? "B" : "C";
}

export interface RiskInput {
  price: number | null;
  liquidityUsd: number | null;
  riskScore: number;
  hasQuote: boolean;
  priceImpactPct: number;
  walletBalanceSol: number;
}

export interface RiskDecision {
  approved: boolean;
  reason: string;
  sizeSol: number;
}

/** The checks run in this order and the first failure is the reason. app/trading/risk_manager.py:35-79 */
export function evaluateTrade(input: RiskInput, settings: typeof DEMO_SETTINGS = DEMO_SETTINGS): RiskDecision {
  const size = Math.min(settings.risk.maxTradeSol, (input.walletBalanceSol * settings.risk.maxWalletPct) / 100);
  const refuse = (reason: string): RiskDecision => ({ approved: false, reason, sizeSol: 0 });
  if (input.price === null || input.price <= 0) return refuse("no valid price");
  if (input.liquidityUsd === null || input.liquidityUsd < settings.scanner.minLiquidityUsd) return refuse("liquidity is under the floor");
  if (input.riskScore > settings.scanner.maxRisk) return refuse("risk score is over the ceiling");
  if (!input.hasQuote) return refuse("no quote");
  if (input.priceImpactPct > settings.risk.maxPriceImpactPct) return refuse(`price impact ${input.priceImpactPct.toFixed(1)}% is over the limit`);
  if (size <= 0) return refuse("position size is zero");
  return { approved: true, reason: "approved", sizeSol: Math.round(size * 10_000) / 10_000 };
}

export interface PaperTrade {
  id: number;
  strategy: string;
  address: string;
  status: string;
  openedAtMinute: number;
  closedAtMinute: number | null;
}

/**
 * Entry guards scoped to one strategy, so strategies running side by side do
 * not block each other on the same token. app/strategies/base.py:42-57
 */
export function perStrategyGuards(trades: PaperTrade[], address: string, strategy: string, nowMinute: number, settings: typeof DEMO_SETTINGS.guards = DEMO_SETTINGS.guards): string | null {
  const own = trades.filter((trade) => trade.strategy === strategy);
  if (own.some((trade) => trade.address === address && trade.status === "open")) return "already holding (this strategy)";
  if (own.filter((trade) => trade.status === "open").length >= settings.maxOpenPositions) return "position cap (this strategy)";
  if (own.some((trade) => trade.address === address && nowMinute - trade.openedAtMinute < settings.cooldownMinutes)) return "cooldown (this strategy)";
  return null;
}

/**
 * The switches a real order has to pass, in order. Paper is the default: the
 * first two are off unless the owner turns them on. config.py:70-72, 270-277;
 * app/trading/jupiter_trader.py:46-63
 */
export function realOrderRefusal(switches: { riskApproved: boolean; dryRun: boolean; tradingEnabled: boolean; walletKeySet: boolean }): string | null {
  if (!switches.riskApproved) return "the risk manager did not approve the trade";
  if (switches.dryRun) return "DRY_RUN is on: no transaction is built";
  if (!switches.tradingEnabled) return "TRADING_ENABLED is off";
  if (!switches.walletKeySet) return "no wallet key is set";
  return null;
}

// ---------------------------------------------------------------------------
// Monitor guards: app/utils/helpers.py:137-159; app/strategies/runner.py:231-330
// ---------------------------------------------------------------------------

/**
 * A price that implies a collapse while liquidity is still healthy is a bad
 * read, not a trade: a real crash drains the pool. Such a tick is ignored.
 */
export function isBadPriceTick(price: number | null, liquidityUsd: number | null, referencePrice: number | null, dropPct: number, healthyLiquidityUsd: number): boolean {
  if (price === null) return false;
  if (price <= 0) return true;
  if (!referencePrice || referencePrice <= 0) return false;
  const drop = ((referencePrice - price) / referencePrice) * 100;
  if (drop < dropPct) return false;
  return liquidityUsd === null || liquidityUsd >= healthyLiquidityUsd;
}

/** A tick from a different pool than the one locked at entry is ignored. app/strategies/runner.py:193-194 */
export function poolSwitched(lockedPair: string | null, tickPair: string | null): boolean {
  return Boolean(lockedPair && tickPair && lockedPair !== tickPair);
}

/**
 * Exits that apply to every strategy, before its own rule is asked.
 * app/strategies/runner.py:302-313
 */
export function universalExit(liquidityUsd: number | null, settings: typeof DEMO_SETTINGS = DEMO_SETTINGS): "closed_rug" | "closed_liq_exit" | null {
  if (liquidityUsd === null) return null;
  if (liquidityUsd < settings.monitor.rugLiquidityUsd) return "closed_rug";
  if (liquidityUsd < settings.scanner.minLiquidityUsd * 0.5) return "closed_liq_exit";
  return null;
}

/**
 * Closes a trade only if it is still open, and says whether this call closed
 * it. UPDATE ... WHERE status = 'open', then the row count.
 * app/database/queries.py:673-694
 */
export function closePaperTrade(trade: PaperTrade, status: string, nowMinute: number): boolean {
  if (trade.status !== "open") return false;
  trade.status = status;
  trade.closedAtMinute = nowMinute;
  return true;
}

// ---------------------------------------------------------------------------
// Exit ladder: app/strategies/lowliq.py:667-761
// ---------------------------------------------------------------------------

export interface ExitProfile {
  name: string;
  /** The control takes half off at a target; the shadow lets the full size run. */
  partialTake: boolean;
}

export const CONTROL: ExitProfile = { name: "control", partialTake: true };
export const NO_PARTIAL: ExitProfile = { name: "no-partial shadow", partialTake: false };

export interface PositionState {
  ageMin: number;
  pnlPct: number;
  peakPnlPct: number;
  partialTaken: boolean;
  liquidityUsd: number;
  peakLiquidityUsd: number;
}

export type ExitDecision =
  | { action: "hold" }
  | { action: "partial"; fraction: number; reason: string }
  | { action: "close"; status: "closed_liq_drop" | "closed_trail" | "closed_max_hold" | "closed_sl" | "closed_harvest" | "closed_loss_cut"; reason: string };

/** The first rule that matches wins. The order follows the platform's ladder. */
export function decideExit(position: PositionState, profile: ExitProfile, settings: typeof DEMO_SETTINGS.exits = DEMO_SETTINGS.exits): ExitDecision {
  const { ageMin, pnlPct, peakPnlPct } = position;
  if (profile.partialTake && !position.partialTaken && pnlPct >= settings.partialTriggerPct) {
    return { action: "partial", fraction: settings.partialFraction, reason: `partial take at +${settings.partialTriggerPct}%` };
  }
  const liquidityDrop = position.peakLiquidityUsd > 0 ? ((position.peakLiquidityUsd - position.liquidityUsd) / position.peakLiquidityUsd) * 100 : 0;
  if (liquidityDrop >= settings.liquidityDrawdownPct) return { action: "close", status: "closed_liq_drop", reason: `liquidity fell ${liquidityDrop.toFixed(0)}% from its peak while held` };

  const armed = peakPnlPct >= settings.armPct;
  if (armed) {
    // The stop is the higher of a trail under the peak and a lock that gives back a fraction of the run.
    const stop = Math.max(peakPnlPct - settings.trailDistancePct, peakPnlPct * (1 - settings.lockGivebackFraction));
    if (pnlPct <= stop) return { action: "close", status: "closed_trail", reason: `trail hit at ${stop.toFixed(1)}% under a peak of +${peakPnlPct.toFixed(1)}%` };
    if (ageMin >= settings.runnerMaxHoldMin) return { action: "close", status: "closed_max_hold", reason: `runner held ${settings.runnerMaxHoldMin} min` };
  } else if (pnlPct <= -settings.stopDistancePct) {
    return { action: "close", status: "closed_sl", reason: `stop at -${settings.stopDistancePct}%` };
  }
  if (ageMin >= settings.harvestStartMin && pnlPct >= settings.harvestMinPnlPct && !armed) {
    return { action: "close", status: "closed_harvest", reason: `harvest: +${pnlPct.toFixed(1)}% after ${settings.harvestStartMin} min without arming` };
  }
  if (ageMin >= settings.lossGateStartMin && pnlPct <= settings.lossGatePnlPct) {
    return { action: "close", status: "closed_loss_cut", reason: `loss cut: ${pnlPct.toFixed(1)}% after ${settings.lossGateStartMin} min` };
  }
  if (!armed && ageMin >= settings.maxHoldMin) return { action: "close", status: "closed_max_hold", reason: `held ${settings.maxHoldMin} min` };
  return { action: "hold" };
}

/**
 * A partial exit and its remainder are one trade: the result is weighted by
 * the size of each leg. app/strategies/report.py:25-67
 */
export function familyPnlPct(legs: { fraction: number; pnlPct: number }[]): number {
  const total = legs.reduce((sum, leg) => sum + leg.fraction, 0);
  if (total <= 0) return 0;
  return legs.reduce((sum, leg) => sum + leg.fraction * leg.pnlPct, 0) / total;
}

// ---------------------------------------------------------------------------
// Evidence: app/backtest/external_validation.py:54-73, app/backtest/v23_candidate.py:110-153
// ---------------------------------------------------------------------------

export interface PairedTrade {
  control: number;
  candidate: number;
}

/** A small deterministic generator, so a resampling test gives the same answer every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

/** Share of resamples in which the candidate's mean edge over the control is positive. */
export function pairedBootstrap(differences: number[], resamples: number, random: () => number): number {
  if (differences.length === 0) return 0;
  let wins = 0;
  for (let round = 0; round < resamples; round += 1) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) sum += differences[Math.floor(random() * differences.length)];
    if (sum > 0) wins += 1;
  }
  return wins / resamples;
}

export interface EvidenceCheck {
  id: "sample" | "edge" | "halves" | "tail" | "bootstrap" | "winners";
  label: string;
  passed: boolean;
  detail: string;
}

export interface EvidenceReport {
  pairs: number;
  meanEdge: number;
  checks: EvidenceCheck[];
  promote: boolean;
}

/**
 * Whether a candidate rule has earned the control's place. Each check is one
 * the project applies; the sample-size number is invented.
 */
export function evaluateCandidate(pairs: PairedTrade[], settings: typeof DEMO_SETTINGS.evidence = DEMO_SETTINGS.evidence, seed = 20260816): EvidenceReport {
  const differences = pairs.map((pair) => pair.candidate - pair.control);
  const half = Math.floor(differences.length / 2);
  const first = mean(differences.slice(0, half));
  const second = mean(differences.slice(half));
  const withoutTop = [...differences].sort((a, b) => b - a).slice(settings.dropTop);
  const share = pairedBootstrap(differences, settings.resamples, seededRandom(seed));
  const big = (key: keyof PairedTrade) => pairs.filter((pair) => pair[key] >= settings.bigWinnerPct).length;
  const edge = mean(differences);
  const round = (value: number) => Math.round(value * 100) / 100;

  const checks: EvidenceCheck[] = [
    { id: "sample", label: "Enough paired trades", passed: pairs.length >= settings.minPairs, detail: `${pairs.length} of at least ${settings.minPairs}` },
    { id: "edge", label: "Better on average, after costs", passed: edge > 0, detail: `${edge >= 0 ? "+" : ""}${round(edge)} points per trade` },
    { id: "halves", label: "Better in both halves of the period", passed: first > 0 && second > 0, detail: `first half ${first >= 0 ? "+" : ""}${round(first)}, second half ${second >= 0 ? "+" : ""}${round(second)}` },
    { id: "tail", label: `Still better without its ${settings.dropTop} best trades`, passed: mean(withoutTop) > 0, detail: `${mean(withoutTop) >= 0 ? "+" : ""}${round(mean(withoutTop))} points per trade` },
    { id: "bootstrap", label: "Paired bootstrap", passed: share >= settings.bootstrapShare, detail: `${Math.round(share * 100)}% of ${settings.resamples} resamples, against a bar of ${Math.round(settings.bootstrapShare * 100)}%` },
    { id: "winners", label: "No fewer big winners than the control", passed: big("candidate") >= big("control"), detail: `${big("candidate")} against ${big("control")}` },
  ];
  return { pairs: pairs.length, meanEdge: round(edge), checks, promote: checks.every((check) => check.passed) };
}
