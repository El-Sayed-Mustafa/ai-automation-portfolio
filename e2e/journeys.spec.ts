import { expect, test, type Locator, type Page } from "@playwright/test";

const CRM = "/projects/pest-control-crm";
const TRIAGE = "/projects/job-triage-pipeline";
const SOLANA = "/projects/solana-research-platform";
const MARKET = "/projects/market-data-platform";
const RUGS = "/projects/rug-inventory-sync";
const LEADS = "/projects/lead-enrichment-engine";
const RATING = "/projects/rating-estimator";

function simulator(page: Page): Locator {
  return page.getByTestId("workflow-simulator");
}

function inspector(page: Page): Locator {
  return simulator(page).getByTestId("inspector-panel");
}

/** A row in the step list. The progress strip has a button for every step too, so the list is named. */
function stepRow(page: Page, name: RegExp): Locator {
  return simulator(page).getByRole("list", { name: "Workflow steps" }).getByRole("button", { name });
}

async function runInstantly(page: Page) {
  const sim = simulator(page);
  await sim.getByLabel("Speed").selectOption("0");
  await sim.getByRole("button", { name: /^Run (workflow|again)$/ }).click();
}

async function runToDecision(page: Page) {
  await runInstantly(page);
  await expect(simulator(page).getByTestId("run-status")).toHaveText("Waiting for a decision");
}

async function runAndBook(page: Page) {
  await runToDecision(page);
  await simulator(page).getByRole("button", { name: /Interested, book a visit/ }).click();
  await expect(simulator(page).getByTestId("run-outcome")).toBeVisible();
}

/** Opens a case study in the engineer lens, on the tab named by `tab` (the Overview when omitted). */
async function openEngineerCaseStudy(page: Page, path = CRM, tab = "") {
  await page.goto(`${path}?lens=engineer${tab ? `#${tab}` : ""}`);
  await expect(page.locator("html")).toHaveAttribute("data-lens", "engineer");
}

function tabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sections of this case study" });
}

