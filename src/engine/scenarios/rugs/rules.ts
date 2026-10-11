/**
 * Rules of the rug inventory import and storefront synchronisation,
 * re-implemented in structure.
 *
 * The order of the upload checks, the repair of sizes and prices, the way a
 * row is classified, the two states of a batch and the way the update worker
 * picks and pushes its work mirror the project's Apps Script source, and each
 * block names the file it follows. The source is private, so every limit and
 * timing in DEMO_SETTINGS is invented, the protected status is an invented
 * name, and the column names of the demo file are not the client's.
 *
 * One thing here mirrors nothing: `applyStandIn`. The database function that
 * applies a batch is not in the repository, so the demo uses a plain stand-in
 * and says so wherever it runs.
 */

/** Invented limits and timings. None of these is a value the real system uses. */
export const DEMO_SETTINGS = {
  upload: { maxBytes: 2_000_000, extensions: ["csv", "xlsx"] },
  parse: { headerSearchRows: 6 },
  inventory: { pageSize: 4 },
  ready: { chunkSize: 2 },
  queue: { batchSize: 3, maxBatchSize: 6 },
  storefront: { maxAttempts: 4, throttleWaitMs: 1_500, priceTolerance: 0.25 },
  /** The real system protects a few statuses that a person sets on purpose. Their names are private; this one is invented. */
  protectedStatuses: ["Set aside"],
  /** Fields a bookkeeper may change. The real list is private; this one is invented. */
  bookkeeperFields: ["price", "accountingNote"],
} as const;

export const IN_STOCK = "In stock";
export const SOLD = "Sold";

const round2 = (value: number) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// Roles: apps-script/Code.gs:169-177, apps-script/Import_Upload.gs:9-10
// ---------------------------------------------------------------------------

