/**
 * Every limit of the live sandbox, in one place. The route returns these with
 * each answer, so what the page says about the sandbox is what the server
 * enforces.
 */
export const SANDBOX_LIMITS = {
  /** The request body, in bytes. A run needs a few hundred. */
  maxBodyBytes: 8_192,
  /** Decisions one run may carry. No scenario asks more than a handful. */
  maxDecisions: 8,
  /** Requests one address may make in a window, and all addresses together. */
  rate: { windowMs: 60_000, perAddress: 30, everyone: 300 },
  /** What one execution may spend before it is stopped. */
  budget: { maxMs: 1_500, maxStatements: 400, maxEvents: 2_000 },
  /** How long a run stays in the ledger, and how many the ledger keeps. */
  ledger: { ttlMs: 24 * 60 * 60 * 1000, maxRows: 500, recent: 8 },
  /** How long the page waits for the server before it runs the simulation instead. */
  clientTimeoutMs: 6_000,
} as const;

export type SandboxErrorCode =
  | "DISABLED"
  | "UNAVAILABLE"
  | "BAD_REQUEST"
  | "UNKNOWN_SCENARIO"
  | "INVALID_INPUT"
  | "INVALID_FAULT"
  | "INVALID_DECISION"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "INTERNAL";

/** A refusal with the status the route answers and a message a visitor can read. */
export class SandboxError extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}
