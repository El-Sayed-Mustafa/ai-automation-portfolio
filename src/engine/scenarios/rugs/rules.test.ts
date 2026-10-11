import { describe, expect, test } from "vitest";
import {
  DEMO_SETTINGS,
  IN_STOCK,
  PROTECTED_NOTE,
  ROLES,
  ROW_CLASSES,
  SOLD,
  applyRefusal,
  applyStandIn,
  chunk,
  classifyRows,
  deleteRefusal,
  deriveQueue,
  findHeaderRow,
  importRefusal,
  normaliseRows,
  normaliseSize,
  normaliseSku,
  openingView,
  parseRows,
  pickUpdateQueue,
  planPush,
  readPrice,
  rowClasses,
  sizeInInches,
  skusToMarkReady,
  throttleWaitMs,
  uploadRefusal,
  writeRefusal,
  type DiffRow,
  type Listing,
  type NormalisedRow,
  type RugRecord,
  type Upload,
} from "./rules";

const PROTECTED = DEMO_SETTINGS.protectedStatuses[0];

function record(sku: string, change: Partial<RugRecord> = {}): RugRecord {
  return { sku, status: IN_STOCK, width: `5'0"`, length: `8'0"`, price: 1000, approved: true, listed: true, changedAt: -20, pushedAt: -10, ...change };
}

function fileRow(sku: string, change: Partial<NormalisedRow> = {}): NormalisedRow {
  return { sku, width: `5'0"`, length: `8'0"`, price: 1000, priceNote: "", rawWidth: `5'0"`, rawLength: `8'0"`, ...change };
}

describe("roles", () => {
  test("only an editor or an admin may run an import", () => {
    expect(ROLES.filter((role) => importRefusal(role) === null)).toEqual(["editor", "admin"]);
    expect(importRefusal("bookkeeper")).toMatch(/editor or an admin/);
  });

  test("a viewer cannot write, and a bookkeeper only its own fields", () => {
    expect(writeRefusal("viewer", ["price"])).toMatch(/read-only/);
    expect(writeRefusal("bookkeeper", ["price"])).toBeNull();
    expect(writeRefusal("bookkeeper", ["price", "approved"])).toBe("A bookkeeper account cannot change: approved.");
    expect(writeRefusal("editor", ["approved", "width"])).toBeNull();
    expect(writeRefusal("admin", ["approved"])).toBeNull();
  });
});

describe("upload checks", () => {
  const good: Upload = { role: "editor", warehouse: "North", fileName: "stock.xlsx", sizeBytes: 184_000 };

  test("a good upload passes", () => {
    expect(uploadRefusal(good)).toBeNull();
    expect(uploadRefusal({ ...good, fileName: "STOCK.CSV" })).toBeNull();
  });

  const cases: [string, Partial<Upload>][] = [
    ["ROLE", { role: "viewer" }],
    ["NO_WAREHOUSE", { warehouse: "" }],
    ["FILE_TYPE", { fileName: "stock.pdf" }],
    ["FILE_TYPE", { fileName: "stock" }],
    ["EMPTY", { sizeBytes: 0 }],
    ["TOO_LARGE", { sizeBytes: DEMO_SETTINGS.upload.maxBytes + 1 }],
  ];

  test.each(cases)("refuses with %s", (code, change) => {
    expect(uploadRefusal({ ...good, ...change })?.code).toBe(code);
  });

  test("the first failing check is the answer, in the server's order", () => {
    expect(uploadRefusal({ role: "viewer", warehouse: "", fileName: "x.pdf", sizeBytes: 0 })?.code).toBe("ROLE");
    expect(uploadRefusal({ ...good, fileName: "x.pdf", sizeBytes: 9_000_000 })?.code).toBe("FILE_TYPE");
  });

  test("a file exactly at the limit is accepted", () => {
    expect(uploadRefusal({ ...good, sizeBytes: DEMO_SETTINGS.upload.maxBytes })).toBeNull();
  });
});

