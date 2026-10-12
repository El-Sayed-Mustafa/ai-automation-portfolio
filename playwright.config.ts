import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * End-to-end tests run against the production build.
 *
 * They use an installed browser instead of a downloaded one: Edge by default,
 * or whatever PW_CHANNEL names (for example "chrome").
 *
 *   npm run build && npm run test:e2e
 */
const channel = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  // A browser per core starves the machine and shows up as timeouts in whichever tests run last.
  workers: process.env.CI ? 2 : 5,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    // A demo folds its steps and their data away until a visitor asks for them. Nearly every test works with
    // those steps, so they start unfolded here; e2e/story.spec.ts covers what a first-time visitor sees.
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: "demo-details", value: "open" }] }] },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } }, testIgnore: /responsive/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, testMatch: /responsive/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
