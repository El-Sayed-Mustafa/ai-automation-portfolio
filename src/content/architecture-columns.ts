import type { Architecture } from "./schema";

/**
 * Lays an architecture out as columns, one per layer, and routes every
 * connection around the components instead of through them.
 *
 * A manifest says which layer a component is in and what it connects to. It
 * does not say where anything is drawn: that is worked out here, so every
 * project gets the same tidy diagram and a new component needs no coordinates.
 *
 * A column is as tall as its own components and sits in the middle of the
 * tallest one, so a layer with two components is a short box and not a long
 * empty one. Components still stand on one grid of rows shared by every
 * column, which is what lets the lines between them stay straight.
 *
 * How a connection is routed:
 *   - it leaves and enters a component through its left or right side only;
 *   - between two neighbouring columns it runs through the gutter between them;
 *   - across more than one column it goes over the top or under the bottom of
 *     the groups, in a channel that no component occupies;
 *   - inside a gutter or a channel every connection has a lane of its own.
 * Lines may cross each other at right angles. They never run along each other
 * and never pass through a component. A test checks both for every project.
 *
 * Drawn all at once, those lines are exact and hard to read: a system with
 * twenty connections fills every gutter. So the layout also works out a
 * second, quieter set of lines, one per pair of connected layers (`links`):
 *   - two neighbouring layers are joined through the gutter between them, by
 *     one trunk that the components on each side branch off;
 *   - two layers further apart are joined by one line over or under the
 *     columns between them, from column to column.
 * That is what a diagram shows at rest. The exact line of a single connection
 * is drawn when someone asks for it.
 */
export const COLUMN = {
  nodeWidth: 176,
  nodeHeight: 62,
  rowGap: 14,
  /** Space inside a group, around its components. The top holds the group's name. */
  padX: 8,
  padTop: 38,
  padBottom: 14,
  /** Space between two groups, where vertical runs go. */
  gutter: 46,
  gutterPad: 9,
  /** Distance between two parallel lines. */
  lane: 8,
  /** Distance from the groups to the first channel above or below them. */
  channelPad: 16,
  /** Room kept free at each end of a component's side, so a line never enters at a corner. */
  portInset: 10,
  /** Distance from the columns to the nearest line that joins two layers over or under them, and between two such lines. */
  linkPad: 20,
  linkLane: 14,
  /** Distance between two such lines where they meet the same edge of a column, and the room kept free at its corners. */
  linkStep: 30,
  linkInset: 26,
} as const;

/** How a connection behaves, which is how its line is drawn. */
export type LineKind = Architecture["edges"][number]["kind"];

/** When one line stands for several connections it takes the style of the most definite of them. */
const KIND_ORDER: LineKind[] = ["sync", "async", "fallback", "disabled"];

