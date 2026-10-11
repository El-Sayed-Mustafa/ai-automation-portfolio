import { roundedPath, type LayerLink } from "@/content/architecture-columns";
import { EDGE_DASH } from "./ExplorerChrome";

/** The arrowhead for grouped lines. One size whatever the line's weight, and it turns to face the way the line arrives. */
export function LinkMarker({ id }: { id: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <path d="M 0 0.6 L 10 5 L 0 9.4 z" style={{ fill: "var(--accent)" }} />
    </marker>
  );
}

/**
 * The lines a diagram shows at rest: one drawing for each pair of connected
 * layers, worked out by the layout. Used by the interactive diagram and by the
 * still picture, so the two look the same.
 *
 * Meant to sit inside an `<svg>` whose units are the layout's own.
 */
export function LayerLinks({ links, marker, weight = 2 }: { links: LayerLink[]; marker: string; weight?: number }) {
  return (
    <g data-layer-links fill="none" strokeWidth={weight} strokeLinejoin="round" style={{ stroke: "var(--accent)" }}>
      {links.map((link, order) => (
        <g key={link.id} data-link={link.id} data-route={link.route} className="link-in" style={{ "--i": order } as React.CSSProperties}>
          {link.strokes.map((stroke, index) => (
            <path
              key={index}
              d={roundedPath(stroke.points, link.route === "gutter" ? 10 : 14)}
              strokeDasharray={EDGE_DASH[stroke.kind]}
              markerStart={stroke.arrowStart ? `url(#${marker})` : undefined}
              markerEnd={stroke.arrowEnd ? `url(#${marker})` : undefined}
              opacity={stroke.kind === "disabled" ? 0.4 : undefined}
            />
          ))}
        </g>
      ))}
    </g>
  );
}
