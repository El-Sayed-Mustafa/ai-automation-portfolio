import type { Tone } from "@/content/schema";

/**
 * The colours of the share images. An image is drawn outside the page, where
 * the stylesheet's variables do not exist, so the light theme's values are
 * written out here. A test keeps them equal to the ones in globals.css.
 */
export const OG_COLOURS = {
  bg: "#eff3fa",
  surface: "#ffffff",
  line: "#d8dfec",
  fg: "#0b1530",
  muted: "#36425c",
  accent: "#2563eb",
  "accent-soft": "#eaf1ff",
} as const;

export const OG_TONES: Record<Tone, { vivid: string; soft: string; text: string }> = {
  indigo: { text: "#4338ca", vivid: "#4f46e5", soft: "#ebebff" },
  blue: { text: "#1d4ed8", vivid: "#2563eb", soft: "#e3edff" },
  teal: { text: "#0f6f67", vivid: "#0c8f84", soft: "#d9f5ef" },
  green: { text: "#15703a", vivid: "#12984a", soft: "#ddf7e6" },
  violet: { text: "#6d28d9", vivid: "#7c3aed", soft: "#efe8ff" },
  amber: { text: "#a8480a", vivid: "#e0590b", soft: "#fff0dc" },
  rose: { text: "#be123c", vivid: "#e11d48", soft: "#ffe6ec" },
  slate: { text: "#475569", vivid: "#64748b", soft: "#edf1f7" },
  cyan: { text: "#0b6580", vivid: "#0891b2", soft: "#dcf5fb" },
};