describe("reading the file", () => {
  const header = ["SKU", "Width", "Length", "Price"];

  test("the header is found under title lines", () => {
    expect(findHeaderRow([["Stock list"], ["March"], header])).toBe(2);
    expect(findHeaderRow([header])).toBe(0);
  });

  test("a row naming both size columns also counts as the header", () => {
    expect(findHeaderRow([["Item", " width ", "LENGTH"]])).toBe(0);
  });

  test("the search stops after the leading rows", () => {
    const titles = Array.from({ length: DEMO_SETTINGS.parse.headerSearchRows }, () => ["title"]);
    expect(findHeaderRow([...titles, header])).toBe(-1);
    expect(findHeaderRow([...titles.slice(1), header])).toBe(DEMO_SETTINGS.parse.headerSearchRows - 1);
  });

  test("rows are read by column name, and a row with no SKU is skipped", () => {
    const parsed = parseRows([["Stock list"], ["Price", "Length", "Width", "SKU"], ["900", `8'0"`, `5'0"`, "R-1"], ["", "", "", ""], [null, null, null, null], ["", `6'0"`, `4'0"`, "R-2"]]);
    expect(parsed).toEqual({
      ok: true,
      headerRow: 1,
      blankSkipped: 2,
      rows: [
        { sku: "R-1", widthCell: `5'0"`, lengthCell: `8'0"`, priceCell: "900" },
        { sku: "R-2", widthCell: `4'0"`, lengthCell: `6'0"`, priceCell: "" },
      ],
    });
  });

  test("an empty file, a missing header and a missing SKU column are each refused", () => {
    expect(parseRows([])).toMatchObject({ ok: false, code: "EMPTY_FILE" });
    expect(parseRows([["Stock no.", "W", "L", "Ask"], ["R-1", "5", "8", "900"]])).toMatchObject({ ok: false, code: "NO_HEADER" });
    expect(parseRows([["Number", "Width", "Length"], ["R-1", `5'0"`, `8'0"`]])).toMatchObject({ ok: false, code: "NO_SKU_COLUMN" });
  });

  test("a SKU that a sheet stored as a whole number keeps its digits", () => {
    expect(normaliseSku(10231)).toBe("10231");
    expect(normaliseSku("  R-10231 ")).toBe("R-10231");
    expect(normaliseSku(null)).toBe("");
  });
});

describe("sizes", () => {
  const readable: [unknown, string][] = [
    [`5'7"`, `5'7"`],
    [`5' 7''`, `5'7"`],
    [" 5'7 ", `5'7"`],
    ["5'", `5'0"`],
    ["5′7″", `5'7"`],
    ["5’7\"", `5'7"`],
    ["5`7\"", `5'7"`],
    [`1O'3"`, `10'3"`],
    [`8'o"`, `8'0"`],
    [`2'22"`, `3'10"`],
    [`5'12"`, `6'0"`],
    [`5'7" approx`, `5'7"`],
    [`5'7"'`, `5'7"`],
  ];

  test.each(readable)("%s is read as %s", (cell, expected) => {
    expect(normaliseSize(cell)).toBe(expected);
  });

  const unreadable: unknown[] = ["4 ft", "67 in", "5x7", "", "   ", null, undefined, "'7\"", "five'7\"", `5'7 approx`, "5.5'"];

  test.each(unreadable.map((cell) => [cell]))("%s cannot be read", (cell) => {
    expect(normaliseSize(cell)).toBeNull();
  });

  test("a normalised size converts to inches and metres", () => {
    expect(sizeInInches(`5'7"`)).toEqual({ inches: 67, metres: 1.7 });
    expect(sizeInInches("5 ft")).toBeNull();
  });
});

