"use client";

import { Check, UserCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { layerTone } from "@/components/architecture/NodeDetails";
import { NodeTile } from "@/components/ui/TechIcon";
import type { Workflow } from "@/content/schema";
import type { RunMapSystem } from "./run-map-system";
import type { RunState } from "@/engine/types";

type NodeState = "idle" | "done" | "active" | "waiting" | "failed" | "unused";

/**
 * The run as a picture: the system's layers and components, with a signal
 * that travels to whichever component the current step runs on.
 *
 * It shows the same run as the list of steps beside it, nothing more. Each
 * step names the component it runs on; the signal moves from the last step's
 * component to this one's. It follows the order of the steps. It is not a
 * drawing of the connections between components: those are in the
 * Architecture tab.
 */
export function RunMap({ architecture, workflow, state, activeStepId }: { architecture: RunMapSystem; workflow: Workflow; state: RunState; activeStepId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const signal = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | null>(null);

  const started = state.status !== "idle";
  const activeStep = workflow.steps.find((step) => step.id === activeStepId) ?? workflow.steps[0];
  const activeNode = started ? activeStep.nodeId : null;
  const used = new Set(workflow.steps.map((step) => step.nodeId));

  const stateOf = (nodeId: string): NodeState => {
    if (!used.has(nodeId)) return "unused";
    if (!started) return "idle";
    const mine = workflow.steps.filter((step) => step.nodeId === nodeId).map((step) => state.steps[step.id]?.status ?? "pending");
    if (nodeId === activeNode) {
      const now = state.steps[activeStep.id]?.status;
      if (now === "failed") return "failed";
      if (now === "waiting") return "waiting";
      return "active";
    }
    if (mine.includes("failed")) return "failed";
    if (mine.some((status) => status === "success")) return "done";
    return "idle";
  };

  // The signal flies from the component of the last step to this one's. It is measured on the page, so it
  // works the same whether the layers sit side by side or one under another.
  useEffect(() => {
    const from = previous.current;
    previous.current = activeNode;
    const container = root.current;
    const dot = signal.current;
    if (!container || !dot || !activeNode || !from || from === activeNode) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = container.querySelector<HTMLElement>(`[data-run-node="${CSS.escape(from)}"]`);
    const b = container.querySelector<HTMLElement>(`[data-run-node="${CSS.escape(activeNode)}"]`);
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
        { transform: `translate(${start.x}px, ${start.y}px) scale(1)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1, offset: 0.88 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1.8)`, opacity: 0 },
      ],
      { duration: 650, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [activeNode]);

  const layers = architecture.layers.filter((layer) => architecture.nodes.some((node) => node.layer === layer.id));
  const activeLabel = architecture.nodes.find((node) => node.id === activeNode)?.label;

  return (
    <div
      ref={root}
      data-run-map
      role="img"
      aria-label={activeLabel ? `The run is at ${activeLabel}: ${activeStep.label}.` : `The components this workflow runs on, in ${layers.length} layers.`}
      className="relative mt-3 rounded-xl border border-line bg-surface-2 p-2"
    >
      <div aria-hidden className="flex flex-col gap-2 md:flex-row md:items-stretch">
        {layers.map((layer) => (
          <div key={layer.id} data-tone={layerTone(architecture, layer.id)} className="min-w-0 flex-1 rounded-xl border border-tone-vivid/25 bg-tone-soft p-1.5">
            <p className="truncate px-1 pb-1 text-center text-[0.6875rem] font-bold text-tone">{layer.label}</p>
            <ul className="flex flex-wrap gap-1.5 md:flex-col">
              {architecture.nodes
                .filter((node) => node.layer === layer.id)
                .map((node) => {
                  const status = stateOf(node.id);
                  const lit = status === "active" || status === "waiting" || status === "failed";
                  return (
                    <li
                      key={node.id}
                      data-run-node={node.id}
                      data-state={status}
                      className={
                        "relative flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border bg-surface px-1.5 py-1 transition-all duration-300 " +
                        (status === "active"
                          ? "border-accent shadow-md ring-2 ring-accent"
                          : status === "waiting"
                            ? "border-hold shadow-md ring-2 ring-hold"
                            : status === "failed"
                              ? "border-danger shadow-md ring-2 ring-danger"
                              : status === "done"
                                ? "border-line-strong"
                                : "border-line")
                      }
                    >
                      {status === "active" ? <span className="absolute inset-0 animate-ping rounded-lg ring-2 ring-accent/60" /> : null}
                      <span className={lit || status === "done" ? "" : status === "unused" ? "opacity-35 saturate-0" : "opacity-60"}>
                        <NodeTile node={node} size={22} />
                      </span>
                      <span className={"min-w-0 truncate text-[0.71875rem] leading-tight " + (lit ? "font-bold text-fg" : status === "done" ? "font-semibold text-fg" : "text-muted")}>{node.label}</span>
                      {status === "done" ? <Check size={12} strokeWidth={3} className="shrink-0 text-success" /> : null}
                      {status === "failed" ? <X size={12} strokeWidth={3} className="shrink-0 text-danger" /> : null}
                      {status === "waiting" ? <UserCheck size={12} strokeWidth={2.5} className="shrink-0 text-hold" /> : null}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      {/* The signal. It sits at the corner of the map and is moved to where it is needed. */}
      <span ref={signal} aria-hidden className="pointer-events-none absolute left-0 top-0 -ml-2 -mt-2 h-4 w-4 rounded-full bg-accent opacity-0 shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_30%,transparent),0_0_18px_4px_var(--accent)]" />
    </div>
  );
}
