import { describe, expect, it } from "vitest";
import {
  DEMO_SETTINGS,
  REASONS,
  allGapReasons,
  archiveOutcome,
  changeOutcome,
  claim,
  claimable,
  classifyDifficulty,
  classifyPermalink,
  countsAsHeld,
  criticalCoversAll,
  estimate,
  heldCounts,
  membersToVisit,
  orderRows,
  planBatches,
  poolWalkComplete,
  recentPage,
  release,
  remainingAfterFullWalk,
  selectForChecking,
  selectForCollecting,
  splitNew,
  viewLimit,
  walkPages,
  walkView,
  type Batch,
  type LiveReview,
  type ReasonFacts,
  type ReportRow,
  type StoredReview,
} from "./rules";

const LIMIT = viewLimit();
const held = (id: string, extra: Partial<StoredReview> = {}): StoredReview => ({ id, star: 1, filedUnder: "A", variation: null, removed: false, mainDomain: true, ...extra });
const live = (index: number, extra: Partial<LiveReview> = {}): LiveReview => ({ id: `r${index}`, star: 1, age: index, votes: 0, boughtAs: "A", ...extra });
const pool = (size: number) => Array.from({ length: size }, (_, index) => live(index));

describe("what counts as held", () => {
  it("leaves out removed reviews, other marketplaces, and reviews a check found gone or elsewhere", () => {
    expect(countsAsHeld(held("a"))).toBe(true);
    expect(countsAsHeld(held("a", { removed: true }))).toBe(false);
    expect(countsAsHeld(held("a", { mainDomain: false }))).toBe(false);
    for (const verdict of ["gone", "other_product", "not_listed"] as const) expect(countsAsHeld(held("a", { verdict }))).toBe(false);
    // A review on a sibling stays with the client, and an unreadable check proves nothing.
    for (const verdict of ["family_member", "on_this_product", "star_changed", "unknown"] as const) expect(countsAsHeld(held("a", { verdict }))).toBe(true);
  });

  it("counts per star, for one listing", () => {
    const rows = [held("a"), held("b", { star: 3 }), held("c", { star: 3, removed: true }), held("d", { filedUnder: "B" })];
    expect(heldCounts(rows, "A")).toEqual({ 1: 1, 2: 0, 3: 1 });
  });
});

describe("what a run would cost", () => {
  it("counts the pages of a walk, up to the cap", () => {
    expect(walkPages(0)).toBe(1);
    expect(walkPages(10)).toBe(1);
    expect(walkPages(11)).toBe(2);
    expect(walkPages(10_000)).toBe(DEMO_SETTINGS.views.pages);
  });

  it("knows nothing about a listing that was never measured", () => {
    expect(estimate(null, 5)).toMatchObject({ gap: null, reachable: 0, group: "unknown" });
  });

  it("expects nothing where the database already covers the count", () => {
    expect(estimate({ 1: 5, 2: 5, 3: 5 }, 15)).toMatchObject({ gap: 0, reachable: 0, group: "no gap" });
  });

  it("can reach the whole gap under the view limit, for a handful of pages", () => {
    const run = estimate({ 1: 20, 2: 10, 3: 10 }, 33);
    expect(run).toMatchObject({ gap: 7, reachable: 7, pages: 3 + 2 + 1 + 4, group: "gap" });
    expect(run.score).toBe(0.7);
  });

  it("pays for every extra view past the limit, and expects less than the gap when the held reviews fill the views", () => {
    const market = { 1: 200, 2: 60, 3: 40 };
    const run = estimate(market, 290, 3);
    // 3 fixed, 2 recent, 6 critical, per star 6 + 6 + 5, helpful 6, two members at 6.
    expect(run.pages).toBe(3 + 2 + 6 + 17 + 6 + 12);
    // The views show 50 + 50 + 40 + 50 = 190 at most; 290 are held, so only the floor is expected.
    expect(run.gap).toBe(10);
    expect(run.reachable).toBe(DEMO_SETTINGS.pastWindowFloor);
    expect(run.note).toMatch(/about 2 reachable/);
  });

  it("labels the work by shape first: Easy fits one view, Hard cannot be finished or costs too much", () => {
    expect(classifyDifficulty(estimate(null, 0), null)).toBe("Not measured");
    expect(classifyDifficulty(estimate({ 1: 20, 2: 10, 3: 10 }, 33), 40)).toBe("Easy");
    expect(classifyDifficulty(estimate({ 1: 62, 2: 28, 3: 38 }, 104), 128)).toBe("Medium");
    expect(classifyDifficulty(estimate({ 1: 200, 2: 60, 3: 40 }, 290, 3), 300)).toBe("Hard");
    expect(classifyDifficulty({ gap: 5, reachable: 5, pages: DEMO_SETTINGS.mediumMaxPages + 1, score: 0.1, group: "gap", note: "" }, 300)).toBe("Hard");
  });
});

