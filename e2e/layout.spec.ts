import { expect, test, type Page } from "@playwright/test";

/**
 * Layout and navigation at the widths the design is built for. These run in
 * the desktop project and set their own viewport, so one file covers a phone,
 * a tablet, a laptop and a desktop.
 */
const CRM = "/projects/pest-control-crm";
const TRIAGE = "/projects/job-triage-pipeline";
const SOLANA = "/projects/solana-research-platform";
const MARKET = "/projects/market-data-platform";
const PAGES = [
  "/",
  "/projects",
  "/automation-lab",
  "/resume",
  "/source-access",
  CRM,
  TRIAGE,
  SOLANA,
  MARKET,
  "/projects/rug-inventory-sync",
  "/projects/lead-enrichment-engine",
  "/projects/rating-estimator",
  "/projects/review-intelligence-pipeline",
];
const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`No box for ${selector}`);
  return rect;
}

for (const size of WIDTHS) {
  test.describe(`at ${size.width}px (${size.name})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const path of PAGES) {
      test(`${path} fits the width in both lenses`, async ({ page }) => {
        for (const lens of ["recruiter", "engineer"]) {
          await page.goto(`${path}?lens=${lens}`);
          await page.waitForLoadState("networkidle");
          const { scrollWidth, clientWidth } = await overflow(page);
          expect(scrollWidth, `${lens} lens`).toBeLessThanOrEqual(clientWidth);
        }
      });
    }

    test("the header is one row and never wraps", async ({ page }) => {
      await page.goto("/");
      const header = await box(page, "body > header, header.sticky");
      expect(Math.round(header.height)).toBe(64);
      await expect(page.getByRole("banner").getByRole("link", { name: "Contact me" })).toBeVisible();
    });

    test("a deep link lands with its heading clear of the sticky bars", async ({ page }) => {
      for (const anchor of ["how-it-works", "results", "demo", "architecture", "decisions", "limitations", "evidence"]) {
        // A fresh load each time: this is someone opening a shared link, not jumping within the page.
        await page.goto("about:blank");
        await page.goto(`${CRM}#${anchor}`);
        const heading = page.locator(`#${anchor}-title`);
        await expect(heading).toBeInViewport();
        const measure = () =>
          page.evaluate(() => {
            const header = document.querySelector("header")!.getBoundingClientRect();
            // The tab bar sits in a strip that sticks under the header.
            const sections = document.querySelector("[data-tabbar]")!.parentElement!.getBoundingClientRect();
            return { headerBottom: header.bottom, sectionsTop: sections.top, sectionsBottom: sections.bottom };
          });
        // The jump is animated, so wait for it to come to rest: the two bars stacked, not overlapping, and the
        // heading below them, near the top. On a short first screen the heading is in view before the jump even
        // starts, so being in view is not yet being at rest.
        await expect
          .poll(async () => {
            const bars = await measure();
            const top = (await heading.boundingBox())?.y ?? -1;
            return Math.round(bars.sectionsTop) === Math.round(bars.headerBottom) && top > bars.sectionsBottom && top < bars.sectionsBottom + 160;
          }, { message: `#${anchor}: the tab bar sits against the header and the heading rests just below the bars` })
          .toBe(true);
      }
    });

    test("the tab bar opens one section at a time and keeps the address in step", async ({ page }) => {
      await page.goto(CRM);
      const nav = page.getByRole("navigation", { name: "Sections of this case study" });
      await expect(nav.getByRole("link")).toHaveText(["Overview", "Demo", "Architecture", "Decisions", "Limits", "Evidence"]);
      await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "true");
      await expect(page.locator("#overview")).toBeVisible();
      await expect(page.locator("#architecture")).toBeHidden();

      await nav.getByRole("link", { name: "Architecture" }).click();
      await expect(page).toHaveURL(/#architecture$/);
      await expect(nav.getByRole("link", { name: "Architecture" })).toHaveAttribute("aria-current", "true");
      await expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current", "true");
      await expect(page.locator("#architecture-title")).toBeInViewport();
      await expect(page.locator("#overview")).toBeHidden();
      // The current tab stays visible inside the bar, even where the bar scrolls sideways.
      await expect(nav.getByRole("link", { name: "Architecture" })).toBeInViewport();

      await nav.getByRole("link", { name: "Decisions" }).click();
      await expect(nav.getByRole("link", { name: "Decisions" })).toHaveAttribute("aria-current", "true");
      await expect(page.locator("#decisions")).toBeVisible();

      // Back and forward walk the tabs, like pages.
      await page.goBack();
      await expect(page).toHaveURL(/#architecture$/);
      await expect(page.locator("#architecture")).toBeVisible();
      await expect(page.locator("#decisions")).toBeHidden();
      await page.goForward();
      await expect(page.locator("#decisions")).toBeVisible();
    });

    test("a link to a tab opens it with the current tab in view in the bar", async ({ page }) => {
      await page.goto(`${CRM}#evidence`);
      const nav = page.getByRole("navigation", { name: "Sections of this case study" });
      await expect(page.locator("html")).toHaveAttribute("data-tab", "evidence");
      await expect(nav.getByRole("link", { name: "Evidence" })).toHaveAttribute("aria-current", "true");
      await expect(nav.getByRole("link", { name: "Evidence" })).toBeInViewport();
      await expect(page.locator("#evidence")).toBeVisible();
      await expect(page.locator("#overview")).toBeHidden();
      // A link to a section inside a tab opens that tab.
      await page.goto("about:blank");
      await page.goto(`${CRM}#results`);
      await expect(page.locator("html")).toHaveAttribute("data-tab", "overview");
      await expect(page.locator("#results-title")).toBeInViewport();
    });

    for (const tab of ["demo", "architecture", "decisions", "limitations", "evidence"]) {
      test(`the ${tab} tab fits the width in both lenses`, async ({ page }) => {
        for (const lens of ["recruiter", "engineer"]) {
          await page.goto("about:blank");
          await page.goto(`${CRM}?lens=${lens}#${tab}`);
          await page.waitForLoadState("networkidle");
          await expect(page.locator(`#${tab}`)).toBeVisible();
          const { scrollWidth, clientWidth } = await overflow(page);
          expect(scrollWidth, `${lens} lens`).toBeLessThanOrEqual(clientWidth);
        }
      });
    }

    test("links to About and Contact land under the header", async ({ page }) => {
      for (const anchor of ["about", "contact"]) {
        await page.goto("about:blank");
        await page.goto(`/#${anchor}`);
        const heading = page.locator(`#${anchor}-title`);
        await expect(heading).toBeInViewport();
        const headerBottom = await page.evaluate(() => document.querySelector("header")!.getBoundingClientRect().bottom);
        await expect.poll(async () => (await heading.boundingBox())?.y ?? -1).toBeGreaterThan(headerBottom);
      }
      // The same jump from inside the page, once it has settled.
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.locator("#about").getByRole("link", { name: "Get in touch" }).click();
      await expect(page).toHaveURL(/#contact$/);
      await expect(page.locator("#contact-title")).toBeInViewport();
    });

    test("the architecture diagram opens at a readable size", async ({ page }) => {
      await page.goto(`${CRM}#architecture`);
      const architecture = page.locator("#architecture");
      const node = architecture.locator(".react-flow__node-arch").first();
      await expect(node).toBeVisible();
      // A component card is 176 units wide; below about 135px its label is under 10.5px on screen.
      await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(135);
      const label = architecture.getByRole("button", { name: /^Green API:/ }).locator("span").filter({ hasText: /^Green API$/ });
      const fontSize = await label.evaluate((element) => parseFloat(getComputedStyle(element).fontSize) * element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth);
      expect(fontSize).toBeGreaterThanOrEqual(10.5);
    });

    test("the whole graph is one tap away and every component stays reachable", async ({ page }) => {
      await page.goto(`${CRM}#architecture`);
      const architecture = page.locator("#architecture");
      await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
      await architecture.getByRole("button", { name: "Full graph" }).first().click();
      const canvas = (await architecture.getByLabel("Architecture diagram").boundingBox())!;
      // After fitting, every component is inside the canvas.
      await expect
        .poll(async () => {
          const boxes = await architecture.locator(".react-flow__node-arch").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
          return boxes.every((rect) => rect.left >= canvas.x - 2 && rect.right <= canvas.x + canvas.width + 2);
        })
        .toBe(true);
      // The list alternative is always there for anyone who would rather read it.
      await expect(architecture.getByText("Read the architecture as a list")).toBeVisible();
    });
  });
}