/** Switches tab the way a reader does: through the tab bar. */
async function openTab(page: Page, label: string) {
  await tabs(page).getByRole("link", { name: label, exact: true }).click();
  await expect(tabs(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "true");
}

test.describe("recruiter explores a project", () => {
  test("reaches a case study from the home page in two clicks", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("reliable automation");
    await page.locator("#work").getByRole("link", { name: "All 9 projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole("link", { name: "Read the case study" }).first().click();
    await expect(page).toHaveURL(new RegExp(`${CRM}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pest Control CRM and Field Operations");
  });

  test("the home page leads with what I can do, each skill shown in a real system", async ({ page }) => {
    await page.goto("/");
    // The skills come straight after the name, in plain words, each with the tools and a piece of work behind it.
    await page.getByRole("link", { name: "What I can do" }).click();
    await expect(page).toHaveURL(/#skills$/);
    const skills = page.locator("#skills");
    await expect(skills.getByRole("heading", { name: "What I can do for you" })).toBeInViewport();
    const cards = skills.getByRole("listitem").filter({ has: page.getByRole("link") });
    await expect(cards).toHaveCount(6);
    await expect(cards.first()).toContainText("Business automation");
    await expect(cards.first().getByRole("link")).toHaveAttribute("href", "/projects/rug-inventory-sync");
    for (const card of await cards.all()) await expect(card.getByRole("link")).toHaveAttribute("href", /^\/projects\/[a-z-]+$/);
    await expect(skills.getByRole("list", { name: "Tools I work with" }).getByRole("listitem")).toHaveCount(12);
    // Nothing on the first screen asks the reader to understand engineering figures.
    await expect(page.getByText("Failures you can inject")).toHaveCount(0);
    // The picture beside the headline is the first case study's own architecture, not an illustration.
    const layers = page.getByRole("list", { name: "The layers of Pest Control CRM and Field Operations" });
    await expect(layers.getByRole("listitem")).toContainText(["Clients", "Application", "Data", "Background work", "External services"]);
    await expect(layers).toContainText("Supabase Postgres");
    // The picture says what it is and how big the real thing is.
    await expect(page.getByText(/The real system behind .*: 14 components, 18 connections\./)).toBeVisible();

    // The demo is further down, and shows its stages.
    await page.goto("/#demo");
    await expect(simulator(page).getByRole("button", { name: "Run workflow" })).toBeInViewport();
    await expect(simulator(page).getByRole("list", { name: "Stages of this workflow" }).getByRole("listitem")).toContainText(["Intake", "Human decision", "Booking", "Background work"]);
  });

  test("every featured project shows what it is, a real picture of it and a way in", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator("#work article");
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      await expect(card.getByRole("heading", { level: 3 }).getByRole("link")).toBeVisible();
      await expect(card.getByRole("list", { name: "Categories" }).getByRole("listitem").first()).toBeVisible();
      // A screenshot where the project has one, otherwise its own architecture drawn small. Never a stock image.
      await expect(card.getByRole("img").first()).toBeVisible();
      await expect(card.getByRole("link", { name: /^Read the case study: / })).toBeVisible();
      // A card is short: no figure is quoted here without its method. The figures are in the case study.
      await expect(card.getByText(/Documented by author|Verified in code/)).toHaveCount(0);
    }
    await expect(cards.first().getByRole("img", { name: "Diagram of the system's layers and connections" })).toBeVisible();
    await cards.first().getByRole("link", { name: /^Read the case study: / }).click();
    await expect(page).toHaveURL(new RegExp(`${CRM}$`));
    await page.goto("/");
    // The other case studies are one click away too: each skill leads to the one that shows it.
    await expect(page.locator("#skills").getByRole("link", { name: /Web scraping and data collection/ })).toHaveAttribute("href", LEADS);
  });

  test("sees the short version by default, with measured results and their labels", async ({ page }) => {
    await page.goto(CRM);
    await expect(page.locator("html")).toHaveAttribute("data-lens", "recruiter");
    await expect(page.locator("#overview").getByText("Engineering challenges")).toBeHidden();
    const results = page.locator("#results");
    await expect(results.getByText("about 0.56 s", { exact: true })).toBeVisible();
    await expect(results.getByText("Documented by author").first()).toBeVisible();
    await expect(results.getByText(/measured by the author on the staging deployment/i).first()).toBeVisible();
    // Limitations are part of the short version too: one tab away, in either lens.
    await expect(page.locator("#limitations")).toBeHidden();
    await openTab(page, "Limits");
    await expect(page.locator("#limitations")).toBeVisible();
    await expect(page.locator("#limitations details").first()).toBeVisible();
  });

  test("filters the work index by category", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: /^AI Engineering/ }).click();
    await expect(page.getByRole("status")).toHaveText("Showing 2 of 9 projects");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Job Triage Pipeline with LLM Guardrails",
      "Amazon Rating Estimator and Review-Removal Simulator",
    ]);
    await page.getByRole("button", { name: /^Data Engineering/ }).click();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Marketplace Review Intelligence Pipeline",
      "Solana Trading Research Platform",
      "Market Data and Alerting Platform",
      "Lead Discovery and Contact Enrichment Engine",
    ]);
    await page.getByRole("button", { name: /^Business Applications/ }).click();
    await expect(page.getByRole("heading", { name: "Interactive case studies" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(9);
  });

  test("finds working contact links", async ({ page }) => {
    await page.goto("/#contact");
    const contact = page.locator("#contact");
    await expect(contact.getByRole("link", { name: /@/ })).toHaveAttribute("href", /^mailto:/);
    await expect(contact.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", /linkedin\.com/);
    await expect(contact.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", /github\.com/);
    // There is no contact form, so there is nothing that could silently fail to send.
    await expect(contact.locator("form")).toHaveCount(0);
  });

  test("reads the About section, which is built from stated facts", async ({ page }) => {
    await page.goto("/#about");
    const about = page.locator("#about");
    await expect(about.getByRole("heading", { name: "About me" })).toBeInViewport();
    // How I approach a problem is for the reader who asks for the engineering detail.
    await expect(about.getByText("How I approach a problem")).toBeHidden();
    await expect(about.getByText("Experience", { exact: true })).toBeVisible();
    // Education and certificates are on the resume. Here they wait for the reader who asks for more detail.
    await expect(about.getByText("Education", { exact: true })).toBeHidden();
    await page.getByRole("banner").getByRole("button", { name: "Engineer" }).click();
    await expect(about.getByText("Education", { exact: true })).toBeVisible();
    await expect(about.getByText("Certifications", { exact: true })).toBeVisible();
    await expect(about.getByText("How I approach a problem")).toBeVisible();
  });
});

test.describe("engineer opens architecture details", () => {
  test("selects a component and reads how it fails", async ({ page }) => {
    await openEngineerCaseStudy(page, CRM, "architecture");
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await architecture.getByRole("button", { name: /^Edge Function crm-api:/ }).click();

    const details = architecture.getByRole("complementary", { name: "Details for Edge Function crm-api" });
    for (const heading of ["Responsibility", "Technology", "Why this technology", "Input", "Output", "Dependencies", "Implementation details", "Known failure modes", "Reliability strategy", "Evidence"]) {
      await expect(details.getByText(heading, { exact: true })).toBeVisible();
    }
    await expect(details.getByText(/not one transaction/)).toBeVisible();
    await expect(details.getByText("supabase/functions/crm-api/index.ts:118-144")).toBeVisible();

    // Its connections are named in the details, drawn in the accent colour, and everything unrelated is dimmed.
    await expect(details.getByText(/HMAC token/).first()).toBeVisible();
    await expect(architecture.locator(".react-flow__edge-text")).toHaveCount(0);
    await expect(architecture.locator(".react-flow__node-arch > div.opacity-30").first()).toBeVisible();
    await expect(architecture.getByRole("button", { name: /^Supabase Postgres:/ }).locator("xpath=..")).not.toHaveClass(/opacity-30/);
    await expect(architecture.getByRole("button", { name: /^Edge Function crm-api:/ })).toHaveAttribute("aria-pressed", "true");

    await details.getByRole("button", { name: "Close component details" }).click();
    await expect(details).toBeHidden();
  });

  test("closes the details with Escape", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await architecture.getByRole("button", { name: /^Supabase Postgres:/ }).click();
    const details = architecture.getByRole("complementary", { name: "Details for Supabase Postgres" });
    await expect(details).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
  });

  test("follows each of the five requests in the data-flow view", async ({ page }) => {
    await openEngineerCaseStudy(page, CRM, "architecture");
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);

    // The structure view has nothing to follow; the data-flow view offers the requests.
    await expect(architecture.getByRole("group", { name: "Follow a request" })).toHaveCount(0);
    await architecture.getByRole("button", { name: "Data flow" }).click();
    await expect(architecture.getByRole("button", { name: "Data flow" })).toHaveAttribute("aria-pressed", "true");
    const routes = architecture.getByRole("group", { name: "Follow a request" });
    await expect(routes.getByRole("button")).toHaveText([
      "A WhatsApp message becomes a lead",
      "A booking is saved",
      "The technician is notified",
      "A read survives a fast-path failure",
      "A technician files a visit report",
    ]);

    // On the canvas a hop carries its number; the words are in the strip above it.
    const labels = architecture.locator(".react-flow__edge-text");
    const steps = architecture.getByRole("complementary", { name: "Steps of this request" });
    await expect(steps).toBeHidden();
    await expect(labels).toHaveCount(0);
    for (const [route, hops] of [
      ["A WhatsApp message becomes a lead", 2],
      ["A booking is saved", 3],
      ["A read survives a fast-path failure", 3],
      ["A technician files a visit report", 5],
      ["The technician is notified", 5],
    ] as const) {
      await routes.getByRole("button", { name: route }).click();
      await expect(routes.getByRole("button", { name: route })).toHaveAttribute("aria-pressed", "true");
      await expect(labels).toHaveCount(hops);
      for (let hop = 1; hop <= hops; hop += 1) await expect(labels.filter({ hasText: new RegExp(`^${hop}$`) })).toHaveCount(1);
      await expect(steps.getByRole("heading", { level: 4 })).toHaveText(route);
      await expect(steps.getByRole("listitem")).toHaveCount(hops);
    }
    // Each hop says what it carries and, in the engineer lens, how the call is made.
    await expect(steps.getByRole("listitem").first()).toContainText("Deferred call");
    await expect(steps.getByRole("listitem").nth(4)).toContainText("Visit details for the technician");
    await expect(steps.getByRole("listitem").nth(4)).toContainText("MailApp.sendEmail");
    // The strip sits above the canvas, never over it, and the whole diagram stays in view at a readable size.
    const strip = (await steps.boundingBox())!;
    const canvas = (await architecture.getByLabel("Architecture diagram").boundingBox())!;
    expect(strip.y + strip.height).toBeLessThanOrEqual(canvas.y + 1);
    for (const name of ["Office web app", "Deferred worker", "Gmail"]) {
      const hop = (await architecture.getByRole("button", { name: new RegExp(`^${name}:`) }).boundingBox())!;
      expect(hop.width, name).toBeGreaterThanOrEqual(135);
      expect(hop.x, name).toBeGreaterThanOrEqual(canvas.x);
      expect(hop.x + hop.width, name).toBeLessThanOrEqual(canvas.x + canvas.width);
    }
    // What is not on the route is dimmed, not removed.
    await expect(architecture.locator(".react-flow__node-arch > div.opacity-30").first()).toBeVisible();

    // Choosing the same request again lets it go.
    await routes.getByRole("button", { name: "The technician is notified" }).click();
    await expect(labels).toHaveCount(0);
    await expect(steps).toBeHidden();
    // The strip has its own way out.
    await routes.getByRole("button", { name: "A booking is saved" }).click();
    await steps.getByRole("button", { name: "Stop following this request" }).click();
    await expect(steps).toBeHidden();
    await expect(routes.getByRole("button", { name: "A booking is saved" })).toHaveAttribute("aria-pressed", "false");
    // Going back to the structure lets a followed request go too.
    await routes.getByRole("button", { name: "A booking is saved" }).click();
    await architecture.getByRole("button", { name: "Architecture", exact: true }).click();
    await expect(steps).toBeHidden();
    await expect(labels).toHaveCount(0);
    await expect(architecture.getByRole("group", { name: "Follow a request" })).toHaveCount(0);
    await architecture.getByRole("button", { name: "Full graph" }).first().click();
    await expect(architecture.locator(".react-flow__node-arch").first()).toBeVisible();
  });

  test("the short lens gives each hop in a few words and the short version of a component", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    await architecture.getByRole("button", { name: "Data flow" }).click();
    await architecture.getByRole("group", { name: "Follow a request" }).getByRole("button", { name: "A booking is saved" }).click();
    const steps = architecture.getByRole("complementary", { name: "Steps of this request" });
    await expect(steps.getByRole("listitem")).toHaveCount(3);
    await expect(steps.locator(".eng-only").first()).toBeHidden();
    await architecture.getByRole("button", { name: "Architecture", exact: true }).click();

    await architecture.getByRole("button", { name: /^Edge Function crm-api:/ }).click();
    const details = architecture.getByRole("complementary", { name: "Details for Edge Function crm-api" });
    for (const heading of ["Responsibility", "Technology", "Evidence"]) await expect(details.getByText(heading, { exact: true })).toBeVisible();
    await expect(details.getByText("Known failure modes", { exact: true })).toBeHidden();
    // The rest is one press away, without changing lens.
    const more = details.getByRole("button", { name: "Inputs, dependencies and failure modes" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    for (const heading of ["Input", "Dependencies", "Known failure modes", "Reliability strategy"]) await expect(details.getByText(heading, { exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Less detail" }).click();
    await expect(details.getByText("Known failure modes", { exact: true })).toBeHidden();
  });

  test("points at a stage of the workflow to see where it runs", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await expect(architecture.getByRole("heading", { level: 2, name: "System architecture" })).toBeVisible();
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    const dimmed = architecture.locator(".react-flow__node-arch > div.opacity-30");
    const stages = architecture.locator("#stages");
    await expect(stages.getByRole("button")).toHaveCount(4);
    await expect(dimmed).toHaveCount(0);

    // Pointing is enough, and lasts as long as the pointer does. Booking runs on three components.
    const booking = stages.getByRole("button", { name: /^Booking/ });
    await booking.hover();
    await expect(dimmed).toHaveCount(11);
    await expect(booking).toHaveAttribute("aria-pressed", "false");
    await architecture.getByRole("heading", { level: 2, name: "System architecture" }).hover();
    await expect(dimmed).toHaveCount(0);

    // Pressing keeps it, pressing again lets it go.
    await booking.click();
    await expect(booking).toHaveAttribute("aria-pressed", "true");
    await architecture.getByRole("heading", { level: 2, name: "System architecture" }).hover();
    await expect(dimmed).toHaveCount(11);
    for (const name of ["Edge Function crm-api", "Supabase Postgres", "Outbox table"]) {
      await expect(architecture.getByRole("button", { name: new RegExp(`^${name}:`) }).locator("xpath=..")).not.toHaveClass(/opacity-30/);
    }
    await booking.click();
    await expect(booking).toHaveAttribute("aria-pressed", "false");
    await architecture.getByRole("heading", { level: 2, name: "System architecture" }).hover();
    await expect(dimmed).toHaveCount(0);

    // From the keyboard, focus does what the pointer does.
    await stages.getByRole("button", { name: /^Human decision/ }).focus();
    await expect(dimmed).toHaveCount(13);
    await stages.getByRole("link", { name: "Run it yourself" }).focus();
    await expect(dimmed).toHaveCount(0);
  });

  test("focuses one layer", async ({ page }) => {
    await openEngineerCaseStudy(page, CRM, "architecture");
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    // The title of a column brings that layer forward; pressing it again shows every layer.
    const data = architecture.getByRole("button", { name: "Focus the Data layer" });
    await expect(data).toHaveAttribute("aria-pressed", "false");
    await data.click();
    await expect(data).toHaveAttribute("aria-pressed", "true");
    // Two components are in the data layer; the other twelve are dimmed.
    await expect(architecture.locator(".react-flow__node-arch > div.opacity-30")).toHaveCount(12);
    // Another column takes over: one layer at a time.
    await architecture.getByRole("button", { name: "Focus the Clients layer" }).click();
    await expect(data).toHaveAttribute("aria-pressed", "false");
    await expect(architecture.locator(".react-flow__node-arch > div.opacity-30")).toHaveCount(12);
    await architecture.getByRole("button", { name: "Focus the Clients layer" }).click();
    await expect(architecture.locator(".react-flow__node-arch > div.opacity-30")).toHaveCount(0);
  });

  test("marks what is legacy or switched off, and tells a fallback from a write", async ({ page }) => {
    await openEngineerCaseStudy(page, CRM, "architecture");
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await expect(architecture.getByRole("button", { name: /^Google Sheets:/ })).toContainText("legacy");
    await expect(architecture.getByRole("button", { name: /^Google Calendar:/ })).toContainText("disabled");
    // The legend names the line styles, so a fallback path is not mistaken for a normal request.
    const legend = architecture.getByRole("list", { name: "Connections" });
    await expect(legend.getByRole("listitem")).toHaveText([
      "Request and response",
      "Background work",
      "Fallback or legacy path",
      "Implemented, switched off",
    ]);
    // The decision record keeps the rule itself in words.
    const decision = page.locator("#decisions details").filter({ hasText: "Reads fall back. Writes never do." });
    await expect(decision).toHaveCount(1);
  });

  test("expands the diagram to the whole window and closes it again", async ({ page }) => {
    await page.goto(`${CRM}#architecture`);
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await architecture.getByRole("button", { name: "Expand" }).click();
    const expanded = page.getByRole("region", { name: "Architecture diagram, expanded" });
    await expect(expanded).toBeVisible();
    const box = await expanded.boundingBox();
    expect(box?.width).toBe(page.viewportSize()?.width);
    await page.keyboard.press("Escape");
    await expect(expanded).toBeHidden();
  });

  test("can read the architecture without the diagram", async ({ page }) => {
    await openEngineerCaseStudy(page, CRM, "architecture");
    const list = page.locator("#architecture details");
    await list.locator("summary").click();
    await expect(list.getByRole("table")).toContainText("Outbox table");
    await expect(list.getByText("Supabase Edge Function (Deno, TypeScript)")).toBeVisible();
  });

  test("explores the second case study's architecture", async ({ page }) => {
    await page.goto(`${TRIAGE}#architecture`);
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);
    await architecture.getByRole("button", { name: "Data flow" }).click();
    await architecture.getByRole("group", { name: "Follow a request" }).getByRole("button", { name: "A posting is scored" }).click();
    await expect(architecture.getByRole("complementary", { name: "Steps of this request" }).getByRole("heading", { level: 4 })).toHaveText("A posting is scored");
    await expect(architecture.locator(".react-flow__edge-text").first()).toBeVisible();
  });
});

test.describe("visitor runs the CRM demo", () => {
  test("runs it from the home page and makes the human decision", async ({ page }) => {
    await page.goto("/#demo");
    const sim = simulator(page);
    await expect(sim.getByText("Simulation", { exact: true })).toBeVisible();
    await expect(sim.getByText(/No real service is called/)).toBeVisible();
    await expect(sim.getByText(/timings are simulated, not measured/)).toBeVisible();
    await expect(sim.getByTestId("run-status")).toHaveText("Not started");

    await sim.getByLabel("Speed").selectOption("4");
    await sim.getByRole("button", { name: "Run workflow" }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision", { timeout: 20_000 });
    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();

    const outcome = sim.getByTestId("run-outcome");
    await expect(outcome).toContainText("Completed", { timeout: 30_000 });
    await expect(outcome).toContainText("APPT-311 booked for Sample Contact with Crew A at 13:00");
    await expect(outcome).toContainText("The technician was notified by email.");
    await expect(sim.getByText("13/13 steps settled")).toBeVisible();
    // A simulated clock and a measured execution time are shown as two different things.
    await expect(sim.getByText(/^simulated /)).toBeVisible();
    await expect(sim.getByText(/^executed in /)).toBeVisible();
  });

  test("keeps the controls, the active step and its details on one screen", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await runToDecision(page);
    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
    await expect(sim.getByTestId("run-outcome")).toBeVisible();
    await stepRow(page, /Write the appointment/).click();

    const controls = await sim.getByRole("button", { name: "Run again" }).boundingBox();
    const row = await stepRow(page, /Write the appointment/).boundingBox();
    const details = await inspector(page).boundingBox();
    expect(controls && row && details).toBeTruthy();
    // Side by side: the details start beside the step list, not below it.
    expect(details!.x).toBeGreaterThan(row!.x + row!.width - 1);
    expect(Math.abs(details!.y - row!.y)).toBeLessThan(700);
  });

  test("steps through one step at a time, then replays", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Step", exact: true }).click();
    await expect(sim.getByText("1/13 steps settled")).toBeVisible();
    await sim.getByRole("button", { name: "Step", exact: true }).click();
    await expect(sim.getByText("2/13 steps settled")).toBeVisible();

    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: "Resume" }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");

    await sim.getByRole("button", { name: "Replay" }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
    await expect(sim.getByText("5/13 steps settled")).toBeVisible();
  });

  test("scrubs the timeline backwards and forwards", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    await runAndBook(page);
    const sim = simulator(page);
    await expect(sim.getByText("13/13 steps settled")).toBeVisible();
    await sim.getByLabel("Timeline").focus();
    await page.keyboard.press("Home");
    await expect(sim.getByText("0/13 steps settled")).toBeVisible();
    await expect(sim.getByTestId("run-outcome")).toBeHidden();
    await page.keyboard.press("End");
    await expect(sim.getByText("13/13 steps settled")).toBeVisible();
    await expect(sim.getByTestId("run-outcome")).toBeVisible();
  });

  test("jumps to a step from the progress strip", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    await runAndBook(page);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Step 5, Create or update the lead: Success" }).click();
    await expect(inspector(page).getByRole("heading", { name: "Create or update the lead" })).toBeVisible();
    await expect(stepRow(page, /Create or update the lead/)).toHaveAttribute("aria-pressed", "true");
  });

  test("cancels a run that is waiting for a decision", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    await runToDecision(page);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Cancel" }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Cancelled");
    await expect(sim.getByTestId("run-outcome")).toContainText("Cancelled by the visitor.");
    await expect(sim.locator('li[data-status="cancelled"]')).toHaveCount(8);
  });

  test("an existing customer is booked without a second customer record", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Existing customer", exact: true }).click();
    await runAndBook(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked for Demo Customer A with Crew A at 15:00");
    await stepRow(page, /Convert to a customer/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("crm_customers")).toHaveCount(0);
  });

  test("a returning lead is updated, not duplicated", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Returning lead", exact: true }).click();
    await runAndBook(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked for Returning Enquirer with Crew A at 13:00");
    await stepRow(page, /Create or update the lead/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    const panel = inspector(page);
    await expect(panel.getByText("crm_leads")).toBeVisible();
    await expect(panel.getByText("update").first()).toBeVisible();
    await expect(panel.getByText("insert")).toHaveCount(0);
  });

  test("ignores a group chat without creating a lead", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Group chat", exact: true }).click();
    await runInstantly(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("Message ignored. No lead was created.");
    await expect(sim.locator('li[data-status="skipped"]')).toHaveCount(10);
  });

  test("blocks a run while the sample input is invalid", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByLabel("Sender number").fill("abc");
    await expect(sim.getByText("Use 7 to 18 digits.")).toBeVisible();
    await sim.getByRole("button", { name: "Run workflow" }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Not started");
    await expect(sim.getByRole("tab", { name: /Setup/ })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("visitor inspects an execution", () => {
  test("reads a step's payload, the run's logs and the rows it wrote", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    await runAndBook(page);
    const sim = simulator(page);
    const panel = inspector(page);

    await stepRow(page, /Write the appointment/).click();
    await expect(panel.getByRole("heading", { name: "Write the appointment" })).toBeVisible();
    await expect(panel.getByText("What the production code does")).toBeVisible();
    await expect(panel.getByText("supabase/functions/crm-api/index.ts:716-790")).toBeVisible();
    await expect(panel.getByText("Times are on a simulated clock. They are not production measurements.")).toBeVisible();

    await sim.getByRole("tab", { name: "Payload" }).click();
    await expect(panel.getByText('"appointmentId": "APPT-311"')).toBeVisible();
    await expect(panel.getByText('"notificationStatus": "Pending"')).toBeVisible();
    // Whatever the tab, the panel says which step it is showing.
    await expect(panel.getByRole("heading", { name: "Write the appointment" })).toBeVisible();

    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(panel.getByText("crm_appointments")).toBeVisible();
    await expect(panel.getByText("crm_id_counters")).toBeVisible();

    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(panel.getByText("Webhook key accepted.")).toBeVisible();
    await expect(panel.getByText(/No real email is sent by this simulation/)).toBeVisible();
  });

  test("never shows a credential in a recorded payload", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    await runAndBook(page);
    const sim = simulator(page);
    await stepRow(page, /Send the booking/).click();
    await sim.getByRole("tab", { name: "Payload" }).click();
    const payload = inspector(page);
    await expect(payload.getByText('"apikey": "••••••••"')).toBeVisible();
    await expect(payload).not.toContainText(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

test.describe("visitor injects a failure into the CRM demo", () => {
  test("a webhook with the wrong key is rejected before anything is written", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/Webhook arrives with the wrong key/).check();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("Webhook rejected: invalid key. Nothing was written.");
    await expect(sim.locator('li[data-status="failed"]')).toHaveCount(1);
    await expect(sim.locator('li[data-status="skipped"]')).toHaveCount(12);
    await stepRow(page, /Receive the webhook/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("This step did not write anything.")).toBeVisible();
  });

  test("a double booking is rejected and no appointment is written", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/Double-book the crew/).check();
    await runAndBook(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("Crew A already has APPT-307 at this time.");
    await expect(sim.getByTestId("run-outcome")).toContainText("No appointment was written.");

    // The step that would have written the appointment never ran.
    await expect(sim.locator('li[data-step="booking.insert"]')).toHaveAttribute("data-status", "skipped");
    await stepRow(page, /Write the appointment/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("This step has not run yet.")).toBeVisible();
    // And no step of the run touched the appointments table.
    for (const step of [/Send the booking/, /Validate and check conflicts/]) {
      await stepRow(page, step).click();
      await expect(inspector(page).getByText("crm_appointments")).toHaveCount(0);
    }
  });

  test("the worker retries with backoff and recovers", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The worker fails twice, then recovers/).check();
    await expect(sim.getByText(/retried after 60 seconds, then after 120 seconds/)).toBeVisible();
    await runAndBook(page);

    await expect(sim.getByTestId("run-outcome")).toContainText("Completed");
    await expect(stepRow(page, /Worker drains the outbox/)).toContainText("3 attempts");
    await stepRow(page, /Worker drains the outbox/).click();
    const panel = inspector(page);
    await expect(panel.getByRole("row")).toHaveCount(4);
    await expect(panel.getByText("retry in 1 min 00 s")).toBeVisible();
    await expect(panel.getByText("retry in 2 min 00 s")).toBeVisible();
  });

  test("a worker that keeps failing stops after eight attempts and says so", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The worker keeps failing/).check();
    await runAndBook(page);

    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    const outcome = sim.getByTestId("run-outcome");
    await expect(outcome).toContainText("Appointment APPT-311 is booked, but the technician was not notified");
    await expect(outcome).toContainText("failed after 8 attempts and needs manual attention");
    await expect(stepRow(page, /Worker drains the outbox/)).toContainText("8 attempts");
    await stepRow(page, /Worker drains the outbox/).click();
    await expect(inspector(page).getByRole("row")).toHaveCount(9);
    // The booking itself was saved before the worker ran.
    await expect(sim.locator('li[data-step="booking.insert"]')).toHaveAttribute("data-status", "success");
  });

  test("is told plainly when the production code does not handle a case", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    const fault = sim.getByRole("listitem").filter({ hasText: "The gateway delivers the same message twice" });
    await expect(fault.getByText("Known limitation")).toBeVisible();
    await fault.getByRole("checkbox").check();
    await runAndBook(page);
    await stepRow(page, /Create or update the lead/).click();
    await expect(inspector(page).getByText(/counted twice/)).toBeVisible();
  });

  test("allows only one fault from a group", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    const transient = sim.getByLabel(/The worker fails twice, then recovers/);
    const permanent = sim.getByLabel(/The worker keeps failing/);
    await transient.check();
    await permanent.check();
    await expect(transient).not.toBeChecked();
    await expect(permanent).toBeChecked();
  });

  test("is warned when the setup changes after a run", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    await runAndBook(page);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Edit input and failures" }).click();
    await sim.getByLabel(/Double-book the crew/).check();
    await expect(sim.getByText(/The setup changed\. Choose “Run again” to apply it/)).toBeVisible();
    await expect(sim.getByRole("button", { name: /Edit input and failures/ })).toContainText("1 failure");
  });
});

