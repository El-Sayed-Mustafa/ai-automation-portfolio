import { Expand, Minimize, Scan, Waypoints } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Box } from "@/content/architecture-columns";
import type { Architecture, ArchitectureEdge } from "@/content/schema";

/**
 * The parts of the architecture explorer that do not need the diagram library.
 *
 * They are shared by the explorer and by the placeholder shown while the
 * library loads, so the placeholder has exactly the explorer's size and
 * nothing below it moves when the diagram arrives.
 */

export type DiagramView = "system" | "data";

/** Below this zoom the labels on a component stop being comfortable to read. */
export const READABLE_ZOOM = 0.8;
/** The zoom used when the whole graph would be too small to read. */
export const FOCUS_ZOOM = 0.9;
/** Room between the diagram and the edge of its canvas, in pixels. */
export const CANVAS_PAD = 16;

/**
 * The canvas takes the shape of the diagram, so there is no empty band above
 * or below it. Where the diagram would be too small to read at that size (a
 * phone, or a system with many layers) the canvas is as tall as the diagram at
 * the focus zoom instead, and shows part of it.
 */
export function canvasStyle(bounds: Box): CSSProperties {
  return {
    aspectRatio: `${Math.round(bounds.width + CANVAS_PAD * 2)} / ${Math.round(bounds.height + CANVAS_PAD * 2)}`,
    minHeight: Math.round(bounds.height * FOCUS_ZOOM + CANVAS_PAD * 2),
    maxHeight: "46rem",
  };
}

export const EDGE_DASH: Record<ArchitectureEdge["kind"], string | undefined> = {
  sync: undefined,
  async: "7 5",
  fallback: "2 5",
  disabled: "7 5",
};

export const EDGE_KIND_LABEL: Record<ArchitectureEdge["kind"], string> = {
  sync: "Request and response",
  async: "Background work",
  fallback: "Fallback or legacy path",
  disabled: "Implemented, switched off",
};

/** What the three buttons beside the view switch do. Left out in the placeholder, where they are drawn but do nothing. */
export interface DiagramActions {
  everyLine: boolean;
  expanded: boolean;
  onEveryLine(): void;
  onFullGraph(): void;
  onExpand(): void;
}

/**
 * The card's title, the switch between the two ways of reading the diagram,
 * and the diagram's own buttons. The buttons are here and not over the canvas
 * so that nothing ever covers part of the drawing.
 */
export function ExplorerHeader({
  heading,
  view,
  disabled = false,
  onView,
  actions,
}: {
  heading?: ReactNode;
  view: DiagramView;
  /** True in the placeholder: the controls are drawn but do nothing yet. */
  disabled?: boolean;
  onView?(view: DiagramView): void;
  actions?: DiagramActions;
}) {
  const button = "grid h-9 w-9 place-items-center rounded-lg border border-line-strong bg-surface text-muted shadow-sm transition-colors enabled:hover:border-accent enabled:hover:text-accent";
  const everyLine = actions?.everyLine ?? false;
  const expanded = actions?.expanded ?? false;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 bg-surface px-4 pb-3 pt-4 sm:px-5 md:flex-nowrap" aria-busy={disabled || undefined}>
      <div className="min-w-0">{heading}</div>
      <div className={"flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 " + (disabled ? "opacity-60" : "")}>
        <div role="group" aria-label="Diagram view" className="segmented">
          {(["system", "data"] as const).map((option) => (
            <button key={option} type="button" disabled={disabled} aria-pressed={view === option} onClick={() => onView?.(option)}>
              {option === "system" ? "Architecture" : "Data flow"}
            </button>
          ))}
        </div>
        {/* These act on the canvas. A narrow screen has the layers stacked instead, with nothing to zoom or expand. */}
        <div className="flex gap-1.5 max-md:hidden">
          <button
            type="button"
            disabled={disabled}
            onClick={actions?.onEveryLine}
            aria-pressed={everyLine}
            aria-label="Every connection"
            title={everyLine ? "Group the lines by layer again" : "Draw every connection with its own line"}
            className={button + (everyLine ? " !border-accent !text-accent" : "")}
          >
            <Waypoints size={16} aria-hidden />
          </button>
          <button type="button" disabled={disabled} onClick={actions?.onFullGraph} aria-label="Full graph" title="Show every component at once" className={button}>
            <Scan size={16} aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={actions?.onExpand}
            aria-pressed={expanded}
            aria-label={expanded ? "Close" : "Expand"}
            title={expanded ? "Close the expanded view" : "Open the diagram over the whole window"}
            className={button}
          >
            {expanded ? <Minimize size={16} aria-hidden /> : <Expand size={16} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The requests that can be followed through the system. Shown in the data-flow view. */
export function RequestPicker({ architecture, flowId, onFlow }: { architecture: Architecture; flowId: string; onFlow(flowId: string): void }) {
  if (architecture.flows.length === 0) {
    return <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-sm text-muted sm:px-5">No request has been traced through this system yet.</p>;
  }
  return (
    <div className="border-t border-line bg-surface-2 px-4 py-2.5 sm:px-5">
      <div role="group" aria-label="Follow a request" className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
        <span className="shrink-0 text-[0.8125rem] font-semibold text-muted">Follow a request</span>
        {architecture.flows.map((item) => (
          <button key={item.id} type="button" className="chip shrink-0" aria-pressed={flowId === item.id} onClick={() => onFlow(flowId === item.id ? "" : item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the line styles mean, and what one line stands for. Rendered on the server, under the canvas. */
export function ExplorerFooter() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line bg-surface px-4 py-2.5 text-xs text-muted sm:px-5">
      <p className="w-full text-[0.8125rem] max-md:hidden sm:w-auto sm:text-xs" data-testid="links-hint">
        <span className="font-semibold text-fg">One line joins two layers.</span> Point at a component, or choose it, to see its own connections.
      </p>
      <p className="w-full text-[0.8125rem] md:hidden">
        <span className="font-semibold text-fg">Layers, top to bottom.</span> Choose a component to see what it connects to.
      </p>
      <span className="font-semibold text-subtle max-md:hidden" id="connection-styles">
        Connections
      </span>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 max-md:hidden" aria-labelledby="connection-styles">
        {(Object.keys(EDGE_KIND_LABEL) as ArchitectureEdge["kind"][]).map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <svg width="26" height="6" aria-hidden className={kind === "disabled" ? "opacity-40" : ""}>
              <line x1="0" y1="3" x2="26" y2="3" stroke="var(--accent)" strokeWidth="2" strokeDasharray={EDGE_DASH[kind]} />
            </svg>
            {EDGE_KIND_LABEL[kind]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stands in for the explorer until the diagram library has loaded. Same header, same canvas. */
export function ExplorerPlaceholder({ heading, bounds }: { heading?: ReactNode; bounds: Box }) {
  return (
    <div>
      <ExplorerHeader heading={heading} view="system" disabled />
      <div className="grid w-full place-items-center bg-surface" style={canvasStyle(bounds)}>
        <p role="status" className="text-sm text-muted">
          Loading the interactive diagram…
        </p>
      </div>
    </div>
  );
}
