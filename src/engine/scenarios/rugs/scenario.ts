import type { Scenario, ScenarioContext } from "../../session";
import type { Json } from "../../types";
import {
  DEMO_SETTINGS,
  IN_STOCK,
  ROLES,
  applyRefusal,
  applyStandIn,
  chunk,
  classifyRows,
  deleteRefusal,
  deriveQueue,
  normaliseRows,
  openingView,
  parseRows,
  pickUpdateQueue,
  planPush,
  rowClasses,
  skusToMarkReady,
  throttleWaitMs,
  uploadRefusal,
  writeRefusal,
  type BatchState,
  type DiffCounts,
  type Grid,
  type Listing,
  type Role,
  type RugRecord,
  type Upload,
} from "./rules";

export const RUGS_SCENARIO_ID = "rugs.file-to-shopify";

export const RUGS_STEPS = [
  "file.upload",
  "file.parse",
  "rows.normalise",
  "inventory.load",
  "rows.classify",
  "preview.store",
  "review.decide",
  "batch.apply",
  "ready.mark",
  "audit.write",
  "approve.new",
  "queue.pick",
  "shopify.push",
  "push.record",
] as const;

export const RUGS_FAULTS = [
  "wrong-file-type",
  "file-too-large",
  "header-not-found",
  "duplicate-sku",
  "second-apply",
  "audit-write-fails",
  "storefront-throttled",
  "storefront-rejects-one",
] as const;

export type RugsFaultId = (typeof RUGS_FAULTS)[number];

export const FILE_KINDS = ["full file", "one rug missing", "protected rug listed", "truncated file"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface RugsInput {
  /** What this month's file contains. */
  file: FileKind;
  /** The role of the signed-in person who uploads it. */
  role: Role;
  /** What the price cell of rug R-10231 says. */
  priceCell: string;
  /** What the width cell of rug R-10244 says. */
  widthCell: string;
  /** How many rugs the update worker takes from the queue in one run. */
  batchSize: number;
}

const CLEAN: RugsInput = { file: "full file", role: "editor", priceCell: "1450", widthCell: "4' 0''", batchSize: DEMO_SETTINGS.queue.batchSize };

export const RUGS_PRESETS: { id: string; label: string; description: string; input: RugsInput }[] = [
  {
    id: "clean",
    label: "A clean month",
    description: "Two new rugs and four changes. A size typed carelessly is repaired. More changes are queued than one run takes.",
    input: CLEAN,
  },
  {
    id: "bad-cells",
    label: "Bad cells",
    description: "One size cannot be read and one price cell holds words. The first becomes an error row, the second keeps its stored price.",
    input: { ...CLEAN, priceCell: "on hold", widthCell: "4 ft" },
  },
  {
    id: "sold",
    label: "A rug is missing",
    description: "A rug that is in stock is not in the file, so it is proposed as sold and its listing goes to zero.",
    input: { ...CLEAN, file: "one rug missing", batchSize: 5 },
  },
  {
    id: "protected",
    label: "A protected rug",
    description: "The file lists a rug whose status a person set on purpose. The import leaves it alone.",
    input: { ...CLEAN, file: "protected rug listed" },
  },
  {
    id: "truncated",
    label: "A file cut short",
    description: "The export stopped after three rows. Every other rug in stock is proposed as sold, and only the reviewer can stop it.",
    input: { ...CLEAN, file: "truncated file" },
  },
  {
    id: "bookkeeper",
    label: "A bookkeeper uploads",
    description: "Imports need an editor or an admin. The server refuses the upload before the file is read.",
    input: { ...CLEAN, role: "bookkeeper" },
  },
];

export const RUGS_DEFAULT_INPUT: RugsInput = RUGS_PRESETS[0].input;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const MAX_PRICE_CELL = 24;
const MAX_WIDTH_CELL = 16;

export function validateRugsInput(raw: Partial<Record<keyof RugsInput, unknown>>): {
  ok: boolean;
  value: RugsInput;
  errors: Partial<Record<keyof RugsInput, string>>;
} {
  const errors: Partial<Record<keyof RugsInput, string>> = {};
  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).replace(CONTROL_CHARS, " ").trim() : null);

  const file = FILE_KINDS.find((kind) => kind === raw.file);
  if (!file) errors.file = "Choose one of the listed files.";
  const role = ROLES.find((item) => item === raw.role);
  if (!role) errors.role = "Choose one of the listed roles.";

  const priceCell = text(raw.priceCell);
  if (priceCell === null) errors.priceCell = "Type what the price cell says. It may be empty.";
  else if (priceCell.length > MAX_PRICE_CELL) errors.priceCell = `Keep the cell under ${MAX_PRICE_CELL} characters.`;
  const widthCell = text(raw.widthCell);
  if (widthCell === null) errors.widthCell = "Type what the width cell says. It may be empty.";
  else if (widthCell.length > MAX_WIDTH_CELL) errors.widthCell = `Keep the cell under ${MAX_WIDTH_CELL} characters.`;

  const batchRaw = typeof raw.batchSize === "number" ? raw.batchSize : typeof raw.batchSize === "string" && raw.batchSize.trim() !== "" ? Number(raw.batchSize) : Number.NaN;
  const batchOk = Number.isInteger(batchRaw) && batchRaw >= 1 && batchRaw <= DEMO_SETTINGS.queue.maxBatchSize;
  if (!batchOk) errors.batchSize = `Use a whole number from 1 to ${DEMO_SETTINGS.queue.maxBatchSize}.`;

  return {
    ok: Object.keys(errors).length === 0,
    value: {
      file: file ?? RUGS_DEFAULT_INPUT.file,
      role: role ?? RUGS_DEFAULT_INPUT.role,
      priceCell: priceCell === null ? RUGS_DEFAULT_INPUT.priceCell : priceCell.slice(0, MAX_PRICE_CELL),
      widthCell: widthCell === null ? RUGS_DEFAULT_INPUT.widthCell : widthCell.slice(0, MAX_WIDTH_CELL),
      batchSize: batchOk ? batchRaw : RUGS_DEFAULT_INPUT.batchSize,
    },
    errors,
  };
}

