import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUp } from "lucide-react";
import type { ColumnLayout, LayerLink } from "@/content/architecture-columns";
import type { Architecture } from "@/content/schema";
import { NodeTile } from "@/components/ui/TechIcon";
import { layerTone } from "./NodeDetails";

/**
 * The architecture for a narrow screen: the same layers, in the same order,
 * stacked top to bottom instead of side by side.
 *
 * A row of columns does not fit a phone at a size anyone can read, and a
 * canvas to drag around is a poor way to read a system with a thumb. Here a
 * layer is a band, its components are cards in it, an arrow joins a layer to
 * the next one when they are connected, and a layer says in a line which
 * other layers it talks to. Nothing is added or left out: it is drawn from
 * the same layout as the diagram.
 *
 * With `onSelect` the cards are buttons that open a component's details.
 * Without it the stack is a still picture.
 */
export function LayerStack({
  architecture,
  layout,
  selectedId = null,
  emphasised = null,
  hops = {},
  onSelect,
}: {
  architecture: Architecture;
  layout: ColumnLayout;
  selectedId?: string | null;
  /** When set, only these components are at full strength; the rest step back. */
  emphasised?: ReadonlySet<string> | null;
  /** The numbers of the hops of a followed request that arrive at a component. */
  hops?: Readonly<Record<string, readonly number[]>>;
  onSelect?(id: string): void;
}) {
  const nodeById = new Map(architecture.nodes.map((node) => [node.id, node]));
  const labelOf = new Map(layout.groups.map((group) => [group.layerId, group.label]));
  const order = layout.groups.map((group) => group.layerId);
  const between = (upper: string, lower: string) => layout.links.find((link) => link.route === "gutter" && link.from === upper && link.to === lower);
  const further = (layer: string) => layout.links.filter((link) => link.route !== "gutter" && (link.from === layer || link.to === layer));

  return (
    <ol data-layer-stack className="flex flex-col">
      {layout.groups.map((group, index) => {
        const tone = layerTone(architecture, group.layerId);
        const next = order[index + 1];
        const joined = next ? between(group.layerId, next) : undefined;
        const others = further(group.layerId);
        return (
          <li key={group.id} className="flex flex-col">
            <section data-tone={tone} aria-label={group.label} className="rounded-2xl border border-tone-vivid/25 bg-tone-soft p-2.5">
              <h4 className="px-1 pb-2 text-center text-[0.8125rem] font-bold text-tone">{group.label}</h4>
              <ul className="grid grid-cols-2 gap-2">
                {group.nodeIds.map((id, place) => {
                  const node = nodeById.get(id)!;
                  const active = id === selectedId;
                  const inactive = node.status !== "active";
                  const dimmed = emphasised !== null && !emphasised.has(id);
                  const arriving = hops[id] ?? [];
                  const shape =
                    "relative flex h-full min-h-14 w-full items-center gap-2 rounded-xl border bg-surface px-2 py-1.5 text-left shadow-sm " +
                    (active ? "border-tone-vivid ring-2 ring-tone-vivid" : inactive ? "border-dashed border-line-strong" : "border-line");
                  const inside = (
                    <>
                      <NodeTile node={node} size={30} active={active} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[0.8125rem] font-bold leading-[1.2] text-fg">{node.label}</span>{" "}
                        <span className="block truncate text-[0.6875rem] leading-tight text-muted">{node.technology}</span>
                      </span>{" "}
                      {inactive ? <span className="absolute -top-2 right-2 rounded-full border border-line-strong bg-surface px-1.5 text-[9px] font-bold uppercase leading-4 tracking-wide text-muted">{node.status}</span> : null}
                      {arriving.length > 0 ? (
                        <span aria-hidden className="absolute -left-1.5 -top-1.5 flex gap-0.5">
                          {arriving.map((hop) => (
                            <span key={hop} className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.6875rem] font-bold text-accent-fg">
                              {hop}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </>
                  );
                  // A lone last card takes the whole row, so a band never ends in half a row of nothing.
                  const wide = group.nodeIds.length % 2 === 1 && place === group.nodeIds.length - 1;
                  return (
                    <li key={id} data-dimmed={dimmed || undefined} className={(wide ? "col-span-2 " : "") + "transition-opacity duration-200 " + (dimmed ? "opacity-30" : "")}>
                      {onSelect ? (
                        <button type="button" onClick={() => onSelect(id)} aria-pressed={active} aria-label={`${node.label}: ${node.technology}${inactive ? `, ${node.status}` : ""}`} className={shape}>
                          {inside}
                        </button>
                      ) : (
                        <div className={shape}>{inside}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {others.length > 0 ? (
                <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-1 text-[0.6875rem] font-semibold text-muted">
                  <span className="sr-only">Also connected to </span>
                  {others.map((link) => (
                    <FurtherLink key={link.id} link={link} layer={group.layerId} label={labelOf.get(link.from === group.layerId ? link.to : link.from) ?? ""} tone={layerTone(architecture, link.from === group.layerId ? link.to : link.from)} />
                  ))}
                </p>
              ) : null}
            </section>
            {next ? <Joint link={joined} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** A layer further away that this one is connected to: which way, and its name in its own colour. */
function FurtherLink({ link, layer, label, tone }: { link: LayerLink; layer: string; label: string; tone: string }) {
  const sends = link.from === layer ? link.forward > 0 : link.backward > 0;
  const receives = link.from === layer ? link.backward > 0 : link.forward > 0;
  const words = sends && receives ? "to and from" : sends ? "to" : "from";
  return (
    <span data-tone={tone} className="inline-flex items-center gap-1">
      {sends && receives ? <ArrowLeftRight size={11} aria-hidden className="text-accent" /> : <ArrowRight size={11} aria-hidden className={"text-accent " + (sends ? "" : "rotate-180")} />}
      <span className="sr-only">{words} </span>
      <span className="text-tone">{label}</span>
    </span>
  );
}

/** What joins a layer to the one under it: an arrow each way something travels, or only a gap when nothing does. */
function Joint({ link }: { link: LayerLink | undefined }) {
  if (!link) return <div aria-hidden className="h-3" />;
  const down = link.forward > 0;
  const up = link.backward > 0;
  const faint = link.strokes.every((stroke) => stroke.kind === "disabled");
  return (
    <div aria-hidden className={"flex h-7 items-center justify-center gap-1 text-accent " + (faint ? "opacity-40" : "")}>
      {down ? <ArrowDown size={18} strokeWidth={2.5} /> : null}
      {up ? <ArrowUp size={18} strokeWidth={2.5} /> : null}
    </div>
  );
}
