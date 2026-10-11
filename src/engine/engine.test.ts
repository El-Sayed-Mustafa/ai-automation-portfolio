import { describe, expect, it } from "vitest";
import { nextBoundary, reduceRun } from "./reduce";
import { RunSession, type Scenario } from "./session";
import { Tracer } from "./tracer";

const STEPS = ["a", "b", "c"] as const;

const linear: Scenario<{ failB?: boolean }> = {
  id: "test.linear",
  stepIds: STEPS,
  *run({ input, t }) {
    t.start("a", { n: 1 });
    t.advance(10);
    t.log("info", "working");
    t.ok({ done: true });

    t.start("b", null);
    t.advance(5);
    if (input.failB) {
      t.fail("BOOM", "b failed");
      t.skipRemaining("b failed");
      t.finish("failed", "stopped at b", null);
      return;
    }
    t.ok(null);

    t.start("c", null);
    t.ok(null, "done with a caveat");
    t.finish("success", "all good", { steps: 3 });
  },
};

const gated: Scenario = {
  id: "test.gated",
  stepIds: ["ask", "act"],
  *run({ t }) {
    t.start("ask", null);
    t.wait("Proceed?", [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ]);
    const choice = yield;
    t.resumed(choice);
    t.ok({ choice });
    if (choice === "no") {
      t.skipRemaining("declined");
      t.finish("success", "declined", null);
      return;
    }
    t.start("act", null);
    t.ok(null);
    t.finish("success", "acted", null);
  },
};

const retrying: Scenario = {
  id: "test.retry",
  stepIds: ["flaky"],
  *run({ t }) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      t.start("flaky", { attempt });
      t.advance(100);
      if (attempt < 3) {
        t.fail("TRANSIENT", "try again", 1000);
        t.advance(1000);
        continue;
      }
      t.ok({ attempt });
    }
    t.finish("success", "recovered", null);
  },
};

describe("Tracer", () => {
  it("numbers events and stamps them with virtual time", () => {
    const t = new Tracer(["a"]);
    t.begin("run-1", "s", null, []);
    t.advance(25);
    t.start("a", null);
    t.ok(null);
    const events = t.drain();
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(events.map((e) => e.at)).toEqual([0, 25, 25]);
    expect(t.drain()).toEqual([]);
  });

  it("rejects unknown steps and step-less records", () => {
    const t = new Tracer(["a"]);
    expect(() => t.start("nope", null)).toThrow(/Unknown step/);
    expect(() => t.log("info", "orphan")).toThrow(/no open step/);
    expect(() => t.ok(null)).toThrow(/no open step/);
  });

  it("refuses to open a second step while one is running", () => {
    const t = new Tracer(["a", "b"]);
    t.start("a", null);
    expect(() => t.start("b", null)).toThrow(/still open/);
  });

  it("refuses to move the clock backwards", () => {
    const t = new Tracer(["a"]);
    expect(() => t.advance(-1)).toThrow();
    expect(() => t.advance(Number.NaN)).toThrow();
  });
});

describe("RunSession", () => {
  it("runs a scenario to completion", () => {
    const session = new RunSession(linear, { runId: "r1", input: {} });
    expect(session.isFinished).toBe(true);
    expect(session.isWaiting).toBe(false);
    expect(session.events.at(0)?.type).toBe("run.started");
    expect(session.events.at(-1)).toMatchObject({ type: "run.finished", status: "success" });
  });

  it("is deterministic for the same input", () => {
    const first = new RunSession(linear, { runId: "r1", input: {} });
    const second = new RunSession(linear, { runId: "r1", input: {} });
    expect(second.events).toEqual(first.events);
  });

  it("sorts fault ids so their order never changes the log", () => {
    const a = new RunSession(linear, { runId: "r", input: {}, faults: ["y", "x"] });
    const b = new RunSession(linear, { runId: "r", input: {}, faults: ["x", "y"] });
    expect(a.events).toEqual(b.events);
  });

  it("stops at a human decision and continues after resume", () => {
    const session = new RunSession(gated, { runId: "r", input: {} });
    expect(session.isWaiting).toBe(true);
    expect(session.isFinished).toBe(false);
    session.resume("yes");
    expect(session.isFinished).toBe(true);
    expect(reduceRun(gated.stepIds, session.events).steps.act.status).toBe("success");
  });

  it("rejects a choice that was not offered", () => {
    const session = new RunSession(gated, { runId: "r", input: {} });
    expect(() => session.resume("maybe")).toThrow(/not one of the offered/);
    expect(session.isWaiting).toBe(true);
  });

  it("refuses to resume a run that is not waiting", () => {
    const session = new RunSession(linear, { runId: "r", input: {} });
    expect(() => session.resume("yes")).toThrow(/not waiting/);
  });

  it("cancels a waiting run and marks unfinished steps cancelled", () => {
    const session = new RunSession(gated, { runId: "r", input: {} });
    session.cancel();
    session.cancel();
    const state = reduceRun(gated.stepIds, session.events);
    expect(state.status).toBe("cancelled");
    expect(state.steps.ask.status).toBe("cancelled");
    expect(state.steps.act.status).toBe("cancelled");
    expect(session.events.filter((e) => e.type === "run.finished")).toHaveLength(1);
  });

  it("turns a scenario bug into a failed run instead of throwing", () => {
    const broken: Scenario = {
      id: "test.broken",
      stepIds: ["a"],
      *run({ t }) {
        t.start("a", null);
        throw new Error("kaboom");
      },
    };
    const session = new RunSession(broken, { runId: "r", input: {} });
    const state = reduceRun(broken.stepIds, session.events);
    expect(state.status).toBe("failed");
    expect(state.steps.a.error).toEqual({ code: "INTERNAL", message: "kaboom" });
  });

  it("fails a scenario that returns without finishing", () => {
    const silent: Scenario = { id: "test.silent", stepIds: ["a"], *run() {} };
    const session = new RunSession(silent, { runId: "r", input: {} });
    expect(reduceRun(silent.stepIds, session.events).status).toBe("failed");
  });
});

