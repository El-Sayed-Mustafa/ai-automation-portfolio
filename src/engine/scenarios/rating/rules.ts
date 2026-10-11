/**
 * Rules of the rating estimator's request pipeline, re-implemented from the
 * project's public write-up and from nothing else. The application source is
 * private and was not read, so nothing here is a copy of it. Each block names
 * the part of the write-up it follows, and where the write-up is silent the
 * comment says that the choice is this demo's.
 *
 * Two things are deliberately absent. The trained model that gives the
 * headline estimate in production is not reproduced, and neither is the
 * metadata-aware weight the production planner uses to rank single reviews.
 * What runs here is what the write-up describes exactly: the transparent
 * half-up weighted average, and the bucket-level planner built on it.
 */

/** Limits the public write-up states. showcase/SYSTEM_DESIGN.md:96-109 */
export const PUBLISHED_LIMITS = {
  codeDigits: 6,
  codeLifetimeMinutes: 15,
  freeRequests: 3,
  maxAttempts: 3,
  deliverAfterHours: 24,
} as const;

/** Invented timings. The write-up gives none of these; they only pace the simulation. */
export const DEMO_SETTINGS = {
  apiMs: 80,
  writeMs: 15,
  typingMs: 40_000,
  retypeMs: 20_000,
  lateCodeMs: 20 * 60_000,
  secondCodeAfterMs: 60_000,
  submitAfterMs: 5_000,
  workerPickupMs: 5 * 60_000,
  scrapeMs: 45_000,
  scrapeFailureMs: 30_000,
  estimateMs: 30,
  planMs: 20,
  renderMs: 6_000,
  sendMs: 900,
  /** How long before the run the earlier request of the "same product again" case was made. */
  earlierRequestAgoMs: 2 * 3_600_000,
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------------------
// The transparent estimate: showcase/SYSTEM_DESIGN.md:33-48, showcase/README.md:99-104
// ---------------------------------------------------------------------------

export const STARS = [1, 2, 3, 4, 5] as const;
export type Star = (typeof STARS)[number];

/** How many ratings a product has at each star level. */
export type StarCounts = Readonly<Record<Star, number>>;

/** True when every count is a whole number that is not negative. */
export function isStarCounts(counts: StarCounts): boolean {
  return STARS.every((star) => Number.isSafeInteger(counts[star]) && counts[star] >= 0);
}

export function totals(counts: StarCounts): { ratings: number; starSum: number } {
  let ratings = 0;
  let starSum = 0;
  for (const star of STARS) {
    ratings += counts[star];
    starSum += star * counts[star];
  }
  return { ratings, starSum };
}

/** Whole-number division, without a floating-point quotient. */
function divide(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/**
 * The average of the star levels weighted by their counts, rounded half-up to
 * one decimal and returned times ten: 44 means 4.4. A breakdown with no
 * ratings has no rating.
 *
 * Whole numbers only. Rounding 10*S/N half-up is floor((20*S + N) / (2*N)),
 * so an average of exactly 4.35 gives 4.4. Formatting the same value through
 * a floating-point number gives 4.3.
 */
export function halfUpX10(counts: StarCounts): number | null {
  const { ratings, starSum } = totals(counts);
  if (ratings <= 0) return null;
  return divide(20 * starSum + ratings, 2 * ratings);
}

/** 44 becomes "4.4". */
export function formatX10(x10: number): string {
  return `${divide(x10, 10)}.${x10 % 10}`;
}

/** The breakdown with `n` ratings taken off one star level. */
export function withRemoved(counts: StarCounts, star: Star, n: number): StarCounts {
  if (!Number.isInteger(n) || n < 0 || n > counts[star]) throw new RangeError(`Cannot remove ${n} of ${counts[star]} ratings at ${star} stars.`);
  return { ...counts, [star]: counts[star] - n };
}

/**
 * Whether taking a rating off this level raises the average. It does only
 * when the level is strictly below the current average, compared here as
 * whole numbers (star * N < S). A rating above the average lowers it, which is
 * why the planner never proposes one. showcase/SYSTEM_DESIGN.md:67-69
 */
export function removalRaises(counts: StarCounts, star: Star): boolean {
  const { ratings, starSum } = totals(counts);
  return counts[star] > 0 && star * ratings < starSum;
}

// ---------------------------------------------------------------------------
// The bucket-level planner: showcase/SYSTEM_DESIGN.md:55-69, showcase/README.md:106-109
// ---------------------------------------------------------------------------

/**
 * The smallest number of removals at one star level that reaches the target,
 * or null when that level cannot reach it. Every removal below the average
 * raises the average, so the search can halve the range each time.
 */
export function smallestRemovalAtLevel(counts: StarCounts, star: Star, targetX10: number): number | null {
  const reaches = (n: number) => (halfUpX10(withRemoved(counts, star, n)) ?? 0) >= targetX10;
  if (reaches(0)) return 0;
  if (!removalRaises(counts, star) || !reaches(counts[star])) return null;
  let low = 1;
  let high = counts[star];
  while (low < high) {
    const middle = divide(low + high, 2);
    if (reaches(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

export interface LevelOption {
  star: Star;
  available: number;
  /**
   * reaches:         enough ratings at this level to reach the target
   * falls-short:     below the average, but removing all of them is not enough
   * would-not-raise: at or above the average, so it is never proposed
   * none-to-remove:  the level is empty
   */
  verdict: "reaches" | "falls-short" | "would-not-raise" | "none-to-remove";
  /** Smallest number of removals at this level that reaches the target. */
  remove: number | null;
  /** The rating if every rating at this level were gone: the most this level can do. */
  bestX10: number | null;
}

export type RemovalPlan =
  | { outcome: "no-ratings"; targetX10: number }
  | { outcome: "already-met"; currentX10: number; targetX10: number }
  | { outcome: "plan"; currentX10: number; targetX10: number; star: Star; remove: number; available: number; resultX10: number; levels: LevelOption[] }
  | { outcome: "unreachable"; currentX10: number; targetX10: number; ceilingX10: number; ceilingStar: Star | null; levels: LevelOption[] };

/**
 * "Remove N x 1-star": the smallest number of removals at a star level that
 * reaches the target, on the exact weighted average. A target no level can
 * reach is refused, with the most that removals could do, instead of a plan
 * being invented.
 *
 * The write-up describes the bucket-level plan one star level at a time. This
 * demo reads it that way: it does not combine levels, and a tie between
 * levels goes to the lower star. Whether the real planner does either is not
 * described in the public write-up.
 */
export function planRemovals(counts: StarCounts, targetX10: number): RemovalPlan {
  const currentX10 = halfUpX10(counts);
  if (currentX10 === null) return { outcome: "no-ratings", targetX10 };
  if (currentX10 >= targetX10) return { outcome: "already-met", currentX10, targetX10 };

  const levels: LevelOption[] = STARS.map((star) => {
    const available = counts[star];
    if (available === 0) return { star, available, verdict: "none-to-remove", remove: null, bestX10: null };
    if (!removalRaises(counts, star)) return { star, available, verdict: "would-not-raise", remove: null, bestX10: null };
    const remove = smallestRemovalAtLevel(counts, star, targetX10);
    const bestX10 = halfUpX10(withRemoved(counts, star, available));
    return { star, available, verdict: remove === null ? "falls-short" : "reaches", remove, bestX10 };
  });

  let chosen: LevelOption | null = null;
  for (const level of levels) {
    if (level.remove !== null && (chosen === null || level.remove < chosen.remove!)) chosen = level;
  }
  if (chosen) {
    const resultX10 = halfUpX10(withRemoved(counts, chosen.star, chosen.remove!))!;
    return { outcome: "plan", currentX10, targetX10, star: chosen.star, remove: chosen.remove!, available: chosen.available, resultX10, levels };
  }

  let ceilingX10 = currentX10;
  let ceilingStar: Star | null = null;
  for (const level of levels) {
    if (level.bestX10 !== null && level.bestX10 > ceilingX10) {
      ceilingX10 = level.bestX10;
      ceilingStar = level.star;
    }
  }
  return { outcome: "unreachable", currentX10, targetX10, ceilingX10, ceilingStar, levels };
}

// ---------------------------------------------------------------------------
// Email verification: showcase/SYSTEM_DESIGN.md:86, 96-97
// ---------------------------------------------------------------------------

/** One row of `email_tokens`, with the columns the write-up lists. Times are virtual milliseconds. */
export interface EmailToken {
  email: string;
  code: string;
  expires_at: number;
  consumed: boolean;
}

export function isSixDigitCode(code: string): boolean {
  return new RegExp(`^\\d{${PUBLISHED_LIMITS.codeDigits}}$`).test(code);
}

/**
 * Issues a code with a 15-minute lifetime and invalidates the older ones for
 * the same address. How the real code invalidates them is not described; this
 * demo marks them consumed, which is the one column that can carry it.
 */
export function issueCode(tokens: EmailToken[], email: string, code: string, now: number): EmailToken {
  if (!isSixDigitCode(code)) throw new RangeError("A code is six digits.");
  for (const token of tokens) {
    if (token.email === email) token.consumed = true;
  }
  const token: EmailToken = { email, code, expires_at: now + PUBLISHED_LIMITS.codeLifetimeMinutes * MINUTE, consumed: false };
  tokens.push(token);
  return token;
}

export type CodeCheck = { ok: true; token: EmailToken } | { ok: false; reason: "wrong" | "invalidated" | "expired" };

/**
 * Checks a typed code. A code that was replaced by a newer one or already used
 * is refused, and so is one past its lifetime. An accepted code is consumed.
 * The write-up does not say which side the 15-minute boundary falls on: here a
 * code is expired from the moment the lifetime is up.
 */
export function verifyCode(tokens: EmailToken[], email: string, code: string, now: number): CodeCheck {
  const matches = tokens.filter((token) => token.email === email && token.code === code);
  const token = matches.at(-1);
  if (!token) return { ok: false, reason: "wrong" };
  if (token.consumed) return { ok: false, reason: "invalidated" };
  if (now >= token.expires_at) return { ok: false, reason: "expired" };
  token.consumed = true;
  return { ok: true, token };
}

// ---------------------------------------------------------------------------
// Quota: showcase/SYSTEM_DESIGN.md:85, 98-100
// ---------------------------------------------------------------------------

/** One row of `users`. */
export interface User {
  email: string;
  verified_at: number | null;
  free_used: number;
  unlimited: boolean;
  created_at: number;
}

export type QuotaDecision = { allowed: true; remaining: number | null } | { allowed: false; prompt_signup: true };

/**
 * Three free requests per verified email. The fourth is refused with a
 * `prompt_signup` flag, so the page can invite the visitor to sign up; an
 * account that has signed up is unlimited.
 */
export function quotaDecision(user: Pick<User, "free_used" | "unlimited">): QuotaDecision {
  if (user.unlimited) return { allowed: true, remaining: null };
  if (user.free_used >= PUBLISHED_LIMITS.freeRequests) return { allowed: false, prompt_signup: true };
  return { allowed: true, remaining: PUBLISHED_LIMITS.freeRequests - user.free_used };
}

// ---------------------------------------------------------------------------
// Queue: showcase/SYSTEM_DESIGN.md:87-89, 101-109
// ---------------------------------------------------------------------------

export type RequestStatus = "pending" | "scraping" | "done" | "failed";

/** One row of `requests`. */
export interface QueuedRequest {
  id: number;
  email: string;
  asin: string;
  status: RequestStatus;
  created_at: number;
  deliver_at: number;
  attempts: number;
  pdf_path: string | null;
  link_token: string | null;
  delivered_at: number | null;
  error: string | null;
}

/** A request for the same product by the same email that is still pending or being processed. */
export function findOpenDuplicate(requests: QueuedRequest[], email: string, asin: string): QueuedRequest | null {
  return requests.find((request) => request.email === email && request.asin === asin && (request.status === "pending" || request.status === "scraping")) ?? null;
}

/**
 * Queues a request, to be delivered 24 hours after it was created, and uses
 * one free request. Whether an unlimited account still counts its requests is
 * not described; this demo leaves that counter alone.
 */
export function enqueue(requests: QueuedRequest[], user: User, asin: string, now: number): QueuedRequest {
  const request: QueuedRequest = {
    id: requests.reduce((highest, item) => Math.max(highest, item.id), 0) + 1,
    email: user.email,
    asin,
    status: "pending",
    created_at: now,
    deliver_at: now + PUBLISHED_LIMITS.deliverAfterHours * HOUR,
    attempts: 0,
    pdf_path: null,
    link_token: null,
    delivered_at: null,
    error: null,
  };
  requests.push(request);
  if (!user.unlimited) user.free_used += 1;
  return request;
}

/**
 * The atomic claim. In the real system the worker reads the next pending
 * request and marks it inside one IMMEDIATE transaction, so two workers can
 * never take the same one. One call of this function stands for that
 * transaction: it finds the oldest pending request and marks it in one step,
 * so a second call finds nothing to take.
 *
 * When the attempt counter moves is not described; this demo counts an
 * attempt when the request is claimed.
 */
export function claimNext(requests: QueuedRequest[]): QueuedRequest | null {
  let next: QueuedRequest | null = null;
  for (const request of requests) {
    if (request.status !== "pending") continue;
    if (next === null || request.created_at < next.created_at || (request.created_at === next.created_at && request.id < next.id)) next = request;
  }
  if (!next) return null;
  next.status = "scraping";
  next.attempts += 1;
  return next;
}

/** A failed job goes back to pending, up to three attempts; then it is marked failed. */
export function recordFailure(request: QueuedRequest, error: string): "retry" | "failed" {
  request.error = error;
  if (request.attempts >= PUBLISHED_LIMITS.maxAttempts) {
    request.status = "failed";
    return "failed";
  }
  request.status = "pending";
  return "retry";
}

export function markDone(request: QueuedRequest): void {
  request.status = "done";
  request.error = null;
}

/** Work is done as soon as a worker is free; the result goes out at `created_at + 24h`, not before. */
export function dueForDelivery(request: QueuedRequest, now: number): boolean {
  return request.status === "done" && request.delivered_at === null && now >= request.deliver_at;
}

/** Marks the request delivered if it is due, and says whether this call did it. */
export function deliver(request: QueuedRequest, now: number): boolean {
  if (!dueForDelivery(request, now)) return false;
  request.delivered_at = now;
  return true;
}
