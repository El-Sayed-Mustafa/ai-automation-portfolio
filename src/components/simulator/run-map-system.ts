import type { Architecture, ArchitectureNode } from "@/content/schema";

/** What the run map needs of a system: its layers, and for each component its name, layer and what it is built with. */
export interface RunMapSystem {
  layers: Architecture["layers"];
  nodes: Pick<ArchitectureNode, "id" | "label" | "layer" | "kind" | "technology">[];
}

/** The same, cut down from a whole architecture, so a page sends the browser no more than the map draws. */
export function runMapSystem(architecture: Architecture): RunMapSystem {
  return { layers: architecture.layers, nodes: architecture.nodes.map(({ id, label, layer, kind, technology }) => ({ id, label, layer, kind, technology })) };
}
