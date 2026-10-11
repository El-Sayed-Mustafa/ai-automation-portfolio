import { describe, expect, it } from "vitest";
import { getScenarioRuntime } from "../engine/registry";
import { timesOverlap } from "../engine/scenarios/crm/rules";
import { CRM_DEFAULT_INPUT, CRM_FAULTS, CRM_PRESETS, CRM_SCENARIO_ID, crmScenario, type CrmInput } from "../engine/scenarios/crm/scenario";
import { createMemoryStore } from "../engine/scenarios/crm/store";
import { DEMO_DATE, seedWorld } from "../engine/scenarios/crm/world";
import { RunSession } from "../engine/session";
import type { Json, RunEvent } from "../engine/types";
import { CRM_SANDBOX_TABLES, openCrmSandbox } from "./crm-database";
import { executeSandboxRun } from "./executor";
import { openLedger } from "./ledger";
import { SANDBOX_LIMITS, SandboxError } from "./limits";
import { SANDBOX_SCENARIO_IDS, type SandboxRunRequest } from "./protocol";
import { createRateLimiter } from "./rate-limit";
import { parseRunRequest } from "./request";
import { loadSqlite } from "./sqlite";

const sqlite = loadSqlite()!;
const RUN_ID = "sbx-00000000-0000-4000-a000-000000000000";
const CHOICES = ["book", "follow-up", "lost"] as const;

function request(overrides: Partial<SandboxRunRequest> = {}): SandboxRunRequest {
  return { scenarioId: CRM_SCENARIO_ID, input: { ...CRM_DEFAULT_INPUT }, faults: [], decisions: [], ...overrides };
}

function onServer(overrides: Partial<SandboxRunRequest> = {}) {
  return executeSandboxRun(request(overrides), RUN_ID, { sqlite });
}

/** The same run as the browser makes it: arrays in memory, no database. */
function inBrowser(input: CrmInput, faults: string[], decisions: string[]): RunEvent[] {
  const session = new RunSession(crmScenario, { runId: RUN_ID, input, faults });
  for (const decision of decisions) session.resume(decision);
  return session.events;
}

function refusal(run: () => unknown): SandboxError {
  try {
    run();
  } catch (error) {
    if (error instanceof SandboxError) return error;
    throw error;
  }
  throw new Error("Expected the sandbox to refuse.");
}

function rowsOf(tables: { name: string; rows: Json[] }[], name: string): Record<string, Json>[] {
  return (tables.find((table) => table.name === name)?.rows ?? []) as Record<string, Json>[];
}

describe("the built-in SQLite", () => {
  it("is available in this Node.js", () => {
    expect(sqlite).not.toBeNull();
    expect(typeof sqlite.DatabaseSync).toBe("function");
  });
});

