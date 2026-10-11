import { expect, test } from "@playwright/test";

/** These run in the "mobile" project: a real phone profile with touch and a mobile user agent. */
const PAGES = [
  "/",
  "/projects",
  "/automation-lab",
  "/resume",
  "/source-access",
  "/projects/pest-control-crm",
  "/projects/job-triage-pipeline",
  "/projects/solana-research-platform",
  "/projects/market-data-platform",
  "/projects/rug-inventory-sync",
  "/projects/lead-enrichment-engine",
  "/projects/rating-estimator",
  "/projects/review-intelligence-pipeline",
];

test.describe("on a phone", () => {
  for (const path of PAGES) {
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }

  test("the CRM demo runs to completion", async ({ page }) => {
    await page.goto("/projects/pest-control-crm#demo");
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
    const choice = sim.getByRole("button", { name: /Interested, book a visit/ });
    await expect(choice).toBeInViewport();
    await choice.click();
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked");
  });

  test("the triage demo runs to completion from the Automation Lab", async ({ page }) => {
    await page.goto("/automation-lab?workflow=posting-to-decision");
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    // A decision button's name starts with its label and may continue with a description.
    for (const answer of [/^Applied/, /^Yes, I applied/, /^A rejection/]) {
      const choice = sim.getByRole("button", { name: answer });
      await expect(choice).toBeInViewport();
      await choice.click();
    }
    await expect(sim.getByTestId("run-outcome")).toContainText('outcome "rejected"');
  });

  test("the market data demo reaches its human decision and finishes", async ({ page }) => {
    await page.goto("/automation-lab?workflow=slot-to-alert");
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByRole("button", { name: "Edit input and failures" }).click();
    await sim.getByLabel(/Both providers are unreachable/).check();
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    const choice = sim.getByRole("button", { name: /^Leave it dead/ });
    await expect(choice).toBeInViewport();
    await choice.click();
    await expect(sim.getByTestId("run-outcome")).toContainText("stays in the heartbeat's report for 24 hours");
  });

  test("the trading research demo reaches its human decision and finishes", async ({ page }) => {
    await page.goto("/automation-lab?workflow=signal-to-evidence");
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    const choice = sim.getByRole("button", { name: /^Retire it/ });
    await expect(choice).toBeInViewport();
    await choice.click();
    await expect(sim.getByTestId("run-outcome")).toContainText("a rejected hypothesis is a result too");
  });

  test("the architecture diagram and its details panel are usable", async ({ page }) => {
    await page.goto("/projects/pest-control-crm#architecture");
    const architecture = page.locator("#architecture");
    // A phone shows the first columns at a readable size and says so, with the rest one tap away.
    // On a phone the layers are stacked top to bottom: nothing to drag, and every component is on the page.
    const stack = architecture.locator("[data-layer-stack]");
    await expect(stack.getByRole("region")).toHaveCount(5);
    await expect(stack.getByRole("button")).toHaveCount(14);
    const tops = await stack.getByRole("region").evaluateAll((layers) => layers.map((layer) => layer.getBoundingClientRect().top));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    await expect(architecture.locator(".react-flow")).toHaveCount(0);
    await architecture.getByRole("button", { name: /^Office web app:/ }).click();
    await expect(architecture.getByRole("complementary", { name: "Details for Office web app" })).toBeVisible();
    await architecture.getByRole("button", { name: "Close component details" }).click();
    // Following a request numbers the components its hops arrive at and lets the rest step back.
    await architecture.getByRole("button", { name: "Data flow" }).click();
    await architecture.getByRole("group", { name: "Follow a request" }).getByRole("button").first().click();
    expect(await stack.locator("[data-dimmed]").count()).toBeGreaterThan(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("the menu reaches every page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("navigation", { name: "Main, mobile" }).getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Systems, with their evidence");
  });
});