describe("from a difference to a reason", () => {
  const base: ReasonFacts = { live: true, abnormal: false, hasTracking: true, held: 30, market: 30, diff: 0, yieldPerPage: 1, activationAge: 100, mergeSuspect: false, familyReviews: 0, departedReviews: 0, familyCounted: false };

  it("says nothing when nothing is wrong", () => {
    expect(allGapReasons(base)).toEqual([]);
  });

  it("puts the most blocking reason first and keeps the rest", () => {
    expect(allGapReasons({ ...base, live: false, hasTracking: false, held: 40, diff: -10 })).toEqual(["dead", "no-tracking", "extra"]);
  });

  it("calls a listing never collected only after its first days", () => {
    expect(allGapReasons({ ...base, held: 0, diff: 30, activationAge: DEMO_SETTINGS.onboardingGraceDays })).toEqual(["missing"]);
    expect(allGapReasons({ ...base, held: 0, diff: 30, activationAge: DEMO_SETTINGS.onboardingGraceDays + 1 })).toEqual(["never-collected", "missing"]);
    expect(allGapReasons({ ...base, held: 0, market: 0, diff: 0, activationAge: 400 })).toEqual([]);
  });

  it("explains an extra by the family only while the family has not been counted member by member", () => {
    expect(allGapReasons({ ...base, held: 36, diff: -6, familyReviews: 6 })).toEqual(["extra-family"]);
    expect(allGapReasons({ ...base, held: 36, diff: -6, familyReviews: 5 })).toEqual(["extra"]);
    expect(allGapReasons({ ...base, held: 36, diff: -6, familyReviews: 6, familyCounted: true })).toEqual(["extra"]);
  });

  it("drops a merge or an abnormal flag once counting the family has settled it", () => {
    expect(allGapReasons({ ...base, mergeSuspect: true, abnormal: true })).toEqual(["possible-merge", "abnormal"]);
    expect(allGapReasons({ ...base, mergeSuspect: true, abnormal: true, familyCounted: true })).toEqual([]);
    expect(allGapReasons({ ...base, mergeSuspect: true, familyCounted: true, diff: 2, held: 28 })).toEqual(["possible-merge", "missing"]);
  });

  it("still collects an expensive gap, last", () => {
    expect(allGapReasons({ ...base, held: 20, diff: 10, yieldPerPage: DEMO_SETTINGS.lowYield / 2 })).toEqual(["low-yield"]);
    expect(REASONS["low-yield"].action).toBe("Scrape");
  });

  it("always says when reviews were kept from a variation that left", () => {
    expect(allGapReasons({ ...base, departedReviews: 4 })).toEqual(["kept-from-departed"]);
  });

  it("maps every reason to one of five things to do", () => {
    expect(new Set(Object.values(REASONS).map((reason) => reason.action))).toEqual(new Set(["Scrape", "Track first", "Investigate", "Decide", "Leave it"]));
  });
});

