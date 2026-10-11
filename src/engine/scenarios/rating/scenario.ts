import type { Scenario, ScenarioContext } from "../../session";
import type { Json } from "../../types";
import {
  DEMO_SETTINGS,
  PUBLISHED_LIMITS,
  claimNext,
  deliver,
  dueForDelivery,
  enqueue,
  findOpenDuplicate,
  formatX10,
  halfUpX10,
  issueCode,
  markDone,
  planRemovals,
  quotaDecision,
  recordFailure,
  totals,
  verifyCode,
  type EmailToken,
  type LevelOption,
  type QueuedRequest,
  type RemovalPlan,
  type StarCounts,
  type User,
} from "./rules";

export const RATING_SCENARIO_ID = "rating.request-to-report";

export const RATING_STEPS = [
  "email.issue",
  "email.verify",
  "quota.check",
  "request.dedupe",
  "request.queue",
  "worker.claim",
  "scrape.fetch",
  "rating.estimate",
  "plan.build",
  "report.render",
  "delivery.hold",
  "delivery.send",
] as const;

export const RATING_FAULTS = [
  "code-reissued",
  "two-workers",
  "worker-not-scheduled",
  "scrape-fails-once",
  "scrape-fails-three-times",
  "early-delivery",
] as const;

export type RatingFaultId = (typeof RATING_FAULTS)[number];

export const BREAKDOWN_NAMES = ["mostly positive", "polarised", "small sample", "low rated"] as const;
export type BreakdownName = (typeof BREAKDOWN_NAMES)[number];

/** Invented star breakdowns. None of them is a real product's. */
export const BREAKDOWNS: Record<BreakdownName, StarCounts> = {
  "mostly positive": { 5: 700, 4: 150, 3: 60, 2: 30, 1: 60 },
  polarised: { 5: 520, 4: 40, 3: 30, 2: 40, 1: 370 },
  "small sample": { 5: 9, 4: 3, 3: 1, 2: 1, 1: 4 },
  "low rated": { 5: 120, 4: 80, 3: 150, 2: 250, 1: 400 },
};

export const QUEUE_STATES = ["no", "yes, pending", "yes, scraping"] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export const CODE_ENTRIES = ["the right code", "a wrong code", "the right code, 20 minutes late"] as const;
export type CodeEntry = (typeof CODE_ENTRIES)[number];

export interface RatingInput {
  /** Which invented star breakdown the product has. */
  breakdown: BreakdownName;
  /** The rating the seller wants the product to show. */
  targetRating: number;
  /** Free requests this email has used before the run. */
  freeRequestsUsed: number;
  /** Whether the same product is already in the queue for this email. */
  alreadyQueued: QueueState;
  /** What the visitor types when asked for the code. */
  codeEntered: CodeEntry;
}

const FIRST: RatingInput = { breakdown: "mostly positive", targetRating: 4.6, freeRequestsUsed: 0, alreadyQueued: "no", codeEntered: "the right code" };

export const RATING_PRESETS: { id: string; label: string; description: string; input: RatingInput }[] = [
  {
    id: "first-request",
    label: "A first request",
    description: "A verified email, free requests left and a target the plan can reach. The report goes out at the 24-hour mark.",
    input: FIRST,
  },
  {
    id: "fourth-request",
    label: "A fourth request",
    description: "The email has used its three free requests. The request is refused with an invitation to sign up, and nothing is queued.",
    input: { ...FIRST, freeRequestsUsed: 3 },
  },
  {
    id: "duplicate",
    label: "The same product again",
    description: "The same product is already waiting in the queue for this email. No free request is used and nothing is queued twice.",
    input: { ...FIRST, freeRequestsUsed: 1, alreadyQueued: "yes, pending" },
  },
  {
    id: "unreachable-target",
    label: "A target out of reach",
    description: "The seller asks for 4.9. The planner refuses instead of inventing a plan, and the report says how far removals could go.",
    input: { ...FIRST, targetRating: 4.9 },
  },
  {
    id: "expired-code",
    label: "An expired code",
    description: "The right code, typed 20 minutes after it was issued. It lasted 15, so the email is not verified and nothing is accepted.",
    input: { ...FIRST, codeEntered: "the right code, 20 minutes late" },
  },
  {
    id: "low-rated",
    label: "A low-rated product",
    description: "Most ratings are one and two stars. The plan only counts ratings below the average: removing a three-star rating here would lower the result.",
    input: { ...FIRST, breakdown: "low rated", targetRating: 3 },
  },
];

