import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * The live sandbox: one workflow that the server can run against a database
 * of its own. The API is tested directly for what it must refuse; the page is
 * tested for what a visitor sees, above all that a run which did not happen
 * on the server never says it did.
 */
const CRM = "/projects/pest-control-crm";
const API = "/api/sandbox";
const SCENARIO = "crm.whatsapp-to-booked-visit";
const INPUT = {
  senderNumber: "97305550142",
  chatType: "individual",
  contactName: "Sample Contact",
  message: "Hello, I have ants in the kitchen. Can you come this week?",
  crew: "Crew A",
  startTime: "13:00",
  serviceType: "General pest control",
  price: 25,
};

/**
 * Each API test speaks from an address of its own, so one test's requests
 * never count against another's limit. The address is made from a number
 * drawn for this process, the worker and a counter: workers run in separate
 * processes, and the server may still be counting a previous run of the suite.
 */
const processPart = 1 + Math.floor(Math.random() * 250);
let addressCounter = 0;
function address(): string {
  addressCounter += 1;
  return `10.${processPart}.${test.info().workerIndex % 250}.${addressCounter}`;
}

function post(request: APIRequestContext, body: unknown, from: string, headers: Record<string, string> = {}) {
  return request.post(API, {
    headers: { "content-type": "application/json", "x-forwarded-for": from, ...headers },
    data: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function run(overrides: Record<string, unknown> = {}) {
  return { scenarioId: SCENARIO, input: INPUT, faults: [], decisions: [], ...overrides };
}

function simulator(page: Page): Locator {
  return page.getByTestId("workflow-simulator");
}

async function chooseServer(page: Page) {
  const where = simulator(page).getByRole("group", { name: "Where it runs" });
  await where.getByRole("button", { name: "On the server" }).click();
  await expect(where.getByRole("button", { name: "On the server" })).toHaveAttribute("aria-pressed", "true");
}

async function runInstantly(page: Page) {
  const sim = simulator(page);
  await sim.getByLabel("Speed").selectOption("0");
  await sim.getByRole("button", { name: /^Run (workflow|again)$/ }).click();
}

/**
 * The badge says the server made this run. The page gives the server six
 * seconds before it simulates instead, so this waits a little longer than
 * that. When the run was simulated after all, the failure carries the reason
 * the page gave, which tells a rate limit from a timeout from a missing server.
 */
async function expectLive(page: Page) {
  const sim = simulator(page);
  await expect
    .poll(
      async () => {
        const mode = await sim.getByTestId("run-mode").innerText();
        const notice = sim.getByTestId("sandbox-notice");
        return (await notice.count()) > 0 ? `${mode}: ${await notice.innerText()}` : mode;
      },
      { timeout: 8_000 },
    )
    .toBe("Live sandbox");
}

test.describe("the sandbox API", () => {
  test("says whether it can run, what it runs and what its limits are", async ({ request }) => {
    const response = await request.get(API);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const status = await response.json();
    expect(status.available).toBe(true);
    expect(status.engine).toMatch(/^SQLite \d+\.\d+/);
    expect(status.scenarios).toEqual([SCENARIO]);
    expect(status.limits.rate.perAddress).toBe(30);
    expect(status.limits.budget.maxMs).toBe(1500);
    expect(Array.isArray(status.recent)).toBe(true);
  });

  test("runs a workflow against a database, pauses at the decision and continues with it", async ({ request }) => {
    const from = address();
    const first = await post(request, run(), from);
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    const waiting = await first.json();
    expect(waiting.mode).toBe("live-sandbox");
    expect(waiting.runId).toMatch(/^sbx-[0-9a-f-]{36}$/);
    expect(waiting.waiting).toBe(true);
    expect(waiting.finished).toBe(false);
    expect(waiting.events.at(-1).type).toBe("step.waiting");
    expect(waiting.database.tables.find((table: { name: string }) => table.name === "crm_leads").rows).toHaveLength(2);

    const second = await post(request, run({ decisions: ["book"], runId: waiting.runId }), from);
    expect(second.status()).toBe(200);
    const done = await second.json();
    expect(done.runId).toBe(waiting.runId);
    expect(done.finished).toBe(true);
    expect(done.events.at(-1)).toMatchObject({ type: "run.finished", status: "success" });
    // The log of the second answer starts with the log of the first: the run was repeated, not changed.
    expect(done.events.slice(0, waiting.events.length - 1)).toEqual(waiting.events.slice(0, -1));
    const appointments = done.database.tables.find((table: { name: string }) => table.name === "crm_appointments").rows;
    expect(appointments.map((row: { appointment_id: string }) => row.appointment_id)).toEqual(["APPT-307", "APPT-311"]);
    expect(done.measured.statements).toBeGreaterThan(10);
    expect(done.measured.ms).toBeLessThan(1500);
    expect(done.ledger.recorded).toBe(true);

    // One line in the ledger for the run, in its final state.
    const status = await (await request.get(API)).json();
    const line = status.recent.find((item: { run: string }) => item.run === waiting.runId.slice(4, 12));
    expect(line).toMatchObject({ scenarioId: SCENARIO, preset: "new-enquiry", status: "success", faults: [] });
  });

  test("every run starts from the same seed: nothing one visitor did is there for the next", async ({ request }) => {
    const first = await (await post(request, run({ decisions: ["book"] }), address())).json();
    const second = await (await post(request, run({ decisions: ["book"] }), address())).json();
    expect(second.database.tables).toEqual(first.database.tables);
    expect(second.events.at(-1).outcome).toContain("APPT-311");
  });

  test("keeps nothing a visitor typed in the public ledger", async ({ request }) => {
    const typed = "E2E-PRIVATE-TEXT-7719";
    const response = await post(request, run({ input: { ...INPUT, message: typed, contactName: "Typed Person" }, decisions: ["lost"] }), address());
    const body = await response.json();
    expect(JSON.stringify(body.events)).toContain(typed);
    const status = await (await request.get(API)).text();
    expect(status).not.toContain(typed);
    expect(status).not.toContain("Typed Person");
    expect(status).not.toContain(INPUT.senderNumber);
    expect(JSON.parse(status).recent.find((item: { run: string }) => item.run === body.runId.slice(4, 12))).toMatchObject({ preset: "custom", status: "success" });
  });

  test("refuses what it should, with a reason and never a stack trace", async ({ request }) => {
    const from = address();
    const cases: [string, Promise<Awaited<ReturnType<typeof post>>>, number, string][] = [
      ["a body that is not JSON", post(request, "{not json", from), 400, "BAD_REQUEST"],
      ["an unknown field", post(request, { ...run(), sql: "DROP TABLE crm_leads" }, from), 400, "BAD_REQUEST"],
      ["a content type that is not JSON", post(request, run(), from, { "content-type": "text/plain" }), 415, "BAD_REQUEST"],
      ["a request from another site", post(request, run(), from, { origin: "https://elsewhere.example" }), 403, "BAD_REQUEST"],
      ["a body past the size limit", post(request, run({ input: { ...INPUT, message: "x".repeat(9000) } }), from), 413, "BAD_REQUEST"],
      ["a scenario that is not on the list", post(request, run({ scenarioId: "solana.signal-to-evidence" }), from), 404, "UNKNOWN_SCENARIO"],
      ["input the validator refuses", post(request, run({ input: { ...INPUT, message: "" } }), from), 422, "INVALID_INPUT"],
      ["a failure that does not exist", post(request, run({ faults: ["delete-everything"] }), from), 422, "INVALID_FAULT"],
      ["a decision that is not on offer", post(request, run({ decisions: ["approve-all"] }), from), 422, "INVALID_DECISION"],
      ["a run id it never issued the shape of", post(request, run({ runId: "../../secret" }), from), 400, "BAD_REQUEST"],
    ];
    for (const [name, pending, status, code] of cases) {
      const response = await pending;
      expect(response.status(), name).toBe(status);
      const text = await response.text();
      expect(JSON.parse(text).error.code, name).toBe(code);
      expect(text, name).not.toMatch(/\bat \w+ \(|node_modules|\.ts:\d+|[A-Z]:\\\\/);
    }
    const invalid = await (await post(request, run({ input: { ...INPUT, message: "", senderNumber: "1" } }), from)).json();
    expect(Object.keys(invalid.error.details).sort()).toEqual(["message", "senderNumber"]);
  });

  test("does not accept any other method", async ({ request }) => {
    for (const method of ["put", "delete", "patch"] as const) {
      expect((await request[method](API)).status(), method).toBe(405);
    }
  });

  test("limits how often one address may run it, and says when to come back", async ({ request }) => {
    const from = address();
    // A request is counted before its body is read, so a flood of bad requests is limited like any other.
    const answers: number[] = [];
    for (let attempt = 0; attempt < 29; attempt += 1) answers.push((await post(request, "{not json", from)).status());
    expect(answers.every((status) => status === 400)).toBe(true);
    expect((await post(request, run(), from)).status()).toBe(200);

    const refused = await post(request, run(), from);
    expect(refused.status()).toBe(429);
    expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
    const body = await refused.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
    // Another address is not affected.
    expect((await post(request, run(), address())).status()).toBe(200);
  });
});

test.describe("running the demo on the server", () => {
  test("is offered only where the server can run the workflow, and is not the default", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith(API)) calls.push(req.method());
    });
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    const where = sim.getByRole("group", { name: "Where it runs" });
    await expect(where.getByRole("button", { name: "In your browser" })).toHaveAttribute("aria-pressed", "true");
    await expect(sim.getByTestId("run-mode")).toHaveText("Simulation");
    await runInstantly(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
    // The default run is in the page: the server was not asked anything.
    expect(calls).toEqual([]);

    await page.goto("/projects/solana-research-platform#demo");
    await expect(simulator(page).getByRole("button", { name: "Run workflow" })).toBeVisible();
    await expect(simulator(page).getByRole("group", { name: "Where it runs" })).toHaveCount(0);
  });

  test("runs against a real database and shows what was real, what was not, and the rows", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await expect(sim.getByTestId("mode-note")).toContainText("This runs in your browser.");
    await chooseServer(page);
    // The note under the title now describes the server run, limits included.
    await expect(sim.getByTestId("mode-note")).toContainText("not the production database");
    await expect(sim.getByTestId("mode-note")).toContainText("no message is sent");
    await expect(sim.getByTestId("mode-note")).not.toContainText("This runs in your browser.");

    await runInstantly(page);
    await expectLive(page);
    await expect(sim.getByTestId("run-status")).toHaveText("Waiting for a decision");
    await expect(sim.getByTestId("sandbox-summary")).toContainText(/Ran on the server in .+: \d+ SQL statements against SQLite \d/);

    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked for Sample Contact with Crew A at 13:00");
    await expectLive(page);
    await expect(sim.getByText(/measured on the server/)).toBeVisible();

    await sim.getByRole("tab", { name: "Database" }).click();
    const database = sim.getByTestId("sandbox-database");
    await expect(database.getByText("Real in this run")).toBeVisible();
    await expect(database.getByText("The email to the technician: nothing is sent")).toBeVisible();
    const appointments = database.locator("details").filter({ hasText: "crm_appointments" });
    await expect(appointments.locator("summary")).toContainText("2 rows");
    await appointments.locator("summary").click();
    await expect(appointments.locator("pre")).toContainText('"appointment_id": "APPT-311"');
    await expect(appointments.locator("pre")).toContainText('"notification_status": "Details emailed"');

    // The server's ledger lists this run, by its preset and with how it ended. Other runs may be listed around it.
    const runId = (await sim.getByText(/^sbx-[0-9a-f-]{36}$/).innerText()).trim();
    const recent = database.getByRole("list", { name: "Recent runs on this server" });
    const mine = recent.getByRole("listitem").filter({ hasText: runId.slice(4, 12) });
    await expect(mine).toContainText("New enquiry");
    await expect(mine).toContainText("Completed");
    await expect(database.getByText(/It never keeps what was typed into the form/)).toBeVisible();
  });

  test("a failure injected on the server is refused by the same rule, and nothing is written", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await chooseServer(page);
    await sim.getByRole("button", { name: "Edit input and failures" }).click();
    await sim.getByLabel(/Double-book the crew/).check();
    await runInstantly(page);
    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
    await expect(sim.getByTestId("run-outcome")).toContainText("No appointment was written.");
    await expectLive(page);
    await sim.getByRole("tab", { name: "Database" }).click();
    await expect(sim.getByTestId("sandbox-database").locator("details").filter({ hasText: "crm_appointments" }).locator("summary")).toContainText("1 row");
    await expect(sim.getByTestId("sandbox-database").locator("details").filter({ hasText: "crm_sync_outbox" }).locator("summary")).toContainText("0 rows");
  });

  test("switching back runs the simulation again and drops the server's tab", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await chooseServer(page);
    await runInstantly(page);
    await expectLive(page);
    await sim.getByRole("group", { name: "Where it runs" }).getByRole("button", { name: "In your browser" }).click();
    await expect(sim.getByText(/The setup changed/)).toBeVisible();
    await sim.getByRole("button", { name: "Run again" }).click();
    await expect(sim.getByTestId("run-mode")).toHaveText("Simulation");
    await expect(sim.getByTestId("mode-note")).toContainText("This runs in your browser.");
    await expect(sim.getByRole("tab", { name: "Database" })).toHaveCount(0);
    await expect(sim.getByTestId("sandbox-summary")).toHaveCount(0);
  });
});