describe("prices", () => {
  test("a number is a price, rounded to cents", () => {
    expect(readPrice(1450)).toEqual({ value: 1450, note: "" });
    expect(readPrice("1450")).toEqual({ value: 1450, note: "" });
    expect(readPrice("$1,450.50")).toEqual({ value: 1450.5, note: "" });
    expect(readPrice(19.999)).toEqual({ value: 20, note: "" });
  });

  test("words in the cell are a note, never a price", () => {
    expect(readPrice("on hold")).toEqual({ value: null, note: 'price cell said "on hold"' });
    expect(readPrice("1.2.3")).toEqual({ value: null, note: 'price cell said "1.2.3"' });
  });

  test("zero is a note, never a price", () => {
    expect(readPrice(0)).toEqual({ value: null, note: "price was 0, ignored" });
    expect(readPrice("0.00")).toEqual({ value: null, note: "price was 0, ignored" });
  });

  test("an empty cell says nothing and changes nothing", () => {
    for (const cell of ["", "  ", null, undefined]) expect(readPrice(cell)).toEqual({ value: null, note: "" });
  });

  test("any digits in the cell are read as the number, as the real parser does", () => {
    expect(readPrice("ask 900")).toEqual({ value: 900, note: "" });
  });

  test("rows keep the raw cells beside the normalised values", () => {
    expect(normaliseRows([{ sku: "R-1", widthCell: " 4 ft ", lengthCell: `6' 1''`, priceCell: "on hold" }])).toEqual([
      { sku: "R-1", width: null, length: `6'1"`, price: null, priceNote: 'price cell said "on hold"', rawWidth: "4 ft", rawLength: `6' 1''` },
    ]);
  });
});

describe("the comparison", () => {
  const inventory = [record("R-1"), record("R-2"), record("R-3", { status: PROTECTED }), record("R-4", { status: SOLD })];

  test("a rug not in inventory is new and arrives with its size and price", () => {
    const { rows, counts } = classifyRows([fileRow("R-9", { price: 700 })], []);
    expect(rows).toEqual([{ sku: "R-9", action: "new", note: "", changes: {}, values: { width: `5'0"`, length: `8'0"`, price: 700 } }]);
    expect(counts).toMatchObject({ new: 1, updated: 0, sold: 0 });
  });

  test("a rug with nothing different is unchanged", () => {
    const { rows, counts } = classifyRows([fileRow("R-1"), fileRow("R-2")], inventory);
    expect(rows.slice(0, 2).map((row) => row.action)).toEqual(["unchanged", "unchanged"]);
    expect(counts).toMatchObject({ unchanged: 2, updated: 0, sold: 0 });
  });

  test("a changed size or price is an update that carries old and new", () => {
    const { rows, counts } = classifyRows([fileRow("R-1", { length: `8'2"`, price: 1100 }), fileRow("R-2")], inventory);
    expect(rows[0]).toMatchObject({ action: "update", changes: { length: [`8'0"`, `8'2"`], price: [1000, 1100] } });
    expect(rows[0].changes.width).toBeUndefined();
    expect(counts.updated).toBe(1);
  });

  test("a rug that is listed again after being sold goes back in stock", () => {
    const { rows } = classifyRows([fileRow("R-1"), fileRow("R-2"), fileRow("R-4")], inventory);
    expect(rows[2]).toMatchObject({ action: "update", changes: { status: [SOLD, IN_STOCK] } });
  });

  test("an unreadable size is an error row, and nothing else is read from it", () => {
    const { rows, counts } = classifyRows([fileRow("R-1", { width: null, rawWidth: "4 ft", price: null, priceNote: 'price cell said "on hold"' }), fileRow("R-2")], inventory);
    expect(rows[0]).toEqual({ sku: "R-1", action: "error", note: `unreadable size: "4 ft" x "8'0""`, changes: {} });
    expect(counts).toMatchObject({ error: 1, needsReview: 0 });
  });

  test("a flagged price keeps the stored price and is counted for review beside the row's action", () => {
    const { rows, counts } = classifyRows([fileRow("R-1", { price: null, priceNote: "price was 0, ignored" }), fileRow("R-2", { price: null, priceNote: 'price cell said "on hold"', length: `8'4"` })], inventory);
    expect(rows[0]).toMatchObject({ action: "unchanged", note: "price was 0, ignored", changes: {} });
    expect(rows[1]).toMatchObject({ action: "update", note: 'price cell said "on hold"' });
    expect(rows[1].changes.price).toBeUndefined();
    expect(counts).toMatchObject({ unchanged: 1, updated: 1, needsReview: 2 });
  });

  test("a new rug with a flagged price arrives without a price", () => {
    const { rows, counts } = classifyRows([fileRow("R-9", { price: null, priceNote: 'price cell said "on hold"' })], []);
    expect(rows[0]).toMatchObject({ action: "new", values: { price: null } });
    expect(counts).toMatchObject({ new: 1, needsReview: 1 });
  });

  test("a rug with a protected status is never overwritten, even when the file differs", () => {
    const { rows, counts } = classifyRows([fileRow("R-1"), fileRow("R-2"), fileRow("R-3", { price: 5, width: `9'9"` })], inventory);
    expect(rows[2]).toEqual({ sku: "R-3", action: "unchanged", note: `${PROTECTED_NOTE}${PROTECTED}`, changes: {} });
    expect(counts).toMatchObject({ protected: 1, unchanged: 2, updated: 0 });
  });

  test("a rug in stock and absent from the file is proposed as sold; other statuses are left alone", () => {
    const { rows, counts } = classifyRows([fileRow("R-1")], inventory);
    expect(rows.filter((row) => row.action === "sold")).toEqual([{ sku: "R-2", action: "sold", note: "", changes: { status: [IN_STOCK, SOLD] } }]);
    expect(counts.sold).toBe(1);
  });

  test("an empty or short file proposes every missing rug as sold: there is no guard", () => {
    const stock = Array.from({ length: 20 }, (_, index) => record(`R-${index}`));
    expect(classifyRows([], stock).counts.sold).toBe(20);
    expect(classifyRows([fileRow("R-0")], stock).counts.sold).toBe(19);
  });

  test("a SKU listed twice gets two rows and is not noticed", () => {
    const { rows, counts } = classifyRows([fileRow("R-1", { price: 1100 }), fileRow("R-1", { price: 1200 }), fileRow("R-2")], inventory);
    expect(rows.filter((row) => row.sku === "R-1").map((row) => row.changes.price)).toEqual([
      [1000, 1100],
      [1000, 1200],
    ]);
    expect(counts.updated).toBe(2);
  });

  test("nothing is written to the inventory it was given", () => {
    const before = JSON.stringify(inventory);
    classifyRows([fileRow("R-1", { price: 1 })], inventory);
    expect(JSON.stringify(inventory)).toBe(before);
  });
});

