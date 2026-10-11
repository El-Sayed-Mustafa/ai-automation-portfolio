// Visual review helper: captures viewport screenshots of named spots on the
// site at several widths, in an installed browser.
//
//   node scripts/screenshots.mjs <outDir> [baseUrl] [filter]
//
// The dev server or a production server must already be running.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const outDir = process.argv[2] ?? "screenshots";
const baseUrl = process.argv[3] ?? "http://localhost:3000";
const filter = process.argv[4] ?? "";

const WIDTHS = { phone: [390, 844], tablet: [768, 1024], laptop: [1280, 800], desktop: [1440, 900], wide: [1600, 950], full: [1920, 1040], ref: [1672, 941], home: [1536, 1024] };

const sim = (page) => page.getByTestId("workflow-simulator");

async function runToDecision(page) {
  await sim(page).getByLabel("Speed").selectOption("0");
  await sim(page).getByRole("button", { name: "Run workflow" }).click();
  await sim(page).getByRole("group", { name: "Decision needed" }).waitFor();
}

/**
 * name, path, optional selector to bring to the top, and an optional `act`
 * that puts the page into the state worth looking at. With `into`, the shot
 * is taken after scrolling that element into view instead. A case-study tab
 * is opened by its hash in the path. `full` captures the whole page.
 */
const CRM = "/projects/pest-control-crm";
const SOLANA = "/projects/solana-research-platform";
const MARKET = "/projects/market-data-platform";
const TRIAGE = "/projects/job-triage-pipeline";
const RUGS = "/projects/rug-inventory-sync";
const LEADS = "/projects/lead-enrichment-engine";
const RATING = "/projects/rating-estimator";

