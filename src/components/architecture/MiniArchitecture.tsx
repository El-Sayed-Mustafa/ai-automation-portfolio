import { layoutColumns, roundedPath } from "@/content/architecture-columns";
import { KIND_TONE } from "@/components/ui/TechIcon";
import type { Architecture } from "@/content/schema";
import { layerTone } from "./NodeDetails";

/**
 * A project's architecture as a small picture: the same columns as the
 * interactive diagram and the same lines between layers, without labels. It stands in
 * for a screenshot on cards of projects that have none, and it is drawn from
 * the project's own data, so it is never an invented image.
 */
export function MiniArchitecture({ architecture, className = "" }: { architecture: Architecture; className?: string }) {
  const layout = layoutColumns(architecture);
  const { x, y, width, height } = layout.bounds;
  return (
    <svg viewBox={`${x} ${y} ${width} ${height}`} className={className} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Diagram of the system's layers and connections">
      {layout.groups.map((group) => (
        <g key={group.id} data-tone={layerTone(architecture, group.layerId)}>
          <rect x={group.x} y={group.y} width={group.width} height={group.height} rx={14} style={{ fill: "var(--tone-soft)", stroke: "var(--tone-vivid)", strokeOpacity: 0.35 }} />
          <rect x={group.x + group.width / 2 - 34} y={group.y + 14} width={68} height={9} rx={4.5} style={{ fill: "var(--tone-vivid)", opacity: 0.8 }} />
        </g>
      ))}
      {layout.links.flatMap((link) =>
        link.strokes.map((stroke, index) => (
          <path key={`${link.id}-${index}`} d={roundedPath(stroke.points, 12)} fill="none" style={{ stroke: "var(--accent)", opacity: stroke.kind === "disabled" ? 0.3 : 0.75 }} strokeWidth={3} />
        )),
      )}
      {architecture.nodes.map((node) => {
        const box = layout.nodes[node.id];
        return (
          <g key={node.id} data-tone={KIND_TONE[node.kind]}>
            <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={11} style={{ fill: "var(--surface)", stroke: "var(--line-strong)" }} />
            <rect x={box.x + 10} y={box.y + 16} width={30} height={30} rx={8} style={{ fill: "var(--tone-vivid)" }} />
            <rect x={box.x + 50} y={box.y + 20} width={box.width - 78} height={9} rx={4.5} style={{ fill: "var(--fg)", opacity: 0.7 }} />
            <rect x={box.x + 50} y={box.y + 36} width={box.width - 104} height={7} rx={3.5} style={{ fill: "var(--subtle)", opacity: 0.45 }} />
          </g>
        );
      })}
    </svg>
  );
}
