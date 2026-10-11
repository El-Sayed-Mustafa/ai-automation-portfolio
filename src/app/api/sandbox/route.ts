import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { executeSandboxRun } from "@/sandbox/executor";
import { SANDBOX_LIMITS, SandboxError } from "@/sandbox/limits";
import { SANDBOX_SCENARIO_IDS, type SandboxErrorBody, type SandboxRunResponse, type SandboxStatus } from "@/sandbox/protocol";
import { parseRunRequest } from "@/sandbox/request";
import { getSandboxRuntime } from "@/sandbox/runtime";

/**
 * The live sandbox.
 *
 *   GET   whether the sandbox can run here, its limits, and the latest runs
 *   POST  runs one allowed scenario against a database created for the request
 *
 * A request never names code to run, a table, or a recipient. It names a
 * scenario from a fixed list and gives it input that the scenario's own
 * validator accepts. No message leaves the server, and the ledger keeps no
 * text a visitor typed.
 */
export const maxDuration = 10;

const NO_STORE = { "cache-control": "no-store" } as const;

function refuse(error: SandboxError, extra: Record<string, string> = {}, retryAfterMs?: number): Response {
  const body: SandboxErrorBody = { error: { code: error.code, message: error.message, details: error.details, retryAfterMs } };
  return Response.json(body, { status: error.status, headers: { ...NO_STORE, ...extra } });
}

/** The caller's address as the proxy in front of the app reports it. */
function addressOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** A browser sends Origin with a POST. If it is there, it has to be this site. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  // The answer depends on this server and on the ledger, so it is never prerendered.
  await connection();
  const runtime = getSandboxRuntime();
  if (!runtime.available) {
    const status: SandboxStatus = { available: false, reason: runtime.reason, scenarios: SANDBOX_SCENARIO_IDS, limits: SANDBOX_LIMITS, recent: [] };
    return Response.json(status, { headers: NO_STORE });
  }
  runtime.ledger.cleanup(Date.now(), SANDBOX_LIMITS.ledger.ttlMs, SANDBOX_LIMITS.ledger.maxRows);
  const status: SandboxStatus = {
    available: true,
    engine: runtime.engine,
    scenarios: SANDBOX_SCENARIO_IDS,
    storage: runtime.ledger.storage,
    limits: SANDBOX_LIMITS,
    recent: runtime.ledger.recent(SANDBOX_LIMITS.ledger.recent),
  };
  return Response.json(status, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const runtime = getSandboxRuntime();
    if (!runtime.available) throw new SandboxError(process.env.SANDBOX_DISABLED === "1" ? "DISABLED" : "UNAVAILABLE", 503, runtime.reason);

    if (!sameOrigin(request)) throw new SandboxError("BAD_REQUEST", 403, "Requests from another site are not accepted.");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw new SandboxError("BAD_REQUEST", 415, "Send the request as application/json.");
    }
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > SANDBOX_LIMITS.maxBodyBytes) throw new SandboxError("BAD_REQUEST", 413, `The request is larger than ${SANDBOX_LIMITS.maxBodyBytes} bytes.`);

    // Counted before the body is read, so a flood of bad requests is limited too.
    const now = Date.now();
    const rate = runtime.limiter.take(runtime.addressKey(addressOf(request)), now);
    if (!rate.ok) {
      const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
      return refuse(
        new SandboxError(
          "RATE_LIMITED",
          429,
          rate.scope === "everyone" ? "The sandbox is busy. Try again in a moment." : `Too many runs from this address. Try again in ${seconds} s.`,
        ),
        { "retry-after": String(seconds) },
        rate.retryAfterMs,
      );
    }

    const parsed = parseRunRequest(await request.text());
    const runId = parsed.runId ?? `sbx-${randomUUID()}`;
    const execution = executeSandboxRun(parsed, runId, { sqlite: runtime.sqlite });

    let recorded = false;
    try {
      runtime.ledger.record({
        runId,
        scenarioId: execution.scenarioId,
        preset: execution.preset,
        faults: execution.faults,
        status: execution.status,
        events: execution.events.length,
        statements: execution.statements,
        ms: execution.ms,
        recordedAt: now,
      });
      runtime.ledger.cleanup(now, SANDBOX_LIMITS.ledger.ttlMs, SANDBOX_LIMITS.ledger.maxRows);
      recorded = true;
    } catch {
      // The run happened and its result is still returned; only the record of it was lost.
    }

    const body: SandboxRunResponse = {
      runId,
      mode: "live-sandbox",
      events: execution.events,
      waiting: execution.waiting,
      finished: execution.finished,
      measured: { ms: execution.ms, statements: execution.statements, seededRows: execution.seededRows },
      database: { engine: runtime.engine, tables: execution.tables },
      ledger: { recorded, storage: runtime.ledger.storage },
      limits: SANDBOX_LIMITS,
    };
    return Response.json(body, { headers: { ...NO_STORE, "x-ratelimit-remaining": String(rate.remaining) } });
  } catch (error) {
    if (error instanceof SandboxError) return refuse(error);
    // Never the stack, never the message of an unexpected error: it could name a path on the server.
    return refuse(new SandboxError("INTERNAL", 500, "The sandbox failed to run this request."));
  }
}