// -- Invented world ----------------------------------------------------------

/** Two invented warehouses. The file in this run is the North one's. */
export const DEMO_WAREHOUSE = { name: "North", other: "South" } as const;
export const DEMO_BATCH_ID = 41;
const FILE_NAME = "north-warehouse-march.xlsx";
const FILE_BYTES = 184_000;
const OVERSIZED_BYTES = 3_400_000;

function rug(sku: string, status: string, width: string, length: string, price: number, extra: Partial<RugRecord> = {}): RugRecord {
  // Pushed after its last change, so it is not waiting in the queue.
  return { sku, status, width, length, price, approved: true, listed: true, changedAt: -20, pushedAt: -10, ...extra };
}

/** Invented rugs. Sizes, prices and SKUs are made up. */
export function demoInventory(): RugRecord[] {
  return [
    rug("R-10231", IN_STOCK, `5'7"`, `8'2"`, 1250),
    rug("R-10244", IN_STOCK, `4'0"`, `6'1"`, 980),
    rug("R-10258", IN_STOCK, `8'0"`, `10'3"`, 3400),
    rug("R-10263", IN_STOCK, `3'2"`, `5'0"`, 640),
    rug("R-10270", IN_STOCK, `2'6"`, `9'10"`, 760, { approved: false }),
    rug("R-10276", IN_STOCK, `6'1"`, `9'2"`, 1890),
    rug("R-10285", DEMO_SETTINGS.protectedStatuses[0], `6'0"`, `9'0"`, 2100, { approved: false, listed: false, pushedAt: null }),
    rug("R-10291", IN_STOCK, `9'1"`, `12'0"`, 5200, { approved: false }),
    rug("R-10302", IN_STOCK, `5'0"`, `7'6"`, 1500),
    // Its price was corrected by hand before this import, and that change has not reached the storefront yet.
    rug("R-10309", IN_STOCK, `4'2"`, `6'0"`, 890, { changedAt: -5 }),
  ];
}

/** The simulated storefront: one listing per rug that has one. */
function demoListings(inventory: readonly RugRecord[]): Map<string, Listing> {
  const listings = new Map<string, Listing>();
  for (const record of inventory) {
    if (!record.listed) continue;
    listings.set(record.sku, { quantityHere: 1, quantityElsewhere: 0, status: "active", price: record.sku === "R-10309" ? 870 : record.price });
  }
  return listings;
}

const HEADER = ["SKU", "Width", "Length", "Price"];
const RENAMED_HEADER = ["Stock no.", "W", "L", "Ask"];
const TITLE_LINES = [["North warehouse stock list"], ["Counted at month end"]];