describe("review", () => {
  const row = (change: Partial<DiffRow>): DiffRow => ({ sku: "R-1", action: "unchanged", note: "", changes: {}, ...change });

  test("the seven classes of the public write-up", () => {
    expect(ROW_CLASSES).toEqual(["new", "updated", "sold", "unchanged", "needs review", "protected", "error"]);
  });

  test("a row is shown under its action and under any flag it carries", () => {
    expect(rowClasses(row({ action: "update" }))).toEqual(["updated"]);
    expect(rowClasses(row({ action: "new", note: "price was 0, ignored" }))).toEqual(["new", "needs review"]);
    expect(rowClasses(row({ note: `${PROTECTED_NOTE}${PROTECTED}` }))).toEqual(["unchanged", "protected"]);
    expect(rowClasses(row({ action: "error", note: "unreadable size" }))).toEqual(["error"]);
    expect(rowClasses(row({ action: "sold" }))).toEqual(["sold"]);
  });

  test("a fresh preview opens on errors, then on review flags, then on every change", () => {
    const counts = { new: 1, updated: 1, sold: 0, unchanged: 0, error: 0, protected: 0, needsReview: 0 };
    expect(openingView(counts)).toBe("all changes");
    expect(openingView({ ...counts, needsReview: 1 })).toBe("needs review");
    expect(openingView({ ...counts, needsReview: 1, error: 2 })).toBe("errors");
  });
});

