import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { OG_COLOURS, OG_TONES } from "./og-palette";

/**
 * The share images cannot read the stylesheet, so their colours are written
 * out a second time. This keeps the copy honest: change a token in
 * globals.css and this fails until the copy follows.
 */
const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");
const light = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

function token(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(light)?.[1].toLowerCase();
}

describe("the share images use the light theme's colours", () => {
  test.each(Object.entries(OG_COLOURS))("%s", (name, value) => {
    expect(token(name)).toBe(value);
  });

  test.each(Object.entries(OG_TONES))("the %s tone", (tone, colours) => {
    expect(token(`tone-${tone}`)).toBe(colours.text);
    expect(token(`tone-${tone}-vivid`)).toBe(colours.vivid);
    expect(token(`tone-${tone}-soft`)).toBe(colours.soft);
  });
});
