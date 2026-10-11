import { SANDBOX_LIMITS } from "@/sandbox/limits";
import { SANDBOX_ENDPOINT, type SandboxErrorBody, type SandboxRunRequest, type SandboxRunResponse, type SandboxStatus } from "@/sandbox/protocol";

export type SandboxCall = { ok: true; body: SandboxRunResponse } | { ok: false; code: string; message: string };

function isRunResponse(value: unknown): value is SandboxRunResponse {
  const body = value as Partial<SandboxRunResponse> | null;
  return Boolean(body && body.mode === "live-sandbox" && Array.isArray(body.events) && typeof body.runId === "string" && body.measured && body.database);
}

/**
 * Asks the server to run a scenario. It never throws: whatever goes wrong
 * comes back as a reason the page can show before it runs the simulation
 * instead. A host that serves only static files answers with a 404 page,
 * which is reported as "no server sandbox here".
 */
export async function callSandbox(request: SandboxRunRequest, timeoutMs: number = SANDBOX_LIMITS.clientTimeoutMs): Promise<SandboxCall> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(SANDBOX_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: abort.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: an error page from a host with no route handler.
    }
    if (response.ok && isRunResponse(body)) return { ok: true, body };
    const error = (body as Partial<SandboxErrorBody> | null)?.error;
    if (error && typeof error.message === "string") return { ok: false, code: String(error.code), message: error.message };
    return { ok: false, code: "NO_SANDBOX", message: "This deployment has no server sandbox." };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return timedOut
      ? { ok: false, code: "TIMEOUT", message: `The server did not answer within ${Math.round(timeoutMs / 1000)} s.` }
      : { ok: false, code: "NETWORK", message: "The server could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the sandbox can run here, and its latest runs. Null when the question could not be asked. */
export async function fetchSandboxStatus(): Promise<SandboxStatus | null> {
  try {
    const response = await fetch(SANDBOX_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<SandboxStatus>;
    return typeof body.available === "boolean" && Array.isArray(body.recent) ? (body as SandboxStatus) : null;
  } catch {
    return null;
  }
}
