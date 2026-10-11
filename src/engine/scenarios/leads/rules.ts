/**
 * Matching rules of the lead discovery and enrichment engine, re-implemented
 * from its Python source.
 *
 * Every function mirrors one in the public repository and names the file and
 * lines it follows. The thresholds in LEADS_SETTINGS are the repository's own:
 * the code is public, so nothing here is invented except the data the demo
 * feeds in. No function reads a clock, a network or a random source. Where the
 * Python sleeps for a random time, the settings keep the range and the
 * scenario uses its middle.
 *
 * Fidelity: the text functions behave exactly like the Python ones for ASCII
 * input, which is all the demo accepts. Python's regular expressions treat
 * accented letters as word characters and JavaScript's do not, so the two
 * could differ on other alphabets.
 */

/** electrical_enrichment.py:76-86, victoria_builders_scraper.py:115, run_watchdog.py:27-29 */
export const LEADS_SETTINGS = {
  gate: {
    /** How many listings are inspected for one record. */
    candidatesPerRecord: 3,
    /** Name score for a confident match. */
    matchHigh: 0.85,
    /** Name score for a probable match. */
    matchProb: 0.68,
    /** Name score accepted without a confirmed location. */
    nameExact: 0.97,
    /** Two scores this close count as a near tie when the best candidate is picked. */
    nearTie: 0.05,
  },
  run: {
    /** RETRY_COUNT is 2, and the loop runs RETRY_COUNT + 1 times. */
    navigationAttempts: 3,
    /** Seconds waited after a blocked attempt, and after a failed one. The source draws near these ranges and can run slightly over the top. */
    blockedWaitSeconds: [10, 20],
    failedWaitSeconds: [4, 8],
    /** The browser is rebuilt after this many records. */
    restartBrowserEvery: 80,
    /** Consecutive blocked records before the browser is rebuilt and the run pauses. */
    blockStormLimit: 5,
    blockStormPauseSeconds: [90, 180],
    /** Pause after a pass that saved nothing, and how many such passes end the run. */
    deadPassPauseSeconds: [300, 420],
    maxDeadPasses: 4,
    /** The outer watchdog. */
    watchdogBackoffSeconds: 15,
    watchdogStallBackoffSeconds: 120,
    watchdogMaxStalled: 12,
  },
} as const;

/** The middle of a [low, high] range: what the simulation uses where the source draws at random. */
export function middle(range: readonly number[]): number {
  return (range[0] + range[1]) / 2;
}

// ---------------------------------------------------------------------------
// difflib.SequenceMatcher(None, a, b).ratio(), as CPython implements it
// (Lib/difflib.py). electrical_enrichment.py:32, 204
// ---------------------------------------------------------------------------

export interface MatchBlock {
  /** Start in the first string. */
  a: number;
  /** Start in the second string. */
  b: number;
  size: number;
}

/**
 * Where each character of `b` occurs. With no junk function nothing is junk.
 * difflib's automatic heuristic still applies: when `b` has 200 characters or
 * more, a character that makes up more than 1% of it (plus one) is "popular"
 * and is left out of the index. Shorter strings, which is every business name,
 * keep every character.
 */
function indexSecond(b: string): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  for (let index = 0; index < b.length; index += 1) {
    const list = b2j.get(b[index]);
    if (list) list.push(index);
    else b2j.set(b[index], [index]);
  }
  if (b.length >= 200) {
    const limit = Math.floor(b.length / 100) + 1;
    const popular: string[] = [];
    for (const [character, positions] of b2j) if (positions.length > limit) popular.push(character);
    for (const character of popular) b2j.delete(character);
  }
  return b2j;
}

