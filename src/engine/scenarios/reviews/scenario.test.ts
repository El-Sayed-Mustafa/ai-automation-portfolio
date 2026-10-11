import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import { DEMO_SETTINGS, heldCounts, total, viewLimit } from "./rules";
import {
  EXTRA_HELD_TOO_MANY,
  INPUT_LIMITS,
  LISTINGS,
  REVIEWS_DEFAULT_INPUT,
  REVIEWS_FAULTS,
  REVIEWS_PRESETS,
  REVIEWS_SCENARIO_ID,
  REVIEWS_STEPS,
  buildReport,
  demoListings,
  demoStored,
  largeListing,
  ordinaryPool,
  reviewsScenario,
  validateReviewsInput,
  type ReviewsFaultId,
  type ReviewsInput,
} from "./scenario";

function execute(options: { input?: Partial<ReviewsInput>; faults?: ReviewsFaultId[]; answers?: string[] } = {}) {
  const session = new RunSession(reviewsScenario, { runId: "test-run", input: { ...REVIEWS_DEFAULT_INPUT, ...options.input }, faults: options.faults });
  const answers = [...(options.answers ?? ["write"])];
  while (session.isWaiting) {
    const answer = answers.shift();
    if (answer === undefined) break;
    session.resume(answer);
  }
  return { session, events: session.events, state: reduceRun(REVIEWS_STEPS, session.events) };
}

const status = (state: RunState, step: (typeof REVIEWS_STEPS)[number]) => state.steps[step].status;
const output = (state: RunState, step: (typeof REVIEWS_STEPS)[number]) => state.steps[step].output as Record<string, unknown>;
const logs = (events: RunEvent[]) => events.flatMap((event) => (event.type === "step.log" ? [event.message] : [])).join("\n");

describe("the invented world", () => {
  it("has a large listing with 128 critical reviews, 24 of them not held", () => {
    const large = largeListing();
    expect(large.pool).toHaveLength(128);
    expect(large.missing.size).toBe(24);
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const review of large.pool) counts[review.star] += 1;
    expect(counts).toEqual({ 1: 62, 2: 28, 3: 38 });
    expect(large.pool.length).toBeGreaterThan(viewLimit());
  });

  it("keeps the ordinary listing under the view limit whatever the visitor chooses", () => {
    expect(ordinaryPool({ newReviews: INPUT_LIMITS.newReviews.max, members: 4 }).length).toBeLessThan(viewLimit());
  });

  it("gives five listings five different first reasons", () => {
    const report = buildReport(demoListings(REVIEWS_DEFAULT_INPUT), demoStored(REVIEWS_DEFAULT_INPUT), {});
    expect(report.map((row) => [row.listing, row.reason, row.action])).toEqual([
      [LISTINGS.dead, "dead", "Leave it"],
      [LISTINGS.fresh, "no-tracking", "Track first"],
      [LISTINGS.ordinary, "missing", "Scrape"],
      [LISTINGS.large, "missing", "Scrape"],
      [LISTINGS.extra, "extra", "Decide"],
    ]);
    // The dead listing also holds more than was last counted. That is kept, not shown first.
    expect(report[0].reasons).toEqual(["dead", "extra"]);
    expect(report[2].difficulty).toBe("Easy");
    expect(report[3].difficulty).toBe("Medium");
    expect(report[4].diff).toBe(-EXTRA_HELD_TOO_MANY.length);
  });
});

describe("a normal day", () => {
  const { state, events, session } = execute();

  it("runs every step and finishes", () => {
    expect(session.isWaiting).toBe(false);
    expect(state.status).toBe("success");
    for (const step of REVIEWS_STEPS) expect(status(state, step), step).toBe(step === "collect.walk" ? "skipped" : "success");
  });

  it("queues the check ahead of the collecting, and the easy listing ahead of the large one", () => {
    expect(output(state, "queue.build")).toMatchObject({ batches: 2, listings_queued: 3 });
    expect(output(state, "check.claim")).toMatchObject({ kind: "check" });
    expect(output(state, "collect.claim")).toMatchObject({ listings: [LISTINGS.ordinary, LISTINGS.large] });
  });

  it("closes the ordinary gap with one page and never walks", () => {
    expect(output(state, "collect.recent")).toMatchObject({ new_reviews: 6, still_missing: 0 });
    expect(state.steps["collect.walk"].skipReason).toMatch(/first page closed the gap/);
    expect(output(state, "reviews.store")).toMatchObject({ stored: 6, still_missing: 0, done: true });
  });

  it("climbs the ladder on the large listing and says what no view reaches", () => {
    expect(output(state, "large.ladder")).toMatchObject({ found: 19, missing_before: 24, past_every_view: 5 });
    const text = logs(events);
    expect(text).toMatch(/0, the most recent page: 2 pages, 4 new reviews/);
    expect(text).toMatch(/1, every critical review: 6 pages, 5 new reviews/);
    expect(text).toMatch(/2\.5, most helpful first: 6 pages, 4 new reviews/);
  });

  it("gives every doubtful review a verdict, and calls two gone only after a live review opened", () => {
    expect(output(state, "check.walk")).toMatchObject({ seen: 30, on_this_product: 30, to_open: 6 });
    expect(output(state, "check.permalinks")).toEqual({ family_member: 3, gone: 2, other_product: 1, unknown: 0 });
    expect(logs(events)).toMatch(/which the walk just showed, is opened: it loads/);
  });

  it("archives the stranger's review only because a person said so, and says what tomorrow looks like", () => {
    expect(output(state, "cleanup.write")).toMatchObject({ archived: 1, skipped: 0 });
    expect(state.outcome).toMatch(/1 review archived, and the run can be undone\./);
    expect(state.outcome).toMatch(/Tomorrow P-5520 shows 3 more than the marketplace, filed under "More held, explained by the family": leave it\./);
  });

  it("is the same every time", () => {
    expect(execute().events).toEqual(events);
  });
});

