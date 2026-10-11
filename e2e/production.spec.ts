import { expect, test, type Page } from "@playwright/test";
import site from "../content/site.json";

/**
 * What a deployment has to get right besides the pages themselves: the
 * headers every response carries, that nothing is loaded from or sent to
 * another origin, the picture a shared link shows, and the addresses search
 * engines are given.
 */
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
/** The origin the build was told it will be served from. The tests run it somewhere else, on purpose. */
const SITE_URL = (process.env.SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : site.url)).replace(/\/+$/, "");

/** Width and height of a PNG, read from its header. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function meta(page: Page, selector: string): Promise<string | null> {
  return page.locator(`head ${selector}`).first().getAttribute("content");
}

test.describe("response headers", () => {
  for (const path of ["/", CRM, "/api/sandbox", "/opengraph-image", "/does-not-exist"]) {
    test(`${path} carries the security headers`, async ({ request }) => {
      const response = await request.get(path);
      const headers = response.headers();
      const policy = headers["content-security-policy"];
      for (const directive of ["default-src 'self'", "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
        expect(policy, directive).toContain(directive);
      }
      // The production build needs no eval and names no other origin.
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).not.toMatch(/https?:/);
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["strict-transport-security"]).toMatch(/max-age=\d{7,}/);
      // Nothing says what the server is built with.
      expect(headers["x-powered-by"]).toBeUndefined();
    });
  }

  test("a page that does not exist answers 404, with the site around it", async ({ page }) => {
    const response = await page.goto("/projects/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("link", { name: /projects/i }).first()).toBeVisible();
  });
});

test.describe("privacy: the site talks to itself only", () => {
  test("no page loads anything from another origin or breaks its own policy", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    const violations: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("about:")) foreign.push(url);
    });
    page.on("console", (message) => {
      if (/content security policy|refused to (load|execute|connect|apply)/i.test(message.text())) violations.push(message.text());
    });
    page.on("pageerror", (error) => violations.push(String(error)));

    for (const path of ["/", "/projects", "/automation-lab", "/resume", "/source-access", CRM, `${CRM}#architecture`, `${CRM}#demo`]) {
      await page.goto("about:blank");
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    // The heaviest thing the site does: run a workflow on the server and draw the diagram.
    const sim = page.getByTestId("workflow-simulator");
    await sim.getByRole("group", { name: "Where it runs" }).getByRole("button", { name: "On the server" }).click();
    await sim.getByLabel("Speed").selectOption("0");
    await sim.getByRole("button", { name: /^Run (workflow|again)$/ }).click();
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");

    expect(foreign, "requests to another origin").toEqual([]);
    expect(violations, "policy violations and page errors").toEqual([]);
    // Nothing is kept about the visitor beyond their own choices of theme, lens and rail.
    expect(await page.context().cookies()).toEqual([]);
    const stored = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(stored.every((key) => ["lens", "rail", "theme"].includes(key)), stored.join(", ")).toBe(true);
  });
});

test.describe("the picture a shared link shows", () => {
  test("the home page names its image, and the image is 1200 by 630", async ({ page, request }) => {
    await page.goto("/");
    const image = await meta(page, 'meta[property="og:image"]');
    expect(image).toBeTruthy();
    expect(image!.startsWith(SITE_URL), `${image} is an address on ${SITE_URL}`).toBe(true);
    expect(await meta(page, 'meta[property="og:image:width"]')).toBe("1200");
    expect(await meta(page, 'meta[property="og:image:height"]')).toBe("630");
    expect(await meta(page, 'meta[property="og:image:alt"]')).toContain(site.name);
    expect(await meta(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    expect(await meta(page, 'meta[name="twitter:image"]')).toBeTruthy();

    const url = new URL(image!);
    const response = await request.get(url.pathname + url.search);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
    const bytes = await response.body();
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
    // A picture with something drawn in it, not an empty frame.
    expect(bytes.length).toBeGreaterThan(20_000);
  });

  for (const study of STUDIES) {
    test(`${study} has an image of its own`, async ({ page, request }) => {
      await page.goto(`/projects/${study}`);
      const image = await meta(page, 'meta[property="og:image"]');
      expect(image, "og:image").toContain(`/projects/${study}/opengraph-image`);
      expect(await meta(page, 'meta[property="og:type"]')).toBe("article");
      expect(await meta(page, 'meta[property="og:url"]')).toBe(`${SITE_URL}/projects/${study}`);
      expect(await page.locator('head link[rel="canonical"]').getAttribute("href")).toBe(`${SITE_URL}/projects/${study}`);
      const url = new URL(image!);
      const response = await request.get(url.pathname + url.search);
      expect(response.status()).toBe(200);
      expect(pngSize(await response.body())).toEqual({ width: 1200, height: 630 });
    });
  }

  test("a case study that does not exist has no image", async ({ request }) => {
    expect((await request.get("/projects/does-not-exist/opengraph-image")).status()).toBe(404);
  });
});

test.describe("what search engines are given", () => {
  test("the sitemap lists every page once, on the site's own address", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const locations = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    const expected = ["/", "/projects", "/automation-lab", "/resume", "/source-access", ...STUDIES.map((study) => `/projects/${study}`)].map((path) => `${SITE_URL}${path}`);
    expect([...locations].sort()).toEqual([...expected].sort());
  });

  test("robots.txt allows the site and points to the sitemap", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    expect(text).toMatch(/User-Agent: \*/i);
    expect(text).toMatch(/Allow: \//);
    expect(text).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  test("every page has a title and a description of its own", async ({ page }) => {
    const seen = new Map<string, string>();
    for (const path of ["/", "/projects", "/automation-lab", "/resume", "/source-access", ...STUDIES.map((study) => `/projects/${study}`)]) {
      await page.goto(path);
      const title = await page.title();
      expect(title.length, `${path} title`).toBeGreaterThan(10);
      expect(seen.has(title), `${path} shares its title with ${seen.get(title)}`).toBe(false);
      seen.set(title, path);
      expect(((await meta(page, 'meta[name="description"]')) ?? "").length, `${path} description`).toBeGreaterThan(40);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    }
  });
});