/** The longest block a[i:i+k] == b[j:j+k] inside the given windows; the earliest in `a`, then in `b`, wins a tie. */
function findLongestMatch(a: string, b: string, b2j: Map<string, number[]>, alo: number, ahi: number, blo: number, bhi: number): MatchBlock {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;
  // j2len.get(j) is the length of the longest match ending at a[i - 1] and b[j].
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i += 1) {
    const next = new Map<number, number>();
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      next.set(j, k);
      if (k > bestsize) {
        besti = i - k + 1;
        bestj = j - k + 1;
        bestsize = k;
      }
    }
    j2len = next;
  }
  // Popular characters are missing from the index, so the block is stretched
  // over them on both sides. difflib then stretches over junk as well; with no
  // junk function that second pair of loops can never run.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti -= 1;
    bestj -= 1;
    bestsize += 1;
  }
  while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize += 1;
  return { a: besti, b: bestj, size: bestsize };
}

/**
 * The Ratcliff/Obershelp matching blocks: the longest common block, then the
 * same again to its left and to its right. difflib also appends an empty
 * closing block, which adds nothing and is left out.
 */
export function matchingBlocks(a: string, b: string): MatchBlock[] {
  const b2j = indexSecond(b);
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  const found: MatchBlock[] = [];
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const block = findLongestMatch(a, b, b2j, alo, ahi, blo, bhi);
    if (block.size === 0) continue;
    found.push(block);
    if (alo < block.a && blo < block.b) queue.push([alo, block.a, blo, block.b]);
    if (block.a + block.size < ahi && block.b + block.size < bhi) queue.push([block.a + block.size, ahi, block.b + block.size, bhi]);
  }
  found.sort((left, right) => left.a - right.a || left.b - right.b || left.size - right.size);
  // Blocks that touch in both strings are one block.
  const blocks: MatchBlock[] = [];
  let current: MatchBlock | null = null;
  for (const block of found) {
    if (current && current.a + current.size === block.a && current.b + current.size === block.b) current.size += block.size;
    else {
      if (current) blocks.push(current);
      current = { ...block };
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Twice the matched characters over the total length; 1 for two empty strings. */
export function sequenceRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  const matched = matchingBlocks(a, b).reduce((sum, block) => sum + block.size, 0);
  return (2 * matched) / total;
}

/**
 * Python's round(value, 3). It rounds the exact value of the float, and an
 * exact tie goes to the even digit. toFixed rounds the exact value too but
 * sends a tie upwards, so ties are handled here. A float is exactly halfway
 * between two thousandths only when it is an odd number of sixteenths.
 */
export function roundHalfEven3(value: number): number {
  const sixteenths = value * 16;
  if (Number.isInteger(sixteenths) && Math.abs(sixteenths) % 2 === 1) {
    const lower = Math.floor(value * 1000);
    return (lower % 2 === 0 ? lower : lower + 1) / 1000;
  }
  return Number(value.toFixed(3));
}

// ---------------------------------------------------------------------------
// Names: electrical_enrichment.py:158-214
// ---------------------------------------------------------------------------

/** Legal suffixes and joining words removed before two names are compared. electrical_enrichment.py:159-161 */
const LEGAL = /\b(pty\.?\s*ltd\.?|p\/?l|proprietary|limited|ltd|inc|incorporated|the|and|&|t\/?a|trading\s+as)\b/gi;
const PUNCTUATION = /[^a-z0-9 ]+/g;
const WHITESPACE = /\s+/g;

/** Lower case, legal suffixes and punctuation removed, spaces collapsed. electrical_enrichment.py:166-171 */
export function normName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(LEGAL, " ").replace(PUNCTUATION, " ").replace(WHITESPACE, " ").trim();
}

/** Python's str.split() on a normalised string. */
export function words(value: string): string[] {
  return value.split(/\s+/).filter((word) => word !== "");
}

/** Words that say nothing about which business this is. electrical_enrichment.py:177-180 */
export const NAME_FILLER: ReadonlySet<string> = new Set([
  "electrical",
  "electrics",
  "electric",
  "electrician",
  "electricians",
  "pty",
  "ltd",
  "co",
  "company",
  "the",
  "and",
  "vic",
  "victoria",
  "australia",
]);

