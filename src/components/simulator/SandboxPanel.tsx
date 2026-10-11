"use client";

import { CircleCheck, CircleDashed, Database, History } from "lucide-react";
import { useEffect, useState } from "react";
import type { Workflow } from "@/content/schema";
import type { ScenarioPreset } from "@/engine/registry";
import type { SandboxRunRecord, SandboxStatus } from "@/sandbox/protocol";
import { RUN_STATUS_LABEL, formatJson } from "./format";
import { fetchSandboxStatus } from "./sandbox-client";
import type { ServerRun } from "./useRun";

type SandboxContent = NonNullable<Workflow["sandbox"]>;

function milliseconds(ms: number): string {
  return ms < 1 ? "under 1 ms" : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

/** One line under the progress strip: what the server measured for the run on screen. */
export function ServerRunSummary({ server }: { server: ServerRun }) {
  const { measured, database, ledger } = server;
  return (
    <p data-testid="sandbox-summary" className="flex items-start gap-2 rounded-xl border border-success/40 bg-success-soft px-3 py-2 text-sm leading-relaxed">
      <Database size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <span>
        Ran on the server in <span className="code font-semibold">{milliseconds(measured.ms)}</span>:{" "}
        <span className="code font-semibold">{measured.statements}</span> SQL statements against {database.engine}, in a database created for this run from {measured.seededRows}{" "}
        seeded rows and deleted after it.{" "}
        {ledger.recorded
          ? ledger.storage === "file"
            ? "The run is recorded in the server's ledger."
            : "The run is recorded in the server's ledger, which this host keeps in memory only."
          : "The server could not record this run in its ledger."}
      </span>
    </p>
  );
}

function StatusWord({ status }: { status: SandboxRunRecord["status"] }) {
  const label = status === "waiting" ? "Waiting for a decision" : RUN_STATUS_LABEL[status];
  return (
    <span data-status={status === "waiting" ? "waiting" : status} className="font-semibold text-(--status)">
      {label}
    </span>
  );
}

/**
 * The Database tab of a server run: what was real and what was not, the rows
 * the server read back from the run's database, and the server's ledger of
 * recent runs. The ledger is shown to everyone, so it holds no input.
 */
export function DatabasePanel({ server, content, presets }: { server: ServerRun; content: SandboxContent; presets: ScenarioPreset[] }) {
  const [status, setStatus] = useState<SandboxStatus | null>(null);

  // Asked again after every answer from the server, so the run on screen is in the list.
  useEffect(() => {
    let current = true;
    void fetchSandboxStatus().then((answer) => {
      if (current) setStatus(answer);
    });
    return () => {
      current = false;
    };
  }, [server]);

  const presetLabel = (id: string) => presets.find((preset) => preset.id === id)?.label ?? "Custom input";

  return (
    <div className="space-y-5" data-testid="sandbox-database">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label mb-2">Real in this run</p>
          <ul className="space-y-1.5 text-sm leading-snug">
            {content.real.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CircleCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label mb-2">Still simulated</p>
          <ul className="space-y-1.5 text-sm leading-snug text-muted">
            {content.simulated.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CircleDashed size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <p className="label mb-2">The database after this run, read back by the server</p>
        <ul className="space-y-2">
          {server.database.tables.map((table) => (
            <li key={table.name}>
              <details className="rounded-xl border border-line bg-surface">
                <summary className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="code font-semibold">{table.name}</span>
                  <span className="text-xs text-muted">
                    {table.rows.length} row{table.rows.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <pre tabIndex={0} className="code max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-line bg-surface-2 p-3 text-xs leading-relaxed">
                  {table.rows.length > 0 ? formatJson(table.rows) : "No rows."}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="label mb-2 flex items-center gap-1.5">
          <History size={13} aria-hidden /> Recent runs on this server
        </p>
        {status?.available && status.recent.length > 0 ? (
          <>
            <ul className="divide-y divide-line rounded-xl border border-line text-sm" aria-label="Recent runs on this server">
              {status.recent.map((run) => (
                <li key={`${run.run}-${run.at}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="code text-xs text-subtle">{run.run}</span>
                  <span className="font-medium">{presetLabel(run.preset)}</span>
                  {run.faults.length > 0 ? (
                    <span className="text-xs text-warn">
                      {run.faults.length} failure{run.faults.length === 1 ? "" : "s"} injected
                    </span>
                  ) : null}
                  <StatusWord status={run.status} />
                  <span className="code ml-auto text-xs text-muted">
                    {run.statements} statements · {milliseconds(run.ms)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-relaxed text-subtle">
              The ledger keeps which scenario ran, how it ended and how long it took, for a day. It never keeps what was typed into the form: a run with edited input is listed as
              “Custom input”.
            </p>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong p-3 text-sm text-muted">{status ? "No runs are recorded yet." : "Asking the server for its ledger…"}</p>
        )}
      </div>
    </div>
  );
}
