"use client";

import {
  Ban,
  Bell,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Cog,
  Database,
  Filter,
  Hourglass,
  Inbox,
  LoaderCircle,
  RefreshCw,
  Send,
  Shuffle,
  TriangleAlert,
  UserCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import type { StepKind, Workflow } from "@/content/schema";
import type { RunState, StepStatus } from "@/engine/types";
import { STEP_STATUS_LABEL, formatDuration } from "./format";

export const KIND_ICON: Record<StepKind, LucideIcon> = {
  trigger: Webhook,
  transform: Shuffle,
  validation: Filter,
  database: Database,
  human: UserCheck,
  api: Send,
  queue: Inbox,
  worker: Cog,
  notification: Bell,
};

const STATUS_ICON: Record<StepStatus, LucideIcon> = {
  pending: CircleDashed,
  running: LoaderCircle,
  success: CircleCheck,
  failed: CircleX,
  retrying: RefreshCw,
  skipped: CircleMinus,
  waiting: Hourglass,
  cancelled: Ban,
};

export function StatusIcon({ status, size = 18 }: { status: StepStatus; size?: number }) {
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      size={size}
      aria-hidden
      className={"shrink-0 text-(--status) " + (status === "running" || status === "retrying" ? "animate-spin" : "")}
      style={status === "retrying" ? { animationDuration: "2.4s" } : undefined}
    />
  );
}

/**
 * One segment per step, so the whole run is visible at a glance and any step
 * is one tap away, however long the list below is.
 */
export function ProgressStrip({
  workflow,
  state,
  selectedStepId,
  onSelect,
}: {
  workflow: Workflow;
  state: RunState;
  selectedStepId: string | null;
  onSelect(stepId: string): void;
}) {
  return (
    <ol className="flex gap-1" aria-label="Run progress">
      {workflow.steps.map((step, index) => {
        const status = state.steps[step.id].status;
        const selected = selectedStepId === step.id;
        return (
          <li key={step.id} className="min-w-0 flex-1">
            <button
              type="button"
              data-status={status}
              onClick={() => onSelect(step.id)}
              aria-label={`Step ${index + 1}, ${step.label}: ${STEP_STATUS_LABEL[status]}`}
              aria-pressed={selected}
              title={`${index + 1}. ${step.label}`}
              className="group flex h-6 w-full items-center"
            >
              <span
                className={
                  "block w-full rounded-full transition-all group-hover:h-2.5 " +
                  (selected ? "h-2.5 " : "h-1.5 ") +
                  (status === "pending" ? "bg-line-strong" : "bg-(--status)") +
                  (status === "skipped" || status === "cancelled" ? " opacity-40" : "") +
                  (selected ? " ring-2 ring-(--status) ring-offset-2 ring-offset-surface" : "")
                }
              />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

interface PipelineProps {
  workflow: Workflow;
  state: RunState;
  nodeLabels: Record<string, string>;
  selectedStepId: string | null;
  onSelect(stepId: string): void;
}

export function Pipeline({ workflow, state, nodeLabels, selectedStepId, onSelect }: PipelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stepNumber = new Map(workflow.steps.map((step, position) => [step.id, position + 1]));
  const currentStepId = state.currentStepId;

  // Keep the running step in view inside the list, without moving the page.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !currentStepId) return;
    if (container.scrollHeight <= container.clientHeight) return;
    const row = container.querySelector<HTMLElement>(`[data-step="${CSS.escape(currentStepId)}"]`);
    if (!row) return;
    const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    const bottom = top + row.offsetHeight;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({ top: Math.max(0, top - 56), behavior: "smooth" });
    }
  }, [currentStepId]);

  return (
    <div ref={containerRef} className="lg:max-h-[40rem] lg:overflow-y-auto lg:pr-1">
      <ol className="space-y-5" aria-label="Workflow steps">
        {workflow.phases.map((phase) => {
          const steps = workflow.steps.filter((step) => step.phase === phase.id);
          if (steps.length === 0) return null;
          return (
            <li key={phase.id}>
              <p className="label mb-2">{phase.label}</p>
              <ol className="relative space-y-1 before:absolute before:bottom-5 before:left-[1.2rem] before:top-5 before:w-px before:bg-line-strong">
                {steps.map((step) => {
                  const stepState = state.steps[step.id];
                  const status = stepState.status;
                  const selected = selectedStepId === step.id;
                  const KindIcon = KIND_ICON[step.kind];
                  const attempts = stepState.attempts.length;
                  const quiet = status === "skipped" || status === "cancelled" || status === "pending";
                  return (
                    <li key={step.id} data-status={status} data-step={step.id} className="relative">
                      <button
                        type="button"
                        onClick={() => onSelect(step.id)}
                        aria-pressed={selected}
                        aria-current={currentStepId === step.id ? "step" : undefined}
                        className={
                          "flex w-full items-start gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors " +
                          (selected ? "border-(--status) bg-(--status-soft)" : "border-transparent hover:bg-surface-2")
                        }
                      >
                        <span
                          className={
                            "relative z-10 mt-0.5 grid h-5 w-5 place-items-center rounded-full " +
                            (selected ? "bg-(--status-soft)" : "bg-surface") +
                            (status === "running" ? " status-pulse" : "")
                          }
                        >
                          <StatusIcon status={status} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="code text-subtle">{String(stepNumber.get(step.id) ?? 0).padStart(2, "0")}</span>
                            <span className={"font-semibold " + (quiet ? "text-muted" : "")}>{step.label}</span>
                            {stepState.warning ? (
                              <TriangleAlert size={14} className="text-warn" aria-label="Completed with a warning" />
                            ) : null}
                            {attempts > 1 ? (
                              <span className="code rounded bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">{attempts} attempts</span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-sm leading-snug text-muted">{step.summary}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                            <span className="inline-flex items-center gap-1">
                              <KindIcon size={12} aria-hidden />
                              {nodeLabels[step.nodeId] ?? step.nodeId}
                            </span>
                            <span className="font-medium text-(--status)">{STEP_STATUS_LABEL[status]}</span>
                            {stepState.durationMs !== undefined && status !== "running" ? (
                              <span className="code">{formatDuration(stepState.durationMs)}</span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