describe("what a person decides", () => {
  it("waits at the archive run and changes nothing when it is left as a preview", () => {
    const waiting = execute({ answers: [] });
    expect(waiting.session.isWaiting).toBe(true);
    expect(status(waiting.state, "cleanup.decide")).toBe("waiting");
    expect(waiting.state.steps["cleanup.decide"].waiting?.choices.map((choice) => choice.id)).toEqual(["write", "leave"]);

    const left = execute({ answers: ["leave"] });
    expect(status(left.state, "cleanup.write")).toBe("skipped");
    expect(left.state.outcome).toMatch(/left as a preview: nothing was moved/);
    expect(left.events.some((event) => event.type === "state.changed" && event.table === "archive")).toBe(false);
  });

  it("keeps a listing out of the queue when someone wrote beside it", () => {
    const { state, events } = execute({ input: { note: "merged, wait" } });
    expect(output(state, "collect.claim")).toMatchObject({ listings: [LISTINGS.ordinary] });
    expect(status(state, "large.ladder")).toBe("skipped");
    expect(logs(events)).toMatch(/P-4470 is not queued: a person wrote "merged, wait" beside it/);
    expect(logs(events)).toMatch(/read back first and written again/);
  });
});

describe("other days", () => {
  it("needs the full walk for an older review, and then settles the family by review id", () => {
    const { state, events } = execute({ input: { newReviews: 2, olderMissing: 1 } });
    expect(output(state, "collect.recent")).toMatchObject({ new_reviews: 2, still_missing: 1 });
    expect(output(state, "collect.walk")).toMatchObject({ new_reviews: 1, whole_pool_seen: true });
    expect(output(state, "collect.members")).toMatchObject({ skipped_as_seen: ["P-3311"], considered: ["P-3312"], visited: 0 });
    expect(output(state, "reviews.store")).toMatchObject({ stored: 3, still_missing: 0, done: true });
    expect(logs(events)).toMatch(/"done" is decided by review id: 38 counted, 38 of them seen and in the database/);
  });

  it("takes ten from the first page of a busy week and the rest from the walk", () => {
    const { state } = execute({ input: { newReviews: 12 } });
    expect(output(state, "collect.recent")).toMatchObject({ new_reviews: 10, still_missing: 2 });
    expect(output(state, "collect.walk")).toMatchObject({ new_reviews: 2 });
    expect(output(state, "reviews.store")).toMatchObject({ stored: 12, done: true });
  });

  it("does not queue a listing that has no gap", () => {
    const { state } = execute({ input: { newReviews: 0 } });
    expect(output(state, "collect.claim")).toMatchObject({ listings: [LISTINGS.large] });
    for (const step of ["stored.load", "collect.recent", "collect.walk", "collect.members", "reviews.store"] as const) expect(status(state, step)).toBe("skipped");
    expect(status(state, "large.ladder")).toBe("success");
    expect(state.outcome).toMatch(/nothing for P-3310, which had no gap/);
  });

  it.each(REVIEWS_PRESETS)("runs the preset $id to an outcome", (preset) => {
    const { state } = execute({ input: preset.input });
    expect(state.status).toBe("success");
    expect(state.outcome?.length).toBeGreaterThan(40);
  });
});

