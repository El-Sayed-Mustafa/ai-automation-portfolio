/**
 * The rules of the review pipeline, as pure functions.
 *
 * Each one mirrors a piece of the real system and names the file it was read
 * in. The real system is Python; these are re-implementations for the demo,
 * checked against that source by reading it, not by running it.
 *
 * Every limit is the demo's own and lives in DEMO_SETTINGS. The pipeline's
 * real thresholds are not published, so none of them is copied here.
 */

export type Star = 1 | 2 | 3;
export const STARS: readonly Star[] = [1, 2, 3];
export type StarCounts = Record<Star, number>;

/** Invented for this page. Not the values the real pipeline runs with. */
export const DEMO_SETTINGS = {
  /** A filtered review list shows this many reviews a page and stops after this many pages. */
  views: { pageSize: 10, pages: 5 },
  /** A listing younger than this is new, not neglected. */
  onboardingGraceDays: 5,
  /** Under this many reviews per page a gap is still collected, after everything cheaper. */
  lowYield: 0.1,
  /** Above this many pages a listing is Hard whatever else is true. */
  mediumMaxPages: 40,
  /** What a run still finds on a listing whose held reviews already fill every view. */
  pastWindowFloor: 2,
  queue: { batchSize: 2, heartbeatSeconds: 90, staleMinutes: 10 },
  storedRead: { attempts: 4, waitSeconds: 4 },
  walk: { parsedShare: 0.8, maxUnevidencedVisits: 2 },
  verify: { maxPermalinks: 8 },
} as const;

type Settings = typeof DEMO_SETTINGS;

export const total = (counts: StarCounts): number => counts[1] + counts[2] + counts[3];
export const emptyCounts = (): StarCounts => ({ 1: 0, 2: 0, 3: 0 });

/** How many reviews one filtered view can show before the marketplace stops paging. */
export const viewLimit = (settings: Settings = DEMO_SETTINGS): number => settings.views.pageSize * settings.views.pages;

// -- What is held --------------------------------------------------------------

export type Verdict = "on_this_product" | "family_member" | "other_product" | "star_changed" | "gone" | "not_listed" | "unknown";

export interface StoredReview {
  id: string;
  star: Star;
  /** The tracked listing it is filed under. A family's reviews are kept under that one listing on purpose. */
  filedUnder: string;
  /** The family member it was bought as, when that is known. */
  variation: string | null;
  removed: boolean;
  mainDomain: boolean;
  /** The latest verdict of a check against the marketplace, if it was ever checked. */
  verdict?: Verdict;
}

/** Verdicts that take a review out of the comparison: it is not on the listing any more. OptimumChecker.py, lines 809-850. */
const NOT_HELD: readonly Verdict[] = ["gone", "other_product", "not_listed"];

export function countsAsHeld(review: StoredReview): boolean {
  return !review.removed && review.mainDomain && !(review.verdict && NOT_HELD.includes(review.verdict));
}

/** The held side of the comparison, per star. OptimumChecker.py, precompute_db_review_counts. */
export function heldCounts(stored: readonly StoredReview[], listing: string): StarCounts {
  const counts = emptyCounts();
  for (const review of stored) if (review.filedUnder === listing && countsAsHeld(review)) counts[review.star] += 1;
  return counts;
}

// -- What a run would cost -----------------------------------------------------

/** Pages a full walk of n reviews takes, under the marketplace's page cap. scrape_planning.py, walk_pages. */
export function walkPages(n: number, settings: Settings = DEMO_SETTINGS): number {
  return Math.min(settings.views.pages, Math.max(1, Math.ceil(Math.max(0, n) / settings.views.pageSize)));
}

export interface Estimate {
  /** Reviews the marketplace shows that are not held. Null when the listing was never measured. */
  gap: number | null;
  /** Of those, how many a run can expect to reach. */
  reachable: number;
  /** Page loads the run is expected to cost. */
  pages: number;
  /** reachable / pages. */
  score: number;
  group: "gap" | "unknown" | "no gap";
  note: string;
}

