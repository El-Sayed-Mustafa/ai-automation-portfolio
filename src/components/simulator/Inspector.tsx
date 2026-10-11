"use client";

import type { ReactNode } from "react";
import type { Project, Workflow, WorkflowStep } from "@/content/schema";
import type { RunState, StepState } from "@/engine/types";
import { SourceList } from "@/components/ui/Provenance";
import { KIND_ICON, StatusIcon } from "./Pipeline";
import { STEP_STATUS_LABEL, changedFields, formatDuration, formatJson, formatOffset } from "./format";

export type InspectorTab = "step" | "payload" | "logs" | "data";

export const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "step", label: "Step" },
  { id: "payload", label: "Payload" },
  { id: "logs", label: "Logs" },
  { id: "data", label: "Data changes" },
];

interface InspectorProps {
  tab: InspectorTab;
  workflow: Workflow;
  step: WorkflowStep;
  stepNumber: number;
  stepState: StepState;
  state: RunState;
  nodeLabels: Record<string, string>;
  repository: Project["repository"];
}

function JsonBlock({ label, value }: { label: string; value: string }) {
  return (
    <figure>
      <figcaption className="label mb-1.5">{label}</figcaption>
      <pre
        tabIndex={0}
        className="code max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-3 text-xs leading-relaxed"
      >
        {value}
      </pre>
    </figure>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">{children}</p>;
}

export function Inspector({ tab, workflow, step, stepNumber, stepState, state, nodeLabels, repository }: InspectorProps) {
  return (
    <div className="space-y-4">
      <StepHeader step={step} stepNumber={stepNumber} stepState={stepState} nodeLabels={nodeLabels} />
      {tab === "step" ? <StepTab step={step} stepState={stepState} repository={repository} /> : null}
      {tab === "payload" ? <PayloadTab stepState={stepState} /> : null}
      {tab === "logs" ? <LogsTab workflow={workflow} state={state} selectedStepId={step.id} /> : null}
      {tab === "data" ? <DataTab stepState={stepState} /> : null}
    </div>
  );
}

/** Always shown above the tab content, so it is clear which step the payload, logs and rows belong to. */
function StepHeader({
  step,
  stepNumber,
  stepState,
  nodeLabels,
}: Pick<InspectorProps, "step" | "stepNumber" | "stepState" | "nodeLabels">) {
  const status = stepState.status;
  const KindIcon = KIND_ICON[step.kind];
  return (
    <div data-status={status} className="rounded-lg border border-(--status) bg-(--status-soft) p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusIcon status={status} />
        <span className="code text-subtle">{String(stepNumber).padStart(2, "0")}</span>
        <h4 className="text-base font-bold">{step.label}</h4>
        <span className="ml-auto text-xs font-semibold text-(--status)">{STEP_STATUS_LABEL[status]}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <KindIcon size={12} aria-hidden />
          Runs on {nodeLabels[step.nodeId] ?? step.nodeId}
        </span>
        {stepState.durationMs !== undefined && status !== "running" ? (
          <span className="code" title="Time on the simulated clock">
            {formatDuration(stepState.durationMs)} simulated
          </span>
        ) : null}
      </p>
    </div>
  );
}

function StepTab({ step, stepState, repository }: Pick<InspectorProps, "step" | "stepState" | "repository">) {
  return (
    <div className="space-y-4">
      {stepState.error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-sm">
          <p className="code font-medium text-danger">{stepState.error.code}</p>
          <p className="mt-1">{stepState.error.message}</p>
        </div>
      ) : null}

      {stepState.warning ? (
        <div className="rounded-lg border border-warn bg-warn-soft p-3 text-sm">
          <p className="font-semibold text-warn">Completed with a warning</p>
          <p className="mt-1">{stepState.warning}</p>
        </div>
      ) : null}

      {stepState.skipReason ? (
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">Skipped: {stepState.skipReason}</p>
      ) : null}

      <div>
        <p className="label mb-1.5">What the production code does</p>
        <p className="text-sm leading-relaxed">{step.description}</p>
        <SourceList project={{ repository }} sources={step.sources} className="mt-2" />
      </div>

      {stepState.attempts.length > 0 ? (
        <div>
          <p className="label mb-1.5">{stepState.attempts.length > 1 ? "Attempts" : "Timing"}</p>
          <table className="w-full text-left text-xs">
            <thead className="text-subtle">
              <tr>
                <th scope="col" className="py-1 pr-2 font-normal">
                  #
                </th>
                <th scope="col" className="py-1 pr-2 font-normal">
                  Started
                </th>
                <th scope="col" className="py-1 pr-2 font-normal">
                  Took
                </th>
                <th scope="col" className="py-1 font-normal">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="code">
              {stepState.attempts.map((attempt) => (
                <tr key={attempt.attempt} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2">{attempt.attempt}</td>
                  <td className="py-1.5 pr-2">+{formatOffset(attempt.startedAt)}</td>
                  <td className="py-1.5 pr-2">
                    {attempt.endedAt !== undefined ? formatDuration(attempt.endedAt - attempt.startedAt) : "running"}
                  </td>
                  <td className="py-1.5 font-sans">
                    {attempt.status === "failed" ? (
                      <span className="text-danger">
                        {attempt.error?.code}
                        {attempt.retryAt !== undefined && attempt.endedAt !== undefined ? (
                          <span className="text-warn"> · retry in {formatDuration(attempt.retryAt - attempt.endedAt)}</span>
                        ) : null}
                      </span>
                    ) : attempt.status === "success" ? (
                      <span className="text-success">ok</span>
                    ) : (
                      <span className="text-accent">running</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-subtle">Times are on a simulated clock. They are not production measurements.</p>
        </div>
      ) : null}
    </div>
  );
}

function PayloadTab({ stepState }: { stepState: StepState }) {
  if (stepState.input === undefined) {
    return <Empty>This step has not run yet, so it has no payload.</Empty>;
  }
  return (
    <div className="space-y-4">
      <JsonBlock label="Input" value={formatJson(stepState.input)} />
      {stepState.output !== undefined ? (
        <JsonBlock label="Output" value={formatJson(stepState.output)} />
      ) : (
        <Empty>No output: the step {stepState.status === "failed" ? "failed" : "has not finished"}.</Empty>
      )}
      <p className="text-xs text-subtle">Keys and tokens are masked before they are recorded.</p>
    </div>
  );
}

function LogsTab({ workflow, state, selectedStepId }: { workflow: Workflow; state: RunState; selectedStepId: string }) {
  if (state.logs.length === 0) return <Empty>No log lines yet. Run the workflow to see them.</Empty>;
  const labels = new Map(workflow.steps.map((step) => [step.id, step.label]));
  return (
    <>
      <p className="text-xs text-subtle">The whole run so far. Lines from the selected step are highlighted.</p>
      <ol className="max-h-[26rem] space-y-0.5 overflow-auto rounded-lg border border-line bg-surface-2 p-2 text-xs" tabIndex={0}>
        {state.logs.map((entry) => (
          <li
            key={entry.seq}
            className={
              "grid grid-cols-[auto_1fr] gap-x-2 rounded px-1.5 py-1 " + (entry.stepId === selectedStepId ? "bg-surface shadow-sm" : "")
            }
          >
            <span className="code text-subtle">+{formatOffset(entry.at)}</span>
            <span>
              <span
                className={
                  "code mr-1.5 uppercase " + (entry.level === "error" ? "text-danger" : entry.level === "warn" ? "text-warn" : "text-accent")
                }
              >
                {entry.level}
              </span>
              <span className="text-subtle">[{labels.get(entry.stepId) ?? entry.stepId}]</span>{" "}
              <span className="text-[13px]">{entry.message}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

function DataTab({ stepState }: { stepState: StepState }) {
  if (stepState.changes.length === 0) {
    return <Empty>This step {stepState.input === undefined ? "has not run yet" : "did not write anything"}.</Empty>;
  }
  return (
    <ul className="space-y-3">
      {stepState.changes.map((change) => {
        const fields = change.op === "update" ? changedFields(change.before, change.after) : null;
        return (
          <li key={change.seq} className="rounded-lg border border-line p-3">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={
                  "code rounded px-1.5 py-0.5 uppercase " +
                  (change.op === "insert"
                    ? "bg-success-soft text-success"
                    : change.op === "delete"
                      ? "bg-danger-soft text-danger"
                      : "bg-accent-soft text-accent")
                }
              >
                {change.op}
              </span>
              <span className="code font-medium">{change.table}</span>
              <span className="code text-subtle">{change.key}</span>
            </p>
            {fields ? (
              <table className="mt-2 w-full text-left text-xs">
                <thead className="text-subtle">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-normal">
                      Field
                    </th>
                    <th scope="col" className="py-1 pr-2 font-normal">
                      Before
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody className="code">
                  {fields.map((field) => (
                    <tr key={field.field} className="border-t border-line align-top">
                      <td className="py-1.5 pr-2 text-muted">{field.field}</td>
                      <td className="break-all py-1.5 pr-2 text-danger">{JSON.stringify(field.before)}</td>
                      <td className="break-all py-1.5 text-success">{JSON.stringify(field.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre tabIndex={0} className="code mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 p-2 text-xs">
                {formatJson(change.op === "delete" ? change.before : change.after)}
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}
