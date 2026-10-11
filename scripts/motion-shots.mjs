// Visual review helper for things that move: captures the same spot several
// times, a moment apart, with motion left on. `screenshots.mjs` asks for
// reduced motion, so it never sees an animation.
//
//   node scripts/motion-shots.mjs <outDir> [baseUrl]
//
// A production or development server must already be running.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const outDir = process.argv[2] ?? "motion-shots";
const baseUrl = process.argv[3] ?? "http://localhost:3100";
const themes = (process.env.THEMES ?? "light,dark").split(",");

const SHOTS = [
  // The hero while a request plays through the picture beside the headline.
  { name: "home-hub", path: "/", size: [1920, 900], waits: [900, 2400, 3900, 5400, 8400] },
  { name: "home-hub-laptop", path: "/", size: [1280, 800], waits: [3900] },
  { name: "home-hub-phone", path: "/", size: [390, 844], waits: [3900], scrollTo: "[data-hub]" },
  // The diagram with a component pointed at: its connections come forward.
  {
    name: "architecture-point",
    path: "/projects/pest-control-crm#architecture",
    size: [1672, 941],
    waits: [1200],
    act: async (page) => {
      await page.locator("#architecture .react-flow__node-arch").first().waitFor();
      await page.locator("#architecture").getByRole("button", { name: /^Apps Script server:/ }).hover();
    },
  },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
for (const theme of themes) {
  for (const shot of SHOTS) {
    const [width, height] = shot.size;
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
    const page = await context.newPage();
    await page.goto(baseUrl + shot.path, { waitUntil: "networkidle" });
    if (shot.scrollTo) await page.locator(shot.scrollTo).first().scrollIntoViewIfNeeded();
    if (shot.act) await shot.act(page);
    let elapsed = 0;
    for (const wait of shot.waits) {
      await page.waitForTimeout(wait - elapsed);
      elapsed = wait;
      const file = path.join(outDir, `${shot.name}.${theme}.${String(wait).padStart(5, "0")}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 72 });
      console.log(file);
    }
    await context.close();
  }
}
await browser.close();
