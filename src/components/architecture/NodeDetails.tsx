import { Archive, Cloud, Cog, Database, HardDrive, Inbox, Monitor, Server, User, type LucideIcon } from "lucide-react";
import { TONE_CYCLE } from "@/components/ui/Icon";
import type { Architecture, NodeKind, Tone } from "@/content/schema";

/** One icon per kind of component, shared by every view of an architecture. */
export const NODE_KIND_ICON: Record<NodeKind, LucideIcon> = {
  frontend: Monitor,
  backend: Server,
  database: Database,
  queue: Inbox,
  worker: Cog,
  external: Cloud,
  storage: HardDrive,
  legacy: Archive,
  actor: User,
};

/** Each layer of an architecture gets its own colour, in the order the layers are listed. */
export function layerTone(architecture: Pick<Architecture, "layers">, layerId: string): Tone {
  const index = Math.max(0, architecture.layers.findIndex((layer) => layer.id === layerId));
  return TONE_CYCLE[index % TONE_CYCLE.length];
}
