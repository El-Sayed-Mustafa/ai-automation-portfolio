import { describe, expect, test } from "vitest";
import {
  DEMO_SETTINGS,
  PUBLISHED_LIMITS,
  STARS,
  claimNext,
  deliver,
  dueForDelivery,
  enqueue,
  findOpenDuplicate,
  formatX10,
  halfUpX10,
  isSixDigitCode,
  isStarCounts,
  issueCode,
  markDone,
  planRemovals,
  quotaDecision,
  recordFailure,
  removalRaises,
  smallestRemovalAtLevel,
  totals,
  verifyCode,
  withRemoved,
  type EmailToken,
  type QueuedRequest,
  type Star,
  type StarCounts,
  type User,
} from "./rules";

/** Counts from one star up to five. */
const counts = (one: number, two: number, three: number, four: number, five: number): StarCounts => ({ 1: one, 2: two, 3: three, 4: four, 5: five });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Edge-case breakdowns written for this page. The write-up says the private
 * test suite uses 15 of its own; these are not those, and nothing here counts
 * towards the figure it publishes.
 */
const EDGE_CASES: [name: string, breakdown: StarCounts][] = [
  ["all one-star", counts(40, 0, 0, 0, 0)],
  ["all five-star", counts(0, 0, 0, 0, 40)],
  ["only the middle", counts(0, 0, 50, 0, 0)],
  ["one rating", counts(0, 0, 1, 0, 0)],
  ["two ratings, far apart", counts(1, 0, 0, 0, 1)],
  ["one of each", counts(1, 1, 1, 1, 1)],
  ["tiny and low", counts(2, 1, 0, 0, 0)],
  ["bimodal", counts(60, 0, 0, 0, 60)],
  ["bimodal, lopsided", counts(90, 0, 0, 0, 10)],
  ["five-star and one-star with nothing between", counts(200, 0, 0, 0, 1000)],
  ["mostly low", counts(90, 30, 5, 3, 2)],
  ["mostly high", counts(2, 3, 5, 30, 90)],
  ["flat", counts(25, 25, 25, 25, 25)],
  ["no one-star", counts(0, 40, 10, 10, 40)],
  ["exactly on a rounding boundary", counts(0, 0, 0, 13, 7)],
  ["one rating under a boundary", counts(0, 0, 0, 651, 349)],
];

describe("what is published and what is invented", () => {
  test("the limits are the ones the write-up states", () => {
    expect(PUBLISHED_LIMITS).toEqual({ codeDigits: 6, codeLifetimeMinutes: 15, freeRequests: 3, maxAttempts: 3, deliverAfterHours: 24 });
  });

  test("every other timing is an invented setting, kept in one object", () => {
    expect(Object.keys(DEMO_SETTINGS)).toEqual([
      "apiMs",
      "writeMs",
      "typingMs",
      "retypeMs",
      "lateCodeMs",
      "secondCodeAfterMs",
      "submitAfterMs",
      "workerPickupMs",
      "scrapeMs",
      "scrapeFailureMs",
      "estimateMs",
      "planMs",
      "renderMs",
      "sendMs",
      "earlierRequestAgoMs",
    ]);
    for (const value of Object.values(DEMO_SETTINGS)) expect(value).toBeGreaterThan(0);
  });
});