test.describe("visitor resets the workflow", () => {
  test("returns every step to pending and keeps the chosen setup", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/Double-book the crew/).check();
    await runAndBook(page);
    await sim.getByRole("button", { name: "Reset" }).click();

    await expect(sim.getByTestId("run-status")).toHaveText("Not started");
    await expect(sim.locator('li[data-status="pending"]')).toHaveCount(13);
    await expect(sim.getByTestId("run-outcome")).toBeHidden();
    await expect(sim.getByLabel(/Double-book the crew/)).toBeChecked();
  });
});

test.describe("visitor runs the job triage demo", () => {
  test("follows a good match through all three human decisions", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await expect(sim.getByText("Simulation", { exact: true })).toBeVisible();
    // The model is scripted, and the page says so before anything runs.
    await expect(sim.getByText(/No model is called: the model's answers are scripted/)).toBeVisible();

    await runToDecision(page);
    await sim.getByRole("button", { name: /^Applied/ }).click();
    await expect(sim.getByText(/Did you finish applying\?/)).toBeVisible();
    await sim.getByRole("button", { name: /^Yes, I applied/ }).click();
    await expect(sim.getByText("7 days later it asks what happened.")).toBeVisible();
    await sim.getByRole("button", { name: /^An interview/ }).click();

    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await expect(sim.getByTestId("run-outcome")).toContainText('Applied, confirmed, outcome "interview".');
    await expect(sim.getByText("15/15 steps settled")).toBeVisible();
  });

  test("silence is recorded as an outcome after the auto-close window", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await runToDecision(page);
    await sim.getByRole("button", { name: /^Applied/ }).click();
    await sim.getByRole("button", { name: /^Yes, I applied/ }).click();
    await sim.getByRole("button", { name: /I never answer the question/ }).click();
    await expect(sim.getByTestId("run-outcome")).toContainText('outcome "none"');
    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(inspector(page).getByText(/21 days after the decision the application is closed as "none"/)).toBeVisible();
  });

  test("a posting the candidate skips gets no follow-up", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await runToDecision(page);
    await sim.getByRole("button", { name: /^Not suitable/ }).click();
    await expect(sim.getByTestId("run-outcome")).toContainText('Recorded as "skipped". No follow-up is scheduled.');
    await expect(sim.locator('li[data-status="skipped"]')).toHaveCount(2);
  });

  test("the adversarial pass stops a generous first score from being sent", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "First pass too generous", exact: true }).click();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await expect(sim.getByTestId("run-outcome")).toContainText(
      "Not sent. The first pass scored 84, which would have been sent; the adversarial pass scored 58, so the final score is 58.",
    );
    await expect(sim.locator('li[data-status="skipped"]')).toHaveCount(8);
  });

  test("the targeting policy filters a posting before any model is involved", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Senior in the title", exact: true }).click();
    await runInstantly(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("Filtered out: The role is not one being sought. No model was called for this posting.");
    await expect(sim.locator('li[data-step="llm.score"]')).toHaveAttribute("data-status", "skipped");
  });

  test("broken model output fails the run and is recorded as an attempt", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The model returns broken JSON/).check();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("Scoring failed: The model returned invalid JSON.");
    await stepRow(page, /Score the fit/).click();
    await expect(inspector(page).getByRole("alert")).toContainText("INVALID_OUTPUT");
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("score_attempts")).toBeVisible();
  });

  test("a rate-limited model is retried and the run still completes", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The model is rate-limited, then overloaded/).check();
    await runToDecision(page);
    await expect(stepRow(page, /Score the fit/)).toContainText("3 attempts");
  });

  test("a forged webhook request is rejected and the genuine one still goes through", async ({ page }) => {
    await page.goto(`${TRIAGE}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/Someone posts to the webhook without the secret/).check();
    await runToDecision(page);
    await sim.getByRole("button", { name: /^Applied/ }).click();
    await sim.getByRole("button", { name: /^Yes, I applied/ }).click();
    await sim.getByRole("button", { name: /^An interview/ }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await stepRow(page, /Verify the button press/).click();
    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(inspector(page).getByText(/Rejected at check 1 of 3/)).toBeVisible();
  });
});

test.describe("visitor runs the market data demo", () => {
  test("a normal slot is priced, scanned and alerted without anyone being asked", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const sim = simulator(page);
    await expect(sim.getByText(/six invented tickers; the real platform tracks 170 stocks/)).toBeVisible();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    const outcome = sim.getByTestId("run-outcome");
    await expect(outcome).toContainText("6 from the primary provider, 0 from the fallback");
    await expect(outcome).toContainText("New alert: DEMO1 move_up.");
    // The step that does not run in the real system says so instead of pretending.
    await expect(outcome).toContainText("Telegram sending is off in the running system");
    await expect(sim.locator('li[data-step="telegram.send"]')).toHaveAttribute("data-status", "skipped");
    await expect(sim.locator('li[data-step="operator.requeue"]')).toHaveAttribute("data-status", "skipped");
  });

  test("the third failure in a row opens the circuit, and the fallback prices the slot", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Two failures counted", exact: true }).click();
    await sim.getByRole("button", { name: "Edit input and failures" }).click();
    await sim.getByLabel(/The primary provider is unreachable/).check();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await expect(sim.getByTestId("run-outcome")).toContainText("0 from the primary provider, 6 from the fallback");
    await expect(sim.locator('li[data-step="alpaca.snapshots"]')).toHaveAttribute("data-status", "failed");
    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(inspector(page).getByText(/Third failure in a row: the circuit is open/)).toBeVisible();
  });

  test("an open circuit skips the primary provider", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Circuit open", exact: true }).click();
    await runInstantly(page);
    await expect(sim.locator('li[data-step="alpaca.snapshots"]')).toHaveAttribute("data-status", "skipped");
    await stepRow(page, /Ask the circuit breaker/).click();
    await expect(inspector(page).getByText("Completed with a warning")).toBeVisible();
    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(inspector(page).getByText(/skipped after repeated failures, next try in 180s/)).toBeVisible();
  });

  test("a killed worker's job is reclaimed when its lease runs out", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The worker is killed while holding the job/).check();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await expect(stepRow(page, /Claim the job/)).toContainText("2 attempts");
    await stepRow(page, /Claim the job/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("job_runs").first()).toBeVisible();
    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(inspector(page).getByText(/Lease expired after 180 s/)).toBeVisible();
  });

  test("a dead job is reported, and requeueing it expires it instead of running it late", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/Both providers are unreachable/).check();
    await runToDecision(page);
    await expect(stepRow(page, /Complete, retry or bury the job/)).toContainText("3 attempts");
    await expect(sim.locator('li[data-step="heartbeat.report"]')).toHaveAttribute("data-status", "success");
    await expect(sim.getByText(/The poll for this slot is dead and you have been e-mailed/)).toBeVisible();

    await sim.getByRole("button", { name: /^Requeue the job/ }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("requeueing it expired it instead of running it late");
    await expect(sim.getByTestId("run-outcome")).toContainText("not backfilled");
    await expect(sim.locator('li[data-step="scan.compute"]')).toHaveAttribute("data-status", "skipped");
  });

  test("a rule that already fired today is not recorded twice", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The same rule already fired for this stock today/).check();
    await runInstantly(page);
    await expect(sim.getByTestId("run-outcome")).toContainText("had already fired today");
    await stepRow(page, /Record each alert once/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("This step did not write anything.")).toBeVisible();
  });

  test("a known gap is labelled as one", async ({ page }) => {
    await page.goto(`${MARKET}#demo`);
    const fault = simulator(page).getByRole("listitem").filter({ hasText: "Last night's daily sync died" });
    await expect(fault.getByText("Known limitation")).toBeVisible();
  });
});