/**
 * Expected yield and page cost of one collector run. scrape_planning.py, estimate_asin.
 *
 * Under the view limit one walk sees the whole pool. Past it the run also pays
 * for a walk per star, the helpful ordering and a slice per family member, and
 * what is missing mostly lies where no view reaches.
 */
export function estimate(market: StarCounts | null, held: number, familySize = 1, settings: Settings = DEMO_SETTINGS): Estimate {
  const fixed = 3; // the product page, the first review page, the canonical review page
  const recent = 2; // the most-recent view: load it, read one page
  if (market === null) return { gap: null, reachable: 0, pages: fixed + recent, score: 0, group: "unknown", note: "never measured against the marketplace" };

  const limit = viewLimit(settings);
  const amount = total(market);
  const gap = amount - held;
  const criticalWalk = 1 + walkPages(amount, settings);
  if (gap <= 0) {
    return { gap, reachable: 0, pages: fixed + (amount <= limit ? criticalWalk : recent), score: 0, group: "no gap", note: "the database already covers the measured count" };
  }
  if (amount <= limit) {
    const pages = fixed + recent + criticalWalk;
    return { gap, reachable: gap, pages, score: round3(gap / pages), group: "gap", note: "the whole pool is visible" };
  }
  const perStar = STARS.reduce((sum, star) => sum + (market[star] > 0 ? 1 + walkPages(market[star], settings) : 0), 0);
  const helpful = 1 + settings.views.pages;
  const members = Math.max(0, familySize - 1);
  const memberPages = members * (1 + walkPages(Math.ceil(amount / (members + 1)), settings));
  const pages = fixed + recent + criticalWalk + perStar + helpful + memberPages;
  const visible = STARS.reduce((sum, star) => sum + Math.min(market[star], limit), 0) + limit;
  const reachable = Math.min(gap, Math.max(visible - held, settings.pastWindowFloor));
  return { gap, reachable, pages, score: round3(reachable / pages), group: "gap", note: reachable === gap ? "past the view limit" : `past the view limit, about ${reachable} reachable` };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type Difficulty = "Easy" | "Medium" | "Hard" | "Not measured";

/** OptimumChecker.py, classify_difficulty. Easy is a shape, not a page count: the whole pool fits in one view. */
export function classifyDifficulty(run: Estimate, marketTotal: number | null, settings: Settings = DEMO_SETTINGS): Difficulty {
  if (run.gap === null || marketTotal === null) return "Not measured";
  if (run.reachable < run.gap || run.pages > settings.mediumMaxPages) return "Hard";
  return marketTotal <= viewLimit(settings) ? "Easy" : "Medium";
}

// -- From a difference to a reason ---------------------------------------------

export type Action = "Scrape" | "Track first" | "Investigate" | "Decide" | "Leave it";

export type ReasonId =
  | "dead"
  | "no-tracking"
  | "never-collected"
  | "possible-merge"
  | "abnormal"
  | "extra"
  | "extra-family"
  | "missing"
  | "low-yield"
  | "kept-from-departed";

/**
 * Each reason, what to do about it, and what it claims. OptimumChecker.py, REASON_PLAYBOOK.
 * The labels are reworded for this page: the real ones name the marketplace.
 */
export const REASONS: Record<ReasonId, { label: string; action: Action; meaning: string }> = {
  dead: { label: "Dead listing", action: "Leave it", meaning: "The listing is not live. Any difference in numbers is secondary: there is nothing to read." },
  "no-tracking": { label: "No tracking data yet", action: "Track first", meaning: "The listing was never measured against the marketplace, so there is no difference to act on. Measure it before collecting." },
  "never-collected": { label: "Nothing collected since it was added", action: "Scrape", meaning: "The marketplace shows reviews, none is held, and the listing is past its first days." },
  "possible-merge": { label: "Possible merge, not recorded", action: "Investigate", meaning: "Several listings of one client report identical star counts and are not linked as variations. A signal, not proof." },
  abnormal: { label: "Variation counts disagree", action: "Investigate", meaning: "Members of one family report different counts. Counting the family member by member settles it." },
  extra: { label: "More held than shown", action: "Decide", meaning: "The database holds more than the marketplace counts. It can be a removal, a stale measurement or reviews that moved. It is not proof that the data is wrong." },
  "extra-family": { label: "More held, explained by the family", action: "Leave it", meaning: "At least as many held reviews belong to the listing's variations as the difference. They are kept under the tracked listing on purpose." },
  missing: { label: "Missing reviews", action: "Scrape", meaning: "The marketplace shows more than is held. An ordinary gap worth collecting." },
  "low-yield": { label: "Missing, low yield", action: "Scrape", meaning: "The gap is real but expensive: the pages a run needs buy few reviews. Collected after everything cheaper." },
  "kept-from-departed": { label: "Reviews kept from a variation that left", action: "Leave it", meaning: "A variation left the family, so its reviews are no longer counted here. They stay with the client and out of the comparison." },
};

export interface ReasonFacts {
  live: boolean;
  abnormal: boolean;
  hasTracking: boolean;
  held: number;
  market: number;
  /** market minus held. Positive: reviews to collect. Negative: more held than shown. */
  diff: number;
  yieldPerPage: number;
  /** Days since the listing was taken on. Null when unknown. */
  activationAge: number | null;
  mergeSuspect: boolean;
  /** Held reviews that belong to the listing's variations. */
  familyReviews: number;
  departedReviews: number;
  /** True once the marketplace's count was read for every member of the family on one day. */
  familyCounted: boolean;
}

/**
 * Every reason that applies, most blocking first. OptimumChecker.py, all_gap_reasons.
 *
 * The first one is what the listing is filed under. The rest are kept, so a
 * filter on any one rule finds every listing it touches and not only those
 * where it happened to come first.
 */
export function allGapReasons(facts: ReasonFacts, settings: Settings = DEMO_SETTINGS): ReasonId[] {
  const reasons: ReasonId[] = [];
  if (!facts.live) reasons.push("dead");
  if (!facts.hasTracking) reasons.push("no-tracking");
  if (facts.held === 0 && facts.market > 0 && facts.activationAge !== null && facts.activationAge > settings.onboardingGraceDays) reasons.push("never-collected");
  const settled = facts.familyCounted && facts.diff === 0;
  if (facts.mergeSuspect && !settled) reasons.push("possible-merge");
  if (facts.abnormal && !facts.familyCounted) reasons.push("abnormal");
  if (facts.diff < 0) {
    // A family counted member by member already includes every variation, so its reviews cannot explain holding more.
    const explained = facts.familyReviews >= -facts.diff && !facts.familyCounted;
    reasons.push(explained ? "extra-family" : "extra");
  } else if (facts.diff > 0) {
    reasons.push(facts.yieldPerPage < settings.lowYield ? "low-yield" : "missing");
  }
  if (facts.departedReviews > 0) reasons.push("kept-from-departed");
  return reasons;
}

// -- The daily report and the queue --------------------------------------------

export interface ReportRow {
  listing: string;
  live: boolean;
  market: StarCounts | null;
  held: StarCounts;
  /** Null when the listing was never measured. */
  diff: number | null;
  reasons: ReasonId[];
  /** The first reason: what the listing is filed under. Null when nothing is wrong. */
  reason: ReasonId | null;
  action: Action | null;
  difficulty: Difficulty;
  pages: number;
  reachable: number;
  reviewsPerPage: number;
  /** What a person typed beside the row. It survives every rewrite of the report. */
  comment: string;
}

/**
 * The listings that enter the collecting queue. build_work_queue.py, select_rows.
 * A row a person commented on is kept out: the note doubles as "do not collect".
 */
export function selectForCollecting(rows: readonly ReportRow[], alreadyQueued: ReadonlySet<string>): ReportRow[] {
  return rows.filter((row) => row.action === "Scrape" && row.live && row.comment.trim() === "" && !alreadyQueued.has(row.listing));
}

/** The listings whose held reviews are opened one by one. build_verify_batches.py: the ones filed under "more held than shown". */
export function selectForChecking(rows: readonly ReportRow[], alreadyQueued: ReadonlySet<string>): ReportRow[] {
  return rows.filter((row) => row.reason === "extra" && row.live && !alreadyQueued.has(row.listing));
}

const DIFFICULTY_ORDER: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2, "Not measured": 3 };