function strongest(kinds: LineKind[]): LineKind {
  return KIND_ORDER.find((kind) => kinds.includes(kind)) ?? "sync";
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedNode extends Box {
  id: string;
  column: number;
  row: number;
}

export interface PlacedGroup extends Box {
  id: string;
  layerId: string;
  label: string;
  nodeIds: string[];
}

export interface RoutedEdge {
  id: string;
  /** Corners of the line, from the source's side to the target's side. Every segment is horizontal or vertical. */
  points: Point[];
  /** Where a label for this connection sits: the middle of its longest segment. */
  label: Point;
  /** The side of the target the line arrives at, which is the way the arrowhead points. */
  arrives: "left" | "right";
}

/** One drawn piece of a link: a run of horizontal and vertical segments, with an arrowhead where a connection arrives. */
export interface LinkStroke {
  points: Point[];
  arrowStart: boolean;
  arrowEnd: boolean;
  kind: LineKind;
}

/** Everything that joins two layers, drawn as one. `from` is the layer on the left. */
export interface LayerLink {
  id: string;
  from: string;
  to: string;
  /** Through the gutter between two neighbours, or over or under the columns between two layers further apart. */
  route: "gutter" | "over" | "under";
  /** The connections it stands for, and how many of them run each way. */
  edgeIds: string[];
  forward: number;
  backward: number;
  strokes: LinkStroke[];
}

export interface ColumnLayout {
  bounds: Box;
  groups: PlacedGroup[];
  nodes: Record<string, PlacedNode>;
  edges: Record<string, RoutedEdge>;
  links: LayerLink[];
}

type Side = "left" | "right";

interface Plan {
  id: string;
  from: string;
  to: string;
  sourceSide: Side;
  targetSide: Side;
  /** Index of the gutter the line leaves into, and the one it arrives from. Gutter g lies to the right of column g. */
  sourceGutter: number;
  targetGutter: number;
  /** Set when the line has to cross a column: which channel carries it. */
  channel: "top" | "bottom" | null;
}

interface Interval {
  start: number;
  end: number;
}

/** Gives each interval the lowest lane in which it overlaps nothing already there. */
function assignLanes<T extends Interval>(items: T[], gap: number, order: (a: T, b: T) => number): Map<T, number> {
  const lanes: Interval[][] = [];
  const result = new Map<T, number>();
  for (const item of [...items].sort(order)) {
    let lane = lanes.findIndex((taken) => taken.every((other) => item.end + gap <= other.start || other.end + gap <= item.start));
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push(item);
    result.set(item, lane);
  }
  return result;
}

function spread(count: number, index: number, step: number): number {
  return (index - (count - 1) / 2) * step;
}

/**
 * Orders the components of each column so that connected ones sit at similar
 * heights. A few sweeps of the usual average-of-neighbours rule; it is not
 * optimal, but it removes most of the long vertical runs.
 */
function orderRows(columns: string[][], neighbours: Map<string, string[]>): string[][] {
  let current = columns.map((column) => [...column]);
  const rowOf = () => {
    const rows = new Map<string, number>();
    for (const column of current) column.forEach((id, row) => rows.set(id, row));
    return rows;
  };
  const columnOf = new Map<string, number>();
  columns.forEach((column, index) => column.forEach((id) => columnOf.set(id, index)));

  for (let sweep = 0; sweep < 4; sweep += 1) {
    const forward = sweep % 2 === 0;
    const indices = current.map((_, index) => index);
    for (const index of forward ? indices : indices.reverse()) {
      const rows = rowOf();
      const weight = (id: string, fallback: number): number => {
        const seen = (neighbours.get(id) ?? []).filter((other) => (forward ? columnOf.get(other)! < index : columnOf.get(other)! > index));
        if (seen.length === 0) return fallback;
        return seen.reduce((sum, other) => sum + rows.get(other)!, 0) / seen.length;
      };
      const weighted = current[index].map((id, row) => ({ id, row, weight: weight(id, row) }));
      weighted.sort((a, b) => a.weight - b.weight || a.row - b.row);
      current = current.map((column, i) => (i === index ? weighted.map((item) => item.id) : column));
    }
  }
  return current;
}

export function layoutColumns(architecture: Pick<Architecture, "layers" | "nodes" | "edges">): ColumnLayout {
  const C = COLUMN;
  const groupWidth = C.nodeWidth + C.padX * 2;
  const pitch = groupWidth + C.gutter;

  const layers = architecture.layers.filter((layer) => architecture.nodes.some((node) => node.layer === layer.id));
  const known = new Set(architecture.nodes.map((node) => node.id));
  const neighbours = new Map<string, string[]>();
  for (const edge of architecture.edges) {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) continue;
    neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]);
    neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]);
  }
  const ordered = orderRows(
    layers.map((layer) => architecture.nodes.filter((node) => node.layer === layer.id).map((node) => node.id)),
    neighbours,
  );

  const rows = Math.max(1, ...ordered.map((column) => column.length));
  const rowPitch = C.nodeHeight + C.rowGap;
  const stackHeight = (count: number) => C.padTop + count * C.nodeHeight + (count - 1) * C.rowGap + C.padBottom;
  /** The height of the tallest column. The channels above and below the groups are measured from it. */
  const groupHeight = stackHeight(rows);

  const nodes: Record<string, PlacedNode> = {};
  const groups: PlacedGroup[] = layers.map((layer, column) => {
    const count = ordered[column].length;
    // Whole rows only: a column that started half a row down would put its sides out of step with its neighbours'.
    const firstRow = Math.floor((rows - count) / 2);
    ordered[column].forEach((id, index) => {
      const row = firstRow + index;
      nodes[id] = { id, column, row, x: column * pitch + C.padX, y: C.padTop + row * rowPitch, width: C.nodeWidth, height: C.nodeHeight };
    });
    return { id: `group-${layer.id}`, layerId: layer.id, label: layer.label, x: column * pitch, y: firstRow * rowPitch, width: groupWidth, height: stackHeight(count), nodeIds: ordered[column] };
  });

  const centre = (id: string) => nodes[id].y + C.nodeHeight / 2;

  // -- 1. Which sides, gutters and channel each connection uses --------------
  const plans: Plan[] = [];
  for (const edge of architecture.edges) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    if (!from || !to || edge.from === edge.to) continue;
    const forward = to.column > from.column;
    const same = to.column === from.column;
    const sourceSide: Side = same || forward ? "right" : "left";
    const targetSide: Side = same ? "right" : forward ? "left" : "right";
    const sourceGutter = sourceSide === "right" ? from.column : from.column - 1;
    const targetGutter = targetSide === "right" ? to.column : to.column - 1;
    const far = sourceGutter !== targetGutter;
    plans.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      sourceSide,
      targetSide,
      sourceGutter,
      targetGutter,
      channel: far ? ((centre(edge.from) + centre(edge.to)) / 2 <= groupHeight / 2 ? "top" : "bottom") : null,
    });
  }

  // -- 2. Where on a side each connection attaches ---------------------------
  // The two sides that face one gutter at one row share a band of slots, so a
  // line leaving one component and a line entering the one opposite never sit
  // at the same height. A connection straight across takes a single slot.
  interface Slot {
    edge: string;
    key: number;
  }
  const bands = new Map<string, Slot[]>();
  const band = (gutter: number, row: number) => {
    const id = `${gutter}:${row}`;
    if (!bands.has(id)) bands.set(id, []);
    return bands.get(id)!;
  };
  const towards = (plan: Plan, other: string) => (plan.channel === "top" ? -1e6 : plan.channel === "bottom" ? 1e6 : centre(other));
  for (const plan of plans) {
    const from = nodes[plan.from];
    const to = nodes[plan.to];
    const straight = !plan.channel && from.row === to.row && from.column !== to.column;
    band(plan.sourceGutter, from.row).push({ edge: plan.id, key: towards(plan, plan.to) });
    if (!straight) band(plan.targetGutter, to.row).push({ edge: plan.id, key: towards(plan, plan.from) });
  }
  const portY = new Map<string, number>();
  for (const [id, slots] of bands) {
    const row = Number(id.split(":")[1]);
    const middle = C.padTop + row * (C.nodeHeight + C.rowGap) + C.nodeHeight / 2;
    const step = slots.length > 1 ? Math.min(C.lane, (C.nodeHeight - C.portInset * 2) / (slots.length - 1)) : 0;
    slots.sort((a, b) => a.key - b.key || a.edge.localeCompare(b.edge));
    slots.forEach((slot, index) => portY.set(`${id}:${slot.edge}`, middle + spread(slots.length, index, step)));
  }
  const sourceY = (plan: Plan) => portY.get(`${plan.sourceGutter}:${nodes[plan.from].row}:${plan.id}`)!;
  const targetY = (plan: Plan) => portY.get(`${plan.targetGutter}:${nodes[plan.to].row}:${plan.id}`) ?? sourceY(plan);

  // -- 3. A run above or below the groups for every crossing ----------------
  // A crossing only has to clear the columns it passes over, so it stays close
  // to them: over two short columns it does not climb as high as the tallest
  // one in the diagram. It is then moved outwards, a lane at a time, until it
  // runs along nothing: neither another crossing nor the short piece of line
  // that joins a component to its gutter.
  //
  // This is decided before the lanes inside the gutters are, so it measures a
  // gutter at its full width: wider than any line in it will turn out to be.
  interface Stretch extends Interval {
    y: number;
  }
  const gutterLeft = (gutter: number) => gutter * pitch + groupWidth;
  const gutterRight = (gutter: number) => (gutter + 1) * pitch;
  const stubs: Stretch[] = [];
  for (const plan of plans) {
    stubs.push({ y: sourceY(plan), start: gutterLeft(plan.sourceGutter), end: gutterRight(plan.sourceGutter) });
    stubs.push({ y: targetY(plan), start: gutterLeft(plan.targetGutter), end: gutterRight(plan.targetGutter) });
  }

  interface Crossing extends Interval {
    plan: Plan;
    /** The nearest the run may come to the groups it passes over. */
    base: number;
  }
  const channelY = new Map<string, number>();
  for (const side of ["top", "bottom"] as const) {
    const outwards = side === "top" ? -C.lane : C.lane;
    const crossings: Crossing[] = plans
      .filter((plan) => plan.channel === side)
      .map((plan) => {
        const first = Math.min(plan.sourceGutter, plan.targetGutter);
        const last = Math.max(plan.sourceGutter, plan.targetGutter);
        // Gutter g lies to the right of column g, so these are the columns between the two gutters.
        const passed = groups.slice(first + 1, last + 1);
        const base = side === "top" ? Math.min(...passed.map((group) => group.y)) - C.channelPad : Math.max(...passed.map((group) => group.y + group.height)) + C.channelPad;
        return { plan, start: gutterLeft(first), end: gutterRight(last), base };
      })
      // Short crossings are placed first, so they stay closest to the groups; long ones go further out.
      .sort((p, q) => p.end - p.start - (q.end - q.start) || p.start - q.start || p.plan.id.localeCompare(q.plan.id));
    const placed: Stretch[] = [];
    const meets = (crossing: Crossing, other: Stretch) => crossing.start < other.end && other.start < crossing.end;
    for (const crossing of crossings) {
      let y = crossing.base;
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const taken = [...placed, ...stubs].some((other) => meets(crossing, other) && Math.abs(other.y - y) < C.lane - 0.01);
        if (!taken) break;
        y += outwards;
      }
      placed.push({ y, start: crossing.start, end: crossing.end });
      channelY.set(crossing.plan.id, y);
    }
  }

  // -- 4. A lane in each gutter for every vertical run ----------------------
  interface Run extends Interval {
    plan: Plan;
    gutter: number;
  }
  const runs: Run[] = [];
  for (const plan of plans) {
    const ys = sourceY(plan);
    const yt = targetY(plan);
    const cy = channelY.get(plan.id);
    if (cy !== undefined) {
      runs.push({ plan, gutter: plan.sourceGutter, start: Math.min(ys, cy), end: Math.max(ys, cy) });
      runs.push({ plan, gutter: plan.targetGutter, start: Math.min(yt, cy), end: Math.max(yt, cy) });
    } else if (ys !== yt) {
      runs.push({ plan, gutter: plan.sourceGutter, start: Math.min(ys, yt), end: Math.max(ys, yt) });
    }
  }
  const laneX = new Map<string, number>();
  for (const gutter of new Set(runs.map((run) => run.gutter))) {
    const inGutter = runs.filter((run) => run.gutter === gutter);
    const lanes = assignLanes(inGutter, C.lane, (a, b) => a.start - b.start || a.end - b.end || a.plan.id.localeCompare(b.plan.id));
    const count = Math.max(...lanes.values()) + 1;
    const step = count > 1 ? Math.min(C.lane, (C.gutter - C.gutterPad * 2) / (count - 1)) : 0;
    const middle = gutter * pitch + groupWidth + C.gutter / 2;
    for (const [run, lane] of lanes) laneX.set(`${gutter}:${run.plan.id}`, middle + spread(count, lane, step));
  }

  // -- 5. The corners of each line -------------------------------------------
  const edges: Record<string, RoutedEdge> = {};
  for (const plan of plans) {
    const from = nodes[plan.from];
    const to = nodes[plan.to];
    const sx = plan.sourceSide === "right" ? from.x + from.width : from.x;
    const tx = plan.targetSide === "right" ? to.x + to.width : to.x;
    const ys = sourceY(plan);
    const yt = targetY(plan);
    let points: Point[];
    if (plan.channel) {
      const x1 = laneX.get(`${plan.sourceGutter}:${plan.id}`)!;
      const x2 = laneX.get(`${plan.targetGutter}:${plan.id}`)!;
      const cy = channelY.get(plan.id)!;
      points = [
        { x: sx, y: ys },
        { x: x1, y: ys },
        { x: x1, y: cy },
        { x: x2, y: cy },
        { x: x2, y: yt },
        { x: tx, y: yt },
      ];
    } else if (ys === yt) {
      points = [
        { x: sx, y: ys },
        { x: tx, y: yt },
      ];
    } else {
      const x = laneX.get(`${plan.sourceGutter}:${plan.id}`)!;
      points = [
        { x: sx, y: ys },
        { x, y: ys },
        { x, y: yt },
        { x: tx, y: yt },
      ];
    }
    let label = points[0];
    let longest = -1;
    for (let i = 0; i < points.length - 1; i += 1) {
      const length = Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
      if (length > longest) {
        longest = length;
        label = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      }
    }
    edges[plan.id] = { id: plan.id, points, label, arrives: plan.targetSide };
  }

  // -- 6. One line for each pair of connected layers --------------------------
  const links = linkLayers(architecture, groups, nodes);

  // -- 7. The rectangle everything fits in -----------------------------------
  const drawn = [...Object.values(edges).flatMap((edge) => edge.points), ...links.flatMap((link) => link.strokes.flatMap((stroke) => stroke.points))];
  const xs = [0, groups.length * pitch - C.gutter, ...drawn.map((point) => point.x)];
  const ys = [0, groupHeight, ...drawn.map((point) => point.y)];
  const margin = 12;
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  return {
    bounds: { x: minX, y: minY, width: Math.max(...xs) + margin - minX, height: Math.max(...ys) + margin - minY },
    groups,
    nodes,
    edges,
    links,
  };
}