const SHOTS = [
  { name: "home-top", path: "/" },
  { name: "home-full", path: "/", full: true },
  { name: "home-demo", path: "/", selector: "#demo" },
  { name: "home-work", path: "/", selector: "#work" },
  { name: "home-capabilities", path: "/", selector: "#capabilities" },
  { name: "home-about", path: "/", selector: "#about" },
  { name: "home-contact", path: "/", selector: "#contact" },
  { name: "projects", path: "/projects" },
  { name: "projects-full", path: "/projects", full: true },
  {
    name: "projects-search",
    path: "/projects",
    act: async (page) => {
      await page.getByRole("searchbox", { name: "Search projects" }).fill("supabase");
    },
  },
  { name: "lab", path: "/automation-lab" },
  { name: "lab-triage", path: "/automation-lab?workflow=posting-to-decision", selector: '[data-testid="workflow-simulator"]' },
  { name: "resume", path: "/resume" },
  { name: "source-access", path: "/source-access?project=pest-control-crm" },
  { name: "work-writeups", path: "/projects", selector: "#write-ups-title" },
  { name: "not-found", path: "/projects/does-not-exist", allowError: true },
  { name: "crm-top", path: CRM },
  { name: "crm-full", path: CRM, full: true },
  { name: "crm-how", path: `${CRM}#how-it-works` },
  { name: "crm-results", path: `${CRM}#results` },
  { name: "crm-demo", path: `${CRM}#demo` },
  {
    name: "crm-demo-decision",
    path: `${CRM}#demo`,
    act: runToDecision,
    into: (page) => sim(page).getByRole("group", { name: "Decision needed" }),
  },
  {
    name: "crm-demo-outcome",
    path: `${CRM}#demo`,
    act: async (page) => {
      await runToDecision(page);
      await sim(page).getByRole("button", { name: /Interested, book a visit/ }).click();
      await sim(page).getByTestId("run-outcome").waitFor();
      await sim(page).getByRole("button", { name: "Step 10, Write the appointment: Success" }).click();
    },
    into: (page) => sim(page).getByTestId("run-outcome"),
  },
  {
    name: "crm-demo-failure",
    path: `${CRM}#demo`,
    act: async (page) => {
      await sim(page).getByRole("button", { name: "Edit input and failures" }).click();
      await sim(page).getByLabel(/The worker keeps failing/).check();
      await runToDecision(page);
      await sim(page).getByRole("button", { name: /Interested, book a visit/ }).click();
      await sim(page).getByTestId("run-outcome").waitFor();
      await sim(page).getByRole("button", { name: /^Step 12, Worker drains the outbox/ }).click();
    },
    into: (page) => sim(page).getByTestId("run-outcome"),
  },
  {
    name: "crm-sandbox-decision",
    path: `${CRM}#demo`,
    act: async (page) => {
      await sim(page).getByRole("group", { name: "Where it runs" }).getByRole("button", { name: "On the server" }).click();
      await runToDecision(page);
      await sim(page).getByTestId("sandbox-summary").waitFor();
    },
    into: (page) => sim(page).getByRole("group", { name: "Where it runs" }),
  },
  {
    name: "crm-sandbox-database",
    path: `${CRM}#demo`,
    act: async (page) => {
      await sim(page).getByRole("group", { name: "Where it runs" }).getByRole("button", { name: "On the server" }).click();
      await runToDecision(page);
      await sim(page).getByRole("button", { name: /Interested, book a visit/ }).click();
      await sim(page).getByTestId("run-outcome").waitFor();
      // On a narrow screen the inspector takes turns with the step list.
      const inspector = sim(page).getByRole("group", { name: "Show" }).getByRole("button", { name: "Inspector" });
      if (await inspector.isVisible()) await inspector.click();
      await sim(page).getByRole("tab", { name: "Database" }).click();
      await sim(page).getByTestId("sandbox-database").locator("details").filter({ hasText: "crm_appointments" }).locator("summary").click();
      await sim(page).getByRole("list", { name: "Recent runs on this server" }).waitFor();
    },
    into: (page) => sim(page).getByTestId("run-outcome"),
  },
  { name: "crm-architecture", path: `${CRM}#architecture` },
  {
    name: "crm-architecture-selected",
    path: `${CRM}#architecture`,
    act: async (page) => {
      await page.locator("#architecture").getByRole("button", { name: /^Green API:/ }).click();
      await page.locator("#architecture").getByRole("complementary", { name: "Details for Green API" }).waitFor();
    },
  },
  {
    name: "crm-architecture-route",
    path: `${CRM}#architecture`,
    act: async (page) => {
      await page.locator("#architecture .react-flow__node-arch").first().waitFor();
      await page.locator("#architecture").getByRole("button", { name: "Data flow" }).click();
      await page.locator("#architecture").getByRole("group", { name: "Follow a request" }).getByRole("button", { name: "The technician is notified" }).click();
    },
  },
  { name: "crm-decisions", path: `${CRM}#decisions` },
  { name: "crm-limitations", path: `${CRM}#limitations` },
  { name: "crm-evidence", path: `${CRM}#evidence` },
  { name: "solana-top", path: SOLANA },
  { name: "solana-full", path: SOLANA, full: true },
  { name: "solana-results", path: `${SOLANA}#results` },
  { name: "solana-demo", path: `${SOLANA}#demo` },
  {
    name: "solana-demo-decision",
    path: `${SOLANA}#demo`,
    act: runToDecision,
    into: (page) => sim(page).getByRole("group", { name: "Decision needed" }),
  },
  { name: "solana-architecture", path: `${SOLANA}#architecture` },
  { name: "solana-evidence", path: `${SOLANA}#evidence` },
  { name: "market-top", path: MARKET },
  { name: "market-results", path: `${MARKET}#results` },
  {
    name: "market-demo-dead-job",
    path: `${MARKET}#demo`,
    act: async (page) => {
      await sim(page).getByRole("button", { name: "Edit input and failures" }).click();
      await sim(page).getByLabel(/Both providers are unreachable/).check();
      await runToDecision(page);
    },
    into: (page) => sim(page).getByRole("group", { name: "Decision needed" }),
  },
  { name: "market-architecture", path: `${MARKET}#architecture` },
  { name: "market-evidence", path: `${MARKET}#evidence` },
  { name: "triage-top", path: TRIAGE },
  { name: "triage-demo", path: `${TRIAGE}#demo` },
  { name: "triage-architecture", path: `${TRIAGE}#architecture` },
  { name: "rugs-top", path: RUGS },
  { name: "rugs-full", path: RUGS, full: true },
  { name: "rugs-demo-decision", path: `${RUGS}#demo`, act: runToDecision, into: (page) => sim(page).getByRole("group", { name: "Decision needed" }) },
  { name: "rugs-architecture", path: `${RUGS}#architecture` },
  { name: "rugs-limits", path: `${RUGS}#limitations` },
  { name: "leads-top", path: LEADS },
  { name: "leads-results", path: `${LEADS}#results` },
  { name: "leads-demo", path: `${LEADS}#demo` },
  { name: "leads-architecture", path: `${LEADS}#architecture` },
  { name: "rating-top", path: RATING },
  { name: "rating-full", path: RATING, full: true },
  { name: "rating-demo", path: `${RATING}#demo` },
  { name: "rating-architecture", path: `${RATING}#architecture` },
  { name: "rating-evidence", path: `${RATING}#evidence` },
  {
    name: "crm-stage",
    path: `${CRM}#architecture`,
    act: async (page) => {
      await page.locator("#architecture .react-flow__node-arch").first().waitFor();
      await page.locator("#stages").getByRole("button", { name: /^Booking/ }).click();
      await page.locator("#architecture").scrollIntoViewIfNeeded();
    },
  },
  {
    name: "solana-summary-open",
    path: SOLANA,
    act: async (page) => {
      await page.locator("[data-main] header").getByRole("button", { name: "Details" }).click();
    },
  },
  {
    name: "rugs-lightbox",
    path: RUGS,
    act: async (page) => {
      await page.locator("#screenshots").getByRole("link", { name: /^Open full size/ }).click();
    },
  },
  { name: "crm-overview-picture", path: CRM, selector: "#system" },
  {
    name: "crm-sheet",
    path: `${CRM}#architecture`,
    narrowOnly: true,
    act: async (page) => {
      await page.locator("#architecture").getByRole("button", { name: /^Office web app:/ }).click();
      await page.locator("#architecture").getByRole("complementary", { name: "Details for Office web app" }).waitFor();
    },
  },
  {
    name: "crm-drawer",
    path: CRM,
    narrowOnly: true,
    act: async (page) => {
      await page.getByRole("button", { name: /^All projects/ }).click();
    },
  },
  {
    name: "menu",
    path: "/projects",
    narrowOnly: true,
    act: async (page) => {
      await page.getByRole("button", { name: "Menu" }).click();
    },
  },
];