/**
 * Cheapest work first. build_work_queue.py, order_rows: low yield last whatever
 * its label, then Easy before Medium before Hard, then the listing whose pages
 * buy the most reviews. The gap and the id break the last ties, so every
 * machine computes the same order.
 */
export function orderRows(rows: readonly ReportRow[]): ReportRow[] {
  const key = (row: ReportRow) => [row.reason === "low-yield" ? 1 : 0, DIFFICULTY_ORDER[row.difficulty], -row.reviewsPerPage, -(row.diff ?? 0)] as const;
  return [...rows].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.listing < b.listing ? -1 : a.listing > b.listing ? 1 : 0;
  });
}

export type BatchKind = "scrape" | "verify";
export type BatchStatus = "queued" | "running" | "done" | "cancelled";
export type ItemStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface WorkItem {
  listing: string;
  status: ItemStatus;
  note?: string;
}

export interface Batch {
  id: number;
  kind: BatchKind;
  /** Lower is taken first. Checking batches go ahead of every collecting batch. */
  priority: number;
  status: BatchStatus;
  machine: string | null;
  runId: string | null;
  /** Virtual seconds. */
  heartbeatAt: number | null;
  items: WorkItem[];
}

/** build_work_queue.py, plan_batches, and build_verify_batches.py: checking batches get priority 0, collecting ones start at 1. */
export function planBatches(collecting: readonly ReportRow[], checking: readonly ReportRow[], firstId: number, settings: Settings = DEMO_SETTINGS): Batch[] {
  const size = settings.queue.batchSize;
  const batches: Batch[] = [];
  const add = (kind: BatchKind, priority: number, rows: readonly ReportRow[]) =>
    batches.push({ id: firstId + batches.length, kind, priority, status: "queued", machine: null, runId: null, heartbeatAt: null, items: rows.map((row) => ({ listing: row.listing, status: "queued" })) });
  for (let i = 0; i < checking.length; i += size) add("verify", 0, checking.slice(i, i + size));
  const ordered = orderRows(collecting);
  for (let i = 0; i < ordered.length; i += size) add("scrape", 1 + i / size, ordered.slice(i, i + size));
  return batches;
}

