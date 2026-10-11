"use client";

import { FlaskConical, History, LoaderCircle, Pause, Play, RotateCcw, Server, SlidersHorizontal, Square, StepForward } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Project, Workflow } from "@/content/schema";
import { getScenarioRuntime, type ScenarioInput, type ScenarioPreset, type ScenarioRuntime } from "@/engine/registry";
import type { Choice, StepStatus } from "@/engine/types";
import { TechRow } from "@/components/ui/TechIcon";
import { SANDBOX_SCENARIO_IDS } from "@/sandbox/protocol";
import { INSPECTOR_TABS, Inspector, type InspectorTab } from "./Inspector";
import { Pipeline, ProgressStrip } from "./Pipeline";
import { DatabasePanel, ServerRunSummary } from "./SandboxPanel";
import { SetupPanel } from "./SetupPanel";
import { RUN_STATUS_LABEL, STEP_STATUS_LABEL, formatDuration } from "./format";
import { useRun, type RunTarget, type Speed } from "./useRun";

type Tab = "setup" | InspectorTab | "database";
/** Below the wide breakpoint only one of the two panes is shown at a time. */
type View = "steps" | "inspector";

interface WorkflowSimulatorProps {
  workflow: Workflow;
  /** Architecture node id to display name, so steps can say where they run. */
  nodeLabels: Record<string, string>;
  repository: Project["repository"];
  /** "compact" drops the setup form and payload tabs, for use on the home page. */
  variant?: "full" | "compact";
  caseStudyHref?: string;
}

const SPEEDS: { value: Speed; label: string }[] = [
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 4, label: "4x" },
  { value: 0, label: "Instant" },
];

const SETTLED: StepStatus[] = ["success", "failed", "skipped", "cancelled"];

export function WorkflowSimulator({ workflow, nodeLabels, repository, variant = "full", caseStudyHref }: WorkflowSimulatorProps) {
  const runtime = getScenarioRuntime(workflow.scenarioId);
  if (!runtime) {
    return (
      <p role="alert" className="rounded-xl border border-danger bg-danger-soft p-4 text-sm">
        This demo is unavailable: no executable scenario is registered for “{workflow.scenarioId}”.
      </p>
    );
  }
  return (
    <SimulatorBody
      workflow={workflow}
      nodeLabels={nodeLabels}
      repository={repository}
      compact={variant === "compact"}
      caseStudyHref={caseStudyHref}
      runtime={runtime}
    />
  );
}