test.describe("visitor runs the trading research demo", () => {
  test("two strategies hold the same signal, and one good trade does not change the rule", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    // Before anything runs, the page says the thresholds are invented and no order is placed.
    await expect(sim.getByText(/Every threshold is invented, because the real parameters are private/)).toBeVisible();
    await expect(sim.getByText(/no order of any kind is placed/)).toBeVisible();

    await runToDecision(page);
    await expect(sim.getByText(/the shadow rule did 7\.92 points better\. The evaluator says: Not yet/)).toBeVisible();
    await sim.getByRole("button", { name: /^Keep it in shadow/ }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Completed");
    await expect(sim.getByTestId("run-outcome")).toContainText("Control +33.71%, shadow +41.63% on the same signal, after costs.");
    await expect(sim.getByTestId("run-outcome")).toContainText("enough paired trades: 24 of at least 30");
    await expect(sim.getByText("14/14 steps settled")).toBeVisible();
  });

  test("the real-money switches refuse at the first one", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    await runToDecision(page);
    await stepRow(page, /Check the real-money switches/).click();
    await sim.getByRole("tab", { name: "Payload" }).click();
    await expect(inspector(page).getByText('"real_order": false')).toBeVisible();
    await expect(inspector(page).getByText(/DRY_RUN is on: no transaction is built/)).toBeVisible();
  });

  test("adopting a rule the evaluator does not pass is recorded as a mistake", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    await runToDecision(page);
    await sim.getByRole("button", { name: /^Adopt it now/ }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("one good trade is not evidence");
  });

  test("on a spike that fades, the other rule wins", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Spike and fade", exact: true }).click();
    await runToDecision(page);
    await expect(sim.getByText(/the shadow rule did 4\.5 points worse/)).toBeVisible();
  });

  test("a rejected token is recorded with the gate that stopped it", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    await sim.getByRole("button", { name: "Thin pool", exact: true }).click();
    await runInstantly(page);
    await expect(sim.getByTestId("run-outcome")).toContainText('rejected the token at the "liquidity" gate');
    await stepRow(page, /Apply the gates/).click();
    await sim.getByRole("tab", { name: "Data changes" }).click();
    await expect(inspector(page).getByText("scan_evaluations")).toBeVisible();
    await expect(inspector(page).getByText('"rejectedGate": "liquidity"')).toBeVisible();
    await expect(sim.locator('li[data-status="skipped"]')).toHaveCount(11);
  });

  test("a garbage price is ignored instead of booked as an exit", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    await sim.getByLabel(/The price feed returns garbage once/).check();
    await runToDecision(page);
    await stepRow(page, /Watch the positions/).click();
    await expect(inspector(page).getByText("Completed with a warning")).toBeVisible();
    await sim.getByRole("tab", { name: "Logs" }).click();
    await expect(inspector(page).getByText(/a price 96% under the reference while liquidity is healthy/)).toBeVisible();
    // The result is the same as without the bad tick.
    await expect(sim.getByText(/the shadow rule did 7\.92 points better/)).toBeVisible();
  });

  test("a real gap in the code is shown as it is", async ({ page }) => {
    await page.goto(`${SOLANA}#demo`);
    const sim = simulator(page);
    const fault = sim.getByRole("listitem").filter({ hasText: "The token stops returning a snapshot" });
    await expect(fault.getByText("Known limitation")).toBeVisible();
    await fault.getByRole("checkbox").check();
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Failed");
    await expect(sim.getByTestId("run-outcome")).toContainText("no counter and no timeout");
  });
});

