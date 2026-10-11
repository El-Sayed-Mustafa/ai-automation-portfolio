import { useId } from "react";
import { layoutColumns } from "@/content/architecture-columns";
import type { Architecture } from "@/content/schema";
import { NodeTile } from "@/components/ui/TechIcon";
import { LayerLinks, LinkMarker } from "./LayerLinks";
import { layerTone } from "./NodeDetails";

/**
 * A project's architecture as a picture: the same columns and components as
 * the interactive diagram, and the same lines between layers, drawn on the
 * server with no script. It is what the diagram looks like before anything is
 * selected, so the overview can show the system without loading the diagram
 * library.
 *
 * It is drawn from the project's own data, so it is never an invented image.
 * To assistive technology it is one image with a description; the components
 * themselves are listed, with their details, in the Architecture tab.
 */
export function ArchitecturePicture({ architecture, label, className = "" }: { architecture: Architecture; label: string; className?: string }) {
  const marker = useId();
  const layout = layoutColumns(architecture);
  const { x, y, width, height } = layout.bounds;
  return (
    <svg viewBox={`${x} ${y} ${width} ${height}`} className={className} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <defs>
        <LinkMarker id={marker} />
      </defs>
      {layout.groups.map((group) => (
        <g key={group.id} data-tone={layerTone(architecture, group.layerId)}>
          <rect x={group.x} y={group.y} width={group.width} height={group.height} rx={16} style={{ fill: "var(--tone-soft)", stroke: "var(--tone-vivid)", strokeOpacity: 0.25 }} />
          <text x={group.x + group.width / 2} y={group.y + 23} textAnchor="middle" style={{ fill: "var(--tone)", fontSize: 13.5, fontWeight: 700 }}>
            {group.label.length > 24 ? `${group.label.slice(0, 23)}…` : group.label}
          </text>
        </g>
      ))}
      <LayerLinks links={layout.links} marker={marker} />
      {architecture.nodes.map((node) => {
        const box = layout.nodes[node.id];
        const inactive = node.status !== "active";
        return (
          <foreignObject key={node.id} x={box.x} y={box.y} width={box.width} height={box.height} data-tone={layerTone(architecture, node.layer)}>
            <div className={"flex h-full w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-1.5 " + (inactive ? "border-dashed border-line-strong" : "border-line")}>
              <NodeTile node={node} size={34} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13.5px] font-bold leading-[1.2] text-fg">{node.label}</span>
                <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted">{node.technology}</span>
              </span>
            </div>
          </foreignObject>
        );
      })}
      {/* Drawn last and outside the cards, so the mark sits on the card's edge and is never clipped. */}
      {architecture.nodes
        .filter((node) => node.status !== "active")
        .map((node) => {
          const box = layout.nodes[node.id];
          const width = node.status.length * 5.6 + 14;
          return (
            <g key={node.id}>
              <rect x={box.x + box.width - width - 8} y={box.y - 8} width={width} height={16} rx={8} style={{ fill: "var(--surface)", stroke: "var(--line-strong)" }} />
              <text x={box.x + box.width - width / 2 - 8} y={box.y + 3.4} textAnchor="middle" style={{ fill: "var(--muted)", fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {node.status}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
