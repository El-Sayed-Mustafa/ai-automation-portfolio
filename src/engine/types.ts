/**
 * Workflow execution model.
 *
 * A run is an append-only log of events. Everything the UI shows (step status,
 * timeline, payload inspector, logs) is derived from that log by `reduceRun`,
 * which is what makes replay, step-through and reset trivial: they only move a
 * cursor over the same log.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "retrying"
  | "skipped"
  | "waiting"
  | "cancelled";

export type RunStatus = "idle" | "running" | "waiting" | "success" | "failed" | "cancelled";

export type LogLevel = "info" | "warn" | "error";

export interface Choice {
  id: string;
  label: string;
  description?: string;
}

interface EventBase {
  /** Position in the log, starting at 0. */
  seq: number;
  /** Virtual milliseconds since the run started. Never wall-clock time. */
  at: number;
}

export type RunEvent = EventBase &
  (
    | { type: "run.started"; runId: string; scenarioId: string; input: Json; faults: string[] }
    | { type: "step.started"; stepId: string; attempt: number; input: Json }
    | { type: "step.log"; stepId: string; level: LogLevel; message: string; data?: Json }
    | {
        type: "state.changed";
        stepId: string;
        table: string;
        op: "insert" | "update" | "delete";
        key: string;
        before: Json;
        after: Json;
      }
    | { type: "step.succeeded"; stepId: string; attempt: number; output: Json; warning?: string }
    | {
        type: "step.failed";
        stepId: string;
        attempt: number;
        error: { code: string; message: string };
        /** Present when the step will be attempted again at this virtual time. */
        retryAt?: number;
      }
    | { type: "step.skipped"; stepId: string; reason: string }
    | { type: "step.waiting"; stepId: string; prompt: string; choices: Choice[] }
    | { type: "step.resumed"; stepId: string; choice: string }
    | {
        type: "run.finished";
        status: "success" | "failed" | "cancelled";
        outcome: string;
        summary: Json;
      }
  );

export type RunEventType = RunEvent["type"];

export interface LogEntry {
  seq: number;
  at: number;
  stepId: string;
  level: LogLevel;
  message: string;
  data?: Json;
}

export interface StateChange {
  seq: number;
  at: number;
  stepId: string;
  table: string;
  op: "insert" | "update" | "delete";
  key: string;
  before: Json;
  after: Json;
}

export interface AttemptRecord {
  attempt: number;
  startedAt: number;
  endedAt?: number;
  status: "running" | "success" | "failed";
  error?: { code: string; message: string };
  retryAt?: number;
}

export interface StepState {
  id: string;
  status: StepStatus;
  attempts: AttemptRecord[];
  input?: Json;
  output?: Json;
  warning?: string;
  error?: { code: string; message: string };
  retryAt?: number;
  skipReason?: string;
  waiting?: { prompt: string; choices: Choice[] };
  choice?: string;
  logs: LogEntry[];
  changes: StateChange[];
  startedAt?: number;
  endedAt?: number;
  /** Virtual time from first start to last end, including retry waits. */
  durationMs?: number;
}

export interface RunState {
  status: RunStatus;
  runId?: string;
  scenarioId?: string;
  input?: Json;
  faults: string[];
  steps: Record<string, StepState>;
  /** The step the cursor is currently on, if any. */
  currentStepId?: string;
  /** Virtual time of the last applied event. */
  clock: number;
  outcome?: string;
  summary?: Json;
  logs: LogEntry[];
  changes: StateChange[];
}