/** A batch is free when nobody holds it, or when whoever holds it has been silent too long. work_queue.py, lines 179-188. */
export function claimable(batch: Batch, now: number, settings: Settings = DEMO_SETTINGS): boolean {
  if (batch.status === "queued") return true;
  return batch.status === "running" && batch.heartbeatAt !== null && now - batch.heartbeatAt > settings.queue.staleMinutes * 60;
}

/**
 * One guarded update: it only changes the row if the batch is still free at
 * that moment, so two machines asking together cannot both get it. The claim
 * is then read back by run id, which is how a machine learns it won.
 *
 * A machine that died mid-batch leaves listings marked running. Its finished
 * ones stay finished; the rest go back so the new holder picks them up.
 * work_queue.py, lines 179-212.
 */
export function claim(batch: Batch, machine: string, runId: string, now: number, settings: Settings = DEMO_SETTINGS): Batch | null {
  if (!claimable(batch, now, settings)) return null;
  return { ...batch, status: "running", machine, runId, heartbeatAt: now, items: batch.items.map((item) => (item.status === "running" ? { ...item, status: "queued" } : item)) };
}

/**
 * Letting go of a batch. With nothing open it is done; otherwise it returns to
 * the queue with its owner cleared. Guarded by run id, so a batch another
 * machine has taken since is left alone. work_queue.py, lines 290-335.
 */
export function release(batch: Batch, runId: string): Batch {
  if (batch.runId !== runId) return batch;
  const open = batch.items.some((item) => item.status === "queued" || item.status === "running");
  if (!open) return { ...batch, status: "done" };
  return { ...batch, status: "queued", machine: null, runId: null, heartbeatAt: null, items: batch.items.map((item) => (item.status === "running" ? { ...item, status: "queued" } : item)) };
}