/** This month's file as a grid of cells, built from the visitor's choices. */
export function buildGrid(input: RugsInput, faults: ReadonlySet<string>): Grid {
  let rows: string[][] = [
    ["R-10231", `5'7"`, `8'2"`, input.priceCell],
    ["R-10244", input.widthCell, `6'1"`, "980"],
    ["R-10258", `8'0"`, `10'5"`, "3400"],
    ["R-10263", `3'2"`, `5'0"`, "640"],
    ["R-10270", `2'6"`, `9'10"`, "820"],
    ["R-10276", `6'1"`, `9'2"`, "1890"],
    ["R-10291", `9'1"`, `12'0"`, "4900"],
    ["R-10302", `5'0"`, `7'6"`, "1500"],
    ["R-10309", `4'2"`, `6'0"`, "890"],
    ["R-10317", `6'2"`, `9'0"`, "2250"],
    ["R-10318", `3'0"`, `5'1"`, "590"],
  ];
  if (input.file === "one rug missing") rows = rows.filter((row) => row[0] !== "R-10302");
  if (input.file === "protected rug listed") rows.splice(6, 0, ["R-10285", `6'0"`, `9'0"`, "2100"]);
  if (input.file === "truncated file") rows = rows.slice(0, 3);
  if (faults.has("duplicate-sku")) rows.push(["R-10258", `8'0"`, `10'5"`, "3150"]);
  // A real export often ends with an empty line. A row with no SKU is skipped.
  if (input.file !== "truncated file") rows.push(["", "", "", ""]);
  return [...TITLE_LINES, faults.has("header-not-found") ? RENAMED_HEADER : HEADER, ...rows];
}

/** Simulated latencies in virtual milliseconds. They pace playback; they are not measurements. */
const LATENCY = { upload: 600, convert: 900, parse: 40, read: 180, compare: 30, write: 150, rpc: 400, api: 320 } as const;

function snap<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function publicCounts(counts: DiffCounts): Json {
  return { new: counts.new, updated: counts.updated, sold: counts.sold, unchanged: counts.unchanged, error: counts.error, protected: counts.protected, needs_review: counts.needsReview };
}

function recordView(record: RugRecord): Json {
  return { status: record.status, width: record.width, length: record.length, price: record.price, approved_for_storefront: record.approved };
}

