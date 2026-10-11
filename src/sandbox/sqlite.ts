import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

export type SqliteModule = typeof import("node:sqlite");
export type { DatabaseSync, SQLInputValue, StatementSync };

/**
 * The SQLite that ships inside Node, or null where it is not offered: an
 * older Node, or one that still keeps the module behind a flag. It is looked up at run time instead of imported, so a host
 * without it still builds and serves the site: the sandbox reports itself
 * unavailable there and every demo runs as a simulation.
 */
export function loadSqlite(): SqliteModule | null {
  try {
    const lookup = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    const found = lookup?.call(process, "node:sqlite") as SqliteModule | undefined;
    return found && typeof found.DatabaseSync === "function" ? found : null;
  } catch {
    return null;
  }
}

/** The SQLite library version, for the answer a run returns. */
export function sqliteVersion(sqlite: SqliteModule): string {
  const db = new sqlite.DatabaseSync(":memory:");
  try {
    const row = db.prepare("SELECT sqlite_version() AS version").get() as { version?: unknown } | undefined;
    return typeof row?.version === "string" ? row.version : "unknown";
  } finally {
    db.close();
  }
}
