import { describe, expect, it } from "vitest";
import { COLUMN, layoutColumns, roundedPath, type Box, type Point } from "./architecture-columns";
import { getProjects } from "./load";

interface Segment {
  edge: string;
  a: Point;
  b: Point;
}

function segmentsOf(layout: ReturnType<typeof layoutColumns>): Segment[] {
  return Object.values(layout.edges).flatMap((edge) => edge.points.slice(0, -1).map((a, index) => ({ edge: edge.id, a, b: edge.points[index + 1] })));
}

/** True when a segment runs through the inside of a box, not merely along or up to its edge. */
function passesThrough(segment: Segment, box: Box): boolean {
  const x1 = Math.min(segment.a.x, segment.b.x);
  const x2 = Math.max(segment.a.x, segment.b.x);
  const y1 = Math.min(segment.a.y, segment.b.y);
  const y2 = Math.max(segment.a.y, segment.b.y);
  const inside = 0.5;
  return x1 < box.x + box.width - inside && x2 > box.x + inside && y1 < box.y + box.height - inside && y2 > box.y + inside;
}

/** How far two segments run along each other, in diagram units. Zero when they only cross or touch. */
function sharedLength(p: Segment, q: Segment): number {
  const horizontal = (s: Segment) => s.a.y === s.b.y;
  if (horizontal(p) !== horizontal(q)) return 0;
  if (horizontal(p)) {
    if (Math.abs(p.a.y - q.a.y) > 0.75) return 0;
    return Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
  }
  if (Math.abs(p.a.x - q.a.x) > 0.75) return 0;
  return Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y)) - Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
}

