import type { Scenario, ScenarioContext } from "../../session";
import type { Json } from "../../types";
import {
  LEADS_SETTINGS,
  VERIFIED_FIELDS,
  blankRow,
  chaseEmail,
  cleanUrl,
  contactConfidence,
  coreTokens,
  decideStatus,
  domainOf,
  doneLicences,
  enforceAndValidate,
  fillRow,
  inspectCandidates,
  isSaved,
  looksLikeBusiness,
  middle,
  normName,
  roundHalfEven3,
  searchQuery,
  statusWithoutPanel,
  watchdogNext,
  words,
  type Inspection,
  type LicenceRecord,
  type Listing,
  type MatchStatus,
  type OutputRow,
  type SavedRow,
  type SimulatedSite,
} from "./rules";

export const LEADS_SCENARIO_ID = "leads.licence-to-contact";

export const LEADS_STEPS = [
  "record.read",
  "resume.check",
  "name.normalise",
  "maps.search",
  "candidates.read",
  "candidates.score",
  "candidate.pick",
  "status.decide",
  "confidence.derive",
  "email.chase",
  "guard.enforce",
  "row.append",
] as const;

export const LEADS_FAULTS = [
  "already-done",
  "lookup-blocked",
  "session-dead",
  "place-result",
  "hidden-address",
  "leaky-promotion",
  "site-unreachable",
  "dead-mailbox",
  "process-killed",
] as const;

export type LeadsFaultId = (typeof LEADS_FAULTS)[number];

export const MAP_SHOWS = ["at the licence address", "same suburb, another street", "another suburb", "another suburb, same street name", "not listed"] as const;
export type MapShows = (typeof MAP_SHOWS)[number];

export const FIRST_RESULTS = ["an unrelated business", "the same name in another suburb"] as const;
export type FirstResult = (typeof FIRST_RESULTS)[number];

export interface LeadsInput {
  /** The business name as the licence register has it. */
  licenceName: string;
  /** The name of the closest listing on the map. Ignored when the business is not listed. */
  listingName: string;
  /** Where the map places that listing, relative to the licence's own address. */
  mapShows: MapShows;
  /** What the map puts first. Ignored when the business is not listed. */
  firstResult: FirstResult;
}

export const LEADS_PRESETS: { id: string; label: string; description: string; input: LeadsInput }[] = [
  {
    id: "verified",
    label: "A clear match",
    description: "The listing carries the licence's name at the licence's address. The phone and website are verified and an email is looked up.",
    input: { licenceName: "Tallowmere Electrical Pty Ltd", listingName: "Tallowmere Electrical", mapShows: "at the licence address", firstResult: "an unrelated business" },
  },
  {
    id: "probable",
    label: "A probable match",
    description: "The listing drops one word of the name and sits on another street of the same suburb. Verified, one tier down.",
    input: { licenceName: "Tallowmere Ridge Electrical Pty Ltd", listingName: "Tallowmere Electrical", mapShows: "same suburb, another street", firstResult: "an unrelated business" },
  },
  {
    id: "wrong-suburb",
    label: "Right name, wrong suburb",
    description: "The same name is listed in another town. Its phone number is kept for review and withheld from the verified columns.",
    input: { licenceName: "Tallowmere Electrical Pty Ltd", listingName: "Tallowmere Electrical", mapShows: "another suburb", firstResult: "an unrelated business" },
  },
  {
    id: "low-confidence",
    label: "Low confidence",
    description: "A partial name in another suburb. Recorded as a candidate, nothing verified, no website visited.",
    input: { licenceName: "Tallowmere Ridge Electrical Pty Ltd", listingName: "Tallowmere Electrical", mapShows: "another suburb", firstResult: "an unrelated business" },
  },
  {
    id: "not-listed",
    label: "Not on the map",
    description: "A sole trader with no listing: the map answers with the suburb itself. The run ends early with No Match and empty contact columns.",
    input: { licenceName: "M T Yarrowick", listingName: "M T Yarrowick", mapShows: "not listed", firstResult: "an unrelated business" },
  },
  {
    id: "namesake",
    label: "A namesake nearby",
    description: "A different firm in the same suburb shares the licence's one distinctive word. The gate verifies it: a weakness of the scoring, shown as it is.",
    input: { licenceName: "Quorrin Electrical Pty Ltd", listingName: "Quorrin & Sons Electrical Services", mapShows: "same suburb, another street", firstResult: "an unrelated business" },
  },
];