describe("the batch", () => {
  test("a batch has two states, and only a preview can be applied or deleted", () => {
    expect(applyRefusal(41, "preview")).toBeNull();
    expect(applyRefusal(41, "applied")).toBe("Batch #41 is already applied.");
    expect(deleteRefusal("preview")).toBeNull();
    expect(deleteRefusal("applied")).toMatch(/Only preview batches/);
  });

  const inventory = [record("R-1"), record("R-2"), record("R-3", { status: SOLD })];
  const rows: DiffRow[] = [
    { sku: "R-1", action: "update", note: "", changes: { price: [1000, 1100], length: [`8'0"`, `8'2"`] } },
    { sku: "R-2", action: "sold", note: "", changes: { status: [IN_STOCK, SOLD] } },
    { sku: "R-3", action: "update", note: "", changes: { status: [SOLD, IN_STOCK] } },
    { sku: "R-7", action: "error", note: "unreadable size", changes: {} },
    { sku: "R-8", action: "unchanged", note: "", changes: {} },
    { sku: "R-9", action: "new", note: "", changes: {}, values: { width: `3'0"`, length: `5'0"`, price: null } },
  ];

  test("the stand-in follows the stored rows and returns the four counts", () => {
    const applied = applyStandIn(rows, inventory, 0);
    expect(applied.result).toEqual({ inserted: 1, updated: 2, sold: 1, skipped: 1 });
    const bySku = Object.fromEntries(applied.inventory.map((item) => [item.sku, item]));
    expect(bySku["R-1"]).toMatchObject({ price: 1100, length: `8'2"`, width: `5'0"`, changedAt: 1 });
    expect(bySku["R-2"]).toMatchObject({ status: SOLD, changedAt: 2 });
    expect(bySku["R-3"]).toMatchObject({ status: IN_STOCK, changedAt: 3 });
    expect(bySku["R-9"]).toEqual({ sku: "R-9", status: IN_STOCK, width: `3'0"`, length: `5'0"`, price: null, approved: false, listed: false, changedAt: 4, pushedAt: null });
    expect(bySku["R-7"]).toBeUndefined();
  });

  test("the stand-in does not change the inventory it was given", () => {
    const before = JSON.stringify(inventory);
    applyStandIn(rows, inventory, 0);
    expect(JSON.stringify(inventory)).toBe(before);
  });

  test("when a SKU has two rows the stand-in lets the later one win", () => {
    const twice: DiffRow[] = [
      { sku: "R-1", action: "update", note: "", changes: { price: [1000, 1100] } },
      { sku: "R-1", action: "update", note: "", changes: { price: [1000, 1200] } },
    ];
    const applied = applyStandIn(twice, inventory, 0);
    expect(applied.inventory.find((item) => item.sku === "R-1")?.price).toBe(1200);
    expect(applied.result.updated).toBe(2);
  });

  test("a second new row for the same SKU does not create a second rug", () => {
    const twice: DiffRow[] = [
      { sku: "R-9", action: "new", note: "", changes: {}, values: { width: `3'0"`, length: `5'0"`, price: 500 } },
      { sku: "R-9", action: "new", note: "", changes: {}, values: { width: `3'0"`, length: `5'1"`, price: null } },
    ];
    const applied = applyStandIn(twice, [], 0);
    expect(applied.inventory).toHaveLength(1);
    expect(applied.inventory[0]).toMatchObject({ length: `5'1"`, price: 500 });
    expect(applied.result).toMatchObject({ inserted: 1, updated: 1 });
  });
});