/** The distinctive words of a name. If removing the filler leaves nothing, every word counts. electrical_enrichment.py:183-187 */
export function coreTokens(tokens: readonly string[]): Set<string> {
  const core = tokens.filter((token) => !NAME_FILLER.has(token));
  return new Set(core.length > 0 ? core : tokens);
}

export interface NameScore {
  /** The two names after normalisation. */
  record: string;
  listing: string;
  /** SequenceMatcher ratio of the two normalised names. */
  sequence: number;
  /** Shared words over all words. */
  tokenOverlap: number;
  /** 0.45 x sequence + 0.55 x token overlap, before the boost. */
  blend: number;
  /** The licence's distinctive words, and those also found in the listing. */
  core: string[];
  shared: string[];
  /** Share of the licence's distinctive words found in the listing; null when the boost does not apply. */
  containment: number | null;
  /** 0.80 x containment + 0.20 x sequence; null when the boost does not apply. */
  boost: number | null;
  /** The larger of blend and boost, rounded to three places as Python rounds. */
  score: number;
}

/**
 * How alike a licence name and a listing name are, from 0 to 1.
 *
 * Two views, and the better one wins. The blend rewards names that are spelled
 * alike. The boost rewards a listing that contains the licence's distinctive
 * words, however many other words it adds. The boost is skipped when those
 * distinctive words are fewer than three characters in all.
 * electrical_enrichment.py:190-214
 */
