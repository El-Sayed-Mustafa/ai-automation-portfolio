import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger, type Ledger } from "./ledger";
import { SANDBOX_LIMITS } from "./limits";
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { loadSqlite, sqliteVersion, type SqliteModule } from "./sqlite";

export type SandboxRuntime =
  | { available: false; reason: string }
  | {
      available: true;
      sqlite: SqliteModule;
      engine: string;
      ledger: Ledger;
      limiter: RateLimiter;
      /** A key for an address that cannot be turned back into the address. */
      addressKey(address: string): string;
    };

const SLOT = Symbol.for("portfolio.sandbox.runtime");
type Holder = { [SLOT]?: SandboxRuntime };

/**
 * Where the ledger file goes: the directory named by SANDBOX_DATA_DIR, else
 * `.data` beside the app, else the system's temporary directory. On a host
 * with no writable disk the ledger is kept in memory and says so.
 */
function openLedgerSomewhere(sqlite: SqliteModule): Ledger {
  const candidates = [process.env.SANDBOX_DATA_DIR, path.join(process.cwd(), ".data"), path.join(tmpdir(), "portfolio-sandbox")].filter(
    (dir): dir is string => Boolean(dir),
  );
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return openLedger(sqlite, path.join(dir, "sandbox-ledger.sqlite"));
    } catch {
      // Not writable: try the next place.
    }
  }
  return openLedger(sqlite, ":memory:");
}

function create(): SandboxRuntime {
  if (process.env.SANDBOX_DISABLED === "1") return { available: false, reason: "The sandbox is switched off on this deployment." };
  const sqlite = loadSqlite();
  if (!sqlite) return { available: false, reason: "This server's Node.js does not offer its built-in SQLite. Node 24 does." };
  try {
    // A new salt for every process: the same address gives a different key after a restart,
    // and no key is ever written to disk.
    const salt = randomBytes(32);
    return {
      available: true,
      sqlite,
      engine: `SQLite ${sqliteVersion(sqlite)}`,
      ledger: openLedgerSomewhere(sqlite),
      limiter: createRateLimiter(SANDBOX_LIMITS.rate),
      addressKey: (address) => createHmac("sha256", salt).update(address).digest("hex").slice(0, 32),
    };
  } catch (error) {
    return { available: false, reason: `The sandbox could not start: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One runtime per server process, kept across hot reloads in development. */
export function getSandboxRuntime(): SandboxRuntime {
  const holder = globalThis as Holder;
  holder[SLOT] ??= create();
  return holder[SLOT];
}