export const LEADS_DEFAULT_INPUT: LeadsInput = LEADS_PRESETS[0].input;

const NAME_MAX_LENGTH = 60;
/** ASCII only: the text rules match the Python source exactly on these characters. */
const NAME_CHARACTERS = /^[A-Za-z0-9 &.,'/()-]+$/;

function checkName(raw: unknown): { value: string | null; error: string | null } {
  if (typeof raw !== "string" || raw.trim() === "") return { value: null, error: "Enter a business name." };
  const value = raw.trim().replace(/ {2,}/g, " ");
  if (value.length < 2 || value.length > NAME_MAX_LENGTH) return { value: null, error: `Use 2 to ${NAME_MAX_LENGTH} characters.` };
  if (!NAME_CHARACTERS.test(value)) return { value: null, error: "Use letters, digits, spaces and & . , ' / ( ) - only." };
  if (!/[A-Za-z0-9]/.test(value)) return { value: null, error: "Include at least one letter or digit." };
  return { value, error: null };
}

export function validateLeadsInput(raw: Partial<Record<keyof LeadsInput, unknown>>): {
  ok: boolean;
  value: LeadsInput;
  errors: Partial<Record<keyof LeadsInput, string>>;
} {
  const errors: Partial<Record<keyof LeadsInput, string>> = {};
  const licence = checkName(raw.licenceName);
  if (licence.error) errors.licenceName = licence.error;
  const listing = checkName(raw.listingName);
  if (listing.error) errors.listingName = listing.error;
  const mapShows = MAP_SHOWS.includes(raw.mapShows as MapShows) ? (raw.mapShows as MapShows) : null;
  if (!mapShows) errors.mapShows = "Choose one of the listed places.";
  const firstResult = FIRST_RESULTS.includes(raw.firstResult as FirstResult) ? (raw.firstResult as FirstResult) : null;
  if (!firstResult) errors.firstResult = "Choose one of the listed results.";

  return {
    ok: Object.keys(errors).length === 0,
    value: {
      licenceName: licence.value ?? LEADS_DEFAULT_INPUT.licenceName,
      listingName: listing.value ?? LEADS_DEFAULT_INPUT.listingName,
      mapShows: mapShows ?? LEADS_DEFAULT_INPUT.mapShows,
      firstResult: firstResult ?? LEADS_DEFAULT_INPUT.firstResult,
    },
    errors,
  };
}

// -- Invented world ----------------------------------------------------------

/** An invented licence record. The number is not in the register's format and the address does not exist. */
export const DEMO_RECORD = { licence: "DEMO-00417", address: "27 Wattlebird Road", suburb: "Northfield", state: "VIC", postcode: "3999" } as const;

/** Rows a run would already have written. Invented. */
const PRIOR_ROWS: SavedRow[] = [
  { "License No": "DEMO-00398", "Match Status": "Matched (High)" },
  { "License No": "DEMO-00402", "Match Status": "No Match" },
];

const MAPS_HOST = "https://maps.example.test/place";

const LISTING_ADDRESS: Record<Exclude<MapShows, "not listed">, string> = {
  "at the licence address": "27 Wattlebird Rd, Northfield VIC 3999",
  "same suburb, another street": "3 Quarry Ct, Northfield VIC 3999",
  "another suburb": "88 Foundry St, Southport VIC 3998",
  "another suburb, same street name": "5 Wattlebird Rd, Southport VIC 3998",
};

const UNRELATED_FIRST: Listing = {
  name: "Hallowick Trade Supplies",
  phone: "03 5550 0107",
  website: "https://hallowick-trade.example.test",
  address: "2 Depot Rd, Northfield VIC 3999",
  link: `${MAPS_HOST}/hallowick-trade-supplies`,
};

const UNRELATED_LAST: Listing = {
  name: "Pellbrook Air & Solar",
  phone: "03 5550 0163",
  website: "",
  address: "40 Canal St, Southport VIC 3998",
  link: `${MAPS_HOST}/pellbrook-air-solar`,
};

/** What the map returns for a business it does not know: the suburb itself. */
const SUBURB_PLACE: Listing = { name: DEMO_RECORD.suburb, phone: "", website: "", address: "Northfield VIC 3999", link: `${MAPS_HOST}/northfield` };

export const LISTING_PHONE = "03 5550 0142";
const RIVAL_PHONE = "03 5550 0188";

function slugOf(name: string): string {
  return words(normName(name)).join("-") || "listing";
}

/** The results panel for one search, in the order the map shows them. */
function buildResults(input: LeadsInput, faults: ReadonlySet<string>): Listing[] {
  if (input.mapShows === "not listed") return [SUBURB_PLACE];
  const slug = slugOf(input.listingName);
  const listing: Listing = {
    name: input.listingName,
    phone: LISTING_PHONE,
    website: `https://${slug}.example.test`,
    address: faults.has("hidden-address") ? "" : LISTING_ADDRESS[input.mapShows],
    link: `${MAPS_HOST}/${slug}`,
  };
  const first: Listing =
    input.firstResult === "the same name in another suburb"
      ? { name: input.listingName, phone: RIVAL_PHONE, website: `https://${slug}-eastbrook.example.test`, address: "9 Mill Lane, Eastbrook VIC 3997", link: `${MAPS_HOST}/${slug}-eastbrook` }
      : UNRELATED_FIRST;
  const results = [first, listing, UNRELATED_LAST];
  if (faults.has("place-result")) results.unshift(SUBURB_PLACE);
  return results;
}

function buildSite(website: string, faults: ReadonlySet<string>): SimulatedSite {
  const up = !faults.has("site-unreachable");
  return { skipDomain: false, answers: { https: up, http: up }, homepageEmails: [`info@${domainOf(cleanUrl(website))}`], contactPageEmails: [], renderedEmail: "" };
}

const SECOND = 1000;
const { gate: GATE, run: LIMITS } = LEADS_SETTINGS;

/** The middle of a range of seconds, as whole milliseconds. */
const seconds = (range: readonly number[]) => Math.round(middle(range) * SECOND);

/**
 * Simulated durations in milliseconds. Where the source sleeps for a random
 * time the middle of its range is used; the rest are invented round numbers.
 */
const LATENCY = {
  file: 20,
  pageLoad: 1_800,
  render: seconds([1.5, 2.5]),
  blockedWait: seconds(LIMITS.blockedWaitSeconds),
  failedWait: seconds(LIMITS.failedWaitSeconds),
  scroll: seconds([1.0, 1.8]),
  openListing: 2_000,
  betweenListings: seconds([0.8, 1.6]),
  compute: 2,
  httpRequest: 700,
  httpTimeout: 15 * SECOND,
  write: 15,
} as const;

function snap<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/** The columns of a row that hold something, for display. */
function filled(row: OutputRow): Json {
  return snap(Object.fromEntries(Object.entries(row).filter(([, value]) => value !== "")));
}

function verifiedColumns(row: OutputRow): Json {
  return snap(Object.fromEntries(VERIFIED_FIELDS.map((field) => [field, row[field]])));
}

const three = (value: number) => roundHalfEven3(value);

function listOf(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function streetLabel(street: boolean | null): string {
  return street === true ? "shares a street word" : street === false ? "different street" : "unknown";
}

/** Why the status is what it is, in the order the source tests it. */
function explainStatus(best: Inspection, status: MatchStatus): string {
  const score = best.name!.score;
  const contradicted = best.street === false && !best.locOk;
  if (best.confirmed && score >= GATE.matchHigh) return `The location is confirmed and the name scores at least ${GATE.matchHigh}: ${status}.`;
  if (best.confirmed && score >= GATE.matchProb) return `The location is confirmed and the name scores at least ${GATE.matchProb}, under ${GATE.matchHigh}: ${status}.`;
  if (score >= GATE.nameExact) {
    return contradicted
      ? `The name is near exact, but the street is a different one and neither the suburb nor the postcode appears in the address: ${status}, a tier kept for review.`
      : `The name scores at least ${GATE.nameExact} and nothing contradicts the location, because the listing shows no usable address. The source treats that as ${status}.`;
  }
  if (score >= GATE.matchHigh) return `The name scores at least ${GATE.matchHigh} but the location is not confirmed: ${status}.`;
  if (score >= GATE.matchProb) return `The name scores at least ${GATE.matchProb} and the location is not confirmed: ${status}.`;
  return `The name scores ${score}, under ${GATE.matchProb}: ${status}. The listing is still recorded as a candidate.`;
}

/** Reasons to doubt a Verified result, worked out from the same numbers the gate used. */
function cautions(best: Inspection, status: MatchStatus): string[] {
  if (contactConfidence(status) !== "Verified") return [];
  const found: string[] = [];
  const name = best.name!;
  const withoutBoost = decideStatus(three(name.blend), best.locOk, best.street, true);
  if (contactConfidence(withoutBoost) !== "Verified") {
    const one = name.shared.length === 1;
    found.push(
      `This match is verified only through the shared-word boost: the licence's distinctive ${one ? "word" : "words"} (${name.shared.join(", ")}) ${one ? "is" : "are"} in the listing's name. The plain comparison scores ${three(name.blend)}, which would be "${withoutBoost}". Any business that shares ${one ? "that word" : "those words"} scores the same way.`,
    );
  }
  if (!best.locOk && best.street === null) found.push("It is verified on the name alone: the listing showed no address, and an unknown location is not treated as a contradiction.");
  if (!best.locOk && best.street === true) found.push("The location was confirmed by one shared street word. Neither the suburb nor the postcode of the licence appears in the listing's address.");
  return found;
}

function* run({ input, faults, t }: ScenarioContext<LeadsInput>): Generator<void, void, string> {
  const record: LicenceRecord = { ...DEMO_RECORD, name: input.licenceName };

  // -- 1. The next record ------------------------------------------------------
  const businessLike = looksLikeBusiness(record.name);
  t.start("record.read", { file: "electrical_licenses.csv", order: "business-like names first" });
  t.advance(LATENCY.file);
  t.log("info", "This file is the output of the register harvest. The register sits behind a human check: a person completed it and ran the search, and the tool read the rows that were then on screen. It never attempts the check itself.");
  t.log("info", businessLike ? "The name looks like a business, so it is in the first part of the queue: the rows most likely to have a listing are saved first." : "The name looks like a person's, so it is queued after the business-like names.");
  t.ok(snap({ licence_no: record.licence, business_name: record.name, street_address: record.address, suburb: record.suburb, state: record.state, postcode: record.postcode }));

  // -- 2. Resume ---------------------------------------------------------------
  const saved: SavedRow[] = [...PRIOR_ROWS];
  if (faults.has("already-done")) saved.push({ "License No": record.licence, "Match Status": "Probable Match" });
  t.start("resume.check", { file: "electrical_enriched.csv", rows_on_disk: saved.length, rule: "any status except Blocked counts as done" });
  t.advance(LATENCY.file);
  const done = doneLicences(saved);
  if (done.has(record.licence)) {
    t.log("info", "The output file already has a row for this licence. The file is the only checkpoint: nothing else is remembered between runs.");
    t.ok({ already_done: true, finished_licences: done.size });
    t.skipRemaining("This licence was finished in an earlier run.");
    t.finish("success", `Skipped: licence ${record.licence} already has a row in the output file, so it is not looked up again. A restarted run continues exactly where the file ends.`, { written: false, reason: "already done" });
    return;
  }
  t.log("info", "No row for this licence yet. A row marked Blocked would not count as done and would be looked up again.");
  t.ok({ already_done: false, finished_licences: done.size });

  // -- 3. Normalise the name ---------------------------------------------------
  const normalised = normName(record.name);
  const core = [...coreTokens(words(normalised))];
  const query = searchQuery(record);
  t.start("name.normalise", { licence_name: record.name });
  t.advance(LATENCY.compute);
  if (!normalised) t.log("warn", "Nothing is left of this name once the legal words are removed, so every comparison will score 0.");
  else t.log("info", `Legal suffixes and punctuation are removed for the comparison. What identifies this business is ${core.length === 1 ? "one word" : `${core.length} words`}: ${core.join(", ")}. The search itself uses the name as the licence has it.`);
  t.ok({ normalised, distinctive_words: core, search_text: query });

  // -- 4. Search the map -------------------------------------------------------
  const lookupStartedAt = t.time;
  // A dead session fails before any page can come back, so it takes precedence over a block.
  const lookupFault = faults.has("session-dead") ? "session-dead" : faults.has("lookup-blocked") ? "lookup-blocked" : null;
  let row = blankRow(record);
  let best: Inspection | null = null;
  let status: MatchStatus = "No Match";
  let path: "search failed" | "no candidate" | "candidate" = "candidate";
  let emailNote = "";
  const doubts: string[] = [];
  let leakInjected = false;

  if (lookupFault) {
    path = "search failed";
    let lastError = "";
    for (let attempt = 1; attempt <= LIMITS.navigationAttempts; attempt += 1) {
      const last = attempt === LIMITS.navigationAttempts;
      t.start("maps.search", { search_text: query, attempt, of: LIMITS.navigationAttempts });
      if (lookupFault === "session-dead") {
        t.advance(200);
        lastError = "navigation failed: WebDriverException";
        t.log("error", `Attempt ${attempt}: the browser session is gone, so opening the search raised an error. Nothing on this path rebuilds the browser.`);
        if (last) {
          t.advance(LATENCY.failedWait);
          t.log("error", `No results panel after ${LIMITS.navigationAttempts} attempts. The status is chosen from the text of the last error: it does not mention a block, so the record becomes "No Match".`);
          t.fail("NAVIGATION_FAILED", `Opening the search raised a browser error on all ${LIMITS.navigationAttempts} attempts.`);
        } else {
          t.fail("NAVIGATION_FAILED", "Opening the search raised a browser error.", LATENCY.failedWait);
          t.advance(LATENCY.failedWait);
        }
      } else {
        t.advance(LATENCY.pageLoad + LATENCY.render);
        lastError = "blocked: unusual-traffic notice";
        t.log("warn", `Attempt ${attempt}: the page that came back is a block notice, not results. The tool does not attempt the check on it. It waits about ${LIMITS.blockedWaitSeconds[0]} to ${LIMITS.blockedWaitSeconds[1]} seconds.`);
        if (last) {
          t.advance(LATENCY.blockedWait);
          t.log("error", `Still blocked after ${LIMITS.navigationAttempts} attempts. The last error mentions a block, so the record is marked "Blocked" and the run moves on instead of looping.`);
          t.fail("BLOCKED", `The map blocked all ${LIMITS.navigationAttempts} attempts.`);
        } else {
          t.fail("BLOCKED", "The map answered with a block notice.", LATENCY.blockedWait);
          t.advance(LATENCY.blockedWait);
        }
      }
    }
    status = statusWithoutPanel(lastError);
    row = { ...row, "Match Status": status, Notes: lastError };
    const reason = "The search produced no results panel, so no listing was opened.";
    for (const step of ["candidates.read", "candidates.score", "candidate.pick", "status.decide"] as const) t.skip(step, reason);
    t.skip("confidence.derive", "No candidate exists. The guard derives the confidence on this path.");
    t.skip("email.chase", "No verified match, so no website is visited.");
  } else {
    const results = buildResults(input, faults);
    const toInspect = Math.min(results.length, GATE.candidatesPerRecord);
    t.start("maps.search", { search_text: query, attempt: 1, of: LIMITS.navigationAttempts });
    t.advance(LATENCY.pageLoad + LATENCY.render);
    t.log("info", "Before anything is read, the page is checked for signs that the site has blocked the session. None here, and the results panel is present.");
    t.advance(LATENCY.scroll * 2);
    t.ok({ results_on_panel: results.length, to_inspect: toInspect });

    // -- 5. Open the candidates --------------------------------------------------
    const inspection = inspectCandidates(record, results);
    const readable = inspection.inspections.filter((item) => item.skipped === null);
    const passedOver = inspection.inspections.filter((item) => item.skipped !== null);
    best = inspection.best;
    t.start("candidates.read", { at_most: GATE.candidatesPerRecord, opened: "one at a time, each scored before the next is opened" });
    for (const item of inspection.inspections) {
      t.advance(LATENCY.openListing);
      const label = `[${item.position}] "${item.listing.name}"`;
      if (item.skipped === "place") t.log("warn", `${label} is the suburb or the state itself, not a business. The map answers like this when a business has no listing. Passed over.`);
      else if (item.skipped === "street address") t.log("warn", `${label} is a street address with no phone and no website. Passed over.`);
      else if (item.skipped === "no name") t.log("warn", `[${item.position}] The page showed no business name. Passed over.`);
      else {
        t.log(item.listing.address ? "info" : "warn", `${label}: phone ${item.listing.phone || "none"}, website ${item.listing.website || "none"}, address ${item.listing.address || "not shown"}.`);
        if (!item.stoppedAfter) t.advance(LATENCY.betweenListings);
      }
    }
    const unopened = toInspect - inspection.inspections.length;
    if (unopened > 0) t.log("info", `${unopened} more result${unopened === 1 ? " was" : "s were"} never opened: the loop stops at the first confident, location-confirmed candidate.`);
    if (results.length > GATE.candidatesPerRecord) t.log("info", `The panel had ${results.length} results. Only the first ${GATE.candidatesPerRecord} are inspected, and a result that is passed over still uses one of those places.`);
    const readOutput = {
      opened: inspection.inspections.length,
      candidates: readable.map((item) => ({ position: item.position, name: item.listing.name, phone: item.listing.phone, website: item.listing.website, address: item.listing.address })),
      passed_over: passedOver.map((item) => ({ position: item.position, name: item.listing.name, because: item.skipped })),
    };

    if (!best) {
      path = "no candidate";
      status = "No Match";
      row = { ...row, "Match Status": status, Notes: "candidates found but none readable" };
      t.ok(snap(readOutput), "Nothing on the panel was a business.");
      const reason = "No result was a business, so there was nothing to score.";
      for (const step of ["candidates.score", "candidate.pick", "status.decide"] as const) t.skip(step, reason);
      t.skip("confidence.derive", "No candidate exists. The guard derives the confidence on this path.");
      t.skip("email.chase", "No verified match, so no website is visited.");
    } else {
      t.ok(snap(readOutput));

      // -- 6. Score each candidate ---------------------------------------------
      t.start("candidates.score", snap({ licence: { name: normalised, street_address: record.address, suburb: record.suburb, postcode: record.postcode }, thresholds: { high: GATE.matchHigh, probable: GATE.matchProb, near_exact: GATE.nameExact } }));
      for (const item of readable) {
        t.advance(LATENCY.compute);
        const name = item.name!;
        const how =
          name.boost !== null && name.boost > name.blend
            ? `the shared-word boost ${three(name.boost)} beats the plain comparison ${three(name.blend)}`
            : `plain comparison ${three(name.blend)}${name.boost === null ? "" : `, shared-word boost ${three(name.boost)}`}`;
        t.log("info", `[${item.position}] "${item.listing.name}": name ${name.score} (${how}); suburb or postcode ${item.locOk ? "found in" : "not in"} the address; street: ${streetLabel(item.street)}.`);
      }
      t.ok(
        snap({
          scores: readable.map((item) => ({
            position: item.position,
            name: item.listing.name,
            name_score: item.name!.score,
            sequence_ratio: three(item.name!.sequence),
            word_overlap: three(item.name!.tokenOverlap),
            plain_comparison: three(item.name!.blend),
            shared_word_boost: item.name!.boost === null ? null : three(item.name!.boost),
            suburb_or_postcode_in_address: item.locOk,
            street: streetLabel(item.street),
          })),
        }),
      );

      // -- 7. Pick the best ----------------------------------------------------
      t.start("candidate.pick", { rule: `highest name score; a location-confirmed candidate within ${GATE.nearTie} of an unconfirmed best replaces it` });
      t.advance(LATENCY.compute);
      for (const item of readable) {
        const label = `[${item.position}] "${item.listing.name}"`;
        if (item.becameBest === "first") t.log("info", `${label} is the first candidate, so it is the best so far.`);
        else if (item.becameBest === "higher score") t.log("info", `${label} scores more than ${GATE.nearTie} above the best so far and replaces it.`);
        else if (item.becameBest === "confirmed near tie") t.log("info", `${label} is within ${GATE.nearTie} of the best so far, which has no confirmed location, and its own location is confirmed. It replaces it.`);
        else t.log("info", `${label} does not beat the best so far.`);
        if (item.stoppedAfter) t.log("info", `${label} scores at least ${GATE.matchHigh} with a confirmed location, so no further result is opened.`);
      }
      t.ok(snap({ best: best.listing.name, position: best.position, name_score: best.name!.score, location_confirmed: best.confirmed, stopped_early: readable.some((item) => item.stoppedAfter) }));

      // -- 8. Decide the status ------------------------------------------------
      status = decideStatus(best.name!.score, best.locOk, best.street, true);
      doubts.push(...cautions(best, status));
      t.start("status.decide", { name_score: best.name!.score, suburb_or_postcode_in_address: best.locOk, street: streetLabel(best.street) });
      t.advance(LATENCY.compute);
      t.log("info", explainStatus(best, status));
      for (const doubt of doubts) t.log("warn", doubt);
      t.ok({ match_status: status }, doubts.length > 0 ? "Verified on thin evidence. See the log for this step." : undefined);

      // -- 9. Confidence, and what may be called verified ---------------------------
      const confidence = contactConfidence(status);
      const before = row;
      row = fillRow(row, best, status);
      t.start("confidence.derive", { match_status: status, mapping: "Matched (High) and Probable Match are Verified; the two review tiers are Candidate Only; anything else is None" });
      t.advance(LATENCY.compute);
      t.change("output row", "update", record.licence, filled(before), filled(row));
      if (confidence === "Verified") t.log("info", "Verified: the listing's phone and website are copied into the verified columns. The candidate columns keep the same listing beside them.");
      else t.log("info", `${confidence}: what the map returned is written to the candidate columns only. The verified columns stay empty.`);
      if (faults.has("leaky-promotion") && confidence !== "Verified") {
        leakInjected = true;
        row = { ...row, "Phone (Verified)": best.listing.phone, "Website (Verified)": best.listing.website };
        t.log("error", "Injected fault: suppose a later change to this step copied the candidate's phone and website into the verified columns although the match is not verified. The row now presents an unchecked number as verified.");
      }
      t.ok(snap({ contact_confidence: confidence, copied_to_verified: confidence === "Verified" ? ["phone", "website"] : [], candidate_recorded: true }));

      // -- 10. Email, only for a verified match -------------------------------------
      if (confidence !== "Verified") {
        t.skip("email.chase", `The match is not Verified, so no website is visited (Email Status: "${row["Email Status"]}"). An address read from the wrong business's site would be worse than none.`);
      } else if (!best.listing.website) {
        t.skip("email.chase", 'The listing has no website, so there is nothing to read an address from (Email Status: "No Website").');
        emailNote = "The listing has no website, so there is no email.";
      } else {
        const result = chaseEmail(best.listing.website, buildSite(best.listing.website, faults));
        t.start("email.chase", { website: best.listing.website, order: ["homepage on https and http", "up to three contact pages", "a rendered page if the site answered but showed no address"] });
        row = { ...row, "Email (Verified)": result.email, "Email Status": result.status, Notes: result.note };
        if (result.status === "Site Error") {
          t.advance(result.requests * LATENCY.httpTimeout);
          t.log("error", "Neither https nor http answered, each tried twice with a 15 second limit. A host that never answers is not sent to the rendered-page step.");
          t.ok(snap({ email: "", email_status: result.status, note: result.note, requests: result.requests }), "No email: the website did not answer. The phone and website stay verified.");
          emailNote = "No email was found because the website did not answer.";
        } else {
          t.advance(result.requests * LATENCY.httpRequest);
          t.log("info", `Found ${result.email} on the ${result.note}. An address on the website's own domain is preferred to any other on the page.`);
          const dead = faults.has("dead-mailbox") && result.email !== "";
          if (dead) {
            t.log("warn", "Injected fault: this mailbox no longer exists. Nothing in the pipeline checks that an address can receive mail, so it is recorded as found.");
            doubts.push(`The email ${result.email} is saved as verified although the mailbox is dead: nothing checks that an address can receive mail.`);
          }
          t.ok(snap({ email: result.email, email_status: result.status, note: result.note, requests: result.requests }), dead ? "Recorded as found although the mailbox is dead: deliverability is never checked." : undefined);
        }
      }
    }
  }

  // -- 11. The guard, on every path out of the lookup -------------------------------
  const guarded = enforceAndValidate(row);
  const cleared = VERIFIED_FIELDS.filter((field) => row[field] !== "" && guarded[field] === "");
  t.start("guard.enforce", snap({ match_status: row["Match Status"], verified_columns: verifiedColumns(row) }));
  t.advance(LATENCY.compute);
  if (cleared.length > 0) {
    t.change("output row", "update", record.licence, verifiedColumns(row), verifiedColumns(guarded));
    t.log("warn", `The confidence is "${guarded["Contact Confidence"]}", so the guard emptied ${listOf(cleared)}. The candidate columns still show what the map returned.`);
  } else if (guarded["Contact Confidence"] === "Verified") {
    t.log("info", "The confidence is Verified, so the verified columns are kept. The guard trusts the status it is given: it cannot tell whether the match itself was right.");
  } else {
    t.log("info", "The verified columns were already empty, so there was nothing to clear. The guard still runs: it is called on every path out of the lookup.");
  }
  t.log("info", "Only now are the invariants asserted. The columns were emptied first, so the assertions cannot fail here: this is a guard, not a measurement of how many matches are right.");
  t.ok(snap({ contact_confidence: guarded["Contact Confidence"], cleared, invariants: "hold" }), cleared.length > 0 ? "The guard removed contact details that had no business in the verified columns." : undefined);

  // -- 12. Append the row ---------------------------------------------------------
  t.start("row.append", { file: "electrical_enriched.csv", write: "append one row, flush, fsync" });
  if (!isSaved(guarded)) {
    t.advance(LATENCY.write);
    t.log("warn", `A Blocked row is never written. The licence stays out of the file, so the next pass looks it up again. ${LIMITS.blockStormLimit} blocked records in a row make the run rebuild its browser and pause for ${LIMITS.blockStormPauseSeconds[0]} to ${LIMITS.blockStormPauseSeconds[1]} seconds.`);
    t.ok({ written: false, retried: "on the next pass", blocked_in_a_row: `1 of ${LIMITS.blockStormLimit}` }, "Not written, so it will be retried.");
    t.finish(
      "failed",
      `Not saved: the map blocked all ${LIMITS.navigationAttempts} attempts, with a wait between them. A blocked lookup is never written to the output file, so this licence is not marked done and the next pass looks it up again. Nothing wrong was recorded.`,
      { match_status: status, written: false, retried: true },
    );
    return;
  }
  if (faults.has("process-killed")) {
    const lookupMs = t.time - lookupStartedAt;
    const next = watchdogNext(0, PRIOR_ROWS.length);
    const wait = next.pauseSeconds * SECOND + lookupMs;
    t.log("error", "The process was killed before the row reached the file. Nothing of this record is on disk.");
    t.fail("PROCESS_KILLED", "The enrichment process died before the row was written.", wait);
    t.advance(wait);
    t.start("row.append", { file: "electrical_enriched.csv", write: "append one row, flush, fsync", launch: 2 });
    t.log("warn", `The watchdog saw the process exit with work left and started it again after ${next.pauseSeconds} seconds. The new process read the output file, did not find this licence and repeated the whole lookup, which is not shown a second time. It reached the same row.`);
  }
  t.advance(LATENCY.write);
  t.change("electrical_enriched.csv", "insert", record.licence, null, snap(guarded));
  t.log("info", "One row is appended, flushed and synced to disk before the next record starts. From now on a restart skips this licence.");
  t.ok({ written: true, rows_on_disk: saved.length + 1 });

  const summary = snap({
    match_status: guarded["Match Status"],
    contact_confidence: guarded["Contact Confidence"],
    name_score: best ? best.name!.score : null,
    phone_verified: guarded["Phone (Verified)"],
    website_verified: guarded["Website (Verified)"],
    email_verified: guarded["Email (Verified)"],
    written: true,
    cautions: doubts,
  });

  if (path === "search failed") {
    t.finish(
      "failed",
      `Recorded as No Match although nothing was looked up: opening the search raised a browser error on all ${LIMITS.navigationAttempts} attempts. Only an error that mentions a block is treated as temporary, so this row is final. The resume check skips it from now on, and the clean-up script keeps every No Match. This is a real gap in the code, shown as it is.`,
      summary,
    );
    return;
  }
  if (path === "no candidate" || !best) {
    t.finish("success", "No Match: the map returned no business for this licence, only a place. The row is saved with empty contact columns, so the licence is not searched again. For a business with no listing this is the true answer.", summary);
    return;
  }

  const score = best.name!.score;
  const confidence = guarded["Contact Confidence"];
  const leak = leakInjected ? " The guard removed the phone and website that the injected fault had put in the verified columns." : "";
  if (confidence === "Verified") {
    const email = guarded["Email (Verified)"] ? `, with ${guarded["Email (Verified)"]}` : "";
    const what = best.listing.website ? `The phone ${best.listing.phone} and the website of "${best.listing.name}" are` : `The phone ${best.listing.phone} of "${best.listing.name}" is`;
    const tail = [emailNote, ...doubts].filter((text) => text !== "").join(" ");
    t.finish("success", `${status} (name score ${score}). ${what} saved in the verified columns${email}.${tail ? ` ${tail}` : ""}`, summary);
    return;
  }
  if (confidence === "Candidate Only") {
    t.finish(
      "success",
      `${status} (name score ${score}). The phone ${best.listing.phone} of "${best.listing.name}" is kept in the candidate columns for a person to review. It is not copied to the verified columns and no website was visited.${leak}`,
      summary,
    );
    return;
  }
  t.finish("success", `No Match: the closest listing, "${best.listing.name}", scores ${score}, under ${GATE.matchProb}. It is recorded as a candidate and nothing is verified.${leak}`, summary);
}

export const leadsScenario: Scenario<LeadsInput> = {
  id: LEADS_SCENARIO_ID,
  stepIds: LEADS_STEPS,
  run,
};