describe.each(getProjects())("the diagram of $id", (project) => {
  const architecture = project.architecture;
  const layout = layoutColumns(architecture);
  const boxes = Object.values(layout.nodes);
  const segments = segmentsOf(layout);

  it("gives every layer a column, in the order the layers are declared", () => {
    const withNodes = architecture.layers.filter((layer) => architecture.nodes.some((node) => node.layer === layer.id));
    expect(layout.groups.map((group) => group.layerId)).toEqual(withNodes.map((layer) => layer.id));
    for (let i = 1; i < layout.groups.length; i += 1) {
      expect(layout.groups[i].x).toBe(layout.groups[i - 1].x + layout.groups[i - 1].width + COLUMN.gutter);
    }
    // A column is as tall as its own components, and none reaches past the tallest one.
    const tallest = Math.max(...layout.groups.map((group) => group.height));
    for (const group of layout.groups) {
      const count = group.nodeIds.length;
      expect(group.height).toBe(COLUMN.padTop + count * COLUMN.nodeHeight + (count - 1) * COLUMN.rowGap + COLUMN.padBottom);
      expect(group.y).toBeGreaterThanOrEqual(0);
      expect(group.y + group.height).toBeLessThanOrEqual(tallest);
      // It sits in the middle of the tallest, to within the one row the shared grid allows.
      expect(Math.abs(group.y + group.height / 2 - tallest / 2)).toBeLessThanOrEqual((COLUMN.nodeHeight + COLUMN.rowGap) / 2 + 0.01);
    }
  });

  it("places every component inside its own group, without overlap", () => {
    expect(boxes).toHaveLength(architecture.nodes.length);
    for (const node of architecture.nodes) {
      const box = layout.nodes[node.id];
      const group = layout.groups.find((item) => item.layerId === node.layer)!;
      expect(group.nodeIds).toContain(node.id);
      expect(box.x).toBeGreaterThanOrEqual(group.x + COLUMN.padX);
      expect(box.x + box.width).toBeLessThanOrEqual(group.x + group.width - COLUMN.padX);
      expect(box.y).toBeGreaterThanOrEqual(group.y + COLUMN.padTop);
      expect(box.y + box.height).toBeLessThanOrEqual(group.y + group.height - COLUMN.padBottom);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });

  it("routes every connection, in straight horizontal and vertical runs", () => {
    expect(Object.keys(layout.edges).sort()).toEqual(architecture.edges.map((edge) => edge.id).sort());
    for (const segment of segments) {
      expect(segment.a.x === segment.b.x || segment.a.y === segment.b.y, segment.edge).toBe(true);
    }
  });

  it("starts each line on a side of its source and ends it on a side of its target, away from the corners", () => {
    for (const edge of architecture.edges) {
      const route = layout.edges[edge.id];
      for (const [point, node] of [
        [route.points[0], layout.nodes[edge.from]],
        [route.points.at(-1)!, layout.nodes[edge.to]],
      ] as const) {
        expect(point.x === node.x || point.x === node.x + node.width, `${edge.id} at ${node.id}`).toBe(true);
        expect(point.y).toBeGreaterThanOrEqual(node.y + COLUMN.portInset - 0.01);
        expect(point.y).toBeLessThanOrEqual(node.y + node.height - COLUMN.portInset + 0.01);
      }
      // The last run is horizontal, so the arrowhead meets the side squarely.
      const [beforeLast, last] = route.points.slice(-2);
      expect(beforeLast.y).toBe(last.y);
      expect(route.arrives).toBe(last.x === layout.nodes[edge.to].x ? "left" : "right");
    }
  });

  it("never draws a line through a component", () => {
    for (const segment of segments) {
      for (const box of boxes) {
        expect(passesThrough(segment, box), `${segment.edge} through ${box.id}`).toBe(false);
      }
    }
  });

  it("never runs two connections along each other", () => {
    for (let i = 0; i < segments.length; i += 1) {
      for (let j = i + 1; j < segments.length; j += 1) {
        if (segments[i].edge === segments[j].edge) continue;
        expect(sharedLength(segments[i], segments[j]), `${segments[i].edge} and ${segments[j].edge}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  // -- The lines a diagram shows at rest: one drawing per pair of connected layers --

  const columnOf = (nodeId: string) => layout.nodes[nodeId].column;
  const between = architecture.edges.filter((edge) => columnOf(edge.from) !== columnOf(edge.to));
  const linkSegments: Segment[] = layout.links.flatMap((link) =>
    link.strokes.flatMap((stroke) => stroke.points.slice(0, -1).map((a, index) => ({ edge: link.id, a, b: stroke.points[index + 1] }))),
  );

  it("stands every connection between two layers in exactly one line between them", () => {
    expect(layout.links.flatMap((link) => link.edgeIds).sort()).toEqual(between.map((edge) => edge.id).sort());
    const layerAt = layout.groups.map((group) => group.layerId);
    for (const link of layout.links) {
      const left = layerAt.indexOf(link.from);
      const right = layerAt.indexOf(link.to);
      expect(left).toBeLessThan(right);
      expect(link.forward + link.backward).toBe(link.edgeIds.length);
      for (const id of link.edgeIds) {
        const edge = architecture.edges.find((item) => item.id === id)!;
        expect([columnOf(edge.from), columnOf(edge.to)].sort()).toEqual([left, right]);
      }
      // Neighbours are joined through the gutter between them; anything further apart goes over or under.
      expect(link.route === "gutter").toBe(right - left === 1);
    }
    // One per pair, never two.
    expect(new Set(layout.links.map((link) => link.id)).size).toBe(layout.links.length);
  });

  it("joins neighbours by a trunk in their gutter, with a branch to each component that takes part", () => {
    for (const link of layout.links.filter((item) => item.route === "gutter")) {
      const left = layout.groups.find((group) => group.layerId === link.from)!;
      const right = layout.groups.find((group) => group.layerId === link.to)!;
      const edges = link.edgeIds.map((id) => architecture.edges.find((edge) => edge.id === id)!);
      const taking = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
      expect(link.strokes).toHaveLength(taking.size);
      const trunk = left.x + left.width + COLUMN.gutter / 2;
      const reached = new Set<string>();
      for (const stroke of link.strokes) {
        // Every branch starts on the trunk and stays between the two columns' components.
        expect(stroke.points[0].x).toBe(trunk);
        for (const point of stroke.points) {
          expect(point.x).toBeGreaterThanOrEqual(left.x + left.width - COLUMN.padX);
          expect(point.x).toBeLessThanOrEqual(right.x + COLUMN.padX);
        }
        const end = stroke.points.at(-1)!;
        const node = [...taking].map((id) => layout.nodes[id]).find((box) => (end.x === box.x || end.x === box.x + box.width) && end.y === box.y + box.height / 2);
        expect(node, `${link.id}: a branch that ends at no component`).toBeDefined();
        reached.add(node!.id);
        // The last run is horizontal, and it carries an arrowhead exactly when something arrives at that component.
        expect(stroke.points.at(-2)!.y).toBe(end.y);
        expect(stroke.arrowEnd).toBe(edges.some((edge) => edge.to === node!.id));
        expect(stroke.arrowStart).toBe(false);
      }
      expect([...reached].sort()).toEqual([...taking].sort());
    }
  });

  it("joins layers further apart by one line from column to column, clear of everything between", () => {
    for (const link of layout.links.filter((item) => item.route !== "gutter")) {
      expect(link.strokes).toHaveLength(1);
      const [stroke] = link.strokes;
      const left = layout.groups.find((group) => group.layerId === link.from)!;
      const right = layout.groups.find((group) => group.layerId === link.to)!;
      const [start, up, across, end] = stroke.points;
      expect(stroke.points).toHaveLength(4);
      const edgeOf = (group: Box) => (link.route === "over" ? group.y : group.y + group.height);
      // It leaves one column's edge and arrives at the other's, away from their corners.
      expect(start.y).toBe(edgeOf(left));
      expect(end.y).toBe(edgeOf(right));
      for (const [point, group] of [
        [start, left],
        [end, right],
      ] as const) {
        expect(point.x).toBeGreaterThanOrEqual(group.x + COLUMN.linkInset - 0.01);
        expect(point.x).toBeLessThanOrEqual(group.x + group.width - COLUMN.linkInset + 0.01);
      }
      expect(up).toEqual({ x: start.x, y: across.y });
      expect(across.x).toBe(end.x);
      // The run between them is outside every column from the first to the last.
      const spanned = layout.groups.filter((group) => group.x >= left.x && group.x <= right.x);
      for (const group of spanned) {
        if (link.route === "over") expect(up.y).toBeLessThanOrEqual(group.y - COLUMN.linkPad + 0.01);
        else expect(up.y).toBeGreaterThanOrEqual(group.y + group.height + COLUMN.linkPad - 0.01);
      }
      // An arrowhead at each end something arrives at.
      expect(stroke.arrowEnd).toBe(link.forward > 0);
      expect(stroke.arrowStart).toBe(link.backward > 0);
    }
  });

  it("draws those lines in straight runs, through no component, and never one along another", () => {
    for (const segment of linkSegments) {
      expect(segment.a.x === segment.b.x || segment.a.y === segment.b.y, segment.edge).toBe(true);
      for (const box of boxes) expect(passesThrough(segment, box), `${segment.edge} through ${box.id}`).toBe(false);
    }
    // Branches of one trunk share it on purpose; two different lines never share a run.
    for (let i = 0; i < linkSegments.length; i += 1) {
      for (let j = i + 1; j < linkSegments.length; j += 1) {
        if (linkSegments[i].edge === linkSegments[j].edge) continue;
        expect(sharedLength(linkSegments[i], linkSegments[j]), `${linkSegments[i].edge} and ${linkSegments[j].edge}`).toBeLessThanOrEqual(0.5);
      }
    }
    // A line over or under the columns passes through none of them.
    for (const link of layout.links.filter((item) => item.route !== "gutter")) {
      const [, up, across] = link.strokes[0].points;
      for (const group of layout.groups) expect(passesThrough({ edge: link.id, a: up, b: across }, group), `${link.id} through ${group.id}`).toBe(false);
    }
  });

  it("is laid out so that the picture at rest is easy to read", () => {
    // What makes a diagram a tangle is long lines and lines that cross. Both come from the order of the layers:
    // if this fails for a new case study, put the layers that talk to each other next to each other.
    const long = layout.links.filter((link) => link.route !== "gutter");
    expect(long.length, "lines that skip a layer").toBeLessThanOrEqual(5);
    const at = (link: (typeof long)[number]) => [layout.groups.findIndex((group) => group.layerId === link.from), layout.groups.findIndex((group) => group.layerId === link.to)];
    let crossings = 0;
    for (let i = 0; i < long.length; i += 1) {
      for (let j = i + 1; j < long.length; j += 1) {
        if (long[i].route !== long[j].route) continue;
        const [a, b] = at(long[i]);
        const [c, d] = at(long[j]);
        if ((a < c && c < b && b < d) || (c < a && a < d && d < b)) crossings += 1;
      }
    }
    expect(crossings, "long lines that cross on the same side").toBe(0);
    // And as drawn: no run of one long line cuts through a run of another.
    const runs = linkSegments.filter((segment) => long.some((link) => link.id === segment.edge));
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        const [p, q] = [runs[i], runs[j]];
        if (p.edge === q.edge || (p.a.y === p.b.y) === (q.a.y === q.b.y)) continue;
        const [flat, upright] = p.a.y === p.b.y ? [p, q] : [q, p];
        const cuts =
          upright.a.x > Math.min(flat.a.x, flat.b.x) + 0.5 &&
          upright.a.x < Math.max(flat.a.x, flat.b.x) - 0.5 &&
          flat.a.y > Math.min(upright.a.y, upright.b.y) + 0.5 &&
          flat.a.y < Math.max(upright.a.y, upright.b.y) - 0.5;
        expect(cuts, `${p.edge} cuts ${q.edge}`).toBe(false);
      }
    }
  });

  it("keeps everything, labels included, inside the bounds it reports", () => {
    const { x, y, width, height } = layout.bounds;
    for (const point of [...segments.flatMap((segment) => [segment.a, segment.b]), ...linkSegments.flatMap((segment) => [segment.a, segment.b]), ...Object.values(layout.edges).map((edge) => edge.label)]) {
      expect(point.x).toBeGreaterThanOrEqual(x);
      expect(point.x).toBeLessThanOrEqual(x + width);
      expect(point.y).toBeGreaterThanOrEqual(y);
      expect(point.y).toBeLessThanOrEqual(y + height);
    }
    for (const group of layout.groups) expect(group.x + group.width).toBeLessThanOrEqual(x + width);
  });

  it("is the same every time", () => {
    expect(layoutColumns(architecture)).toEqual(layout);
  });
});

describe("the path of a routed line", () => {
  it("is a straight line between two points", () => {
    expect(roundedPath([{ x: 0, y: 5 }, { x: 40, y: 5 }])).toBe("M 0 5 L 40 5");
  });

  it("rounds each corner without leaving the corner's two runs", () => {
    const path = roundedPath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 60, y: 30 }], 6);
    expect(path).toBe("M 0 0 L 14 0 Q 20 0 20 6 L 20 24 Q 20 30 26 30 L 60 30");
  });

  it("shrinks the rounding on a run too short for it", () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 40 }], 8)).toBe("M 0 0 L 2 0 Q 4 0 4 2 L 4 40");
  });
});
