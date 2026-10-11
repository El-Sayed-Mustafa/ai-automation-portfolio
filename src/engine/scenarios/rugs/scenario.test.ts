import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import { DEMO_SETTINGS, ROLES } from "./rules";
import {
  DEMO_BATCH_ID,
  FILE_KINDS,
  RUGS_DEFAULT_INPUT,
  RUGS_FAULTS,
  RUGS_PRESETS,
  RUGS_SCENARIO_ID,
  RUGS_STEPS,
  buildGrid,
  demoInventory,
  rugsScenario,
  validateRugsInput,
  type RugsFaultId,
  type RugsInput,
} from "./scenario";

function execute(options: { input?: Partial<RugsInput>; faults?: RugsFaultId[]; answers?: string[] } = {}) {
  const session = new RunSession(rugsScenario, {
    runId: "test-run",
    input: { ...RUGS_DEFAULT_INPUT, ...options.input },
    faults: options.faults,
  });
  const answers = [...(options.answers ?? ["apply", "approve"])];
  while (session.isWaiting) {
    const answer = answers.shift();
    if (answer === undefined) break;
    session.resume(answer);
  }
  return { session, events: session.events, state: reduceRun(RUGS_STEPS, session.events) };
}

function statuses(state: RunState) {
  return Object.fromEntries(RUGS_STEPS.map((id) => [id, state.steps[id].status]));
}

function changesTo(events: readonly RunEvent[], table: string) {
  return events.filter((e) => e.type === "state.changed" && e.table === table) as Extract<RunEvent, { type: "state.changed" }>[];
}

function logs(state: RunState) {
  return state.logs.map((entry) => entry.message).join("\n");
}

function preset(id: string): RugsInput {
  return RUGS_PRESETS.find((item) => item.id === id)!.input;
}

function counts(state: RunState) {
  return (state.steps["rows.classify"].output as { counts: Record<string, number> }).counts;
}

