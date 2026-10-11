import { z } from "zod";
import { SANDBOX_LIMITS, SandboxError } from "./limits";
import type { SandboxRunRequest } from "./protocol";

const jsonScalar = z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()]);

/**
 * The shape of a run request. It is strict: an unknown key is an error, so a
 * client cannot smuggle in a field the server would one day start to read.
 * What the input means is checked afterwards by the scenario's own validator.
 */
const requestSchema = z
  .object({
    scenarioId: z.string().min(1).max(80),
    input: z.record(z.string().max(40), jsonScalar).refine((value) => Object.keys(value).length <= 24, "Too many input fields."),
    faults: z.array(z.string().regex(/^[a-z0-9-]{1,48}$/)).max(24),
    decisions: z.array(z.string().regex(/^[a-z0-9-]{1,48}$/)).max(SANDBOX_LIMITS.maxDecisions),
    runId: z
      .string()
      .regex(/^sbx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      .optional(),
  })
  .strict();

/** Parses the text of a request body, or throws the refusal to answer with. */
export function parseRunRequest(body: string): SandboxRunRequest {
  if (new TextEncoder().encode(body).length > SANDBOX_LIMITS.maxBodyBytes) {
    throw new SandboxError("BAD_REQUEST", 413, `The request is larger than ${SANDBOX_LIMITS.maxBodyBytes} bytes.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new SandboxError("BAD_REQUEST", 400, "The request body is not JSON.");
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "request";
    throw new SandboxError("BAD_REQUEST", 400, `The request is not in the expected shape (${where}: ${first?.message ?? "invalid"}).`);
  }
  return parsed.data;
}
