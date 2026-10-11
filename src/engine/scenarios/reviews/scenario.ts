import type { Scenario, ScenarioContext } from "../../session";
import type { Json } from "../../types";
import {
  DEMO_SETTINGS,
  REASONS,
  STARS,
  allGapReasons,
  archiveOutcome,
  changeOutcome,
  claim,
  claimable,
  classifyDifficulty,
  classifyPermalink,
  countsAsHeld,
  criticalCoversAll,
  emptyCounts,
  estimate,
  heldCounts,
  membersToVisit,
  planBatches,
  poolWalkComplete,
  recentPage,
  release,
  remainingAfterFullWalk,
  selectForChecking,
  selectForCollecting,
  splitNew,
  total,
  viewLimit,
  walkView,
  type ArchiveItem,
  type Batch,
  type ItemStatus,
  type LiveReview,
  type Permalink,
  type ReportRow,
  type Star,
  type StarCounts,
  type StoredReview,
  type Verdict,
} from "./rules";

export const REVIEWS_SCENARIO_ID = "reviews.gap-to-clean";

export const REVIEWS_STEPS = [
  "report.load",
  "report.diagnose",
  "queue.build",
  "check.claim",
  "check.walk",
  "check.permalinks",
  "collect.claim",
  "stored.load",
  "collect.recent",
  "collect.walk",
  "collect.members",
  "reviews.store",
  "large.ladder",
  "cleanup.decide",
  "cleanup.write",
] as const;

export const REVIEWS_FAULTS = [
  "daily-job-missed",
  "built-twice",
  "control-does-not-open",
  "stored-read-short",
  "count-unreadable",
  "pages-parse-nothing",
  "machine-dies",
  "refiled-since-check",
] as const;

export type ReviewsFaultId = (typeof REVIEWS_FAULTS)[number];

export interface ReviewsInput {
  /** Critical reviews posted on the ordinary listing since the last run. */
  newReviews: number;
  /** Older reviews of that listing which an earlier run passed over. */
  olderMissing: number;
  /** Variations in the ordinary listing's family, the listing itself included. */
  members: number;
  /** What a person typed in the report beside the large listing. Any note keeps it out of the queue. */
  note: string;
}

export const INPUT_LIMITS = { newReviews: { min: 0, max: 12 }, olderMissing: { min: 0, max: 3 }, members: { min: 1, max: 4 }, note: 60 } as const;

const NORMAL: ReviewsInput = { newReviews: 6, olderMissing: 0, members: 3, note: "" };

export const REVIEWS_PRESETS: { id: string; label: string; description: string; input: ReviewsInput }[] = [
  {
    id: "normal",
    label: "A normal day",
    description: "Five listings, five different answers. One gap closes on a single page, one runs past every view, and six reviews held too many are opened one by one.",
    input: NORMAL,
  },
  {
    id: "older",
    label: "An older review is missing",
    description: "Two new reviews and one an earlier run passed over. The first page finds two; only the full walk reaches the third, and it settles the family as well.",
    input: { ...NORMAL, newReviews: 2, olderMissing: 1 },
  },
  {
    id: "busy",
    label: "A busy week",
    description: "Twelve new reviews: more than one page shows. The first page takes ten and the walk takes the rest.",
    input: { ...NORMAL, newReviews: 12 },
  },
  {
    id: "note",
    label: "A note on the large listing",
    description: "Someone working the report wrote beside the large listing. The note survives the rewrite and keeps the listing out of the queue.",
    input: { ...NORMAL, note: "merged with another listing, wait" },
  },
  {
    id: "quiet",
    label: "Nothing to collect",
    description: "The ordinary listing has no gap, so it is not queued at all. The large listing and the check still run.",
    input: { ...NORMAL, newReviews: 0 },
  },
];

export const REVIEWS_DEFAULT_INPUT: ReviewsInput = REVIEWS_PRESETS[0].input;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function validateReviewsInput(raw: Partial<Record<keyof ReviewsInput, unknown>>): {
  ok: boolean;
  value: ReviewsInput;
  errors: Partial<Record<keyof ReviewsInput, string>>;
} {
  const errors: Partial<Record<keyof ReviewsInput, string>> = {};
  const whole = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN);
  const check = (key: "newReviews" | "olderMissing" | "members") => {
    const value = whole(raw[key]);
    const limits = INPUT_LIMITS[key];
    if (Number.isInteger(value) && value >= limits.min && value <= limits.max) return value;
    errors[key] = `Use a whole number from ${limits.min} to ${limits.max}.`;
    return REVIEWS_DEFAULT_INPUT[key];
  };
  const newReviews = check("newReviews");
  const olderMissing = check("olderMissing");
  const members = check("members");
  const note = typeof raw.note === "string" ? raw.note.replace(CONTROL_CHARS, " ").trim() : raw.note === undefined || raw.note === null ? "" : null;
  if (note === null) errors.note = "Type a note, or leave it empty.";
  else if (note.length > INPUT_LIMITS.note) errors.note = `Keep the note under ${INPUT_LIMITS.note} characters.`;

  return {
    ok: Object.keys(errors).length === 0,
    value: { newReviews, olderMissing, members, note: note === null ? REVIEWS_DEFAULT_INPUT.note : note.slice(0, INPUT_LIMITS.note) },
    errors,
  };
}

// -- Invented world ------------------------------------------------------------
// Five listings of one invented client. No id, count or review here comes from a real system.

export const LISTINGS = { dead: "P-1180", fresh: "P-2290", ordinary: "P-3310", large: "P-4470", extra: "P-5520" } as const;
/** The product a review of the fifth listing turns out to be attached to. Nobody tracks it. */
export const STRANGER = "Q-9040";
/** Where that review is found filed when the "refiled" failure is switched on. */
const REFILED_UNDER = "P-5599";
export const EXTRA_FAMILY = [LISTINGS.extra, "P-5521"] as const;
const MACHINES = { first: "machine A", second: "machine B" } as const;
const RUNS = { first: "run a1", second: "run b1" } as const;
const CYCLE = "day 12";
const FIRST_BATCH_ID = 41;
const ARCHIVE_RUN = "archive run 7";

const pad = (value: number, width = 3) => String(value).padStart(width, "0");
const STAR_CYCLE: readonly Star[] = [1, 3, 1, 2, 1, 3, 2, 1, 3, 1];