export function scoreName(recordName: string, listingName: string): NameScore {
  const a = normName(recordName);
  const b = normName(listingName);
  if (!a || !b) return { record: a, listing: b, sequence: 0, tokenOverlap: 0, blend: 0, core: [], shared: [], containment: null, boost: null, score: 0 };

  const sequence = sequenceRatio(a, b);
  const wordsA = new Set(words(a));
  const wordsB = new Set(words(b));
  const common = [...wordsA].filter((word) => wordsB.has(word)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const tokenOverlap = common / Math.max(1, union);
  const blend = 0.45 * sequence + 0.55 * tokenOverlap;

  const coreA = coreTokens(words(a));
  const coreB = coreTokens(words(b));
  const shared = [...coreA].filter((word) => coreB.has(word));
  const anchorLength = [...coreA].reduce((sum, word) => sum + word.length, 0);
  let containment: number | null = null;
  let boost: number | null = null;
  let base = blend;
  if (shared.length > 0 && anchorLength >= 3) {
    containment = shared.length / Math.max(1, coreA.size);
    boost = 0.8 * containment + 0.2 * sequence;
    base = Math.max(base, boost);
  }
  return { record: a, listing: b, sequence, tokenOverlap, blend, core: [...coreA], shared, containment, boost, score: roundHalfEven3(base) };
}

export function nameScore(recordName: string, listingName: string): number {
  return scoreName(recordName, listingName).score;
}

// ---------------------------------------------------------------------------
// Location: electrical_enrichment.py:217-255
// ---------------------------------------------------------------------------

/** The licence's suburb or its postcode appears in the listing's address. electrical_enrichment.py:217-225 */
export function locationOk(suburb: string, postcode: string, listingAddress: string | null | undefined): boolean {
  const address = (listingAddress ?? "").toLowerCase();
  if (suburb && address.includes(suburb.trim().toLowerCase())) return true;
  const code = postcode ? postcode.trim() : "";
  return code !== "" && address.includes(code);
}

/** Unit and street-type words that identify nothing. electrical_enrichment.py:230-237 */
const ADDRESS_DROP: ReadonlySet<string> = new Set([
  "unit", "u", "suite", "ste", "factory", "office", "level", "lot", "shop",
  "po", "box", "warehouse", "rd", "road", "st", "street", "av", "ave",
  "avenue", "ct", "court", "dr", "drive", "cr", "cres", "crescent", "pl",
  "place", "bvd", "blvd", "boulevard", "hwy", "highway", "tce", "terrace",
  "lane", "ln", "way", "pde", "parade", "cct", "circuit", "gr", "grove",
  "sq", "square", "cl", "close", "point", "rise", "promenade",
]);

const ALL_DIGITS = /^[0-9]+$/;

/**
 * The words of an address that are longer than two characters, are not numbers
 * and are not unit or street-type words. Note that this is every such word of
 * the address, so a listing's suburb and state are among them.
 * electrical_enrichment.py:240-242
 */
export function streetWords(address: string | null | undefined): Set<string> {
  const tokens = words((address ?? "").toLowerCase().replace(PUNCTUATION, " "));
  return new Set(tokens.filter((token) => !ADDRESS_DROP.has(token) && !ALL_DIGITS.test(token) && token.length > 2));
}

/**
 * true: a word of the licence's street address appears in the listing's address.
 * false: both have such words and share none.
 * null: one side has none, so nothing can be said.
 * electrical_enrichment.py:245-255
 */
export function streetMatch(licenceAddress: string | null | undefined, listingAddress: string | null | undefined): boolean | null {
  const licence = streetWords(licenceAddress);
  const listing = streetWords(listingAddress);
  if (licence.size === 0 || listing.size === 0) return null;
  return [...licence].some((word) => listing.has(word));
}

// ---------------------------------------------------------------------------
// Results that are not businesses: electrical_enrichment.py:258-290
// ---------------------------------------------------------------------------

/** The map answered with the suburb or the state itself, which it does when the business has no listing. electrical_enrichment.py:258-272 */
export function isPlaceResult(listingName: string, record: { suburb: string; state: string }): boolean {
  const name = normName(listingName);
  if (!name) return true;
  return [record.suburb, record.state, "victoria", "australia"].some((token) => Boolean(token) && normName(token) === name);
}

/** electrical_enrichment.py:276-281 */
const STREET_SUFFIX: ReadonlySet<string> = new Set([
  "rd", "road", "st", "street", "av", "ave", "avenue", "ct", "court", "dr",
  "drive", "cr", "cres", "crescent", "pl", "place", "bvd", "blvd", "boulevard",
  "hwy", "highway", "tce", "terrace", "lane", "ln", "way", "pde", "parade",
  "cct", "circuit", "gr", "grove", "sq", "square", "cl", "close", "row",
]);

/** A "name" that is a street address: a number first and a street-type word last. electrical_enrichment.py:284-290 */
export function looksLikeStreetAddress(listingName: string): boolean {
  const tokens = words(normName(listingName));
  return tokens.length >= 2 && ALL_DIGITS.test(tokens[0]) && STREET_SUFFIX.has(tokens[tokens.length - 1]);
}

// ---------------------------------------------------------------------------
// Decision: electrical_enrichment.py:104-124, 293-321
// ---------------------------------------------------------------------------

export const MATCH_STATUSES = [
  "Matched (High)",
  "Probable Match",
  "Name Match / Location Mismatch",
  "Low Confidence (location unconfirmed)",
  "No Match",
  "Blocked",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * Match status from the name score and the two location signals.
 * `street` is the three-valued verdict of streetMatch.
 * electrical_enrichment.py:293-321
 */
export function decideStatus(score: number, locOk: boolean, street: boolean | null, hadCandidate: boolean, gate: typeof LEADS_SETTINGS.gate = LEADS_SETTINGS.gate): MatchStatus {
  if (!hadCandidate) return "No Match";
  const confirmed = locOk || street === true;
  const contradicted = street === false && !locOk;

  if (confirmed && score >= gate.matchHigh) return "Matched (High)";
  if (confirmed && score >= gate.matchProb) return "Probable Match";
  // A near-exact name with no confirmed location is trusted unless the street contradicts it.
  if (score >= gate.nameExact) return contradicted ? "Name Match / Location Mismatch" : "Matched (High)";
  if (score >= gate.matchHigh) return "Name Match / Location Mismatch";
  if (score >= gate.matchProb) return "Low Confidence (location unconfirmed)";
  return "No Match";
}

export type ContactConfidence = "Verified" | "Candidate Only" | "None";

const VERIFIED_STATUSES: ReadonlySet<string> = new Set(["Matched (High)", "Probable Match"]);
const CANDIDATE_ONLY_STATUSES: ReadonlySet<string> = new Set(["Low Confidence (location unconfirmed)", "Name Match / Location Mismatch"]);

/** How far the contact details of a row may be trusted, from its status alone. electrical_enrichment.py:113-124 */
export function contactConfidence(status: string): ContactConfidence {
  if (VERIFIED_STATUSES.has(status)) return "Verified";
  if (CANDIDATE_ONLY_STATUSES.has(status)) return "Candidate Only";
  return "None";
}

// ---------------------------------------------------------------------------
// The output row and its guard: electrical_enrichment.py:88-102, 127-156
// ---------------------------------------------------------------------------

/** The source's columns, in its order. One is renamed: the source's link column names the map provider, and "Map Link" here does not. */
export const OUTPUT_COLUMNS = [
  "License No", "Business Name", "Suburb", "State", "Postcode",
  "Candidate Name", "Candidate Phone", "Candidate Website", "Candidate Address", "Candidate Match Score",
  "Phone (Verified)", "Website (Verified)", "Email (Verified)",
  "Map Link", "Match Status", "Match Score",
  "Contact Confidence", "Email Status", "Notes",
] as const;
export type OutputColumn = (typeof OUTPUT_COLUMNS)[number];
export type OutputRow = Record<OutputColumn, string | number>;

/** The three columns that must never hold an unverified candidate's details. */
export const VERIFIED_FIELDS = ["Phone (Verified)", "Website (Verified)", "Email (Verified)"] as const;

export interface LicenceRecord {
  licence: string;
  name: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
}

/** A row with the identity columns filled and everything else empty. electrical_enrichment.py:463-468 */
export function blankRow(record: LicenceRecord): OutputRow {
  const row = Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, ""])) as OutputRow;
  row["License No"] = record.licence;
  row["Business Name"] = record.name;
  row["Suburb"] = record.suburb;
  row["State"] = record.state;
  row["Postcode"] = record.postcode;
  return row;
}

