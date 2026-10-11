import { getScenarioRuntime, type ScenarioInput } from "../engine/registry";
import { CRM_SCENARIO_ID, createCrmScenario, type CrmInput } from "../engine/scenarios/crm/scenario";
import { RunAborted, RunSession, type Scenario } from "../engine/session";
import type { Json, RunEvent } from "../engine/types";
import { openCrmSandbox } from "./crm-database";
import { SANDBOX_LIMITS, SandboxError } from "./limits";
import { SANDBOX_SCENARIO_IDS, type SandboxRunRequest } from "./protocol";
import type { SqliteModule } from "./sqlite";

interface OpenedSandbox {
  scenario: Scenario<ScenarioInput>;
  dump(): { name: string; rows: Json[] }[];
  readonly statements: number;
  readonly seededRows: number;
  close(): void;
}

/**
 * How each allowed scenario is run on the server: the same program as in the
 * browser, given a store that talks to a database opened for this run.
 */
const OPENERS: Record<string, (sqlite: SqliteModule, onStatement: () => void) => OpenedSandbox> = {
  [CRM_SCENARIO_ID](sqlite, onStatement) {
    const sandbox = openCrmSandbox(sqlite, onStatement);
    const scenario = createCrmScenario(() => sandbox.store) as unknown as Scenario<ScenarioInput>;
    return {
      scenario,
      dump: () => sandbox.dump(),
      get statements() {
        return sandbox.statements;
      },
      get seededRows() {
        return sandbox.seededRows;
      },
      close: () => sandbox.close(),
    };
  },
};

export interface ExecutionBudget {
  maxMs: number;
  maxStatements: number;
  maxEvents: number;
}

export interface Execution {
  scenarioId: string;
  /** The preset whose input this run used, or "custom". Never the input itself. */
  preset: string;
  faults: string[];
  events: RunEvent[];
  waiting: boolean;
  finished: boolean;
  status: "success" | "failed" | "cancelled" | "waiting";
  ms: number;
  statements: number;
  seededRows: number;
  tables: { name: string; rows: Json[] }[];
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

/**
 * Validates a request and executes it against a database of its own.
 *
 * Nothing a visitor sends is trusted: the scenario must be on the allow-list,
 * the input goes through the scenario's own validator and the normalised value
 * is what runs, a fault must be one the scenario implements, and a decision
 * must be one the scenario is offering at that moment. The run is stopped when
 * it has spent its budget of time, statements or events.
 */
export function executeSandboxRun(
  request: SandboxRunRequest,
  runId: string,
  deps: { sqlite: SqliteModule; budget?: ExecutionBudget; now?: () => number },
): Execution {
  const open = SANDBOX_SCENARIO_IDS.includes(request.scenarioId) ? OPENERS[request.scenarioId] : undefined;
  const runtime = getScenarioRuntime(request.scenarioId);
  if (!open || !runtime) throw new SandboxError("UNKNOWN_SCENARIO", 404, "This workflow cannot be run on the server.");

  const validated = runtime.validate(request.input);
  if (!validated.ok) throw new SandboxError("INVALID_INPUT", 422, "The input was refused.", validated.errors);

  const faults = [...new Set(request.faults)].sort();
  const unknown = faults.find((fault) => !runtime.faultIds.includes(fault));
  if (unknown) throw new SandboxError("INVALID_FAULT", 422, `"${unknown}" is not a failure this workflow can inject.`);

  const budget = deps.budget ?? SANDBOX_LIMITS.budget;
  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  let eventCount = 0;
  let statementCount = 0;

  const spent = (what: string) => new RunAborted("BUDGET_EXCEEDED", `The run was stopped: it used more than its budget of ${what}.`);
  const checkTime = () => {
    if (now() - startedAt > budget.maxMs) throw spent(`${budget.maxMs} ms`);
  };

  const sandbox = open(deps.sqlite, () => {
    statementCount += 1;
    if (statementCount > budget.maxStatements) throw spent(`${budget.maxStatements} statements`);
    checkTime();
  });

  try {
    const session = new RunSession(sandbox.scenario, {
      runId,
      input: validated.value,
      faults,
      guard() {
        eventCount += 1;
        if (eventCount > budget.maxEvents) throw spent(`${budget.maxEvents} events`);
        checkTime();
      },
    });
    for (const decision of request.decisions) {
      const offered = session.events.at(-1);
      if (!session.isWaiting || offered?.type !== "step.waiting") {
        throw new SandboxError("INVALID_DECISION", 422, "A decision was sent, but the run is not waiting for one.");
      }
      if (!offered.choices.some((choice) => choice.id === decision)) {
        throw new SandboxError("INVALID_DECISION", 422, `"${decision}" is not one of the choices on offer.`);
      }
      session.resume(decision);
    }

    const tables = sandbox.dump();
    const last = session.events.at(-1);
    const preset = runtime.presets.find((candidate) => stable(candidate.input) === stable(validated.value))?.id ?? "custom";
    return {
      scenarioId: request.scenarioId,
      preset,
      faults,
      events: session.events,
      waiting: session.isWaiting,
      finished: session.isFinished,
      status: last?.type === "run.finished" ? last.status : "waiting",
      ms: Math.round((now() - startedAt) * 100) / 100,
      statements: sandbox.statements,
      seededRows: sandbox.seededRows,
      tables,
    };
  } catch (error) {
    if (error instanceof RunAborted) throw new SandboxError("BUDGET_EXCEEDED", 503, error.message);
    throw error;
  } finally {
    // The database exists only for this request. Closing it is the cleanup.
    sandbox.close();
  }
}

/** Typed helper for tests and the route: the CRM input a request carries, once validated. */
export type SandboxCrmInput = CrmInput;