/** The four roles the public write-up describes. */
export const ROLES = ["editor", "admin", "bookkeeper", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Previewing, applying and deleting an import need an editor or an admin. Returns the refusal, or null. */
export function importRefusal(role: Role): string | null {
  return role === "admin" || role === "editor" ? null : "Importing needs an editor or an admin account.";
}

/** A write to a rug is checked against the role in the signed session. Returns the refusal, or null. */
export function writeRefusal(role: Role, fields: readonly string[], bookkeeperFields: readonly string[] = DEMO_SETTINGS.bookkeeperFields): string | null {
  if (role === "viewer") return "This account is read-only.";
  if (role === "bookkeeper") {
    const blocked = fields.filter((field) => !bookkeeperFields.includes(field));
    if (blocked.length > 0) return `A bookkeeper account cannot change: ${blocked.join(", ")}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Upload checks: apps-script/Import_Upload.gs:8-25
// ---------------------------------------------------------------------------

export interface Upload {
  role: Role;
  /** Empty when no warehouse was chosen. */
  warehouse: string;
  fileName: string;
  sizeBytes: number;
}

export interface Refusal {
  code: string;
  message: string;
}

/** The checks in the order the server applies them. The first that fails is the answer. */
export function uploadRefusal(upload: Upload, settings: typeof DEMO_SETTINGS.upload = DEMO_SETTINGS.upload): Refusal | null {
  const role = importRefusal(upload.role);
  if (role) return { code: "ROLE", message: role };
  if (!upload.warehouse) return { code: "NO_WAREHOUSE", message: "Choose which warehouse the file is for." };
  const extension = /\.([a-z0-9]+)$/i.exec(upload.fileName.trim())?.[1]?.toLowerCase() ?? "";
  if (!(settings.extensions as readonly string[]).includes(extension)) return { code: "FILE_TYPE", message: "Upload a CSV or XLSX file." };
  if (upload.sizeBytes <= 0) return { code: "EMPTY", message: "The uploaded file is empty." };
  if (upload.sizeBytes > settings.maxBytes) return { code: "TOO_LARGE", message: `The file is larger than the ${Math.round(settings.maxBytes / 1_000_000)} MB limit.` };
  return null;
}

// ---------------------------------------------------------------------------
// Reading the file: apps-script/Import_CA.gs:145-183
// ---------------------------------------------------------------------------

/** One sheet as rows of cells. */
export type Grid = readonly (readonly unknown[])[];

/** Column names the demo file may use. They are the demo's own, not the client's. */
const SKU_NAMES = ["sku", "rug", "item"];
const PRICE_NAMES = ["price", "retail"];

function lowerCells(row: readonly unknown[]): string[] {
  return row.map((cell) => String(cell ?? "").trim().toLowerCase());
}

/** The header is looked for, not assumed: the first of the leading rows that names the SKU column, or both size columns. */
export function findHeaderRow(grid: Grid, searchRows: number = DEMO_SETTINGS.parse.headerSearchRows): number {
  for (let index = 0; index < Math.min(grid.length, searchRows); index += 1) {
    const cells = lowerCells(grid[index]);
    if (cells.includes(SKU_NAMES[0]) || (cells.includes("width") && cells.includes("length"))) return index;
  }
  return -1;
}

export interface SourceRow {
  sku: string;
  widthCell: unknown;
  lengthCell: unknown;
  priceCell: unknown;
}

export type ParseResult =
  | { ok: true; headerRow: number; rows: SourceRow[]; blankSkipped: number }
  | { ok: false; code: "EMPTY_FILE" | "NO_HEADER" | "NO_SKU_COLUMN"; message: string };

function firstColumn(header: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index > -1) return index;
  }
  return -1;
}

/** A whole number read from a sheet arrives as a number; it is kept as its digits. Anything else is trimmed text. */
export function normaliseSku(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number" && Number.isInteger(cell)) return String(cell);
  return String(cell).trim();
}

/** Rows under the header, keyed by column name. A row with no SKU is skipped without a message. */
export function parseRows(grid: Grid, searchRows: number = DEMO_SETTINGS.parse.headerSearchRows): ParseResult {
  if (grid.length === 0) return { ok: false, code: "EMPTY_FILE", message: "The file appears to be empty." };
  const headerRow = findHeaderRow(grid, searchRows);
  if (headerRow === -1) return { ok: false, code: "NO_HEADER", message: "Could not find the header row: no row near the top names the SKU column." };
  const header = lowerCells(grid[headerRow]);
  const skuColumn = firstColumn(header, SKU_NAMES);
  if (skuColumn === -1) return { ok: false, code: "NO_SKU_COLUMN", message: "The header row has no SKU column." };
  const widthColumn = firstColumn(header, ["width"]);
  const lengthColumn = firstColumn(header, ["length"]);
  const priceColumn = firstColumn(header, PRICE_NAMES);

  const rows: SourceRow[] = [];
  let blankSkipped = 0;
  for (const row of grid.slice(headerRow + 1)) {
    const sku = normaliseSku(row[skuColumn]);
    if (sku === "") {
      blankSkipped += 1;
      continue;
    }
    rows.push({ sku, widthCell: row[widthColumn], lengthCell: row[lengthColumn], priceCell: row[priceColumn] });
  }
  return { ok: true, headerRow, rows, blankSkipped };
}

// ---------------------------------------------------------------------------
// Sizes: apps-script/Import_CA.gs:339-372
// ---------------------------------------------------------------------------

/**
 * Repairs a size typed by hand and returns it as feet'inches", or null when it
 * cannot be read. Repaired: typographic marks typed for feet and inches, a
 * letter O typed for zero, two single quotes typed for inches, stray spaces,
 * and inches of twelve or more.
 */
export function normaliseSize(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  const text = String(cell)
    .trim()
    .replace(/[′ʹ´’`]/g, "'")
    .replace(/″/g, '"')
    .replace(/[oO]/g, "0")
    .replace(/''/g, '"')
    .replace(/\s+/g, "");
  if (text === "") return null;

  const feetEnd = text.indexOf("'");
  if (feetEnd <= 0) return null;
  const feetDigits = text.slice(0, feetEnd);
  if (!/^\d+$/.test(feetDigits)) return null;
  const afterFeet = text.slice(feetEnd + 1);
  const inchDigits = /^\d*/.exec(afterFeet)?.[0] ?? "";
  const tail = afterFeet.slice(inchDigits.length);
  // After the inches: nothing, a closing mark, or (when inches were given and closed) a trailing remark.
  const closed = tail === "" || tail === '"' || tail === "'" || tail === `"'`;
  if (!closed && !(inchDigits !== "" && tail.startsWith('"'))) return null;

  let feet = Number.parseInt(feetDigits, 10);
  let inches = inchDigits === "" ? 0 : Number.parseInt(inchDigits, 10);
  if (inches >= 12) {
    feet += Math.floor(inches / 12);
    inches %= 12;
  }
  return `${feet}'${inches}"`;
}