describe("the queue", () => {
  const row = (listing: string, extra: Partial<ReportRow> = {}): ReportRow => ({ listing, live: true, market: { 1: 10, 2: 0, 3: 0 }, held: { 1: 5, 2: 0, 3: 0 }, diff: 5, reasons: ["missing"], reason: "missing", action: "Scrape", difficulty: "Easy", pages: 10, reachable: 5, reviewsPerPage: 0.5, comment: "", ...extra });

  it("queues what is to be scraped, alive, without a note and not queued already", () => {
    const rows = [row("a"), row("b", { live: false }), row("c", { comment: "wait" }), row("d", { action: "Decide", reason: "extra" }), row("e")];
    expect(selectForCollecting(rows, new Set(["e"])).map((item) => item.listing)).toEqual(["a"]);
    expect(selectForChecking(rows, new Set()).map((item) => item.listing)).toEqual(["d"]);
  });

  it("orders the work cheapest first, the same way on every machine", () => {
    const rows = [
      row("hard", { difficulty: "Hard" }),
      row("low", { reason: "low-yield", reviewsPerPage: 0.01 }),
      row("easy-poor", { reviewsPerPage: 0.2 }),
      row("medium", { difficulty: "Medium", reviewsPerPage: 0.9 }),
      row("easy-rich", { reviewsPerPage: 0.8 }),
      row("easy-rich-big", { reviewsPerPage: 0.8, diff: 9 }),
    ];
    const expected = ["easy-rich-big", "easy-rich", "easy-poor", "medium", "hard", "low"];
    expect(orderRows(rows).map((item) => item.listing)).toEqual(expected);
    expect(orderRows([...rows].reverse()).map((item) => item.listing)).toEqual(expected);
  });

  it("puts checking batches ahead of every collecting batch", () => {
    const batches = planBatches([row("a"), row("b"), row("c")], [row("x", { reason: "extra" })], 10);
    expect(batches.map((batch) => [batch.id, batch.kind, batch.priority, batch.items.length])).toEqual([
      [10, "verify", 0, 1],
      [11, "scrape", 1, 2],
      [12, "scrape", 2, 1],
    ]);
  });

  const batch = (extra: Partial<Batch> = {}): Batch => ({ id: 1, kind: "scrape", priority: 1, status: "queued", machine: null, runId: null, heartbeatAt: null, items: [{ listing: "a", status: "done" }, { listing: "b", status: "running" }, { listing: "c", status: "queued" }], ...extra });
  const stale = DEMO_SETTINGS.queue.staleMinutes * 60;

  it("gives a free batch to whoever asks, and a held one to nobody until it has been silent long enough", () => {
    expect(claimable(batch(), 0)).toBe(true);
    const running = batch({ status: "running", machine: "m1", runId: "r1", heartbeatAt: 100 });
    expect(claimable(running, 100 + stale)).toBe(false);
    expect(claim(running, "m2", "r2", 100 + stale)).toBeNull();
    expect(claimable(running, 100 + stale + 1)).toBe(true);
    expect(claimable(batch({ status: "done" }), 1e9)).toBe(false);
  });

  it("keeps what the first machine finished and gives back what it was in the middle of", () => {
    const running = batch({ status: "running", machine: "m1", runId: "r1", heartbeatAt: 0 });
    const taken = claim(running, "m2", "r2", stale + 1)!;
    expect(taken).toMatchObject({ status: "running", machine: "m2", runId: "r2", heartbeatAt: stale + 1 });
    expect(taken.items.map((item) => item.status)).toEqual(["done", "queued", "queued"]);
  });

  it("closes a batch only when nothing in it is open, and never lets go of one another run holds", () => {
    const mine = batch({ status: "running", machine: "m1", runId: "r1", heartbeatAt: 0 });
    expect(release(mine, "someone-else")).toBe(mine);
    expect(release(mine, "r1")).toMatchObject({ status: "queued", machine: null, runId: null, heartbeatAt: null });
    expect(release(mine, "r1").items.map((item) => item.status)).toEqual(["done", "queued", "queued"]);
    const finished = { ...mine, items: [{ listing: "a", status: "done" as const }, { listing: "b", status: "failed" as const }, { listing: "c", status: "skipped" as const }] };
    expect(release(finished, "r1").status).toBe("done");
  });
});