describe("what goes wrong", () => {
  it("has no report when the daily job did not run, and nothing notices", () => {
    const { state } = execute({ faults: ["daily-job-missed"] });
    expect(state.status).toBe("failed");
    expect(status(state, "report.load")).toBe("failed");
    for (const step of REVIEWS_STEPS.slice(1)) expect(status(state, step)).toBe("skipped");
    expect(state.outcome).toMatch(/No report today/);
  });

  it("adds nothing when the queue is built twice", () => {
    const { state, events } = execute({ faults: ["built-twice"] });
    expect(output(state, "queue.build")).toMatchObject({ batches: 2, second_build_added: 0 });
    expect(logs(events)).toMatch(/0 new batches/);
  });

  it("calls nothing gone when the control review does not open", () => {
    const { state } = execute({ faults: ["control-does-not-open"] });
    expect(output(state, "check.permalinks")).toEqual({ family_member: 3, gone: 0, other_product: 0, unknown: 3 });
    expect(status(state, "cleanup.decide")).toBe("skipped");
    expect(state.outcome).toMatch(/3 reviews left unknown, none called gone/);
    // Collecting still happens afterwards.
    expect(status(state, "large.ladder")).toBe("success");
  });

  it("reads the stored reviews again when the first read comes back short", () => {
    const { state } = execute({ faults: ["stored-read-short"] });
    const step = state.steps["stored.load"];
    expect(step.status).toBe("success");
    expect(step.attempts.map((attempt) => attempt.status)).toEqual(["failed", "success"]);
    expect(step.attempts[0].error?.code).toBe("SHORT_READ");
    expect(output(state, "reviews.store")).toMatchObject({ stored: 6 });
  });

  it("leaves a listing for another run when its count cannot be read, and never reads that as zero", () => {
    const { state } = execute({ faults: ["count-unreadable"] });
    expect(status(state, "collect.recent")).toBe("failed");
    for (const step of ["collect.walk", "collect.members", "reviews.store"] as const) expect(status(state, step)).toBe("skipped");
    expect(status(state, "large.ladder")).toBe("success");
    expect(state.status).toBe("success");
  });

  it("concludes nothing from a walk that parsed nothing", () => {
    const { state, events } = execute({ input: { newReviews: 2, olderMissing: 1 }, faults: ["pages-parse-nothing"] });
    expect(output(state, "collect.walk")).toMatchObject({ parsed: 0, whole_pool_seen: false });
    // No member is skipped on the evidence of that walk; they are visited instead.
    expect(output(state, "collect.members")).toMatchObject({ skipped_as_seen: [] });
    expect(Number(output(state, "collect.members").visited)).toBeGreaterThan(0);
    expect(logs(events)).toMatch(/Without a complete walk nothing is skipped/);
  });

  it("lets a second machine take over a silent batch, and only after the wait", () => {
    const { state, events } = execute({ faults: ["machine-dies"] });
    const step = state.steps["large.ladder"];
    expect(step.attempts.map((attempt) => attempt.status)).toEqual(["failed", "success"]);
    expect(step.attempts[0].error?.code).toBe("MACHINE_LOST");
    expect(logs(events)).toMatch(/the update changes nothing/);
    expect(logs(events)).toMatch(/9 reviews machine A had already stored are found by id and not written twice/);
    // The same reviews are found in the end, none twice.
    expect(output(state, "large.ladder")).toMatchObject({ found: 19, past_every_view: 5, taken_over: true });
    const waited = (step.attempts[1].startedAt - step.attempts[0].startedAt) / 60000;
    expect(waited).toBeGreaterThan(DEMO_SETTINGS.queue.staleMinutes);
  });

  it("leaves a review alone when it was refiled after it was checked", () => {
    const { state } = execute({ faults: ["refiled-since-check"] });
    expect(output(state, "cleanup.write")).toMatchObject({ archived: 0, skipped: 1 });
    expect(state.steps["cleanup.write"].logs.map((log) => log.message).join(" ")).toMatch(/skipped: filed under P-5599 now/);
    expect(state.outcome).toMatch(/changed nothing/);
  });

  it("survives every pair of failures", () => {
    for (const first of REVIEWS_FAULTS) {
      for (const second of REVIEWS_FAULTS) {
        const { state, session } = execute({ faults: [first, second] });
        expect(session.isWaiting, `${first} + ${second}`).toBe(false);
        expect(["success", "failed"]).toContain(state.status);
      }
    }
  });
});

describe("the form", () => {
  it("accepts every preset and the default", () => {
    for (const preset of REVIEWS_PRESETS) expect(validateReviewsInput(preset.input)).toEqual({ ok: true, value: preset.input, errors: {} });
  });

  it("refuses numbers out of range and falls back to the default", () => {
    const result = validateReviewsInput({ newReviews: 99, olderMissing: -1, members: "two", note: "" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["members", "newReviews", "olderMissing"]);
    expect(result.value).toEqual(REVIEWS_DEFAULT_INPUT);
  });

  it("accepts numbers typed as text, and cleans a note", () => {
    const result = validateReviewsInput({ newReviews: "3", olderMissing: "2", members: "1", note: "  wait\u0007 here " });
    expect(result).toMatchObject({ ok: true, value: { newReviews: 3, olderMissing: 2, members: 1, note: "wait  here" } });
    expect(validateReviewsInput({ ...REVIEWS_DEFAULT_INPUT, note: "x".repeat(INPUT_LIMITS.note + 1) }).errors.note).toBeDefined();
  });

  it("is registered under the id the manifest uses", () => {
    expect(REVIEWS_SCENARIO_ID).toBe("reviews.gap-to-clean");
    expect(total(heldCounts(demoStored(REVIEWS_DEFAULT_INPUT), LISTINGS.extra))).toBe(36);
  });
});
