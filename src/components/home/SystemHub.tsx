"use client";

import { Pause, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NodeTile } from "@/components/ui/TechIcon";
import type { ArchitectureNode, Tone } from "@/content/schema";

type TileNode = Pick<ArchitectureNode, "kind" | "label" | "technology">;

/** A layer drawn as one card: top, middle or bottom of the picture. */
export interface HubLayer {
  id: string;
  tone: Tone;
  title: string;
  text: string;
  node: TileNode;
}

/** A layer drawn as a stack of its components, on one side of the picture. */
export interface HubSide {
  tone: Tone;
  title: string;
  items: { id: string; label: string; node: TileNode }[];
}

/** One hop of a real request, between two parts of the picture. `label` names the two components it really joins. */
export interface HubHop {
  from: string;
  to: string;
  label: string;
}

export interface HubRoute {
  id: string;
  label: string;
  hops: HubHop[];
}

/** Where the side components sit, top to bottom, as a share of the picture's height. */
const SIDE_Y = [26, 50, 74];
/** The picture's proportions. The lines are drawn in these units, so they scale with it and never stretch. */
const VIEW = { width: 640, height: 430 };
/** How long one hop is shown, and how long the picture rests between two requests. */
const HOP_MS = 1500;
const REST_MS = 1300;

function LayerCard({ layer, lit, order, strong = false }: { layer: HubLayer; lit: string; order: number; strong?: boolean }) {
  return (
    <div
      data-tone={layer.tone}
      data-lit={lit}
      style={{ "--i": order } as React.CSSProperties}
      className={"hub-card flex h-full items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3 shadow-lg " + (strong ? "border-tone-vivid/50" : "border-line")}
    >
      <NodeTile node={layer.node} size={44} />
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-bold leading-tight">{layer.title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{layer.text}</p>
      </div>
    </div>
  );
}

/**
 * The picture beside the headline: the first case study as a hub, with a
 * request moving through it.
 *
 * Everything in it is taken from the case study: its layers, its components,
 * and the routes that play, which are the requests traced in its diagram. A
 * hop lights the two parts it joins and dims the rest. It is an animation of
 * recorded routes, not a view of a running system, and the line under it says
 * which route is playing.
 *
 * It plays only while it is on screen, stops for a visitor who asked for
 * less motion, and can be paused.
 */
