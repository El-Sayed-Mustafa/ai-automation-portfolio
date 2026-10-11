import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import { DEMO_SETTINGS, PUBLISHED_LIMITS, halfUpX10 } from "./rules";
import {
  BREAKDOWNS,
  BREAKDOWN_NAMES,
  CODE_ENTRIES,
  DEMO_WORLD,
  QUEUE_STATES,
  RATING_DEFAULT_INPUT,
  RATING_FAULTS,
  RATING_PRESETS,
  RATING_SCENARIO_ID,
  RATING_STEPS,
  ratingScenario,
  validateRatingInput,
  type RatingFaultId,
  type RatingInput,
} from "./scenario";

const DAY = 24 * 3_600_000;

function execute(options: { input?: Partial<RatingInput>; faults?: RatingFaultId[] } = {}) {
  const session = new RunSession(ratingScenario, {
    runId: "test-run",
    input: { ...RATING_DEFAULT_INPUT, ...options.input },
    faults: options.faults,
  });
  return { session, events: session.events, state: reduceRun(RATING_STEPS, session.events) };
}

type Change = Extract<RunEvent, { type: "state.changed" }>;

function statuses(state: RunState) {
  return Object.fromEntries(RATING_STEPS.map((id) => [id, state.steps[id].status]));
}

function changesTo(events: readonly RunEvent[], table: string) {
  return events.filter((event): event is Change => event.type === "state.changed" && event.table === table);
}

function logs(state: RunState) {
  return state.logs.map((entry) => entry.message).join("\n");
}

function started(events: readonly RunEvent[], stepId: string) {
  return events.filter((event): event is Extract<RunEvent, { type: "step.started" }> => event.type === "step.started" && event.stepId === stepId);
}

function preset(id: string): RatingInput {
  return RATING_PRESETS.find((item) => item.id === id)!.input;
}

/** The request row as the run left it. */
function lastRequest(events: readonly RunEvent[]) {
  return changesTo(events, "requests").at(-1)?.after as Record<string, unknown> | undefined;
}

