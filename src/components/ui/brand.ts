import {
  siDocker,
  siFastapi,
  siGithubactions,
  siGmail,
  siGoogle,
  siGooglechrome,
  siGoogleappsscript,
  siGooglebigquery,
  siGooglecalendar,
  siGoogledrive,
  siGooglegemini,
  siGooglesheets,
  siEbay,
  siNumpy,
  siOllama,
  siScikitlearn,
  siPandas,
  siPostgresql,
  siPython,
  siReact,
  siSelenium,
  siShopify,
  siSqlite,
  siStreamlit,
  siSupabase,
  siTelegram,
  siWhatsapp,
  type SimpleIcon,
} from "simple-icons";
import type { ArchitectureNode } from "@/content/schema";

/**
 * The logo of a technology, for the places that name one: a component of a
 * diagram, a line of the stack. A logo is used only to say "this is built
 * with that"; nothing here stands for a client or an employer.
 *
 * Which logo a text gets is decided by the first technology it names. A rule
 * with no logo stops the search, so a page made of HTML and served by Apps
 * Script is not drawn as Apps Script.
 */
export interface Brand {
  title: string;
  path: string;
  /** The logo's colour as a mark on a light surface and on a dark one. */
  light: string;
  dark: string;
  /** The colour of a tile that carries the logo in white, in each theme, and the logo's colour on it. */
  tileLight: string;
  tileDark: string;
  inkLight: string;
  inkDark: string;
}

const WHITE = "ffffff";
const NAVY = "0a0f1e";

function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function mix(hex: string, with_: number, amount: number): string {
  const channel = (index: number) => Math.round(parseInt(hex.slice(index, index + 2), 16) * (1 - amount) + with_ * amount);
  return [0, 2, 4].map((index) => channel(index).toString(16).padStart(2, "0")).join("");
}

/** Darkens a colour, a step at a time, until a white logo on it is clear (3:1, as for any graphic). */
function tileFor(hex: string): string {
  let colour = hex.toLowerCase();
  for (let step = 0; step < 12 && contrast(WHITE, colour) < 3.2; step += 1) colour = mix(colour, 0, 0.08);
  return colour;
}

/** A brand colour is kept as it is unless it would be too pale on white or too dark on navy. */
function brand(icon: SimpleIcon): Brand {
  const hex = icon.hex.toLowerCase();
  const light = luminance(hex) > 0.45 ? mix(hex, 0, 0.28) : hex;
  const dark = luminance(hex) < 0.12 ? mix(hex, 255, 0.62) : hex;
  const tileLight = tileFor(hex);
  // On the dark theme a very dark tile would vanish into the page, so it is lifted, and the logo on it turns dark.
  const tileDark = luminance(hex) < 0.05 ? mix(hex, 255, 0.55) : tileLight;
  return {
    title: icon.title,
    path: icon.path,
    light: `#${light}`,
    dark: `#${dark}`,
    tileLight: `#${tileLight}`,
    tileDark: `#${tileDark}`,
    inkLight: `#${WHITE}`,
    inkDark: `#${contrast(WHITE, tileDark) >= 3 ? WHITE : NAVY}`,
  };
}

const RULES: { pattern: RegExp; icon: SimpleIcon | null }[] = [
  { pattern: /whatsapp/i, icon: siWhatsapp },
  { pattern: /gmail|mailapp/i, icon: siGmail },
  { pattern: /google sheets/i, icon: siGooglesheets },
  { pattern: /google drive|driveapp/i, icon: siGoogledrive },
  { pattern: /google calendar|calendarapp/i, icon: siGooglecalendar },
  { pattern: /google contacts|people api/i, icon: siGoogle },
  { pattern: /bigquery/i, icon: siGooglebigquery },
  { pattern: /gemini/i, icon: siGooglegemini },
  { pattern: /telegram/i, icon: siTelegram },
  { pattern: /shopify/i, icon: siShopify },
  { pattern: /github actions/i, icon: siGithubactions },
  { pattern: /supabase/i, icon: siSupabase },
  { pattern: /apps script/i, icon: siGoogleappsscript },
  { pattern: /streamlit/i, icon: siStreamlit },
  { pattern: /fastapi/i, icon: siFastapi },
  { pattern: /selenium/i, icon: siSelenium },
  { pattern: /postgres/i, icon: siPostgresql },
  { pattern: /sqlite/i, icon: siSqlite },
  { pattern: /\breact\b/i, icon: siReact },
  { pattern: /docker/i, icon: siDocker },
  { pattern: /chromium/i, icon: siGooglechrome },
  { pattern: /pandas/i, icon: siPandas },
  { pattern: /numpy/i, icon: siNumpy },
  { pattern: /scikit/i, icon: siScikitlearn },
  { pattern: /ollama/i, icon: siOllama },
  { pattern: /\bebay\b/i, icon: siEbay },
  { pattern: /python/i, icon: siPython },
  // Plain web pages have no logo of their own, whatever serves them.
  { pattern: /html|css|javascript|static page|web app/i, icon: null },
];

const cache = new Map<SimpleIcon, Brand>();

/** The logo for the first technology a text names, if it names one that has a logo here. */
export function brandFor(text: string): Brand | null {
  let best: { index: number; icon: SimpleIcon | null } | null = null;
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match && (best === null || match.index < best.index)) best = { index: match.index, icon: rule.icon };
  }
  if (!best || !best.icon) return null;
  if (!cache.has(best.icon)) cache.set(best.icon, brand(best.icon));
  return cache.get(best.icon)!;
}

/**
 * The logo for a component: what its name says first, then what it is built
 * with. A person has no logo, whatever tool they use.
 */
export function nodeBrand(node: Pick<ArchitectureNode, "kind" | "label" | "technology">): Brand | null {
  if (node.kind === "actor") return null;
  const byName = RULES.some((rule) => rule.pattern.test(node.label));
  return byName ? brandFor(node.label) : brandFor(node.technology);
}