export function ordinaryFamily(members: number): string[] {
  return Array.from({ length: members }, (_, index) => `P-33${10 + index}`);
}

const ORDINARY_BASE = 36;
/** Which older reviews of the ordinary listing an earlier run passed over, in the order they go missing. */
const ORDINARY_OLDER = [21, 9, 30] as const;

/** Every critical review the marketplace shows for the ordinary listing's family, newest first. */
export function ordinaryPool(input: Pick<ReviewsInput, "newReviews" | "members">): LiveReview[] {
  const family = ordinaryFamily(input.members);
  // The last member of a family has no reviews at all: the kind of member a walk gives no evidence for.
  const withReviews = Math.max(1, family.length - 1);
  const fresh = Array.from({ length: input.newReviews }, (_, index): LiveReview => ({ id: `R3-N${pad(index + 1, 2)}`, star: STAR_CYCLE[(index * 3) % STAR_CYCLE.length], age: index + 1, votes: 0, boughtAs: family[index % withReviews] }));
  const base = Array.from({ length: ORDINARY_BASE }, (_, index): LiveReview => ({ id: `R3-${pad(index + 1)}`, star: STAR_CYCLE[index % STAR_CYCLE.length], age: 20 + index * 9, votes: (index * 7) % 23, boughtAs: family[index % withReviews] }));
  return [...fresh, ...base];
}

/** 31, 14 and 19 of each star in every 64 reviews, spread evenly. */
function largeStars(): Star[] {
  const target: StarCounts = { 1: 31, 2: 14, 3: 19 };
  const given = emptyCounts();
  const out: Star[] = [];
  for (let index = 0; index < 64; index += 1) {
    let best: Star = 1;
    let lowest = Number.POSITIVE_INFINITY;
    for (const star of STARS) {
      const ratio = (given[star] + 0.5) / target[star];
      if (ratio < lowest) {
        lowest = ratio;
        best = star;
      }
    }
    given[best] += 1;
    out.push(best);
  }
  return out;
}

const LARGE_SIZE = 128;

/** The large listing: more critical reviews than any one view shows, and what of them is not held. */
export function largeListing(): { pool: LiveReview[]; missing: Set<string> } {
  const pattern = largeStars();
  const pool = Array.from({ length: LARGE_SIZE }, (_, index): LiveReview => ({ id: `R4-${pad(index + 1)}`, star: pattern[index % pattern.length], age: 2 + index * 3, votes: (index * 37) % 41, boughtAs: LISTINGS.large }));
  const limit = viewLimit();
  const missing = new Set<string>();
  // Posted since the last run, and a few an earlier run passed over: all inside the newest view.
  for (const index of [0, 3, 5, 8, 14, 22, 27, 36, 44]) missing.add(pool[index].id);
  // Older two- and three-star reviews: past the newest view, inside the view of their own star.
  const olderOtherStars = pool.filter((review, index) => index >= limit && review.star !== 1);
  for (let pick = 0; pick < 6; pick += 1) missing.add(olderOtherStars[pick * 4 + 1].id);
  // The oldest one-star reviews are past the one-star view too. A few are still voted helpful; the rest are in no view at all.
  const oldestOneStar = pool.filter((review) => review.star === 1).slice(limit);
  oldestOneStar.slice(0, 9).forEach((review, pick) => {
    missing.add(review.id);
    review.votes = pick < 4 ? 300 + pick : 0;
  });
  return { pool, missing };
}

const EXTRA_LIVE = 30;
export const EXTRA_HELD_TOO_MANY = ["R5-901", "R5-902", "R5-903", "R5-904", "R5-905", "R5-906"] as const;

/** The reviews the marketplace lists on the fifth listing's own page. */
export function extraPool(): LiveReview[] {
  // Twelve one-star, eight two-star, ten three-star.
  const mix: Star[] = [...Array<Star>(12).fill(1), ...Array<Star>(8).fill(2), ...Array<Star>(10).fill(3)];
  return Array.from({ length: EXTRA_LIVE }, (_, index): LiveReview => ({ id: `R5-${pad(index + 1)}`, star: mix[(index * 7) % EXTRA_LIVE], age: 4 + index * 6, votes: (index * 5) % 17, boughtAs: LISTINGS.extra }));
}

/** What the marketplace answers when a held review's own page is opened. */
function openPermalink(id: string): Permalink {
  if (id === "R5-901" || id === "R5-902" || id === "R5-903") return { signin: false, exists: true, product: EXTRA_FAMILY[1], star: 1 };
  if (id === "R5-906") return { signin: false, exists: true, product: STRANGER, star: 1 };
  return { signin: false, exists: false, product: null, star: null };
}

const stored = (id: string, star: Star, filedUnder: string, variation: string | null = null): StoredReview => ({ id, star, filedUnder, variation, removed: false, mainDomain: true });

/** Everything the database holds for the five listings before the run. */
export function demoStored(input: ReviewsInput): StoredReview[] {
  const dead = Array.from({ length: 12 }, (_, index) => stored(`R1-${pad(index + 1)}`, STAR_CYCLE[index % STAR_CYCLE.length], LISTINGS.dead));
  const passedOver = new Set<number>(ORDINARY_OLDER.slice(0, input.olderMissing));
  const ordinary = ordinaryPool({ members: input.members, newReviews: 0 })
    .filter((_, index) => !passedOver.has(index))
    .map((review) => stored(review.id, review.star, LISTINGS.ordinary, review.boughtAs));
  const large = largeListing();
  const held = large.pool.filter((review) => !large.missing.has(review.id)).map((review) => stored(review.id, review.star, LISTINGS.large, review.boughtAs));
  const extra = [...extraPool().map((review) => stored(review.id, review.star, LISTINGS.extra, review.boughtAs)), ...EXTRA_HELD_TOO_MANY.map((id) => stored(id, 1, LISTINGS.extra))];
  return [...dead, ...ordinary, ...held, ...extra];
}

function countStars(reviews: readonly { star: Star }[]): StarCounts {
  const counts = emptyCounts();
  for (const review of reviews) counts[review.star] += 1;
  return counts;
}