export const RATING_DEFAULT_INPUT: RatingInput = RATING_PRESETS[0].input;

export function validateRatingInput(raw: Partial<Record<keyof RatingInput, unknown>>): {
  ok: boolean;
  value: RatingInput;
  errors: Partial<Record<keyof RatingInput, string>>;
} {
  const errors: Partial<Record<keyof RatingInput, string>> = {};
  const number = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN);

  const breakdown = BREAKDOWN_NAMES.includes(raw.breakdown as BreakdownName) ? (raw.breakdown as BreakdownName) : null;
  if (!breakdown) errors.breakdown = "Choose one of the listed breakdowns.";
  const target = number(raw.targetRating);
  const targetOk = Number.isFinite(target) && target >= 1 && target <= 5;
  if (!targetOk) errors.targetRating = "Use a rating from 1.0 to 5.0.";
  const used = number(raw.freeRequestsUsed);
  const usedOk = Number.isInteger(used) && used >= 0 && used <= PUBLISHED_LIMITS.freeRequests;
  if (!usedOk) errors.freeRequestsUsed = `Use a whole number from 0 to ${PUBLISHED_LIMITS.freeRequests}.`;
  const alreadyQueued = QUEUE_STATES.includes(raw.alreadyQueued as QueueState) ? (raw.alreadyQueued as QueueState) : null;
  if (!alreadyQueued) errors.alreadyQueued = "Choose one of the listed answers.";
  const codeEntered = CODE_ENTRIES.includes(raw.codeEntered as CodeEntry) ? (raw.codeEntered as CodeEntry) : null;
  if (!codeEntered) errors.codeEntered = "Choose one of the listed answers.";

  return {
    ok: Object.keys(errors).length === 0,
    value: {
      breakdown: breakdown ?? RATING_DEFAULT_INPUT.breakdown,
      targetRating: targetOk ? Math.round(target * 10) / 10 : RATING_DEFAULT_INPUT.targetRating,
      freeRequestsUsed: usedOk ? used : RATING_DEFAULT_INPUT.freeRequestsUsed,
      alreadyQueued: alreadyQueued ?? RATING_DEFAULT_INPUT.alreadyQueued,
      codeEntered: codeEntered ?? RATING_DEFAULT_INPUT.codeEntered,
    },
    errors,
  };
}

// -- Invented world ----------------------------------------------------------

/** Invented values. The product code is not a real one, the codes are fixed, and the token is not a secret. */
export const DEMO_WORLD = {
  email: "seller@example.test",
  product: "B0EXAMPLE1",
  firstCode: "123456",
  secondCode: "654321",
  wrongCode: "000000",
  pdfPath: "demo/report-not-a-real-file.pdf",
  linkToken: "demo-token-not-a-secret",
} as const;

const HOUR = 3_600_000;
const SCRAPE_ERROR = "The fetch returned no star breakdown (an invented failure).";