describe("reduceRun", () => {
  it("starts with every step pending", () => {
    const state = reduceRun(STEPS, []);
    expect(state.status).toBe("idle");
    expect(Object.values(state.steps).map((s) => s.status)).toEqual(["pending", "pending", "pending"]);
  });

  it("derives step status, payloads, logs and durations", () => {
    const { events } = new RunSession(linear, { runId: "r", input: {} });
    const state = reduceRun(STEPS, events);
    expect(state.status).toBe("success");
    expect(state.outcome).toBe("all good");
    expect(state.steps.a).toMatchObject({ status: "success", input: { n: 1 }, output: { done: true }, durationMs: 10 });
    expect(state.steps.a.logs.map((l) => l.message)).toEqual(["working"]);
    expect(state.steps.c.warning).toBe("done with a caveat");
    expect(state.clock).toBe(15);
  });

  it("accepts any prefix of the log, which is what scrubbing relies on", () => {
    const { events } = new RunSession(linear, { runId: "r", input: {} });
    for (let cursor = 0; cursor <= events.length; cursor++) {
      expect(() => reduceRun(STEPS, events.slice(0, cursor))).not.toThrow();
    }
    const mid = reduceRun(STEPS, events.slice(0, 2));
    expect(mid.status).toBe("running");
    expect(mid.currentStepId).toBe("a");
    expect(mid.steps.a.status).toBe("running");
    expect(mid.steps.b.status).toBe("pending");
  });

  it("marks later steps skipped when a step fails for good", () => {
    const { events } = new RunSession(linear, { runId: "r", input: { failB: true } });
    const state = reduceRun(STEPS, events);
    expect(state.status).toBe("failed");
    expect(state.steps.b).toMatchObject({ status: "failed", error: { code: "BOOM", message: "b failed" } });
    expect(state.steps.c).toMatchObject({ status: "skipped", skipReason: "b failed" });
  });

  it("shows retrying between attempts and keeps every attempt", () => {
    const { events } = new RunSession(retrying, { runId: "r", input: {} });
    const firstFailure = events.findIndex((e) => e.type === "step.failed");
    const between = reduceRun(retrying.stepIds, events.slice(0, firstFailure + 1));
    expect(between.steps.flaky.status).toBe("retrying");
    expect(between.steps.flaky.retryAt).toBe(1100);

    const done = reduceRun(retrying.stepIds, events);
    expect(done.steps.flaky.status).toBe("success");
    expect(done.steps.flaky.attempts.map((a) => a.status)).toEqual(["failed", "failed", "success"]);
    expect(done.steps.flaky.error).toBeUndefined();
    expect(done.steps.flaky.durationMs).toBe(2300);
  });

  it("reports waiting until the decision arrives", () => {
    const session = new RunSession(gated, { runId: "r", input: {} });
    const waiting = reduceRun(gated.stepIds, session.events);
    expect(waiting.status).toBe("waiting");
    expect(waiting.steps.ask.waiting?.choices.map((c) => c.id)).toEqual(["yes", "no"]);
    session.resume("no");
    const done = reduceRun(gated.stepIds, session.events);
    expect(done.steps.ask).toMatchObject({ status: "success", choice: "no" });
    expect(done.steps.act.status).toBe("skipped");
  });
});

describe("nextBoundary", () => {
  it("lands just after each settled step", () => {
    const { events } = new RunSession(linear, { runId: "r", input: {} });
    const stops: number[] = [];
    let cursor = 0;
    while (cursor < events.length) {
      cursor = nextBoundary(events, cursor);
      stops.push(cursor);
    }
    expect(stops.at(-1)).toBe(events.length);
    for (const stop of stops) {
      expect(["step.succeeded", "step.failed", "step.skipped", "step.waiting", "run.finished"]).toContain(events[stop - 1].type);
    }
  });

  it("stays at the end of the log", () => {
    const { events } = new RunSession(linear, { runId: "r", input: {} });
    expect(nextBoundary(events, events.length)).toBe(events.length);
  });
});
