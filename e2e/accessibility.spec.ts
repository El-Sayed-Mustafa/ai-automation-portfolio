import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The accessibility audit.
 *
 * axe-core runs inside the page against every route, every tab of every case
 * study in both lenses, and the states a visitor can put a page in, in both
 * themes. It checks the WCAG 2.2 A and AA rules that a machine can check; it
 * does not replace reading the site with a screen reader.
 *
 * Any finding fails the test, whatever its severity. Where something is left
 * out of a check, the reason is written where it is left out.
 */
const AXE = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const CRM = "/projects/pest-control-crm";
const STUDIES = [
  "pest-control-crm",
  "solana-research-platform",
  "market-data-platform",
  "job-triage-pipeline",
  "rug-inventory-sync",
  "lead-enrichment-engine",
  "rating-estimator",
  "review-intelligence-pipeline",
];
const TABS = ["overview", "demo", "architecture", "decisions", "limitations", "evidence"];
const PAGES = ["/", "/projects", "/automation-lab", "/resume", "/source-access", "/source-access?project=pest-control-crm", "/projects/does-not-exist"];

/**
 * While one thing in a diagram is brought forward, the rest is dimmed on
 * purpose, below the contrast a resting page must have. The dimming lasts only
 * as long as the selection, Escape clears it, and the same content is under
 * the diagram as a list. Only the contrast rule is skipped, and only on what
 * is dimmed.
 */
const DIMMED = [".react-flow__node > .opacity-30", ".react-flow__node > .opacity-40", "[data-layer-stack] [data-dimmed]"];

interface Finding {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string; why: string }[];
}

async function audit(page: Page, options: { dimmed?: boolean } = {}): Promise<Finding[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ({ tags, dimmed }) => {
      type Result = { id: string; impact: string | null; help: string; nodes: { target: unknown[]; failureSummary?: string }[] };
      const axe = (window as unknown as { axe: { run(context: unknown, options: unknown): Promise<{ violations: Result[] }> } }).axe;
      const dimmedNow = dimmed.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
      const results = await axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
      return results.violations
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes
            .filter((node) => {
              if (violation.id !== "color-contrast") return true;
              const element = document.querySelector(String(node.target[node.target.length - 1]));
              return !(element && dimmedNow.some((box) => box.contains(element)));
            })
            .slice(0, 6)
            .map((node) => ({ target: node.target.join(" "), why: (node.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 320) })),
        }))
        .filter((violation) => violation.nodes.length > 0);
    },
    { tags: TAGS, dimmed: options.dimmed ? DIMMED : [] },
  );
}

function explain(findings: Finding[]): string {
  return findings.map((finding) => `${finding.impact} · ${finding.id}: ${finding.help}\n${finding.nodes.map((node) => `    ${node.target}\n        ${node.why}`).join("\n")}`).join("\n");
}

async function expectClean(page: Page, where: string, options: { dimmed?: boolean } = {}) {
  const findings = await audit(page, options);
  expect(findings, `${where}\n${explain(findings)}`).toEqual([]);
}

function simulator(page: Page) {
  return page.getByTestId("workflow-simulator");
}

async function runToDecision(page: Page) {
  const sim = simulator(page);
  await sim.getByLabel("Speed").selectOption("0");
  await sim.getByRole("button", { name: /^Run (workflow|again)$/ }).click();
  await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
}