/** A normalised size as total inches and as metres. */
export function sizeInInches(size: string): { inches: number; metres: number } | null {
  const match = /^(\d+)'(\d+)"$/.exec(size);
  if (!match) return null;
  const inches = Number(match[1]) * 12 + Number(match[2]);
  return { inches, metres: round2(inches * 0.0254) };
}

// ---------------------------------------------------------------------------
// Prices: apps-script/Import_CA.gs:374-394
// ---------------------------------------------------------------------------

export interface PriceReading {
  /** Null means "leave the stored price alone". */
  value: number | null;
  /** Why the cell was not used, for a person to look at. Empty when there is nothing to say. */
  note: string;
}

/**
 * A price that refuses to guess. Words in the price cell and a price of zero
 * are notes for a person, never a price: the stored price is kept and is never
 * set to zero. Any digits in the cell are read as the number, as the real
 * parser does.
 */
export function readPrice(cell: unknown): PriceReading {
  if (cell === null || cell === undefined) return { value: null, note: "" };
  if (typeof cell === "number") return cell === 0 ? { value: null, note: "price was 0, ignored" } : { value: round2(cell), note: "" };
  const text = String(cell).trim();
  if (text === "") return { value: null, note: "" };
  const digits = text.replace(/[^0-9.]/g, "");
  const parsed = digits === "" ? Number.NaN : Number(digits);
  if (Number.isNaN(parsed)) return { value: null, note: `price cell said "${text}"` };
  if (parsed === 0) return { value: null, note: "price was 0, ignored" };
  return { value: round2(parsed), note: "" };
}

export interface NormalisedRow {
  sku: string;
  width: string | null;
  length: string | null;
  price: number | null;
  priceNote: string;
  rawWidth: string;
  rawLength: string;
}

export function normaliseRows(rows: readonly SourceRow[]): NormalisedRow[] {
  return rows.map((row) => {
    const price = readPrice(row.priceCell);
    return {
      sku: row.sku,
      width: normaliseSize(row.widthCell),
      length: normaliseSize(row.lengthCell),
      price: price.value,
      priceNote: price.note,
      rawWidth: String(row.widthCell ?? "").trim(),
      rawLength: String(row.lengthCell ?? "").trim(),
    };
  });
}

// ---------------------------------------------------------------------------
// The comparison: apps-script/Import_CA.gs:207-303
// ---------------------------------------------------------------------------

export interface RugRecord {
  sku: string;
  status: string;
  width: string;
  length: string;
  price: number | null;
  /** Approved for the storefront. A new rug arrives unapproved. */
  approved: boolean;
  /** True when the rug already has a storefront listing. */
  listed: boolean;
  /** Logical time of the last change to the record. */
  changedAt: number;
  /** Logical time of the last push to the storefront, or null when it was never pushed. */
  pushedAt: number | null;
}

export type RowAction = "new" | "update" | "sold" | "unchanged" | "error";
export type DiffField = "status" | "width" | "length" | "price";