describe("a clean month, applied and approved", () => {
  const { state, events, session } = execute();

  it("completes every step", () => {
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
    expect(state.scenarioId).toBe(RUGS_SCENARIO_ID);
    expect(Object.values(statuses(state)).every((status) => status === "success")).toBe(true);
  });

  it("finds the header under the title lines and skips the empty last row", () => {
    expect(state.steps["file.parse"].output).toEqual({ header_line: 3, data_rows: 11, rows_without_a_sku_skipped: 1 });
  });

  it("repairs a size typed carelessly, so the rug is unchanged", () => {
    expect(logs(state)).toMatch(/R-10244: width "4' 0''" read as 4'0"\./);
    expect(state.steps["rows.normalise"].output).toEqual({ sizes_repaired: 1, rows_with_an_unreadable_size: 0, prices_flagged: 0 });
  });

  it("reads the warehouse's inventory a page at a time and writes nothing", () => {
    expect(state.steps["inventory.load"].output).toEqual({ rugs: 10, in_stock: 9, requests: 3 });
    expect(state.steps["inventory.load"].changes).toHaveLength(0);
  });

  it("classifies every row", () => {
    expect(counts(state)).toEqual({ new: 2, updated: 4, sold: 0, unchanged: 5, error: 0, protected: 0, needs_review: 0 });
    expect(state.steps["rows.classify"].output).toMatchObject({ stored_rows: 11, opens_on: "all changes" });
    expect(state.steps["rows.classify"].changes).toHaveLength(0);
  });

  it("stores the whole comparison before anything in inventory changes", () => {
    const [stored] = changesTo(events, "import batches");
    expect(stored).toMatchObject({ op: "insert", key: `batch ${DEMO_BATCH_ID}`, after: { state: "preview", rows: 11 } });
    const firstInventoryWrite = changesTo(events, "inventory")[0];
    expect(firstInventoryWrite.stepId).toBe("batch.apply");
    expect(firstInventoryWrite.seq).toBeGreaterThan(stored.seq);
    expect(state.steps["preview.store"].output).toEqual({ batch: DEMO_BATCH_ID, state: "preview", inventory_rows_written: 0 });
  });

  it("bins the temporary copy of the upload once the preview is stored", () => {
    expect(changesTo(events, "temporary files").map((change) => [change.stepId, change.op])).toEqual([
      ["file.upload", "insert"],
      ["preview.store", "delete"],
    ]);
  });

  it("applies the batch: new rugs arrive unapproved, and the batch has two states", () => {
    expect(state.steps["batch.apply"].output).toEqual({ inserted: 2, updated: 4, sold: 0, skipped: 0, batch_state: "applied" });
    const inserts = changesTo(events, "inventory").filter((change) => change.op === "insert");
    expect(inserts.map((change) => change.key)).toEqual(["R-10317", "R-10318"]);
    for (const insert of inserts) expect(insert.after).toMatchObject({ status: "In stock", approved_for_storefront: false });
    expect(changesTo(events, "import batches").map((change) => (change.after as { state: string }).state)).toEqual(["preview", "applied"]);
    expect(logs(state)).toMatch(/That function is not in the repository, so this step is a stand-in/);
  });

  it("writes the price the visitor typed", () => {
    const update = changesTo(events, "inventory").find((change) => change.key === "R-10231" && change.stepId === "batch.apply")!;
    expect(update.before).toMatchObject({ price: 1250 });
    expect(update.after).toMatchObject({ price: 1450 });
  });

  it("marks changed existing rugs ready without a second approval, a few per request", () => {
    expect(state.steps["ready.mark"].input).toMatchObject({ existing_rugs_changed_by_the_import: 4, requests: 2, rugs_per_request: DEMO_SETTINGS.ready.chunkSize });
    expect(state.steps["ready.mark"].output).toEqual({ marked_ready: 4, of_which_were_not_ready_before: 2, new_rugs_left_unapproved: 2 });
    expect(state.steps["ready.mark"].changes.map((change) => change.key)).toEqual(["R-10270", "R-10291"]);
  });

  it("writes one audit entry for the whole batch", () => {
    const entries = changesTo(events, "audit log").filter((change) => change.stepId === "audit.write");
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toMatchObject({ actor: "demo.editor", rug: null, new_values: { inserted: 2, updated: 4, sold: 0, skipped: 0, marked_ready: 4 } });
  });

  it("approves the new rugs with an audit entry each, and creates no listing", () => {
    expect(state.steps["approve.new"].choice).toBe("approve");
    expect(state.steps["approve.new"].output).toEqual({ decision: "approved", rugs: ["R-10317", "R-10318"], listing: "not created in this run" });
    expect(changesTo(events, "audit log").filter((change) => change.stepId === "approve.new")).toHaveLength(2);
    expect(changesTo(events, "storefront listings").map((change) => change.key)).not.toContain("R-10317");
    expect(logs(state)).toMatch(/New listings are made by a separate script that an operator runs by hand/);
  });

  it("takes a small batch from the queue, this import's changes first", () => {
    expect(state.steps["queue.pick"].output).toEqual({
      picked: ["R-10231", "R-10258", "R-10270"],
      left_for_a_later_run: ["R-10291", "R-10309"],
      no_listing_yet: ["R-10317", "R-10318"],
    });
  });

  it("pushes quantity always and price only where it drifted", () => {
    const pushes = changesTo(events, "storefront listings");
    expect(pushes.map((change) => change.key)).toEqual(["R-10231", "R-10258", "R-10270"]);
    expect(pushes[0].after).toMatchObject({ quantityHere: 1, quantityElsewhere: 0, status: "active", price: 1450 });
    expect(pushes[1].before).toEqual(pushes[1].after);
    expect(pushes[2].after).toMatchObject({ price: 820 });
  });

  it("marks each pushed rug and logs it, leaving the rest queued", () => {
    expect(state.steps["push.record"].output).toEqual({ marked_pushed: 3, logged: 3, still_queued: ["R-10291", "R-10309"] });
    expect(changesTo(events, "sync log").map((change) => (change.after as { ok: boolean }).ok)).toEqual([true, true, true]);
  });

  it("says what happened", () => {
    expect(state.outcome).toBe(
      "Batch #41 applied: 2 new, 4 updated, 0 sold, 0 skipped. 3 rugs reached the storefront in this run; 2 wait for a later run. The 2 new rugs are approved, with no listing yet: an operator creates listings by hand.",
    );
  });

  it("is deterministic", () => {
    expect(execute().events).toEqual(events);
  });
});

describe("the reviewer's decision", () => {
  it("is asked with the counts in front of them, before anything is applied", () => {
    const { session, state, events } = execute({ answers: [] });
    expect(session.isWaiting).toBe(true);
    const waiting = state.steps["review.decide"].waiting!;
    expect(waiting.prompt).toBe("Batch #41 is stored as a preview: 2 new, 4 updated, 0 sold, 5 unchanged, 0 errors. Inventory has not changed. What does the reviewer do?");
    expect(waiting.choices.map((choice) => choice.id)).toEqual(["apply", "delete"]);
    expect(changesTo(events, "inventory")).toHaveLength(0);
  });

  it("deleting the preview removes the comparison and touches nothing else", () => {
    const { state, events } = execute({ answers: ["delete"] });
    expect(state.status).toBe("success");
    expect(changesTo(events, "import batches").map((change) => change.op)).toEqual(["insert", "delete"]);
    expect(changesTo(events, "inventory")).toHaveLength(0);
    expect(changesTo(events, "storefront listings")).toHaveLength(0);
    expect(changesTo(events, "audit log")).toHaveLength(0);
    expect(statuses(state)["batch.apply"]).toBe("skipped");
    expect(statuses(state)["push.record"]).toBe("skipped");
    expect(state.outcome).toMatch(/inventory and the storefront were never touched/);
  });

  it("explains that a correction during review edits the live record, not the stored comparison", () => {
    const { state } = execute({ answers: [] });
    expect(state.steps["review.decide"].logs[0].message).toMatch(/The stored comparison is not recomputed afterwards/);
  });

  it("leaving the new rugs unapproved keeps them out of the storefront", () => {
    const { state, events } = execute({ answers: ["apply", "leave"] });
    expect(state.status).toBe("success");
    expect(state.steps["approve.new"].output).toEqual({ decision: "left unapproved", rugs: ["R-10317", "R-10318"] });
    expect(changesTo(events, "audit log").filter((change) => change.stepId === "approve.new")).toHaveLength(0);
    expect(state.outcome).toMatch(/The 2 new rugs stay unapproved and out of the storefront\.$/);
  });

  it("the approval is asked only after the batch is applied and audited", () => {
    const { session, state } = execute({ answers: ["apply"] });
    expect(session.isWaiting).toBe(true);
    expect(statuses(state)["audit.write"]).toBe("success");
    expect(state.steps["approve.new"].waiting!.choices.map((choice) => choice.id)).toEqual(["approve", "leave"]);
    expect(state.steps["approve.new"].waiting!.prompt).toMatch(/2 new rugs arrived unapproved \(R-10317, R-10318\)/);
  });
});

describe("bad cells", () => {
  const { state, events } = execute({ input: preset("bad-cells") });

  it("an unreadable size is an error row, shown first and skipped at apply", () => {
    expect(counts(state)).toEqual({ new: 2, updated: 3, sold: 0, unchanged: 5, error: 1, protected: 0, needs_review: 1 });
    expect(state.steps["rows.classify"].output).toMatchObject({ opens_on: "errors" });
    expect(state.steps["batch.apply"].output).toMatchObject({ updated: 3, skipped: 1 });
    expect(changesTo(events, "inventory").map((change) => change.key)).not.toContain("R-10244");
  });

  it("words in the price cell keep the stored price: it is never set to zero", () => {
    expect(logs(state)).toMatch(/R-10231: price cell said "on hold"\. The stored price will be kept; it is never set to zero\./);
    expect(changesTo(events, "inventory").filter((change) => change.key === "R-10231")).toHaveLength(0);
    expect(state.steps["rows.normalise"].warning).toBeTruthy();
  });

  it("tells the reviewer what applying would skip", () => {
    expect(logs(state)).toMatch(/Applying would skip 1 error row and keep the stored price for 1 flagged price\./);
  });

  it("a price of zero is flagged the same way", () => {
    const zero = execute({ input: { priceCell: "0" } });
    expect(counts(zero.state)).toMatchObject({ needs_review: 1, updated: 3 });
    expect(logs(zero.state)).toMatch(/R-10231: price was 0, ignored/);
  });

  it("an empty price cell changes nothing and flags nothing", () => {
    const empty = execute({ input: { priceCell: "" } });
    expect(counts(empty.state)).toMatchObject({ needs_review: 0, updated: 3, unchanged: 6 });
  });
});

describe("a rug that is in stock and missing from the file", () => {
  const { state, events } = execute({ input: preset("sold") });

  it("is proposed as sold", () => {
    expect(counts(state)).toEqual({ new: 2, updated: 4, sold: 1, unchanged: 4, error: 0, protected: 0, needs_review: 0 });
    expect(logs(state)).toMatch(/R-10302: in stock and not in the file, so it is proposed as sold\./);
  });

  it("is marked sold at apply and its listing goes to zero", () => {
    const applied = changesTo(events, "inventory").find((change) => change.key === "R-10302" && change.stepId === "batch.apply")!;
    expect(applied.after).toMatchObject({ status: "Sold" });
    const push = changesTo(events, "storefront listings").find((change) => change.key === "R-10302")!;
    expect(push.after).toMatchObject({ quantityHere: 0, quantityElsewhere: 0 });
    expect(state.steps["push.record"].output).toMatchObject({ marked_pushed: 5, still_queued: ["R-10309"] });
  });
});

describe("a rug with a protected status", () => {
  const { state, events } = execute({ input: preset("protected") });

  it("is listed in the file and left alone", () => {
    expect(counts(state)).toEqual({ new: 2, updated: 4, sold: 0, unchanged: 5, error: 0, protected: 1, needs_review: 0 });
    expect(logs(state)).toMatch(/R-10285: protected status: Set aside\./);
    expect(changesTo(events, "inventory").map((change) => change.key)).not.toContain("R-10285");
  });

  it("is not proposed as sold when the file leaves it out either", () => {
    expect(logs(execute().state)).not.toMatch(/R-10285/);
  });
});

describe("a file cut short", () => {
  it("proposes most of the stock as sold, and nothing but the preview shows it", () => {
    const { session, state } = execute({ input: preset("truncated"), answers: [] });
    expect(session.isWaiting).toBe(true);
    expect(counts(state)).toEqual({ new: 0, updated: 2, sold: 6, unchanged: 1, error: 0, protected: 0, needs_review: 0 });
    expect(state.steps["review.decide"].waiting!.prompt).toMatch(/6 of the 9 rugs in stock would be marked sold\./);
    expect(logs(state)).toMatch(/Nothing in the repository compares the size of a file with the inventory/);
  });

  it("the honest ending: the reviewer deletes the preview and nothing changes", () => {
    const { state, events } = execute({ input: preset("truncated"), answers: ["delete"] });
    expect(state.status).toBe("success");
    expect(changesTo(events, "inventory")).toHaveLength(0);
    expect(statuses(state)["batch.apply"]).toBe("skipped");
    expect(state.outcome).toMatch(/The file listed 3 rugs where the warehouse holds 9 in stock, and applying it would have marked 6 of them sold\. A person reading the preview was the only guard/);
  });

  it("applying it anyway is allowed, and the damage reaches the storefront", () => {
    const { state, events } = execute({ input: preset("truncated"), answers: ["apply"] });
    expect(state.status).toBe("failed");
    expect(state.steps["batch.apply"].output).toMatchObject({ inserted: 0, updated: 2, sold: 6 });
    expect(state.steps["approve.new"].output).toEqual({ decision: "nothing to approve" });
    expect(state.steps["queue.pick"].output).toMatchObject({ picked: ["R-10231", "R-10258", "R-10263"] });
    expect(changesTo(events, "storefront listings").find((change) => change.key === "R-10263")!.after).toMatchObject({ quantityHere: 0 });
    expect(state.outcome).toMatch(/6 rugs that may still be on the floor are now marked sold/);
    expect(state.outcome).toMatch(/The preview, and the person reading it, were the only guard\./);
  });
});

describe("roles", () => {
  it("a bookkeeper's upload is refused by the server before the file is read", () => {
    const { state, events } = execute({ input: preset("bookkeeper") });
    expect(state.status).toBe("failed");
    expect(state.steps["file.upload"].error).toEqual({ code: "ROLE", message: "Importing needs an editor or an admin account." });
    expect(statuses(state)["file.parse"]).toBe("skipped");
    expect(events.filter((e) => e.type === "state.changed")).toHaveLength(0);
    expect(logs(state)).toMatch(/The server does not rely on that/);
  });

  it.each(ROLES.map((role) => [role] as const))("%s: only editors and admins get past the upload", (role) => {
    const { state } = execute({ input: { role } });
    expect(state.status).toBe(role === "editor" || role === "admin" ? "success" : "failed");
  });
});

describe("faults at upload and parse", () => {
  it("a file of the wrong type is refused", () => {
    const { state, events } = execute({ faults: ["wrong-file-type"] });
    expect(state.status).toBe("failed");
    expect(state.steps["file.upload"].error).toEqual({ code: "FILE_TYPE", message: "Upload a CSV or XLSX file." });
    expect(events.filter((e) => e.type === "state.changed")).toHaveLength(0);
    expect(state.outcome).toMatch(/Nothing was read, stored or changed\./);
  });

  it("a file over the size limit is refused", () => {
    const { state } = execute({ faults: ["file-too-large"] });
    expect(state.status).toBe("failed");
    expect(state.steps["file.upload"].error?.code).toBe("TOO_LARGE");
    expect(statuses(state)["file.parse"]).toBe("skipped");
  });

  it("a file whose header cannot be found stores nothing and bins the temporary copy", () => {
    const { state, events } = execute({ faults: ["header-not-found"] });
    expect(state.status).toBe("failed");
    expect(state.steps["file.parse"].error?.code).toBe("NO_HEADER");
    expect(changesTo(events, "import batches")).toHaveLength(0);
    expect(changesTo(events, "temporary files").map((change) => change.op)).toEqual(["insert", "delete"]);
    expect(statuses(state)["rows.normalise"]).toBe("skipped");
    expect(state.outcome).toMatch(/No batch was stored and inventory was not touched\./);
  });
});

describe("a SKU listed twice (a limitation)", () => {
  const { state, events } = execute({ faults: ["duplicate-sku"] });

  it("is not detected: both lines become rows and the counts are off by one", () => {
    expect(counts(state)).toMatchObject({ updated: 5 });
    expect(state.steps["rows.classify"].warning).toBe("A SKU appears twice and nothing flags it.");
    expect(logs(state)).toMatch(/R-10258 is listed twice in the file\. Nothing in the comparison notices: each line produced its own row, so the counts say 5 updated for 4 rugs\./);
  });

  it("says that what the real apply does with two rows is not known", () => {
    expect(logs(state)).toMatch(/This stand-in applies rows in order, so the later one won\. What the real function does with them is not in the repository\./);
    const writes = changesTo(events, "inventory").filter((change) => change.key === "R-10258" && change.stepId === "batch.apply");
    expect(writes).toHaveLength(2);
    expect(writes[1].after).toMatchObject({ price: 3150 });
  });

  it("marks the rug ready once", () => {
    expect(state.steps["ready.mark"].output).toMatchObject({ marked_ready: 4 });
  });
});

describe("a second apply of the same batch", () => {
  it("is refused because the batch is no longer a preview", () => {
    const clean = execute();
    const { state, events } = execute({ faults: ["second-apply"] });
    expect(state.steps["batch.apply"].output).toMatchObject({ second_request: "refused: Batch #41 is already applied." });
    expect(changesTo(events, "inventory")).toEqual(changesTo(clean.events, "inventory").map((change) => ({ ...change, seq: expect.any(Number) as number })));
    expect(state.status).toBe("success");
  });
});

describe("the audit write fails after the apply (a limitation)", () => {
  const { state, events } = execute({ faults: ["audit-write-fails"] });

  it("the reviewer sees a failure, and the batch stays applied with no audit entry", () => {
    expect(state.status).toBe("failed");
    expect(state.steps["audit.write"].error?.code).toBe("AUDIT_WRITE_FAILED");
    expect(changesTo(events, "audit log")).toHaveLength(0);
    expect(changesTo(events, "inventory").length).toBeGreaterThan(0);
    expect(changesTo(events, "import batches").at(-1)!.after).toEqual({ state: "applied" });
    expect(statuses(state)["approve.new"]).toBe("skipped");
    expect(state.outcome).toMatch(/The three calls are not one transaction\./);
  });
});

describe("the storefront", () => {
  it("a throttled call waits longer each time and then goes through", () => {
    const clean = execute();
    const { state } = execute({ faults: ["storefront-throttled"] });
    const attempts = state.steps["shopify.push"].attempts;
    expect(attempts.map((attempt) => attempt.status)).toEqual(["failed", "failed", "success"]);
    expect(attempts.map((attempt) => attempt.error?.code)).toEqual(["THROTTLED", "THROTTLED", undefined]);
    const waits = attempts.slice(0, 2).map((attempt) => attempt.retryAt! - attempt.endedAt!);
    expect(waits).toEqual([DEMO_SETTINGS.storefront.throttleWaitMs, DEMO_SETTINGS.storefront.throttleWaitMs * 2]);
    expect(state.status).toBe("success");
    expect(state.steps["push.record"].output).toEqual(clean.state.steps["push.record"].output);
  });

  it("one rejected rug is logged and left in the queue, and the batch goes on", () => {
    const { state, events } = execute({ faults: ["storefront-rejects-one"] });
    expect(state.status).toBe("success");
    expect(state.steps["shopify.push"].output).toMatchObject({ pushed: 2, rejected: 1 });
    expect(changesTo(events, "storefront listings").map((change) => change.key)).toEqual(["R-10231", "R-10270"]);
    expect(changesTo(events, "sync log").map((change) => [change.key, (change.after as { ok: boolean }).ok])).toEqual([
      ["R-10231 update", true],
      ["R-10270 update", true],
      ["R-10258 update", false],
    ]);
    expect(state.steps["push.record"].output).toMatchObject({ marked_pushed: 2, still_queued: ["R-10258", "R-10291", "R-10309"] });
  });

  it("says that a failing rug has no retry limit", () => {
    const { state } = execute({ faults: ["storefront-rejects-one"] });
    expect(state.steps["push.record"].warning).toBe("A failed rug has no retry limit.");
    expect(logs(state)).toMatch(/R-10258 stays in the queue and will be picked again on every run\. Nothing counts the attempts, parks the rug or tells anyone\./);
    expect(state.outcome).toMatch(/1 was rejected and stays queued with no limit on retries/);
  });

  it("a larger batch empties the queue", () => {
    const { state } = execute({ input: { batchSize: 6 } });
    expect(state.steps["queue.pick"].output).toMatchObject({ picked: ["R-10231", "R-10258", "R-10270", "R-10291", "R-10309"], left_for_a_later_run: [] });
    expect(state.outcome).toMatch(/nothing is left in the queue/);
  });

  it("an older change waits behind this import's changes", () => {
    const { state, events } = execute({ input: { batchSize: 6 } });
    const older = changesTo(events, "storefront listings").at(-1)!;
    expect(older.key).toBe("R-10309");
    expect(older.before).toMatchObject({ price: 870 });
    expect(older.after).toMatchObject({ price: 890 });
    expect(state.steps["queue.pick"].output).toMatchObject({ no_listing_yet: ["R-10317", "R-10318"] });
  });

  it("with one rug per run, one rug is pushed", () => {
    const { state } = execute({ input: { batchSize: 1 }, faults: ["storefront-rejects-one"] });
    expect(state.steps["shopify.push"].output).toMatchObject({ pushed: 0, rejected: 1 });
    expect(state.outcome).toMatch(/0 rugs reached the storefront in this run, 1 was rejected/);
  });
});

describe("every preset and every fault", () => {
  it.each(RUGS_PRESETS.map((item) => [item.id, item.input] as const))("preset %s finishes", (_id, input) => {
    const { session: run, state } = execute({ input });
    expect(run.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(RUGS_FAULTS.map((fault) => [fault] as const))("%s ends in a finished run", (fault) => {
    const { session: run, state } = execute({ faults: [fault] });
    expect(run.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    expect(state.outcome).not.toMatch(/internal error/);
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(FILE_KINDS.flatMap((file) => RUGS_FAULTS.map((fault) => [file, fault] as const)))("%s with %s is consistent", (file, fault) => {
    for (const answers of [["apply", "approve"], ["apply", "leave"], ["delete"]]) {
      const { session: run, state } = execute({ input: { file }, faults: [fault], answers });
      expect(run.isFinished).toBe(true);
      expect(state.outcome).toBeTruthy();
      expect(state.outcome).not.toMatch(/internal error/);
    }
  });

  it("all faults at once still finish", () => {
    const { session: run, state } = execute({ faults: [...RUGS_FAULTS] });
    expect(run.isFinished).toBe(true);
    expect(state.steps["file.upload"].error?.code).toBe("FILE_TYPE");
  });

  it("every fault is deterministic", () => {
    for (const fault of RUGS_FAULTS) expect(execute({ faults: [fault] }).events).toEqual(execute({ faults: [fault] }).events);
  });
});

describe("what the demo must not contain", () => {
  const everything = JSON.stringify([
    ...RUGS_PRESETS.flatMap((item) => [execute({ input: item.input }).events, execute({ input: item.input, answers: ["delete"] }).events]),
    ...RUGS_FAULTS.map((fault) => execute({ faults: [fault] }).events),
  ]);

  it("uses invented rugs only", () => {
    for (const rug of demoInventory()) expect(rug.sku).toMatch(/^R-10\d{3}$/);
    const skus = everything.match(/\b[A-Z]-\d{4,6}\b/g) ?? [];
    expect(skus.length).toBeGreaterThan(0);
    for (const sku of skus) expect(sku).toMatch(/^R-10\d{3}$/);
  });

  it("names no address, account or credential", () => {
    expect(everything).not.toMatch(/https?:\/\//);
    expect(everything).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(everything).not.toMatch(/\b(token|secret|password|api[-_ ]?key)\b\s*[:=]/i);
  });

  it("never calls the storefront anything but simulated", () => {
    const { state } = execute();
    expect(state.steps["shopify.push"].input).toMatchObject({ storefront: "simulated" });
  });

  it("keeps its limits and timings in one object of invented values", () => {
    expect(Object.keys(DEMO_SETTINGS)).toEqual(["upload", "parse", "inventory", "ready", "queue", "storefront", "protectedStatuses", "bookkeeperFields"]);
    expect(RUGS_DEFAULT_INPUT.batchSize).toBe(DEMO_SETTINGS.queue.batchSize);
  });
});

describe("the file the visitor builds", () => {
  it("has title lines, a header and one row per rug", () => {
    const grid = buildGrid(RUGS_DEFAULT_INPUT, new Set());
    expect(grid[2]).toEqual(["SKU", "Width", "Length", "Price"]);
    expect(grid).toHaveLength(2 + 1 + 11 + 1);
  });

  it("puts the visitor's two cells where they belong", () => {
    const grid = buildGrid({ ...RUGS_DEFAULT_INPUT, priceCell: "777", widthCell: "9'9\"" }, new Set());
    expect(grid[3]).toEqual(["R-10231", `5'7"`, `8'2"`, "777"]);
    expect(grid[4]).toEqual(["R-10244", `9'9"`, `6'1"`, "980"]);
  });

  it("a truncated file stops after three rows", () => {
    expect(buildGrid({ ...RUGS_DEFAULT_INPUT, file: "truncated file" }, new Set())).toHaveLength(2 + 1 + 3);
  });
});

describe("input validation", () => {
  it("accepts the defaults and every preset", () => {
    expect(validateRugsInput(RUGS_DEFAULT_INPUT)).toEqual({ ok: true, errors: {}, value: RUGS_DEFAULT_INPUT });
    for (const item of RUGS_PRESETS) expect(validateRugsInput(item.input)).toMatchObject({ ok: true, errors: {} });
  });

  it("accepts every file and every role", () => {
    for (const file of FILE_KINDS) expect(validateRugsInput({ ...RUGS_DEFAULT_INPUT, file }).ok).toBe(true);
    for (const role of ROLES) expect(validateRugsInput({ ...RUGS_DEFAULT_INPUT, role }).ok).toBe(true);
  });

  it("accepts an empty cell, and a number where the form sends text", () => {
    const result = validateRugsInput({ ...RUGS_DEFAULT_INPUT, priceCell: "", widthCell: "  ", batchSize: "4" as unknown as number });
    expect(result).toMatchObject({ ok: true, value: { priceCell: "", widthCell: "", batchSize: 4 } });
    expect(validateRugsInput({ ...RUGS_DEFAULT_INPUT, priceCell: 1450 as unknown as string }).value.priceCell).toBe("1450");
  });

  it("reports each field that is wrong and falls back to the defaults", () => {
    const result = validateRugsInput({ file: "everything", role: "owner", priceCell: "x".repeat(40), widthCell: null, batchSize: 99 });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["batchSize", "file", "priceCell", "role", "widthCell"]);
    expect(result.value).toEqual({ file: "full file", role: "editor", priceCell: "x".repeat(24), widthCell: RUGS_DEFAULT_INPUT.widthCell, batchSize: RUGS_DEFAULT_INPUT.batchSize });
  });

  it("refuses a batch that is not a whole number in range", () => {
    for (const batchSize of [0, 2.5, -1, DEMO_SETTINGS.queue.maxBatchSize + 1, "abc", ""]) {
      expect(validateRugsInput({ ...RUGS_DEFAULT_INPUT, batchSize: batchSize as number }).errors.batchSize).toBeTruthy();
    }
  });

  it("strips control characters from a typed cell", () => {
    expect(validateRugsInput({ ...RUGS_DEFAULT_INPUT, priceCell: "14\u000750" }).value.priceCell).toBe("14 50");
  });
});