describe("a server run against a database", () => {
  it("is only offered for scenarios that have an executor", () => {
    for (const id of SANDBOX_SCENARIO_IDS) {
      const runtime = getScenarioRuntime(id)!;
      expect(() => executeSandboxRun({ scenarioId: id, input: runtime.defaultInput, faults: [], decisions: [] }, RUN_ID, { sqlite })).not.toThrow();
    }
  });

  describe.each(CRM_PRESETS)("preset $id", (preset) => {
    it("records the same events as the browser simulation, up to the decision", () => {
      const server = onServer({ input: { ...preset.input } });
      expect(server.events).toEqual(inBrowser(preset.input, [], []));
      expect(server.preset).toBe(preset.id);
    });

    it.each(CHOICES)("records the same events after the coordinator chooses %s", (choice) => {
      const first = onServer({ input: { ...preset.input } });
      if (!first.waiting) return;
      const server = onServer({ input: { ...preset.input }, decisions: [choice] });
      expect(server.events).toEqual(inBrowser(preset.input, [], [choice]));
      expect(server.finished).toBe(true);
    });
  });

  it.each(CRM_FAULTS)("records the same events as the browser with the failure %s injected", (fault) => {
    const before = onServer({ faults: [fault] });
    expect(before.events).toEqual(inBrowser(CRM_DEFAULT_INPUT, [fault], []));
    if (!before.waiting) return;
    const after = onServer({ faults: [fault], decisions: ["book"] });
    expect(after.events).toEqual(inBrowser(CRM_DEFAULT_INPUT, [fault], ["book"]));
  });

  it("records the same events with every failure that can combine", () => {
    const faults = ["duplicate-delivery", "worker-transient", "mail-failure"];
    expect(onServer({ faults, decisions: ["book"] }).events).toEqual(inBrowser(CRM_DEFAULT_INPUT, faults, ["book"]));
  });

  it("really writes the rows: the booking is in the tables read back from the database", () => {
    const run = onServer({ decisions: ["book"] });
    expect(run.status).toBe("success");
    const appointment = rowsOf(run.tables, "crm_appointments").find((row) => row.appointment_id === "APPT-311");
    expect(appointment).toMatchObject({ customer_id: "CUST-43", technician_vehicle: "Crew A", start_time: "13:00", end_time: "14:00", notification_status: "Details emailed" });
    expect(rowsOf(run.tables, "crm_leads").find((row) => row.lead_id === "LEAD-121")).toMatchObject({ status: "Existing Customer", call_done: 1, whatsapp_digits: "97305550142" });
    expect(rowsOf(run.tables, "crm_sync_outbox")).toEqual([expect.objectContaining({ outbox_id: 1, status: "processed", attempts: 1 })]);
    expect(rowsOf(run.tables, "crm_id_counters")).toEqual(expect.arrayContaining([{ prefix: "APPT", last_number: 311 }]));
    // The digits column is computed by the database, not written by the program.
    expect(rowsOf(run.tables, "crm_customers").find((row) => row.customer_id === "CUST-43")).toMatchObject({ phone: "+97305550142", phone_digits: "97305550142" });
    expect(run.tables.map((table) => table.name)).toEqual([...CRM_SANDBOX_TABLES]);
  });

  it("leaves no booking behind when the crew is double-booked", () => {
    const run = onServer({ faults: ["crew-conflict"], decisions: ["book"] });
    expect(run.status).toBe("failed");
    expect(rowsOf(run.tables, "crm_appointments").map((row) => row.appointment_id)).toEqual(["APPT-307"]);
    expect(rowsOf(run.tables, "crm_sync_outbox")).toEqual([]);
  });

  it("reports what it measured: statements, seeded rows and time", () => {
    const run = onServer({ decisions: ["book"] });
    expect(run.statements).toBeGreaterThan(10);
    expect(run.statements).toBeLessThan(SANDBOX_LIMITS.budget.maxStatements);
    expect(run.seededRows).toBe(11);
    expect(run.ms).toBeGreaterThanOrEqual(0);
    expect(run.ms).toBeLessThan(SANDBOX_LIMITS.budget.maxMs);
  });

  it("gives each run a database of its own", () => {
    const first = onServer({ decisions: ["book"] });
    const second = onServer({ decisions: ["book"] });
    // The second run starts from the seed again: same ids, one outbox event, not two.
    expect(second.events).toEqual(first.events);
    expect(rowsOf(second.tables, "crm_sync_outbox")).toHaveLength(1);
  });

  it("names the preset a run used, or says custom, and never anything typed", () => {
    expect(onServer().preset).toBe("new-enquiry");
    expect(onServer({ input: { ...CRM_DEFAULT_INPUT, message: "Something I typed myself." } }).preset).toBe("custom");
  });
});

