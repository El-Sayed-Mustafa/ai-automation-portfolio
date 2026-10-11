import type { Choice, Json, LogLevel, RunEvent } from "./types";

type EventBody = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, "seq" | "at"> : never) : never;

/**
 * Records what a scenario does as it runs, on a virtual clock.
 *
 * Scenarios never touch wall-clock time or randomness, so the same input and
 * faults always produce the same log. That determinism is what the tests and
 * the replay control rely on.
 */
export class Tracer {
  private buffer: RunEvent[] = [];
  private seq = 0;
  private now = 0;
  private current: string | null = null;
  private readonly attempts = new Map<string, number>();
  private readonly touched = new Set<string>();

  /**
   * @param guard Called before every event is recorded. A server executor
   *   passes one that throws when the run has used up its budget.
   */
  constructor(
    readonly stepIds: readonly string[],
    private readonly guard?: () => void,
  ) {}

  /** Current virtual time in milliseconds since the run started. */
  get time(): number {
    return this.now;
  }

  get currentStepId(): string | null {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`Cannot advance the clock by ${ms}ms.`);
    this.now += ms;
  }

  begin(runId: string, scenarioId: string, input: Json, faults: string[]): void {
    this.emit({ type: "run.started", runId, scenarioId, input, faults });
  }

  start(stepId: string, input: Json): void {
    this.assertKnown(stepId);
    if (this.current && this.current !== stepId) {
      throw new Error(`Step "${stepId}" started while "${this.current}" is still open.`);
    }
    const attempt = (this.attempts.get(stepId) ?? 0) + 1;
    this.attempts.set(stepId, attempt);
    this.touched.add(stepId);
    this.current = stepId;
    this.emit({ type: "step.started", stepId, attempt, input });
  }

  log(level: LogLevel, message: string, data?: Json): void {
    const stepId = this.requireCurrent("log");
    this.emit(data === undefined ? { type: "step.log", stepId, level, message } : { type: "step.log", stepId, level, message, data });
  }

  change(table: string, op: "insert" | "update" | "delete", key: string, before: Json, after: Json): void {
    const stepId = this.requireCurrent("change");
    this.emit({ type: "state.changed", stepId, table, op, key, before, after });
  }

  ok(output: Json, warning?: string): void {
    const stepId = this.requireCurrent("ok");
    const attempt = this.attempts.get(stepId) ?? 1;
    this.emit(
      warning
        ? { type: "step.succeeded", stepId, attempt, output, warning }
        : { type: "step.succeeded", stepId, attempt, output },
    );
    this.current = null;
  }

  /** Fails the open step. Pass `retryInMs` when it will be attempted again. */
  fail(code: string, message: string, retryInMs?: number): void {
    const stepId = this.requireCurrent("fail");
    const attempt = this.attempts.get(stepId) ?? 1;
    const error = { code, message };
    this.emit(
      retryInMs === undefined
        ? { type: "step.failed", stepId, attempt, error }
        : { type: "step.failed", stepId, attempt, error, retryAt: this.now + retryInMs },
    );
    // Closing the step either way: a retry is simply the next `start` of the
    // same step id, which records the next attempt number.
    this.current = null;
  }

  skip(stepId: string, reason: string): void {
    this.assertKnown(stepId);
    this.touched.add(stepId);
    this.emit({ type: "step.skipped", stepId, reason });
  }

  /** Marks every step that has not run yet as skipped, in workflow order. */
  skipRemaining(reason: string): void {
    for (const stepId of this.stepIds) {
      if (!this.touched.has(stepId)) this.skip(stepId, reason);
    }
  }

  wait(prompt: string, choices: Choice[]): void {
    const stepId = this.requireCurrent("wait");
    this.emit({ type: "step.waiting", stepId, prompt, choices });
  }

  resumed(choice: string): void {
    const stepId = this.requireCurrent("resumed");
    this.emit({ type: "step.resumed", stepId, choice });
  }

  finish(status: "success" | "failed" | "cancelled", outcome: string, summary: Json): void {
    this.current = null;
    this.emit({ type: "run.finished", status, outcome, summary });
  }

  /** Hands over the events recorded since the last drain. */
  drain(): RunEvent[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  private emit(body: EventBody): void {
    this.guard?.();
    this.buffer.push({ ...body, seq: this.seq++, at: this.now } as RunEvent);
  }

  private requireCurrent(action: string): string {
    if (!this.current) throw new Error(`Tracer.${action}() called with no open step.`);
    return this.current;
  }

  private assertKnown(stepId: string): void {
    if (!this.stepIds.includes(stepId)) throw new Error(`Unknown step "${stepId}".`);
  }
}