test.describe("case studies of private repositories", () => {
  test("say the repository is private, offer the source on request and link the public write-up", async ({ page }) => {
    await page.goto(`${SOLANA}#evidence`);
    const evidence = page.locator("#evidence");
    await expect(evidence.getByText("El-Sayed-Mustafa/solana-market-bot")).toBeVisible();
    await expect(evidence.getByText("(private)")).toBeVisible();
    await expect(evidence.getByRole("link", { name: "Request the source code" })).toHaveAttribute("href", "/source-access?project=solana-research-platform");
    await expect(evidence.getByRole("link", { name: /Public write-up/ })).toHaveAttribute("href", "https://github.com/El-Sayed-Mustafa/solana-market-bot-showcase");
    // Nothing on the page links into the private repository.
    await expect(page.locator('main a[href*="github.com/El-Sayed-Mustafa/solana-market-bot/"]')).toHaveCount(0);
    await expect(page.locator('main a[href$="github.com/El-Sayed-Mustafa/solana-market-bot"]')).toHaveCount(0);
  });

  test("show the screenshot the author published, with where it comes from", async ({ page }) => {
    await page.goto(`${SOLANA}#screenshots`);
    const figure = page.locator("#screenshots figure");
    await expect(figure.getByRole("img")).toBeInViewport();
    await expect(figure.getByRole("img")).toHaveAttribute("alt", /control room/i);
    await expect(figure).toContainText("as published by the author in the project's public write-up");
    await page.goto(MARKET);
    await expect(page.locator("#screenshots figure")).toContainText("Everything on it is public market data");
    await openTab(page, "Evidence");
    await expect(page.locator("#evidence").getByText("(private)")).toBeVisible();
  });

  test("state what is and is not live", async ({ page }) => {
    await page.goto(`${MARKET}#architecture`);
    await expect(page.getByText("Running in shadow beside the system it replaces. The switch is approved and not yet made.")).toBeVisible();
    const architecture = page.locator("#architecture");
    await architecture.scrollIntoViewIfNeeded();
    await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(16);
    await expect(architecture.getByRole("button", { name: /^Telegram:/ })).toContainText("disabled");
    await expect(architecture.getByRole("button", { name: /^Legacy poller:/ })).toContainText("legacy");

    await page.goto("about:blank");
    await page.goto(`${SOLANA}#architecture`);
    await expect(page.getByText(/Paper trading is the default; a real-execution layer exists behind two switches and a wallet key/)).toBeVisible();
    const solana = page.locator("#architecture");
    await solana.scrollIntoViewIfNeeded();
    await expect(solana.locator(".react-flow__node-arch")).toHaveCount(16);
    await expect(solana.getByRole("button", { name: /^Real-execution pilot:/ })).toContainText("disabled");
  });

  test("every role statement is labelled as stated by the owner", async ({ page }) => {
    for (const path of [SOLANA, MARKET, TRIAGE, RUGS, LEADS, RATING, CRM]) {
      await page.goto(path);
      const role = page.locator("[data-main] header").getByRole("list", { name: "Status, role and context" }).getByRole("listitem").filter({ hasText: "My role" });
      await expect(role.locator('[title^="Stated by owner"]')).toBeVisible();
    }
  });
});

