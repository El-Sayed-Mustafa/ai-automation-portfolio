import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The parts of a case study that are not the demo or the full diagram: the
 * project rail and its drawer, the summary under the title, the picture of the
 * system on the overview, the side column, the screenshots, and the tabs with
 * JavaScript off.
 */
const CRM = "/projects/pest-control-crm";
const SOLANA = "/projects/solana-research-platform";
const RUGS = "/projects/rug-inventory-sync";

function tabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sections of this case study" });
}

async function expectTab(page: Page, id: string) {
  await expect(page.locator("html")).toHaveAttribute("data-tab", id);
  // The router may keep the previous page in the document, hidden; exactly one panel with this id is shown.
  await expect(page.locator(`#${id}:visible`)).toHaveCount(1);
}

test.describe("the project list in the short view", () => {
  test.use({ viewport: { width: 1700, height: 950 } });

  test("is a button above the title, so the study is the only thing to read", async ({ page }) => {
    await page.goto(CRM);
    await expect(page.getByRole("navigation", { name: "Projects", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "All projects (8)" }).click();
    const drawer = page.getByRole("dialog", { name: "Projects" });
    await expect(drawer.locator('[aria-current="page"]')).toHaveText(/Pest Control CRM and Field Operations/);
    await drawer.getByRole("link", { name: /Solana Trading Research Platform/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Solana Trading Research Platform");
  });
});

test.describe("the project rail", () => {
  // From 1660px the rail is an open list unless the visitor folded it.
  test.use({ viewport: { width: 1700, height: 950 } });
  // The rail is part of the Engineer view; the short view lists the projects behind a button.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("lens", "engineer"));
  });

  test("lists every project, marks the current one and opens another", async ({ page }) => {
    await page.goto(CRM);
    const rail = page.getByRole("navigation", { name: "Projects", exact: true });
    await expect(rail.getByRole("heading", { name: /Projects \(\d+\)/ })).toBeVisible();
    await expect(rail.locator('[aria-current="page"]')).toHaveText(/Pest Control CRM and Field Operations/);
    await rail.getByRole("link", { name: /Solana Trading Research Platform/ }).click();
    await expect(page).toHaveURL(new RegExp(`${SOLANA}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Solana Trading Research Platform");
    await expect(rail.locator('[aria-current="page"]')).toHaveText(/Solana Trading Research Platform/);
    // A new project opens on its overview, and its own links still work: the page it replaced is not in the way.
    await expectTab(page, "overview");
    await page.locator("[data-main]:visible").getByRole("link", { name: "Try the demo" }).click();
    await expectTab(page, "demo");
    await expect(page.getByTestId("workflow-simulator").getByRole("heading", { level: 3 }).first()).toBeInViewport();
  });

  test("searches the list by name, summary or tag", async ({ page }) => {
    await page.goto(CRM);
    const rail = page.getByRole("navigation", { name: "Projects", exact: true });
    const all = await rail.getByRole("link").count();
    await rail.getByRole("searchbox", { name: "Search projects" }).fill("solana");
    await expect(rail.getByRole("link")).toHaveCount(1);
    await expect(rail.getByRole("link")).toContainText("Solana Trading Research Platform");
    await rail.getByRole("searchbox", { name: "Search projects" }).fill("no such project");
    await expect(rail.getByRole("status")).toContainText("No project matches");
    await rail.getByRole("searchbox", { name: "Search projects" }).fill("");
    await expect(rail.getByRole("link")).toHaveCount(all);
  });

  test("folds to a rail of icons, gives the room to the study, and remembers it", async ({ page }) => {
    await page.goto(CRM);
    const rail = page.getByRole("navigation", { name: "Projects", exact: true });
    const main = page.locator("[data-main]");
    const wide = (await main.boundingBox())!.width;

    await rail.getByRole("button", { name: "Fold the project list" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-rail", "collapsed");
    await expect(rail.getByRole("searchbox", { name: "Search projects" })).toBeHidden();
    // The projects are still one click away, by icon, and keep their names.
    await expect(rail.getByRole("link", { name: /Solana Trading Research Platform/ })).toBeVisible();
    expect((await main.boundingBox())!.width).toBeGreaterThan(wide + 100);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-rail", "collapsed");
    const unfold = rail.getByRole("button", { name: "Show the project list" });
    await expect(unfold).toHaveAttribute("aria-expanded", "false");
    await unfold.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-rail", "collapsed");
    await expect(rail.getByRole("searchbox", { name: "Search projects" })).toBeVisible();
  });

  test("the three columns fit side by side", async ({ page }) => {
    await page.goto(CRM);
    const rail = (await page.getByRole("navigation", { name: "Projects", exact: true }).boundingBox())!;
    const main = (await page.locator("[data-main]").boundingBox())!;
    const side = (await page.getByRole("complementary", { name: "About this project" }).boundingBox())!;
    expect(rail.x + rail.width).toBeLessThanOrEqual(main.x);
    expect(main.x + main.width).toBeLessThanOrEqual(side.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe("the project rail on a laptop", () => {
  // The rail is part of the Engineer view; the short view lists the projects behind a button.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("lens", "engineer"));
  });
  test("is a strip of icons that opens into the list and remembers it", async ({ page }) => {
    await page.goto(CRM);
    const rail = page.getByRole("navigation", { name: "Projects", exact: true });
    // Folded by default at this width: every project is there by icon, the search is not.
    await expect(rail.getByRole("link", { name: /Solana Trading Research Platform/ })).toBeVisible();
    await expect(rail.locator('[aria-current="page"]')).toHaveAttribute("title", "Pest Control CRM and Field Operations");
    await expect(rail.getByRole("searchbox", { name: "Search projects" })).toBeHidden();
    await expect(page.getByRole("button", { name: /^All projects/ })).toBeHidden();
    const strip = (await rail.boundingBox())!.width;
    expect(strip).toBeLessThan(90);

    const unfold = rail.getByRole("button", { name: "Show the project list" });
    await expect(unfold).toHaveAttribute("aria-expanded", "false");
    await unfold.click();
    await expect(page.locator("html")).toHaveAttribute("data-rail", "expanded");
    await expect(rail.getByRole("searchbox", { name: "Search projects" })).toBeVisible();
    expect((await rail.boundingBox())!.width).toBeGreaterThan(strip + 150);
    await expect(page.getByRole("complementary", { name: "About this project" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-rail", "expanded");
    await expect(rail.getByRole("searchbox", { name: "Search projects" })).toBeVisible();
  });
});

for (const size of [
  { name: "tablet", width: 820, height: 1100 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`the project list on a ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("is a drawer: it opens from a button, searches, closes, and opens another project", async ({ page }) => {
      await page.goto(CRM);
      // No rail at this width, so the only list is the one in the drawer.
      const open = page.getByRole("button", { name: "All projects (8)" });
      const drawer = page.getByRole("dialog", { name: "Projects" });
      await expect(drawer).toBeHidden();
      await open.click();
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[aria-current="page"]')).toHaveText(/Pest Control CRM and Field Operations/);
      const box = (await drawer.boundingBox())!;
      expect(Math.round(box.x)).toBe(0);
      expect(box.width).toBeLessThanOrEqual(size.width);

      await drawer.getByRole("searchbox", { name: "Search projects" }).fill("shopify");
      await expect(drawer.getByRole("link")).toHaveCount(1);
      // In a search field Escape clears what was typed first; the next one closes the drawer.
      await page.keyboard.press("Escape");
      await expect(drawer.getByRole("searchbox", { name: "Search projects" })).toHaveValue("");
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(open).toBeFocused();

      await open.click();
      await drawer.getByRole("button", { name: "Close the project list" }).click();
      await expect(drawer).toBeHidden();

      await open.click();
      await drawer.getByRole("link", { name: /Rug Inventory and Shopify Synchronisation/ }).click();
      await expect(page).toHaveURL(new RegExp(`${RUGS}$`));
      await expect(page.locator("h1:visible")).toHaveText("Rug Inventory and Shopify Synchronisation");
      await expect(page.getByRole("dialog", { name: "Projects" })).toBeHidden();
    });
  });
}

test.describe("the picture of the system on the overview", () => {
  test("is drawn from the project's own components, marks what is off, and leads to the diagram", async ({ page }) => {
    await page.goto(CRM);
    const system = page.locator("#system");
    await expect(system.getByRole("heading", { level: 3, name: "System architecture" })).toBeVisible();
    // One image with a description for a screen reader; the components are listed in the Architecture tab.
    const picture = system.getByRole("img", { name: /^The architecture of Pest Control CRM and Field Operations: 14 components in 5 layers\./ });
    await expect(picture).toBeVisible();
    // The same layers and components as the interactive diagram, by name.
    await expect(picture.locator("text").filter({ hasText: /^(Clients|Application|Data|Background work|External services)$/ })).toHaveCount(5);
    for (const name of ["Office web app", "Edge Function crm-api", "Supabase Postgres", "Outbox table", "Green API"]) {
      await expect(picture.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(picture.locator("foreignObject")).toHaveCount(14);
    // One line for each pair of connected layers, as in the diagram at rest: seven lines for eighteen connections.
    await expect(picture.locator("[data-link]")).toHaveCount(7);
    // What is legacy or switched off is marked here too, not only in the diagram.
    await expect(picture.locator("text").filter({ hasText: /^(legacy|disabled)$/ })).toHaveText(["legacy", "disabled"]);
    // It fits its card, and the card fits the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await system.getByRole("link", { name: "Explore the diagram" }).click();
    await expect(page).toHaveURL(/#architecture$/);
    await expectTab(page, "architecture");
    await expect(page.locator("#architecture .react-flow__node-arch")).toHaveCount(14);
  });

  test("the picture itself opens the diagram, and needs no script to be seen", async ({ page }) => {
    await page.goto(SOLANA);
    const system = page.locator("#system");
    await expect(system.getByRole("img", { name: /^The architecture of Solana Trading Research Platform: 16 components/ })).toBeVisible();
    // Nothing of the diagram library is on the overview: the picture is plain markup from the server.
    await expect(page.locator("#overview .react-flow")).toHaveCount(0);
    await system.getByRole("link", { name: /^The architecture of Solana Trading Research Platform/ }).click();
    await expectTab(page, "architecture");
  });

  test("is stacked top to bottom on a phone, at a size that can be read", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CRM);
    const system = page.locator("#system");
    const picture = system.getByRole("img", { name: /^The architecture of/ });
    await expect(picture).toHaveCount(1);
    const box = (await picture.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThan(box.width);
    await expect(picture.getByText("Supabase Postgres", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe("the first screen of a case study", () => {
  test("says what the project is, with its status and the author's role", async ({ page }) => {
    await page.goto(CRM);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pest Control CRM and Field Operations");
    await expect(page.getByRole("list", { name: "Kind of project and technology" }).getByRole("listitem").first()).toBeVisible();
    await expect(page.getByText("In production", { exact: true })).toBeVisible();
    await expect(page.getByText("My role", { exact: true })).toBeVisible();
  });

  test("keeps the summary to a few words each and opens the rest in place", async ({ page }) => {
    await page.goto(SOLANA);
    const header = page.locator("[data-main] header");
    const summary = header.getByRole("list", { name: "Status, role and context" });
    await expect(summary.getByRole("listitem")).toContainText(["Status", "My role", "Context"]);
    await expect(summary.getByText("Running, on paper by default", { exact: true })).toBeVisible();
    await expect(summary.getByText("Owner and engineer", { exact: true })).toBeVisible();
    await expect(summary.getByText("Personal project", { exact: true })).toBeVisible();
    // Each short value still says where it comes from, as a mark; the words are in the details.
    await expect(summary.locator('[title^="Stated by owner"]')).toBeVisible();
    const evidence = summary.locator("[data-evidence]");
    await expect(evidence.first()).toBeHidden();
    // The whole row is short: this is what replaces three paragraphs.
    const closed = (await summary.boundingBox())!.height;
    expect(closed).toBeLessThan(110);

    const toggle = header.getByRole("button", { name: "Details" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const less = header.getByRole("button", { name: "Show less" });
    await expect(less).toHaveAttribute("aria-expanded", "true");
    await expect(evidence.first()).toBeVisible();
    await expect(summary.getByText("Stated by owner", { exact: true }).last()).toBeVisible();
    expect((await summary.boundingBox())!.height).toBeGreaterThan(closed);
    await less.click();
    await expect(evidence.first()).toBeHidden();
  });

  test("its two actions open the demo and the source request", async ({ page }) => {
    await page.goto(CRM);
    await page.locator("[data-main]").getByRole("link", { name: "Try the demo" }).click();
    await expectTab(page, "demo");
    await expect(page.getByTestId("workflow-simulator").getByRole("button", { name: "Run workflow" })).toBeInViewport();
    // The demo has the room to itself: the side column steps aside.
    await expect(page.getByRole("complementary", { name: "About this project" })).toBeHidden();

    await tabs(page).getByRole("link", { name: "Overview" }).click();
    const side = page.getByRole("complementary", { name: "About this project" });
    await expect(side).toBeVisible();
    // One button under the title in the short view; asking for the source is in the side column.
    await expect(page.locator("[data-main]").getByRole("link", { name: "Request the source" })).toBeHidden();
    await side.getByRole("link", { name: /Source code/ }).click();
    await expect(page).toHaveURL(/\/source-access\?project=pest-control-crm$/);
  });

  test("walks through how it works and hands over to the demo", async ({ page }) => {
    await page.goto(CRM);
    const how = page.locator("#how-it-works");
    await expect(how.getByRole("listitem")).toHaveCount(4);
    await expect(how.getByRole("heading", { level: 3, name: "How it works" })).toBeVisible();
    await expect(how.getByRole("listitem")).toContainText(["Intake", "Human decision", "Booking", "Background work"]);
    // On the overview the stages are text; they become controls beside the diagram.
    await expect(how.getByRole("button")).toHaveCount(0);
    await expect(how.getByText("13 steps, 8 failures you can inject.")).toBeVisible();
    await how.getByRole("link", { name: "Run it yourself" }).click();
    await expectTab(page, "demo");
  });
});

test.describe("the side column", () => {
  test("shows measured figures with where each comes from, and links to how they were measured", async ({ page }) => {
    // How each figure was measured is engineering detail: the link to it is in the Engineer view.
    await page.goto(`${CRM}?lens=engineer`);
    const side = page.getByRole("complementary", { name: "About this project" });
    const impact = side.getByRole("region", { name: "Project impact" });
    await expect(impact.getByRole("listitem")).toHaveCount(4);
    await expect(impact.getByText("about 0.56 s", { exact: true })).toBeVisible();
    await expect(impact.getByText("was about 5.6 s", { exact: true })).toBeVisible();
    // Every figure carries its evidence label, readable by a screen reader.
    await expect(impact.getByText("Documented by author").first()).toBeAttached();

    await impact.getByRole("link", { name: "How each was measured" }).click();
    await expect(page).toHaveURL(/#results$/);
    await expect(page.locator("#results-title")).toBeInViewport();
  });

  test("lists what the system does and where to go next", async ({ page }) => {
    // What it does is listed beside the study in the Engineer view; the short view has it once, in the study.
    await page.goto(`${CRM}?lens=engineer`);
    const side = page.getByRole("complementary", { name: "About this project" });
    const does = side.getByRole("region", { name: "Key features" });
    expect(await does.getByRole("listitem").count()).toBeGreaterThanOrEqual(3);
    await expect(does.getByText("Booking conflicts are refused on the server")).toBeVisible();

    const links = side.getByRole("region", { name: "Links and resources" });
    await expect(links.getByRole("link")).toHaveText([/Interactive demo/, /Full diagram/, /Evidence/, /Source code/]);
    await expect(links.getByRole("link", { name: /Source code/ })).toHaveAttribute("href", "/source-access?project=pest-control-crm");
    await links.getByRole("link", { name: /Evidence/ }).click();
    await expectTab(page, "evidence");
  });

  test("a private project links its public write-up and never its repository", async ({ page }) => {
    await page.goto(SOLANA);
    const links = page.getByRole("complementary", { name: "About this project" }).getByRole("region", { name: "Links and resources" });
    await expect(links.getByRole("link", { name: /Public write-up/ })).toHaveAttribute("href", "https://github.com/El-Sayed-Mustafa/solana-market-bot-showcase");
    await expect(links.getByRole("link", { name: /Source code/ })).toHaveAttribute("href", "/source-access?project=solana-research-platform");
    await expect(page.locator("[data-main]").getByRole("link", { name: "Open on GitHub" })).toHaveCount(0);
  });
});

test.describe("screenshots", () => {
  test("open at full size over the page and close again", async ({ page }) => {
    await page.goto(RUGS);
    const shots = page.locator("#screenshots");
    const card = shots.getByRole("link", { name: /^Open full size: The inventory workspace/ });
    // Without JavaScript the card is a plain link to the file.
    await expect(card).toHaveAttribute("href", "/projects/rug-inventory-sync/inventory.webp");
    await expect(shots.getByText(/provided by the author\. The signed-in account is covered\./)).toBeVisible();

    const lightbox = page.getByRole("dialog", { name: /^Screenshot: The inventory workspace/ });
    await expect(lightbox).toBeHidden();
    await card.click();
    await expect(lightbox).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${RUGS}$`));
    const picture = lightbox.getByRole("img");
    await expect(picture).toBeVisible();
    // The picture is the real file, and it fits the window.
    expect(await picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(1915);
    const box = (await lightbox.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(800);

    await lightbox.getByRole("button", { name: "Close the screenshot" }).click();
    await expect(lightbox).toBeHidden();
    await card.click();
    await expect(lightbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
    await expect(card).toBeFocused();
  });
});

test.describe("the projects index", () => {
  test("searches case studies and write-ups together with the category filter", async ({ page }) => {
    await page.goto("/projects");
    const search = page.getByRole("searchbox", { name: "Search projects" });
    await search.fill("selenium");
    await expect(page.getByRole("status")).toHaveText("Showing 1 of 9 projects");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Lead Discovery and Contact Enrichment Engine"]);
    // The counts on the filter follow the search.
    await expect(page.getByRole("button", { name: /^All/ })).toHaveText("All (1)");

    await search.fill("no such thing");
    await expect(page.getByText("No project matches that search.")).toBeVisible();
    await page.getByRole("button", { name: "Clear the filters" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(9);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every section of a case study is on the page and the tabs are plain links", async ({ page }) => {
    await page.goto(CRM);
    await expect(page.locator("html")).not.toHaveAttribute("data-tab", /.+/);
    for (const id of ["overview", "demo", "architecture", "decisions", "limitations", "evidence"]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
      await expect(tabs(page).locator(`a[href="#${id}"]`)).toBeVisible();
    }
    await expect(page.getByRole("complementary", { name: "About this project" })).toBeVisible();
    // The picture of the system and the full sentences of the summary are there without any script.
    await expect(page.locator("#system").getByRole("img", { name: /^The architecture of/ })).toBeVisible();
    await expect(page.locator("[data-main] header").getByText("Stated by owner", { exact: true }).first()).toBeVisible();
  });
});

test.describe("the Automation Lab opened on a link to one workflow", () => {
  test("shows that workflow, and only shows the workspace once it does", async ({ page }) => {
    await page.goto("/automation-lab?workflow=signal-to-evidence");
    await expect(page.getByTestId("workflow-simulator").getByRole("heading", { level: 3 }).first()).toHaveText("One signal, two strategies, and the evidence it adds");
    await expect(page.locator("html")).not.toHaveAttribute("data-lab", "pending");
    await expect(page.locator("[data-lab-workspace]")).toBeVisible();
    // The speed chosen before a run is the speed after a decision too.
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    await sim.getByRole("group", { name: "Decision needed" }).getByRole("button").first().click();
    await expect(sim.getByTestId("run-outcome")).toBeVisible({ timeout: 2000 });
  });
});

test.describe("the Automation Lab without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("still shows the first workflow and the library", async ({ page }) => {
    await page.goto("/automation-lab?workflow=signal-to-evidence");
    await expect(page.locator("[data-lab-workspace]")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Workflow library" }).getByRole("button")).toHaveCount(8);
  });
});
