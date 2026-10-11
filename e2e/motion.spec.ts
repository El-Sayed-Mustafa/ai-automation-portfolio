import { expect, test } from "@playwright/test";

/**
 * What moves, and that it can be stopped: the picture beside the headline, the
 * figures under it, the diagram's response to the pointer, and the width the
 * page takes. Everything here runs with motion on, except the tests that say
 * otherwise.
 */
const CRM = "/projects/pest-control-crm";

test.describe("the picture beside the headline", () => {
  test("plays real requests through the system, lighting the parts on the way", async ({ page }) => {
    await page.goto("/");
    const hub = page.locator("[data-hub]");
    await expect(hub).toHaveAttribute("data-playing", "true");
    // The line under the picture says which traced request is playing, and between which two components.
    const caption = hub.getByTestId("hub-route");
    await expect(caption).toContainText(/A WhatsApp message becomes a lead|A booking is saved|The technician is notified|A read survives a fast-path failure|A technician files a visit report/);
    await expect(caption).toContainText("→", { timeout: 6000 });

    // While a hop is shown, the part it arrives at is lit, the one it left is marked, and the rest step back.
    await expect(hub.locator('.hub-card[data-lit="on"]')).toHaveCount(1, { timeout: 6000 });
    await expect(hub.locator('.hub-card[data-lit="from"]')).toHaveCount(1);
    const off = hub.locator('.hub-card[data-lit="off"]').first();
    await expect(off).toBeVisible();
    await expect.poll(async () => Number(await off.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(0.6);

    // It moves on: a different pair of parts is lit a moment later.
    const lit = async () => (await hub.locator('.hub-card[data-lit="on"], .hub-card[data-lit="from"]').allInnerTexts()).join("|");
    const first = await lit();
    await expect.poll(lit, { timeout: 8000 }).not.toBe(first);
  });

  test("names only components and routes that are in the case study", async ({ page }) => {
    await page.goto("/");
    const hub = page.locator("[data-hub]");
    // The same five layers as the diagram, in its order, and the real counts.
    await expect(hub.getByRole("list", { name: "The layers of Pest Control CRM and Field Operations" }).getByRole("listitem")).toContainText([
      "Clients",
      "Application",
      "Data",
      "Background work",
      "External services",
    ]);
    await expect(hub).toContainText("14 components, 18 connections");
    await expect(hub).toContainText("replayed here as an animation");
    await hub.getByRole("link", { name: "Pest Control CRM and Field Operations" }).click();
    await expect(page).toHaveURL(new RegExp(`${CRM}#architecture$`));
  });

  test("can be paused and started again", async ({ page }) => {
    await page.goto("/");
    const hub = page.locator("[data-hub]");
    await expect(hub).toHaveAttribute("data-playing", "true");
    const pause = hub.getByRole("button", { name: "Pause the animation" });
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    await pause.click();
    await expect(hub).toHaveAttribute("data-playing", "false");
    // Paused, every part is shown as it is at rest: nothing is left dimmed.
    await expect(hub.locator('.hub-card[data-lit="off"]')).toHaveCount(0);
    await expect(hub.getByTestId("hub-route")).toHaveCount(0);

    const play = hub.getByRole("button", { name: "Play the animation" });
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await play.click();
    await expect(hub).toHaveAttribute("data-playing", "true");
  });

  for (const size of [
    { name: "a wide screen", width: 1920, height: 1000 },
    { name: "a laptop", width: 1280, height: 800 },
    { name: "a phone", width: 390, height: 844 },
  ]) {
    test(`nothing under the picture moves as the words beside the button change, on ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/");
      const hub = page.locator("[data-hub]");
      await hub.scrollIntoViewIfNeeded();
      const controls = hub.locator("[data-hub-controls]");
      // One button with two labels: it says "Pause" while playing and "Play" while paused.
      const button = hub.getByRole("button", { name: /^(Pause|Play) the animation$/ });
      await expect(button).toHaveText("Pause the animation");
      // The list itself has no box of its own (its items are laid out by the bar around it), so its first item stands for it.
      const below = page.getByRole("list", { name: "This site in numbers" }).getByRole("listitem").first();
      const measure = async () => {
        const row = (await controls.boundingBox())!;
        const press = (await button.boundingBox())!;
        return {
          row: Math.round(row.height),
          button: `${Math.round(press.width)}x${Math.round(press.height)}`,
          // Where the next block starts, measured from the picture, so a scroll of the page does not count as movement.
          gap: Math.round((await below.boundingBox())!.y - row.y),
        };
      };
      const first = await measure();
      // One line of text in the button, never two.
      expect(Number(first.button.split("x")[1])).toBeLessThanOrEqual(34);
      // Through two whole requests, with names of every length: the same sizes every time.
      const seen = new Set<string>();
      for (let sample = 0; sample < 22; sample += 1) {
        await page.waitForTimeout(700);
        seen.add((await hub.getByTestId("hub-route").innerText({ timeout: 500 }).catch(() => "")).trim());
        expect(await measure(), `sample ${sample}`).toEqual(first);
      }
      expect(seen.size).toBeGreaterThan(4);
      // The longest caption is cut short on one line, not wrapped.
      const caption = hub.getByTestId("hub-route");
      await expect(caption).toBeVisible({ timeout: 6000 });
      expect(Math.round((await caption.boundingBox())!.height)).toBeLessThanOrEqual(22);
      // Pausing takes the caption away and changes the button's words, and still nothing moves.
      await button.click();
      await expect(hub.getByRole("button", { name: "Play the animation" })).toBeVisible();
      const paused = await measure();
      expect(paused).toEqual(first);
    });
  }

  test("does not play for a visitor who asked for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const hub = page.locator("[data-hub]");
    await expect(hub.getByRole("list", { name: /^The layers of/ })).toBeVisible();
    await expect(hub).toHaveAttribute("data-playing", "false");
    await expect(hub.getByRole("button", { name: /animation/ })).toHaveCount(0);
    await expect(hub.locator('.hub-card[data-lit="off"]')).toHaveCount(0);
    // The row where the button would be keeps its place, so the page is laid out the same with or without it.
    expect(Math.round((await hub.locator("[data-hub-controls]").boundingBox())!.height)).toBe(32);
    // Nothing else is left half-shown either: what eases in elsewhere is simply there.
    const work = page.locator("#work");
    await work.scrollIntoViewIfNeeded();
    expect(Number(await work.evaluate((element) => getComputedStyle(element).opacity))).toBe(1);
  });

  for (const size of [
    { name: "a phone", width: 390, height: 844 },
    { name: "a laptop", width: 1280, height: 800 },
  ]) {
    test(`keeps its shape on ${size.name}: every card inside the picture, none over another`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const hub = page.locator("[data-hub]");
      await hub.scrollIntoViewIfNeeded();
      const frame = (await hub.locator(".hub-frame").boundingBox())!;
      const boxes = await hub.locator(".hub-card").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
      expect(boxes.length).toBe(9);
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(frame.x - 16);
        expect(box.right).toBeLessThanOrEqual(frame.x + frame.width + 16);
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          const apart = a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
          expect(apart, `cards ${i} and ${j}`).toBe(true);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});

test.describe("the page on a wide screen", () => {
  test.use({ viewport: { width: 1920, height: 1000 } });

  for (const path of ["/", "/projects"]) {
    test(`${path} uses the width of the window`, async ({ page }) => {
      await page.goto(path);
      const first = page.locator("main > *").first();
      const used = await first.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      // More than four fifths of a 1920px window, with a margin left on each side.
      expect(used).toBeGreaterThan(1536);
      expect(used).toBeLessThan(1860);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  test("the figures under the headline count up to their real values", async ({ page }) => {
    await page.goto("/");
    const counts = page.getByRole("list", { name: "This site in numbers" }).getByRole("listitem");
    await expect(counts).toContainText(["8", "8", "71", "122"]);
    // They settle on the values and stay there.
    await page.waitForTimeout(1200);
    await expect(counts.nth(3)).toContainText("122");
    await expect(counts.nth(2)).toContainText("71");
  });
});

test.describe("the lines of the diagram", () => {
  const SOLANA = "/projects/solana-research-platform";

  test("at rest one line joins each pair of connected layers, and no connection has a line of its own", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(0);
    const links = architecture.locator("svg[data-links-state]");
    await expect(links).toHaveAttribute("data-links-state", "rest");
    // Five layers in a row: four pairs of neighbours, and three pairs further apart.
    await expect(links.locator('[data-link][data-route="gutter"]')).toHaveCount(4);
    await expect(links.locator('[data-link]:not([data-route="gutter"])')).toHaveCount(3);
    // The page says what one line stands for.
    await expect(architecture.getByTestId("links-hint")).toContainText("One line joins two layers.");
  });

  test("the hardest diagram has ten lines where it has twenty-three connections", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(`${SOLANA}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(16);
    await expect(architecture.locator("svg[data-links-state] [data-link]")).toHaveCount(10);
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(0);
    // Each of the twenty-three is still there to be asked for.
    await architecture.getByRole("button", { name: "Every connection" }).click();
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(23);
  });

  test("pointing at a component draws its own connections, and the grouped lines step back", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    const links = architecture.locator("svg[data-links-state]");
    const exact = architecture.locator(".react-flow__edge");

    await architecture.getByRole("button", { name: /^Apps Script server:/ }).hover();
    // Seven connections touch it, and only those are drawn.
    await expect(exact).toHaveCount(7);
    await expect(links).toHaveAttribute("data-links-state", "back");
    await expect.poll(async () => Number(await links.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(0.3);

    await architecture.getByRole("heading", { level: 2, name: "System architecture" }).hover();
    await expect(exact).toHaveCount(0);
    await expect(links).toHaveAttribute("data-links-state", "rest");
    await expect.poll(async () => Number(await links.evaluate((element) => getComputedStyle(element).opacity))).toBe(1);
  });

  test("a layer brought forward shows each of its connections", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    await architecture.getByRole("button", { name: "Focus the Data layer" }).click();
    // Two writers to the database, one legacy write to the sheet, and the worker's read.
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(4);
    await architecture.getByRole("button", { name: "Focus the Data layer" }).click();
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(0);
  });

  test("every connection can be drawn at once, and put away again", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    const every = architecture.getByRole("button", { name: "Every connection" });
    await expect(every).toHaveAttribute("aria-pressed", "false");
    await every.click();
    await expect(every).toHaveAttribute("aria-pressed", "true");
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(18);
    await expect(architecture.locator("svg[data-links-state]")).toHaveAttribute("data-links-state", "off");
    await every.click();
    await expect(architecture.locator(".react-flow__edge")).toHaveCount(0);
    await expect(architecture.locator("svg[data-links-state]")).toHaveAttribute("data-links-state", "rest");
  });

  test("the still picture on the overview is drawn with the same lines", async ({ page }) => {
    await page.goto(CRM);
    const picture = page.locator("#system").getByRole("img", { name: /^The architecture of/ });
    await expect(picture.locator("[data-link]")).toHaveCount(7);
    // Every line has something to show: a path with a length.
    const lengths = await picture.locator("[data-link] path").evaluateAll((paths) => paths.map((path) => (path as SVGPathElement).getTotalLength()));
    expect(lengths.length).toBeGreaterThanOrEqual(7);
    for (const length of lengths) expect(length).toBeGreaterThan(10);
  });
});

test.describe("the diagram answers the pointer", () => {
  test("pointing at a component brings its connections forward without dimming the rest", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    const moving = architecture.locator(".react-flow__edge.animated");
    await expect(moving).toHaveCount(0);

    await architecture.getByRole("button", { name: /^Apps Script server:/ }).hover();
    expect(await moving.count()).toBeGreaterThan(3);
    await expect(architecture.locator(".react-flow__node-arch > div.opacity-30")).toHaveCount(0);
    // The keyboard does the same.
    await architecture.getByRole("heading", { level: 2, name: "System architecture" }).hover();
    await expect(moving).toHaveCount(0);
    await architecture.getByRole("button", { name: /^Supabase Postgres:/ }).focus();
    expect(await moving.count()).toBeGreaterThan(2);
  });

  test("every column is as tall as its own components", async ({ page }) => {
    await page.setViewportSize({ width: 1700, height: 950 });
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    const heights = await architecture.locator(".react-flow__node-zone").evaluateAll((zones) => zones.map((zone) => Math.round(zone.getBoundingClientRect().height)));
    expect(heights).toHaveLength(5);
    // Two components, two, two, three and five: the columns are not stretched to the tallest.
    expect(heights[0]).toBe(heights[1]);
    expect(heights[3]).toBeGreaterThan(heights[0] + 30);
    expect(heights[4]).toBeGreaterThan(heights[3] + 60);
    // And each one ends just under its last component, with no empty tint below it.
    const gaps = await architecture.locator(".react-flow__node-zone").evaluateAll((zones) => {
      const cards = [...document.querySelectorAll("#architecture .react-flow__node-arch")].map((card) => card.getBoundingClientRect());
      return zones.map((zone) => {
        const box = zone.getBoundingClientRect();
        const inside = cards.filter((card) => card.left >= box.left - 1 && card.right <= box.right + 1);
        return Math.round(box.bottom - Math.max(...inside.map((card) => card.bottom)));
      });
    });
    for (const gap of gaps) expect(gap).toBeLessThan(24);
  });
});