/**
 * The guard the source calls RULE 7. It derives the confidence from the
 * status, empties the verified columns unless the confidence is Verified, and
 * only then asserts. Because the emptying comes first, the assertions cannot
 * fail for any status the matcher produces; they would only catch a status
 * renamed without its mapping. The guard prevents a leak. It does not measure
 * whether a match was right. Returns a new row; the Python changes the row in
 * place.
 * electrical_enrichment.py:127-156
 */
export function enforceAndValidate(row: OutputRow): OutputRow {
  const status = String(row["Match Status"] ?? "").trim();
  const confidence = contactConfidence(status);
  const out: OutputRow = { ...row, "Contact Confidence": confidence };
  if (confidence !== "Verified") for (const field of VERIFIED_FIELDS) out[field] = "";

  const violation = (message: string): never => {
    throw new Error(`RULE 7: ${message}`);
  };
  if (status === "No Match") {
    if (out["Phone (Verified)"]) violation("No Match leaked a verified phone");
    if (out["Website (Verified)"]) violation("No Match leaked a verified website");
    if (out["Email (Verified)"]) violation("No Match leaked a verified email");
  }
  if (status.startsWith("Low Confidence") && out["Contact Confidence"] !== "Candidate Only") violation("Low Confidence must be Candidate Only");
  if (status === "Matched (High)" && out["Contact Confidence"] !== "Verified") violation("Matched (High) must be Verified");
  return out;
}

// ---------------------------------------------------------------------------
// One record: electrical_enrichment.py:470-472, 511-590
// ---------------------------------------------------------------------------