export interface ListingFacts {
  id: string;
  what: string;
  live: boolean;
  /** The latest measurement of the marketplace's own count. Null when the listing was never measured. */
  market: StarCounts | null;
  activationAge: number;
  familySize: number;
}

export function demoListings(input: ReviewsInput): ListingFacts[] {
  return [
    { id: LISTINGS.dead, what: "taken off the marketplace", live: false, market: { 1: 4, 2: 2, 3: 3 }, activationAge: 200, familySize: 1 },
    { id: LISTINGS.fresh, what: "added two days ago", live: true, market: null, activationAge: 2, familySize: 1 },
    { id: LISTINGS.ordinary, what: "an ordinary listing", live: true, market: countStars(ordinaryPool(input)), activationAge: 150, familySize: input.members },
    { id: LISTINGS.large, what: "a large listing", live: true, market: countStars(largeListing().pool), activationAge: 400, familySize: 1 },
    { id: LISTINGS.extra, what: "holds more than is shown", live: true, market: countStars(extraPool()), activationAge: 90, familySize: EXTRA_FAMILY.length },
  ];
}

/** The daily report: every listing with its difference, its reasons and what to do. */
export function buildReport(listings: readonly ListingFacts[], held: readonly StoredReview[], comments: Readonly<Record<string, string>>): ReportRow[] {
  return listings.map((listing) => {
    const mine = heldCounts(held, listing.id);
    const run = estimate(listing.market, total(mine), listing.familySize);
    const diff = listing.market === null ? null : total(listing.market) - total(mine);
    const reasons = allGapReasons({
      live: listing.live,
      abnormal: false,
      hasTracking: listing.market !== null,
      held: total(mine),
      market: listing.market === null ? 0 : total(listing.market),
      diff: diff ?? 0,
      yieldPerPage: run.score,
      activationAge: listing.activationAge,
      mergeSuspect: false,
      // Held reviews known to belong to one of the listing's variations.
      familyReviews: held.filter((review) => review.filedUnder === listing.id && countsAsHeld(review) && review.variation !== null && review.variation !== listing.id).length,
      departedReviews: 0,
      familyCounted: false,
    });
    const reason = reasons[0] ?? null;
    return {
      listing: listing.id,
      live: listing.live,
      market: listing.market,
      held: mine,
      diff,
      reasons,
      reason,
      action: reason ? REASONS[reason].action : null,
      difficulty: classifyDifficulty(run, listing.market === null ? null : total(listing.market)),
      pages: run.pages,
      reachable: run.reachable,
      reviewsPerPage: run.score,
      comment: comments[listing.id] ?? "",
    };
  });
}

/** Simulated latencies in virtual milliseconds. They pace playback; they are not measurements. */
const LATENCY = { read: 220, compute: 40, write: 160, page: 900, permalink: 700 } as const;
const SECOND = 1000;

function snap<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const byStar = (counts: StarCounts) => `${total(counts)} (${counts[1]} / ${counts[2]} / ${counts[3]})`;

function rowView(row: ReportRow): Json {
  return {
    listing: row.listing,
    marketplace: row.market === null ? null : total(row.market),
    held: total(row.held),
    difference: row.diff,
    filed_under: row.reason ? REASONS[row.reason].label : "nothing to do",
    every_reason: row.reasons.map((reason) => REASONS[reason].label),
    action: row.action,
    difficulty: row.difficulty,
    pages_expected: row.pages,
    reviews_per_page: row.reviewsPerPage,
    comment: row.comment,
  };
}

function batchView(batch: Batch): Json {
  return { kind: batch.kind === "verify" ? "check" : "collect", priority: batch.priority, status: batch.status, machine: batch.machine, listings: batch.items.map((item) => `${item.listing}: ${item.status}${item.note ? ` (${item.note})` : ""}`) };
}