/** The run cannot continue until the visitor answers, so the prompt brings itself into view. */
function DecisionPanel({ stepLabel, prompt, choices, onDecide }: { stepLabel: string; prompt: string; choices: Choice[]; onDecide(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  // A workflow can ask more than once, and a later question may be taller than the one before it.
  // The jump is instant: a smooth scroll is cancelled when the step list under it is still growing,
  // which could leave the question off screen. It is checked once more when the page has settled;
  // "nearest" does nothing if the panel is already in view.
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const bring = () => panel.scrollIntoView({ block: "nearest", behavior: "instant" });
    bring();
    const timer = window.setTimeout(bring, 250);
    return () => window.clearTimeout(timer);
  }, [prompt]);
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Decision needed"
      data-status="waiting"
      className="scroll-mb-4 scroll-mt-[calc(var(--header-h)+var(--subnav-h,0px)+1rem)] rounded-xl border border-(--status) bg-(--status-soft) p-4"
    >
      <p className="label text-(--status)">Your decision · {stepLabel}</p>
      <p className="mt-1 font-semibold">{prompt}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onDecide(choice.id)}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-(--status)"
          >
            <span className="font-semibold">{choice.label}</span>
            {choice.description ? <span className="mt-0.5 block text-xs text-muted">{choice.description}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function SimulatorBody({
  workflow,
  nodeLabels,
  repository,
  compact,
  caseStudyHref,
  runtime,
}: Pick<WorkflowSimulatorProps, "workflow" | "nodeLabels" | "repository" | "caseStudyHref"> & { compact: boolean; runtime: ScenarioRuntime }) {
  const uid = useId();
  // The server runs a workflow only when the content describes that and the server's own list names it.
  const sandbox = workflow.sandbox && SANDBOX_SCENARIO_IDS.includes(workflow.scenarioId) ? workflow.sandbox : undefined;
  const controller = useRun(runtime.scenario, sandbox ? workflow.scenarioId : undefined);
  const { state } = controller;
  const [target, setTarget] = useState<RunTarget>("browser");
  const onServer = controller.hasRun && controller.origin === "server";

  const [input, setInput] = useState<ScenarioInput>(runtime.defaultInput);
  const [faults, setFaults] = useState<string[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(runtime.presets[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>(compact ? "step" : "setup");
  const [view, setView] = useState<View>("steps");
  const [pinnedStepId, setPinnedStepId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const validation = useMemo(() => runtime.validate(input), [runtime, input]);

  // Follow the run unless the visitor has picked a step themselves.
  const followedStepId = useMemo(() => {
    if (state.currentStepId) return state.currentStepId;
    const touched = workflow.steps.filter((step) => state.steps[step.id].status !== "pending");
    const lastActive = touched.filter((step) => state.steps[step.id].status !== "skipped").at(-1);
    return (lastActive ?? touched.at(-1) ?? workflow.steps[0]).id;
  }, [state, workflow.steps]);
  const selectedStepId = pinnedStepId ?? followedStepId;
  const selectedIndex = Math.max(
    0,
    workflow.steps.findIndex((step) => step.id === selectedStepId),
  );
  const selectedStep = workflow.steps[selectedIndex];
  const selectedState = state.steps[selectedStep.id];

  const settledCount = workflow.steps.filter((step) => SETTLED.includes(state.steps[step.id].status)).length;
  const caughtUp = controller.cursor >= controller.events.length;
  const showOutcome = controller.executionFinished && caughtUp;
  const runStatus = controller.hasRun ? state.status : "idle";
  const waitingStep = controller.awaitingDecision ? workflow.steps.find((step) => state.steps[step.id].status === "waiting") : undefined;
  const waiting = waitingStep ? state.steps[waitingStep.id].waiting : undefined;

  function start(paused: boolean) {
    if (!validation.ok) {
      setTab("setup");
      setView("inspector");
      return;
    }
    setPinnedStepId(null);
    setDirty(false);
    if (tab === "setup" || tab === "database") setTab("step");
    controller.run(validation.value, faults, { paused, target });
  }

  function handleStep() {
    if (!controller.hasRun) start(true);
    else controller.step();
  }

  function handlePreset(preset: ScenarioPreset) {
    setInput(preset.input);
    setActivePresetId(preset.id);
    setDirty(controller.hasRun);
  }

  function handleInput(key: string, value: string | number) {
    setInput((previous) => ({ ...previous, [key]: value }));
    setActivePresetId(null);
    setDirty(controller.hasRun);
  }

  function handleToggleFault(faultId: string) {
    setFaults((previous) => {
      if (previous.includes(faultId)) return previous.filter((id) => id !== faultId);
      const group = workflow.faults.find((fault) => fault.id === faultId)?.group;
      const withoutGroup = group ? previous.filter((id) => workflow.faults.find((fault) => fault.id === id)?.group !== group) : previous;
      return [...withoutGroup, faultId];
    });
    setDirty(controller.hasRun);
  }

  function handleReset() {
    controller.reset();
    setPinnedStepId(null);
    setDirty(false);
    setView("steps");
    if (!compact) setTab("setup");
  }

  function handleTarget(next: RunTarget) {
    setTarget(next);
    setDirty(controller.hasRun && next !== controller.origin);
  }

  function handleSelect(stepId: string) {
    setPinnedStepId(stepId);
    setView("inspector");
    if (tab === "setup") setTab("step");
  }

  function openSetup() {
    setTab("setup");
    setView("inspector");
  }

  const tabs: { id: Tab; label: string }[] = compact
    ? []
    : [{ id: "setup", label: "Setup" }, ...INSPECTOR_TABS, ...(controller.server ? [{ id: "database" as const, label: "Database" }] : [])];
  // The Database tab exists only for a server run. When the run on screen is no longer one, fall back to the step.
  const shownTab: Tab = tab === "database" && !controller.server ? "step" : tab;
  const liveMessage = controller.hasRun
    ? showOutcome
      ? `Run ${RUN_STATUS_LABEL[state.status].toLowerCase()}. ${state.outcome ?? ""}`
      : `${selectedStep.label}: ${STEP_STATUS_LABEL[selectedState.status]}`
    : "";
  const panelId = `${uid}-panel`;
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div className="panel overflow-hidden shadow-md" data-testid="workflow-simulator">
      {/* What this is and what it proves */}
      <div className="border-b border-line p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-xl font-bold">{workflow.title}</h3>
          {/* The badge describes the run on screen, not what was asked for: a run that fell back says Simulation. */}
          {onServer ? (
            <span data-testid="run-mode" className="inline-flex items-center gap-1 rounded-full border border-success bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
              <Server size={12} aria-hidden />
              Live sandbox
            </span>
          ) : (
            <span data-testid="run-mode" className="inline-flex items-center gap-1 rounded-full border border-hold bg-hold-soft px-2.5 py-0.5 text-xs font-semibold text-hold">
              <FlaskConical size={12} aria-hidden />
              {workflow.mode === "simulation" ? "Simulation" : "Live sandbox"}
            </span>
          )}
        </div>
        <TechRow names={workflow.technologies} className="mt-3" />
        <p className="mt-3 max-w-3xl text-[0.9375rem] leading-relaxed">{workflow.proves}</p>
        {/* What is real and what is not is always on the page; its full wording opens in place. */}
        <p className="mt-2 flex max-w-3xl items-start gap-2 text-[0.8125rem] leading-relaxed text-subtle">
          <span data-testid="mode-note" className={"min-w-0 flex-1 " + (noteOpen ? "" : "line-clamp-1")}>
            {sandbox && (onServer || (target === "server" && !controller.hasRun)) ? sandbox.note : workflow.modeNote}
          </span>
          <button type="button" aria-expanded={noteOpen} onClick={() => setNoteOpen((value) => !value)} className="shrink-0 font-semibold text-accent hover:underline">
            {noteOpen ? "Less" : "More"}
          </button>
        </p>
      </div>

      {sandbox ? (
        <div className="flex flex-col gap-2 border-b border-line bg-surface-2 px-4 py-3 sm:px-6 md:flex-row md:items-center md:gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <span className="label">Runs</span>
            <div role="group" aria-label="Where it runs" className="segmented bg-surface-3">
              <button type="button" aria-pressed={target === "browser"} onClick={() => handleTarget("browser")}>
                In your browser
              </button>
              <button type="button" aria-pressed={target === "server"} onClick={() => handleTarget("server")}>
                On the server
              </button>
            </div>
          </div>
          <p className="max-w-3xl text-[0.8125rem] leading-relaxed text-muted">
            {target === "server" ? "Same program, a real database. If the server does not answer, the run is simulated here and says so." : "Same program, in this page."}
          </p>
        </div>
      ) : null}

      {/* Scenario, then run controls */}
      <div className="space-y-3 border-b border-line bg-surface-2 p-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mr-1">Scenario</span>
          {runtime.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="chip bg-surface"
              title={preset.description}
              aria-pressed={activePresetId === preset.id}
              onClick={() => handlePreset(preset)}
            >
              {preset.label}
            </button>
          ))}
          {!compact ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={openSetup}>
              <SlidersHorizontal size={14} aria-hidden />
              Edit input and failures
              {faults.length > 0 ? (
                <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">
                  {faults.length} failure{faults.length > 1 ? "s" : ""}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => start(false)} disabled={controller.pending}>
            {controller.pending ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />}
            {controller.pending ? "Asking the server…" : controller.hasRun ? "Run again" : "Run workflow"}
          </button>
          {controller.isPlaying ? (
            <button type="button" className="btn btn-secondary" onClick={controller.pause}>
              <Pause size={15} aria-hidden />
              Pause
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={controller.play} disabled={!controller.hasRun || caughtUp} title="Continue playback">
              <Play size={15} aria-hidden />
              Resume
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleStep}
            disabled={controller.pending || (controller.hasRun && caughtUp)}
            title="Advance to the end of the next step"
          >
            <StepForward size={15} aria-hidden />
            Step
          </button>
          <button type="button" className="btn btn-secondary" onClick={controller.replay} disabled={!controller.hasRun}>
            <History size={15} aria-hidden />
            Replay
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleReset} disabled={!controller.hasRun}>
            <RotateCcw size={15} aria-hidden />
            Reset
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={controller.cancel}
            disabled={!controller.hasRun || controller.executionFinished}
            title="Cancel a run that is waiting for a decision"
          >
            <Square size={14} aria-hidden />
            Cancel
          </button>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            Speed
            <select
              value={controller.speed}
              onChange={(event) => controller.setSpeed(Number(event.target.value) as Speed)}
              className="field w-auto py-1.5 text-sm"
            >
              {SPEEDS.map((speed) => (
                <option key={speed.value} value={speed.value}>
                  {speed.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {dirty ? (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn sm:px-6">
          The setup changed. Choose “Run again” to apply it; what you see below is still the previous run.
        </p>
      ) : null}

      {/* Asked for the server and got a simulation: the reason is said out loud, not left to the badge. */}
      {controller.notice ? (
        <p role="status" data-testid="sandbox-notice" className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn sm:px-6">
          {controller.notice}
        </p>
      ) : null}

      {/* Where the run is, the decision it needs, and how it ended */}
      <div className="space-y-3 border-b border-line p-4 sm:px-6">
        <div className="flex items-center justify-between gap-3 text-sm" data-status={runStatus}>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-(--status)" aria-hidden />
            <span className="font-semibold text-(--status)" data-testid="run-status">
              {RUN_STATUS_LABEL[runStatus]}
            </span>
          </span>
          <span className="code text-subtle">
            {settledCount}/{workflow.steps.length} steps settled
          </span>
        </div>
        <ProgressStrip workflow={workflow} state={state} selectedStepId={shownTab === "setup" ? null : selectedStep.id} onSelect={handleSelect} />
        {onServer && controller.server ? <ServerRunSummary server={controller.server} /> : null}
        {waitingStep && waiting ? (
          <DecisionPanel stepLabel={waitingStep.label} prompt={waiting.prompt} choices={waiting.choices} onDecide={controller.decide} />
        ) : null}
        {showOutcome ? (
          <div data-status={state.status} className="rounded-lg border border-(--status) bg-(--status-soft) p-4" data-testid="run-outcome">
            <p className="label text-(--status)">{RUN_STATUS_LABEL[state.status]}</p>
            <p className="mt-1 leading-relaxed">{state.outcome}</p>
          </div>
        ) : null}
        {!controller.hasRun ? (
          <p className="text-sm text-muted">
            {target === "server"
              ? "Press “Run workflow” to send this input to the server, which runs it against a database of its own. If the server does not answer, the run is simulated here and says so."
              : "Press “Run workflow” to execute it, or “Step” to move one step at a time. Nothing leaves your browser."}
          </p>
        ) : null}
      </div>

      {/* On narrow screens the two panes take turns instead of stacking. */}
      <div className="border-b border-line px-4 py-2 lg:hidden">
        <div role="group" aria-label="Show" className="segmented w-full">
          <button type="button" className="flex-1" aria-pressed={view === "steps"} onClick={() => setView("steps")}>
            Steps
          </button>
          <button type="button" className="flex-1" aria-pressed={view === "inspector"} onClick={() => setView("inspector")}>
            {compact ? "Step details" : "Inspector"}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className={"p-4 sm:p-6 lg:block lg:border-r lg:border-line " + (view === "steps" ? "block" : "hidden")}>
          <Pipeline
            workflow={workflow}
            state={state}
            nodeLabels={nodeLabels}
            selectedStepId={shownTab === "setup" ? null : selectedStep.id}
            onSelect={handleSelect}
          />
        </div>

        <div className={"min-w-0 p-4 sm:p-6 lg:block " + (view === "inspector" ? "block" : "hidden")}>
          {tabs.length > 0 ? (
            <div role="tablist" aria-label="Inspector" className="tablist mb-4">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${item.id}`}
                  aria-selected={shownTab === item.id}
                  aria-controls={panelId}
                  onClick={() => setTab(item.id)}
                  className="tab"
                >
                  {item.label}
                  {item.id === "setup" && faults.length > 0 ? (
                    <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">{faults.length}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <div
            id={panelId}
            data-testid="inspector-panel"
            role={tabs.length > 0 ? "tabpanel" : undefined}
            aria-labelledby={tabs.length > 0 ? `${uid}-tab-${shownTab}` : undefined}
            className="lg:max-h-[36rem] lg:overflow-y-auto lg:pr-1"
          >
            {shownTab === "database" && controller.server && sandbox ? (
              <DatabasePanel server={controller.server} content={sandbox} presets={runtime.presets} />
            ) : shownTab === "setup" ? (
              <SetupPanel
                workflow={workflow}
                input={input}
                errors={validation.errors}
                faults={faults}
                repository={repository}
                onInput={handleInput}
                onToggleFault={handleToggleFault}
              />
            ) : (
              <Inspector
                tab={shownTab === "database" ? "step" : shownTab}
                workflow={workflow}
                step={selectedStep}
                stepNumber={selectedIndex + 1}
                stepState={selectedState}
                state={state}
                nodeLabels={nodeLabels}
                repository={repository}
              />
            )}
          </div>

          {compact && caseStudyHref ? (
            <p className="mt-5 text-sm text-muted">
              <Link href={caseStudyHref} className="link">
                Open the full demo
              </Link>{" "}
              to edit the input, inject failures and inspect payloads, logs and data changes.
            </p>
          ) : null}
        </div>
      </div>

      {controller.hasRun ? (
        <div className="flex flex-col gap-2 border-t border-line bg-surface-2 px-4 py-3 text-xs text-muted sm:flex-row sm:items-center sm:gap-4 sm:px-6">
          <label className="flex flex-1 items-center gap-2">
            <span className="shrink-0 font-medium">Timeline</span>
            <input
              type="range"
              min={0}
              max={controller.events.length}
              value={controller.cursor}
              onChange={(event) => controller.seek(Number(event.target.value))}
              className="w-full accent-(--accent)"
              aria-valuetext={`Event ${controller.cursor} of ${controller.events.length}`}
            />
          </label>
          <span className="code">
            event {controller.cursor}/{controller.events.length}
          </span>
          <span className="code" title="Time on the simulated clock, not a measurement">
            simulated {formatDuration(state.clock)}
          </span>
          {controller.executionMs !== null ? (
            <span className="code" title={onServer ? "Real time the run took on the server, database included" : "Real time the scenario took to execute in your browser"}>
              {onServer ? "measured on the server" : "executed in"} {controller.executionMs < 1 ? "<1" : Math.round(controller.executionMs)} ms
            </span>
          ) : null}
          <span className="code text-subtle">{state.runId}</span>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
    </div>
  );
}
