import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Every case study is built from a manifest by the same components, so the
 * same checks run against all of them. The three added last also get checks of
 * what makes each one honest: what is private, what is not finished, and what
 * the author did not read.
 */
const STUDIES = [
  { path: "/projects/pest-control-crm", title: "Pest Control CRM and Field Operations" },
  { path: "/projects/review-intelligence-pipeline", title: "Marketplace Review Intelligence Pipeline" },
  { path: "/projects/solana-research-platform", title: "Solana Trading Research Platform" },
  { path: "/projects/market-data-platform", title: "Market Data and Alerting Platform" },
  { path: "/projects/job-triage-pipeline", title: "Job Triage Pipeline with LLM Guardrails" },
  { path: "/projects/rug-inventory-sync", title: "Rug Inventory and Shopify Synchronisation" },
  // The one project whose repository is public and linked: its references open the code.
  { path: "/projects/lead-enrichment-engine", title: "Lead Discovery and Contact Enrichment Engine", linked: true },
  { path: "/projects/rating-estimator", title: "Amazon Rating Estimator and Review-Removal Simulator" },
] as const;

const RUGS = STUDIES[5].path;
const LEADS = STUDIES[6].path;
const RATING = STUDIES[7].path;

function simulator(page: Page): Locator {
  return page.getByTestId("workflow-simulator");
}

function tabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sections of this case study" });
}

