import { ImageResponse } from "next/og";
import type { Tone } from "@/content/schema";
import { OG_COLOURS as C, OG_TONES } from "./og-palette";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/** The order the little cards on the right take their colours in: the same as a diagram's columns. */
const COLUMN_TONES: Tone[] = ["blue", "teal", "violet", "amber", "rose"];

interface ShareImage {
  /** A short line above the title: what kind of page this is. */
  eyebrow: string;
  title: string;
  /** One or two sentences under the title. */
  text: string;
  /** Up to three short facts, as pills. */
  chips: string[];
  tone: Tone;
  /** How many components each layer has, left to right. Drawn as a small picture of the system. */
  columns: number[];
  /** Who the site belongs to, at the bottom. */
  author: string;
  role: string;
}

/** As many whole sentences as fit in three lines. A sentence is never cut in the middle. */
function lead(text: string, limit = 150): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = sentences[0];
  for (const sentence of sentences.slice(1)) {
    if (out.length + 1 + sentence.length > limit) break;
    out += ` ${sentence}`;
  }
  return out.length > limit + 30 ? `${out.slice(0, limit).trimEnd()}…` : out;
}

/**
 * The picture a link to this site carries when it is shared. Everything in it
 * comes from the content: the title, the facts on the pills, and the little
 * diagram, which has one column per layer of the real system and one card per
 * component in it.
 *
 * The drawing engine lays out with flexbox only and reads no stylesheet, so
 * every style is written inline.
 */
export function shareImage({ eyebrow, title, text, chips, tone, columns, author, role }: ShareImage): ImageResponse {
  const main = OG_TONES[tone];
  const shown = columns.slice(0, COLUMN_TONES.length);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 64px",
          backgroundColor: C.bg,
          backgroundImage: `radial-gradient(circle at 88% 8%, ${main.soft} 0%, ${C.bg} 55%)`,
          color: C.fg,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 700 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: main.vivid, marginRight: 12 }} />
              <div style={{ fontSize: 24, color: main.text, letterSpacing: 0.4 }}>{eyebrow}</div>
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: title.length > 34 ? 56 : 66, lineHeight: 1.08, letterSpacing: -1.6 }}>{title}</div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 27, lineHeight: 1.4, color: C.muted }}>{lead(text)}</div>
          </div>

          <div style={{ display: "flex", padding: 18, borderRadius: 26, backgroundColor: C.surface, border: `1px solid ${C.line}`, boxShadow: "0 24px 60px rgba(16, 27, 53, 0.12)" }}>
            {shown.map((count, column) => {
              const colour = OG_TONES[COLUMN_TONES[column]];
              return (
                <div
                  key={column}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    width: 58,
                    padding: "10px 7px",
                    marginLeft: column === 0 ? 0 : 10,
                    borderRadius: 14,
                    backgroundColor: colour.soft,
                  }}
                >
                  <div style={{ width: 28, height: 7, borderRadius: 4, backgroundColor: colour.vivid, marginBottom: 9, alignSelf: "center" }} />
                  {Array.from({ length: Math.min(count, 5) }, (_, row) => (
                    <div key={row} style={{ display: "flex", alignItems: "center", height: 30, marginTop: row === 0 ? 0 : 7, padding: "0 6px", borderRadius: 8, backgroundColor: C.surface }}>
                      <div style={{ width: 13, height: 13, borderRadius: 4, backgroundColor: colour.vivid }} />
                      <div style={{ width: 18, height: 5, borderRadius: 3, backgroundColor: C.line, marginLeft: 5 }} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex" }}>
            {chips.slice(0, 3).map((chip, index) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  padding: "10px 20px",
                  marginLeft: index === 0 ? 0 : 12,
                  borderRadius: 999,
                  fontSize: 22,
                  backgroundColor: C.surface,
                  border: `1px solid ${C.line}`,
                  color: C.fg,
                }}
              >
                {chip}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 28 }}>{author}</div>
            <div style={{ fontSize: 21, color: C.muted, marginTop: 4 }}>{role}</div>
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
