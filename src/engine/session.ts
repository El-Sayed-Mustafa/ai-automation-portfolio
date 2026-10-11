import { Tracer } from "./tracer";
import type { Json, RunEvent } from "./types";

export interface ScenarioContext<Input> {
  input: Input;
  faults: ReadonlySet<string>;
  t: Tracer;
}

/**
 * A scenario is a deterministic program. It records events through the tracer
 * and yields only when it needs a human decision; the value sent back in is the
 * id of the chosen option.
 */
export interface Scenario<Input = Record<string, Json>> {
  id: string;
  stepIds: readonly string[];
  run(ctx: ScenarioContext<Input>): Generator<void, void, string>;
}

export interface RunOptions<Input> {
  runId: string;
  input: Input;
  faults?: Iterable<string>;
  /**
   * Called before every event is recorded. Throw a `RunAborted` from it to
   * stop the run from outside, for example when a server-side budget is spent.
   */
  guard?: () => void;
}

/**
 * Thrown to stop a run from outside the scenario. Unlike any other error it is
 * not turned into a failed run: it reaches whoever started the session, which
 * is how a server tells "the scenario failed" from "I stopped it".
 */
export class RunAborted extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunAborted";
  }
}

/**
 * Drives one scenario run and owns its event log.
 *
 * The session executes eagerly: it runs the scenario until it either finishes
 * or stops at a human decision. Playback speed is a UI concern and never
 * changes what was executed.
 */
export class RunSession<Input = Record<string, Json>> {
  readonly events: RunEvent[] = [];
  private readonly tracer: Tracer;
  private readonly program: Generator<void, void, string>;
  private finished = false;

  constructor(
    readonly scenario: Scenario<Input>,
    options: RunOptions<Input>,
  ) {
    const faults = [...(options.faults ?? [])].sort();
    this.tracer = new Tracer(scenario.stepIds, options.guard);
    this.tracer.begin(options.runId, scenario.id, options.input as unknown as Json, faults);
    this.program = scenario.run({ input: options.input, faults: new Set(faults), t: this.tracer });
    this.pump(undefined);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** True when the run is stopped at a human decision. */
  get isWaiting(): boolean {
    return !this.finished && this.events.at(-1)?.type === "step.waiting";
  }

  resume(choiceId: string): void {
    if (!this.isWaiting) throw new Error("The run is not waiting for a decision.");
    const waiting = this.events.at(-1);
    if (waiting?.type === "step.waiting" && !waiting.choices.some((c) => c.id === choiceId)) {
      throw new Error(`"${choiceId}" is not one of the offered choices.`);
    }
    this.pump(choiceId);
  }

  cancel(reason = "Cancelled by the visitor."): void {
    if (this.finished) return;
    this.tracer.finish("cancelled", reason, null);
    this.events.push(...this.tracer.drain());
    this.finished = true;
    this.program.return();
  }

  private pump(choice: string | undefined): void {
    try {
      // The first `next` argument is ignored by generators, so passing the
      // choice unconditionally is safe.
      const result = this.program.next(choice as string);
      this.events.push(...this.tracer.drain());
      if (result.done) {
        this.finished = true;
        if (this.events.at(-1)?.type !== "run.finished") {
          throw new Error("Scenario returned without finishing the run.");
        }
      }
    } catch (error) {
      if (error instanceof RunAborted) {
        this.finished = true;
        throw error;
      }
      // A scenario bug must surface as a failed run, never as a broken page.
      this.events.push(...this.tracer.drain());
      const message = error instanceof Error ? error.message : String(error);
      if (this.tracer.currentStepId) this.tracer.fail("INTERNAL", message);
      this.tracer.finish("failed", "The simulation hit an internal error.", { error: message });
      this.events.push(...this.tracer.drain());
      this.finished = true;
    }
  }
}