export function SystemHub({
  title,
  href,
  components,
  connections,
  top,
  centre,
  bottom,
  right,
  left,
  routes,
}: {
  title: string;
  href: string;
  components: number;
  connections: number;
  top?: HubLayer;
  centre?: HubLayer;
  bottom?: HubLayer;
  right?: HubSide;
  left?: HubSide;
  routes: HubRoute[];
}) {
  const root = useRef<HTMLDivElement>(null);
  // Off until the page has mounted, so the server's picture and the first client one are the same.
  const [allowed, setAllowed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [step, setStep] = useState({ route: 0, hop: -1 });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAllowed(!media.matches);
    sync();
    media.addEventListener("change", sync);
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.35 });
    if (root.current) observer.observe(root.current);
    return () => {
      media.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, []);

  const playing = allowed && !paused && onScreen && routes.length > 0;

  useEffect(() => {
    if (!playing) return;
    const resting = step.hop < 0;
    const timer = window.setTimeout(
      () => {
        setStep((current) => {
          const hops = routes[current.route].hops.length;
          if (current.hop + 1 < hops) return { route: current.route, hop: current.hop + 1 };
          // The request has arrived: rest, then take the next one.
          return { route: (current.route + 1) % routes.length, hop: -1 };
        });
      },
      resting ? REST_MS : HOP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playing, step, routes]);

  const route = routes[step.route];
  const hop = playing && route && step.hop >= 0 ? route.hops[step.hop] : null;
  /** Lit: the part a hop arrives at. From: the part it left. Off: everything else, while a hop is shown. */
  const lit = (id: string) => (!hop ? "idle" : id === hop.to ? "on" : id === hop.from ? "from" : "off");

  // The line that carries a hop: the one between the middle card and the other end. A hop that does not touch
  // the middle has no line of its own, so the two parts light up one after the other and no line pretends otherwise.
  const spoke = (id: string) => hop && centre && ((hop.from === id && hop.to === centre.id) || (hop.to === id && hop.from === centre.id));
  const inward = (id: string) => Boolean(hop && centre && hop.to === centre.id && hop.from === id);

  // The drawing has the picture's own proportions, so a percentage of the picture is a point on it.
  const x = (percent: number) => (percent * VIEW.width) / 100;
  const y = (percent: number) => (percent * VIEW.height) / 100;
  const lines: { id: string; d: string; towardsCentre: boolean }[] = [];
  if (top && centre) lines.push({ id: top.id, d: `M ${x(50)} ${y(17)} V ${y(39)}`, towardsCentre: true });
  if (bottom && centre) lines.push({ id: bottom.id, d: `M ${x(50)} ${y(61)} V ${y(83)}`, towardsCentre: false });
  left?.items.slice(0, SIDE_Y.length).forEach((item, index) =>
    lines.push({ id: item.id, d: `M ${x(27)} ${y(SIDE_Y[index])} C ${x(31)} ${y(SIDE_Y[index])}, ${x(30)} ${y(50)}, ${x(34)} ${y(50)}`, towardsCentre: true }),
  );
  right?.items.slice(0, SIDE_Y.length).forEach((item, index) =>
    lines.push({ id: item.id, d: `M ${x(66)} ${y(50)} C ${x(70)} ${y(50)}, ${x(69)} ${y(SIDE_Y[index])}, ${x(73)} ${y(SIDE_Y[index])}`, towardsCentre: false }),
  );

  const side = (group: HubSide, where: "left" | "right", order: number) => (
    <li data-tone={group.tone}>
      <p className={"absolute top-[5%] w-[27%] text-center text-xs font-bold text-tone " + (where === "left" ? "left-0" : "right-0")}>{group.title}</p>
      {group.items.slice(0, SIDE_Y.length).map((item, index) => (
        <div
          key={item.id}
          data-lit={lit(item.id)}
          style={{ top: `calc(${SIDE_Y[index]}% - 1.375rem)`, "--i": order + index } as React.CSSProperties}
          className={"hub-card absolute flex h-11 w-[27%] items-center gap-2 rounded-xl border border-line bg-surface px-2 shadow-md " + (where === "left" ? "left-0" : "right-0")}
        >
          <NodeTile node={item.node} size={28} />
          <span className="line-clamp-2 min-w-0 text-[0.78125rem] font-semibold leading-[1.15]">{item.label}</span>
        </div>
      ))}
    </li>
  );

  return (
    <div ref={root} data-hub data-playing={playing} className="relative mx-auto w-full max-w-[46rem]">
      <div aria-hidden className="absolute inset-0 -z-10 scale-110 rounded-[2rem] bg-[radial-gradient(circle_at_60%_35%,var(--glow),transparent_70%)]" />
      {/*
        The picture is drawn at one size and scaled to the room it has, like an image: on a phone its cards do not
        reflow into something else, they get smaller together.
      */}
      <div className="hub-frame relative w-full lg:[transform:perspective(1700px)_rotateY(-9deg)_rotateX(5deg)]" style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}` }}>
        <ul className="hub-stage absolute left-0 top-0 origin-top-left" style={{ width: VIEW.width, height: VIEW.height }} aria-label={`The layers of ${title}`}>
          {/* The lines sit behind the cards. They are decoration for someone who can see the picture; the list says the rest. */}
          <li aria-hidden className="absolute inset-0">
            <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="h-full w-full" fill="none">
              {lines.map((line) => (
                <path key={line.id} d={line.d} className="hub-line" strokeWidth={1.75} style={{ stroke: "var(--accent)", opacity: spoke(line.id) ? 0.25 : 0.6 }} />
              ))}
              {lines
                .filter((line) => spoke(line.id))
                .map((line) => (
                  <path
                    // A new element for every hop, so the light starts from the beginning of the line each time.
                    key={`${line.id}-${step.route}-${step.hop}`}
                    d={line.d}
                    pathLength={100}
                    className="hub-pulse"
                    data-back={inward(line.id) !== line.towardsCentre}
                    strokeWidth={3.5}
                    strokeLinecap="round"
                    style={{ stroke: "var(--accent)" }}
                  />
                ))}
            </svg>
          </li>
          {top ? (
            <li className="absolute left-[30%] top-0 h-[17%] w-[40%]">
              <LayerCard layer={top} lit={lit(top.id)} order={0} />
            </li>
          ) : null}
          {centre ? (
            <li className="absolute left-[34%] top-[39%] h-[22%] w-[32%]">
              <LayerCard layer={centre} lit={lit(centre.id)} order={1} strong />
            </li>
          ) : null}
          {bottom ? (
            <li className="absolute left-[30%] top-[83%] h-[17%] w-[40%]">
              <LayerCard layer={bottom} lit={lit(bottom.id)} order={2} />
            </li>
          ) : null}
          {right ? side(right, "right", 3) : null}
          {left ? side(left, "left", 5) : null}
        </ul>
      </div>

      {/*
        The button and the line that says what is playing each have one size, whatever the words are: the button
        never wraps and is as wide for "Play" as for "Pause", and the line is a single row that cuts long text
        short. The row they share has a fixed height, so nothing under it moves when the request changes, when
        the animation is paused, or before the page has decided whether it may play at all.
      */}
      <div data-hub-controls className="mx-auto mt-4 flex h-[4.25rem] max-w-[38rem] flex-col items-center gap-2 text-[0.8125rem] text-muted sm:h-8 sm:flex-row sm:gap-3">
        {allowed && routes.length > 0 ? (
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
            className="inline-flex h-8 w-[11.5rem] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-surface font-semibold text-fg shadow-sm transition-colors hover:border-accent hover:text-accent"
          >
            {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
            {paused ? "Play the animation" : "Pause the animation"}
          </button>
        ) : null}
        {/* Which recorded request is being shown. Not announced as it changes: it would talk over the page. */}
        {playing && route ? (
          <p data-testid="hub-route" title={hop ? `${route.label} · ${hop.label}` : route.label} className="h-5 w-full min-w-0 truncate text-center leading-5 sm:text-left">
            <span className="font-semibold text-fg">{route.label}</span>
            {hop ? <span> · {hop.label}</span> : null}
          </p>
        ) : null}
      </div>
      <p className="mt-2 text-center text-[0.8125rem] text-muted">
        The real system behind{" "}
        <Link href={href} className="link">
          {title}
        </Link>
        : {components} components, {connections} connections. Real requests, replayed here as an animation.
      </p>
    </div>
  );
}
