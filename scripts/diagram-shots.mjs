// Captures every project's architecture diagram, expanded over the whole window, in the states a reader meets:
// at rest, pointing at a component, following a request, and with every connection drawn.
//
//   node scripts/diagram-shots.mjs <outDir> [baseUrl] [projectId ...]
//
// Motion is reduced, so nothing is caught half way through an animation.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const [outDir, baseUrl = "http://localhost:3100", ...only] = process.argv.slice(2);
if (!outDir) {
  console.error("usage: node scripts/diagram-shots.mjs <outDir> [baseUrl] [projectId ...]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, reducedMotion: "reduce" });

await page.goto(`${baseUrl}/projects`);
const ids = only.length > 0 ? only : await page.locator('a[href^="/projects/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href").split("/")[2].split("#")[0]).filter(Boolean))]);

for (const id of ids) {
  await page.goto(`${baseUrl}/projects/${id}#architecture`);
  const architecture = page.locator("#architecture");
  await architecture.locator(".react-flow__node-arch").first().waitFor();
  await architecture.getByRole("button", { name: "Expand" }).click();
  const region = page.getByRole("region", { name: "Architecture diagram, expanded" });
  await region.getByRole("button", { name: "Full graph", exact: true }).click();
  await page.waitForTimeout(500);
  await region.screenshot({ path: `${outDir}/${id}-1-rest.png` });

  // The component with the most connections is the hardest case for "show me this one's lines".
  const busiest = region.locator(".react-flow__node-arch button").nth(Number(process.env.POINT_AT ?? 2));
  await busiest.hover();
  await page.waitForTimeout(350);
  await region.screenshot({ path: `${outDir}/${id}-2-pointing.png` });
  await page.mouse.move(5, 5);

  await region.getByRole("button", { name: "Data flow" }).click();
  const request = region.getByRole("group", { name: "Follow a request" }).getByRole("button").first();
  if (await request.count()) {
    await request.click();
    await page.waitForTimeout(600);
    await region.screenshot({ path: `${outDir}/${id}-3-request.png` });
  }
  await region.getByRole("button", { name: "Architecture", exact: true }).click();

  await region.getByRole("button", { name: "Every connection" }).click();
  await region.getByRole("button", { name: "Full graph", exact: true }).click();
  await page.waitForTimeout(500);
  await region.screenshot({ path: `${outDir}/${id}-4-every.png` });
  console.log(id);
}

await browser.close();