describe("reading the marketplace", () => {
  it("shows a view newest first and stops at the cap", () => {
    const walk = walkView(pool(LIMIT + 7).reverse());
    expect(walk.seen).toHaveLength(LIMIT);
    expect(walk.seen[0].id).toBe("r0");
    expect(walk.walkedEveryPage).toBe(false);
    expect(walkView(pool(LIMIT)).walkedEveryPage).toBe(true);
    expect(recentPage(pool(40)).map((review) => review.id)).toEqual(pool(10).map((review) => review.id));
  });

  it("surfaces different reviews in a different order", () => {
    const reviews = pool(LIMIT + 5).map((review, index) => ({ ...review, votes: index }));
    const helpful = walkView(reviews, "helpful").seen.map((review) => review.id);
    expect(helpful[0]).toBe(`r${LIMIT + 4}`);
    expect(helpful).not.toContain("r0");
  });

  it("skips every kind of slicing while one walk shows everything", () => {
    expect(criticalCoversAll(LIMIT - 1)).toBe(true);
    expect(criticalCoversAll(LIMIT)).toBe(false);
  });

  it("calls a review new only if its id is nowhere in the database", () => {
    expect(splitNew(pool(4), new Set(["r1", "r3"])).map((review) => review.id)).toEqual(["r0", "r2"]);
  });

  it("counts a walk as complete only when the pool fits, every page was read and most cards were parsed", () => {
    expect(poolWalkComplete(40, 40, true)).toBe(true);
    expect(poolWalkComplete(40, 32, true)).toBe(true);
    expect(poolWalkComplete(40, 31, true)).toBe(false);
    expect(poolWalkComplete(40, 0, true)).toBe(false);
    expect(poolWalkComplete(40, 40, false)).toBe(false);
    expect(poolWalkComplete(LIMIT + 1, LIMIT + 1, true)).toBe(false);
    expect(poolWalkComplete(0, 0, true)).toBe(false);
  });

  it("skips family members a complete walk already showed, and visits few with no evidence", () => {
    const members = ["A", "B", "C", "D", "E", "F"];
    const complete = membersToVisit("A", members, true, { B: 4 }, { C: 2 });
    expect(complete.skipped).toEqual(["B", "F"]);
    // C has reviews stored under it, so it goes first; then at most two of those with no evidence at all.
    expect(complete.visit).toEqual(["C", "D", "E"]);
  });

  it("skips nobody on the evidence of a walk that was not complete", () => {
    const partial = membersToVisit("A", ["A", "B", "C"], false, { B: 4 }, {});
    expect(partial.visit).toEqual(["B", "C"]);
    expect(partial.skipped).toEqual([]);
  });

  it("decides what is still missing by review id once the whole pool was seen", () => {
    // Ten counted; nine seen and stored somewhere in the family, one seen and not stored yet.
    const seen = new Set(pool(10).map((review) => review.id));
    const known = new Set(pool(9).map((review) => review.id));
    expect(remainingAfterFullWalk(10, seen, known)).toBe(1);
    expect(remainingAfterFullWalk(10, seen, seen)).toBe(0);
    expect(remainingAfterFullWalk(8, seen, seen)).toBe(0);
  });
});

describe("checking a held review", () => {
  const family = ["A", "B"];
  const page = { signin: false, exists: true, product: "A", star: 1 as const };

  it("believes a missing page only once it is confirmed", () => {
    expect(classifyPermalink("A", 1, { ...page, exists: false, product: null, star: null }, family)).toBe("unknown");
    expect(classifyPermalink("A", 1, { ...page, exists: false, product: null, star: null, confirmedGone: true }, family)).toBe("gone");
  });

  it("claims nothing from a sign-in page or a page that names no product", () => {
    expect(classifyPermalink("A", 1, { ...page, signin: true }, family)).toBe("unknown");
    expect(classifyPermalink("A", 1, { ...page, product: null }, family)).toBe("unknown");
  });

  it("tells a sibling from a stranger, and notices a changed star", () => {
    expect(classifyPermalink("A", 1, page, family)).toBe("on_this_product");
    expect(classifyPermalink("A", 1, { ...page, product: "B" }, family)).toBe("family_member");
    expect(classifyPermalink("A", 1, { ...page, product: "Z" }, family)).toBe("other_product");
    expect(classifyPermalink("A", 1, { ...page, star: 3 }, family)).toBe("star_changed");
    expect(classifyPermalink("A", 1, { ...page, product: "B", star: 2 }, family)).toBe("star_changed");
  });
});

describe("changing what is held", () => {
  const world = { activeListings: new Set(["A", "C"]), families: { C: ["C", "C2"] }, archived: new Set(["old"]) };
  const item = { id: "x", from: "A", product: "Z" };

  it("archives a review attached to a product nobody tracks", () => {
    expect(archiveOutcome(item, held("x"), world)).toBe("archived");
  });

  it("checks again at the moment of writing, and says why it left a row alone", () => {
    expect(archiveOutcome(item, undefined, world)).toBe("not in reviews");
    expect(archiveOutcome(item, held("x", { filedUnder: "B" }), world)).toBe("skipped: filed under B now");
    expect(archiveOutcome({ ...item, id: "old" }, held("old"), world)).toBe("skipped: already in the archive");
    expect(archiveOutcome({ ...item, product: "C" }, held("x"), world)).toBe("skipped: product is an active listing of ours");
    expect(archiveOutcome({ ...item, product: "A" }, held("x"), world)).toBe("skipped: product is an active listing of ours");
    expect(archiveOutcome({ ...item, product: "C2" }, held("x"), world)).toBe("skipped: product is in the family of an active listing");
  });

  it("applies a column change only to a row that still holds the value it was checked with", () => {
    expect(changeOutcome(null, null, "B")).toBe("applied");
    expect(changeOutcome("B", null, "B")).toBe("already correct");
    expect(changeOutcome("C", null, "B")).toBe("changed since check");
  });
});
