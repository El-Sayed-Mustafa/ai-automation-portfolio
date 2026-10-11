"use client";

import {
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ArrowRight, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  layoutColumns,
  roundedPath,
  type PlacedGroup,
  type Point,
} from "@/content/architecture-columns";
import type {
  Architecture,
  ArchitectureNode,
  Project,
  Tone,
} from "@/content/schema";
import { useTheme } from "@/lib/preferences";
import {
  CANVAS_PAD,
  EDGE_DASH,
  ExplorerHeader,
  FOCUS_ZOOM,
  READABLE_ZOOM,
  RequestPicker,
  canvasStyle,
  type DiagramView,
} from "./ExplorerChrome";
import { NodeTile } from "@/components/ui/TechIcon";
import { LayerLinks, LinkMarker } from "./LayerLinks";
import { LayerStack } from "./LayerStack";
import { layerTone } from "./NodeDetails";
import { NodePanel } from "./NodePanel";

/** Width of the details card and its margin, in pixels: the part of the canvas it covers on a wide screen. */
const DETAILS_WIDTH = 384;

interface ArchNodeData extends Record<string, unknown> {
  node: ArchitectureNode;
  tone: Tone;
  active: boolean;
  dimmed: boolean;
  /** Its place in the order the components arrive in when the diagram first appears. */
  order: number;
  onSelect(id: string): void;
  onPoint(id: string | null): void;
}
interface ZoneNodeData extends Record<string, unknown> {
  group: PlacedGroup;
  tone: Tone;
  dimmed: boolean;
  active: boolean;
  onFocus(layerId: string): void;
}
interface RoutedEdgeData extends Record<string, unknown> {
  points: Point[];
  label: Point;
  /** The arrowhead it ends in: the same one the grouped lines use, so both kinds of line look alike. */
  marker: string;
}

type ArchFlowNode = Node<ArchNodeData, "arch">;
type ZoneFlowNode = Node<ZoneNodeData, "zone">;
type RoutedFlowEdge = Edge<RoutedEdgeData, "routed">;