/** The search text for one record. electrical_enrichment.py:470-471 */
export function searchQuery(record: Pick<LicenceRecord, "name" | "suburb" | "state">): string {
  const place = [record.suburb, record.state].filter((part) => part !== "").join(" ");
  return `${record.name} ${place} Australia`.trim();
}

/**
 * What a record is marked as when no results panel appeared. Only an error
 * that mentions a block is treated as temporary; a navigation error or a
 * missing panel becomes a final No Match.
 * electrical_enrichment.py:511-514
 */
export function statusWithoutPanel(lastError: string): "Blocked" | "No Match" {
  return lastError.includes("block") ? "Blocked" : "No Match";
}

export interface Listing {
  name: string;
  phone: string;
  website: string;
  address: string;
  link: string;
}

export interface Inspection {
  /** Position on the results panel, from 1. */
  position: number;
  listing: Listing;
  /** Why the result was passed over, or null when it was scored. */
  skipped: "no name" | "place" | "street address" | null;
  name: NameScore | null;
  locOk: boolean;
  street: boolean | null;
  confirmed: boolean;
  /** Why this candidate became the best so far, or null when the earlier best was kept. */
  becameBest: "first" | "higher score" | "confirmed near tie" | null;
  /** True when the loop ended after this candidate. */
  stoppedAfter: boolean;
}

interface Scored {
  score: number;
  locOk: boolean;
  street: boolean | null;
}

/**
 * Whether a candidate replaces the best so far: the first one does, a score
 * more than 0.05 higher does, and a location-confirmed candidate within 0.05
 * of an unconfirmed best does. electrical_enrichment.py:545-549
 */
export function replacesBest(best: Scored | null, next: Scored, gate: typeof LEADS_SETTINGS.gate = LEADS_SETTINGS.gate): Inspection["becameBest"] {
  if (best === null) return "first";
  if (next.score > best.score + gate.nearTie) return "higher score";
  const confirmed = next.locOk || next.street === true;
  const bestConfirmed = best.locOk || best.street === true;
  if (confirmed && next.score >= best.score - gate.nearTie && !bestConfirmed) return "confirmed near tie";
  return null;
}

/**
 * The candidate loop: at most three results are opened, places and bare
 * street addresses without contact details are passed over, each remaining one
 * is scored, and the loop stops at the first confident, location-confirmed
 * candidate. electrical_enrichment.py:516-552
 */
export function inspectCandidates(record: LicenceRecord, results: readonly Listing[], gate: typeof LEADS_SETTINGS.gate = LEADS_SETTINGS.gate): { inspections: Inspection[]; best: Inspection | null } {
  const inspections: Inspection[] = [];
  let best: Inspection | null = null;
  const links = results.slice(0, gate.candidatesPerRecord);
  for (const [index, listing] of links.entries()) {
    const skip = (reason: NonNullable<Inspection["skipped"]>): void => {
      inspections.push({ position: index + 1, listing, skipped: reason, name: null, locOk: false, street: null, confirmed: false, becameBest: null, stoppedAfter: false });
    };
    if (!listing.name) {
      skip("no name");
      continue;
    }
    if (isPlaceResult(listing.name, record)) {
      skip("place");
      continue;
    }
    if (looksLikeStreetAddress(listing.name) && !listing.phone && !listing.website) {
      skip("street address");
      continue;
    }
    const name = scoreName(record.name, listing.name);
    const locOk = locationOk(record.suburb, record.postcode, listing.address);
    const street = streetMatch(record.address, listing.address);
    const confirmed = locOk || street === true;
    const becameBest = replacesBest(best && { score: best.name!.score, locOk: best.locOk, street: best.street }, { score: name.score, locOk, street }, gate);
    const stoppedAfter = name.score >= gate.matchHigh && confirmed;
    const inspection: Inspection = { position: index + 1, listing, skipped: null, name, locOk, street, confirmed, becameBest, stoppedAfter };
    inspections.push(inspection);
    if (becameBest) best = inspection;
    if (stoppedAfter) break;
  }
  return { inspections, best };
}