describe("a first request, from a verified email to a delivered report", () => {
  const { state, events, session } = execute();

  it("completes every step without asking anyone anything", () => {
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
    expect(Object.values(statuses(state)).every((status) => status === "success")).toBe(true);
    expect(events.some((event) => event.type === "step.waiting")).toBe(false);
    expect(events[0]).toMatchObject({ type: "run.started", scenarioId: RATING_SCENARIO_ID });
  });

  it("issues a six-digit code that lasts fifteen minutes", () => {
    const [token] = changesTo(events, "email_tokens");
    expect(token).toMatchObject({ op: "insert", after: { email: "seller@example.test", expires_at: "T+00:15:00", consumed: false } });
    expect((token.after as { code: string }).code).toMatch(/^\d{6}$/);
    expect(state.steps["email.issue"].output).toEqual({ codes_issued: 1, codes_still_valid: 1, expires_at: "T+00:15:00" });
  });

  it("verifies the address, uses the code up and records the user", () => {
    expect(changesTo(events, "email_tokens")[1]).toMatchObject({ op: "update", before: { consumed: false }, after: { consumed: true } });
    expect(changesTo(events, "users")[0]).toMatchObject({ op: "insert", after: { email: "seller@example.test", free_used: 0, unlimited: false } });
    expect(state.steps["email.verify"].output).toEqual({ verified: true, email: "seller@example.test" });
  });

  it("lets the request through the quota and finds no duplicate", () => {
    expect(state.steps["quota.check"].output).toEqual({ allowed: true, free_left_before_this_request: 3 });
    expect(state.steps["request.dedupe"].output).toEqual({ duplicate: false });
  });

  it("queues it as pending, due exactly 24 hours after it was created, and uses one free request", () => {
    const [queued] = changesTo(events, "requests");
    expect(queued).toMatchObject({ op: "insert", after: { asin: "B0EXAMPLE1", status: "pending", created_at: "T+00:00:45", deliver_at: "T+24:00:45", attempts: 0 } });
    expect(changesTo(events, "users")[1]).toMatchObject({ op: "update", before: { free_used: 0 }, after: { free_used: 1 } });
    expect(state.steps["request.queue"].output).toMatchObject({ status: "pending", free_used: 1, free_left: 2 });
  });

  it("is claimed once, by one worker", () => {
    const claims = changesTo(events, "requests").filter((change) => (change.before as { status?: string } | null)?.status === "pending");
    expect(claims).toHaveLength(1);
    expect(claims[0].after).toMatchObject({ status: "scraping", attempts: 1 });
    expect(state.steps["worker.claim"].output).toEqual({ claimed_by: "worker A", request: 1, status: "scraping", attempt: 1 });
  });

  it("says that the fetched breakdown is invented, because the real scraper is in progress", () => {
    expect(state.steps["scrape.fetch"].output).toMatchObject({ source: "invented data, not a scrape", ratings: 1000 });
    expect(state.steps["scrape.fetch"].warning).toMatch(/in progress/);
  });

  it("shows the transparent average and prints no model estimate", () => {
    const output = state.steps["rating.estimate"].output as Record<string, unknown>;
    expect(output).toMatchObject({ transparent_average: "4.4", star_sum: 4400, ratings: 1000, model_estimate: "not reproduced on this page" });
    expect(state.steps["rating.estimate"].warning).toBe("This is the transparent average, not the production model's estimate.");
    expect(logs(state)).toMatch(/this page does not have it, so no model estimate is printed/);
  });

  it("plans the smallest number of removals at one star level, as a ceiling", () => {
    expect(state.steps["plan.build"].output).toMatchObject({ outcome: "plan", current: "4.4", target: "4.6", remove: 43, star: 1, available: 60, result: "4.6", reading: "a ceiling, not a to-do list" });
    expect(logs(state)).toMatch(/1-star: removing 43 of 60 reaches 4\.6\./);
    expect(logs(state)).toMatch(/5-star: never proposed/);
    expect(logs(state)).toMatch(/only reviews that genuinely breach the marketplace's guidelines can be acted on, and this tool removes nothing itself/);
  });

  it("marks the request done before the report is made, then stores the report's path and link token", () => {
    const updates = changesTo(events, "requests").map((change) => change.after as Record<string, unknown>);
    const done = updates.findIndex((row) => row.status === "done");
    const withReport = updates.findIndex((row) => row.pdf_path !== null);
    expect(done).toBeGreaterThan(0);
    expect(withReport).toBe(done + 1);
    expect(updates[withReport]).toMatchObject({ pdf_path: DEMO_WORLD.pdfPath, link_token: DEMO_WORLD.linkToken, delivered_at: null });
  });

  it("finishes the work in minutes and holds the result until the 24-hour mark", () => {
    const created = changesTo(events, "requests")[0].at;
    const ready = started(events, "delivery.hold")[0].at;
    const sent = started(events, "delivery.send")[0].at;
    expect(ready - created).toBeLessThan(10 * 60_000);
    expect(sent - created).toBe(DAY);
    expect(state.steps["delivery.hold"].output).toEqual({ held_for: "23 h 54 min", due: true, early_requests_held_back: 0 });
    expect(lastRequest(events)).toMatchObject({ status: "done", delivered_at: "T+24:00:46" });
  });

  it("says plainly which parts do not run in the real system yet", () => {
    expect(state.steps["delivery.send"].warning).toMatch(/in progress in the real system/);
    expect(logs(state)).toMatch(/Sending the code is part of the transactional email work the write-up lists as in progress/);
    expect(state.outcome).toMatch(/in simulation/);
    expect(state.outcome).toMatch(/the scraper, the email and the worker's schedule are still in progress/);
  });

  it("reports the plan in its outcome", () => {
    expect(state.outcome).toMatch(/Transparent average 4\.4; removing 43 of 60 1-star ratings would show 4\.6, as a ceiling and not a to-do list\./);
    expect(state.summary).toEqual({ request: 1, status: "done", attempts: 1, delivered: true, transparent_average: "4.4", plan: "plan", free_used: 1 });
  });

  it("is deterministic", () => {
    expect(execute().events).toEqual(events);
  });
});

describe("requests that end early, for an honest reason", () => {
  it("a fourth request is refused with an invitation to sign up, and nothing is queued", () => {
    const { state, events } = execute({ input: preset("fourth-request") });
    expect(state.status).toBe("success");
    expect(state.steps["quota.check"].output).toEqual({ allowed: false, prompt_signup: true, free_used: 3 });
    expect(state.steps["quota.check"].warning).toMatch(/free requests are used up/);
    expect(changesTo(events, "requests")).toHaveLength(0);
    expect(changesTo(events, "users")).toHaveLength(0);
    expect(statuses(state)["request.dedupe"]).toBe("skipped");
    expect(statuses(state)["delivery.send"]).toBe("skipped");
    expect(state.outcome).toMatch(/Refused with an invitation to sign up/);
  });

  it("a third request still goes through", () => {
    const { state } = execute({ input: { freeRequestsUsed: 2 } });
    expect(state.status).toBe("success");
    expect(state.steps["quota.check"].output).toEqual({ allowed: true, free_left_before_this_request: 1 });
    expect(state.steps["request.queue"].output).toMatchObject({ request: 3, free_used: 3, free_left: 0 });
  });

  it("the same product again, while the first is pending, uses no free request and queues nothing", () => {
    const { state, events } = execute({ input: preset("duplicate") });
    expect(state.status).toBe("success");
    expect(state.steps["request.dedupe"].output).toEqual({ duplicate: true, existing_request: 1, status: "pending", free_used: 1, queued_again: false });
    expect(changesTo(events, "requests")).toHaveLength(0);
    expect(changesTo(events, "users")).toHaveLength(0);
    expect(statuses(state)["request.queue"]).toBe("skipped");
    expect(state.outcome).toMatch(/used no free request and added nothing/);
  });

  it("the same holds while the first is being processed", () => {
    const { state, events } = execute({ input: { alreadyQueued: "yes, scraping" } });
    expect(state.steps["request.dedupe"].output).toMatchObject({ duplicate: true, status: "scraping", free_used: 1 });
    expect(changesTo(events, "requests")).toHaveLength(0);
  });

  it("an expired code is refused: the email is not verified and nothing is accepted", () => {
    const { state, events } = execute({ input: preset("expired-code") });
    expect(state.status).toBe("failed");
    expect(state.steps["email.verify"].error).toMatchObject({ code: "CODE_EXPIRED" });
    expect(state.steps["email.verify"].error?.message).toMatch(/15-minute lifetime ended at T\+00:15:00/);
    expect(changesTo(events, "users")).toHaveLength(0);
    expect(changesTo(events, "requests")).toHaveLength(0);
    expect(changesTo(events, "email_tokens")).toHaveLength(1);
    expect(statuses(state)["quota.check"]).toBe("skipped");
    expect(state.outcome).toMatch(/Nothing was queued and no free request was used/);
  });

  it("a wrong code is refused too, and the demo does not pretend to know more", () => {
    const { state, events } = execute({ input: { codeEntered: "a wrong code" } });
    expect(state.status).toBe("failed");
    expect(state.steps["email.verify"].error?.code).toBe("CODE_WRONG");
    expect(logs(state)).toMatch(/Whether wrong attempts are counted or limited is not described in the public write-up/);
    expect(changesTo(events, "requests")).toHaveLength(0);
  });
});

describe("the planner inside the run", () => {
  it("refuses a target out of reach, and the report is still delivered with the refusal in it", () => {
    const { state } = execute({ input: preset("unreachable-target") });
    expect(state.status).toBe("success");
    expect(state.steps["plan.build"].output).toMatchObject({ outcome: "refused", current: "4.4", target: "4.9", ceiling: "4.6", ceiling_star: 1 });
    expect(state.steps["plan.build"].warning).toBe("The planner refused the target instead of inventing a plan.");
    expect(logs(state)).toMatch(/A target of 4\.9 is refused: the most one star level can do is 4\.6, by removing all 60 1-star ratings\. No plan is invented\./);
    expect(statuses(state)["delivery.send"]).toBe("success");
    expect(state.outcome).toMatch(/the planner refused the target of 4\.9/);
    expect(state.summary).toMatchObject({ plan: "unreachable", delivered: true });
  });

  it("on a low-rated product, counts only ratings below the average", () => {
    const { state } = execute({ input: preset("low-rated") });
    const output = state.steps["plan.build"].output as { remove: number; star: number; levels: { star: number; verdict: string }[] };
    expect(output).toMatchObject({ outcome: "plan", current: "2.3", target: "3.0", remove: 349, star: 1, result: "3.0" });
    expect(output.levels.filter((level) => level.verdict === "would-not-raise").map((level) => level.star)).toEqual([3, 4, 5]);
    expect(logs(state)).toMatch(/3-star: never proposed\. These ratings are at or above the average/);
  });

  it("proposes nothing when the target is already met", () => {
    const { state } = execute({ input: { targetRating: 4.2 } });
    expect(state.steps["plan.build"].output).toEqual({ outcome: "nothing to remove", current: "4.4", target: "4.2" });
    expect(state.outcome).toMatch(/the target of 4\.2 is already met, so no removal is proposed/);
  });

  it.each(BREAKDOWN_NAMES.flatMap((breakdown) => [1, 2.5, 3.7, 4.4, 4.5, 5].map((targetRating) => [breakdown, targetRating] as const)))("%s with a target of %s shows the average of its own breakdown", (breakdown, targetRating) => {
    const { session, state } = execute({ input: { breakdown, targetRating } });
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
    const expected = halfUpX10(BREAKDOWNS[breakdown])!;
    expect(state.steps["rating.estimate"].output).toMatchObject({ transparent_average: `${Math.floor(expected / 10)}.${expected % 10}` });
    const plan = state.steps["plan.build"].output as { outcome: string; result?: string };
    expect(["plan", "refused", "nothing to remove"]).toContain(plan.outcome);
    if (plan.outcome === "plan") expect(Number(plan.result)).toBeGreaterThanOrEqual(targetRating);
  });
});

describe("failures the queue is built for", () => {
  const clean = execute();

  it("a second code invalidates the first: the old one is refused and the new one is accepted", () => {
    const { state, events } = execute({ faults: ["code-reissued"] });
    const tokens = changesTo(events, "email_tokens");
    expect(tokens.slice(0, 3).map((change) => [change.op, change.key, (change.after as { consumed: boolean }).consumed])).toEqual([
      ["insert", "seller@example.test#1", false],
      ["update", "seller@example.test#1", true],
      ["insert", "seller@example.test#2", false],
    ]);
    expect(state.steps["email.issue"].output).toMatchObject({ codes_issued: 2, codes_still_valid: 1 });
    expect(state.steps["email.verify"].attempts.map((attempt) => [attempt.status, attempt.error?.code])).toEqual([
      ["failed", "CODE_INVALIDATED"],
      ["success", undefined],
    ]);
    expect(started(events, "email.verify").map((event) => (event.input as { code: string }).code)).toEqual([DEMO_WORLD.firstCode, DEMO_WORLD.secondCode]);
    expect(state.status).toBe("success");
  });

  it("a second code does not rescue a wrong or late one", () => {
    expect(execute({ faults: ["code-reissued"], input: { codeEntered: "a wrong code" } }).state.steps["email.verify"].error?.code).toBe("CODE_WRONG");
    expect(execute({ faults: ["code-reissued"], input: { codeEntered: "the right code, 20 minutes late" } }).state.steps["email.verify"].error?.code).toBe("CODE_EXPIRED");
  });

  it("two workers ask at once and one of them gets the request", () => {
    const { state, events } = execute({ faults: ["two-workers"] });
    const claims = changesTo(events, "requests").filter((change) => (change.before as { status?: string } | null)?.status === "pending");
    expect(claims).toHaveLength(1);
    expect(state.steps["worker.claim"].output).toEqual({ claimed_by: "worker A", request: 1, status: "scraping", attempt: 1, worker_B: "found nothing to claim" });
    expect(logs(state)).toMatch(/By then no request was pending: it found nothing to claim\./);
    expect(state.summary).toEqual(clean.state.summary);
  });

  it("a fetch that fails once sends the request back to pending, and the retry fits inside the buffer", () => {
    const { state, events } = execute({ faults: ["scrape-fails-once"] });
    const attempts = state.steps["scrape.fetch"].attempts;
    expect(attempts.map((attempt) => [attempt.status, attempt.error?.code])).toEqual([
      ["failed", "SCRAPE_FAILED"],
      ["success", undefined],
    ]);
    expect(attempts[0].retryAt).toBe(attempts[1].startedAt);
    const rows = changesTo(events, "requests").map((change) => change.after as { status: string; attempts: number });
    expect(rows.slice(1, 4).map((row) => [row.status, row.attempts])).toEqual([
      ["scraping", 1],
      ["pending", 1],
      ["scraping", 2],
    ]);
    expect(state.status).toBe("success");
    expect(state.summary).toMatchObject({ attempts: 2, delivered: true });
    // The retry cost five minutes of the buffer and nothing of the promise: delivery is at the same moment.
    expect(lastRequest(events)?.delivered_at).toBe(lastRequest(clean.events)?.delivered_at);
    expect(started(events, "delivery.send")[0].at).toBe(started(clean.events, "delivery.send")[0].at);
  });

  it("a fetch that fails three times marks the request failed, and nothing is delivered", () => {
    const { state, events } = execute({ faults: ["scrape-fails-three-times"] });
    expect(state.status).toBe("failed");
    expect(state.steps["scrape.fetch"].attempts.map((attempt) => attempt.error?.code)).toEqual(["SCRAPE_FAILED", "SCRAPE_FAILED", "REQUEST_FAILED"]);
    expect(lastRequest(events)).toMatchObject({ status: "failed", attempts: PUBLISHED_LIMITS.maxAttempts, delivered_at: null, pdf_path: null });
    for (const id of ["rating.estimate", "plan.build", "report.render", "delivery.hold", "delivery.send"]) expect(statuses(state)[id]).toBe("skipped");
    expect(state.outcome).toMatch(/marked failed after 3 attempts/);
    expect(logs(state)).toMatch(/Whether the free request is given back is not described/);
    // It failed long before the promised turnaround.
    expect(state.clock).toBeLessThan(DAY / 24);
  });

  it("three failures outrank one when both are switched on", () => {
    expect(execute({ faults: ["scrape-fails-once", "scrape-fails-three-times"] }).state.status).toBe("failed");
  });

  it("delivery asked for early is held, and the report goes out at the mark all the same", () => {
    const { state, events } = execute({ faults: ["early-delivery"] });
    expect(state.steps["delivery.hold"].output).toEqual({ held_for: "23 h 54 min", due: true, early_requests_held_back: 1 });
    expect(state.steps["delivery.hold"].warning).toMatch(/held back until the 24-hour mark/);
    expect(logs(state)).toMatch(/Delivery was asked for at T\+00:06:36, 23 h 54 min before the mark\. The request is done but not due, so nothing was sent\./);
    const delivered = changesTo(events, "requests").filter((change) => (change.after as { delivered_at: string | null }).delivered_at !== null);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].at).toBe(changesTo(clean.events, "requests").at(-1)!.at);
    expect(state.status).toBe("success");
  });
});