// -- Reading the marketplace -----------------------------------------------------

export interface LiveReview {
  id: string;
  star: Star;
  /** Days since it was posted. Smaller is newer. */
  age: number;
  /** Helpful votes: the other order a view can be read in. */
  votes: number;
  /** The family member it was bought as, read from the review's own card. */
  boughtAs: string;
}

export interface Walk {
  seen: LiveReview[];
  pages: number;
  /** False when the view stopped at the page cap with reviews still beyond it. */
  walkedEveryPage: boolean;
}

/** One filtered view of a pool, read to its end or to the page cap, newest first unless told otherwise. */
export function walkView(pool: readonly LiveReview[], order: "recent" | "helpful" = "recent", settings: Settings = DEMO_SETTINGS): Walk {
  const sorted = [...pool].sort((a, b) => (order === "recent" ? a.age - b.age : b.votes - a.votes) || (a.id < b.id ? -1 : 1));
  const limit = viewLimit(settings);
  return { seen: sorted.slice(0, limit), pages: walkPages(pool.length, settings), walkedEveryPage: pool.length <= limit };
}

/** The cheapest pass there is: one page, newest first. reviews_scrapper.py, strategy 0. */
export function recentPage(pool: readonly LiveReview[], settings: Settings = DEMO_SETTINGS): LiveReview[] {
  return walkView(pool, "recent", settings).seen.slice(0, settings.views.pageSize);
}

/**
 * Under the view limit the plain walk already shows every review there is, so
 * slicing by star, by helpfulness or by keyword cannot surface anything new
 * and is skipped as pure cost. reviews_scrapper.py, lines 1808-1811.
 */
export function criticalCoversAll(marketCount: number, settings: Settings = DEMO_SETTINGS): boolean {
  return marketCount < viewLimit(settings);
}

/** Reviews in a walk that are in the database nowhere. The check is by review id across the whole table. db.py, persist_new_reviews. */
export function splitNew(seen: readonly LiveReview[], knownIds: ReadonlySet<string>): LiveReview[] {
  return seen.filter((review) => !knownIds.has(review.id));
}

/**
 * True when the pool was seen in full: under the limit, every page walked, and
 * most of the counted reviews actually parsed. A walk that loads pages and
 * parses nothing must never count as complete. scrape_planning.py, pool_walk_complete.
 */
export function poolWalkComplete(marketCount: number, uniqueSeen: number, walkedEveryPage: boolean, settings: Settings = DEMO_SETTINGS): boolean {
  return marketCount <= viewLimit(settings) && walkedEveryPage && marketCount > 0 && uniqueSeen >= settings.walk.parsedShare * marketCount;
}

/**
 * Which family members still need a visit after the pool was walked.
 * scrape_planning.py, members_to_visit.
 *
 * With the pool seen in full, a member whose reviews appeared in it shares the
 * pool: its page would show a subset of what was just read, so it is skipped.
 * The rest are ordered by evidence that they have reviews, and only a few with
 * no evidence at all get a visit.
 */
export function membersToVisit(
  listing: string,
  members: readonly string[],
  poolComplete: boolean,
  cardsSeen: Readonly<Record<string, number>>,
  heldByMember: Readonly<Record<string, number>> = {},
  settings: Settings = DEMO_SETTINGS,
): { visit: string[]; skipped: string[] } {
  const cards = (member: string) => cardsSeen[member] ?? 0;
  const held = (member: string) => heldByMember[member] ?? 0;
  const others = members.filter((member) => member !== listing);
  const skipped = poolComplete ? others.filter((member) => cards(member) > 0) : [];
  const candidates = (poolComplete ? others.filter((member) => cards(member) === 0) : others)
    .map((member, index) => ({ member, index }))
    .sort((a, b) => cards(b.member) - cards(a.member) || held(b.member) - held(a.member) || a.index - b.index)
    .map((entry) => entry.member);
  const evidenced = candidates.filter((member) => cards(member) > 0 || held(member) > 0);
  const unevidenced = candidates.filter((member) => !evidenced.includes(member));
  const limit = settings.walk.maxUnevidencedVisits;
  return { visit: [...evidenced, ...unevidenced.slice(0, limit)], skipped: [...skipped, ...unevidenced.slice(limit)] };
}