test.describe("visitor uses the Automation Lab", () => {
  test("picks a workflow from the library and gets a clean run each time", async ({ page }) => {
    await page.goto("/automation-lab");
    const library = page.getByRole("complementary", { name: "Workflow library" });
    await expect(library.getByRole("button")).toHaveCount(8);
    const sim = simulator(page);
    await expect(sim.getByRole("heading", { name: "WhatsApp enquiry to a booked visit" })).toBeVisible();

    await runToDecision(page);
    await library.getByRole("button", { name: /A job posting, from fetch to human decision/ }).click();
    await expect(page).toHaveURL(/\?workflow=posting-to-decision$/);
    await expect(sim.getByRole("heading", { name: "A job posting, from fetch to human decision" })).toBeVisible();
    // Switching workflows never carries a run, an input or a selection across.
    await expect(sim.getByTestId("run-status")).toHaveText("Not started");
    await expect(sim.getByText("0/15 steps settled")).toBeVisible();

    await library.getByRole("button", { name: /WhatsApp enquiry to a booked visit/ }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Not started");
    await expect(sim.getByText("0/13 steps settled")).toBeVisible();
  });

  test("opens a workflow straight from a link, and links back to its case study", async ({ page }) => {
    await page.goto("/automation-lab?workflow=posting-to-decision");
    await expect(simulator(page).getByRole("heading", { name: "A job posting, from fetch to human decision" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Workflow library" }).getByRole("button", { pressed: true })).toContainText("A job posting");
    await page.getByRole("link", { name: /Job Triage Pipeline with LLM Guardrails/ }).click();
    await expect(page).toHaveURL(new RegExp(`${TRIAGE}$`));
  });
});

test.describe("visitor checks the evidence", () => {
  test("finds the files behind the claims in the engineer lens", async ({ page }) => {
    await openEngineerCaseStudy(page);
    await expect(page.locator("#overview").getByText("Verified in code").first()).toBeVisible();
    await expect(page.locator("#overview").getByText("Engineering challenges")).toBeVisible();
    await openTab(page, "Evidence");
    const evidence = page.locator("#evidence");
    await expect(evidence.getByText("SUPABASE_MIGRATION_TEST_RESULTS_AR.md", { exact: true })).toBeVisible();
    await expect(evidence.getByText("supabase/migrations", { exact: true })).toBeVisible();
  });

  test("every kind of evidence label is explained on the page", async ({ page }) => {
    await page.goto(CRM);
    const legend = page.locator("#overview details").filter({ hasText: "What the evidence labels on this page mean" });
    await legend.locator("summary").click();
    for (const label of ["Verified in code", "Documented by author", "Stated by owner", "Inferred", "Proposed"]) {
      await expect(legend.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("source references stay as plain paths and screenshots stay unpublished", async ({ page }) => {
    await openEngineerCaseStudy(page, CRM, "evidence");
    const evidence = page.locator("#evidence");
    await expect(evidence.getByText(/File references are shown as paths, not links/)).toBeVisible();
    await expect(evidence.getByRole("link", { name: "Request the source code" })).toHaveAttribute("href", "/source-access?project=pest-control-crm");
    await expect(evidence.getByText("None published")).toBeVisible();
    // No link on the page points into the repository.
    await expect(page.locator('main a[href*="github.com"][href*="/blob/"]')).toHaveCount(0);
    await expect(page.locator("main img")).toHaveCount(0);
  });

  test("opens a known limit and sees what ships today next to what is only proposed", async ({ page }) => {
    await page.goto(`${CRM}#limitations`);
    const limit = page.locator("#limitations details").first();
    await limit.locator("summary").click();
    await expect(limit.getByText("Today", { exact: true })).toBeVisible();
    await expect(limit.getByText("Improvement", { exact: true })).toBeVisible();
    await expect(limit.getByText("Proposed", { exact: true })).toBeVisible();
  });

  test("opens an engineering decision and sees the rejected option", async ({ page }) => {
    await page.goto(`${CRM}#decisions`);
    const decision = page.locator("#decisions details").filter({ hasText: "Reads fall back. Writes never do." });
    await decision.locator("summary").click();
    await expect(decision.getByText("Replay a failed write through Apps Script, as reads do")).toBeVisible();
    await expect(decision.getByText("Rejected").first()).toBeVisible();
    await expect(decision.getByText("Trade-offs accepted")).toBeVisible();
  });
});

test.describe("visitor asks for the source code", () => {
  /** The request is an email link; reading it back shows exactly what would be sent. */
  async function readRequest(page: Page) {
    const href = (await page.getByTestId("source-request-send").getAttribute("href")) ?? "";
    const [address, query] = href.replace(/^mailto:/, "").split("?");
    const params = new URLSearchParams(query);
    return { address, subject: params.get("subject") ?? "", body: (params.get("body") ?? "").replace(/\r\n/g, "\n") };
  }

  test("goes from a case study to a request with that project already chosen", async ({ page }) => {
    await page.goto(`${CRM}#evidence`);
    await page.locator("#evidence").getByRole("link", { name: "Request the source code" }).click();
    await expect(page).toHaveURL(/\/source-access\?project=pest-control-crm$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request the source code");

    const form = page.getByRole("form", { name: "Source code request" });
    await expect(form.getByLabel("Project")).toHaveValue("pest-control-crm");
    await form.getByLabel("Your name").fill("Sample Reviewer");
    await form.getByLabel(/Company or role/).fill("Example Engineering");
    await form.getByLabel("What do you need the code for?").fill("I am reviewing candidates for a backend role and would like to read the outbox worker.");

    const request = await readRequest(page);
    expect(request.address).toMatch(/@/);
    expect(request.subject).toBe("Source code request: Pest Control CRM and Field Operations");
    expect(request.body).toContain("Name: Sample Reviewer");
    expect(request.body).toContain("Company or role: Example Engineering");
    expect(request.body).toContain("I am reviewing candidates for a backend role");

    // The visitor can read the email before anything opens.
    await form.getByText("Read the email before it is sent").click();
    await expect(form.getByTestId("source-request-preview")).toContainText("I would like to read the source code of: Pest Control CRM and Field Operations");
  });

  test("does not open an email until a name and a purpose are given", async ({ page }) => {
    await page.goto("/source-access");
    const form = page.getByRole("form", { name: "Source code request" });
    await expect(form.getByText("Enter your name.")).toBeHidden();
    await form.getByTestId("source-request-send").click();
    await expect(page).toHaveURL(/\/source-access$/);
    await expect(form.getByText("Enter your name.")).toBeVisible();
    await expect(form.getByText("Say what you need the code for, in a sentence or two.")).toBeVisible();
    await expect(form.getByLabel("Your name")).toBeFocused();
    await expect(form.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");

    await form.getByLabel("Your name").fill("Sample Reviewer");
    await form.getByLabel("What do you need the code for?").fill("curious");
    await expect(form.getByText("Enter your name.")).toBeHidden();
    await expect(form.getByText("Say what you need the code for, in a sentence or two.")).toBeVisible();
  });

  test("a write-up on the work index leads to a request for that project", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: "Source on request: Wholesale and E-commerce Operations Platform" }).click();
    const project = page.getByRole("form", { name: "Source code request" }).getByLabel("Project");
    await expect(project.locator("option:checked")).toHaveText("Wholesale and E-commerce Operations Platform");
    // A project that publishes its source has nothing to request.
    await expect(project.locator("option")).not.toContainText(["Lead Discovery and Contact Enrichment Engine"]);
    await expect(project.locator("option").filter({ hasText: "Rug Inventory and Shopify Synchronisation" })).toHaveCount(1);
  });

  test("a project that is not listed can be named", async ({ page }) => {
    await page.goto("/source-access");
    const form = page.getByRole("form", { name: "Source code request" });
    await form.getByLabel("Project").selectOption({ label: "Another project" });
    await form.getByLabel("Your name").fill("Sample Reviewer");
    await form.getByLabel("What do you need the code for?").fill("I would like to see how the scheduler was built.");
    await form.getByTestId("source-request-send").click();
    await expect(form.getByText("Choose the project you want to read.")).toBeVisible();
    await form.getByLabel("Which project?").fill("The scheduler you described");
    expect((await readRequest(page)).subject).toBe("Source code request: The scheduler you described");
  });

  test("the request can be copied instead of opened", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/source-access?project=job-triage-pipeline");
    const form = page.getByRole("form", { name: "Source code request" });
    await form.getByLabel("Your name").fill("Sample Reviewer");
    await form.getByLabel("What do you need the code for?").fill("I would like to read the scoring guardrails for an interview.");
    await form.getByRole("button", { name: "Copy the request" }).click();
    await expect(form.getByRole("status")).toContainText("Copied.");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Subject: Source code request: Job Triage Pipeline with LLM Guardrails");
    expect(copied).toContain("I would like to read the scoring guardrails for an interview.");
  });

  test("is reachable from the contact section and the footer", async ({ page }) => {
    await page.goto("/#contact");
    await page.locator("#contact").getByRole("link", { name: "Request access" }).click();
    await expect(page).toHaveURL(/\/source-access$/);
    await page.goto("/");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Source code access" })).toHaveAttribute("href", "/source-access");
  });
});

test.describe("visitor opens the resume", () => {
  test("reaches it from the home page and finds the same facts as the site", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "View resume" }).click();
    await expect(page).toHaveURL(/\/resume$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resume");
    // The CV as it is sent: both pages, and the file itself.
    await expect(page.getByRole("img", { name: /^Page \d of 2 of the CV of Elsayed Mustafa/ })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Download CV (PDF)" })).toHaveAttribute("href", "/Elsayed_Mustafa_CV.pdf");
    const file = await page.request.get("/Elsayed_Mustafa_CV.pdf");
    expect(file.headers()["content-type"]).toContain("application/pdf");
    // The same facts as a web page, with their evidence, one press away.
    await page.getByText("Read it as a web page, with links to the evidence").click();
    for (const section of ["Summary", "Experience", "Selected systems", "Capabilities", "Education", "Certifications"]) {
      await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
    }
    const systems = page.getByRole("region", { name: "Selected systems" });
    await expect(systems.getByRole("link", { name: "Pest Control CRM and Field Operations" })).toHaveAttribute("href", CRM);
    // A figure on the resume still says where it comes from.
    await expect(systems.getByText(/about 5\.6 s to about 0\.56 s/)).toBeVisible();
    await expect(systems.getByText("(documented by author)").first()).toBeVisible();
  });

  test("prints as ink on white paper, without the site chrome, in the dark theme too", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/resume");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("contentinfo")).toBeHidden();
    await expect(page.getByRole("button", { name: "Print this page" })).toBeHidden();
    const colours = await page.evaluate(() => {
      const heading = document.querySelector("h1")!;
      return { paper: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(heading).color };
    });
    expect(colours.paper).toBe("rgb(255, 255, 255)");
    expect(colours.ink).toBe("rgb(17, 17, 17)");
  });
});

test.describe("preferences", () => {
  test("keeps the lens and theme across a reload", async ({ page }) => {
    await page.goto(CRM);
    await page.getByRole("button", { name: "Engineer" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-lens", "engineer");

    const before = await page.locator("html").getAttribute("data-theme");
    await page.getByRole("button", { name: /^Switch to (dark|light) theme$/ }).click();
    const after = before === "dark" ? "light" : "dark";
    await expect(page.locator("html")).toHaveAttribute("data-theme", after);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-lens", "engineer");
    await expect(page.locator("html")).toHaveAttribute("data-theme", after);
    await expect(page.locator("#overview").getByText("Engineering challenges")).toBeVisible();
  });

  test("both themes paint their own page and text colours", async ({ page }) => {
    const seen: Record<string, { background: string; color: string }> = {};
    for (const theme of ["light", "dark"] as const) {
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      seen[theme] = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, color: style.color };
      });
    }
    expect(seen.light.background).toBe("rgb(248, 250, 255)");
    expect(seen.dark.background).toBe("rgb(10, 15, 30)");
    expect(seen.light.color).not.toBe(seen.dark.color);
  });

  test("the site is light until the visitor chooses dark, whatever the system prefers", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("keeps the reader in the same section when the lens changes", async ({ page }) => {
    await page.goto(`${CRM}#decisions`);
    // Let the page settle first: a late font or image would move the heading on its own.
    await page.waitForLoadState("networkidle");
    const heading = page.locator("#decisions-title");
    // Park the reader partway into the Decisions section, without animation.
    await heading.evaluate((element) => {
      window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 140, behavior: "instant" });
    });
    const before = await heading.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.round(before)).toBe(140);
    await page.getByRole("button", { name: "Engineer" }).click();
    const after = await heading.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(after - before)).toBeLessThan(4);
  });
});

test.describe("site basics", () => {
  test("serves a helpful 404 page", async ({ page }) => {
    const response = await page.goto("/projects/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible();
    await page.getByRole("link", { name: "See all projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("publishes a sitemap and robots file", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    const xml = await sitemap.text();
    for (const path of [CRM, TRIAGE, SOLANA, MARKET, RUGS, LEADS, RATING, "/automation-lab", "/projects", "/resume", "/source-access"]) expect(xml).toContain(path);
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Sitemap:");
  });

  test("loads every page without a console or hydration error", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of ["/", "/projects", "/automation-lab", "/resume", "/source-access", TRIAGE, SOLANA, MARKET, RUGS, LEADS, RATING, CRM]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    for (const label of ["Demo", "Decisions", "Limits", "Evidence", "Architecture"]) await openTab(page, label);
    await expect(page.locator("#architecture .react-flow__node-arch")).toHaveCount(14);
    expect(errors).toEqual([]);
  });
});
