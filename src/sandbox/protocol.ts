import type { Json, RunEvent } from "../engine/types";
import { CRM_SCENARIO_ID } from "../engine/scenarios/crm/scenario";
import type { SANDBOX_LIMITS, SandboxErrorCode } from "./limits";

/**
 * What the page and the server say to each other about a sandbox run. Types
 * and the list of scenarios only: nothing here touches a database, so the
 * browser bundle can import it.
 */

/** Scenarios the server will execute. Anything else is refused before it is looked at. */
export const SANDBOX_SCENARIO_IDS: readonly string[] = [CRM_SCENARIO_ID];

export const SANDBOX_ENDPOINT = "/api/sandbox";

export interface SandboxRunRequest {
  scenarioId: string;
  input: Record<string, Json>;
  faults: string[];
  /**
   * Every decision made so far, in order. The server keeps nothing between
   * requests: it runs the scenario again from the start and applies these, and
   * because a scenario is deterministic it arrives at the same place.
   */
  decisions: string[];
  /** The id the server gave the first request of this run, sent back with each decision. */
  runId?: string;
}

/** One line of the public ledger. It holds no text a visitor typed. */
export interface SandboxRunRecord {
  /** The first eight characters of the run id: enough to recognise your own run. */
  run: string;
  scenarioId: string;
  /** The id of the preset whose input the run used, or "custom". */
  preset: string;
  faults: string[];
  status: "success" | "failed" | "cancelled" | "waiting";
  events: number;
  statements: number;
  /** Measured on the server, in milliseconds. */
  ms: number;
  /** When the server recorded it, as an ISO timestamp. */
  at: string;
}

export interface SandboxRunResponse {
  runId: string;
  mode: "live-sandbox";
  events: RunEvent[];
  waiting: boolean;
  finished: boolean;
  /** Wall-clock figures from the server. The times inside `events` stay on the scenario's virtual clock. */
  measured: { ms: number; statements: number; seededRows: number };
  database: { engine: string; tables: { name: string; rows: Json[] }[] };
  /** Whether the ledger kept a record of this run, and where the ledger lives. */
  ledger: { recorded: boolean; storage: "file" | "memory" };
  limits: typeof SANDBOX_LIMITS;
}

export interface SandboxStatus {
  available: boolean;
  /** Why not, when it is not. */
  reason?: string;
  engine?: string;
  scenarios: readonly string[];
  storage?: "file" | "memory";
  limits: typeof SANDBOX_LIMITS;
  recent: SandboxRunRecord[];
}

export interface SandboxErrorBody {
  error: { code: SandboxErrorCode; message: string; details?: Record<string, string>; retryAfterMs?: number };
}