/**
 * What is still missing once the whole pool has been walked, by review id.
 * scrape_planning.py, remaining_after_full_walk.
 *
 * "Count minus what is filed under this listing" never closes for a listing
 * whose reviews are stored under a sibling. With the pool seen in full the
 * honest answer is how many counted reviews were not seen, or were seen and
 * are still not in the database.
 */
export function remainingAfterFullWalk(marketCount: number, seenIds: ReadonlySet<string>, knownIds: ReadonlySet<string>): number {
  let inDatabase = 0;
  for (const id of seenIds) if (knownIds.has(id)) inDatabase += 1;
  return Math.max(0, marketCount - inDatabase);
}

// -- Checking what is held -------------------------------------------------------

/** What opening one review's own page returned. */
export interface Permalink {
  /** The marketplace asked to sign in instead of showing the page. */
  signin: boolean;
  exists: boolean;
  /** Set only after a review known to be live opened correctly in the same session. */
  confirmedGone?: boolean;
  /** The product the page attaches the review to. */
  product: string | null;
  star: Star | null;
}

/**
 * The verdict for one opened permalink. review_verifier.py, classify.
 * "Not found" alone is never a removal: a session that has lost access shows
 * the same page. It becomes one only once it is confirmed.
 */
export function classifyPermalink(storedListing: string, storedStar: Star, found: Permalink, family: readonly string[]): Verdict {
  if (found.signin) return "unknown";
  if (!found.exists) return found.confirmedGone ? "gone" : "unknown";
  if (!found.product) return "unknown";
  if (family.includes(found.product) && found.star !== null && found.star !== storedStar) return "star_changed";
  if (found.product !== storedListing) return family.includes(found.product) ? "family_member" : "other_product";
  if (found.star !== null && found.star !== storedStar) return "star_changed";
  return "on_this_product";
}

// -- Changing what is held -------------------------------------------------------

/** One review to move out of the comparison: it is attached to a product that is not tracked. */
export interface ArchiveItem {
  id: string;
  /** The listing it was filed under when it was checked. */
  from: string;
  /** The product the marketplace shows it on. */
  product: string;
}

export interface ArchiveWorld {
  /** Listings being tracked for a client right now. */
  activeListings: ReadonlySet<string>;
  /** Members of the family of each tracked listing. */
  families: Readonly<Record<string, readonly string[]>>;
  /** Reviews the archive already holds. */
  archived: ReadonlySet<string>;
}

/**
 * What the database does with one review when a person writes an archive run.
 * migrations/20260929_archive_other_product_reviews.sql, scraping.archive_reviews.
 *
 * The list was chosen earlier, from checks that may be days old, so the
 * function locks the row and checks again that nothing changed in between and
 * that the product is none of the tracked ones.
 */
export function archiveOutcome(item: ArchiveItem, stored: StoredReview | undefined, world: ArchiveWorld): string {
  if (!stored) return "not in reviews";
  if (stored.filedUnder !== item.from) return `skipped: filed under ${stored.filedUnder} now`;
  if (world.archived.has(item.id)) return "skipped: already in the archive";
  if (!item.product || item.product === stored.filedUnder || world.activeListings.has(item.product)) return "skipped: product is an active listing of ours";
  for (const [listing, members] of Object.entries(world.families)) {
    if (world.activeListings.has(listing) && members.includes(item.product)) return "skipped: product is in the family of an active listing";
  }
  return "archived";
}

/**
 * What the database does with one proposed change to a column of a review.
 * migrations/20260925_review_change_log.sql, scraping.apply_review_changes, lines 177-186.
 */
export function changeOutcome(current: string | null, from: string | null, to: string | null): "applied" | "already correct" | "changed since check" {
  if (current === to) return "already correct";
  if (current !== from) return "changed since check";
  return "applied";
}