const themes = (process.env.THEMES ?? "light").split(",");
const lenses = (process.env.LENSES ?? "recruiter").split(",");
const widths = (process.env.WIDTHS ?? Object.keys(WIDTHS).join(",")).split(",");

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });

for (const widthName of widths) {
  const [width, height] = WIDTHS[widthName];
  for (const theme of themes) {
    for (const lens of lenses) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      await context.addInitScript(
        ([t, l]) => {
          localStorage.setItem("theme", t);
          localStorage.setItem("lens", l);
        },
        [theme, lens],
      );
      const page = await context.newPage();
      for (const shot of SHOTS) {
        if (filter && !shot.name.includes(filter)) continue;
        if (shot.narrowOnly && width >= 1024) continue;
        // A fresh document every time: a hash-only change would not re-run the page.
        await page.goto("about:blank");
        const response = await page.goto(baseUrl + shot.path, { waitUntil: "networkidle" }).catch(() => null);
        if (!response || (response.status() >= 400 && !shot.allowError)) continue;
        if (shot.selector) {
          const found = await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (!element) return false;
            // The same jump a link to this anchor makes, so the shot shows the real offset under the sticky bars.
            element.scrollIntoView({ block: "start", behavior: "instant" });
            return true;
          }, shot.selector);
          if (!found) continue;
        }
        try {
          if (shot.act) await shot.act(page);
          if (shot.into) await shot.into(page).scrollIntoViewIfNeeded();
        } catch (error) {
          console.error(`${shot.name} at ${widthName}: ${String(error.message).split(/\r?\n/)[0]}`);
          continue;
        }
        await page.waitForTimeout(900);
        const file = path.join(outDir, `${shot.name}.${widthName}.${theme}.${lens}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 70, fullPage: Boolean(shot.full) });
        console.log(file);
      }
      await context.close();
    }
  }
}
await browser.close();