describe("what the server refuses", () => {
  it("a scenario that is not on the list", () => {
    const error = refusal(() => onServer({ scenarioId: "solana.signal-to-evidence" }));
    expect([error.code, error.status]).toEqual(["UNKNOWN_SCENARIO", 404]);
    expect(refusal(() => onServer({ scenarioId: "__proto__" })).code).toBe("UNKNOWN_SCENARIO");
  });

  it("input the scenario's validator refuses, with the field at fault", () => {
    const error = refusal(() => onServer({ input: { ...CRM_DEFAULT_INPUT, message: "", senderNumber: "12" } }));
    expect([error.code, error.status]).toEqual(["INVALID_INPUT", 422]);
    expect(Object.keys(error.details ?? {}).sort()).toEqual(["message", "senderNumber"]);
  });

  it("runs the normalised input, not what was sent", () => {
    const run = onServer({ input: { ...CRM_DEFAULT_INPUT, senderNumber: "+973 0555 0142", contactName: "  Sample Contact  " } });
    const started = run.events[0];
    expect(started.type === "run.started" && started.input).toMatchObject({ senderNumber: "97305550142", contactName: "Sample Contact" });
  });

  it("a failure the scenario does not implement", () => {
    const error = refusal(() => onServer({ faults: ["drop-all-tables"] }));
    expect([error.code, error.status]).toEqual(["INVALID_FAULT", 422]);
  });

  it("a decision that is not on offer, or one sent when none is asked for", () => {
    expect(refusal(() => onServer({ decisions: ["approve-everything"] })).code).toBe("INVALID_DECISION");
    expect(refusal(() => onServer({ decisions: ["book", "book"] })).code).toBe("INVALID_DECISION");
    const group = CRM_PRESETS.find((preset) => preset.id === "group-chat")!;
    expect(refusal(() => onServer({ input: { ...group.input }, decisions: ["book"] })).code).toBe("INVALID_DECISION");
  });

  it("text that tries to be SQL is stored as text", () => {
    const hostile = "x'); DROP TABLE crm_leads; --";
    const run = onServer({ input: { ...CRM_DEFAULT_INPUT, message: hostile, contactName: `Robert"); --` }, decisions: ["lost"] });
    const lead = rowsOf(run.tables, "crm_leads").find((row) => row.lead_id === "LEAD-121");
    expect(lead?.last_message).toBe(hostile);
    expect(rowsOf(run.tables, "crm_leads")).toHaveLength(2);
  });
});

describe("the execution budget", () => {
  it("stops a run that uses too many statements", () => {
    const error = refusal(() => executeSandboxRun(request({ decisions: ["book"] }), RUN_ID, { sqlite, budget: { ...SANDBOX_LIMITS.budget, maxStatements: 3 } }));
    expect([error.code, error.status]).toEqual(["BUDGET_EXCEEDED", 503]);
    expect(error.message).toContain("3 statements");
  });

  it("stops a run that records too many events", () => {
    const error = refusal(() => executeSandboxRun(request(), RUN_ID, { sqlite, budget: { ...SANDBOX_LIMITS.budget, maxEvents: 5 } }));
    expect(error.code).toBe("BUDGET_EXCEEDED");
  });

  it("stops a run that takes too long", () => {
    let clock = 0;
    const now = () => (clock += 400);
    const error = refusal(() => executeSandboxRun(request(), RUN_ID, { sqlite, now, budget: { ...SANDBOX_LIMITS.budget, maxMs: 1_000 } }));
    expect(error.message).toContain("1000 ms");
  });
});