export interface DiffRow {
  sku: string;
  action: RowAction;
  note: string;
  /** For an update or a sale: field, then [stored value, proposed value]. */
  changes: Partial<Record<DiffField, [string | number | null, string | number]>>;
  /** For a new rug: what it arrives with. A flagged price arrives empty. */
  values?: { width: string; length: string; price: number | null };
}

export interface DiffCounts {
  new: number;
  updated: number;
  sold: number;
  unchanged: number;
  error: number;
  protected: number;
  needsReview: number;
}

export const PROTECTED_NOTE = "protected status: ";

/**
 * Compares every row of the file with the warehouse's inventory. Nothing is
 * written. In order: an unreadable size is an error; a price note is counted
 * for review; a rug not in inventory is new; a rug with a protected status is
 * left alone; otherwise the fields are compared. Last, every rug that is in
 * stock and absent from the file is proposed as sold.
 *
 * "Needs review" and "protected" are flags counted beside the action, so a row
 * can be, say, unchanged and flagged for review at once.
 */
export function classifyRows(
  rows: readonly NormalisedRow[],
  inventory: readonly RugRecord[],
  protectedStatuses: readonly string[] = DEMO_SETTINGS.protectedStatuses,
): { rows: DiffRow[]; counts: DiffCounts } {
  const stored = new Map(inventory.map((record) => [record.sku, record]));
  const seen = new Set<string>();
  const out: DiffRow[] = [];
  const counts: DiffCounts = { new: 0, updated: 0, sold: 0, unchanged: 0, error: 0, protected: 0, needsReview: 0 };

  for (const row of rows) {
    // Used only to find rugs missing from the file. A SKU listed twice is not noticed.
    seen.add(row.sku);
    const old = stored.get(row.sku);

    if (!row.width || !row.length) {
      counts.error += 1;
      out.push({ sku: row.sku, action: "error", note: `unreadable size: "${row.rawWidth}" x "${row.rawLength}"`, changes: {} });
      continue;
    }
    if (row.priceNote) counts.needsReview += 1;

    if (!old) {
      counts.new += 1;
      out.push({ sku: row.sku, action: "new", note: row.priceNote, changes: {}, values: { width: row.width, length: row.length, price: row.price } });
      continue;
    }
    if (protectedStatuses.includes(old.status)) {
      counts.protected += 1;
      out.push({ sku: row.sku, action: "unchanged", note: `${PROTECTED_NOTE}${old.status}`, changes: {} });
      continue;
    }

    const changes: DiffRow["changes"] = {};
    if (old.status !== IN_STOCK) changes.status = [old.status, IN_STOCK];
    if (normaliseSize(old.width) !== row.width) changes.width = [old.width, row.width];
    if (normaliseSize(old.length) !== row.length) changes.length = [old.length, row.length];
    if (row.price !== null && old.price !== row.price) changes.price = [old.price, row.price];

    if (Object.keys(changes).length === 0) {
      counts.unchanged += 1;
      out.push({ sku: row.sku, action: "unchanged", note: row.priceNote, changes: {} });
      continue;
    }
    counts.updated += 1;
    out.push({ sku: row.sku, action: "update", note: row.priceNote, changes });
  }

  for (const record of inventory) {
    if (seen.has(record.sku) || record.status !== IN_STOCK) continue;
    counts.sold += 1;
    out.push({ sku: record.sku, action: "sold", note: "", changes: { status: [IN_STOCK, SOLD] } });
  }
  return { rows: out, counts };
}

// ---------------------------------------------------------------------------
// Review: apps-script/Import_Upload.gs:76-87, apps-script/Code.gs:1721
// ---------------------------------------------------------------------------

export const ROW_CLASSES = ["new", "updated", "sold", "unchanged", "needs review", "protected", "error"] as const;
export type RowClass = (typeof ROW_CLASSES)[number];

/** The classes one stored row is shown under. */
export function rowClasses(row: DiffRow): RowClass[] {
  const classes: RowClass[] = [row.action === "update" ? "updated" : row.action];
  const isProtected = row.note.startsWith(PROTECTED_NOTE);
  if (isProtected) classes.push("protected");
  else if (row.note && row.action !== "error") classes.push("needs review");
  return classes;
}