describe("what does not run yet", () => {
  it("with no schedule to start the worker, a queued request is still pending at the 24-hour mark", () => {
    const { state, events } = execute({ faults: ["worker-not-scheduled"] });
    expect(state.status).toBe("failed");
    expect(state.steps["worker.claim"].error?.code).toBe("WORKER_NOT_RUN");
    expect(changesTo(events, "requests")).toHaveLength(1);
    expect(lastRequest(events)).toMatchObject({ status: "pending", attempts: 0, delivered_at: null });
    expect(state.clock - changesTo(events, "requests")[0].at).toBe(DAY);
    for (const id of ["scrape.fetch", "rating.estimate", "plan.build", "report.render", "delivery.hold", "delivery.send"]) expect(statuses(state)[id]).toBe("skipped");
    expect(state.outcome).toMatch(/still pending at the 24-hour mark/);
    expect(state.outcome).toMatch(/lists the worker's schedule as in progress/);
  });

  it("outranks a second worker: there is no worker at all", () => {
    const { state } = execute({ faults: ["worker-not-scheduled", "two-workers"] });
    expect(state.steps["worker.claim"].error?.code).toBe("WORKER_NOT_RUN");
  });
});

describe("every preset and every fault", () => {
  it.each(RATING_PRESETS.map((item) => [item.id, item.input] as const))("preset %s ends in a finished run", (_id, input) => {
    const { session, state } = execute({ input });
    expect(session.isFinished).toBe(true);
    expect(session.isWaiting).toBe(false);
    expect(state.outcome).toBeTruthy();
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(RATING_FAULTS.map((fault) => [fault] as const))("%s ends in a finished run", (fault) => {
    const { session, state } = execute({ faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(RATING_PRESETS.flatMap((item) => RATING_FAULTS.map((fault) => [item.id, fault] as const)))("%s with %s is consistent and repeatable", (id, fault) => {
    const first = execute({ input: preset(id), faults: [fault] });
    expect(first.session.isFinished).toBe(true);
    expect(first.state.outcome).toBeTruthy();
    expect(first.state.outcome).not.toMatch(/internal error/);
    expect(execute({ input: preset(id), faults: [fault] }).events).toEqual(first.events);
  });

  it("all faults together still end in a finished run", () => {
    const { session, state } = execute({ faults: [...RATING_FAULTS] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).not.toMatch(/internal error/);
  });
});

describe("what the demo must not contain", () => {
  const runs = [execute(), execute({ faults: ["scrape-fails-three-times"] }), execute({ input: preset("duplicate") }), execute({ input: preset("low-rated"), faults: ["code-reissued", "early-delivery"] })];
  const text = runs.map((run) => JSON.stringify(run.events)).join("\n");

  it("uses only example.test addresses and an invented product code", () => {
    const addresses = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(address).toMatch(/@example\.test$/);
    expect(DEMO_WORLD.product).toBe("B0EXAMPLE1");
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("never prints a number as a model estimate", () => {
    for (const run of runs) {
      const output = run.state.steps["rating.estimate"].output as Record<string, unknown> | undefined;
      if (output) expect(output.model_estimate).toBe("not reproduced on this page");
    }
    expect(text).not.toMatch(/model[_ ]estimate"?:\s*"?\d/i);
  });

  it("uses a fixed token and fixed codes that are plainly not real", () => {
    expect(DEMO_WORLD.linkToken).toBe("demo-token-not-a-secret");
    expect([DEMO_WORLD.firstCode, DEMO_WORLD.secondCode, DEMO_WORLD.wrongCode]).toEqual(["123456", "654321", "000000"]);
  });

  it("takes its limits from the write-up and keeps every invented timing in one object", () => {
    expect(PUBLISHED_LIMITS).toEqual({ codeDigits: 6, codeLifetimeMinutes: 15, freeRequests: 3, maxAttempts: 3, deliverAfterHours: 24 });
    expect(DEMO_SETTINGS.lateCodeMs).toBeGreaterThan(PUBLISHED_LIMITS.codeLifetimeMinutes * 60_000);
    expect(DEMO_SETTINGS.typingMs).toBeLessThan(PUBLISHED_LIMITS.codeLifetimeMinutes * 60_000);
  });

  it("removes nothing: no table of reviews is ever written to", () => {
    const tables = new Set(runs.flatMap((run) => run.events.filter((event): event is Change => event.type === "state.changed").map((event) => event.table)));
    expect([...tables].sort()).toEqual(["email_tokens", "requests", "users"]);
  });
});

describe("input validation", () => {
  it("accepts the defaults and every preset", () => {
    expect(validateRatingInput(RATING_DEFAULT_INPUT)).toEqual({ ok: true, value: RATING_DEFAULT_INPUT, errors: {} });
    for (const item of RATING_PRESETS) expect(validateRatingInput(item.input)).toMatchObject({ ok: true, errors: {} });
  });

  it("accepts every option the form offers", () => {
    for (const breakdown of BREAKDOWN_NAMES) expect(validateRatingInput({ ...RATING_DEFAULT_INPUT, breakdown }).ok).toBe(true);
    for (const alreadyQueued of QUEUE_STATES) expect(validateRatingInput({ ...RATING_DEFAULT_INPUT, alreadyQueued }).ok).toBe(true);
    for (const codeEntered of CODE_ENTRIES) expect(validateRatingInput({ ...RATING_DEFAULT_INPUT, codeEntered }).ok).toBe(true);
  });

  it("reads numbers typed as text and keeps the target to one decimal", () => {
    const result = validateRatingInput({ ...RATING_DEFAULT_INPUT, targetRating: "4.56", freeRequestsUsed: "2" });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ targetRating: 4.6, freeRequestsUsed: 2 });
    expect(validateRatingInput({ ...RATING_DEFAULT_INPUT, targetRating: 5 }).value.targetRating).toBe(5);
    expect(validateRatingInput({ ...RATING_DEFAULT_INPUT, targetRating: 1 }).ok).toBe(true);
  });

  it("reports each field that is out of range and falls back to the defaults", () => {
    const result = validateRatingInput({ breakdown: "perfect", targetRating: 5.1, freeRequestsUsed: 4, alreadyQueued: "maybe", codeEntered: "none" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["alreadyQueued", "breakdown", "codeEntered", "freeRequestsUsed", "targetRating"]);
    expect(result.value).toEqual(RATING_DEFAULT_INPUT);
  });

  it.each([
    [{ targetRating: 0.9 }, "targetRating"],
    [{ targetRating: "abc" }, "targetRating"],
    [{ targetRating: "" }, "targetRating"],
    [{ freeRequestsUsed: -1 }, "freeRequestsUsed"],
    [{ freeRequestsUsed: 1.5 }, "freeRequestsUsed"],
    [{ freeRequestsUsed: undefined }, "freeRequestsUsed"],
  ] as const)("rejects %j", (change, field) => {
    const result = validateRatingInput({ ...RATING_DEFAULT_INPUT, ...change });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors)).toEqual([field]);
  });
});
