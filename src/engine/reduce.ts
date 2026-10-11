import type { RunEvent, RunState, StepState } from "./types";

function emptyStep(id: string): StepState {
  return { id, status: "pending", attempts: [], logs: [], changes: [] };
}

export function initialRunState(stepIds: readonly string[]): RunState {
  const steps: Record<string, StepState> = {};
  for (const id of stepIds) steps[id] = emptyStep(id);
  return { status: "idle", faults: [], steps, clock: 0, logs: [], changes: [] };
}

/**
 * Folds an event log into the state the UI renders.
 *
 * Pure and total: any prefix of a valid log is itself valid input, which is
 * how the timeline scrubs backwards and forwards without re-running anything.
 */
export function reduceRun(stepIds: readonly string[], events: readonly RunEvent[]): RunState {
  const state = initialRunState(stepIds);

  for (const event of events) {
    state.clock = event.at;

    if (event.type === "run.started") {
      state.status = "running";
      state.runId = event.runId;
      state.scenarioId = event.scenarioId;
      state.input = event.input;
      state.faults = event.faults;
      continue;
    }

    if (event.type === "run.finished") {
      state.status = event.status;
      state.outcome = event.outcome;
      state.summary = event.summary;
      state.currentStepId = undefined;
      if (event.status === "cancelled") {
        for (const step of Object.values(state.steps)) {
          if (step.status === "pending" || step.status === "waiting" || step.status === "running" || step.status === "retrying") {
            step.status = "cancelled";
            step.endedAt = event.at;
          }
        }
      }
      continue;
    }

    const step = (state.steps[event.stepId] ??= emptyStep(event.stepId));

    switch (event.type) {
      case "step.started": {
        step.status = "running";
        step.input = event.input;
        step.error = undefined;
        step.retryAt = undefined;
        step.startedAt ??= event.at;
        step.attempts.push({ attempt: event.attempt, startedAt: event.at, status: "running" });
        state.currentStepId = step.id;
        state.status = "running";
        break;
      }
      case "step.log": {
        const entry = { seq: event.seq, at: event.at, stepId: step.id, level: event.level, message: event.message, data: event.data };
        step.logs.push(entry);
        state.logs.push(entry);
        break;
      }
      case "state.changed": {
        const change = {
          seq: event.seq,
          at: event.at,
          stepId: step.id,
          table: event.table,
          op: event.op,
          key: event.key,
          before: event.before,
          after: event.after,
        };
        step.changes.push(change);
        state.changes.push(change);
        break;
      }
      case "step.succeeded": {
        step.status = "success";
        step.output = event.output;
        step.warning = event.warning;
        step.waiting = undefined;
        step.endedAt = event.at;
        step.durationMs = event.at - (step.startedAt ?? event.at);
        const attempt = step.attempts.at(-1);
        if (attempt) {
          attempt.status = "success";
          attempt.endedAt = event.at;
        }
        break;
      }
      case "step.failed": {
        const willRetry = event.retryAt !== undefined;
        step.status = willRetry ? "retrying" : "failed";
        step.error = event.error;
        step.retryAt = event.retryAt;
        step.waiting = undefined;
        step.endedAt = event.at;
        step.durationMs = event.at - (step.startedAt ?? event.at);
        const attempt = step.attempts.at(-1);
        if (attempt) {
          attempt.status = "failed";
          attempt.endedAt = event.at;
          attempt.error = event.error;
          attempt.retryAt = event.retryAt;
        }
        break;
      }
      case "step.skipped": {
        step.status = "skipped";
        step.skipReason = event.reason;
        break;
      }
      case "step.waiting": {
        step.status = "waiting";
        step.waiting = { prompt: event.prompt, choices: event.choices };
        state.status = "waiting";
        break;
      }
      case "step.resumed": {
        step.status = "running";
        step.choice = event.choice;
        step.waiting = undefined;
        state.status = "running";
        break;
      }
    }
  }

  return state;
}

const BOUNDARY_TYPES = new Set<RunEvent["type"]>([
  "step.succeeded",
  "step.failed",
  "step.skipped",
  "step.waiting",
  "run.finished",
]);

/**
 * Returns the cursor position just after the next step boundary, so "Step"
 * always lands on a settled state rather than mid-step.
 */
export function nextBoundary(events: readonly RunEvent[], cursor: number): number {
  for (let i = cursor; i < events.length; i++) {
    if (BOUNDARY_TYPES.has(events[i].type)) return i + 1;
  }
  return events.length;
}