/** The view a fresh preview opens on: errors first, then review flags, then every change. */
export function openingView(counts: DiffCounts): "errors" | "needs review" | "all changes" {
  if (counts.error > 0) return "errors";
  if (counts.needsReview > 0) return "needs review";
  return "all changes";
}

// ---------------------------------------------------------------------------
// The batch: apps-script/Import_Upload.gs:264-293, 331-356
// ---------------------------------------------------------------------------

/** A stored batch has two states. "In review" is something a person does, not a state. */
export type BatchState = "preview" | "applied";

export function applyRefusal(batchId: number, state: BatchState): string | null {
  return state === "preview" ? null : `Batch #${batchId} is already ${state}.`;
}

export function deleteRefusal(state: BatchState): string | null {
  return state === "preview" ? null : "Only preview batches can be deleted.";
}

export interface ApplyResult {
  inserted: number;
  updated: number;
  sold: number;
  skipped: number;
}

export interface AppliedChange {
  sku: string;
  op: "insert" | "update";
  before: RugRecord | null;
  after: RugRecord;
}

/**
 * STAND-IN, not a mirror. The database function that applies a batch is not in
 * the repository; only its call and the four counts it returns are. This
 * follows the stored rows the way the callers describe them: an error row is
 * skipped, a flagged price writes nothing, a new rug arrives in stock and
 * unapproved. It applies rows in stored order, so when a SKU is listed twice
 * the later row wins. What the real function does in that case is unknown.
 */
export function applyStandIn(rows: readonly DiffRow[], inventory: readonly RugRecord[], startAt: number): { inventory: RugRecord[]; result: ApplyResult; changes: AppliedChange[] } {
  const next = new Map(inventory.map((record) => [record.sku, { ...record }]));
  const result: ApplyResult = { inserted: 0, updated: 0, sold: 0, skipped: 0 };
  const changes: AppliedChange[] = [];
  let clock = startAt;

  for (const row of rows) {
    if (row.action === "error") {
      result.skipped += 1;
      continue;
    }
    if (row.action === "unchanged") continue;
    const before = next.get(row.sku) ?? null;
    clock += 1;

    if (row.action === "new" && !before && row.values) {
      const after: RugRecord = { sku: row.sku, status: IN_STOCK, width: row.values.width, length: row.values.length, price: row.values.price, approved: false, listed: false, changedAt: clock, pushedAt: null };
      next.set(row.sku, after);
      result.inserted += 1;
      changes.push({ sku: row.sku, op: "insert", before: null, after });
      continue;
    }
    if (!before) continue;

    const after: RugRecord = { ...before, changedAt: clock };
    if (row.action === "sold") {
      after.status = SOLD;
      result.sold += 1;
    } else {
      if (row.changes.status) after.status = IN_STOCK;
      if (row.changes.width) after.width = String(row.changes.width[1]);
      if (row.changes.length) after.length = String(row.changes.length[1]);
      if (row.changes.price) after.price = Number(row.changes.price[1]);
      if (row.values) {
        after.width = row.values.width;
        after.length = row.values.length;
        if (row.values.price !== null) after.price = row.values.price;
      }
      result.updated += 1;
    }
    next.set(row.sku, after);
    changes.push({ sku: row.sku, op: "update", before, after });
  }
  return { inventory: [...next.values()], result, changes };
}

// ---------------------------------------------------------------------------
// Ready-marking: apps-script/Import_Upload.gs:295-319
// ---------------------------------------------------------------------------

/**
 * Existing rugs that an import updated or sold are marked ready without a
 * second approval: they passed the listing workflow once already. New rugs are
 * not in this list. Each SKU appears once, however often the file listed it.
 */
export function skusToMarkReady(rows: readonly DiffRow[]): string[] {
  return [...new Set(rows.filter((row) => row.action === "update" || row.action === "sold").map((row) => row.sku))];
}