function ArchNodeCard({ data }: NodeProps<ArchFlowNode>) {
  const { node, tone, active, dimmed, order, onSelect, onPoint } = data;
  const inactive = node.status !== "active";
  return (
    <div
      data-tone={tone}
      className={
        "h-full w-full transition-opacity duration-200 " +
        (dimmed ? "opacity-30" : "opacity-100")
      }
    >
      {/* The lines are routed by the layout, so these exist only because the library wants a handle on each end. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        // Pointing at a component, or reaching it with the keyboard, shows what it is connected to.
        onMouseEnter={() => onPoint(node.id)}
        onMouseLeave={() => onPoint(null)}
        onFocus={() => onPoint(node.id)}
        onBlur={() => onPoint(null)}
        style={{ "--i": order } as React.CSSProperties}
        aria-pressed={active}
        // The name is the text on the card, in the order it is read, so what is announced is what is shown.
        aria-label={`${node.label}: ${node.technology}${inactive ? `, ${node.status}` : ""}`}
        // React Flow switches pointer events off on nodes that are neither
        // draggable nor selectable, so the button has to switch them back on.
        className={
          "pop nodrag nopan pointer-events-auto flex h-full w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-1.5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg " +
          (active
            ? "border-tone-vivid ring-2 ring-tone-vivid"
            : "border-line hover:border-tone-vivid") +
          (inactive ? " border-dashed" : "")
        }
      >
        <NodeTile node={node} size={34} active={active} />
        <span className="min-w-0 flex-1">
          {/* line-clamp sets its own display value, so no "block" here: it would switch the clamp off. */}
          <span className="line-clamp-2 text-[13.5px] font-bold leading-[1.2] text-fg">
            {node.label}
          </span>{" "}
          <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted">
            {node.technology}
          </span>
        </span>{" "}
        {inactive ? (
          <span className="absolute -top-2 right-2 rounded-full border border-line-strong bg-surface px-1.5 text-[9px] font-bold uppercase leading-4 tracking-wide text-muted">
            {node.status}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** A tinted column behind the components of one layer. Its title brings that layer forward. */
function ZoneBox({ data }: NodeProps<ZoneFlowNode>) {
  const { group, tone, dimmed, active, onFocus } = data;
  return (
    <div
      data-tone={tone}
      className={
        "pointer-events-none h-full w-full rounded-2xl border bg-tone-soft transition-opacity duration-200 " +
        (active ? "border-tone-vivid " : "border-tone-vivid/25 ") +
        (dimmed ? "opacity-40" : "opacity-100")
      }
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label={`Focus the ${group.label} layer`}
        title={
          active ? "Show every layer" : `Bring the ${group.label} layer forward`
        }
        onClick={() => onFocus(group.layerId)}
        // Tall enough to press at the smallest size the diagram is ever drawn at: 32 units is 25px at a zoom of 0.8.
        className="nodrag nopan pointer-events-auto absolute inset-x-2 top-[3px] grid min-h-[32px] place-items-center rounded-lg px-1 text-center text-[13.5px] font-bold leading-tight text-tone hover:bg-surface/70"
      >
        <span className="line-clamp-1">{group.label}</span>
      </button>
    </div>
  );
}

/** A connection drawn along the corners the layout worked out for it. */
function RoutedEdgePath({
  id,
  data,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps<RoutedFlowEdge>) {
  if (!data) return null;
  return (
    <BaseEdge
      id={id}
      path={roundedPath(data.points)}
      labelX={data.label.x}
      labelY={data.label.y}
      label={label}
      labelStyle={labelStyle}
      labelShowBg
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      style={style}
      markerEnd={`url(#${data.marker})`}
    />
  );
}

/** Below this width the layers are stacked top to bottom instead of drawn as columns on a canvas. */
const NARROW = "(max-width: 767px)";

function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(NARROW);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

const nodeTypes = { arch: ArchNodeCard, zone: ZoneBox };
const edgeTypes = { routed: RoutedEdgePath };

interface ExplorerProps {
  architecture: Architecture;
  repository: Project["repository"];
  /** The card's title block, drawn beside the view switch. */
  heading?: ReactNode;
  /** Components to bring forward from outside, for example the ones a workflow stage runs on. */
  highlight?: readonly string[];
}

export default function ArchitectureExplorer(props: ExplorerProps) {
  return (
    <ReactFlowProvider>
      <ExplorerInner {...props} />
    </ReactFlowProvider>
  );
}

function ExplorerInner({
  architecture,
  repository,
  heading,
  highlight,
}: ExplorerProps) {
  const theme = useTheme();
  const { fitView, setViewport, getViewport } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The component under the pointer or the keyboard focus. Its own connections are drawn; nothing is dimmed for it. */
  const [pointedId, setPointedId] = useState<string | null>(null);
  /** Off: one line per pair of layers. On: every connection, each with its own line. */
  const [everyLine, setEveryLine] = useState(false);
  const marker = useId();
  const narrow = useNarrow();
  const [layer, setLayer] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string>("");
  const [view, setView] = useState<DiagramView>("system");
  const [expanded, setExpanded] = useState(false);
  /** True while the canvas shows only part of the graph at a readable size. */
  const [partial, setPartial] = useState(false);

  const nodeById = useMemo(
    () => new Map(architecture.nodes.map((node) => [node.id, node])),
    [architecture.nodes],
  );
  // Where everything is drawn is worked out from the layers and the connections; a manifest holds no coordinates the diagram uses.
  const layout = useMemo(() => layoutColumns(architecture), [architecture]);
  const bounds = layout.bounds;
  const flow = architecture.flows.find((item) => item.id === flowId) ?? null;
  const selected = selectedId ? (nodeById.get(selectedId) ?? null) : null;

  const { emphasisedEdges, emphasisedNodes } = useMemo(() => {
    const edges = new Set<string>();
    const nodes = new Set<string>();
    if (flow) {
      for (const edgeId of flow.path) {
        const edge = architecture.edges.find((item) => item.id === edgeId);
        if (!edge) continue;
        edges.add(edge.id);
        nodes.add(edge.from);
        nodes.add(edge.to);
      }
    } else if (selectedId) {
      nodes.add(selectedId);
      for (const edge of architecture.edges) {
        if (edge.from === selectedId || edge.to === selectedId) {
          edges.add(edge.id);
          nodes.add(edge.from);
          nodes.add(edge.to);
        }
      }
    } else if (layer) {
      for (const node of architecture.nodes)
        if (node.layer === layer) nodes.add(node.id);
      // Each connection of that layer, with its own line: what one line per pair of layers leaves out.
      for (const edge of architecture.edges)
        if (nodes.has(edge.from) || nodes.has(edge.to)) edges.add(edge.id);
    } else if (highlight && highlight.length > 0) {
      for (const id of highlight) nodes.add(id);
      // The connections among the highlighted components, so a stage reads as a path.
      for (const edge of architecture.edges)
        if (nodes.has(edge.from) && nodes.has(edge.to)) edges.add(edge.id);
    }
    return { emphasisedEdges: edges, emphasisedNodes: nodes };
  }, [architecture, flow, selectedId, layer, highlight]);

  const focusing = Boolean(
    flow || selectedId || layer || (highlight && highlight.length > 0),
  );

  /**
   * Puts the whole drawing in the middle of the canvas: the components and
   * the lines that run above and below them. The library's own fit looks at
   * the components only, which would push those lines against the edge.
   */
  const frameAll = useCallback(
    (duration = 0) => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const fit = Math.min(
        (canvas.clientWidth - CANVAS_PAD * 2) / bounds.width,
        (canvas.clientHeight - CANVAS_PAD * 2) / bounds.height,
      );
      const zoom = Math.min(fit, 1.25);
      setViewport(
        {
          x: (canvas.clientWidth - bounds.width * zoom) / 2 - bounds.x * zoom,
          y: (canvas.clientHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
          zoom,
        },
        { duration },
      );
      return fit;
    },
    [bounds, setViewport],
  );

  /**
   * Shows the whole graph when that keeps it readable. Otherwise it shows the
   * part where requests enter, at a readable size, and says so.
   */
  const showOverview = useCallback(
    (duration = 0) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const fit = Math.min(
        (canvas.clientWidth - CANVAS_PAD * 2) / bounds.width,
        (canvas.clientHeight - CANVAS_PAD * 2) / bounds.height,
      );
      // A hair of tolerance: the canvas is sized from the same numbers, and rounding must not flip the answer.
      if (fit >= READABLE_ZOOM - 0.005) {
        frameAll(duration);
        setPartial(false);
      } else {
        setViewport(
          {
            x: CANVAS_PAD - bounds.x * FOCUS_ZOOM,
            y: CANVAS_PAD - bounds.y * FOCUS_ZOOM,
            zoom: FOCUS_ZOOM,
          },
          { duration },
        );
        setPartial(true);
      }
    },
    [bounds, frameAll, setViewport],
  );

  const showFullGraph = useCallback(() => {
    frameAll(300);
    setPartial(false);
  }, [frameAll]);

  /**
   * Brings a set of components into view. Where the whole diagram is readable
   * it stays whole, so what is brought forward is seen in its place; where it
   * is not, the canvas moves to those components.
   */
  const focusNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const canvas = canvasRef.current;
      const fit = canvas
        ? Math.min(
            (canvas.clientWidth - CANVAS_PAD * 2) / bounds.width,
            (canvas.clientHeight - CANVAS_PAD * 2) / bounds.height,
          )
        : 0;
      if (fit >= READABLE_ZOOM - 0.005) {
        frameAll(300);
        setPartial(false);
        return;
      }
      fitView({
        nodes: ids.map((id) => ({ id })),
        padding: "36px",
        maxZoom: 1,
        minZoom: 0.5,
        duration: 300,
      });
      setPartial(true);
    },
    [bounds, fitView, frameAll],
  );

  // Frame the diagram when it first has a size, when the expanded view opens or closes, and when the window is resized.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = requestAnimationFrame(() => showOverview());
    let width = canvas.clientWidth;
    const observer = new ResizeObserver(() => {
      if (canvas.clientWidth === width) return;
      width = canvas.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => showOverview());
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ready, expanded, showOverview]);

  // The expanded view covers the page, so the page behind it must not scroll, and Escape must close it.
  useEffect(() => {
    if (!expanded) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded && !selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedId) setSelectedId(null);
      else setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, selectedId]);

  const selectNode = useCallback(
    (id: string) => {
      const next = selectedId === id ? null : id;
      setSelectedId(next);
      const placed = next ? layout.nodes[next] : undefined;
      const canvas = canvasRef.current;
      if (!placed || !canvas) return;
      // The diagram stays where it is. It only slides when the chosen
      // component would be off the canvas or under the details card, which
      // covers the right of the canvas on a wide screen.
      const current = getViewport();
      const card = window.matchMedia("(min-width: 1024px)").matches
        ? Math.min(DETAILS_WIDTH, canvas.clientWidth / 2)
        : 0;
      const margin = 20;
      const left = placed.x * current.zoom + current.x;
      const right = left + placed.width * current.zoom;
      const top = placed.y * current.zoom + current.y;
      const bottom = top + placed.height * current.zoom;
      let dx = 0;
      let dy = 0;
      if (right > canvas.clientWidth - card - margin)
        dx = canvas.clientWidth - card - margin - right;
      if (left + dx < margin) dx = margin - left;
      if (bottom > canvas.clientHeight - margin)
        dy = canvas.clientHeight - margin - bottom;
      if (top + dy < margin) dy = margin - top;
      if (dx !== 0 || dy !== 0) {
        setViewport(
          { x: current.x + dx, y: current.y + dy, zoom: current.zoom },
          { duration: 250 },
        );
        setPartial(true);
      }
    },
    [selectedId, layout, getViewport, setViewport],
  );

  const chooseLayer = useCallback(
    (id: string) => {
      const next = layer === id ? null : id;
      setLayer(next);
      setFlowId("");
      setSelectedId(null);
      if (next === null) showOverview(300);
      else
        focusNodes(
          architecture.nodes
            .filter((node) => node.layer === next)
            .map((node) => node.id),
        );
    },
    [layer, architecture.nodes, showOverview, focusNodes],
  );

  const nodes: (ArchFlowNode | ZoneFlowNode)[] = useMemo(
    () => [
      ...layout.groups.map((group): ZoneFlowNode => ({
        id: group.id,
        type: "zone",
        position: { x: group.x, y: group.y },
        width: group.width,
        height: group.height,
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        data: {
          group,
          tone: layerTone(architecture, group.layerId),
          dimmed:
            focusing && !group.nodeIds.some((id) => emphasisedNodes.has(id)),
          active: layer === group.layerId,
          onFocus: chooseLayer,
        },
      })),
      ...architecture.nodes.map((node): ArchFlowNode => {
        const placed = layout.nodes[node.id];
        return {
          id: node.id,
          type: "arch",
          position: { x: placed.x, y: placed.y },
          width: placed.width,
          height: placed.height,
          draggable: false,
          selectable: false,
          focusable: false,
          data: {
            node,
            tone: layerTone(architecture, node.layer),
            active: node.id === selectedId,
            dimmed: focusing && !emphasisedNodes.has(node.id),
            // Left to right, then top to bottom: the order a request would meet them in.
            order: placed.column * 2 + placed.row,
            onSelect: selectNode,
            onPoint: setPointedId,
          },
        };
      }),
    ],
    [
      layout,
      architecture,
      selectedId,
      layer,
      focusing,
      emphasisedNodes,
      selectNode,
      chooseLayer,
    ],
  );

  const edges: RoutedFlowEdge[] = useMemo(
    () =>
      architecture.edges.flatMap((edge) => {
        const route = layout.edges[edge.id];
        if (!route) return [];
        const pointed =
          !focusing &&
          pointedId !== null &&
          (edge.from === pointedId || edge.to === pointedId);
        const emphasised = emphasisedEdges.has(edge.id) || pointed;
        // At rest the layers are joined by one line per pair, and a connection has no line of its own. It gets
        // one when it is asked for: by pointing at a component, by choosing one, a layer or a request, or by
        // asking for every line at once.
        if (!emphasised && !everyLine) return [];
        const hop = flow ? flow.path.indexOf(edge.id) : -1;
        const opacity = emphasised
          ? 1
          : focusing
            ? 0.14
            : edge.kind === "disabled"
              ? 0.35
              : 0.85;
        return [
          {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            type: "routed",
            data: { points: route.points, label: route.label, marker },
            focusable: false,
            selectable: false,
            animated: emphasised && edge.kind !== "disabled",
            // On the canvas a hop of a followed request carries its number and nothing more: the gutters are
            // narrower than any sentence, and words there would cover the components. The words are in the strip above.
            label: hop >= 0 ? String(hop + 1) : undefined,
            labelStyle: {
              fill: "var(--accent-fg)",
              fontSize: 11,
              fontWeight: 700,
            },
            labelBgStyle: { fill: "var(--accent)" },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 9,
            zIndex: emphasised ? 10 : 0,
            style: {
              stroke: "var(--accent)",
              strokeWidth: emphasised ? 2.4 : 1.7,
              strokeDasharray: EDGE_DASH[edge.kind],
              opacity,
            },
          } satisfies RoutedFlowEdge,
        ];
      }),
    [
      architecture.edges,
      layout,
      emphasisedEdges,
      flow,
      focusing,
      pointedId,
      everyLine,
      marker,
    ],
  );

  // On a narrow screen a followed request is shown as numbers on the components its hops arrive at.
  const stackHops = useMemo(() => {
    const arriving: Record<string, number[]> = {};
    flow?.path.forEach((edgeId, index) => {
      const edge = architecture.edges.find((item) => item.id === edgeId);
      if (!edge) return;
      (arriving[edge.to] ??= []).push(index + 1);
    });
    return arriving;
  }, [flow, architecture.edges]);

  // The grouped lines step back while exact ones are on show, and leave when every exact one is.
  const exact = edges.length > 0;
  const linksOpacity = everyLine ? 0 : exact ? 0.16 : 1;

  function chooseFlow(id: string) {
    setFlowId(id);
    setSelectedId(null);
    setLayer(null);
    const next = architecture.flows.find((item) => item.id === id);
    if (!next) {
      showOverview(300);
      return;
    }
    const ids = new Set<string>();
    for (const edgeId of next.path) {
      const edge = architecture.edges.find((item) => item.id === edgeId);
      if (edge) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    focusNodes([...ids]);
  }

  function chooseView(next: DiagramView) {
    setView(next);
    // A request is followed in the data-flow view only; going back to the structure lets it go.
    if (next === "system" && flowId) chooseFlow("");
  }

  return (
    <div
      className={
        "flex flex-col " + (expanded ? "fixed inset-0 z-50 bg-bg" : "")
      }
      role={expanded ? "region" : undefined}
      aria-label={expanded ? "Architecture diagram, expanded" : undefined}
    >
      <ExplorerHeader
        heading={heading}
        view={view}
        onView={chooseView}
        actions={{
          everyLine,
          expanded,
          onEveryLine: () => setEveryLine((value) => !value),
          onFullGraph: showFullGraph,
          onExpand: () => setExpanded((value) => !value),
        }}
      />
      {view === "data" ? (
        <RequestPicker
          architecture={architecture}
          flowId={flowId}
          onFlow={chooseFlow}
        />
      ) : null}

      {/*
        The steps of the request being followed, in words. They sit above the canvas on a wide screen and under it
        on a narrow one, never over it: the diagram keeps its full width, so a route is drawn at a readable size.
      */}
      {flow ? (
        <aside
          aria-label="Steps of this request"
          className="order-last border-t border-line bg-surface px-4 py-3 sm:px-5 lg:order-none"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-[0.9375rem] font-bold leading-snug">
                {flow.label}
              </h4>
              <p className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-muted">
                {flow.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => chooseFlow("")}
              className="inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:underline"
            >
              <X size={14} aria-hidden /> Stop following this request
            </button>
          </div>
          <ol className="mt-3 grid gap-x-5 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]">
            {flow.path.map((edgeId, index) => {
              const edge = architecture.edges.find(
                (item) => item.id === edgeId,
              );
              if (!edge) return null;
              return (
                <li
                  key={edgeId}
                  className="flex items-start gap-2 text-[0.8125rem]"
                >
                  <span
                    className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[0.6875rem] font-bold text-accent-fg"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-1 font-semibold leading-snug">
                      {nodeById.get(edge.from)?.label ?? edge.from}
                      <ArrowRight
                        size={12}
                        className="shrink-0 text-subtle"
                        aria-label="to"
                      />
                      {nodeById.get(edge.to)?.label ?? edge.to}
                    </span>
                    <span className="mt-0.5 block leading-snug text-muted">
                      {edge.data}
                    </span>
                    <span className="eng-only mt-0.5 block leading-snug text-subtle">
                      {edge.protocol}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>
      ) : null}

      <div
        className={
          "relative border-t border-line bg-surface " +
          (expanded ? "min-h-0 flex-1" : "")
        }
      >
        {narrow ? (
          <div className="p-3" aria-label="Architecture diagram">
            <LayerStack
              architecture={architecture}
              layout={layout}
              selectedId={selectedId}
              emphasised={focusing ? emphasisedNodes : null}
              hops={stackHops}
              onSelect={(id) =>
                setSelectedId((current) => (current === id ? null : id))
              }
            />
          </div>
        ) : (
          <div
            ref={canvasRef}
            className={expanded ? "h-full" : "w-full"}
            style={expanded ? undefined : canvasStyle(bounds)}
            aria-label="Architecture diagram"
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              colorMode={theme}
              minZoom={0.15}
              maxZoom={1.75}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              preventScrolling={false}
              onInit={() => setReady(true)}
              onPaneClick={() => setSelectedId(null)}
            >
              <Controls
                showInteractive={false}
                showFitView={false}
                position="bottom-left"
              />
              {/* Drawn in the diagram's own units, so the lines move and scale with the components. */}
              <ViewportPortal>
                <svg
                  aria-hidden
                  data-links-state={everyLine ? "off" : exact ? "back" : "rest"}
                  className="pointer-events-none absolute overflow-visible transition-opacity duration-200"
                  style={{
                    left: bounds.x,
                    top: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                    opacity: linksOpacity,
                  }}
                  viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
                >
                  <defs>
                    <LinkMarker id={marker} />
                  </defs>
                  <LayerLinks links={layout.links} marker={marker} />
                </svg>
              </ViewportPortal>
            </ReactFlow>
          </div>
        )}

        {/* Said only when it is true: part of the diagram is off the canvas. */}
        {partial && !selected ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 z-[5] flex justify-center px-14">
            <span className="pointer-events-auto rounded-full border border-line-strong bg-surface px-3 py-1 text-xs text-muted shadow-sm">
              Part of the diagram. Drag to move, or{" "}
              <button type="button" className="link" onClick={showFullGraph}>
                show the full graph
              </button>
              .
            </span>
          </p>
        ) : null}

        {/* A card over the canvas on wide screens; a sheet from the bottom of the viewport on narrow ones. */}
        {selected ? (
          <aside
            aria-label={`Details for ${selected.label}`}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[72dvh] overflow-y-auto rounded-t-2xl border-t border-line-strong bg-surface p-5 shadow-lg lg:absolute lg:inset-x-auto lg:bottom-3 lg:right-3 lg:top-3 lg:z-10 lg:max-h-none lg:w-[22.5rem] lg:rounded-2xl lg:border lg:border-line-strong"
          >
            <NodePanel
              key={selected.id}
              node={selected}
              architecture={architecture}
              repository={repository}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