/** A fresh document each time: changing only the hash would not re-run the page. */
async function open(page: Page, url: string) {
  await page.goto("about:blank");
  await page.goto(url);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`accessibility audit, ${theme} theme`, () => {
    // Entry animations fade content in; with them off, a check never lands half-way through a fade.
    test.use({ reducedMotion: "reduce" });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    });

    for (const route of PAGES) {
      test(`${route}`, async ({ page }) => {
        await open(page, route);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectClean(page, route);
      });
    }

    for (const study of STUDIES) {
      test(`every tab of ${study}, in both lenses`, async ({ page }) => {
        // Twelve page loads and twelve audits: it needs longer than a test that looks at one thing.
        test.slow();
        for (const lens of ["recruiter", "engineer"]) {
          for (const tab of TABS) {
            await open(page, `/projects/${study}?lens=${lens}#${tab}`);
            await expect(page.locator("html")).toHaveAttribute("data-tab", tab);
            if (tab === "architecture") await expect(page.locator("#architecture .react-flow__node-arch").first()).toBeVisible();
            await expectClean(page, `${study} · ${tab} · ${lens}`);
          }
        }
      });
    }

    test("the demo: waiting for a decision, finished, and with a failure injected", async ({ page }) => {
      await open(page, `${CRM}#demo`);
      const sim = simulator(page);
      await runToDecision(page);
      await expectClean(page, "demo, waiting for a decision");

      await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
      await expect(sim.getByTestId("run-outcome")).toBeVisible();
      await expectClean(page, "demo, finished");
      for (const tab of ["Payload", "Logs", "Data changes"]) {
        await sim.getByRole("tab", { name: tab }).click();
        await expectClean(page, `demo, inspector on ${tab}`);
      }

      await sim.getByRole("button", { name: "Edit input and failures" }).click();
      await sim.getByLabel(/Double-book the crew/).check();
      await expectClean(page, "demo, setup open with a failure chosen");
      await sim.getByRole("button", { name: /^Run (workflow|again)$/ }).click();
      await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
      await expect(sim.getByTestId("run-outcome")).toBeVisible();
      await expectClean(page, "demo, a refused booking");
    });

    test("the demo run on the server, with its database", async ({ page }) => {
      await open(page, `${CRM}#demo`);
      const sim = simulator(page);
      await sim.getByRole("group", { name: "Where it runs" }).getByRole("button", { name: "On the server" }).click();
      await runToDecision(page);
      await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
      await expect(sim.getByTestId("run-outcome")).toBeVisible();
      await sim.getByRole("tab", { name: "Database" }).click();
      await expect(sim.getByTestId("sandbox-database")).toBeVisible();
      await expectClean(page, "demo on the server, Database tab");
    });

    test("the architecture: a component, a request, a stage, a layer and the expanded view", async ({ page }) => {
      await open(page, `${CRM}#architecture`);
      const architecture = page.locator("#architecture");
      await expect(architecture.locator(".react-flow__node-arch")).toHaveCount(14);

      await architecture.getByRole("button", { name: /^Edge Function crm-api:/ }).click();
      await expect(architecture.getByRole("complementary", { name: "Details for Edge Function crm-api" })).toBeVisible();
      await expectClean(page, "architecture, a component selected", { dimmed: true });
      await page.keyboard.press("Escape");

      await architecture.getByRole("button", { name: "Data flow" }).click();
      await expectClean(page, "architecture, data-flow view");
      await architecture.getByRole("group", { name: "Follow a request" }).getByRole("button", { name: "The technician is notified" }).click();
      await expect(architecture.getByRole("complementary", { name: "Steps of this request" })).toBeVisible();
      await expectClean(page, "architecture, following a request", { dimmed: true });
      await architecture.getByRole("button", { name: "Architecture", exact: true }).click();

      await architecture.locator("#stages").getByRole("button", { name: /^Booking/ }).click();
      await expectClean(page, "architecture, a stage kept", { dimmed: true });
      await architecture.locator("#stages").getByRole("button", { name: /^Booking/ }).click();

      await architecture.getByRole("button", { name: "Focus the Data layer" }).click();
      await expectClean(page, "architecture, a layer in focus", { dimmed: true });
      await architecture.getByRole("button", { name: "Focus the Data layer" }).click();

      await architecture.getByRole("button", { name: "Every connection" }).click();
      await expect(architecture.locator(".react-flow__edge")).toHaveCount(18);
      await expectClean(page, "architecture, every connection drawn");
      await architecture.getByRole("button", { name: "Every connection" }).click();

      await architecture.getByRole("button", { name: "Expand" }).click();
      await expect(page.getByRole("region", { name: "Architecture diagram, expanded" })).toBeVisible();
      await expectClean(page, "architecture, expanded");
      await page.getByRole("region", { name: "Architecture diagram, expanded" }).getByRole("button", { name: "Close" }).click();

      await architecture.getByText("Read the architecture as a list").click();
      // The audit takes the page as it stands, scroll position included. The click brings the list to the middle
      // of the window, which can leave the diagram's zoom buttons half above the window and half behind the
      // site's header: hidden from everyone, and reported as a target too small to press. The diagram goes to
      // the middle of the window instead, where its controls are in plain view; the list is audited all the same.
      await architecture.getByLabel("Architecture diagram", { exact: true }).evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expectClean(page, "architecture, read as a list");
    });

    test("the overview with its summary opened, and a component's longer details", async ({ page }) => {
      await open(page, CRM);
      await page.locator("[data-main] header").getByRole("button", { name: "Details" }).click();
      await expectClean(page, "overview, summary opened");

      await open(page, `${CRM}#architecture`);
      const architecture = page.locator("#architecture");
      await architecture.getByRole("button", { name: /^Supabase Postgres:/ }).click();
      const details = architecture.getByRole("complementary", { name: "Details for Supabase Postgres" });
      await details.getByRole("button", { name: "Inputs, dependencies and failure modes" }).click();
      await expectClean(page, "architecture, a component's longer details", { dimmed: true });
    });

    test("a screenshot opened at full size", async ({ page }) => {
      await open(page, "/projects/rug-inventory-sync");
      await page.locator("#screenshots").getByRole("link", { name: /^Open full size/ }).click();
      await expect(page.getByRole("dialog", { name: /^Screenshot:/ })).toBeVisible();
      await expectClean(page, "screenshot lightbox");
    });

    test("the projects index while searching, and the Lab on another workflow", async ({ page }) => {
      await open(page, "/projects");
      await page.getByRole("searchbox", { name: "Search projects" }).fill("supabase");
      await expectClean(page, "projects, searching");
      await page.getByRole("searchbox", { name: "Search projects" }).fill("no such thing");
      await expect(page.getByText("No project matches that search.")).toBeVisible();
      await expectClean(page, "projects, nothing found");

      await open(page, "/automation-lab?workflow=signal-to-evidence");
      await expect(page.locator("[data-lab-workspace]")).toBeVisible();
      await runToDecision(page);
      await expectClean(page, "Lab, a second workflow at its decision");
    });

    test.describe("on a phone", () => {
      test.use({ viewport: { width: 390, height: 844 } });

      for (const route of ["/", "/projects", "/automation-lab", CRM, `${CRM}#demo`, `${CRM}#architecture`, `${CRM}#evidence`]) {
        test(`${route}`, async ({ page }) => {
          await open(page, route);
          if (route.endsWith("#architecture")) await expect(page.locator("#architecture [data-layer-stack] button").first()).toBeVisible();
          await expectClean(page, `phone ${route}`);
        });
      }

      test("the menu, the project drawer and a component sheet", async ({ page }) => {
        await open(page, CRM);
        await page.getByRole("button", { name: "Menu" }).click();
        await expectClean(page, "phone, menu open");
        await page.keyboard.press("Escape");

        await page.getByRole("button", { name: /^All projects/ }).click();
        await expect(page.getByRole("dialog", { name: "Projects" })).toBeVisible();
        await expectClean(page, "phone, project drawer open");
        await page.keyboard.press("Escape");

        await open(page, `${CRM}#architecture`);
        const architecture = page.locator("#architecture");
        await architecture.getByRole("button", { name: /^Office web app:/ }).click();
        await expect(architecture.getByRole("complementary", { name: "Details for Office web app" })).toBeVisible();
        await expectClean(page, "phone, component sheet open", { dimmed: true });
      });

      test("the demo at its decision", async ({ page }) => {
        await open(page, `${CRM}#demo`);
        await runToDecision(page);
        await expectClean(page, "phone, demo waiting for a decision");
      });
    });
  });
}
