"use client";

import { ArrowRight, Check, Play, RotateCw, UserCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { TONE_CYCLE } from "@/components/ui/Icon";
import { NodeTile } from "@/components/ui/TechIcon";
import type { Workflow } from "@/content/schema";
import type { RunState } from "@/engine/types";
import { KIND_ICON } from "./Pipeline";
import type { RunMapSystem } from "./run-map-system";

type PhaseState = "pending" | "active" | "waiting" | "done" | "failed";
type StepMark = "pending" | "now" | "waiting" | "retrying" | "done" | "failed" | "skipped";

/**
 * The run as a story anyone can follow: a few stages in a row, a signal that
 * only ever moves forward from one to the next, and under them the steps of
 * the stage in progress as a small flow of icons.
 *
 * It shows the same run as the list of steps, at the level of the workflow's
 * own stages. Every label and sentence is the step's own, from the case
 * study. The steps' data and logs are one press away, under it.
 */
export function RunStory({ workflow, system, state, activeStepId }: { workflow: Workflow; system?: RunMapSystem; state: RunState; activeStepId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const signal = useRef<HTMLSpanElement>(null);
  const previous = useRef(-1);

  const started = state.status !== "idle";
  const finished = state.status === "success" || state.status === "failed" || state.status === "cancelled";
  const activeStep = workflow.steps.find((step) => step.id === activeStepId) ?? workflow.steps[0];
  const statusOf = (stepId: string) => state.steps[stepId]?.status ?? "pending";
  const activePhase = started ? workflow.phases.findIndex((phase) => phase.id === activeStep.phase) : -1;
  const shownPhase = workflow.phases[Math.max(0, activePhase)];
  const shownSteps = workflow.steps.filter((step) => step.phase === shownPhase.id);

  const phaseState = (phaseId: string, index: number): PhaseState => {
    if (!started) return "pending";
    const statuses = workflow.steps.filter((step) => step.phase === phaseId).map((step) => statusOf(step.id));
    if (index === activePhase && !finished) return statusOf(activeStep.id) === "waiting" ? "waiting" : "active";
    if (statuses.includes("failed")) return "failed";
    if (statuses.some((status) => status === "success")) return "done";
    return "pending";
  };

  const markOf = (stepId: string): StepMark => {
    const status = statusOf(stepId);
    if (status === "success") return "done";
    if (status === "failed") return "failed";
    if (status === "skipped" || status === "cancelled") return "skipped";
    if (status === "waiting") return "waiting";
    if (status === "retrying") return "retrying";
    return started && stepId === activeStep.id && !finished ? "now" : "pending";
  };

  // The signal glides from the stage that just ended to the one that begins. Forward only: rewinding a run,
  // or starting again, moves nothing.
  useEffect(() => {
    const from = previous.current;
    previous.current = activePhase;
    const container = root.current;
    const dot = signal.current;
    if (!container || !dot || from < 0 || activePhase <= from) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = container.querySelector<HTMLElement>(`[data-phase-mark="${from}"]`);
    const b = container.querySelector<HTMLElement>(`[data-phase-mark="${activePhase}"]`);
    if (!a || !b) return;
    const frame = container.getBoundingClientRect();
    const centre = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2 - frame.left, y: box.top + box.height / 2 - frame.top };
    };
    const [start, end] = [centre(a), centre(b)];
    const animation = dot.animate(
      [
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.6)`, opacity: 0 },
        { transform: `translate(${start.x}px, ${start.y}px) scale(1)`, opacity: 1, offset: 0.15 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1.5)`, opacity: 0 },
      ],
      { duration: 1300, easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [activePhase]);

  const nodeOf = (nodeId: string) => system?.nodes.find((item) => item.id === nodeId);

  return (
    <div ref={root} data-run-story className="relative">
      <ol aria-label="Stages of this workflow" className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
        {workflow.phases.map((phase, index) => {
          const status = phaseState(phase.id, index);
          const steps = workflow.steps.filter((step) => step.phase === phase.id);
          const settled = steps.filter((step) => ["success", "failed", "skipped"].includes(statusOf(step.id))).length;
          const lit = status === "active" || status === "waiting";
          const PhaseIcon = KIND_ICON[steps[0]?.kind ?? "transform"];
          return (
            <li key={phase.id} data-tone={TONE_CYCLE[index % TONE_CYCLE.length]} data-phase-state={status} className="flex min-w-0 flex-1 items-center sm:flex-row">
              <div
                className={
                  "flex min-w-0 flex-1 items-center gap-3 rounded-2xl border p-2.5 transition-all duration-700 ease-out sm:flex-col sm:gap-1.5 sm:px-2 sm:py-3 sm:text-center " +
                  (lit ? "border-tone-vivid bg-tone-soft shadow-md" : status === "failed" ? "border-danger bg-danger-soft" : "border-line bg-surface")
                }
              >
                <span
                  data-phase-mark={index}
                  className={
                    "relative grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-all duration-700 ease-out " +
                    (status === "pending" ? "bg-surface-3 text-muted" : status === "failed" ? "bg-danger text-white" : "tile-solid text-white") +
                    (lit ? " scale-110" : "")
                  }
                >
                  {lit ? <span aria-hidden className="absolute -inset-1 animate-pulse rounded-2xl bg-tone-vivid opacity-25" /> : null}
                  <span className="relative">
                    {status === "done" ? <Check size={18} strokeWidth={3} aria-hidden /> : status === "failed" ? <X size={18} strokeWidth={3} aria-hidden /> : <PhaseIcon size={18} aria-hidden />}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className={"block text-[0.8125rem] font-bold leading-tight transition-colors duration-700 " + (status === "pending" ? "text-muted" : "text-fg")}>{phase.label}</span>
                  <span className="mt-1 flex items-center gap-1 sm:justify-center" aria-label={`${settled} of ${steps.length} steps done`} role="img">
                    {steps.map((step, place) => (
                      <span key={step.id} className={"h-1 w-3 rounded-full transition-colors duration-500 " + (place < settled ? "bg-tone-vivid" : "bg-line-strong")} />
                    ))}
                  </span>
                </span>
              </div>
              {index < workflow.phases.length - 1 ? <ArrowRight aria-hidden size={16} className={"mx-1 hidden shrink-0 transition-colors duration-700 sm:block " + (index < activePhase ? "text-accent" : "text-line-strong")} /> : null}
            </li>
          );
        })}
      </ol>

      {/* The stage in progress, step by step: who does it, and in a few words what. */}
      <div data-testid="story-now" data-tone={TONE_CYCLE[Math.max(0, activePhase) % TONE_CYCLE.length]} className="mt-3 rounded-2xl border border-line bg-surface-2 p-3">
        {started ? (
          <>
            <ol aria-label={`Steps of ${shownPhase.label}`} className="flex flex-wrap items-center gap-x-1 gap-y-2">
              {shownSteps.map((step, place) => {
                const mark = markOf(step.id);
                const node = nodeOf(step.nodeId);
                const KindIcon = KIND_ICON[step.kind];
                const lit = mark === "now" || mark === "waiting" || mark === "retrying";
                return (
                  <li key={step.id} data-step-mark={mark} className="flex min-w-0 items-center gap-1">
                    <span
                      className={
                        "flex min-w-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 transition-all duration-500 ease-out " +
                        (lit ? "border-tone-vivid bg-surface shadow-sm" : mark === "failed" ? "border-danger bg-danger-soft" : "border-transparent")
                      }
                    >
                      {/* A step not reached yet is quieter in its icon only: its words keep their contrast. */}
                      {node ? (
                        <span className={"flex transition-opacity duration-500 " + (mark === "pending" || mark === "skipped" ? "opacity-45 saturate-50" : "")}>
                          <NodeTile node={node} size={22} />
                        </span>
                      ) : (
                        <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-surface-3 text-muted">
                          <KindIcon size={13} aria-hidden />
                        </span>
                      )}
                      <span className={"truncate text-xs " + (lit ? "font-bold text-fg" : "font-medium text-muted")}>{step.label}</span>
                      {mark === "done" ? <Check size={12} strokeWidth={3} aria-hidden className="shrink-0 text-success" /> : null}
                      {mark === "failed" ? <X size={12} strokeWidth={3} aria-hidden className="shrink-0 text-danger" /> : null}
                      {mark === "waiting" ? <UserCheck size={12} aria-hidden className="shrink-0 text-hold" /> : null}
                      {mark === "retrying" ? <RotateCw size={12} aria-hidden className="shrink-0 animate-spin text-warn" /> : null}
                      {mark === "now" ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-tone-vivid" /> : null}
                    </span>
                    {place < shownSteps.length - 1 ? <ArrowRight aria-hidden size={12} className="shrink-0 text-line-strong" /> : null}
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 px-1 text-sm leading-snug text-muted">{activeStep.summary}</p>
          </>
        ) : (
          <p className="flex items-center gap-2 px-1 text-sm text-muted">
            <Play size={14} aria-hidden className="text-accent" />
            Press “Run workflow” and follow it through {workflow.phases.length} stages. Invented data, nothing real is called.
          </p>
        )}
      </div>

      <span ref={signal} aria-hidden className="pointer-events-none absolute left-0 top-0 -ml-2 -mt-2 h-4 w-4 rounded-full bg-accent opacity-0 shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_30%,transparent),0_0_18px_5px_var(--accent)]" />
    </div>
  );
}
