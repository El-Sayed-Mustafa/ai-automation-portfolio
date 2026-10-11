import {
  Activity,
  Bot,
  Boxes,
  BriefcaseBusiness,
  Bug,
  ChartCandlestick,
  Database,
  Gauge,
  Plug,
  Radar,
  RefreshCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Category, IconName, Tone } from "@/content/schema";

/** Icons that content may name. A manifest picks one by key; it never carries markup. */
const ICONS: Record<IconName, LucideIcon> = {
  bug: Bug,
  candlestick: ChartCandlestick,
  pulse: Activity,
  briefcase: BriefcaseBusiness,
  star: Star,
  store: Store,
  radar: Radar,
  refresh: RefreshCcw,
  boxes: Boxes,
  bot: Bot,
  workflow: Workflow,
  server: Server,
  database: Database,
  shield: ShieldCheck,
  gauge: Gauge,
  plug: Plug,
  sparkles: Sparkles,
};

export function AppIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Icon = ICONS[name];
  return <Icon size={size} aria-hidden />;
}

/** The tones used when a list needs a different colour per item. */
export const TONE_CYCLE: Tone[] = ["blue", "teal", "violet", "amber", "rose", "indigo", "green"];

export const CATEGORY_TONE: Record<Category, Tone> = {
  "ai-engineering": "violet",
  automation: "indigo",
  backend: "blue",
  "data-engineering": "teal",
  "business-apps": "amber",
};

/** A coloured square that carries an icon. */
export function Tile({ tone, children, size = "md", solid = false, className = "" }: { tone: Tone; children: ReactNode; size?: "sm" | "md"; solid?: boolean; className?: string }) {
  return (
    <span data-tone={tone} className={`tile ${size === "sm" ? "tile-sm" : ""} ${solid ? "tile-solid" : ""} ${className}`}>
      {children}
    </span>
  );
}

/** A label that says what something is. */
export function Tag({ tone = "slate", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span data-tone={tone} className={`tag ${className}`}>
      {children}
    </span>
  );
}

/** The two marks the icon set does not include. */
export function GithubMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function LinkedinMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}
