import { describe, expect, it } from "vitest";
import { reduceRun } from "../../reduce";
import { RunSession } from "../../session";
import type { RunEvent, RunState } from "../../types";
import { LEADS_SETTINGS } from "./rules";
import {
  DEMO_RECORD,
  FIRST_RESULTS,
  LEADS_DEFAULT_INPUT,
  LEADS_FAULTS,
  LEADS_PRESETS,
  LEADS_SCENARIO_ID,
  LEADS_STEPS,
  LISTING_PHONE,
  MAP_SHOWS,
  leadsScenario,
  validateLeadsInput,
  type LeadsFaultId,
  type LeadsInput,
} from "./scenario";

const OUTPUT_FILE = "electrical_enriched.csv";

function execute(options: { input?: Partial<LeadsInput>; faults?: LeadsFaultId[] } = {}) {
  const session = new RunSession(leadsScenario, {
    runId: "test-run",
    input: { ...LEADS_DEFAULT_INPUT, ...options.input },
    faults: options.faults,
  });
  return { session, events: session.events, state: reduceRun(LEADS_STEPS, session.events) };
}

function statuses(state: RunState) {
  return Object.fromEntries(LEADS_STEPS.map((id) => [id, state.steps[id].status]));
}

function changesTo(events: readonly RunEvent[], table: string) {
  return events.filter((e) => e.type === "state.changed" && e.table === table) as Extract<RunEvent, { type: "state.changed" }>[];
}

/** The row appended to the output file, or undefined when nothing was written. */
function savedRow(events: readonly RunEvent[]) {
  return changesTo(events, OUTPUT_FILE)[0]?.after as Record<string, string | number> | undefined;
}

function logs(state: RunState) {
  return state.logs.map((entry) => entry.message).join("\n");
}

function preset(id: string): LeadsInput {
  return LEADS_PRESETS.find((item) => item.id === id)!.input;
}

describe("a clear match", () => {
  const { state, events, session } = execute();

  it("completes every step without waiting for a person", () => {
    expect(session.isFinished).toBe(true);
    expect(session.isWaiting).toBe(false);
    expect(state.status).toBe("success");
    expect(Object.values(statuses(state)).every((status) => status === "success")).toBe(true);
    expect(leadsScenario.id).toBe(LEADS_SCENARIO_ID);
  });

  it("says in the first step that a person completed the register's human check", () => {
    expect(state.steps["record.read"].logs[0].message).toMatch(/a person completed it and ran the search/);
    expect(state.steps["record.read"].logs[0].message).toMatch(/never attempts the check itself/);
  });

  it("searches with the licence name, suburb, state and country", () => {
    expect(state.steps["name.normalise"].output).toEqual({ normalised: "tallowmere electrical", distinctive_words: ["tallowmere"], search_text: "Tallowmere Electrical Pty Ltd Northfield VIC Australia" });
  });

  it("stops at the confident, location-confirmed listing and never opens the third result", () => {
    expect(state.steps["candidates.read"].output).toMatchObject({ opened: 2, passed_over: [] });
    expect(state.steps["candidate.pick"].output).toEqual({ best: "Tallowmere Electrical", position: 2, name_score: 1, location_confirmed: true, stopped_early: true });
    expect(logs(state)).toMatch(/1 more result was never opened/);
  });

  it("scores each opened candidate with the three signals", () => {
    expect(state.steps["candidates.score"].output).toEqual({
      scores: [
        { position: 1, name: "Hallowick Trade Supplies", name_score: 0.18, sequence_ratio: 0.4, word_overlap: 0, plain_comparison: 0.18, shared_word_boost: null, suburb_or_postcode_in_address: true, street: "different street" },
        { position: 2, name: "Tallowmere Electrical", name_score: 1, sequence_ratio: 1, word_overlap: 1, plain_comparison: 1, shared_word_boost: 1, suburb_or_postcode_in_address: true, street: "shares a street word" },
      ],
    });
  });

  it("verifies the contact and looks up an email on the listing's own website", () => {
    expect(state.steps["status.decide"].output).toEqual({ match_status: "Matched (High)" });
    expect(state.steps["confidence.derive"].output).toMatchObject({ contact_confidence: "Verified", copied_to_verified: ["phone", "website"] });
    expect(state.steps["email.chase"].output).toEqual({ email: "info@tallowmere-electrical.example.test", email_status: "Found", note: "homepage", requests: 1 });
  });

  it("appends one guarded row to the file that is also the checkpoint", () => {
    expect(state.steps["guard.enforce"].output).toEqual({ contact_confidence: "Verified", cleared: [], invariants: "hold" });
    expect(changesTo(events, OUTPUT_FILE)).toHaveLength(1);
    expect(savedRow(events)).toMatchObject({
      "License No": DEMO_RECORD.licence,
      "Candidate Phone": LISTING_PHONE,
      "Phone (Verified)": LISTING_PHONE,
      "Website (Verified)": "https://tallowmere-electrical.example.test",
      "Email (Verified)": "info@tallowmere-electrical.example.test",
      "Match Status": "Matched (High)",
      "Match Score": 1,
      "Contact Confidence": "Verified",
      "Email Status": "Found",
    });
    expect(state.steps["row.append"].output).toEqual({ written: true, rows_on_disk: 3 });
    expect(state.summary).toMatchObject({ contact_confidence: "Verified", cautions: [] });
  });

  it("is deterministic", () => {
    expect(execute().events).toEqual(events);
  });
});