describe("the transparent average", () => {
  test("is the sum of the stars over the number of ratings, to one decimal", () => {
    expect(totals(counts(60, 30, 60, 150, 700))).toEqual({ ratings: 1000, starSum: 4400 });
    expect(halfUpX10(counts(60, 30, 60, 150, 700))).toBe(44);
    expect(halfUpX10(counts(400, 250, 150, 80, 120))).toBe(23);
    expect(halfUpX10(counts(4, 1, 1, 3, 9))).toBe(37);
    expect(halfUpX10(counts(0, 0, 0, 0, 12))).toBe(50);
    expect(halfUpX10(counts(12, 0, 0, 0, 0))).toBe(10);
    expect(halfUpX10(counts(0, 0, 1, 0, 0))).toBe(30);
  });

  test("a product with no ratings has no rating", () => {
    expect(halfUpX10(counts(0, 0, 0, 0, 0))).toBeNull();
  });

  // [breakdown, the exact average, the rating times ten]
  const boundaries: [StarCounts, string, number][] = [
    [counts(0, 0, 0, 3, 1), "17/4 = 4.25", 43],
    [counts(0, 0, 0, 13, 7), "87/20 = 4.35", 44],
    [counts(0, 0, 0, 19, 1), "81/20 = 4.05", 41],
    [counts(0, 0, 0, 1, 19), "99/20 = 4.95", 50],
    [counts(0, 0, 0, 1, 1), "9/2 = 4.5", 45],
    [counts(1, 1, 0, 0, 0), "3/2 = 1.5", 15],
    [counts(17, 3, 0, 0, 0), "23/20 = 1.15", 12],
    [counts(19, 1, 0, 0, 0), "21/20 = 1.05", 11],
    [counts(0, 9, 11, 0, 0), "51/20 = 2.55", 26],
  ];

  test.each(boundaries)("%j, exactly %s, rounds up to %i", (breakdown, _exact, expected) => {
    expect(halfUpX10(breakdown)).toBe(expected);
  });

  test("the same boundaries go wrong through floating-point formatting, which is why whole numbers are used", () => {
    expect((87 / 20).toFixed(1)).toBe("4.3");
    expect(formatX10(halfUpX10(counts(0, 0, 0, 13, 7))!)).toBe("4.4");
    expect((81 / 20).toFixed(1)).toBe("4.0");
    expect(formatX10(halfUpX10(counts(0, 0, 0, 19, 1))!)).toBe("4.1");
    expect((23 / 20).toFixed(1)).toBe("1.1");
    expect(formatX10(halfUpX10(counts(17, 3, 0, 0, 0))!)).toBe("1.2");
  });

  test("one rating either side of a boundary lands on the right side", () => {
    expect(halfUpX10(counts(0, 0, 0, 651, 349))).toBe(43); // 4.349
    expect(halfUpX10(counts(0, 0, 0, 650, 350))).toBe(44); // 4.350
    expect(halfUpX10(counts(0, 0, 0, 649, 351))).toBe(44); // 4.351
    expect(halfUpX10(counts(551, 449, 0, 0, 0))).toBe(14); // 1.449
    expect(halfUpX10(counts(550, 450, 0, 0, 0))).toBe(15); // 1.450
  });

  test("the result is the half-up rounding by definition, for every small mix of two star levels", () => {
    let checked = 0;
    for (const [low, high] of [[1, 5], [4, 5], [1, 2], [2, 3], [3, 5]] as [Star, Star][]) {
      for (let ratings = 1; ratings <= 60; ratings += 1) {
        for (let top = 0; top <= ratings; top += 1) {
          const breakdown = { ...counts(0, 0, 0, 0, 0), [low]: ratings - top, [high]: top };
          const { starSum } = totals(breakdown);
          const x10 = halfUpX10(breakdown)!;
          // x10/10 - 0.05 <= S/N < x10/10 + 0.05, in whole numbers.
          expect((2 * x10 - 1) * ratings).toBeLessThanOrEqual(20 * starSum);
          expect(20 * starSum).toBeLessThan((2 * x10 + 1) * ratings);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(5 * 1890);
  });

  test("large counts stay exact", () => {
    expect(halfUpX10(counts(1_000_000_000, 0, 0, 0, 3_000_000_000))).toBe(40);
    expect(halfUpX10(counts(0, 0, 0, 650_000_000, 350_000_000))).toBe(44);
    expect(halfUpX10(counts(0, 0, 0, 650_000_001, 349_999_999))).toBe(43);
  });

  test("a rating prints with one decimal", () => {
    expect(formatX10(44)).toBe("4.4");
    expect(formatX10(50)).toBe("5.0");
    expect(formatX10(10)).toBe("1.0");
  });

  test("counts must be whole and not negative", () => {
    expect(isStarCounts(counts(0, 1, 2, 3, 4))).toBe(true);
    expect(isStarCounts(counts(0, -1, 2, 3, 4))).toBe(false);
    expect(isStarCounts(counts(0, 1.5, 2, 3, 4))).toBe(false);
  });
});

describe("removing ratings", () => {
  test("taking ratings off a level leaves the original untouched", () => {
    const before = counts(60, 30, 60, 150, 700);
    expect(withRemoved(before, 1, 43)).toEqual(counts(17, 30, 60, 150, 700));
    expect(before[1]).toBe(60);
  });

  test("more than a level holds cannot be removed", () => {
    expect(() => withRemoved(counts(3, 0, 0, 0, 5), 1, 4)).toThrow(RangeError);
    expect(() => withRemoved(counts(3, 0, 0, 0, 5), 1, -1)).toThrow(RangeError);
    expect(() => withRemoved(counts(3, 0, 0, 0, 5), 1, 1.5)).toThrow(RangeError);
  });

  test("only a rating strictly below the average raises it when removed", () => {
    const low = counts(400, 250, 150, 80, 120); // average 2.27
    expect(STARS.map((star) => removalRaises(low, star))).toEqual([true, true, false, false, false]);
    const centred = counts(1, 0, 1, 0, 1); // average exactly 3
    expect(removalRaises(centred, 3)).toBe(false);
    expect(removalRaises(counts(0, 0, 0, 0, 9), 1)).toBe(false);
  });
});

describe("monotonicity, on edge-case breakdowns written for this page", () => {
  test.each(EDGE_CASES)("%s: removing more ratings at or below the average never lowers the result", (_name, breakdown) => {
    const { ratings, starSum } = totals(breakdown);
    let checked = 0;
    let expected = 0;
    for (const star of STARS) {
      if (star * ratings > starSum) continue;
      // Every removal that leaves at least one rating behind is checked.
      expected += Math.min(breakdown[star], ratings - 1);
      let previous = halfUpX10(breakdown)!;
      for (let removed = 1; removed <= breakdown[star] && removed < ratings; removed += 1) {
        const next = halfUpX10(withRemoved(breakdown, star, removed))!;
        expect(next, `${removed} removed at ${star} stars`).toBeGreaterThanOrEqual(previous);
        previous = next;
        checked += 1;
      }
    }
    expect(checked).toBe(expected);
  });

  test.each(EDGE_CASES)("%s: removing ratings above the average never raises it, so the planner never offers them", (_name, breakdown) => {
    const { ratings, starSum } = totals(breakdown);
    for (const star of STARS) {
      if (star * ratings <= starSum) continue;
      let previous = halfUpX10(breakdown)!;
      for (let removed = 1; removed <= breakdown[star] && removed < ratings; removed += 1) {
        const next = halfUpX10(withRemoved(breakdown, star, removed))!;
        expect(next, `${removed} removed at ${star} stars`).toBeLessThanOrEqual(previous);
        previous = next;
      }
      expect(smallestRemovalAtLevel(breakdown, star, halfUpX10(breakdown)! + 1)).toBeNull();
    }
  });

  test.each(EDGE_CASES)("%s: removing the lowest ratings one at a time climbs and never dips", (_name, breakdown) => {
    let current: StarCounts = breakdown;
    let previous = halfUpX10(current)!;
    for (;;) {
      const lowest = STARS.find((star) => current[star] > 0)!;
      if (!removalRaises(current, lowest)) break;
      current = withRemoved(current, lowest, 1);
      const next = halfUpX10(current)!;
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    // What is left is a single star level, and its rating is that level.
    const left = STARS.filter((star) => current[star] > 0);
    expect(left).toHaveLength(1);
    expect(previous).toBe(left[0] * 10);
  });
});

describe("the bucket-level planner", () => {
  const product = counts(60, 30, 60, 150, 700); // shows 4.4

  test("finds the smallest number of removals at a star level that reaches the target", () => {
    const plan = planRemovals(product, 46);
    expect(plan).toMatchObject({ outcome: "plan", currentX10: 44, targetX10: 46, star: 1, remove: 43, available: 60, resultX10: 46 });
    // One fewer is not enough.
    expect(halfUpX10(withRemoved(product, 1, 42))).toBe(45);
    expect(halfUpX10(withRemoved(product, 1, 43))).toBe(46);
  });

  test("says for each level whether it reaches, falls short or is never offered", () => {
    const plan = planRemovals(product, 46);
    if (plan.outcome !== "plan") throw new Error("expected a plan");
    expect(plan.levels.map((level) => [level.star, level.verdict, level.remove, level.bestX10])).toEqual([
      [1, "reaches", 43, 46],
      [2, "falls-short", null, 45],
      [3, "falls-short", null, 45],
      [4, "falls-short", null, 45],
      [5, "would-not-raise", null, null],
    ]);
  });

  test("refuses a target no level can reach, and says how far removals could go", () => {
    const plan = planRemovals(product, 49);
    expect(plan).toMatchObject({ outcome: "unreachable", currentX10: 44, targetX10: 49, ceilingX10: 46, ceilingStar: 1 });
    // The ceiling is real: every one-star rating gone gives 4.6.
    expect(halfUpX10(withRemoved(product, 1, 60))).toBe(46);
  });

  test("uses a higher level when the lowest is too small to reach the target", () => {
    const breakdown = counts(2, 500, 0, 0, 498); // shows 3.5
    expect(halfUpX10(breakdown)).toBe(35);
    expect(smallestRemovalAtLevel(breakdown, 1, 36)).toBeNull();
    expect(planRemovals(breakdown, 36)).toMatchObject({ outcome: "plan", star: 2, remove: 38, resultX10: 36 });
  });

  test("a tie between levels goes to the lower star", () => {
    const breakdown = counts(1, 1, 0, 0, 2); // shows 3.3
    expect(smallestRemovalAtLevel(breakdown, 1, 37)).toBe(1);
    expect(smallestRemovalAtLevel(breakdown, 2, 37)).toBe(1);
    expect(planRemovals(breakdown, 37)).toMatchObject({ outcome: "plan", star: 1, remove: 1 });
  });

  test("never proposes a rating above the average on a low-rated product", () => {
    const low = counts(400, 250, 150, 80, 120); // shows 2.3
    const plan = planRemovals(low, 30);
    expect(plan).toMatchObject({ outcome: "plan", star: 1, remove: 349, resultX10: 30 });
    if (plan.outcome !== "plan") throw new Error("expected a plan");
    expect(plan.levels.filter((level) => level.verdict === "would-not-raise").map((level) => level.star)).toEqual([3, 4, 5]);
    // Removing three-star ratings there lowers the result.
    expect(halfUpX10(withRemoved(low, 3, 150))).toBeLessThan(23);

    const veryLow = counts(90, 0, 10, 0, 0); // shows 1.2
    expect(planRemovals(veryLow, 15)).toMatchObject({ outcome: "plan", star: 1, remove: 56 });
    expect(smallestRemovalAtLevel(veryLow, 3, 15)).toBeNull();
  });

  test("proposes nothing when the target is already met", () => {
    expect(planRemovals(product, 44)).toEqual({ outcome: "already-met", currentX10: 44, targetX10: 44 });
    expect(planRemovals(product, 30)).toEqual({ outcome: "already-met", currentX10: 44, targetX10: 30 });
    expect(smallestRemovalAtLevel(product, 1, 44)).toBe(0);
  });

  test("refuses when nothing below the average exists to remove", () => {
    expect(planRemovals(counts(0, 0, 50, 0, 0), 40)).toMatchObject({ outcome: "unreachable", ceilingX10: 30, ceilingStar: null });
    expect(planRemovals(counts(0, 0, 0, 0, 0), 40)).toEqual({ outcome: "no-ratings", targetX10: 40 });
  });

  test.each(EDGE_CASES)("%s: the search agrees with trying every number of removals in turn", (_name, breakdown) => {
    const current = halfUpX10(breakdown)!;
    for (const star of STARS) {
      for (let target = 10; target <= 50; target += 1) {
        let expected: number | null = null;
        if (current >= target) expected = 0;
        else if (removalRaises(breakdown, star)) {
          for (let removed = 1; removed <= breakdown[star]; removed += 1) {
            if (halfUpX10(withRemoved(breakdown, star, removed))! >= target) {
              expected = removed;
              break;
            }
          }
        }
        expect(smallestRemovalAtLevel(breakdown, star, target), `${star} stars, target ${target}`).toBe(expected);
      }
    }
  });

  test.each(EDGE_CASES)("%s: a plan reaches its target with nothing to spare, and a refusal is true of every level", (_name, breakdown) => {
    for (let target = 10; target <= 50; target += 1) {
      const plan = planRemovals(breakdown, target);
      if (plan.outcome === "plan") {
        expect(removalRaises(breakdown, plan.star)).toBe(true);
        expect(plan.remove).toBeGreaterThan(0);
        expect(plan.remove).toBeLessThanOrEqual(breakdown[plan.star]);
        expect(halfUpX10(withRemoved(breakdown, plan.star, plan.remove))).toBe(plan.resultX10);
        expect(plan.resultX10).toBeGreaterThanOrEqual(target);
        expect(halfUpX10(withRemoved(breakdown, plan.star, plan.remove - 1))!).toBeLessThan(target);
        for (const level of plan.levels) if (level.remove !== null) expect(level.remove).toBeGreaterThanOrEqual(plan.remove);
      } else if (plan.outcome === "unreachable") {
        expect(plan.ceilingX10).toBeLessThan(target);
        for (const star of STARS) {
          if (!removalRaises(breakdown, star)) continue;
          expect(halfUpX10(withRemoved(breakdown, star, breakdown[star]))!).toBeLessThanOrEqual(plan.ceilingX10);
        }
      } else {
        expect(plan.outcome).toBe("already-met");
        expect(halfUpX10(breakdown)!).toBeGreaterThanOrEqual(target);
      }
    }
  });
});

describe("email codes", () => {
  const email = "seller@example.test";

  test("a code is six digits", () => {
    expect(isSixDigitCode("123456")).toBe(true);
    expect(isSixDigitCode("12345")).toBe(false);
    expect(isSixDigitCode("1234567")).toBe(false);
    expect(isSixDigitCode("12a456")).toBe(false);
    expect(() => issueCode([], email, "12345", 0)).toThrow(RangeError);
  });

  test("a code lasts fifteen minutes", () => {
    const tokens: EmailToken[] = [];
    expect(issueCode(tokens, email, "123456", 1_000)).toEqual({ email, code: "123456", expires_at: 1_000 + 15 * MINUTE, consumed: false });
    expect(verifyCode(tokens, email, "123456", 1_000 + 15 * MINUTE - 1)).toMatchObject({ ok: true });
  });

  test("a code typed when its lifetime is up, or later, is refused", () => {
    const atTheLimit: EmailToken[] = [];
    issueCode(atTheLimit, email, "123456", 0);
    expect(verifyCode(atTheLimit, email, "123456", 15 * MINUTE)).toEqual({ ok: false, reason: "expired" });
    const late: EmailToken[] = [];
    issueCode(late, email, "123456", 0);
    expect(verifyCode(late, email, "123456", 20 * MINUTE)).toEqual({ ok: false, reason: "expired" });
    expect(late[0].consumed).toBe(false);
  });

  test("a code that does not match is refused, and so is another address's code", () => {
    const tokens: EmailToken[] = [];
    issueCode(tokens, email, "123456", 0);
    issueCode(tokens, "other@example.test", "654321", 0);
    expect(verifyCode(tokens, email, "000000", MINUTE)).toEqual({ ok: false, reason: "wrong" });
    expect(verifyCode(tokens, email, "654321", MINUTE)).toEqual({ ok: false, reason: "wrong" });
    expect(verifyCode([], email, "123456", MINUTE)).toEqual({ ok: false, reason: "wrong" });
  });

  test("an accepted code is used up", () => {
    const tokens: EmailToken[] = [];
    issueCode(tokens, email, "123456", 0);
    expect(verifyCode(tokens, email, "123456", MINUTE)).toMatchObject({ ok: true });
    expect(verifyCode(tokens, email, "123456", 2 * MINUTE)).toEqual({ ok: false, reason: "invalidated" });
  });

  test("issuing a new code invalidates the older ones for that address only", () => {
    const tokens: EmailToken[] = [];
    issueCode(tokens, email, "123456", 0);
    issueCode(tokens, "other@example.test", "111111", 0);
    issueCode(tokens, email, "654321", MINUTE);
    expect(tokens.map((token) => [token.code, token.consumed])).toEqual([
      ["123456", true],
      ["111111", false],
      ["654321", false],
    ]);
    expect(verifyCode(tokens, email, "123456", 2 * MINUTE)).toEqual({ ok: false, reason: "invalidated" });
    expect(verifyCode(tokens, email, "654321", 2 * MINUTE)).toMatchObject({ ok: true });
    expect(verifyCode(tokens, "other@example.test", "111111", 2 * MINUTE)).toMatchObject({ ok: true });
  });
});

describe("the free-request quota", () => {
  test("three free requests, then a refusal that invites sign-up", () => {
    expect(quotaDecision({ free_used: 0, unlimited: false })).toEqual({ allowed: true, remaining: 3 });
    expect(quotaDecision({ free_used: 2, unlimited: false })).toEqual({ allowed: true, remaining: 1 });
    expect(quotaDecision({ free_used: 3, unlimited: false })).toEqual({ allowed: false, prompt_signup: true });
    expect(quotaDecision({ free_used: 7, unlimited: false })).toEqual({ allowed: false, prompt_signup: true });
  });

  test("an account that signed up is unlimited", () => {
    expect(quotaDecision({ free_used: 3, unlimited: true })).toEqual({ allowed: true, remaining: null });
  });
});

describe("the request queue", () => {
  const newUser = (overrides: Partial<User> = {}): User => ({ email: "seller@example.test", verified_at: 0, free_used: 0, unlimited: false, created_at: 0, ...overrides });

  test("a request is queued as pending, due 24 hours after it was created, and uses one free request", () => {
    const requests: QueuedRequest[] = [];
    const user = newUser();
    const request = enqueue(requests, user, "B0EXAMPLE1", 5_000);
    expect(request).toEqual({
      id: 1,
      email: "seller@example.test",
      asin: "B0EXAMPLE1",
      status: "pending",
      created_at: 5_000,
      deliver_at: 5_000 + 24 * HOUR,
      attempts: 0,
      pdf_path: null,
      link_token: null,
      delivered_at: null,
      error: null,
    });
    expect(user.free_used).toBe(1);
    expect(enqueue(requests, user, "B0EXAMPLE2", 6_000).id).toBe(2);
    expect(user.free_used).toBe(2);
  });

  test("an unlimited account's counter is left alone", () => {
    const user = newUser({ unlimited: true, free_used: 3 });
    enqueue([], user, "B0EXAMPLE1", 0);
    expect(user.free_used).toBe(3);
  });

  test("the same product by the same email is a duplicate only while it is pending or scraping", () => {
    const requests: QueuedRequest[] = [];
    const first = enqueue(requests, newUser(), "B0EXAMPLE1", 0);
    expect(findOpenDuplicate(requests, "seller@example.test", "B0EXAMPLE1")).toBe(first);
    expect(findOpenDuplicate(requests, "seller@example.test", "B0EXAMPLE2")).toBeNull();
    expect(findOpenDuplicate(requests, "other@example.test", "B0EXAMPLE1")).toBeNull();
    first.status = "scraping";
    expect(findOpenDuplicate(requests, "seller@example.test", "B0EXAMPLE1")).toBe(first);
    first.status = "done";
    expect(findOpenDuplicate(requests, "seller@example.test", "B0EXAMPLE1")).toBeNull();
    first.status = "failed";
    expect(findOpenDuplicate(requests, "seller@example.test", "B0EXAMPLE1")).toBeNull();
  });

  test("a claim takes the oldest pending request and marks it in the same step", () => {
    const requests: QueuedRequest[] = [];
    const later = enqueue(requests, newUser(), "B0EXAMPLE2", 9_000);
    const earlier = enqueue(requests, newUser({ email: "other@example.test" }), "B0EXAMPLE1", 4_000);
    expect(claimNext(requests)).toBe(earlier);
    expect(earlier).toMatchObject({ status: "scraping", attempts: 1 });
    expect(claimNext(requests)).toBe(later);
    expect(claimNext(requests)).toBeNull();
  });

  test("two workers asking at once cannot take the same request", () => {
    const requests: QueuedRequest[] = [];
    const only = enqueue(requests, newUser(), "B0EXAMPLE1", 0);
    const workerA = claimNext(requests);
    const workerB = claimNext(requests);
    expect(workerA).toBe(only);
    expect(workerB).toBeNull();
    expect(only.attempts).toBe(1);
  });

  test("a failed job goes back to pending twice, and the third failure marks it failed", () => {
    const requests: QueuedRequest[] = [];
    const request = enqueue(requests, newUser(), "B0EXAMPLE1", 0);
    const history: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(claimNext(requests)).toBe(request);
      history.push(`${request.attempts}:${recordFailure(request, "no breakdown")}:${request.status}`);
    }
    expect(history).toEqual(["1:retry:pending", "2:retry:pending", "3:failed:failed"]);
    expect(request.error).toBe("no breakdown");
    // A failed request is not handed out again.
    expect(claimNext(requests)).toBeNull();
  });

  test("a request that succeeds on a later attempt is done, with the old error cleared", () => {
    const requests: QueuedRequest[] = [];
    const request = enqueue(requests, newUser(), "B0EXAMPLE1", 0);
    claimNext(requests);
    recordFailure(request, "no breakdown");
    claimNext(requests);
    markDone(request);
    expect(request).toMatchObject({ status: "done", attempts: 2, error: null });
  });

  test("a finished request is held until the 24-hour mark, then delivered once", () => {
    const requests: QueuedRequest[] = [];
    const request = enqueue(requests, newUser(), "B0EXAMPLE1", 1_000);
    claimNext(requests);
    // Not done yet: not due, whatever the time.
    expect(dueForDelivery(request, 1_000 + 30 * HOUR)).toBe(false);
    markDone(request);
    expect(dueForDelivery(request, 1_000 + 7 * MINUTE)).toBe(false);
    expect(deliver(request, 1_000 + 7 * MINUTE)).toBe(false);
    expect(dueForDelivery(request, 1_000 + 24 * HOUR - 1)).toBe(false);
    expect(request.delivered_at).toBeNull();
    expect(dueForDelivery(request, 1_000 + 24 * HOUR)).toBe(true);
    expect(deliver(request, 1_000 + 24 * HOUR)).toBe(true);
    expect(request.delivered_at).toBe(1_000 + 24 * HOUR);
    expect(deliver(request, 1_000 + 25 * HOUR)).toBe(false);
    expect(request.delivered_at).toBe(1_000 + 24 * HOUR);
  });

  test("a failed request is never due", () => {
    const requests: QueuedRequest[] = [];
    const request = enqueue(requests, newUser(), "B0EXAMPLE1", 0);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      claimNext(requests);
      recordFailure(request, "no breakdown");
    }
    expect(dueForDelivery(request, 48 * HOUR)).toBe(false);
  });
});