test.describe("when the server cannot run it, the page says so and simulates", () => {
  async function expectFallback(page: Page, reason: RegExp) {
    const sim = simulator(page);
    await chooseServer(page);
    await runInstantly(page);
    await expect(sim.getByTestId("sandbox-notice")).toContainText(reason);
    await expect(sim.getByTestId("sandbox-notice")).toContainText("This run is a simulation in your browser instead.");
    // Never labelled as a server run, in the badge or in the note under the title.
    await expect(sim.getByTestId("run-mode")).toHaveText("Simulation");
    await expect(sim.getByTestId("mode-note")).toContainText("This runs in your browser.");
    await expect(sim.getByTestId("sandbox-summary")).toHaveCount(0);
    await expect(sim.getByRole("tab", { name: "Database" })).toHaveCount(0);
    // And the demo still works.
    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked");
  }

  test("the server is unreachable", async ({ page }) => {
    await page.route(`**${API}`, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.goto(`${CRM}#demo`);
    await expectFallback(page, /The server could not be reached\./);
  });

  test("the host serves only static files", async ({ page }) => {
    await page.route(`**${API}`, (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404</h1>" }));
    await page.goto(`${CRM}#demo`);
    await expectFallback(page, /This deployment has no server sandbox\./);
  });

  test("the address has used up its runs", async ({ page }) => {
    await page.route(`**${API}`, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 429,
            contentType: "application/json",
            headers: { "retry-after": "40" },
            body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many runs from this address. Try again in 40 s.", retryAfterMs: 40_000 } }),
          })
        : route.continue(),
    );
    await page.goto(`${CRM}#demo`);
    await expectFallback(page, /Too many runs from this address\. Try again in 40 s\./);
  });

  test("the sandbox is switched off", async ({ page }) => {
    await page.route(`**${API}`, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DISABLED", message: "The sandbox is switched off on this deployment." } }) }),
    );
    await page.goto(`${CRM}#demo`);
    await expectFallback(page, /The sandbox is switched off on this deployment\./);
  });

  test("the server stops answering part-way: the rest is simulated and the label changes", async ({ page }) => {
    let posts = 0;
    await page.route(`**${API}`, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts += 1;
      return posts === 1 ? route.continue() : route.abort();
    });
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await chooseServer(page);
    await runInstantly(page);
    await expectLive(page);
    await sim.getByRole("button", { name: /Interested, book a visit/ }).click();
    await expect(sim.getByTestId("sandbox-notice")).toContainText("The rest of this run is a simulation in your browser.");
    await expect(sim.getByTestId("run-mode")).toHaveText("Simulation");
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked");
    await expect(sim.getByText("13/13 steps settled")).toBeVisible();
  });
});

test.describe("a server run on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("works, and the page still fits the width", async ({ page }) => {
    await page.goto(`${CRM}#demo`);
    const sim = simulator(page);
    await chooseServer(page);
    await runInstantly(page);
    await expectLive(page);
    const choice = sim.getByRole("button", { name: /Interested, book a visit/ });
    await expect(choice).toBeInViewport();
    await choice.click();
    await expect(sim.getByTestId("run-outcome")).toContainText("APPT-311 booked");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