function* run({ input, faults, t }: ScenarioContext<RugsInput>): Generator<void, void, string> {
  const settings = DEMO_SETTINGS;
  let inventory = demoInventory();
  const listings = demoListings(inventory);
  const actor = `demo.${input.role}`;
  const batchKey = `batch ${DEMO_BATCH_ID}`;

  // -- 1. Upload -----------------------------------------------------------------
  const upload: Upload = {
    role: input.role,
    warehouse: DEMO_WAREHOUSE.name,
    fileName: faults.has("wrong-file-type") ? FILE_NAME.replace(/\.xlsx$/, ".pdf") : FILE_NAME,
    sizeBytes: faults.has("file-too-large") ? OVERSIZED_BYTES : FILE_BYTES,
  };
  t.start("file.upload", { file: upload.fileName, size_bytes: upload.sizeBytes, warehouse: upload.warehouse, signed_in_as: actor, role: input.role });
  t.advance(LATENCY.upload);
  const refused = uploadRefusal(upload);
  if (refused) {
    if (refused.code === "ROLE") t.log("warn", "The page does not offer the import button to this role. The server does not rely on that: it reads the role from the signed session and refuses.");
    else t.log("warn", "The page checks the file's type and size before it sends anything. The server checks again.");
    t.fail(refused.code, refused.message);
    t.skipRemaining("The upload was refused before the file was read.");
    t.finish("failed", `Upload refused: ${refused.message} Nothing was read, stored or changed.`, { refused: refused.code, inventory_rows_written: 0 });
    return;
  }
  t.change("temporary files", "insert", upload.fileName, null, { purpose: "a copy of the upload, kept only while it is read" });
  t.log("info", "Checked in order: role, warehouse, file type, not empty, size. The role comes from the signed session, not from the page.");
  t.ok({ accepted: true, limit_bytes: settings.upload.maxBytes });

  // -- 2. Parse ------------------------------------------------------------------
  const grid = buildGrid(input, faults);
  t.start("file.parse", { sheet: "the first one", lines_in_sheet: grid.length, header: `looked for in the first ${settings.parse.headerSearchRows} lines` });
  t.advance(LATENCY.convert);
  t.log("info", "An XLSX file is converted to a temporary sheet, its first sheet is read, and the converted copy is binned.");
  const parsed = parseRows(grid);
  t.advance(LATENCY.parse);
  if (!parsed.ok) {
    t.change("temporary files", "delete", upload.fileName, { purpose: "a copy of the upload" }, null);
    t.log("info", "The temporary copy is binned whether the preview succeeds or fails.");
    t.fail(parsed.code, parsed.message);
    t.skipRemaining("The file could not be read, so there was nothing to compare.");
    t.finish("failed", `Preview failed: ${parsed.message} No batch was stored and inventory was not touched.`, { refused: parsed.code, inventory_rows_written: 0 });
    return;
  }
  t.log("info", `The header is on line ${parsed.headerRow + 1}, under ${plural(parsed.headerRow, "title line")}. It is found, not assumed.`);
  t.ok({ header_line: parsed.headerRow + 1, data_rows: parsed.rows.length, rows_without_a_sku_skipped: parsed.blankSkipped });

  // -- 3. Normalise ----------------------------------------------------------------
  const rows = normaliseRows(parsed.rows);
  t.start("rows.normalise", { rows: rows.length, repaired: "sizes typed by hand", refused: "prices that are not a number" });
  t.advance(LATENCY.parse);
  let repaired = 0;
  for (const row of rows) {
    for (const [label, raw, value] of [["width", row.rawWidth, row.width], ["length", row.rawLength, row.length]] as const) {
      if (value === null) t.log("warn", `${row.sku}: ${label} "${raw}" cannot be read as feet and inches.`);
      else if (raw !== value) {
        repaired += 1;
        t.log("info", `${row.sku}: ${label} "${raw}" read as ${value}.`);
      }
    }
    if (row.priceNote) t.log("warn", `${row.sku}: ${row.priceNote}. The stored price will be kept; it is never set to zero.`);
  }
  const unreadable = rows.filter((row) => !row.width || !row.length).length;
  const flagged = rows.filter((row) => row.priceNote).length;
  t.ok({ sizes_repaired: repaired, rows_with_an_unreadable_size: unreadable, prices_flagged: flagged }, unreadable + flagged > 0 ? "Some cells could not be used. They stay visible in the preview." : undefined);

  // -- 4. Load inventory -----------------------------------------------------------
  const requests = Math.floor(inventory.length / settings.inventory.pageSize) + 1;
  t.start("inventory.load", { warehouse: DEMO_WAREHOUSE.name, fields: ["status", "width", "length", "price"], page_size: settings.inventory.pageSize });
  t.advance(LATENCY.read * requests);
  t.log("info", "Only this warehouse's rugs are read, a page at a time, until a page comes back short. Nothing is written.");
  const inStock = inventory.filter((record) => record.status === IN_STOCK).length;
  t.ok({ rugs: inventory.length, in_stock: inStock, requests });

  // -- 5. Classify -----------------------------------------------------------------
  const diff = classifyRows(rows, inventory);
  const { counts } = diff;
  t.start("rows.classify", { file_rows: rows.length, inventory_rugs: inventory.length, writes: "none" });
  t.advance(LATENCY.compare);
  for (const row of diff.rows) {
    const classes = rowClasses(row);
    if (row.action === "error") t.log("warn", `${row.sku}: error, ${row.note}. It will be skipped if the batch is applied.`);
    else if (row.action === "new") t.log("info", `${row.sku}: new, ${row.values?.width} x ${row.values?.length}${row.values?.price === null ? ", no price" : `, price ${row.values?.price}`}.`);
    else if (row.action === "sold") t.log("info", `${row.sku}: in stock and not in the file, so it is proposed as sold.`);
    else if (row.action === "update") t.log("info", `${row.sku}: ${Object.entries(row.changes).map(([field, change]) => `${field} ${change[0]} to ${change[1]}`).join(", ")}.`);
    else if (classes.includes("protected")) t.log("info", `${row.sku}: ${row.note}. A person set that status on purpose, so the import leaves the rug alone.`);
    if (classes.includes("needs review")) t.log("warn", `${row.sku}: needs review, ${row.note}.`);
  }
  const occurrences = new Map<string, number>();
  for (const row of rows) occurrences.set(row.sku, (occurrences.get(row.sku) ?? 0) + 1);
  const duplicated = [...occurrences].filter(([, count]) => count > 1).map(([sku]) => sku);
  if (duplicated.length > 0) {
    t.log("warn", `${duplicated.join(", ")} is listed twice in the file. Nothing in the comparison notices: each line produced its own row, so the counts say ${counts.updated} updated for ${counts.updated - duplicated.length} rugs.`);
  }
  t.ok(
    { counts: publicCounts(counts), stored_rows: diff.rows.length, opens_on: openingView(counts) },
    duplicated.length > 0 ? "A SKU appears twice and nothing flags it." : undefined,
  );

  // -- 6. Store the preview -----------------------------------------------------------
  let batchState: BatchState = "preview";
  t.start("preview.store", { state: "preview", rows: diff.rows.length, includes_unchanged_rows: true });
  t.advance(LATENCY.write);
  t.change("import batches", "insert", batchKey, null, snap({ state: batchState, warehouse: DEMO_WAREHOUSE.name, file: upload.fileName, counts: publicCounts(counts), rows: diff.rows.length }));
  t.change("temporary files", "delete", upload.fileName, { purpose: "a copy of the upload" }, null);
  t.log("info", "The whole comparison is stored, unchanged rows included. Inventory has not changed: applying the batch is the only step that changes it.");
  t.ok({ batch: DEMO_BATCH_ID, state: batchState, inventory_rows_written: 0 });

  // -- 7. A person reviews ---------------------------------------------------------------
  t.start("review.decide", { batch: DEMO_BATCH_ID, opens_on: openingView(counts), counts: publicCounts(counts) });
  t.log("info", "A reviewer can open an existing rug from a row and correct its live record in the side drawer. That edit is audited. The stored comparison is not recomputed afterwards.");
  if (counts.error + counts.needsReview > 0) {
    t.log("warn", `Applying would skip ${plural(counts.error, "error row")} and keep the stored price for ${plural(counts.needsReview, "flagged price")}. The page says so before it asks for confirmation.`);
  }
  const soldShare = `${counts.sold} of the ${inStock} rugs in stock`;
  // The demo's own commentary, not a check the system has: more than half the stock proposed as sold.
  const alarming = counts.sold * 2 > inStock;
  if (alarming) t.log("warn", `${soldShare} are proposed as sold. Nothing in the repository compares the size of a file with the inventory, so this preview is the only place the problem can be seen.`);
  t.wait(
    `Batch #${DEMO_BATCH_ID} is stored as a preview: ${counts.new} new, ${counts.updated} updated, ${counts.sold} sold, ${counts.unchanged} unchanged, ${plural(counts.error, "error")}.${alarming ? ` ${soldShare} would be marked sold.` : ""} Inventory has not changed. What does the reviewer do?`,
    [
      { id: "apply", label: "Apply the batch", description: "The only action that changes inventory. The page asks for confirmation once more." },
      { id: "delete", label: "Delete the preview", description: "Removes the stored comparison. Inventory and the storefront are not touched." },
    ],
  );
  const decision = yield;
  t.resumed(decision);
  if (decision === "delete") {
    const refusal = deleteRefusal(batchState);
    if (refusal) throw new Error(refusal);
    t.advance(LATENCY.write);
    t.change("import batches", "delete", batchKey, { state: batchState }, null);
    t.log("info", "Only a batch that is still a preview can be deleted, and the delete itself is limited to that state.");
    t.ok({ decision: "deleted", inventory_rows_written: 0 });
    t.skipRemaining("The preview was deleted, so nothing was applied.");
    t.finish(
      "success",
      alarming
        ? `The reviewer deleted the preview. The file listed ${plural(occurrences.size, "rug")} where the warehouse holds ${inStock} in stock, and applying it would have marked ${counts.sold} of them sold. A person reading the preview was the only guard, and it held. Inventory and the storefront were never touched.`
        : "The reviewer deleted the preview. The stored comparison is gone, and inventory and the storefront were never touched.",
      { decision: "deleted", inventory_rows_written: 0 },
    );
    return;
  }
  t.ok({ decision: "apply", confirmed_in_the_page: true });

  // -- 8. Apply ------------------------------------------------------------------------
  t.start("batch.apply", { batch: DEMO_BATCH_ID, requested_by: actor, role: input.role, state: batchState });
  const notApplicable = applyRefusal(DEMO_BATCH_ID, batchState);
  if (notApplicable) throw new Error(notApplicable);
  t.advance(LATENCY.rpc);
  t.log("info", "The server checks the role and that the batch is still a preview, then calls one database function. That function is not in the repository, so this step is a stand-in that follows the stored rows.");
  const applied = applyStandIn(diff.rows, inventory, 0);
  inventory = applied.inventory;
  for (const change of applied.changes) t.change("inventory", change.op, change.sku, change.before ? recordView(change.before) : null, recordView(change.after));
  batchState = "applied";
  t.change("import batches", "update", batchKey, { state: "preview" }, { state: batchState });
  if (duplicated.length > 0) t.log("warn", `${duplicated.join(", ")} had two rows. This stand-in applies rows in order, so the later one won. What the real function does with them is not in the repository.`);
  let secondRequest: string | null = null;
  if (faults.has("second-apply")) {
    secondRequest = applyRefusal(DEMO_BATCH_ID, batchState);
    t.log("warn", `A second request to apply the same batch arrived afterwards. The server read the batch's state first and refused: "${secondRequest}" Nothing was written twice.`);
  }
  t.ok(snap({ ...applied.result, batch_state: batchState, ...(secondRequest ? { second_request: `refused: ${secondRequest}` } : {}) }));

  // -- 9. Mark changed existing rugs ready ----------------------------------------------------
  const readySkus = skusToMarkReady(diff.rows);
  const groups = chunk(readySkus, settings.ready.chunkSize);
  t.start("ready.mark", { existing_rugs_changed_by_the_import: readySkus.length, requests: groups.length, rugs_per_request: settings.ready.chunkSize });
  let newlyReady = 0;
  for (const group of groups) {
    t.advance(LATENCY.write);
    for (const sku of group) {
      const record = inventory.find((item) => item.sku === sku);
      if (!record || record.approved) continue;
      record.approved = true;
      newlyReady += 1;
      t.change("inventory", "update", sku, { approved_for_storefront: false }, { approved_for_storefront: true });
    }
  }
  t.log("info", "A rug that was already in inventory passed the listing workflow once, so a change from an import does not need a second approval. New rugs are not in this list and stay unapproved.");
  t.ok({ marked_ready: readySkus.length, of_which_were_not_ready_before: newlyReady, new_rugs_left_unapproved: applied.result.inserted });

  // -- 10. Audit ------------------------------------------------------------------------------
  t.start("audit.write", { entries: 1, about: "the batch as a whole", actor });
  t.advance(LATENCY.write);
  if (faults.has("audit-write-fails")) {
    t.log("error", "Apply, ready-marking and the audit entry are three separate calls. Nothing undoes the first two when the third fails.");
    t.fail("AUDIT_WRITE_FAILED", "The audit insert failed, so the server call ended in an error and the page reports that the apply failed.");
    t.skipRemaining("The run stops at the error the reviewer sees.");
    t.finish(
      "failed",
      `The page says the apply failed, but batch #${DEMO_BATCH_ID} is applied: ${applied.result.inserted} new, ${applied.result.updated} updated, ${applied.result.sold} sold, and ${plural(readySkus.length, "rug")} marked ready. There is no audit entry for it, and trying again is refused because the batch is no longer a preview. The three calls are not one transaction. This is a real gap in the code, shown as it is.`,
      snap({ ...applied.result, batch_state: batchState, audit_entries: 0 }),
    );
    return;
  }
  t.change("audit log", "insert", `apply import batch #${DEMO_BATCH_ID}`, null, snap({ actor, action: `apply import batch #${DEMO_BATCH_ID}`, rug: null, old_values: null, new_values: { warehouse: DEMO_WAREHOUSE.name, file: upload.fileName, ...applied.result, marked_ready: readySkus.length } }));
  t.log("info", "The server writes one entry for the whole batch, with who applied it and the counts. The before and after of each rug is in the stored comparison. Whether the database function also writes an entry per rug is not in the repository.");
  t.ok({ entries: 1 });

  // -- 11. A person approves the new rugs ---------------------------------------------------------
  const newSkus = applied.changes.filter((change) => change.op === "insert").map((change) => change.sku);
  let approval = "nothing to approve";
  t.start("approve.new", { new_rugs: newSkus, arrived: "in stock and unapproved" });
  if (newSkus.length === 0) {
    t.log("info", "This batch added no rugs, so there is nothing to approve.");
    t.ok({ decision: approval });
  } else {
    t.log("info", "An import brings a new rug's size and price only. The page offers approval once the rest of the record is filled in; this demo assumes the staff have done that.");
    t.wait(`${plural(newSkus.length, "new rug")} arrived unapproved (${newSkus.join(", ")}). An existing rug changed by the import did not need this step. Approve the new ones for the storefront?`, [
      { id: "approve", label: "Approve them", description: "They become candidates for a new listing." },
      { id: "leave", label: "Leave them unapproved", description: "They stay in inventory and out of the storefront." },
    ]);
    const choice = yield;
    t.resumed(choice);
    if (choice === "approve") {
      const refusal = writeRefusal(input.role, ["approved"]);
      if (refusal) throw new Error(refusal);
      approval = "approved";
      t.advance(LATENCY.write);
      for (const sku of newSkus) {
        const record = inventory.find((item) => item.sku === sku);
        if (record) record.approved = true;
        t.change("inventory", "update", sku, { approved_for_storefront: false }, { approved_for_storefront: true });
        t.change("audit log", "insert", `${sku} bulk update`, null, { actor, action: "bulk update", rug: sku, fields: ["approved"], old_values: null, new_values: { approved_for_storefront: true } });
      }
      t.log("info", "The write is checked on the server against the signed-in role, and each rug gets its own audit entry. A bulk change records the new values only.");
      t.log("warn", "Approval does not create a listing. New listings are made by a separate script that an operator runs by hand; no button in the app starts it.");
      t.ok({ decision: approval, rugs: newSkus, listing: "not created in this run" });
    } else {
      approval = "left unapproved";
      t.log("info", "Unapproved rugs are never picked for a new listing.");
      t.ok({ decision: approval, rugs: newSkus });
    }
  }

  // -- 12. The update worker picks a batch -------------------------------------------------------------
  const queue = deriveQueue(inventory);
  const picked = pickUpdateQueue(queue, readySkus, input.batchSize);
  const waitingForListing = queue.filter((entry) => entry.op === "create").map((entry) => entry.sku);
  t.start("queue.pick", { started_by: "a timer if someone installed its trigger, otherwise an operator by hand", rugs_per_run: input.batchSize, lock: "one run at a time" });
  t.advance(LATENCY.read * 2);
  t.log("info", "The queue is not a table of jobs. In this demo a rug is in it while its record changed after its last push, which is what the worker's comments describe; the real definition is not in the repository. Rugs changed by the newest applied import come first, oldest change first; older entries fill what is left.");
  if (waitingForListing.length > 0) t.log("info", `${waitingForListing.join(", ")} ${waitingForListing.length === 1 ? "has" : "have"} no listing yet, so an update run never takes ${waitingForListing.length === 1 ? "it" : "them"}.`);
  const leftBehind = queue.filter((entry) => entry.op === "update" && !picked.some((item) => item.sku === entry.sku)).map((entry) => entry.sku);
  if (picked.length === 0) {
    t.ok({ picked: [], queue: "empty" });
    t.skipRemaining("The queue had nothing to update.");
    t.finish("success", `Batch #${DEMO_BATCH_ID} applied: ${applied.result.inserted} new, ${applied.result.updated} updated, ${applied.result.sold} sold, ${applied.result.skipped} skipped. No existing listing needed a change, so the update worker had nothing to push.`, snap({ ...applied.result, pushed: [] }));
    return;
  }
  t.ok({ picked: picked.map((entry) => entry.sku), left_for_a_later_run: leftBehind, no_listing_yet: waitingForListing });

  // -- 13. Push to the storefront (simulated) ---------------------------------------------------------------
  const pushInput = { rugs: picked.map((entry) => entry.sku), writes: "quantity per warehouse, listing status, price when it drifted", storefront: "simulated" };
  if (faults.has("storefront-throttled")) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const wait = throttleWaitMs(attempt);
      if (wait === null) break;
      t.start("shopify.push", pushInput);
      t.advance(LATENCY.api);
      t.fail("THROTTLED", `The storefront API answered that the app is over its rate limit. The call waits ${wait / 1000}s and is tried again; the wait grows with each attempt.`, wait);
      t.advance(wait);
    }
  }
  t.start("shopify.push", pushInput);
  const pushed: { sku: string; summary: string }[] = [];
  const rejected: { sku: string; message: string }[] = [];
  const rejectIndex = Math.min(1, picked.length - 1);
  for (const [index, entry] of picked.entries()) {
    const record = inventory.find((item) => item.sku === entry.sku);
    const listing = listings.get(entry.sku);
    if (!record || !listing) continue;
    t.advance(LATENCY.api);
    if (faults.has("storefront-rejects-one") && index === rejectIndex) {
      const message = "the storefront returned an error for this listing";
      rejected.push({ sku: entry.sku, message });
      t.log("error", `${entry.sku}: ${message}. The failure is logged, the rug is not marked as pushed, and the run goes on to the next rug.`);
      continue;
    }
    const plan = planPush(record, listing);
    const before = snap(listing);
    listing.quantityHere = plan.quantityHere;
    listing.quantityElsewhere = plan.quantityElsewhere;
    if (plan.activate) listing.status = "active";
    if (plan.setPrice !== null) listing.price = plan.setPrice;
    t.change("storefront listings", "update", entry.sku, before, snap(listing));
    t.log("info", `${entry.sku}: ${plan.summary}.`);
    pushed.push({ sku: entry.sku, summary: plan.summary });
  }
  t.ok({ pushed: pushed.length, rejected: rejected.length, every_write_is_absolute: true }, rejected.length > 0 ? "One rug failed. The others were not held up." : undefined);

  // -- 14. Mark pushed and log ------------------------------------------------------------------------------
  t.start("push.record", { mark_pushed: pushed.map((item) => item.sku), log_rows: pushed.length + rejected.length });
  t.advance(LATENCY.write);
  for (const [index, item] of pushed.entries()) {
    const record = inventory.find((entry) => entry.sku === item.sku);
    if (record) record.pushedAt = 1_000 + index;
    t.change("inventory", "update", item.sku, { waiting_for_the_storefront: true }, { waiting_for_the_storefront: false });
    t.change("sync log", "insert", `${item.sku} update`, null, { rug: item.sku, operation: "update", ok: true, message: item.summary });
  }
  for (const item of rejected) t.change("sync log", "insert", `${item.sku} update`, null, { rug: item.sku, operation: "update", ok: false, message: item.message });
  t.log("info", "By the worker's own notes, marking a rug as pushed writes its sync fields only, so the mark does not put the rug back in the queue. In the real loop each rug is marked and logged right after its own push.");
  const stillQueued = deriveQueue(inventory).filter((entry) => entry.op === "update").map((entry) => entry.sku);
  if (rejected.length > 0) t.log("warn", `${rejected.map((item) => item.sku).join(", ")} stays in the queue and will be picked again on every run. Nothing counts the attempts, parks the rug or tells anyone.`);
  t.ok({ marked_pushed: pushed.length, logged: pushed.length + rejected.length, still_queued: stillQueued }, rejected.length > 0 ? "A failed rug has no retry limit." : undefined);

  const appliedLine = `Batch #${DEMO_BATCH_ID} applied: ${applied.result.inserted} new, ${applied.result.updated} updated, ${applied.result.sold} sold, ${applied.result.skipped} skipped.`;
  const pushLine = `${plural(pushed.length, "rug")} reached the storefront in this run${rejected.length > 0 ? `, ${rejected.length} was rejected and stays queued with no limit on retries` : ""}; ${stillQueued.length === 0 ? "nothing is left in the queue" : `${stillQueued.length} ${stillQueued.length === 1 ? "waits" : "wait"} for a later run`}.`;
  const newLine =
    approval === "approved"
      ? ` The ${plural(newSkus.length, "new rug")} ${newSkus.length === 1 ? "is" : "are"} approved, with no listing yet: an operator creates listings by hand.`
      : approval === "left unapproved"
        ? ` The ${plural(newSkus.length, "new rug")} ${newSkus.length === 1 ? "stays" : "stay"} unapproved and out of the storefront.`
        : "";
  const summary = snap({ ...applied.result, pushed: pushed.map((item) => item.sku), rejected: rejected.map((item) => item.sku), still_queued: stillQueued, new_rugs: approval });
  if (alarming) {
    t.finish(
      "failed",
      `${appliedLine} The file was cut short, so ${plural(counts.sold, "rug")} that may still be on the floor ${counts.sold === 1 ? "is" : "are"} now marked sold, and each one's listing is set to zero stock as the queue reaches it. Nothing in the repository compares the size of a file with the inventory. The preview, and the person reading it, were the only guard.`,
      summary,
    );
    return;
  }
  t.finish("success", `${appliedLine} ${pushLine}${newLine}`, summary);
}

export const rugsScenario: Scenario<RugsInput> = {
  id: RUGS_SCENARIO_ID,
  stepIds: RUGS_STEPS,
  run,
};
