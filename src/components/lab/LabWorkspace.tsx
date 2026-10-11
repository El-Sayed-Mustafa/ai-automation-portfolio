"use client";

import { ArrowRight, GitBranch, TriangleAlert, UserCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { WorkflowSimulator } from "@/components/simulator/WorkflowSimulator";
import { AppIcon, Tag, Tile } from "@/components/ui/Icon";
import type { IconName, Project, Tone, Workflow } from "@/content/schema";

export interface LabEntry {
  workflow: Workflow;
  projectId: string;
  projectTitle: string;
  icon: IconName;
  tone: Tone;
  nodeLabels: Record<string, string>;
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
                  className={"panel panel-link flex h-full w-full gap-3 p-3.5 text-left " + (selected ? "border-accent bg-accent-soft" : "")}
                >
                  <Tile tone={entry.tone} solid={selected}>
                    <AppIcon name={entry.icon} />
                  </Tile>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold uppercase tracking-wider text-subtle">{entry.projectTitle}</span>
                    <span className="mt-0.5 block font-display text-base font-bold leading-snug">{entry.workflow.title}</span>
                    <span className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{entry.workflow.summary}</span>
                    <span className="mt-2.5 flex flex-wrap gap-1.5">
                      <Tag tone="blue">
                        <GitBranch size={11} aria-hidden /> {entry.workflow.steps.length} steps
                      </Tag>
                      <Tag tone="rose">
                        <TriangleAlert size={11} aria-hidden /> {entry.workflow.faults.length} failures
                      </Tag>
                      <Tag tone="teal">
                        <UserCheck size={11} aria-hidden /> {humanSteps} decision{humanSteps === 1 ? "" : "s"}
                      </Tag>
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
        <WorkflowSimulator key={active.workflow.id} workflow={active.workflow} nodeLabels={active.nodeLabels} repository={active.repository} />
        <p className="mt-4 text-sm text-muted">
          This workflow belongs to{" "}
          <Link href={`/projects/${active.projectId}`} className="link inline-flex items-center gap-1">
            {active.projectTitle} <ArrowRight size={13} aria-hidden />
          </Link>
          , where its architecture and engineering decisions are explained.
        </p>
      </div>
    </div>
  );
}