interface Pair {
  left: number;
  right: number;
  edges: Architecture["edges"];
}

/**
 * Joins each pair of connected layers with one drawing.
 *
 * Neighbours share a trunk in the gutter between them. Every component that
 * takes part has a branch to it, and a branch ends in an arrowhead where a
 * connection arrives. The trunk shows that the two layers talk and which
 * components do the talking; which of them talks to which is the business of
 * the exact lines.
 *
 * Layers further apart get one line from the edge of one column to the edge
 * of the other, over or under whatever stands between. Which of the two is
 * chosen for all of them together, so that as few of them cross as can be.
 */
function linkLayers(architecture: Pick<Architecture, "nodes" | "edges">, groups: PlacedGroup[], nodes: Record<string, PlacedNode>): LayerLink[] {
  const C = COLUMN;
  const pairs = new Map<string, Pair>();
  for (const edge of architecture.edges) {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    if (!from || !to || from.column === to.column) continue;
    const left = Math.min(from.column, to.column);
    const right = Math.max(from.column, to.column);
    const key = `${left}:${right}`;
    if (!pairs.has(key)) pairs.set(key, { left, right, edges: [] });
    pairs.get(key)!.edges.push(edge);
  }
  const ordered = [...pairs.values()].sort((p, q) => p.left - q.left || p.right - q.right);
  const describe = (pair: Pair, route: LayerLink["route"], strokes: LinkStroke[]): LayerLink => ({
    id: `link-${groups[pair.left].layerId}-${groups[pair.right].layerId}`,
    from: groups[pair.left].layerId,
    to: groups[pair.right].layerId,
    route,
    edgeIds: pair.edges.map((edge) => edge.id),
    forward: pair.edges.filter((edge) => nodes[edge.from].column === pair.left).length,
    backward: pair.edges.filter((edge) => nodes[edge.from].column === pair.right).length,
    strokes,
  });

  const links: LayerLink[] = [];

  // Neighbours: a trunk in the gutter, with a branch to each component that takes part.
  for (const pair of ordered.filter((item) => item.right - item.left === 1)) {
    const trunk = groups[pair.left].x + groups[pair.left].width + C.gutter / 2;
    const taking = new Map<string, { kinds: LineKind[]; receives: boolean }>();
    for (const edge of pair.edges) {
      for (const id of [edge.from, edge.to]) {
        const entry = taking.get(id) ?? { kinds: [], receives: false };
        entry.kinds.push(edge.kind);
        if (id === edge.to) entry.receives = true;
        taking.set(id, entry);
      }
    }
    const branches = [...taking].map(([id, entry]) => {
      const node = nodes[id];
      const onLeft = node.column === pair.left;
      return { id, onLeft, x: onLeft ? node.x + node.width : node.x, y: node.y + node.height / 2, kind: strongest(entry.kinds), receives: entry.receives };
    });
    // The branches meet at the height of the one nearest the middle of them all, so that one runs straight
    // across and the others turn towards it. Components stand on a shared grid of rows, so two branches are
    // either level or a whole row apart: a turn is never too tight to draw.
    const mean = branches.reduce((sum, branch) => sum + branch.y, 0) / branches.length;
    const meet = [...branches].sort((p, q) => Math.abs(p.y - mean) - Math.abs(q.y - mean) || p.y - q.y || p.id.localeCompare(q.id))[0].y;
    const strokes = branches
      .sort((p, q) => Number(q.onLeft) - Number(p.onLeft) || p.y - q.y || p.id.localeCompare(q.id))
      .map((branch): LinkStroke => {
        // Every branch is drawn from the meeting point outwards, so two dashed ones keep step where they share the trunk.
        const points: Point[] = branch.y === meet ? [{ x: trunk, y: meet }, { x: branch.x, y: branch.y }] : [{ x: trunk, y: meet }, { x: trunk, y: branch.y }, { x: branch.x, y: branch.y }];
        return { points, arrowStart: false, arrowEnd: branch.receives, kind: branch.kind };
      });
    links.push(describe(pair, "gutter", strokes));
  }

  // Further apart: one line each, over or under the columns between.
  const far = ordered.filter((item) => item.right - item.left > 1);
  if (far.length > 0) {
    const overlap = (p: Pair, q: Pair) => Math.max(p.left, q.left) < Math.min(p.right, q.right);
    const cross = (p: Pair, q: Pair) => (p.left < q.left && q.left < p.right && p.right < q.right) || (q.left < p.left && p.left < q.right && q.right < p.right);
    /** How many lines are stacked at the busiest place on one side. */
    const depth = (side: Pair[]) => {
      let most = 0;
      for (let column = 0; column < groups.length - 1; column += 1) most = Math.max(most, side.filter((pair) => pair.left <= column && column < pair.right).length);
      return most;
    };
    // Every way of sending each line over or under, for as many lines as a diagram ever has. Fewest crossings
    // first, then the shallowest stacks, then as many as possible over the top, where a reader looks first.
    const count = Math.min(far.length, 12);
    let best = { cost: Infinity, mask: 0 };
    for (let mask = 0; mask < 1 << count; mask += 1) {
      const under = (index: number) => index < count && ((mask >> index) & 1) === 1;
      let crossings = 0;
      for (let i = 0; i < far.length; i += 1) for (let j = i + 1; j < far.length; j += 1) if (under(i) === under(j) && cross(far[i], far[j])) crossings += 1;
      const top = far.filter((_, index) => !under(index));
      const bottom = far.filter((_, index) => under(index));
      const cost = crossings * 10000 + (depth(top) + depth(bottom)) * 100 + Math.max(depth(top), depth(bottom)) * 10 + bottom.length;
      if (cost < best.cost) best = { cost, mask };
    }
    const routeOf = (index: number): "over" | "under" => (index < count && ((best.mask >> index) & 1) === 1 ? "under" : "over");

    for (const side of ["over", "under"] as const) {
      const outwards = side === "over" ? -1 : 1;
      const mine = far.filter((_, index) => routeOf(index) === side);
      const edgeOf = (group: PlacedGroup) => (side === "over" ? group.y : group.y + group.height);

      // How far out each line runs. It clears the columns it spans, and any line it shares a stretch with.
      // Short ones are placed first, so they stay nearest the columns and long ones go round them.
      const level = new Map<Pair, number>();
      for (const pair of [...mine].sort((p, q) => p.right - p.left - (q.right - q.left) || p.left - q.left)) {
        const spanned = groups.slice(pair.left, pair.right + 1).map(edgeOf);
        let y = (side === "over" ? Math.min(...spanned) : Math.max(...spanned)) + outwards * C.linkPad;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const taken = [...level].some(([other, at]) => overlap(pair, other) && Math.abs(at - y) < C.linkLane - 0.01);
          if (!taken) break;
          y += outwards * C.linkLane;
        }
        level.set(pair, y);
      }

      // Where each line meets the edge of a column. Lines that leave to the left come first, the one that
      // travels furthest out nearest the middle; then the ones that leave to the right, furthest out first.
      // In that order no line has to cross another that leaves from the same column.
      const meetX = new Map<string, number>();
      groups.forEach((group, column) => {
        const out = (pair: Pair) => Math.abs(level.get(pair)! - edgeOf(group));
        const leftwards = mine.filter((pair) => pair.right === column).sort((p, q) => out(p) - out(q) || q.left - p.left);
        const rightwards = mine.filter((pair) => pair.left === column).sort((p, q) => out(q) - out(p) || q.right - p.right);
        const here = [...leftwards, ...rightwards];
        const step = here.length > 1 ? Math.min(C.linkStep, (group.width - C.linkInset * 2) / (here.length - 1)) : 0;
        here.forEach((pair, index) => meetX.set(`${column}:${pair.left}:${pair.right}`, group.x + group.width / 2 + spread(here.length, index, step)));
      });

      for (const pair of mine) {
        const y = level.get(pair)!;
        const x1 = meetX.get(`${pair.left}:${pair.left}:${pair.right}`)!;
        const x2 = meetX.get(`${pair.right}:${pair.left}:${pair.right}`)!;
        const forward = pair.edges.some((edge) => nodes[edge.from].column === pair.left);
        const backward = pair.edges.some((edge) => nodes[edge.from].column === pair.right);
        links.push(
          describe(pair, side, [
            {
              points: [
                { x: x1, y: edgeOf(groups[pair.left]) },
                { x: x1, y },
                { x: x2, y },
                { x: x2, y: edgeOf(groups[pair.right]) },
              ],
              arrowStart: backward,
              arrowEnd: forward,
              kind: strongest(pair.edges.map((edge) => edge.kind)),
            },
          ]),
        );
      }
    }
  }

  return links.sort((p, q) => p.id.localeCompare(q.id));
}

/** An SVG path through the corners of a routed line, with the corners rounded. */
export function roundedPath(points: Point[], radius = 7): string {
  if (points.length === 0) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const corner = points[i];
    const next = points[i + 1];
    if (!next) {
      path += ` L ${corner.x} ${corner.y}`;
      break;
    }
    const before = points[i - 1];
    const r = Math.min(radius, Math.hypot(corner.x - before.x, corner.y - before.y) / 2, Math.hypot(next.x - corner.x, next.y - corner.y) / 2);
    const entry = { x: corner.x - Math.sign(corner.x - before.x) * r, y: corner.y - Math.sign(corner.y - before.y) * r };
    const exit = { x: corner.x + Math.sign(next.x - corner.x) * r, y: corner.y + Math.sign(next.y - corner.y) * r };
    path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  return path;
}