function* run({ input, faults, t }: ScenarioContext<ReviewsInput>): Generator<void, void, string> {
  const settings = DEMO_SETTINGS;
  const limit = viewLimit();
  const listings = demoListings(input);
  let held = demoStored(input);
  const known = new Set(held.map((review) => review.id));
  const comments: Record<string, string> = input.note ? { [LISTINGS.large]: input.note } : {};
  let clock = 0; // virtual seconds, for heartbeats

  const tick = (ms: number) => {
    t.advance(ms);
    clock += ms / SECOND;
  };

  // -- 1. The daily job reads both sides ------------------------------------------
  t.start("report.load", { cycle: CYCLE, listings: listings.length, reads: ["latest measurement per listing", "reviews held", "family links"], opens_a_browser: false });
  if (faults.has("daily-job-missed")) {
    t.log("warn", "The scheduled task did not fire: the machine that runs it was switched off overnight. Nothing in the system notices a morning without a report.");
    t.fail("NO_RUN", "The daily job did not run. No report was written and no queue was built for today.");
    t.skipRemaining("Today's detection never ran, so there was nothing to queue.");
    t.finish("failed", "No report today. The machines keep working whatever is left of yesterday's queue, and the difference between the database and the marketplace is not measured until someone starts the job by hand.", { report_written: false, batches_built: 0 });
    return;
  }
  tick(LATENCY.read * 3);
  t.log("info", "Detection reads the database and nothing else. It never opens a browser, so it can run every morning without spending a single page.");
  t.log("info", "A held review counts unless it was removed, belongs to another marketplace, or its latest check found it gone, on another product, or listed nowhere.");
  t.ok({ listings: listings.length, reviews_held: held.length, measured: listings.filter((listing) => listing.market !== null).length });

  // -- 2. A reason for every difference -------------------------------------------
  const report = buildReport(listings, held, comments);
  t.start("report.diagnose", { listings: report.length, per: "listing and star" });
  tick(LATENCY.compute);
  for (const row of report) {
    const facts = listings.find((listing) => listing.id === row.listing)!;
    const label = row.reason ? `filed under "${REASONS[row.reason].label}": ${row.action?.toLowerCase()}` : "nothing to do";
    const numbers = row.market === null ? `never measured, holds ${total(row.held)}` : `marketplace ${byStar(row.market)}, held ${byStar(row.held)}`;
    t.log("info", `${row.listing} (${facts.what}): ${numbers}. It is ${label}.`);
    if (row.reasons.length > 1) t.log("info", `${row.listing} also matches "${row.reasons.slice(1).map((reason) => REASONS[reason].label).join('", "')}". Only the first is counted; the rest stay searchable.`);
    if (row.action === "Scrape") t.log("info", `${row.listing}: ${row.difficulty}. A run is expected to cost ${plural(row.pages, "page")} and reach ${row.reachable} of the ${row.diff} missing, ${row.reviewsPerPage} a page.`);
  }
  if (input.note) t.log("info", `The report is rewritten in full every day. The note beside ${LISTINGS.large} was read back first and written again, so it is still there.`);
  t.change("daily report", "update", CYCLE, { rows: "yesterday's" }, snap({ rows: report.length, to_collect: report.filter((row) => row.action === "Scrape").length, to_decide: report.filter((row) => row.action === "Decide").length, left_alone: report.filter((row) => row.action === "Leave it" || row.action === "Track first").length }));
  t.ok({ report: report.map(rowView) });

  // -- 3. The queue ---------------------------------------------------------------
  const collecting = selectForCollecting(report, new Set());
  const checking = selectForChecking(report, new Set());
  let batches = planBatches(collecting, checking, FIRST_BATCH_ID);
  t.start("queue.build", { cycle: CYCLE, batch_size: settings.queue.batchSize, to_collect: collecting.length, to_check: checking.length });
  tick(LATENCY.write);
  t.change("work batches", "update", "batch 38 (day 11)", { status: "queued" }, { status: "cancelled", why: "a newer report replaced it before anyone took it" });
  t.log("info", "A batch of yesterday's that nobody claimed is cancelled. One a machine is working on would be left alone.");
  for (const row of report.filter((item) => item.action === "Scrape" && item.comment.trim() !== "")) {
    t.log("warn", `${row.listing} is not queued: a person wrote "${row.comment}" beside it. A note in the report doubles as "do not collect".`);
  }
  for (const batch of batches) {
    t.change("work batches", "insert", `batch ${batch.id}`, null, batchView(batch));
    t.log("info", `Batch ${batch.id}, ${batch.kind === "verify" ? "check" : "collect"}, priority ${batch.priority}: ${batch.items.map((item) => item.listing).join(", ")}.`);
  }
  if (batches.some((batch) => batch.kind === "scrape" && batch.items.length > 1)) t.log("info", "Inside a collecting batch the cheapest work comes first: Easy before Medium before Hard, then whatever a page buys most of.");
  if (faults.has("built-twice")) {
    tick(LATENCY.write);
    const again = planBatches(selectForCollecting(report, new Set(collecting.map((row) => row.listing))), selectForChecking(report, new Set(checking.map((row) => row.listing))), FIRST_BATCH_ID + batches.length);
    t.log("warn", `The builder was started a second time. It first reads what today's cycle already holds and leaves those listings out: ${again.length} new batches. The table would refuse a duplicate anyway, because a listing can be in a cycle only once.`);
  }
  t.ok({ batches: batches.length, listings_queued: batches.reduce((sum, batch) => sum + batch.items.length, 0), second_build_added: faults.has("built-twice") ? 0 : null });

  const current = (id: number) => batches.find((batch) => batch.id === id)!;
  const setBatch = (after: Batch, note = "") => {
    const before = current(after.id);
    batches = batches.map((batch) => (batch.id === after.id ? after : batch));
    // Letting go of a batch happens between two steps; there is no step to record it under.
    if (!t.currentStepId) return;
    t.change("work batches", "update", `batch ${after.id}`, batchView(before), batchView(after));
    if (note) t.log("info", note);
  };
  const setItem = (batchId: number, listing: string, status: ItemStatus, note = "") => {
    const before = current(batchId);
    setBatch({ ...before, items: before.items.map((item) => (item.listing === listing ? { listing, status, ...(note ? { note } : {}) } : item)) });
  };
  /** The free batch a machine would take: lowest priority number first. */
  const freeBatch = () => [...batches].filter((batch) => claimable(batch, clock)).sort((a, b) => a.priority - b.priority)[0];

  // -- 4. A machine takes the checking batch ----------------------------------------
  const hasCheck = batches.some((batch) => batch.kind === "verify");
  const verdicts: { id: string; verdict: Verdict; product: string | null }[] = [];
  let checkStopped = false;
  if (!hasCheck) {
    for (const step of ["check.claim", "check.walk", "check.permalinks"] as const) t.skip(step, "No listing holds more than the marketplace shows, so there was nothing to check.");
  } else {
    t.start("check.claim", { machine: MACHINES.first, run: RUNS.first, asks_for: "the free batch with the lowest priority number" });
    tick(LATENCY.write);
    const taken = claim(freeBatch(), MACHINES.first, RUNS.first, clock)!;
    setBatch(taken, `One update that only takes effect if the batch is still free at that moment. ${MACHINES.first} then reads the row back by its own run id: that is how it knows it won.`);
    t.log("info", `Checking batches are queued ahead of every collecting batch. A heartbeat every ${settings.queue.heartbeatSeconds} seconds keeps the claim; ${settings.queue.staleMinutes} minutes of silence frees it.`);
    t.log("info", "A signed-in session is leased from a shared pool with the same kind of claim, so two machines never work through one session.");
    t.ok({ batch: taken.id, kind: "check", claimed_by: MACHINES.first });

    // -- 5. Walk the listing ---------------------------------------------------------
    const pool = extraPool();
    const mine = held.filter((review) => review.filedUnder === LISTINGS.extra);
    t.start("check.walk", { listing: LISTINGS.extra, held: mine.length, marketplace_count: pool.length });
    setItem(taken.id, LISTINGS.extra, "running");
    const walk = walkView(pool);
    tick(LATENCY.page * (walk.pages + 1));
    const seenIds = new Set(walk.seen.map((review) => review.id));
    const unseen = mine.filter((review) => !seenIds.has(review.id));
    t.log("info", `${plural(walk.pages, "page")} show all ${walk.seen.length} reviews the listing has. Every held review among them is on this product, with no need to open it.`);
    t.log(unseen.length > 0 ? "warn" : "info", `${plural(unseen.length, "held review")} did not appear. That is not yet a removal: a review can move to a sibling or to another product, and it can be gone.`);
    t.change("review checks", "insert", `${mine.length - unseen.length} rows`, null, { verdict: "on_this_product", how: "seen in the walk", run: RUNS.first });
    t.ok({ pages: walk.pages + 1, seen: walk.seen.length, on_this_product: mine.length - unseen.length, to_open: unseen.length });

    // -- 6. Open what was not seen ----------------------------------------------------
    t.start("check.permalinks", { listing: LISTINGS.extra, to_open: unseen.length, limit: settings.verify.maxPermalinks });
    const control = walk.seen[0];
    let controlTested = false;
    for (const review of unseen.slice(0, settings.verify.maxPermalinks)) {
      if (checkStopped) {
        verdicts.push({ id: review.id, verdict: "unknown", product: null });
        continue;
      }
      tick(LATENCY.permalink);
      const found = openPermalink(review.id);
      if (!found.exists) {
        // "Not found" is also what a session that has lost access is shown, for every page it asks for.
        if (!controlTested) {
          tick(LATENCY.permalink);
          controlTested = true;
          if (faults.has("control-does-not-open")) {
            t.log("error", `${review.id}: page not found. ${control.id}, which the walk showed a minute ago, does not open either. The session cannot see review pages, so nothing it reports is a removal.`);
            verdicts.push({ id: review.id, verdict: classifyPermalink(LISTINGS.extra, review.star, found, EXTRA_FAMILY), product: null });
            checkStopped = true;
            continue;
          }
          t.log("info", `${review.id}: page not found. Before believing it, ${control.id}, which the walk just showed, is opened: it loads. The session can see review pages.`);
        }
        tick(LATENCY.permalink);
        found.confirmedGone = true;
      }
      const verdict = classifyPermalink(LISTINGS.extra, review.star, found, EXTRA_FAMILY);
      verdicts.push({ id: review.id, verdict, product: found.product });
      if (verdict === "family_member") t.log("info", `${review.id}: live, shown on ${found.product}, a variation of this listing. It stays with the client and its variation is recorded.`);
      else if (verdict === "gone") t.log("warn", `${review.id}: not found, a live review opened, not found again. Gone.`);
      else if (verdict === "other_product") t.log("warn", `${review.id}: live, but the marketplace attaches it to ${found.product}, a product nobody tracks.`);
    }
    for (const entry of verdicts) t.change("review checks", "insert", entry.id, null, { verdict: entry.verdict, product: entry.product, run: RUNS.first });
    // The one change the checker makes by itself: recording which family member a review belongs to,
    // through the same guarded function a person's cleanup run goes through.
    const moved = verdicts.filter((entry) => entry.verdict === "family_member");
    for (const entry of moved) {
      t.change("review changes", "insert", `${entry.id} variation`, null, { old: null, new: entry.product, status: changeOutcome(null, null, entry.product), run: RUNS.first });
    }
    held = held.map((review) => {
      const entry = verdicts.find((item) => item.id === review.id);
      if (!entry) return review;
      return entry.verdict === "family_member" ? { ...review, variation: entry.product, verdict: entry.verdict } : { ...review, verdict: entry.verdict };
    });
    if (moved.length > 0) t.log("info", `${plural(moved.length, "variation")} recorded. Each change went through a database function that locks the row, checks it still holds the value it was checked with, and logs old and new.`);
    const tally = (verdict: Verdict) => verdicts.filter((entry) => entry.verdict === verdict).length;
    setItem(taken.id, LISTINGS.extra, checkStopped ? "failed" : "done", checkStopped ? "the session could not see review pages" : "checked");
    setBatch(release(current(taken.id), RUNS.first));
    if (checkStopped) {
      t.log("warn", "The check of this listing stops here. That session is set aside and another is leased for the next batch.");
      t.ok({ family_member: tally("family_member"), gone: 0, other_product: 0, unknown: tally("unknown") }, "The session lost access part way. Unopened reviews are unknown, not gone.");
    } else {
      t.ok({ family_member: tally("family_member"), gone: tally("gone"), other_product: tally("other_product"), unknown: tally("unknown") });
    }
  }

  // -- 7. The collecting batch -------------------------------------------------------
  const collectBatch = batches.find((batch) => batch.kind === "scrape");
  const queued = (listing: string) => Boolean(collectBatch?.items.some((item) => item.listing === listing));
  const ORDINARY_STEPS = ["stored.load", "collect.recent", "collect.walk", "collect.members", "reviews.store"] as const;
  const collected = { ordinary: 0, large: 0 };
  let ordinaryRemaining: number | null = null;
  let largeRemaining: number | null = null;
  let pagesSpent = 0;
  if (!collectBatch) {
    for (const step of ["collect.claim", ...ORDINARY_STEPS, "large.ladder"] as const) t.skip(step, "No listing was queued for collecting.");
  } else {
    t.start("collect.claim", { machine: MACHINES.first, run: RUNS.first, asks_for: "the next free batch" });
    tick(LATENCY.write);
    let mine = claim(freeBatch(), MACHINES.first, RUNS.first, clock)!;
    setBatch(mine, `The same guarded update. ${plural(mine.items.length, "listing")}, in the order the builder gave them.`);
    t.ok({ batch: mine.id, kind: "collect", listings: mine.items.map((item) => item.listing) });

    if (!queued(LISTINGS.ordinary)) {
      for (const step of ORDINARY_STEPS) t.skip(step, `${LISTINGS.ordinary} has no gap today, so it was never queued.`);
    } else {
      // -- 8. What is already held, for the whole family ------------------------------
      const family = ordinaryFamily(input.members);
      const pool = ordinaryPool(input);
      const marketCount = pool.length;
      const heldHere = held.filter((review) => review.filedUnder === LISTINGS.ordinary);
      const missing = marketCount - heldHere.length;
      t.start("stored.load", { listing: LISTINGS.ordinary, family, asks_first_for: "the exact number of rows" });
      setItem(mine.id, LISTINGS.ordinary, "running");
      tick(LATENCY.read);
      if (faults.has("stored-read-short")) {
        t.log("warn", `The database said ${heldHere.length} rows and ${heldHere.length - 9} came back. Carrying on would upload nine held reviews as new ones.`);
        t.fail("SHORT_READ", `${heldHere.length - 9} of ${heldHere.length} rows came back.`, settings.storedRead.waitSeconds * SECOND);
        tick(settings.storedRead.waitSeconds * SECOND);
        t.start("stored.load", { listing: LISTINGS.ordinary, attempt: 2, of: settings.storedRead.attempts });
        tick(LATENCY.read);
        t.log("info", "The second read is complete. After the last attempt the listing would have been given up for this run, with nothing written.");
      }
      t.log("info", "Reviews are looked up by the listing and by every variation of it: a family's reviews are filed under the tracked listing, whichever member they were bought as.");
      t.ok({ rows: heldHere.length, expected: heldHere.length });

      // -- 9. One page, newest first -----------------------------------------------------
      t.start("collect.recent", { listing: LISTINGS.ordinary, strategy: "0: the most recent page", costs: "one page" });
      tick(LATENCY.page * 2);
      pagesSpent += 2;
      if (faults.has("count-unreadable")) {
        t.log("error", "The page loaded without a review count. No count is not zero reviews: read as zero, this listing would be marked complete with reviews still missing.");
        t.fail("COUNT_UNREADABLE", "The review count could not be read. The listing is left for another run.");
        setItem(mine.id, LISTINGS.ordinary, "failed", "review count unreadable");
        for (const step of ["collect.walk", "collect.members", "reviews.store"] as const) t.skip(step, `${LISTINGS.ordinary} was left for another run: its review count could not be read.`);
      } else {
        const page = recentPage(pool);
        let found = splitNew(page, known);
        const closedEarly = found.length >= missing;
        t.log("info", `The count reads ${marketCount}; ${heldHere.length} are held, so ${missing} ${missing === 1 ? "is" : "are"} missing. The page shows the ${page.length} newest: ${plural(found.length, "new review")}.`);
        if (closedEarly) t.log("info", "The gap is closed for the price of one page. Nothing deeper runs.");
        else t.log("info", found.length === 0 ? "Nothing new on the first page, and the count still says a review is missing. It is older than anything here." : `${missing - found.length} still missing after the first page.`);
        t.ok({ pages: 2, new_reviews: found.length, still_missing: Math.max(0, missing - found.length) });

        // -- 10. The whole pool ----------------------------------------------------------
        let complete = false;
        let cards: Record<string, number> = {};
        let seenIds = new Set(page.map((review) => review.id));
        if (closedEarly) {
          t.skip("collect.walk", "The first page closed the gap, so the walk was not needed.");
        } else {
          t.start("collect.walk", { listing: LISTINGS.ordinary, strategy: "1: every critical review", view_shows_at_most: limit });
          const walk = walkView(pool);
          tick(LATENCY.page * (walk.pages + 1));
          pagesSpent += walk.pages + 1;
          const parsed = faults.has("pages-parse-nothing") ? [] : walk.seen;
          seenIds = new Set(parsed.map((review) => review.id));
          cards = {};
          for (const review of parsed) cards[review.boughtAs] = (cards[review.boughtAs] ?? 0) + 1;
          complete = poolWalkComplete(marketCount, seenIds.size, walk.walkedEveryPage);
          const more = splitNew(parsed, new Set([...known, ...found.map((review) => review.id)]));
          found = [...found, ...more];
          if (faults.has("pages-parse-nothing")) {
            t.log("error", `${plural(walk.pages, "page")} loaded and not one review was parsed from them. That is a parser problem, not an empty listing.`);
            t.log("warn", `A walk counts as complete only if at least ${Math.round(settings.walk.parsedShare * 100)}% of the counted reviews were parsed. This one is not complete, so nothing is concluded from it.`);
          } else {
            t.log("info", `${marketCount} is under the ${limit} a view shows, so one walk sees every review there is: ${plural(walk.pages, "page")}, ${plural(more.length, "more new review")}.`);
            if (criticalCoversAll(marketCount)) t.log("info", "Slicing by star, by helpfulness or by keyword cannot show anything this walk did not, so none of it runs.");
          }
          t.ok({ pages: walk.pages + 1, parsed: parsed.length, new_reviews: more.length, whole_pool_seen: complete }, faults.has("pages-parse-nothing") ? "Pages loaded, nothing parsed." : undefined);
        }

        // -- 11. Family members ----------------------------------------------------------
        const stillMissing = Math.max(0, missing - found.length);
        const heldByMember: Record<string, number> = {};
        for (const review of heldHere) if (review.variation) heldByMember[review.variation] = (heldByMember[review.variation] ?? 0) + 1;
        t.start("collect.members", { listing: LISTINGS.ordinary, other_members: family.length - 1, whole_pool_seen: complete, still_missing: stillMissing });
        const plan = membersToVisit(LISTINGS.ordinary, family, complete, cards, heldByMember);
        let visited = 0;
        if (family.length === 1) {
          t.log("info", "The listing has no variations, so there is nothing more to visit.");
        } else if (stillMissing === 0) {
          if (complete) t.log("info", `${plural(plan.skipped.length, "member")} appeared on the cards of the walk: a page of their own would show a part of what was just read. ${plural(plan.visit.length, "member")} gave no sign of having reviews.`);
          t.log("info", "The gap is closed, so no member is visited at all.");
        } else {
          t.log("warn", "Without a complete walk nothing is skipped on its evidence. Members are visited in order of the evidence that they have reviews, and the visits stop when the gap closes.");
          for (const member of plan.visit) {
            const view = walkView(pool.filter((review) => review.boughtAs === member));
            tick(LATENCY.page * (view.pages + 1));
            pagesSpent += view.pages + 1;
            visited += 1;
            const more = splitNew(view.seen, new Set([...known, ...found.map((review) => review.id)]));
            found = [...found, ...more];
            for (const review of view.seen) seenIds.add(review.id);
            t.log("info", `${member}: ${plural(view.seen.length, "review")} on its own page, ${more.length} new.`);
            if (found.length >= missing) break;
          }
        }
        t.ok({ skipped_as_seen: complete ? plan.skipped : [], considered: plan.visit, visited, new_reviews_so_far: found.length });

        // -- 12. Store, and decide whether the listing is done ---------------------------
        t.start("reviews.store", { listing: LISTINGS.ordinary, to_store: found.length, filed_under: LISTINGS.ordinary });
        tick(LATENCY.write);
        for (const review of found) {
          known.add(review.id);
          held = [...held, stored(review.id, review.star, LISTINGS.ordinary, review.boughtAs)];
        }
        if (found.length > 0) t.change("reviews", "insert", `${found.length} rows under ${LISTINGS.ordinary}`, null, snap({ ids: found.slice(0, 4).map((review) => review.id).concat(found.length > 4 ? [`and ${found.length - 4} more`] : []), variation: "taken from each review's own card" }));
        t.log("info", "Before writing, the ids are looked up across the whole table, and after writing they are read back. A write the database did not confirm leaves the walk unfinished and retryable.");
        ordinaryRemaining = complete ? remainingAfterFullWalk(marketCount, seenIds, known) : Math.max(0, missing - found.length);
        const done = ordinaryRemaining === 0;
        if (complete) t.log("info", `The whole pool was seen, so "done" is decided by review id: ${marketCount} counted, ${marketCount - ordinaryRemaining} of them seen and in the database.`);
        if (!done) t.log("warn", `${found.length} new, ${ordinaryRemaining} still missing. The listing is not called done and comes back in the next cycle.`);
        collected.ordinary = found.length;
        setItem(mine.id, LISTINGS.ordinary, done ? "done" : "failed", done ? `${found.length} new, complete` : `${found.length} new, still missing ${ordinaryRemaining}`);
        t.ok({ stored: found.length, still_missing: ordinaryRemaining, done }, done ? undefined : "The listing is not complete.");
      }
    }

    // -- 13. The large listing ---------------------------------------------------------
    if (!queued(LISTINGS.large)) {
      t.skip("large.ladder", `${LISTINGS.large} was kept out of the queue by the note beside it.`);
    } else {
      const large = largeListing();
      const largeHeld = held.filter((review) => review.filedUnder === LISTINGS.large).length;
      const largeMissing = large.pool.length - largeHeld;
      let largeFound = 0;
      const take = (label: string, view: readonly LiveReview[], pages: number, note: string) => {
        tick(LATENCY.page * pages);
        pagesSpent += pages;
        const more = splitNew(view, known);
        for (const review of more) {
          known.add(review.id);
          held = [...held, stored(review.id, review.star, LISTINGS.large, review.boughtAs)];
        }
        largeFound += more.length;
        t.log("info", `${label}: ${plural(pages, "page")}, ${plural(more.length, "new review")}.${note ? ` ${note}` : ""}`);
      };
      const firstRungs = () => {
        take("0, the most recent page", recentPage(large.pool), 2, "");
        const walk = walkView(large.pool);
        take("1, every critical review", walk.seen, 1 + walk.pages, `The view stops at ${limit}; the listing has ${large.pool.length}.`);
      };
      const upperRungs = () => {
        for (const star of STARS) {
          const ofStar = large.pool.filter((review) => review.star === star);
          const view = walkView(ofStar);
          take(`2, ${star}-star reviews`, view.seen, 1 + view.pages, view.walkedEveryPage ? `All ${ofStar.length} fit in the view.` : `${ofStar.length - view.seen.length} are past the end of the view.`);
        }
        const helpful = walkView(large.pool, "helpful");
        take("2.5, most helpful first", helpful.seen, 1 + helpful.pages, "A different order surfaces different reviews.");
      };

      t.start("large.ladder", { listing: LISTINGS.large, marketplace_count: large.pool.length, held: largeHeld, missing: largeMissing, view_shows_at_most: limit, machine: MACHINES.first });
      setItem(mine.id, LISTINGS.large, "running");
      t.log("info", "Past the limit no single view shows everything, so the collector climbs: cheapest view first, stopping as soon as the gap closes.");
      firstRungs();
      if (faults.has("machine-dies")) {
        const storedSoFar = largeFound;
        setBatch({ ...current(mine.id), heartbeatAt: clock });
        t.log("error", `${MACHINES.first} loses power. Its heartbeat stops; batch ${mine.id} still says "running", and so does ${LISTINGS.large}.`);
        tick(4 * 60 * SECOND);
        const early = claim(current(mine.id), MACHINES.second, RUNS.second, clock);
        t.log("info", `Four minutes later ${MACHINES.second} asks for work. The batch is not free: its last heartbeat is younger than ${settings.queue.staleMinutes} minutes, so the update changes ${early ? "one row" : "nothing"}.`);
        const wait = (settings.queue.staleMinutes - 4 + 1) * 60 * SECOND;
        t.fail("MACHINE_LOST", `${MACHINES.first} stopped mid-listing. The batch is released by silence, not by a message.`, wait);
        tick(wait);
        t.start("large.ladder", { listing: LISTINGS.large, machine: MACHINES.second, run: RUNS.second, taken_over_after_minutes: settings.queue.staleMinutes + 1 });
        mine = claim(current(mine.id), MACHINES.second, RUNS.second, clock)!;
        setBatch(mine, `${MACHINES.second} takes the batch over. What ${MACHINES.first} finished stays finished; the listing it was in the middle of goes back to "queued" and is started again.`);
        setItem(mine.id, LISTINGS.large, "running");
        t.log("info", `The ${plural(storedSoFar, "review")} ${MACHINES.first} had already stored are found by id and not written twice.`);
        firstRungs();
      }
      upperRungs();
      largeRemaining = largeMissing - largeFound;
      collected.large = largeFound;
      t.change("reviews", "insert", `${largeFound} rows under ${LISTINGS.large}`, null, { stored: largeFound });
      t.log(largeRemaining > 0 ? "warn" : "info", largeRemaining > 0 ? `${largeFound} of ${largeMissing} found. ${largeRemaining} are in no view at all: older one-star reviews past the end of every list.` : `All ${largeMissing} found.`);
      if (largeRemaining > 0) t.log("info", "The next report files what is left as out of reach, and a keyword search for those reviews is queued as its own kind of batch.");
      setItem(mine.id, LISTINGS.large, "done", `${largeFound} new, ${largeRemaining} past every view`);
      t.ok({ found: largeFound, missing_before: largeMissing, past_every_view: largeRemaining, taken_over: faults.has("machine-dies") }, largeRemaining > 0 ? `${largeRemaining} reviews are beyond every view.` : undefined);
    }
    setBatch(release(current(mine.id), mine.runId!));
  }

  // -- 14. A person decides about the review on a stranger's product ---------------------
  const strangers = verdicts.filter((entry) => entry.verdict === "other_product");
  const summary = (extra: Record<string, Json>): Json => ({
    listings: listings.length,
    collected_ordinary: collected.ordinary,
    collected_large: collected.large,
    ordinary_still_missing: ordinaryRemaining,
    large_past_every_view: largeRemaining,
    pages_read_collecting: pagesSpent,
    verdicts: verdicts.reduce<Record<string, number>>((all, entry) => ({ ...all, [entry.verdict]: (all[entry.verdict] ?? 0) + 1 }), {}),
    ...extra,
  });
  const ordinaryLine = queued(LISTINGS.ordinary) ? `${collected.ordinary} for ${LISTINGS.ordinary}${ordinaryRemaining ? ` (${ordinaryRemaining} still missing)` : ""}` : `nothing for ${LISTINGS.ordinary}, which had no gap`;
  const largeLine = queued(LISTINGS.large) ? `${collected.large} for ${LISTINGS.large}${largeRemaining ? `, with ${largeRemaining} past every view` : ""}` : `nothing for ${LISTINGS.large}, kept out by a note`;
  const collectedLine = `Collected ${ordinaryLine}, and ${largeLine}.`;
  if (strangers.length === 0) {
    const why = hasCheck ? "No review was found attached to a product nobody tracks, so there was nothing to archive." : "Nothing was checked, so there was nothing to archive.";
    t.skip("cleanup.decide", why);
    t.skip("cleanup.write", why);
    const unknown = verdicts.filter((entry) => entry.verdict === "unknown").length;
    const checkLine = checkStopped ? ` The check of ${LISTINGS.extra} stopped when the session lost access: ${plural(unknown, "review")} left unknown, none called gone.` : "";
    t.finish("success", `${collectedLine}${checkLine}`, summary({ archived: 0 }));
    return;
  }
  const items: ArchiveItem[] = strangers.map((entry) => ({ id: entry.id, from: LISTINGS.extra, product: entry.product! }));
  const world = {
    activeListings: new Set<string>(listings.filter((listing) => listing.live).map((listing) => listing.id)),
    families: { [LISTINGS.extra]: EXTRA_FAMILY, [LISTINGS.ordinary]: ordinaryFamily(input.members) } as Record<string, readonly string[]>,
    archived: new Set<string>(),
  };
  t.start("cleanup.decide", { run: ARCHIVE_RUN, reviews: items.length, from: LISTINGS.extra, product: items[0].product, writes: "nothing yet" });
  tick(LATENCY.read);
  t.log("info", `The cleanup tool lists what the checks found and writes nothing: ${items[0].id} would leave the comparison and go to the archive under ${items[0].product}.`);
  t.log("info", "The two reviews found gone need no cleanup. Their verdict alone takes them out of tomorrow's count.");
  t.wait(`${plural(items.length, "review")} of ${LISTINGS.extra} is attached to ${items[0].product}, a product nobody tracks. The run is a preview until someone writes it.`, [
    { id: "write", label: "Write the run", description: "The database moves the review to the archive and keeps the whole row, so the run can be undone." },
    { id: "leave", label: "Leave it as a preview", description: "Nothing changes. The review keeps its verdict and stays where it is." },
  ]);
  const decision = yield;
  t.resumed(decision);
  if (decision !== "write") {
    t.ok({ decision: "left as a preview", rows_changed: 0 });
    t.skip("cleanup.write", "The run was left as a preview.");
    t.finish("success", `${collectedLine} The archive run was left as a preview: nothing was moved, and the review keeps its verdict.`, summary({ archived: 0, decision: "preview" }));
    return;
  }
  t.ok({ decision: "write", run: ARCHIVE_RUN });

  // -- 15. The database does it, row by row -----------------------------------------------
  t.start("cleanup.write", { run: ARCHIVE_RUN, reviews: items.length, by: "a database function, one review at a time" });
  tick(LATENCY.write);
  if (faults.has("refiled-since-check")) held = held.map((review) => (review.id === items[0].id ? { ...review, filedUnder: REFILED_UNDER } : review));
  let archived = 0;
  for (const item of items) {
    const before = held.find((review) => review.id === item.id);
    const outcome = archiveOutcome(item, before, world);
    if (outcome === "archived" && before) {
      archived += 1;
      held = held.filter((review) => review.id !== item.id);
      t.change("review changes", "insert", `${item.id} row`, null, snap({ old: "the whole review, as it was", new: `archived under ${item.product}`, status: "applied", run: ARCHIVE_RUN }));
      t.change("archive", "insert", item.id, null, { under: item.product, active: false });
      t.change("reviews", "delete", item.id, snap({ filed_under: before.filedUnder, star: before.star }), null);
      t.log("info", `${item.id}: archived. The row was locked, checked again, copied to the archive and logged in full before it was deleted.`);
    } else {
      t.log("warn", `${item.id}: ${outcome}. Another writer moved it after it was checked, so the function leaves it alone and says why.`);
    }
  }
  t.log("info", `Undoing ${ARCHIVE_RUN} puts each review back as it was, unless something changed it after the archive.`);
  t.ok({ archived, skipped: items.length - archived, undo: "by run id" }, archived < items.length ? "A review had changed since it was checked." : undefined);

  // Tomorrow's report, computed with the same rules on what the run left behind.
  const tomorrow = buildReport(listings, held, comments).find((row) => row.listing === LISTINGS.extra)!;
  const tomorrowLine = tomorrow.diff !== null && tomorrow.reason ? ` Tomorrow ${LISTINGS.extra} shows ${-tomorrow.diff} more than the marketplace, filed under "${REASONS[tomorrow.reason].label}": ${tomorrow.action?.toLowerCase()}.` : "";
  t.finish("success", `${collectedLine} ${archived > 0 ? `${plural(archived, "review")} archived, and the run can be undone.` : "The archive run changed nothing: the review had been refiled since it was checked."}${tomorrowLine}`, summary({ archived, decision: "written" }));
}

export const reviewsScenario: Scenario<ReviewsInput> = {
  id: REVIEWS_SCENARIO_ID,
  stepIds: REVIEWS_STEPS,
  run,
};