async function openTab(page: Page, label: string) {
  await tabs(page).getByRole("link", { name: label, exact: true }).click();
  await expect(tabs(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "true");
}

async function run(page: Page) {
  const sim = simulator(page);
  await sim.getByLabel("Speed").selectOption("0");
  await sim.getByRole("button", { name: /^Run (workflow|again)$/ }).click();
}

async function choosePreset(page: Page, label: string) {
  const chip = simulator(page).getByRole("button", { name: label, exact: true });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
}

async function decide(page: Page, choice: RegExp) {
  const button = simulator(page).getByRole("group", { name: "Decision needed" }).getByRole("button", { name: choice });
  await expect(button).toBeVisible();
  await button.click();
}

for (const study of STUDIES) {
  test.describe(`case study: ${study.title}`, () => {
    test("opens on an overview with the system, how it works and what it does", async ({ page }) => {
      await page.goto(study.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(study.title);
      await expect(page.locator("html")).toHaveAttribute("data-tab", "overview");
      await expect(page.locator("#system").getByRole("img", { name: /^The architecture of .*: \d+ components in \d+ layers\./ })).toBeVisible();
      expect(await page.locator("#how-it-works").getByRole("listitem").count()).toBeGreaterThanOrEqual(3);
      const side = page.getByRole("complementary", { name: "About this project" });
      // What it does is in the study, under "What I built"; the side column repeats it only in the Engineer view.
      expect(await page.locator("#summary li").count()).toBeGreaterThanOrEqual(3);
      await expect(side.getByRole("region", { name: "Key features" })).toBeHidden();
      const source = side.getByRole("region", { name: "Links and resources" }).getByRole("link", { name: /Source code/ });
      await expect(source).toHaveAttribute("href", "linked" in study ? /^https:\/\/github\.com\// : /^\/source-access\?project=/);
    });

    test("its demo runs to an outcome, whatever a person decides first", async ({ page }) => {
      await page.goto(`${study.path}#demo`);
      const sim = simulator(page);
      await expect(sim.getByText("Simulation", { exact: true })).toBeVisible();
      await run(page);
      // Take the first choice at every decision until the run settles.
      const outcome = sim.getByTestId("run-outcome");
      const decision = sim.getByRole("group", { name: "Decision needed" });
      for (let turn = 0; turn < 6; turn += 1) {
        await expect(outcome.or(decision)).toBeVisible();
        if (await outcome.isVisible()) break;
        await decision.getByRole("button").first().click();
      }
      await expect(outcome).toBeVisible();
      await expect(sim.getByTestId("run-status")).toHaveText(/^(Completed|Failed)$/);
    });

    test("its diagram draws every component, and every tab opens", async ({ page }) => {
      await page.goto(`${study.path}#architecture`);
      const nodes = page.locator("#architecture .react-flow__node-arch");
      await expect(nodes.first()).toBeVisible();
      expect(await nodes.count()).toBeGreaterThanOrEqual(10);
      for (const [label, id] of [
        ["Decisions", "decisions"],
        ["Limits", "limitations"],
        ["Evidence", "evidence"],
      ]) {
        await openTab(page, label);
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      if ("linked" in study) {
        // A public repository: the page opens it, and has nothing to request.
        await expect(page.locator("#evidence").getByRole("link", { name: "Open on GitHub" })).toBeVisible();
        await expect(page.locator("#evidence").getByRole("link", { name: "Request the source code" })).toHaveCount(0);
      } else {
        // The source is offered on request, never linked.
        await expect(page.locator("#evidence").getByRole("link", { name: "Request the source code" })).toBeVisible();
        await expect(page.locator('main a[href*="/blob/"], main a[href*="/tree/"]')).toHaveCount(0);
      }
    });
  });
}

test.describe("rug inventory: preview first, then a person decides", () => {
  test("nothing is written until the reviewer applies the batch, and new rugs wait for approval", async ({ page }) => {
    await page.goto(`${RUGS}#demo`);
    const sim = simulator(page);
    await run(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
    await decide(page, /^Apply the batch/);
    await decide(page, /^Leave them unapproved/);
    await expect(sim.getByTestId("run-outcome")).toContainText("Batch #41 applied: 2 new, 4 updated");
    await expect(sim.getByTestId("run-outcome")).toContainText(/unapproved|not approved/i);
  });

  test("deleting the preview leaves inventory and the storefront untouched", async ({ page }) => {
    await page.goto(`${RUGS}#demo`);
    const sim = simulator(page);
    await choosePreset(page, "A file cut short");
    await run(page);
    await decide(page, /^Delete the preview/);
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await expect(sim.getByTestId("run-outcome")).toContainText(/deleted/i);
    await expect(sim.getByTestId("run-outcome")).toContainText(/inventory/i);
  });

  test("shows the known gap: applying a file that was cut short marks rugs sold", async ({ page }) => {
    await page.goto(`${RUGS}#demo`);
    const sim = simulator(page);
    await choosePreset(page, "A file cut short");
    await run(page);
    await decide(page, /^Apply the batch/);
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("The file was cut short, so 6 rugs that may still be on the floor are now marked sold");
  });

  test("an account without the right role cannot import", async ({ page }) => {
    await page.goto(`${RUGS}#demo`);
    await choosePreset(page, "A bookkeeper uploads");
    await run(page);
    await expect(simulator(page).getByTestId("run-outcome")).toContainText("Upload refused: Importing needs an editor or an admin account. Nothing was read, stored or changed.");
  });

  test("the text does not name the client, the published screenshot is shown, and the limits are said to be invented", async ({ page }) => {
    for (const tab of ["", "#demo", "#decisions", "#limitations", "#evidence"]) {
      await page.goto("about:blank");
      await page.goto(`${RUGS}?lens=engineer${tab}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect((await page.locator("main").innerText()).toLowerCase()).not.toContain("adib");
    }
    await page.goto(`${RUGS}#screenshots`);
    const figure = page.locator("#screenshots figure");
    await expect(figure.getByRole("img")).toBeVisible();
    expect(await figure.getByRole("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1915);
    await expect(figure).toContainText("provided by the author. The signed-in account is covered.");
    await expect(figure).toContainText("not results claimed on this page");
    await page.goto(`${RUGS}#demo`);
    await expect(simulator(page).getByText(/The limits and timings are invented for the demo, because the real values are private/)).toBeVisible();
    await page.goto(`${RUGS}#evidence`);
    await expect(page.locator("#evidence").getByText("Private repository for this project.")).toBeVisible();
    await expect(page.locator("#evidence").getByRole("link", { name: /Public write-up/ })).toBeVisible();
  });

  test("says which parts are run by hand", async ({ page }) => {
    await page.goto(`${RUGS}#architecture`);
    await expect(page.locator("#architecture").getByRole("button", { name: /^New listing script \(run by hand\):/ })).toBeVisible();
    await openTab(page, "Limits");
    await expect(page.locator("#limitations").getByText("New listings are created by hand")).toBeVisible();
    await expect(page.locator("#limitations").getByText("No automated tests")).toBeVisible();
  });
});

test.describe("lead engine: a phone number has to earn the word verified", () => {
  test("a clear match fills the verified columns", async ({ page }) => {
    await page.goto(`${LEADS}#demo`);
    await run(page);
    await expect(simulator(page).getByTestId("run-outcome")).toContainText("Matched (High) (name score 1)");
    await expect(simulator(page).getByTestId("run-outcome")).toContainText("saved in the verified columns");
  });

  test("the right name in the wrong suburb is kept for review and not verified", async ({ page }) => {
    await page.goto(`${LEADS}#demo`);
    await choosePreset(page, "Right name, wrong suburb");
    await run(page);
    const outcome = simulator(page).getByTestId("run-outcome");
    await expect(outcome).toContainText("Name Match / Location Mismatch");
    await expect(outcome).toContainText("It is not copied to the verified columns and no website was visited.");
  });

  test("shows where the gate lets a wrong match through", async ({ page }) => {
    await page.goto(`${LEADS}#demo`);
    await choosePreset(page, "A namesake nearby");
    await run(page);
    const outcome = simulator(page).getByTestId("run-outcome");
    await expect(outcome).toContainText("Matched (High) (name score 0.944)");
    await expect(outcome).toContainText("This match is verified only through the shared-word boost");
    await openTab(page, "Limits");
    await expect(page.locator("#limitations").getByText("A namesake in the same suburb is verified")).toBeVisible();
    await expect(page.locator("#limitations").getByText("There are no automated tests")).toBeVisible();
  });

  test("a blocked lookup writes no row, so the next pass tries again", async ({ page }) => {
    await page.goto(`${LEADS}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Edit input and failures" }).click();
    await sim.getByLabel(/The map blocks the lookup/).check();
    await run(page);
    await expect(sim.getByTestId("run-outcome")).toContainText(/no row|not written|not saved/i);
  });

  test("describes the browser automation in plain terms and reports figures as the author's", async ({ page }) => {
    for (const tab of ["", "#decisions", "#limitations", "#evidence"]) {
      await page.goto("about:blank");
      await page.goto(`${LEADS}?lens=engineer${tab}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.locator("main").innerText()).not.toMatch(/stealth|undetect|fingerprint|evad|bypass/i);
    }
    await page.goto(`${LEADS}?lens=engineer#results`);
    const results = page.locator("#results");
    await expect(results.getByText("4,118 of 18,736")).toBeVisible();
    await expect(results.getByText("Documented by author").first()).toBeVisible();
    await expect(results.getByText(/The output files are not committed and the figure was not re-derived for this page/)).toBeVisible();
  });

  test("its file references open the public code at the lines they name", async ({ page }) => {
    await page.goto(`${LEADS}?lens=engineer#evidence`);
    const link = page.locator('#evidence a[href*="/blob/main/"]').first();
    await expect(link).toHaveAttribute("href", /^https:\/\/github\.com\/El-Sayed-Mustafa\/victoria-lead-engine\/blob\/main\//);
    await expect(page.locator("#evidence").getByText("The file references in the Engineer view link to the code.")).toBeVisible();
  });
});

test.describe("rating estimator: built from the public write-up only", () => {
  test("says whose product it is and what is not finished", async ({ page }) => {
    await page.goto(RATING);
    // The sentences behind status and role open with "Details"; the short view shows a few words each.
    await page.locator(".summary-toggle:visible").click();
    await expect(page.getByText("Engineer on the project at BlueBug.")).toBeVisible();
    await expect(page.getByText(/The asynchronous request pipeline is partly built/)).toBeVisible();
    // The parts that are not running yet are marked in the picture of the system and in the diagram.
    await expect(page.locator("#system").getByRole("img").locator("text").filter({ hasText: /^disabled$/ })).toHaveCount(4);
    await openTab(page, "Architecture");
    for (const name of ["Scraper module", "Worker", "Transactional email", "Report builder"]) {
      await expect(page.locator("#architecture").getByRole("button", { name: new RegExp(`^${name}:`) })).toContainText("disabled");
    }
    await openTab(page, "Evidence");
    await expect(page.locator("#evidence").getByText("The application source is private.")).toBeVisible();
    await expect(page.locator("#evidence").getByRole("link", { name: "Request the source code" })).toHaveAttribute("href", "/source-access?project=rating-estimator");
  });

  test("shows the tool as the author published it, and leaves out the screenshot with a real product's reviews", async ({ page }) => {
    await page.goto(`${RATING}#screenshots`);
    const figures = page.locator("#screenshots figure");
    await expect(figures).toHaveCount(1);
    await expect(figures.getByRole("img")).toHaveAttribute("alt", /Quick Rating Estimate/);
    await expect(page.locator("#screenshots")).toContainText("it shows the review identifiers of a real product");
  });

  test("labels nothing as verified in code, because the code was not read", async ({ page }) => {
    for (const tab of ["#results", "#decisions", "#limitations", "#evidence", "#architecture"]) {
      await page.goto("about:blank");
      await page.goto(`${RATING}?lens=engineer${tab}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // The legend under the overview explains every label; claims are everything else.
      const claims = page.locator("[data-main] :not(details) > *").getByText("Verified in code", { exact: true });
      await expect(claims.filter({ visible: true })).toHaveCount(0);
    }
  });

  test("shows the measured accuracy with its baseline and where the figures come from", async ({ page }) => {
    await page.goto(`${RATING}?lens=engineer#results`);
    const results = page.locator("#results");
    await expect(results.getByText("80.7%", { exact: true })).toBeVisible();
    await expect(results.getByText("about 68%", { exact: true })).toBeVisible();
    await expect(results.getByText(/The evaluation code and data are private and were not re-run for this page/).first()).toBeVisible();
  });

  test("the demo delivers a report without inventing a model estimate", async ({ page }) => {
    await page.goto(`${RATING}#demo`);
    const sim = simulator(page);
    await expect(sim.getByText(/no model estimate is shown/)).toBeVisible();
    await run(page);
    const outcome = sim.getByTestId("run-outcome");
    await expect(outcome).toContainText("Transparent average 4.4");
    await expect(outcome).toContainText("as a ceiling and not a to-do list");
    await expect(outcome).toContainText("The production headline comes from a trained model this page does not have");
  });

  test("the fourth request is refused and a target out of reach is refused honestly", async ({ page }) => {
    await page.goto(`${RATING}#demo`);
    const sim = simulator(page);
    await choosePreset(page, "A fourth request");
    await run(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("has used its 3 free requests. Nothing was queued and nothing was fetched.");

    await choosePreset(page, "A target out of reach");
    await run(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("the planner refused the target of 4.9");
  });

  test("an expired code queues nothing", async ({ page }) => {
    await page.goto(`${RATING}#demo`);
    await choosePreset(page, "An expired code");
    await run(page);
    await expect(simulator(page).getByTestId("run-status")).toHaveText("Failed");
    await expect(simulator(page).getByTestId("run-outcome")).toContainText("Nothing was queued and no free request was used.");
  });
});

test.describe("the home page with eight case studies", () => {
  test("features four in full and leads to the rest", async ({ page }) => {
    await page.goto("/");
    const work = page.locator("#work");
    await expect(work.locator("article").filter({ has: page.getByRole("link", { name: /^Read the case study: / }) })).toHaveCount(4);
    await expect(work.getByRole("link", { name: "All 9 projects" })).toHaveAttribute("href", "/projects");
    await page.goto("/projects");
    for (const study of STUDIES.slice(4)) {
      await expect(page.locator(`a[href="${study.path}"]`).first()).toBeVisible();
    }
  });
});
