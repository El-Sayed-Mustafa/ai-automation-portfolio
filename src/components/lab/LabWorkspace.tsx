"use client";

import { ArrowRight, GitBranch, TriangleAlert, UserCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import type { RunMapSystem } from "@/components/simulator/run-map-system";
import { WorkflowSimulator } from "@/components/simulator/WorkflowSimulator";
import { AppIcon, Tile } from "@/components/ui/Icon";
import { TechRow } from "@/components/ui/TechIcon";
import type { IconName, Project, Tone, Workflow } from "@/content/schema";

export interface LabEntry {
  workflow: Workflow;
  projectId: string;
  projectTitle: string;
  icon: IconName;
  tone: Tone;
  nodeLabels: Record<string, string>;
  system: RunMapSystem;
  repository: Project["repository"];
}

const PARAM = "workflow";

// The selected workflow lives in the address, so a link opens the same demo.
function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener("lab:select", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("lab:select", onChange);
  };
}

function readSelection(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

function select(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, id);
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event("lab:select"));
}

export function LabWorkspace({ entries }: { entries: LabEntry[] }) {
  const requested = useSyncExternalStore(subscribe, readSelection, () => null);
  const active = entries.find((entry) => entry.workflow.id === requested) ?? entries[0];

  // The page is prerendered with the first workflow. By the time this runs the
  // one the address names is on screen, so the workspace can be shown.
  useEffect(() => {
    document.documentElement.removeAttribute("data-lab");
  }, []);

  return (
    <div data-lab-workspace className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
      <aside aria-label="Workflow library" className="min-w-0 xl:sticky xl:top-[calc(var(--header-h)+1.5rem)]">
        <h2 className="mb-3 font-display text-lg font-bold">
          Workflows <span className="font-semibold text-subtle">({entries.length})</span>
        </h2>
        {/* One row that scrolls sideways until there is room for a column beside the demo. */}
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 xl:mx-0 xl:grid xl:grid-cols-1 xl:overflow-visible xl:p-0">
          {entries.map((entry) => {
            const selected = entry.workflow.id === active.workflow.id;
            const humanSteps = entry.workflow.steps.filter((step) => step.kind === "human").length;
            return (
              <li key={entry.workflow.id} className="w-[17rem] shrink-0 snap-start xl:w-auto">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => select(entry.workflow.id)}
                  // Positioned, so the words kept for screen readers stay inside the row that scrolls sideways.
                  className={"panel panel-link relative flex h-full w-full gap-3 p-3.5 text-left " + (selected ? "border-accent bg-accent-soft" : "")}
                >
                  <Tile tone={entry.tone} solid={selected}>
                    <AppIcon name={entry.icon} />
                  </Tile>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-display text-[0.9375rem] font-bold leading-snug">{entry.workflow.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{entry.projectTitle}</span>
                    <span className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
                      <TechRow names={entry.workflow.technologies} compact />
                      {/* Steps, failures that can be injected, decisions a person makes. */}
                      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-xs font-bold">
                        <span data-tone="blue" className="inline-flex items-center gap-1 text-tone" title="Steps">
                          <GitBranch size={12} aria-hidden /> {entry.workflow.steps.length}
                          <span className="sr-only"> steps</span>
                        </span>
                        <span data-tone="rose" className="inline-flex items-center gap-1 text-tone" title="Failures you can inject">
                          <TriangleAlert size={12} aria-hidden /> {entry.workflow.faults.length}
                          <span className="sr-only"> failures</span>
                        </span>
                        <span data-tone="teal" className="inline-flex items-center gap-1 text-tone" title="Decisions a person makes">
                          <UserCheck size={12} aria-hidden /> {humanSteps}
                          <span className="sr-only"> decision{humanSteps === 1 ? "" : "s"}</span>
                        </span>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0">
        {/* Remounting on change gives every workflow a clean run, input and selection. */}
        <WorkflowSimulator key={active.workflow.id} workflow={active.workflow} system={active.system} nodeLabels={active.nodeLabels} repository={active.repository} />
        <p className="mt-4 text-sm text-muted">
          From{" "}
          <Link href={`/projects/${active.projectId}`} className="link inline-flex items-center gap-1">
            {active.projectTitle} <ArrowRight size={13} aria-hidden />
          </Link>
        </p>
      </div>
    </div>
  );
}