/**
 * Fills the row from the best candidate. What the map returned is always
 * recorded in the candidate columns. The phone and website are copied to the
 * verified columns only for a Verified match. electrical_enrichment.py:559-587
 */
export function fillRow(row: OutputRow, best: Inspection, status: MatchStatus): OutputRow {
  const confidence = contactConfidence(status);
  const out: OutputRow = { ...row };
  out["Candidate Name"] = best.listing.name;
  out["Candidate Phone"] = best.listing.phone;
  out["Candidate Website"] = best.listing.website;
  out["Candidate Address"] = best.listing.address;
  out["Candidate Match Score"] = best.name!.score;
  out["Map Link"] = best.listing.link;
  out["Match Status"] = status;
  out["Match Score"] = best.name!.score;
  out["Contact Confidence"] = confidence;
  if (confidence === "Verified") {
    out["Phone (Verified)"] = best.listing.phone;
    out["Website (Verified)"] = best.listing.website;
    if (!best.listing.website) out["Email Status"] = "No Website";
  } else {
    out["Email Status"] = "Skipped (unverified match)";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Email: electrical_enrichment.py:339-345, 368-429; victoria_builders_scraper.py:653-661, 862-867
// ---------------------------------------------------------------------------

/** victoria_builders_scraper.py:653-661 */
export function cleanUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The host of an address without a leading "www.". victoria_builders_scraper.py:862-867 */
export function domainOf(url: string): string {
  const host = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url)?.[1] ?? "").toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** An address on the website's own domain is preferred; otherwise the first one found. electrical_enrichment.py:339-345 */
export function pickEmail(emails: readonly string[], url: string): string {
  const domain = domainOf(url);
  for (const email of emails) {
    if (domain && email.split("@").at(-1)!.toLowerCase().endsWith(domain)) return email;
  }
  return emails[0];
}

/** A website as the simulation sees it: whether each scheme answers, and which addresses each page shows. */
export interface SimulatedSite {
  /** A social network or a listing aggregator; such hosts are never fetched. */
  skipDomain: boolean;
  answers: { https: boolean; http: boolean };
  homepageEmails: string[];
  /** Addresses on each contact page, in the order the pages would be followed. */
  contactPageEmails: string[][];
  /** An address that only appears once a real browser has rendered the page; empty when there is none. */
  renderedEmail: string;
}

export interface EmailResult {
  email: string;
  status: "Found" | "Found (JS)" | "Not Found" | "No Website" | "Skipped (Domain)" | "Site Error";
  note: string;
  /** HTTP requests the pass would have made. */
  requests: number;
}

/**
 * The email pass for one website: both schemes with one retry each, then up to
 * three contact pages, then a rendered page for a site that answered but
 * showed no address. A host that never answers is a Site Error. The source
 * also sends a response that refuses the request to the rendered-page step;
 * that branch is not modelled. Nothing here checks that an address can receive
 * mail, and neither does the source. electrical_enrichment.py:368-429
 */
export function chaseEmail(website: string, site: SimulatedSite): EmailResult {
  if (!website) return { email: "", status: "No Website", note: "no website on listing", requests: 0 };
  const base = cleanUrl(website);
  if (site.skipDomain) return { email: "", status: "Skipped (Domain)", note: "social/aggregator domain", requests: 0 };

  const variants = [base];
  if (base.toLowerCase().startsWith("http://")) variants.push(`https://${base.slice(7)}`);
  else if (base.toLowerCase().startsWith("https://")) variants.push(`http://${base.slice(8)}`);

  let requests = 0;
  let reachable = false;
  for (const url of variants) {
    const answered = url.toLowerCase().startsWith("https://") ? site.answers.https : site.answers.http;
    if (!answered) {
      requests += 2; // the request and its one retry
      continue;
    }
    requests += 1;
    reachable = true;
    if (site.homepageEmails.length > 0) return { email: pickEmail(site.homepageEmails, url), status: "Found", note: "homepage", requests };
    for (const page of site.contactPageEmails.slice(0, 3)) {
      requests += 1;
      if (page.length > 0) return { email: pickEmail(page, url), status: "Found", note: "contact page", requests };
    }
    break;
  }
  if (reachable) {
    if (site.renderedEmail) return { email: site.renderedEmail, status: "Found (JS)", note: "selenium fallback", requests };
    return { email: "", status: "Not Found", note: "no email on homepage or contact pages", requests };
  }
  return { email: "", status: "Site Error", note: "site not reachable", requests };
}

// ---------------------------------------------------------------------------
// The run: electrical_enrichment.py:593-627, 693-711; clean_retry.py:42-54; run_watchdog.py:83-109
// ---------------------------------------------------------------------------

/** electrical_enrichment.py:596-602 */
const BUSINESS_TOKENS: ReadonlySet<string> = new Set([
  "electric", "electrics", "electrical", "electrician", "electricians",
  "pty", "ltd", "group", "services", "service", "solutions", "solar", "co",
  "company", "contractors", "contracting", "industries", "enterprises",
  "systems", "air", "data", "power", "installations", "maintenance",
  "trades", "projects", "technologies", "security", "communications",
]);

/** Business-like names are processed first, so the most useful rows are saved first. electrical_enrichment.py:605-610, 737-739 */
export function looksLikeBusiness(name: string): boolean {
  if (words(normName(name)).some((token) => BUSINESS_TOKENS.has(token))) return true;
  return /[0-9]/.test(name) || name.includes("&");
}

export type SavedRow = Pick<OutputRow, "License No" | "Match Status">;

/**
 * The licences a restarted run skips: every one already in the output file,
 * unless its row is marked Blocked. The output file is the only checkpoint.
 * electrical_enrichment.py:613-627
 */
export function doneLicences(rows: readonly SavedRow[]): Set<string> {
  const done = new Set<string>();
  for (const row of rows) {
    const licence = String(row["License No"] ?? "").trim();
    if (licence && String(row["Match Status"] ?? "").trim() !== "Blocked") done.add(licence);
  }
  return done;
}

/** A row is appended unless the lookup produced nothing or was blocked. electrical_enrichment.py:693-711 */
export function isSaved(row: Pick<OutputRow, "Match Status"> | null): boolean {
  return row !== null && row["Match Status"] !== "Blocked";
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "No Match",
  "Matched (High)",
  "Probable Match",
  "Name Match / Location Mismatch",
  "Low Confidence (location unconfirmed)",
]);

/**
 * Whether the clean-up script, run by hand, would send a row back to be looked
 * up again. A No Match is kept whatever caused it. clean_retry.py:42-54
 */
export function cleanRetryWouldRequeue(row: SavedRow): boolean {
  const licence = String(row["License No"] ?? "").trim();
  const status = String(row["Match Status"] ?? "").trim();
  return !licence || !TERMINAL_STATUSES.has(status);
}

/**
 * The outer watchdog after one launch of the enrichment process has exited
 * with work left: a launch that saved nothing counts as stalled, twelve
 * stalled launches in a row end it, and the pause before the next launch is
 * longer while stalled. run_watchdog.py:83-109
 */
export function watchdogNext(stalledBefore: number, gained: number, run: typeof LEADS_SETTINGS.run = LEADS_SETTINGS.run): { stalled: number; giveUp: boolean; pauseSeconds: number } {
  const stalled = gained === 0 ? stalledBefore + 1 : 0;
  return { stalled, giveUp: stalled >= run.watchdogMaxStalled, pauseSeconds: stalled > 0 ? run.watchdogStallBackoffSeconds : run.watchdogBackoffSeconds };
}