describe("ready-marking", () => {
  test("only existing rugs the import updated or sold, each once", () => {
    const rows: DiffRow[] = [
      { sku: "R-1", action: "update", note: "", changes: {} },
      { sku: "R-1", action: "update", note: "", changes: {} },
      { sku: "R-2", action: "sold", note: "", changes: {} },
      { sku: "R-3", action: "new", note: "", changes: {} },
      { sku: "R-4", action: "unchanged", note: "", changes: {} },
      { sku: "R-5", action: "error", note: "", changes: {} },
    ];
    expect(skusToMarkReady(rows)).toEqual(["R-1", "R-2"]);
  });

  test("the flag is written a few rugs per request", () => {
    expect(chunk(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(chunk([], 2)).toEqual([]);
    expect(chunk(["a"], 0)).toEqual([["a"]]);
  });
});

describe("the queue", () => {
  const inventory = [
    record("R-1", { changedAt: 3 }),
    record("R-2", { changedAt: 1 }),
    record("R-3"),
    record("R-4", { changedAt: -5 }),
    record("R-5", { listed: false, pushedAt: null, approved: false, changedAt: 2 }),
    record("R-6", { listed: false, pushedAt: null, status: PROTECTED }),
    record("R-7", { pushedAt: null }),
  ];

  test("a rug is queued while its record changed after its last push", () => {
    expect(deriveQueue(inventory)).toEqual([
      { sku: "R-1", op: "update", changedAt: 3 },
      { sku: "R-2", op: "update", changedAt: 1 },
      { sku: "R-4", op: "update", changedAt: -5 },
      { sku: "R-5", op: "create", changedAt: 2 },
      { sku: "R-7", op: "update", changedAt: -20 },
    ]);
  });

  test("a pushed rug leaves the queue", () => {
    const pushed = inventory.map((item) => (item.sku === "R-1" ? { ...item, pushedAt: 10 } : item));
    expect(deriveQueue(pushed).map((entry) => entry.sku)).not.toContain("R-1");
  });

  test("the newest import's rugs come first, oldest change first, then older entries", () => {
    const picked = pickUpdateQueue(deriveQueue(inventory), ["R-1", "R-2"], 3);
    expect(picked.map((entry) => entry.sku)).toEqual(["R-2", "R-1", "R-7"]);
  });

  test("one run takes no more than its batch, and never a rug without a listing", () => {
    const queue = deriveQueue(inventory);
    expect(pickUpdateQueue(queue, [], 2).map((entry) => entry.sku)).toEqual(["R-7", "R-4"]);
    expect(pickUpdateQueue(queue, ["R-5"], 10).map((entry) => entry.sku)).toEqual(["R-7", "R-4", "R-2", "R-1"]);
    expect(pickUpdateQueue(queue, [], 0)).toEqual([]);
  });

  test("a queue entry carries no attempt count and no failed state", () => {
    expect(Object.keys(deriveQueue(inventory)[0]).sort()).toEqual(["changedAt", "op", "sku"]);
  });
});

describe("one push", () => {
  const listing: Listing = { quantityHere: 1, quantityElsewhere: 0, status: "active", price: 1000 };

  test("an in-stock rug is one unit here, none elsewhere, and visible", () => {
    expect(planPush(record("R-1"), listing)).toEqual({ quantityHere: 1, quantityElsewhere: 0, activate: true, setPrice: null, summary: "quantity 1 here, 0 at the other warehouse, listing active" });
  });

  test("a sold rug goes to zero and its listing status is left alone", () => {
    expect(planPush(record("R-1", { status: SOLD }), listing)).toMatchObject({ quantityHere: 0, quantityElsewhere: 0, activate: false, setPrice: null });
  });

  test("the price is written only when the listing has drifted", () => {
    expect(planPush(record("R-1", { price: 1100 }), listing)).toMatchObject({ setPrice: 1100, summary: "quantity 1 here, 0 at the other warehouse, listing active, price 1000 to 1100" });
    expect(planPush(record("R-1", { price: 1000 + DEMO_SETTINGS.storefront.priceTolerance }), listing).setPrice).toBeNull();
    expect(planPush(record("R-1", { price: null }), listing).setPrice).toBeNull();
    expect(planPush(record("R-1"), { ...listing, price: null }).setPrice).toBe(1000);
  });

  test("a throttled call waits longer on each attempt and then gives up", () => {
    const { maxAttempts, throttleWaitMs: base } = DEMO_SETTINGS.storefront;
    expect(throttleWaitMs(1)).toBe(base);
    expect(throttleWaitMs(2)).toBe(base * 2);
    expect(throttleWaitMs(maxAttempts - 1)).toBe(base * (maxAttempts - 1));
    expect(throttleWaitMs(maxAttempts)).toBeNull();
  });
});

describe("the demo's settings", () => {
  test("are kept in one object", () => {
    expect(Object.keys(DEMO_SETTINGS)).toEqual(["upload", "parse", "inventory", "ready", "queue", "storefront", "protectedStatuses", "bookkeeperFields"]);
  });
});