describe("the other presets", () => {
  it("a probable match is verified one tier down", () => {
    const { state, events } = execute({ input: preset("probable") });
    expect(state.steps["candidate.pick"].output).toMatchObject({ name_score: 0.76, location_confirmed: true, stopped_early: false });
    expect(state.steps["candidates.read"].output).toMatchObject({ opened: 3 });
    expect(state.steps["status.decide"].output).toEqual({ match_status: "Probable Match" });
    expect(savedRow(events)).toMatchObject({ "Phone (Verified)": LISTING_PHONE, "Contact Confidence": "Verified", "Match Score": 0.76 });
    expect(state.status).toBe("success");
  });

  it("the right name in the wrong suburb is kept as a candidate and its phone is withheld", () => {
    const { state, events } = execute({ input: preset("wrong-suburb") });
    expect(state.steps["status.decide"].output).toEqual({ match_status: "Name Match / Location Mismatch" });
    expect(statuses(state)["email.chase"]).toBe("skipped");
    expect(state.steps["email.chase"].skipReason).toMatch(/Skipped \(unverified match\)/);
    expect(savedRow(events)).toMatchObject({
      "Candidate Name": "Tallowmere Electrical",
      "Candidate Phone": LISTING_PHONE,
      "Candidate Address": "88 Foundry St, Southport VIC 3998",
      "Phone (Verified)": "",
      "Website (Verified)": "",
      "Email (Verified)": "",
      "Contact Confidence": "Candidate Only",
      "Email Status": "Skipped (unverified match)",
    });
    expect(state.outcome).toMatch(/kept in the candidate columns for a person to review/);
  });

  it("a partial name in another suburb is low confidence", () => {
    const { state, events } = execute({ input: preset("low-confidence") });
    expect(state.steps["status.decide"].output).toEqual({ match_status: "Low Confidence (location unconfirmed)" });
    expect(savedRow(events)).toMatchObject({ "Phone (Verified)": "", "Contact Confidence": "Candidate Only", "Match Score": 0.76 });
  });

  it("a business that is not on the map ends early with No Match and an empty row", () => {
    const { state, events } = execute({ input: preset("not-listed") });
    expect(state.status).toBe("success");
    expect(state.steps["candidates.read"].output).toEqual({ opened: 1, candidates: [], passed_over: [{ position: 1, name: "Northfield", because: "place" }] });
    expect(state.steps["candidates.read"].warning).toMatch(/Nothing on the panel was a business/);
    expect(statuses(state)).toMatchObject({ "candidates.score": "skipped", "candidate.pick": "skipped", "status.decide": "skipped", "confidence.derive": "skipped", "email.chase": "skipped", "guard.enforce": "success", "row.append": "success" });
    expect(savedRow(events)).toMatchObject({ "Match Status": "No Match", "Contact Confidence": "None", "Candidate Name": "", "Phone (Verified)": "", Notes: "candidates found but none readable" });
    expect(state.steps["record.read"].logs[1].message).toMatch(/looks like a person's/);
    expect(state.outcome).toMatch(/^No Match: the map returned no business/);
  });

  it("a namesake in the same suburb is verified, and the run says why that is thin", () => {
    const { state, events } = execute({ input: preset("namesake") });
    expect(state.steps["candidates.score"].output).toMatchObject({ scores: [{}, { name: "Quorrin & Sons Electrical Services", name_score: 0.944, plain_comparison: 0.599, shared_word_boost: 0.944, suburb_or_postcode_in_address: true, street: "different street" }] });
    expect(state.steps["status.decide"].output).toEqual({ match_status: "Matched (High)" });
    expect(state.steps["status.decide"].warning).toMatch(/thin evidence/);
    expect(savedRow(events)).toMatchObject({ "Phone (Verified)": LISTING_PHONE, "Contact Confidence": "Verified" });
    // The guard cannot help: it trusts the status.
    expect(state.steps["guard.enforce"].output).toMatchObject({ cleared: [] });
    expect((state.summary as { cautions: string[] }).cautions).toHaveLength(1);
    expect(state.outcome).toMatch(/verified only through the shared-word boost.*The plain comparison scores 0\.599, which would be "No Match"/);
  });

  it.each(LEADS_PRESETS.map((item) => [item.id, item.input] as const))("%s finishes and writes one row", (_id, input) => {
    const { session, state, events } = execute({ input });
    expect(session.isFinished).toBe(true);
    expect(state.status).toBe("success");
    expect(changesTo(events, OUTPUT_FILE)).toHaveLength(1);
  });

  it("at least one preset ends before the matching steps run", () => {
    const early = LEADS_PRESETS.filter((item) => statuses(execute({ input: item.input }).state)["status.decide"] === "skipped");
    expect(early.map((item) => item.id)).toEqual(["not-listed"]);
  });
});

describe("other inputs", () => {
  it("an unrelated listing is No Match, and the closest result is still recorded as a candidate", () => {
    const { state, events } = execute({ input: { listingName: "Harbourline Plumbing & Gasfitting" } });
    expect(state.steps["status.decide"].output).toEqual({ match_status: "No Match" });
    expect(savedRow(events)).toMatchObject({ "Candidate Name": "Hallowick Trade Supplies", "Candidate Match Score": 0.18, "Phone (Verified)": "", "Contact Confidence": "None", "Email Status": "Skipped (unverified match)" });
    expect(state.outcome).toMatch(/scores 0\.18, under 0\.68/);
  });

  it("the same name listed first in another suburb loses a near tie to the listing whose location is confirmed", () => {
    const { state, events } = execute({ input: { firstResult: "the same name in another suburb" } });
    expect(logs(state)).toMatch(/is within 0\.05 of the best so far, which has no confirmed location, and its own location is confirmed/);
    expect(savedRow(events)).toMatchObject({ "Candidate Phone": LISTING_PHONE, "Candidate Address": "27 Wattlebird Rd, Northfield VIC 3999", "Match Status": "Matched (High)" });
  });

  it("when neither listing of that name is confirmed, the first one listed stays and nothing is verified", () => {
    const { events } = execute({ input: { ...preset("wrong-suburb"), firstResult: "the same name in another suburb" } });
    expect(savedRow(events)).toMatchObject({ "Candidate Phone": "03 5550 0188", "Candidate Address": "9 Mill Lane, Eastbrook VIC 3997", "Phone (Verified)": "", "Match Status": "Name Match / Location Mismatch" });
  });

  it("the same street name in another suburb counts as a confirmed location: shown with its caution", () => {
    const { state, events } = execute({ input: { ...preset("probable"), mapShows: "another suburb, same street name" } });
    expect(state.steps["candidates.score"].output).toMatchObject({ scores: [{}, { suburb_or_postcode_in_address: false, street: "shares a street word" }, {}] });
    expect(savedRow(events)).toMatchObject({ "Match Status": "Probable Match", "Phone (Verified)": LISTING_PHONE });
    expect(state.outcome).toMatch(/confirmed by one shared street word\. Neither the suburb nor the postcode/);
  });

  it.each(MAP_SHOWS.flatMap((mapShows) => FIRST_RESULTS.map((firstResult) => [mapShows, firstResult] as const)))("%s with %s first finishes", (mapShows, firstResult) => {
    for (const item of LEADS_PRESETS) {
      const { session, state } = execute({ input: { ...item.input, mapShows, firstResult } });
      expect(session.isFinished).toBe(true);
      expect(state.status).toBe("success");
    }
  });

  it("a name with nothing left after normalisation scores 0 and is No Match", () => {
    const { state } = execute({ input: { licenceName: "Pty Ltd" } });
    expect(state.steps["name.normalise"].output).toMatchObject({ normalised: "" });
    expect(state.steps["status.decide"].output).toEqual({ match_status: "No Match" });
  });

  it("a listing that is named like the suburb is passed over as a place", () => {
    const { state, events } = execute({ input: { listingName: "Northfield" } });
    expect(state.steps["candidates.read"].output).toMatchObject({ passed_over: [{ position: 2, name: "Northfield", because: "place" }] });
    expect(savedRow(events)).toMatchObject({ "Match Status": "No Match", "Candidate Name": "Hallowick Trade Supplies" });
  });

  it.each(["Northfield", "VIC", "27 Wattlebird Rd", "Pty Ltd", "A&B", "365", "(Vic)", "O'Tallow's Electrical", "Hallowick Trade Supplies", "x".repeat(60)])("any allowed name finishes: %s", (name) => {
    for (const input of [{ licenceName: name }, { listingName: name }, { licenceName: name, listingName: name }]) {
      expect(validateLeadsInput({ ...LEADS_DEFAULT_INPUT, ...input }).ok).toBe(true);
      for (const mapShows of MAP_SHOWS) {
        const { session, state, events } = execute({ input: { ...input, mapShows } });
        expect(session.isFinished).toBe(true);
        expect(state.status).toBe("success");
        expect(changesTo(events, OUTPUT_FILE)).toHaveLength(1);
      }
    }
  });
});

describe("resume", () => {
  it("a licence that already has a row is skipped before anything is searched", () => {
    const { state, events } = execute({ faults: ["already-done"] });
    expect(state.status).toBe("success");
    expect(state.steps["resume.check"].output).toEqual({ already_done: true, finished_licences: 3 });
    expect(statuses(state)["maps.search"]).toBe("skipped");
    expect(changesTo(events, OUTPUT_FILE)).toHaveLength(0);
    expect(state.outcome).toMatch(/^Skipped: licence DEMO-00417 already has a row/);
  });

  it("a process killed before the write loses only that record: the relaunch does it again and writes it once", () => {
    const clean = execute();
    const { state, events } = execute({ faults: ["process-killed"] });
    expect(state.status).toBe("success");
    const attempts = state.steps["row.append"].attempts;
    expect(attempts.map((attempt) => attempt.status)).toEqual(["failed", "success"]);
    expect(attempts[0].error?.code).toBe("PROCESS_KILLED");
    // The watchdog's pause after a launch that had saved rows, plus the lookup done again.
    expect(attempts[0].retryAt! - attempts[0].endedAt!).toBeGreaterThan(LEADS_SETTINGS.run.watchdogBackoffSeconds * 1000);
    expect(logs(state)).toMatch(/started it again after 15 seconds/);
    expect(changesTo(events, OUTPUT_FILE)).toHaveLength(1);
    expect(savedRow(events)).toEqual(savedRow(clean.events));
  });
});

describe("the search fails", () => {
  it("a blocked lookup backs off, is not written, and is left for the next pass", () => {
    const { state, events } = execute({ faults: ["lookup-blocked"] });
    const attempts = state.steps["maps.search"].attempts;
    expect(attempts).toHaveLength(LEADS_SETTINGS.run.navigationAttempts);
    expect(attempts.map((attempt) => attempt.error?.code)).toEqual(["BLOCKED", "BLOCKED", "BLOCKED"]);
    // Fifteen seconds is the middle of the 10 to 20 second wait in the source.
    expect(attempts[0].retryAt! - attempts[0].endedAt!).toBe(15_000);
    expect(attempts[2].retryAt).toBeUndefined();
    expect(statuses(state)).toMatchObject({ "maps.search": "failed", "candidates.read": "skipped", "status.decide": "skipped", "guard.enforce": "success", "row.append": "success" });
    expect(state.steps["row.append"].output).toEqual({ written: false, retried: "on the next pass", blocked_in_a_row: "1 of 5" });
    expect(changesTo(events, OUTPUT_FILE)).toHaveLength(0);
    expect(state.status).toBe("failed");
    expect(state.outcome).toMatch(/never written to the output file.*the next pass looks it up again/);
    expect(logs(state)).toMatch(/does not attempt the check/);
  });

  it("a dead browser session is recorded as a final No Match: the gap is shown, not hidden", () => {
    const { state, events } = execute({ faults: ["session-dead"] });
    const attempts = state.steps["maps.search"].attempts;
    expect(attempts.map((attempt) => attempt.error?.code)).toEqual(["NAVIGATION_FAILED", "NAVIGATION_FAILED", "NAVIGATION_FAILED"]);
    expect(attempts[0].retryAt! - attempts[0].endedAt!).toBe(6_000);
    expect(savedRow(events)).toMatchObject({ "Match Status": "No Match", "Contact Confidence": "None", Notes: "navigation failed: WebDriverException", "Phone (Verified)": "" });
    expect(state.status).toBe("failed");
    expect(state.outcome).toMatch(/Recorded as No Match although nothing was looked up/);
    expect(state.outcome).toMatch(/real gap in the code/);
  });

  it("when both are switched on, the dead session wins: no page can come back from it", () => {
    const { state } = execute({ faults: ["lookup-blocked", "session-dead"] });
    expect(state.steps["maps.search"].error?.code).toBe("NAVIGATION_FAILED");
  });
});

describe("what the map returns", () => {
  it("a place among the results is passed over and still uses one of the three slots", () => {
    const { state, events } = execute({ faults: ["place-result"] });
    expect(state.steps["maps.search"].output).toEqual({ results_on_panel: 4, to_inspect: 3 });
    expect(state.steps["candidates.read"].output).toMatchObject({ opened: 3, passed_over: [{ position: 1, name: "Northfield", because: "place" }] });
    expect(savedRow(events)).toMatchObject({ "Match Status": "Matched (High)", "Phone (Verified)": LISTING_PHONE });
    expect(state.status).toBe("success");
  });

  it("an exact name on a listing with no address is still verified: the gap is shown with its caution", () => {
    const { state, events } = execute({ faults: ["hidden-address"] });
    expect(state.steps["candidates.score"].output).toMatchObject({ scores: [{}, { suburb_or_postcode_in_address: false, street: "unknown" }, {}] });
    expect(savedRow(events)).toMatchObject({ "Match Status": "Matched (High)", "Candidate Address": "", "Phone (Verified)": LISTING_PHONE, "Contact Confidence": "Verified" });
    expect(logs(state)).toMatch(/nothing contradicts the location, because the listing shows no usable address/);
    expect(state.outcome).toMatch(/verified on the name alone/);
  });

  it("a partial name on a listing with no address is not verified", () => {
    const { events } = execute({ input: preset("probable"), faults: ["hidden-address"] });
    expect(savedRow(events)).toMatchObject({ "Match Status": "Low Confidence (location unconfirmed)", "Phone (Verified)": "" });
  });
});

describe("the guard", () => {
  it("empties verified columns that an unverified row should never have had", () => {
    const { state, events } = execute({ input: preset("wrong-suburb"), faults: ["leaky-promotion"] });
    expect(logs(state)).toMatch(/Injected fault: suppose a later change/);
    expect(state.steps["guard.enforce"].input).toMatchObject({ verified_columns: { "Phone (Verified)": LISTING_PHONE, "Website (Verified)": "https://tallowmere-electrical.example.test" } });
    expect(state.steps["guard.enforce"].output).toEqual({ contact_confidence: "Candidate Only", cleared: ["Phone (Verified)", "Website (Verified)"], invariants: "hold" });
    expect(state.steps["guard.enforce"].warning).toMatch(/removed contact details/);
    expect(savedRow(events)).toMatchObject({ "Phone (Verified)": "", "Website (Verified)": "", "Candidate Phone": LISTING_PHONE });
    expect(state.outcome).toMatch(/The guard removed the phone and website/);
  });

  it("has nothing to do on a verified row", () => {
    const clean = execute();
    const { events } = execute({ faults: ["leaky-promotion"] });
    expect(savedRow(events)).toEqual(savedRow(clean.events));
  });

  it("runs on every path that produces a row, including the ones with no candidate", () => {
    for (const run of [execute({ input: preset("not-listed") }), execute({ faults: ["session-dead"] }), execute({ faults: ["lookup-blocked"] })]) {
      expect(run.state.steps["guard.enforce"].status).toBe("success");
      expect(run.state.steps["guard.enforce"].output).toMatchObject({ contact_confidence: "None", cleared: [] });
    }
  });
});

describe("the email pass", () => {
  it("a website that does not answer is recorded as a site error, and the phone stays verified", () => {
    const { state, events } = execute({ faults: ["site-unreachable"] });
    expect(state.steps["email.chase"].output).toEqual({ email: "", email_status: "Site Error", note: "site not reachable", requests: 4 });
    expect(state.steps["email.chase"].durationMs).toBe(60_000);
    expect(savedRow(events)).toMatchObject({ "Phone (Verified)": LISTING_PHONE, "Email (Verified)": "", "Email Status": "Site Error", "Contact Confidence": "Verified" });
    expect(state.status).toBe("success");
  });

  it("a dead mailbox is saved as verified, because nothing checks that an address receives mail", () => {
    const { state, events } = execute({ faults: ["dead-mailbox"] });
    expect(savedRow(events)).toMatchObject({ "Email (Verified)": "info@tallowmere-electrical.example.test", "Email Status": "Found" });
    expect(state.steps["email.chase"].warning).toMatch(/deliverability is never checked/);
    expect((state.summary as { cautions: string[] }).cautions).toEqual([expect.stringMatching(/the mailbox is dead/)]);
  });

  it("is never run for an unverified match, whatever is wrong with the website", () => {
    for (const fault of ["site-unreachable", "dead-mailbox"] as const) {
      const { state } = execute({ input: preset("wrong-suburb"), faults: [fault] });
      expect(statuses(state)["email.chase"]).toBe("skipped");
    }
  });
});

describe("every fault", () => {
  it.each(LEADS_FAULTS.map((fault) => [fault] as const))("%s ends in a finished run", (fault) => {
    const { session, state } = execute({ faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(session.isWaiting).toBe(false);
    expect(state.outcome).toBeTruthy();
    for (const status of Object.values(statuses(state))) expect(["success", "failed", "skipped"]).toContain(status);
  });

  it.each(LEADS_PRESETS.flatMap((item) => LEADS_FAULTS.map((fault) => [item.id, fault] as const)))("%s with %s is consistent", (id, fault) => {
    const { session, state, events } = execute({ input: preset(id), faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    expect(state.steps["guard.enforce"].error).toBeUndefined();
    // Whatever happened, an unverified row never carries verified contact details.
    const row = savedRow(events);
    if (row && row["Contact Confidence"] !== "Verified") {
      expect([row["Phone (Verified)"], row["Website (Verified)"], row["Email (Verified)"]]).toEqual(["", "", ""]);
    }
  });

  it.each(LEADS_FAULTS.flatMap((first, index) => LEADS_FAULTS.slice(index + 1).map((second) => [first, second] as const)))("%s together with %s is consistent", (first, second) => {
    const { session, state, events } = execute({ faults: [first, second] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    expect(changesTo(events, OUTPUT_FILE).length).toBeLessThanOrEqual(1);
  });

  it.each(MAP_SHOWS.flatMap((mapShows) => FIRST_RESULTS.flatMap((firstResult) => LEADS_FAULTS.map((fault) => [mapShows, firstResult, fault] as const))))("%s, %s first, with %s is consistent", (mapShows, firstResult, fault) => {
    const { session, state, events } = execute({ input: { mapShows, firstResult }, faults: [fault] });
    expect(session.isFinished).toBe(true);
    expect(state.outcome).toBeTruthy();
    const row = savedRow(events);
    if (row && row["Contact Confidence"] !== "Verified") expect([row["Phone (Verified)"], row["Website (Verified)"], row["Email (Verified)"]]).toEqual(["", "", ""]);
  });

  it("only the two search faults and the kill produce a failed step", () => {
    const failing = LEADS_FAULTS.filter((fault) => execute({ faults: [fault] }).events.some((event) => event.type === "step.failed"));
    expect(failing).toEqual(["lookup-blocked", "session-dead", "process-killed"]);
  });
});

describe("what the demo must not contain", () => {
  const everything = [...LEADS_PRESETS.map((item) => execute({ input: item.input })), ...LEADS_FAULTS.map((fault) => execute({ faults: [fault] })), execute({ input: { firstResult: "the same name in another suburb" } })];
  const text = JSON.stringify(everything.map((run) => run.events));

  it("uses only invented hosts, phone numbers and licence numbers", () => {
    // A host is labels joined by dots, so a full stop that ends a sentence is not part of it.
    const host = "[a-z0-9-]+(?:\\.[a-z0-9-]+)+";
    const hosts = [...text.matchAll(new RegExp(`https?://(${host})`, "g"))].map((match) => match[1]);
    expect(hosts.length).toBeGreaterThan(0);
    for (const name of hosts) expect(name, name).toMatch(/\.example\.test$/);
    const emails = [...text.matchAll(new RegExp(`[a-z0-9._-]+@(${host})`, "g"))].map((match) => match[1]);
    expect(emails.length).toBeGreaterThan(0);
    for (const domain of emails) expect(domain, domain).toMatch(/\.example\.test$/);
    const phones = [...text.matchAll(/\b0\d[\d ]{8,}\b/g)].map((match) => match[0].trim());
    expect(phones.length).toBeGreaterThan(0);
    for (const phone of phones) expect(phone).toMatch(/^03 5550 01\d\d$/);
    expect(DEMO_RECORD.licence).toMatch(/^DEMO-\d+$/);
    expect(text).not.toMatch(/\bREC-?\d/);
  });

  it("describes block handling in neutral terms and names no client", () => {
    expect(text).not.toMatch(/stealth|fingerprint|undetect|evade|bypass/i);
    expect(text).not.toMatch(/\bGV\b/);
  });

  it("keeps the repository's thresholds in one object and says where waits are the middle of a range", () => {
    expect(Object.keys(LEADS_SETTINGS)).toEqual(["gate", "run"]);
    expect(LEADS_SETTINGS.gate.matchHigh).toBe(0.85);
    expect(LEADS_SETTINGS.run.blockedWaitSeconds).toEqual([10, 20]);
  });
});

describe("input validation", () => {
  it("accepts the defaults and every preset", () => {
    expect(validateLeadsInput(LEADS_DEFAULT_INPUT)).toMatchObject({ ok: true, errors: {} });
    for (const item of LEADS_PRESETS) expect(validateLeadsInput(item.input)).toMatchObject({ ok: true, errors: {}, value: item.input });
  });

  it("accepts every option of both selects", () => {
    for (const mapShows of MAP_SHOWS) expect(validateLeadsInput({ ...LEADS_DEFAULT_INPUT, mapShows }).errors.mapShows).toBeUndefined();
    for (const firstResult of FIRST_RESULTS) expect(validateLeadsInput({ ...LEADS_DEFAULT_INPUT, firstResult }).errors.firstResult).toBeUndefined();
  });

  it("reports each field that is wrong and falls back to the defaults", () => {
    const result = validateLeadsInput({ licenceName: "", listingName: 42 as unknown as string, mapShows: "on the moon", firstResult: undefined });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(["firstResult", "licenceName", "listingName", "mapShows"]);
    expect(result.value).toEqual(LEADS_DEFAULT_INPUT);
  });

  it("trims a name and collapses repeated spaces", () => {
    expect(validateLeadsInput({ ...LEADS_DEFAULT_INPUT, licenceName: "  Tallowmere   Electrical  " }).value.licenceName).toBe("Tallowmere Electrical");
  });

  it.each([
    ["x", /2 to 60 characters/],
    ["T".repeat(61), /2 to 60 characters/],
    ["Tallowmere <script>", /letters, digits, spaces/],
    ["Tallowmère Électrique", /letters, digits, spaces/],
    ["& / &", /at least one letter or digit/],
  ] as [string, RegExp][])("rejects %j", (name, message) => {
    const result = validateLeadsInput({ ...LEADS_DEFAULT_INPUT, listingName: name });
    expect(result.ok).toBe(false);
    expect(result.errors.listingName).toMatch(message);
    expect(result.value.listingName).toBe(LEADS_DEFAULT_INPUT.listingName);
  });
});
