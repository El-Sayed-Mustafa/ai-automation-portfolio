import { expect, test } from "@playwright/test";

/**
 * What someone who has never seen the site gets from a demo: a few stages, a
 * signal that moves forward, one plain sentence, and nothing technical until
 * they ask. Every other test starts with the details unfolded (see
 * playwright.config.ts); these start as a first visit does.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const CRM = "/projects/pest-control-crm";

test.describe("a demo on a first visit", () => {
  test("opens simple: stages, one sentence, and no technical controls", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    await expect(sim.getByRole("list", { name: "Stages of this workflow" }).getByRole("listitem")).toHaveText([/Intake/, /Human decision/, /Booking/, /Background work/]);
    await expect(sim.getByTestId("story-now")).toContainText("Press “Run workflow” and follow it through 4 stages.");
    // The long description waits with the steps; the page still says in a few words what the run is.
    await expect(sim.getByTestId("story-now")).toContainText("Invented data, nothing real is called.");
    await expect(sim.getByTestId("mode-note")).toBeHidden();
    await expect(sim.getByRole("button", { name: "Run workflow" })).toBeVisible();
    // The step list, the inspector and the controls only an engineer needs are folded away.
    for (const name of ["Step", "Replay", "Reset", "Cancel", "Edit input and failures"]) await expect(sim.getByRole("button", { name, exact: true })).toBeHidden();
    await expect(sim.getByLabel("Speed")).toBeHidden();
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeHidden();
    await expect(sim.getByTestId("inspector-panel")).toBeHidden();
    // It still says what it is.
    await expect(sim.getByText("Simulation", { exact: true })).toBeVisible();
  });

  test("tells the run as a story that only moves forward, and stops for the person's decision", async ({ page }) => {
    test.slow();
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    const stages = sim.getByRole("list", { name: "Stages of this workflow" }).getByRole("listitem");
    const order = async () => (await stages.evaluateAll((items) => items.map((item) => item.getAttribute("data-phase-state")))).join(",");
    await sim.getByRole("button", { name: "Run workflow" }).click();

    // Sampled while it plays: once a stage is done it never goes back to waiting its turn.
    const seen: string[] = [];
    await expect
      .poll(
        async () => {
          seen.push(await order());
          return sim.getByRole("group", { name: "Decision needed" }).isVisible();
        },
        { timeout: 50_000, intervals: [300] },
      )
      .toBe(true);
    const rank = (state: string) => (state === "pending" ? 0 : 1);
    for (let i = 1; i < seen.length; i += 1) {
      const [before, after] = [seen[i - 1].split(","), seen[i].split(",")];
      before.forEach((state, stage) => expect(rank(after[stage]), `stage ${stage + 1}: ${seen[i - 1]} then ${seen[i]}`).toBeGreaterThanOrEqual(rank(state)));
    }
    await expect(stages.nth(0)).toHaveAttribute("data-phase-state", "done");
    await expect(stages.nth(1)).toHaveAttribute("data-phase-state", "waiting");
    // One plain sentence says what is happening, and who does it.
    const now = sim.getByTestId("story-now");
    await expect(now.getByRole("list", { name: "Steps of Human decision" }).getByRole("listitem")).toHaveAttribute("data-step-mark", "waiting");
    await expect(now).toContainText("A person decides what happens next. In this demo that person is you.");

    await sim.getByRole("group", { name: "Decision needed" }).getByRole("button").first().click();
    await expect(sim.getByTestId("run-outcome")).toBeVisible({ timeout: 60_000 });
    await expect(stages.nth(3)).toHaveAttribute("data-phase-state", "done");
  });

  test("unfolds every step and its data on request, and remembers it", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    const more = sim.getByRole("button", { name: "See all 13 steps and their data" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeVisible();
    await expect(sim.getByLabel("Speed")).toBeVisible();
    await expect(sim.getByRole("button", { name: "Step", exact: true })).toBeVisible();
    await page.reload();
    await expect(sim.getByRole("button", { name: "Hide the steps and their data" })).toHaveAttribute("aria-expanded", "true");
    await sim.getByRole("button", { name: "Hide the steps and their data" }).click();
    await expect(sim.getByRole("list", { name: "Workflow steps" })).toBeHidden();
  });

  test("is as simple on a phone, and fits the screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${CRM}#demo`);
    const sim = page.getByTestId("workflow-simulator");
    await expect(sim.getByRole("list", { name: "Stages of this workflow" }).getByRole("listitem")).toHaveCount(4);
    await sim.getByRole("button", { name: "Run workflow" }).click();
    await expect(sim.getByRole("group", { name: "Decision needed" })).toBeVisible({ timeout: 50_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