/** Virtual time as an offset from the start of the run, so no date is implied. */
function clock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `T${ms < 0 ? "-" : "+"}${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function span(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function countsView(counts: StarCounts): Json {
  return { "5 stars": counts[5], "4 stars": counts[4], "3 stars": counts[3], "2 stars": counts[2], "1 star": counts[1] };
}

function tokenView(token: EmailToken): Json {
  return { email: token.email, code: token.code, expires_at: clock(token.expires_at), consumed: token.consumed };
}

function userView(user: User): Json {
  return { email: user.email, verified_at: user.verified_at === null ? null : clock(user.verified_at), free_used: user.free_used, unlimited: user.unlimited, created_at: clock(user.created_at) };
}

function requestView(request: QueuedRequest): Json {
  return {
    id: request.id,
    email: request.email,
    asin: request.asin,
    status: request.status,
    created_at: clock(request.created_at),
    deliver_at: clock(request.deliver_at),
    attempts: request.attempts,
    pdf_path: request.pdf_path,
    link_token: request.link_token,
    delivered_at: request.delivered_at === null ? null : clock(request.delivered_at),
    error: request.error,
  };
}

function levelLine(level: LevelOption, targetX10: number): string {
  const name = `${level.star}-star`;
  if (level.verdict === "none-to-remove") return `${name}: there are none.`;
  if (level.verdict === "would-not-raise") return `${name}: never proposed. These ratings are at or above the average, so removing one would not raise it.`;
  if (level.verdict === "falls-short") return `${name}: removing ${level.available === 1 ? "the only one" : `all ${level.available}`} reaches only ${formatX10(level.bestX10!)}.`;
  return `${name}: removing ${level.remove} of ${level.available} reaches ${formatX10(targetX10)}.`;
}

function planView(plan: RemovalPlan): Json {
  if (plan.outcome === "no-ratings") return { outcome: "refused", reason: "The product has no ratings." };
  if (plan.outcome === "already-met") return { outcome: "nothing to remove", current: formatX10(plan.currentX10), target: formatX10(plan.targetX10) };
  const levels = plan.levels.map((level) => ({
    star: level.star,
    available: level.available,
    verdict: level.verdict,
    remove: level.remove,
    best: level.bestX10 === null ? null : formatX10(level.bestX10),
  }));
  if (plan.outcome === "plan") {
    return {
      outcome: "plan",
      current: formatX10(plan.currentX10),
      target: formatX10(plan.targetX10),
      remove: plan.remove,
      star: plan.star,
      available: plan.available,
      result: formatX10(plan.resultX10),
      reading: "a ceiling, not a to-do list",
      levels,
    };
  }
  return {
    outcome: "refused",
    current: formatX10(plan.currentX10),
    target: formatX10(plan.targetX10),
    ceiling: formatX10(plan.ceilingX10),
    ceiling_star: plan.ceilingStar,
    levels,
  };
}

/** One sentence on the plan, for the outcome of the run. */
function planSentence(plan: RemovalPlan): string {
  if (plan.outcome === "no-ratings") return "the product has no ratings, so there is nothing to plan";
  if (plan.outcome === "already-met") return `the target of ${formatX10(plan.targetX10)} is already met, so no removal is proposed`;
  if (plan.outcome === "plan") {
    return `removing ${plan.remove} of ${plan.available} ${plan.star}-star ratings would show ${formatX10(plan.resultX10)}, as a ceiling and not a to-do list`;
  }
  return `the planner refused the target of ${formatX10(plan.targetX10)}: ${ceilingSentence(plan)}`;
}

/** How far removals at one star level could go, when the target is out of reach. */
function ceilingSentence(plan: Extract<RemovalPlan, { outcome: "unreachable" }>): string {
  if (plan.ceilingStar === null) return `no removal would raise the rating above ${formatX10(plan.ceilingX10)}`;
  const available = plan.levels.find((level) => level.star === plan.ceilingStar)!.available;
  return `the most one star level can do is ${formatX10(plan.ceilingX10)}, by removing all ${available} ${plan.ceilingStar}-star ratings`;
}

function* run({ input, faults, t }: ScenarioContext<RatingInput>): Generator<void, void, string> {
  const settings = DEMO_SETTINGS;
  const limits = PUBLISHED_LIMITS;
  const { email, product } = DEMO_WORLD;
  const counts = BREAKDOWNS[input.breakdown];
  const targetX10 = Math.round(input.targetRating * 10);
  const late = input.codeEntered === "the right code, 20 minutes late";

  // What exists before the run. A request already in the queue has used one free request,
  // and earlier requests for other invented products were delivered at least a day ago.
  const queuedBefore = input.alreadyQueued !== "no";
  const usedBefore = Math.max(input.freeRequestsUsed, queuedBefore ? 1 : 0);
  const earlier = -settings.earlierRequestAgoMs;
  const day = limits.deliverAfterHours * HOUR;
  const tokens: EmailToken[] = [];
  const requests: QueuedRequest[] = [];
  let user: User | null = usedBefore > 0 ? { email, verified_at: earlier - usedBefore * day, free_used: usedBefore, unlimited: false, created_at: earlier - usedBefore * day } : null;
  for (let index = 1; index <= usedBefore; index += 1) {
    const open = queuedBefore && index === usedBefore;
    const created = open ? earlier : earlier - (usedBefore - index + 1) * day;
    requests.push({
      id: index,
      email,
      asin: open ? product : `B0EARLIER${index}`,
      status: open ? (input.alreadyQueued === "yes, scraping" ? "scraping" : "pending") : "done",
      created_at: created,
      deliver_at: created + day,
      attempts: open && input.alreadyQueued === "yes, pending" ? 0 : 1,
      pdf_path: null,
      link_token: null,
      delivered_at: open ? null : created + day,
      error: null,
    });
  }

  // -- 1. Issue a code -----------------------------------------------------------
  t.start("email.issue", { email, product, asks_for: "a code that proves the address" });
  t.advance(settings.apiMs);
  let live = issueCode(tokens, email, DEMO_WORLD.firstCode, t.time);
  t.change("email_tokens", "insert", `${email}#1`, null, tokenView(live));
  t.log("info", `A ${limits.codeDigits}-digit code that lasts ${limits.codeLifetimeMinutes} minutes. The code shown is a fixed, invented one: the simulation uses no randomness.`);
  t.log("info", "Sending the code is part of the transactional email work the write-up lists as in progress. No message is sent by this simulation.");
  if (faults.has("code-reissued")) {
    t.advance(settings.secondCodeAfterMs);
    const first = live;
    const before = tokenView(first);
    live = issueCode(tokens, email, DEMO_WORLD.secondCode, t.time);
    t.change("email_tokens", "update", `${email}#1`, before, tokenView(first));
    t.change("email_tokens", "insert", `${email}#2`, null, tokenView(live));
    t.log("warn", "The visitor asked for a second code. Issuing it invalidates the first one.");
  }
  t.ok({ codes_issued: tokens.length, codes_still_valid: tokens.filter((token) => !token.consumed).length, expires_at: clock(live.expires_at) });

  // -- 2. Verify -------------------------------------------------------------------
  const typed = input.codeEntered === "a wrong code" ? DEMO_WORLD.wrongCode : live.code;
  if (faults.has("code-reissued")) {
    t.advance(settings.typingMs);
    t.start("email.verify", { email, code: DEMO_WORLD.firstCode, note: "the first of the two codes" });
    t.advance(settings.apiMs);
    if (verifyCode(tokens, email, DEMO_WORLD.firstCode, t.time).ok) throw new Error("The demo accepted a code that had been replaced.");
    const wait = late ? settings.lateCodeMs : settings.retypeMs;
    t.log("warn", "The first code stopped being valid when the second was issued, so it is refused.");
    t.fail("CODE_INVALIDATED", "That code was replaced by a newer one.", wait);
    t.advance(wait);
  } else {
    t.advance(late ? settings.lateCodeMs : settings.typingMs);
  }
  t.start("email.verify", { email, code: typed });
  t.advance(settings.apiMs);
  const check = verifyCode(tokens, email, typed, t.time);
  if (!check.ok) {
    const message =
      check.reason === "expired"
        ? `The code is the right one, but it was typed after its ${limits.codeLifetimeMinutes}-minute lifetime ended at ${clock(live.expires_at)}.`
        : "The code does not match the one issued for this address.";
    t.log("warn", check.reason === "expired" ? `${message} A new code has to be requested.` : `${message} Whether wrong attempts are counted or limited is not described in the public write-up.`);
    t.fail(check.reason === "expired" ? "CODE_EXPIRED" : "CODE_WRONG", message);
    t.skipRemaining("The email was not verified, so no request was accepted.");
    t.finish("failed", `No request: ${message} Nothing was queued and no free request was used.`, { verified: false, reason: check.reason, queued: false });
    return;
  }
  t.change("email_tokens", "update", `${email}#${tokens.indexOf(check.token) + 1}`, { ...(tokenView(check.token) as Record<string, Json>), consumed: false }, tokenView(check.token));
  if (user) {
    t.log("info", "This address was verified on an earlier visit and already has a row in users. The demo asks for a code on every run; whether the real flow does is not described in the public write-up.");
  } else {
    user = { email, verified_at: t.time, free_used: 0, unlimited: false, created_at: t.time };
    t.change("users", "insert", email, null, userView(user));
  }
  t.ok({ verified: true, email });

  // -- 3. Quota --------------------------------------------------------------------
  t.advance(settings.submitAfterMs);
  t.start("quota.check", { email, product, free_used: user.free_used, free_limit: limits.freeRequests, unlimited: user.unlimited });
  t.advance(settings.writeMs);
  const quota = quotaDecision(user);
  if (!quota.allowed) {
    t.log("warn", `This email has used its ${limits.freeRequests} free requests. The answer carries prompt_signup, so the page can invite the visitor to sign up, which makes the account unlimited.`);
    t.ok({ allowed: false, prompt_signup: true, free_used: user.free_used }, "Refused: the free requests are used up.");
    t.skipRemaining("The quota refused the request, so nothing was queued.");
    t.finish("success", `Refused with an invitation to sign up: ${email} has used its ${limits.freeRequests} free requests. Nothing was queued and nothing was fetched.`, {
      queued: false,
      prompt_signup: true,
      free_used: user.free_used,
    });
    return;
  }
  t.log("info", "The write-up does not say whether the quota or the duplicate check runs first. The demo runs them in the order the write-up lists them.");
  t.ok({ allowed: true, free_left_before_this_request: quota.remaining });

  // -- 4. Deduplicate ----------------------------------------------------------------
  t.start("request.dedupe", { email, product, looks_for: "the same product, still pending or scraping" });
  t.advance(settings.writeMs);
  const duplicate = findOpenDuplicate(requests, email, product);
  if (duplicate) {
    t.log("info", `Request ${duplicate.id} for ${product} is already ${duplicate.status}. It is returned as it is: no free request is used and nothing is queued twice.`);
    t.ok({ duplicate: true, existing_request: duplicate.id, status: duplicate.status, free_used: user.free_used, queued_again: false });
    t.skipRemaining("An identical request is already in the queue, and that one carries on.");
    t.finish(
      "success",
      `Already in the queue: request ${duplicate.id} for ${product} is ${duplicate.status}, so this submission used no free request and added nothing. The earlier request is due at ${clock(duplicate.deliver_at)}, ${limits.deliverAfterHours} hours after it was created.`,
      { queued: false, duplicate_of: duplicate.id, free_used: user.free_used },
    );
    return;
  }
  t.ok({ duplicate: false });

  // -- 5. Queue ----------------------------------------------------------------------
  t.start("request.queue", { email, product, deliver_after_hours: limits.deliverAfterHours });
  t.advance(settings.writeMs);
  const userBefore = userView(user);
  const request = enqueue(requests, user, product, t.time);
  const key = String(request.id);
  t.change("requests", "insert", key, null, requestView(request));
  t.change("users", "update", email, userBefore, userView(user));
  t.log("info", `Queued as pending. It is worked on as soon as a worker is free and delivered at ${clock(request.deliver_at)}, ${limits.deliverAfterHours} hours after it was created.`);
  t.ok({ request: request.id, status: request.status, deliver_at: clock(request.deliver_at), free_used: user.free_used, free_left: limits.freeRequests - user.free_used });

  // -- 6. Claim ------------------------------------------------------------------------
  if (faults.has("worker-not-scheduled")) {
    t.start("worker.claim", { queue: `request ${request.id} is pending`, schedule: "in progress, according to the write-up" });
    t.advance(request.deliver_at - t.time);
    t.log("error", `It is ${clock(t.time)}, the promised 24-hour mark, and request ${request.id} is still pending. Nothing started a worker.`);
    t.log("info", "The claim and the retry rules are built and unit-tested, according to the write-up. The schedule that would run the worker is listed as in progress.");
    t.fail("WORKER_NOT_RUN", "No worker ran, so nothing claimed the request.");
    t.skipRemaining("The request was never claimed.");
    t.finish(
      "failed",
      `Request ${request.id} for ${product} is queued and still pending at the 24-hour mark. The write-up lists the worker's schedule as in progress: until it exists, nothing in the write-up starts the worker, so a queued request waits. What the visitor is told in that case is not described.`,
      { request: request.id, status: request.status, delivered: false },
    );
    return;
  }
  t.advance(settings.workerPickupMs);
  t.start("worker.claim", { transaction: "BEGIN IMMEDIATE", takes: "the oldest pending request" });
  t.advance(settings.writeMs);
  const beforeClaim = requestView(request);
  if (claimNext(requests) !== request) throw new Error("The demo queue did not hand out the request it had just queued.");
  t.change("requests", "update", key, beforeClaim, requestView(request));
  t.log("info", "Reading the next pending request and marking it happen inside one immediate transaction, so another writer cannot come between them.");
  const twoWorkers = faults.has("two-workers");
  if (twoWorkers) {
    if (claimNext(requests) !== null) throw new Error("The demo queue handed the same work to two workers.");
    t.log("warn", "A second worker asked for work in the same moment. An immediate transaction takes the write lock when it begins, so the second could only read the queue after the first had committed. By then no request was pending: it found nothing to claim.");
  }
  t.ok({ claimed_by: "worker A", request: request.id, status: request.status, attempt: request.attempts, ...(twoWorkers ? { worker_B: "found nothing to claim" } : {}) });

  // -- 7. Fetch ------------------------------------------------------------------------
  const failures = faults.has("scrape-fails-three-times") ? limits.maxAttempts : faults.has("scrape-fails-once") ? 1 : 0;
  for (let attempt = 1; ; attempt += 1) {
    t.start("scrape.fetch", { product, attempt, of: limits.maxAttempts, wants: "the star breakdown, the reviews and their metadata" });
    if (attempt > 1) {
      const beforeAgain = requestView(request);
      if (claimNext(requests) !== request) throw new Error("The demo queue did not hand the request out again.");
      t.change("requests", "update", key, beforeAgain, requestView(request));
      t.log("info", `A worker claimed the request again. ${span(request.deliver_at - t.time)} of the 24 hours are left.`);
    }
    if (attempt > failures) {
      t.advance(settings.scrapeMs);
      break;
    }
    t.advance(settings.scrapeFailureMs);
    const beforeFailure = requestView(request);
    const next = recordFailure(request, SCRAPE_ERROR);
    t.change("requests", "update", key, beforeFailure, requestView(request));
    if (next === "failed") {
      t.log("error", `Attempt ${request.attempts} of ${limits.maxAttempts} failed. The request is marked failed and is not tried again.`);
      t.log("info", "The write-up's pipeline diagram says an apology email follows. Transactional email is in progress, and this simulation sends nothing. Whether the free request is given back is not described.");
      t.fail("REQUEST_FAILED", `The fetch failed on all ${limits.maxAttempts} attempts.`);
      t.skipRemaining("The request failed, so there is nothing to estimate, plan or deliver.");
      t.finish(
        "failed",
        `Request ${request.id} for ${product} was marked failed after ${limits.maxAttempts} attempts, ${span(request.deliver_at - t.time)} before the 24-hour mark. No report exists. The write-up's diagram says an apology email follows; sending email is still in progress there, and nothing is sent here.`,
        { request: request.id, status: request.status, attempts: request.attempts, delivered: false },
      );
      return;
    }
    t.log("warn", `Attempt ${request.attempts} of ${limits.maxAttempts} failed. The request went back to pending for a worker to claim again.`);
    t.fail("SCRAPE_FAILED", SCRAPE_ERROR, settings.workerPickupMs);
    t.advance(settings.workerPickupMs);
  }
  const { ratings, starSum } = totals(counts);
  t.log("info", "The real scraper integration is in progress, according to the write-up. This step returns an invented star breakdown; single reviews and their metadata are not modelled.");
  t.ok({ source: "invented data, not a scrape", breakdown: countsView(counts), ratings, attempts: request.attempts }, "Invented data stands in for the scraper, which is in progress in the real system.");

  // -- 8. Estimate ---------------------------------------------------------------------
  const currentX10 = halfUpX10(counts);
  if (currentX10 === null) throw new Error("The demo breakdown has no ratings.");
  t.start("rating.estimate", { breakdown: countsView(counts), in_production: "a trained model gives the headline estimate", on_this_page: "the transparent half-up weighted average" });
  t.advance(settings.estimateMs);
  t.log("warn", "In production the headline estimate comes from a trained model (LightGBM). That model is private and this page does not have it, so no model estimate is printed.");
  t.log("info", `Shown instead: ${starSum} stars over ${ratings} ratings, rounded half-up to one decimal, is ${formatX10(currentX10)}. It is the average the write-up uses for the sliders and the planner, and it can be checked by hand.`);
  t.ok(
    { transparent_average: formatX10(currentX10), star_sum: starSum, ratings, rounding: "half-up to one decimal, in whole-number arithmetic", model_estimate: "not reproduced on this page" },
    "This is the transparent average, not the production model's estimate.",
  );

  // -- 9. Plan -------------------------------------------------------------------------
  const plan = planRemovals(counts, targetX10);
  t.start("plan.build", { current: formatX10(currentX10), target: formatX10(targetX10), rule: "the smallest number of removals at one star level that reaches the target" });
  t.advance(settings.planMs);
  t.log("info", "In production the plan for a product ranks single reviews by a metadata-aware weight (verified, helpful votes, recency). That weight is private. This page runs the bucket-level planner on the transparent average, and the target is an input of the run: the write-up does not say where it comes from in the queued flow.");
  if (plan.outcome === "plan" || plan.outcome === "unreachable") {
    for (const level of plan.levels) t.log("info", levelLine(level, targetX10));
  }
  if (plan.outcome === "unreachable") t.log("warn", `A target of ${formatX10(plan.targetX10)} is refused: ${ceilingSentence(plan)}. No plan is invented.`);
  else if (plan.outcome === "already-met") t.log("info", `Nothing to do: ${planSentence(plan)}.`);
  else if (plan.outcome === "plan") t.log("info", "The figure is a ceiling, not a to-do list: only reviews that genuinely breach the marketplace's guidelines can be acted on, and this tool removes nothing itself.");
  const beforeDone = requestView(request);
  markDone(request);
  t.change("requests", "update", key, beforeDone, requestView(request));
  t.log("info", "The estimate and the plan exist, so the request is marked done. The write-up puts the report after that point.");
  t.ok(planView(plan), plan.outcome === "unreachable" ? "The planner refused the target instead of inventing a plan." : undefined);

  // -- 10. Report ----------------------------------------------------------------------
  t.start("report.render", { request: request.id, renders: "the results page, printed to PDF by a headless browser", issues: "a link token for the interactive results page" });
  t.advance(settings.renderMs);
  const beforeReport = requestView(request);
  request.pdf_path = DEMO_WORLD.pdfPath;
  request.link_token = DEMO_WORLD.linkToken;
  t.change("requests", "update", key, beforeReport, requestView(request));
  t.log("info", "No PDF is made by this simulation, and the token is a fixed, invented string. How the real token is generated is not described in the public write-up.");
  t.ok({ pdf_path: request.pdf_path, link_token: request.link_token, ready_at: clock(t.time), deliver_at: clock(request.deliver_at) });

  // -- 11. Hold ------------------------------------------------------------------------
  t.start("delivery.hold", { request: request.id, now: clock(t.time), deliver_at: clock(request.deliver_at), rule: `deliver ${limits.deliverAfterHours} hours after the request was created, not before` });
  let heldBack = 0;
  if (faults.has("early-delivery")) {
    if (deliver(request, t.time)) throw new Error("The demo delivered a report before the 24-hour mark.");
    heldBack += 1;
    t.log("warn", `Delivery was asked for at ${clock(t.time)}, ${span(request.deliver_at - t.time)} before the mark. The request is done but not due, so nothing was sent.`);
  }
  const buffer = Math.max(0, request.deliver_at - t.time);
  t.advance(buffer);
  t.log("info", `The work finished ${span(buffer)} early. That gap is the buffer the write-up describes: time to notice a failure and try again before the promised turnaround.`);
  t.ok({ held_for: span(buffer), due: dueForDelivery(request, t.time), early_requests_held_back: heldBack }, heldBack > 0 ? "An early delivery was held back until the 24-hour mark." : undefined);

  // -- 12. Deliver ---------------------------------------------------------------------
  t.start("delivery.send", { to: email, attachment: request.pdf_path, link_token: request.link_token, at: clock(t.time) });
  t.advance(settings.sendMs);
  const beforeDelivery = requestView(request);
  const delivered = deliver(request, t.time);
  if (!delivered) throw new Error("The demo did not deliver a report that was due.");
  t.change("requests", "update", key, beforeDelivery, requestView(request));
  t.log("warn", "Transactional email is in progress in the real system, according to the write-up. This simulation sends no message; it records what the step is designed to do.");
  t.ok({ delivered, delivered_at: request.delivered_at === null ? null : clock(request.delivered_at), to: email }, "Simulated: sending email is in progress in the real system.");

  t.finish(
    "success",
    `Report for ${product} delivered to ${email} at the 24-hour mark, in simulation. Transparent average ${formatX10(currentX10)}; ${planSentence(plan)}. The production headline comes from a trained model this page does not have, and in the real system the scraper, the email and the worker's schedule are still in progress.`,
    {
      request: request.id,
      status: request.status,
      attempts: request.attempts,
      delivered,
      transparent_average: formatX10(currentX10),
      plan: plan.outcome,
      free_used: user.free_used,
    },
  );
}

export const ratingScenario: Scenario<RatingInput> = {
  id: RATING_SCENARIO_ID,
  stepIds: RATING_STEPS,
  run,
};