/** The ready flag is written a few rugs per request. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += Math.max(1, size)) out.push(items.slice(start, start + Math.max(1, size)));
  return out;
}

// ---------------------------------------------------------------------------
// The queue and the update worker: apps-script/Shopify_Push.gs:163-311
// ---------------------------------------------------------------------------

export interface QueueEntry {
  sku: string;
  /** update: the rug has a listing. create: it has none yet. */
  op: "update" | "create";
  changedAt: number;
}

/**
 * The queue is not a table of jobs. In this demo a rug is in it while its
 * record changed after its last push, which is what the worker's own comments
 * describe; the real definition of the relation is not in the repository. An
 * entry has no attempt count and no failed state.
 */
export function deriveQueue(inventory: readonly RugRecord[]): QueueEntry[] {
  const entries: QueueEntry[] = [];
  for (const record of inventory) {
    if (record.listed) {
      if (record.pushedAt === null || record.changedAt > record.pushedAt) entries.push({ sku: record.sku, op: "update", changedAt: record.changedAt });
    } else if (record.status === IN_STOCK) {
      entries.push({ sku: record.sku, op: "create", changedAt: record.changedAt });
    }
  }
  return entries;
}

/**
 * One run takes a small batch of updates. Rugs the newest applied import
 * changed come first, oldest change first; older entries fill what is left.
 * A rug with no listing is never part of an update run.
 */
export function pickUpdateQueue(queue: readonly QueueEntry[], latestImportSkus: readonly string[], limit: number): QueueEntry[] {
  const wanted = Math.max(0, Math.floor(limit));
  if (wanted === 0) return [];
  const byAge = queue.filter((entry) => entry.op === "update").sort((a, b) => a.changedAt - b.changedAt || a.sku.localeCompare(b.sku));
  const priority = new Set(latestImportSkus);
  return [...byAge.filter((entry) => priority.has(entry.sku)), ...byAge.filter((entry) => !priority.has(entry.sku))].slice(0, wanted);
}

export interface Listing {
  /** Units at this rug's own warehouse location, and at the other one. */
  quantityHere: number;
  quantityElsewhere: number;
  status: "active" | "draft";
  price: number | null;
}

export interface PushPlan {
  quantityHere: 0 | 1;
  quantityElsewhere: 0;
  /** An in-stock rug's listing is made visible. */
  activate: boolean;
  /** Null when the listing's price is already right. */
  setPrice: number | null;
  summary: string;
}

/**
 * What one push writes. Every write is absolute (set the quantity, set the
 * price), so repeating a push is harmless. A rug is one of a kind: one unit at
 * its own warehouse when in stock, none when sold, and none at the other
 * warehouse. The price is written only when the listing has drifted.
 */
export function planPush(record: RugRecord, listing: Listing, tolerance: number = DEMO_SETTINGS.storefront.priceTolerance): PushPlan {
  const quantityHere = record.status === IN_STOCK ? 1 : 0;
  const drifted = record.price !== null && (listing.price === null || Math.abs(listing.price - record.price) > tolerance);
  const setPrice = drifted ? record.price : null;
  const parts = [`quantity ${quantityHere} here, 0 at the other warehouse`];
  if (quantityHere === 1) parts.push("listing active");
  if (setPrice !== null) parts.push(`price ${listing.price ?? "?"} to ${setPrice}`);
  return { quantityHere, quantityElsewhere: 0, activate: quantityHere === 1, setPrice, summary: parts.join(", ") };
}

/**
 * apps-script/Shopify_Push.gs:429-459. A throttled call waits longer on each
 * attempt. When the attempts run out (null here) the call fails, which fails
 * that one rug for this run.
 */
export function throttleWaitMs(attempt: number, settings: typeof DEMO_SETTINGS.storefront = DEMO_SETTINGS.storefront): number | null {
  return attempt >= settings.maxAttempts ? null : settings.throttleWaitMs * attempt;
}
