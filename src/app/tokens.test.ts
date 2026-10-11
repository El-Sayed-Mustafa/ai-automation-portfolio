import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The design tokens are the only place colours are defined, so checking their
 * contrast here covers every component that uses them, in both themes.
 */
const css = readFileSync(path.join(__dirname, "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No "${selector}" block in globals.css`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2]]));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const THEMES = { light: block(":root"), dark: block('[data-theme="dark"]') };

/** Text colour on the background it is used on. All of these carry body-size text. */
const TEXT_PAIRS: [string, string][] = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["fg", "surface-2"],
  ["fg", "surface-3"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface-2"],
  ["subtle", "bg"],
  ["subtle", "surface"],
  ["subtle", "surface-2"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["accent", "surface-2"],
  ["accent", "accent-soft"],
  ["accent-strong", "surface"],
  ["accent-strong", "accent-soft"],
  ["accent-fg", "accent"],
  ["accent-fg", "accent-hover"],
  ["success", "surface"],
  ["success", "success-soft"],
  ["warn", "surface"],
  ["warn", "warn-soft"],
  ["danger", "surface"],
  ["danger", "danger-soft"],
  ["hold", "surface"],
  ["hold", "hold-soft"],
  ["fg", "accent-soft"],
  ["fg", "success-soft"],
  ["fg", "warn-soft"],
  ["fg", "danger-soft"],
  ["fg", "hold-soft"],
  ["primary-fg", "primary"],
  ["primary-fg", "primary-hover"],
];

/** The colour families that tell projects, layers and tags apart. */
const TONES = ["indigo", "blue", "teal", "green", "violet", "amber", "rose", "slate", "cyan"];

/** The colours of the evidence labels. A label sits under a claim wherever the claim is, on any card. */
const EVIDENCE = ["success", "accent-strong", "hold", "warn", "subtle"];

describe.each(Object.entries(THEMES))("%s theme", (_name, tokens) => {
  test.each(TEXT_PAIRS)("%s on %s meets WCAG AA for text", (foreground, background) => {
    expect(tokens[foreground], `--${foreground} is defined`).toBeDefined();
    expect(tokens[background], `--${background} is defined`).toBeDefined();
    expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
  });

  describe.each(TONES)("the %s tone", (tone) => {
    const colour = `tone-${tone}`;
    const vivid = `tone-${tone}-vivid`;
    const soft = `tone-${tone}-soft`;

    test("is readable as a tag: the tone on its soft background", () => {
      expect(tokens[colour], `--${colour} is defined`).toBeDefined();
      expect(tokens[soft], `--${soft} is defined`).toBeDefined();
      expect(contrast(tokens[colour], tokens[soft])).toBeGreaterThanOrEqual(4.5);
    });

    test("is readable as a figure on a card", () => {
      expect(contrast(tokens[colour], tokens.surface)).toBeGreaterThanOrEqual(4.5);
    });

    test("carries body text on its soft background", () => {
      expect(contrast(tokens.fg, tokens[soft])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.muted, tokens[soft])).toBeGreaterThanOrEqual(4.5);
    });

    test.each(EVIDENCE)("carries the %s evidence label on its soft background", (label) => {
      expect(contrast(tokens[label], tokens[soft])).toBeGreaterThanOrEqual(4.5);
    });

    test("its vivid colour carries an icon or a large figure: as a solid tile, on a card and on its soft background", () => {
      // WCAG 1.4.11 and 1.4.3 for large text: 3:1 against what is behind it. Small text never uses the vivid colour.
      expect(tokens[vivid], `--${vivid} is defined`).toBeDefined();
      expect(contrast(tokens.surface, tokens[vivid])).toBeGreaterThanOrEqual(3);
      expect(contrast(tokens[vivid], tokens[soft])).toBeGreaterThanOrEqual(3);
    });
  });

  test.each(["bg", "surface", "surface-2"])("a text field's border meets 3:1 on %s", (background) => {
    // WCAG 1.4.11: the edge of a field is the only thing that shows where to type.
    expect(contrast(tokens["line-control"], tokens[background])).toBeGreaterThanOrEqual(3);
  });

  test("the border of a labelled control is visible on the surface behind it", () => {
    // Buttons and chips carry a text label, so their outline is decoration; it only has to be visible.
    expect(contrast(tokens["line-strong"], tokens.surface)).toBeGreaterThanOrEqual(1.5);
  });

  test("surfaces step in lightness, so panels read as layers without relying on borders", () => {
    const steps = ["bg", "surface", "surface-2", "surface-3"].map((name) => luminance(tokens[name]));
    const distinct = new Set(steps.map((value) => value.toFixed(4)));
    expect(distinct.size).toBe(steps.length);
  });
});

test("both themes define the same tokens", () => {
  expect(Object.keys(THEMES.dark).sort()).toEqual(Object.keys(THEMES.light).sort());
});

test("the page is light until the visitor chooses dark", () => {
  // No colour-scheme media query: the theme is a choice the header toggle stores, not a guess.
  expect(css).not.toMatch(/prefers-color-scheme/);
  expect(css).toMatch(/:root \{[^}]*color-scheme: light;/);
});