test.describe("navigation on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("marks the current page in the main navigation", async ({ page }) => {
    const main = page.getByRole("navigation", { name: "Main", exact: true });
    await page.goto("/");
    await expect(main.getByRole("link")).toHaveText(["Home", "Projects", "Automation Lab", "About", "Resume"]);
    await expect(main.locator('[aria-current="page"]')).toHaveText(["Home"]);
    await page.goto("/projects");
    await expect(main.locator('[aria-current="page"]')).toHaveText(["Projects"]);
    await page.goto(CRM);
    await expect(main.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    await page.goto("/automation-lab");
    await expect(main.getByRole("link", { name: "Automation Lab" })).toHaveAttribute("aria-current", "page");
    await expect(main.getByRole("link", { name: "Projects" })).not.toHaveAttribute("aria-current", "page");
    await page.goto("/resume");
    await expect(main.locator('[aria-current="page"]')).toHaveText(["Resume"]);
  });

  test("moves between every page through the navigation", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("navigation", { name: "Main", exact: true });
    await main.getByRole("link", { name: "Automation Lab" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Run the workflows");
    await main.getByRole("link", { name: "Projects" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Systems, with their evidence");
    await main.getByRole("link", { name: "Resume" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Elsayed Mustafa");
    await main.getByRole("link", { name: "About" }).click();
    await expect(page).toHaveURL(/\/#about$/);
    await expect(page.locator("#about-title")).toBeInViewport();
    await page.getByRole("banner").getByRole("link", { name: "Contact me" }).click();
    await expect(page).toHaveURL(/\/#contact$/);
    await expect(page.locator("#contact-title")).toBeInViewport();
  });

  test("a case study ends with a way onwards", async ({ page }) => {
    await page.goto(CRM);
    const next = page.getByRole("region", { name: "Next steps" });
    await expect(next.getByRole("link", { name: "See all work" })).toBeVisible();
    await expect(next.getByRole("link", { name: /Email me/ })).toHaveAttribute("href", /^mailto:/);
    await next.getByRole("link", { name: "Read it" }).click();
    await expect(page).toHaveURL(/\/projects\/review-intelligence-pipeline$/);
  });

  test("the demo shows the steps and the inspector side by side", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeVisible();
    await expect(sim.getByTestId("inspector-panel")).toBeVisible();
    await expect(sim.getByRole("group", { name: "Show" })).toBeHidden();
  });
});

test.describe("navigation on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the menu, shows where you are, and closes on Escape", async ({ page }) => {
    await page.goto("/projects");
    const toggle = page.getByRole("button", { name: "Menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("navigation", { name: "Main", exact: true })).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("navigation", { name: "Main, mobile" });
    await expect(menu.getByRole("link")).toHaveText(["Home", /Projects/, "Automation Lab", "About", "Resume", "Contact"]);
    await expect(menu.getByRole("link", { name: /Projects/ })).toHaveAttribute("aria-current", "page");

    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
  });

  test("navigates from the menu and closes it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("navigation", { name: "Main, mobile" }).getByRole("link", { name: "Automation Lab" }).click();
    await expect(page).toHaveURL(/\/automation-lab$/);
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("changes the level of detail and the theme from the menu", async ({ page }) => {
    await page.goto(CRM);
    await page.getByRole("button", { name: "Menu" }).click();
    const menu = page.locator("#site-menu");
    await menu.getByRole("button", { name: "Engineer" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-lens", "engineer");
    const before = await page.locator("html").getAttribute("data-theme");
    await menu.getByRole("button", { name: /^Switch to (dark|light) theme$/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", before === "dark" ? "light" : "dark");
  });

  test("the demo shows one pane at a time and follows the run", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    const show = sim.getByRole("group", { name: "Show" });
    await expect(show.getByRole("button", { name: "Steps" })).toHaveAttribute("aria-pressed", "true");
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeVisible();
    await expect(sim.getByTestId("inspector-panel")).toBeHidden();

    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    const choice = sim.getByRole("button", { name: /Interested, book a visit/ });
    await expect(choice).toBeInViewport();
    await choice.click();
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked");

    // Tapping a step in the strip opens its details in place of the list.
    await sim.getByRole("button", { name: "Step 10, Write the appointment: Success" }).click();
    await expect(show.getByRole("button", { name: "Inspector" })).toHaveAttribute("aria-pressed", "true");
    await expect(sim.getByTestId("inspector-panel").getByRole("heading", { name: "Write the appointment" })).toBeVisible();
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeHidden();
    await sim.getByRole("tab", { name: "Payload" }).click();
    await expect(sim.getByTestId("inspector-panel").getByText('"appointmentId": "APPT-311"')).toBeVisible();

    await show.getByRole("button", { name: "Steps" }).click();
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeVisible();
  });

  test("failures can be injected from the setup tab", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByRole("button", { name: "Edit input and failures" }).click();
    await sim.getByLabel(/Double-book the crew/).check();
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
    await expect(sim.getByTestId("run-outcome")).toContainText("No appointment was written.");
  });

  test("component details open as a sheet over the page", async ({ page }) => {
    // A phone shows the first columns of the diagram; a component there opens its details as a sheet.
    for (const [path, region, name] of [[`${CRM}#architecture`, "#architecture", "Office web app"]]) {
      await page.goto("about:blank");
      await page.goto(path);
      const architecture = page.locator(region);
      await architecture.getByRole("button", { name: new RegExp(`^${name}:`) }).click();
      const details = architecture.getByRole("complementary", { name: `Details for ${name}` });
      await expect(details).toBeInViewport();
      // The sheet eases in; measure it once it has come to rest against the bottom edge.
      await expect.poll(async () => Math.round(((await details.boundingBox())?.y ?? 0) + ((await details.boundingBox())?.height ?? 0))).toBe(844);
      const sheet = (await details.boundingBox())!;
      expect(Math.round(sheet.x)).toBe(0);
      expect(Math.round(sheet.width)).toBe(390);
      await details.getByRole("button", { name: "Close component details" }).click();
      await expect(details).toBeHidden();
    }
  });
});

test.describe("keyboard and motion", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the first Tab offers a skip link, and focus is always visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);

    await page.goto("/");
    for (let index = 0; index < 4; index += 1) await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test("the demo can be run from the keyboard alone", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).focus();
    await page.keyboard.press("Enter");
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
    await sim.getByRole("button", { name: /Interested, book a visit/ }).focus();
    await page.keyboard.press("Enter");
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked");
    await sim.getByRole("tab", { name: "Logs" }).focus();
    await page.keyboard.press("Enter");
    await expect(sim.getByRole("tab", { name: "Logs" })).toHaveAttribute("aria-selected", "true");
  });

  test("every control on the demo and the diagram has a name", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    await expect(page.locator("#architecture .react-flow__node-arch")).toHaveCount(14);
    const unnamed = await page.locator("main button, main select, main input, main textarea, main a[href]").evaluateAll((elements) =>
      elements
        .filter((element) => {
          const id = element.getAttribute("id");
          const labelled =
            element.getAttribute("aria-label") ||
            element.getAttribute("aria-labelledby") ||
            element.getAttribute("title") ||
            (element.textContent ?? "").trim() ||
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
            element.closest("label");
          return !labelled;
        })
        .map((element) => element.outerHTML.slice(0, 120)),
    );
    expect(unnamed).toEqual([]);
  });

  test("reduced motion switches off smooth scrolling and animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${CRM}#demo`);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByRole("button", { name: "Step", exact: true }).click();
    const durations = await sim.locator("svg.animate-spin, .status-pulse").evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element).animationDuration)),
    );
    for (const seconds of durations) expect(seconds).toBeLessThan(0.01);
  });
});