describe("the sandbox schema", () => {
  it("refuses a second outbox event with the same key", () => {
    const sandbox = openCrmSandbox(sqlite);
    const event = { event_key: "k", event_type: "t", entity_type: "appointment", entity_id: "APPT-1", payload: { appointmentId: "APPT-1" }, status: "pending" as const, attempts: 0, next_attempt_at: "2026-03-15T06:00:00.000Z", last_error: null, processed_at: null };
    expect(sandbox.store.insertOutbox(event).outbox_id).toBe(1);
    expect(() => sandbox.store.insertOutbox(event)).toThrow(/UNIQUE/);
    sandbox.close();
  });

  it("refuses an appointment for a customer that does not exist", () => {
    const sandbox = openCrmSandbox(sqlite);
    const seeded = sandbox.store.findVisitOnDay("CUST-42", DEMO_DATE)!;
    expect(() => sandbox.store.insertAppointment({ ...seeded, appointment_id: "APPT-999", customer_id: "CUST-NOBODY" })).toThrow(/FOREIGN KEY/);
    sandbox.close();
  });

  it("refuses a second row with the same primary key", () => {
    const sandbox = openCrmSandbox(sqlite);
    const lead = sandbox.store.findLeadByPhone(["97305550177"])!;
    expect(() => sandbox.store.insertLead(lead)).toThrow(/UNIQUE|PRIMARY/);
    sandbox.close();
  });

  it("finds a customer by either phone, in any of the forms a number is stored in", () => {
    const sandbox = openCrmSandbox(sqlite);
    const memory = createMemoryStore();
    for (const variants of [["97305550101"], ["05550101", "97305550101"], ["0000"], []]) {
      expect(sandbox.store.findCustomerByPhone(variants)).toEqual(memory.findCustomerByPhone(variants));
    }
    const withSecond = { ...sandbox.store.findCustomerByPhone(["97305550102"])!, secondary_phone: "+973 0555-0199" };
    sandbox.store.saveCustomer(withSecond);
    memory.saveCustomer(withSecond);
    expect(sandbox.store.findCustomerByPhone(["97305550199"])?.customer_id).toBe("CUST-42");
    expect(sandbox.store.findCustomerByPhone(["97305550199"])).toEqual(memory.findCustomerByPhone(["97305550199"]));
    sandbox.close();
  });

  it("decides a crew clash in SQL exactly as the rule function does", () => {
    const sandbox = openCrmSandbox(sqlite);
    const memory = createMemoryStore();
    const times = ["08:00", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"];
    for (const start of times) {
      for (const end of times) {
        if (end <= start) continue;
        const inSql = sandbox.store.findCrewClash("Crew A", DEMO_DATE, start, end);
        expect(inSql, `${start}-${end}`).toEqual(memory.findCrewClash("Crew A", DEMO_DATE, start, end));
        // The seeded visit of Crew A runs from 10:00 to 11:00.
        expect(Boolean(inSql), `${start}-${end}`).toBe(timesOverlap(start, end, "10:00", "11:00"));
      }
    }
    expect(sandbox.store.findCrewClash("Crew B", DEMO_DATE, "10:00", "11:00")).toBeUndefined();
    sandbox.close();
  });

  it("starts from the same rows as the browser simulation", () => {
    const sandbox = openCrmSandbox(sqlite);
    const world = seedWorld();
    const tables = sandbox.dump();
    expect(rowsOf(tables, "crm_customers").map((row) => row.customer_id)).toEqual(world.customers.map((row) => row.customer_id));
    expect(rowsOf(tables, "crm_leads").map((row) => row.lead_id)).toEqual(world.leads.map((row) => row.lead_id));
    expect(rowsOf(tables, "crm_appointments").map((row) => row.appointment_id)).toEqual(world.appointments.map((row) => row.appointment_id));
    expect(rowsOf(tables, "crm_technicians")).toHaveLength(world.technicians.length);
    expect(sandbox.statements).toBe(0);
    sandbox.close();
  });
});

describe("the ledger", () => {
  const entry = (runId: string, recordedAt: number, status: "success" | "failed" | "waiting" = "success") => ({
    runId,
    scenarioId: CRM_SCENARIO_ID,
    preset: "new-enquiry",
    faults: ["crew-conflict"],
    status,
    events: 40,
    statements: 20,
    ms: 3.25,
    recordedAt,
  });
  const id = (n: number) => `sbx-${String(n).padStart(8, "0")}-0000-4000-a000-000000000000`;

  it("lists the newest runs first, by a short id", () => {
    const ledger = openLedger(sqlite, ":memory:");
    ledger.record(entry(id(1), 1_000));
    ledger.record(entry(id(2), 2_000, "failed"));
    expect(ledger.recent(8)).toEqual([
      { run: "00000002", scenarioId: CRM_SCENARIO_ID, preset: "new-enquiry", faults: ["crew-conflict"], status: "failed", events: 40, statements: 20, ms: 3.25, at: new Date(2_000).toISOString() },
      expect.objectContaining({ run: "00000001", status: "success" }),
    ]);
    expect(ledger.storage).toBe("memory");
    ledger.close();
  });

  it("keeps one line per run: a decision updates the line it belongs to", () => {
    const ledger = openLedger(sqlite, ":memory:");
    ledger.record(entry(id(1), 1_000, "waiting"));
    ledger.record({ ...entry(id(1), 1_500, "success"), events: 90 });
    expect(ledger.count()).toBe(1);
    expect(ledger.recent(8)[0]).toMatchObject({ status: "success", events: 90 });
    ledger.close();
  });

  it("forgets runs older than a day and keeps no more than its limit", () => {
    const ledger = openLedger(sqlite, ":memory:");
    const day = SANDBOX_LIMITS.ledger.ttlMs;
    ledger.record(entry(id(1), 0));
    for (let n = 2; n <= 7; n += 1) ledger.record(entry(id(n), day + n));
    expect(ledger.cleanup(day + 100, day, 4)).toBe(3);
    expect(ledger.recent(10).map((run) => run.run)).toEqual(["00000007", "00000006", "00000005", "00000004"]);
    ledger.close();
  });

  it("holds nothing a visitor typed", () => {
    const ledger = openLedger(sqlite, ":memory:");
    const typed = "PRIVATE-MESSAGE-4471";
    const run = executeSandboxRun(request({ input: { ...CRM_DEFAULT_INPUT, message: typed, contactName: "Typed Name 9" }, decisions: ["book"] }), id(9), { sqlite });
    ledger.record({ runId: id(9), scenarioId: run.scenarioId, preset: run.preset, faults: run.faults, status: run.status, events: run.events.length, statements: run.statements, ms: run.ms, recordedAt: 5 });
    const kept = JSON.stringify(ledger.recent(8));
    expect(kept).not.toContain(typed);
    expect(kept).not.toContain("Typed Name 9");
    expect(kept).not.toContain("97305550142");
    expect(JSON.stringify(run.events)).toContain(typed);
    ledger.close();
  });
});

describe("the rate limit", () => {
  const options = { windowMs: 60_000, perAddress: 3, everyone: 5 };

  it("allows an address its share in a window and then refuses, saying when to come back", () => {
    const limiter = createRateLimiter(options);
    expect([0, 1, 2].map((ms) => limiter.take("a", ms).ok)).toEqual([true, true, true]);
    expect(limiter.take("a", 10_000)).toEqual({ ok: false, scope: "address", retryAfterMs: 50_000, remaining: 0 });
    expect(limiter.take("b", 10_000)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("starts a new window when the old one has passed", () => {
    const limiter = createRateLimiter(options);
    for (let n = 0; n < 3; n += 1) limiter.take("a", n);
    expect(limiter.take("a", 59_999).ok).toBe(false);
    expect(limiter.take("a", 60_000)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("limits everyone together, which holds even when the address is forged", () => {
    const limiter = createRateLimiter(options);
    const answers = ["a", "b", "c", "d", "e", "f"].map((address, index) => limiter.take(address, index));
    expect(answers.map((answer) => answer.ok)).toEqual([true, true, true, true, true, false]);
    expect(answers[5]).toMatchObject({ scope: "everyone" });
  });

  it("does not grow without bound", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, perAddress: 3, everyone: 1_000_000, maxKeys: 50 });
    for (let n = 0; n < 500; n += 1) limiter.take(`address-${n}`, n);
    expect(limiter.size).toBeLessThanOrEqual(50);
  });
});

describe("reading a request", () => {
  const good = JSON.stringify(request({ decisions: ["book"], runId: RUN_ID }));

  it("accepts a well-formed request", () => {
    expect(parseRunRequest(good)).toMatchObject({ scenarioId: CRM_SCENARIO_ID, decisions: ["book"], runId: RUN_ID });
  });

  it.each([
    ["text that is not JSON", "{not json", 400],
    ["an unknown field", JSON.stringify({ ...request(), sql: "select 1" }), 400],
    ["a run id it did not issue the shape of", JSON.stringify(request({ runId: "../../etc/passwd" })), 400],
    ["a fault id with odd characters", JSON.stringify(request({ faults: ["a b"] })), 400],
    ["more decisions than any scenario asks", JSON.stringify(request({ decisions: Array(SANDBOX_LIMITS.maxDecisions + 1).fill("book") })), 400],
    ["a nested object as an input value", JSON.stringify(request({ input: { message: { $ne: "" } as unknown as Json } })), 400],
    ["a body past the size limit", JSON.stringify(request({ input: { message: "x".repeat(SANDBOX_LIMITS.maxBodyBytes) } })), 413],
  ])("refuses %s", (_name, body, status) => {
    const error = refusal(() => parseRunRequest(body));
    expect([error.code, error.status]).toEqual(["BAD_REQUEST", status]);
  });
});
