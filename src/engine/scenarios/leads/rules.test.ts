import { describe, expect, test } from "vitest";
import {
  LEADS_SETTINGS,
  MATCH_STATUSES,
  OUTPUT_COLUMNS,
  VERIFIED_FIELDS,
  blankRow,
  chaseEmail,
  cleanRetryWouldRequeue,
  cleanUrl,
  contactConfidence,
  coreTokens,
  decideStatus,
  domainOf,
  doneLicences,
  enforceAndValidate,
  fillRow,
  inspectCandidates,
  isPlaceResult,
  isSaved,
  locationOk,
  looksLikeBusiness,
  looksLikeStreetAddress,
  matchingBlocks,
  middle,
  nameScore,
  normName,
  pickEmail,
  replacesBest,
  roundHalfEven3,
  scoreName,
  searchQuery,
  sequenceRatio,
  statusWithoutPanel,
  streetMatch,
  streetWords,
  watchdogNext,
  type LicenceRecord,
  type Listing,
  type MatchStatus,
  type OutputRow,
  type SimulatedSite,
} from "./rules";

/**
 * Every expected value in the tables below was produced by running the
 * repository's own Python functions (electrical_enrichment.py, loaded line
 * range by line range) and difflib on the same invented strings. The names,
 * suburbs and streets are made up.
 */

describe("SequenceMatcher ratio, as difflib computes it", () => {
  const cases: [string, string, number][] = [
    ["", "", 1],
    ["abc", "", 0],
    ["", "abc", 0],
    ["abc", "abc", 1],
    ["abcd", "bcde", 0.75],
    ["aaaa", "aa", 0.6666666666666666],
    ["xaxbxcxd", "abcd", 0.6666666666666666],
    ["abcabcabc", "cbacbacba", 0.4444444444444444],
    ["the quick brown fox", "quick the fox brown", 0.5789473684210527],
    ["tallowmere electrical", "tallowmere electrical services", 0.8235294117647058],
    ["tallowmere ridge electrical", "tallowmere electrical", 0.875],
    ["quorrin electrical", "quorrin sons electrical services", 0.72],
    ["northfield electrical", "northfield bakery", 0.6842105263157895],
    ["tallowmere electrical", "tallowmeer electrical", 0.9523809523809523],
    ["j k brackenvane electrical contractors", "brackenvane electrical", 0.7333333333333333],
    ["a b a b a b", "b a b a b a", 0.8181818181818182],
    ["12 34 56", "56 34 12", 0.5],
  ];

  test.each(cases)("ratio(%j, %j) is %d", (a, b, expected) => {
    expect(sequenceRatio(a, b)).toBe(expected);
  });

  test("the blocks are the longest common run, then the same to its left and right", () => {
    expect(matchingBlocks("tallowmere ridge electrical", "tallowmere electrical")).toEqual([
      { a: 0, b: 0, size: 9 },
      { a: 15, b: 9, size: 12 },
    ]);
    expect(matchingBlocks("quorrin electrical", "quorrin sons electrical services")).toEqual([
      { a: 0, b: 0, size: 7 },
      { a: 7, b: 12, size: 11 },
    ]);
  });

  test("a short second string keeps every character: nothing is treated as junk", () => {
    // 199 characters is under difflib's threshold, so the repeated letter still matches.
    expect(sequenceRatio("z".repeat(10), "z".repeat(199))).toBe(20 / 209);
  });

  test("from 200 characters, difflib drops characters that are too common, and so does this", () => {
    const lorem = "lorem ipsum dolor sit amet ".repeat(9);
    const shuffled = "ipsum lorem sit dolor amet ".repeat(9);
    // Every character of the second string is "popular", so nothing is indexed and nothing matches.
    expect(sequenceRatio(lorem, shuffled)).toBe(0);
    expect(sequenceRatio("tallowmere electrical", `${"x".repeat(150)}tallowmere electrical${"y".repeat(150)}`)).toBe(0.12280701754385964);
    expect(sequenceRatio("z".repeat(210), "z".repeat(205))).toBe(0.9879518072289156);
  });

  test("the ratio depends on which string is second, because only the second is indexed", () => {
    const long = "electrical ".repeat(30);
    expect(sequenceRatio("electrical services", long)).toBe(0.06303724928366762);
    expect(sequenceRatio(long, "electrical services")).toBe(0.09169054441260745);
  });
});

describe("rounding to three places the way Python does", () => {
  const cases: [number, number][] = [
    [0.0625, 0.062],
    [0.1875, 0.188],
    [0.3125, 0.312],
    [0.4375, 0.438],
    [0.5625, 0.562],
    [0.6875, 0.688],
    [0.8125, 0.812],
    [0.9375, 0.938],
    [0.9435, 0.944],
    [0.9445, 0.945],
    [0.76, 0.76],
    [0.5745, 0.575],
    [0.0005, 0.001],
    [0.0015, 0.002],
    [0.2675, 0.268],
    [1, 1],
    [0.6795, 0.679],
    [0.8495, 0.85],
    [0.9695, 0.97],
    [0.123456789, 0.123],
    [0.9995, 1],
  ];

  test.each(cases)("round(%d, 3) is %d", (value, expected) => {
    expect(roundHalfEven3(value)).toBe(expected);
  });
});

describe("normalising a name", () => {
  const cases: [string, string][] = [
    ["Tallowmere Electrical Pty Ltd", "tallowmere electrical"],
    ["TALLOWMERE ELECTRICAL PTY. LTD.", "tallowmere electrical"],
    ["Quorrin & Sons Electrical Services", "quorrin sons electrical services"],
    ["Q&R Electrics P/L", "q r electrics"],
    ["The Yarrowick Electric Co", "yarrowick electric co"],
    ["Brackenvane Trading As Orrinvolt", "brackenvane orrinvolt"],
    ["Pellbrook T/A Zentrovale Electrical", "pellbrook zentrovale electrical"],
    ["Pty Ltd", ""],
    ["O'Tallow's Electrical (Vic) Pty Ltd", "o tallow s electrical vic"],
    ["J.K. Brackenvane Electrics Inc.", "j k brackenvane electrics"],
    ["Incorporated Limited Proprietary", ""],
    ["Standell Electrical", "standell electrical"],
    ["Theowick and Andrellow Electrical", "theowick andrellow electrical"],
    ["Orrinvolt PL", "orrinvolt"],
    ["Orrinvolt TA Electrical", "orrinvolt electrical"],
    ["  Tallowmere   Electrical  ", "tallowmere electrical"],
    ["", ""],
    ["QXZ Electrical", "qxz electrical"],
    ["Ltd.", ""],
    // "Pty" on its own is not one of the legal suffixes, so it stays in the name.
    ["Tallowmere Electrical Pty", "tallowmere electrical pty"],
  ];

  test.each(cases)("%j becomes %j", (raw, expected) => {
    expect(normName(raw)).toBe(expected);
  });

  test("null and undefined are empty", () => {
    expect(normName(null)).toBe("");
    expect(normName(undefined)).toBe("");
  });

  test("the distinctive words leave out the filler, unless nothing else is left", () => {
    expect([...coreTokens(["tallowmere", "electrical"])]).toEqual(["tallowmere"]);
    expect([...coreTokens(["electrical", "company"])]).toEqual(["electrical", "company"]);
    expect([...coreTokens([])]).toEqual([]);
  });
});

describe("name score", () => {
  /** licence name, listing name, name_score, sequence ratio of the normalised names */
  const cases: [string, string, number, number][] = [
    ["Tallowmere Electrical Pty Ltd", "Tallowmere Electrical", 1, 1],
    ["Tallowmere Ridge Electrical Pty Ltd", "Tallowmere Electrical", 0.76, 0.875],
    ["Tallowmere Ridge Electrical Pty Ltd", "Tallowmere Electrics", 0.562, 0.8085106382978723],
    ["Tallowmere Electrical Pty Ltd", "Tallowmere Electrical Services", 0.965, 0.8235294117647058],
    ["Tallowmere Electrical Pty Ltd", "Tallowmeer Electrical", 0.612, 0.9523809523809523],
    ["Quorrin Electrical Pty Ltd", "Quorrin & Sons Electrical Services", 0.944, 0.72],
    ["Quorrin Electrical Pty Ltd", "Quorrin Plumbing", 0.918, 0.5882352941176471],
    ["Quorrin Electrical Pty Ltd", "Quorrin & Sons Plumbing and Gas", 0.902, 0.5116279069767442],
    ["Northfield Electrical Pty Ltd", "Northfield Bakery", 0.937, 0.6842105263157895],
    ["Northfield Electrical Pty Ltd", "Northfield Trade Supplies", 0.922, 0.6086956521739131],
    ["Tallowmere Electrical Pty Ltd", "Hallowick Trade Supplies", 0.18, 0.4],
    ["Tallowmere Electrical Pty Ltd", "Pellbrook Air & Solar", 0.158, 0.35],
    ["Tallowmere Ridge Electrical Pty Ltd", "Hallowick Trade Supplies", 0.176, 0.39215686274509803],
    ["Tallowmere Ridge Electrical Pty Ltd", "Pellbrook Air & Solar", 0.117, 0.2608695652173913],
    ["Quorrin Electrical Pty Ltd", "Hallowick Trade Supplies", 0.129, 0.2857142857142857],
    ["Quorrin Electrical Pty Ltd", "Pellbrook Air & Solar", 0.122, 0.2702702702702703],
    ["QX Electrical", "QX Pellbrook Cafe", 0.378, 0.5333333333333333],
    ["QXZ Electrical", "QXZ Electrical Solar & Air", 0.947, 0.7368421052631579],
    ["J & K Brackenvane Electrical Contractors P/L", "Brackenvane Electrical", 0.55, 0.7333333333333333],
    ["The Yarrowick Electric Co", "Yarrowick Electric Company", 0.979, 0.8936170212765957],
    ["Dell Yarrowick", "Dell Yarrowick Electrical Services", 0.917, 0.5833333333333334],
    ["M T Yarrowick", "Yarrowick Electrical", 0.383, 0.5454545454545454],
    ["Electrical Pty Ltd", "Electrical Company", 0.943, 0.7142857142857143],
    ["Pty Ltd", "Tallowmere Electrical", 0, 0],
    ["Tallowmere Electrical", "", 0, 0],
    ["Tallowmere Ridge Electrical Pty Ltd", "Tallowmere Ridge Electrical & Data", 0.983, 0.9152542372881356],
  ];

  test.each(cases)("%j against %j scores %d", (licence, listing, score, sequence) => {
    expect(nameScore(licence, listing)).toBe(score);
    expect(scoreName(licence, listing).sequence).toBe(sequence);
  });

  test("the blend is 0.45 of the sequence ratio plus 0.55 of the word overlap", () => {
    const parts = scoreName("Tallowmere Ridge Electrical Pty Ltd", "Tallowmere Electrical");
    expect(parts.tokenOverlap).toBe(2 / 3);
    expect(parts.blend).toBe(0.45 * 0.875 + 0.55 * (2 / 3));
    // Half of the licence's distinctive words are in the listing, so the boost is lower than the blend.
    expect(parts).toMatchObject({ core: ["tallowmere", "ridge"], shared: ["tallowmere"], containment: 0.5, boost: 0.8 * 0.5 + 0.2 * 0.875, score: 0.76 });
  });

  test("the boost lifts a listing that contains the licence's distinctive words", () => {
    const parts = scoreName("Quorrin Electrical Pty Ltd", "Quorrin & Sons Electrical Services");
    expect(roundHalfEven3(parts.blend)).toBe(0.599);
    expect(parts).toMatchObject({ core: ["quorrin"], shared: ["quorrin"], containment: 1, score: 0.944 });
    expect(parts.boost).toBe(0.8 + 0.2 * 0.72);
  });

  test("the boost is skipped when the distinctive words are under three characters", () => {
    expect(scoreName("QX Electrical", "QX Pellbrook Cafe")).toMatchObject({ core: ["qx"], shared: ["qx"], containment: null, boost: null });
    // Three characters are enough.
    expect(scoreName("QXZ Electrical", "QXZ Electrical Solar & Air").containment).toBe(1);
  });

  test("one wrong letter in the distinctive word scores lower than a different business that spells it right", () => {
    // Read from the code, not a design claim: the blend treats words as whole tokens.
    expect(nameScore("Tallowmere Electrical Pty Ltd", "Tallowmeer Electrical")).toBeLessThan(LEADS_SETTINGS.gate.matchProb);
    expect(nameScore("Quorrin Electrical Pty Ltd", "Quorrin Plumbing")).toBeGreaterThanOrEqual(LEADS_SETTINGS.gate.matchHigh);
  });

  test("a licence named after its suburb scores high against any listing that carries the suburb's name", () => {
    expect(nameScore("Northfield Electrical Pty Ltd", "Northfield Bakery")).toBe(0.937);
    expect(decideStatus(0.937, true, false, true)).toBe("Matched (High)");
  });
});

describe("location signals", () => {
  const licenceStreet = "27 Wattlebird Road";
  /** listing address, suburb or postcode found, street verdict, the words the street check compares */
  const cases: [string, boolean, boolean | null, string[]][] = [
    ["27 Wattlebird Rd, Northfield VIC 3999", true, true, ["northfield", "vic", "wattlebird"]],
    ["3 Quarry Ct, Northfield VIC 3999", true, false, ["northfield", "quarry", "vic"]],
    ["88 Foundry St, Southport VIC 3998", false, false, ["foundry", "southport", "vic"]],
    ["5 Wattlebird Rd, Southport VIC 3998", false, true, ["southport", "vic", "wattlebird"]],
    ["", false, null, []],
    ["Northfield VIC 3999", true, false, ["northfield", "vic"]],
    ["Unit 4, 12 St Rd", false, null, []],
    ["9 Mill Lane, Eastbrook VIC 3997", false, false, ["eastbrook", "mill", "vic"]],
    ["PO Box 12, NORTHFIELD", true, false, ["northfield"]],
    ["Shop 2/27 wattlebird road", false, true, ["wattlebird"]],
  ];

  test.each(cases)("%j", (address, loc, street, wordsExpected) => {
    expect(locationOk("Northfield", "3999", address)).toBe(loc);
    expect(streetMatch(licenceStreet, address)).toBe(street);
    expect([...streetWords(address)].sort()).toEqual(wordsExpected);
  });

  test("the suburb is a plain substring test and the postcode is a fallback", () => {
    expect(locationOk("", "3999", "1 Example St, Elsewhere 3999")).toBe(true);
    expect(locationOk("", "", "1 Example St, Elsewhere 3999")).toBe(false);
    expect(locationOk("Northfield", "", "12 High St, Northfield Heights")).toBe(true);
    expect(locationOk("Northfield", " 3999 ", "Somewhere 3999")).toBe(true);
    // A quirk carried over from the source: a suburb of spaces only matches every address.
    expect(locationOk("  ", "", "1 Example St")).toBe(true);
    expect(locationOk("Northfield", "3999", null)).toBe(false);
  });

  test("the street verdict has three values, and unknown is not the same as contradicted", () => {
    expect(streetMatch("", "27 Wattlebird Rd, Northfield VIC 3999")).toBeNull();
    expect(streetMatch("12 St Rd", "27 Wattlebird Rd")).toBeNull();
    expect(streetMatch("Unit 3, 27a Wattlebird Rd", "27A Wattlebird Road")).toBe(true);
  });

  test("any word of the listing's address counts, so a street named after the suburb confirms a different street", () => {
    expect(streetMatch("14 Northfield Road", "3 Quarry Ct, Northfield VIC 3999")).toBe(true);
  });
});

describe("results that are not businesses", () => {
  const record = { suburb: "Northfield", state: "VIC" };

  test.each([
    ["Northfield", true],
    ["northfield.", true],
    ["VIC", true],
    ["Victoria", true],
    ["Australia", true],
    ["The Northfield", true],
    ["Northfield Electrical", false],
    ["", true],
    ["Pty Ltd", true],
    ["Southport", false],
  ] as [string, boolean][])("isPlaceResult(%j) is %j", (name, expected) => {
    expect(isPlaceResult(name, record)).toBe(expected);
  });

  test.each([
    ["127 Wattlebird Ln", true],
    ["5 Foundry St", true],
    ["27 Wattlebird", false],
    ["Wattlebird Rd", false],
    ["12 Tallow Electrical", false],
    ["4 The Parade", true],
    ["88 Quarry Row", true],
    ["9 and 11 Mill Lane", true],
  ] as [string, boolean][])("looksLikeStreetAddress(%j) is %j", (name, expected) => {
    expect(looksLikeStreetAddress(name)).toBe(expected);
  });
});

describe("the decision", () => {
  test("matches Python's decide_status on every combination of the boundary scores and both signals", () => {
    const scores = [0, 0.5, 0.679, 0.68, 0.849, 0.85, 0.969, 0.97, 1];
    // One digit per combination, in loop order: the index of the status in MATCH_STATUSES.
    const expected = "444444444444444444444444444444444444141414143434141414143434040404042424040404042424040404042404040404042404";
    let got = "";
    for (const score of scores) {
      for (const loc of [true, false]) {
        for (const street of [true, false, null]) {
          for (const had of [true, false]) got += MATCH_STATUSES.indexOf(decideStatus(score, loc, street, had));
        }
      }
    }
    expect(got).toBe(expected);
  });

  test("a confirmed location and a high score is the strongest result", () => {
    expect(decideStatus(0.85, true, null, true)).toBe("Matched (High)");
    expect(decideStatus(0.85, false, true, true)).toBe("Matched (High)");
    expect(decideStatus(0.68, true, false, true)).toBe("Probable Match");
  });

  test("a high score in the wrong place is kept for review, not verified", () => {
    expect(decideStatus(1, false, false, true)).toBe("Name Match / Location Mismatch");
    expect(decideStatus(0.9, false, null, true)).toBe("Name Match / Location Mismatch");
    expect(decideStatus(0.76, false, false, true)).toBe("Low Confidence (location unconfirmed)");
  });

  test("a near-exact name with no address at all is still verified: the gap is in the code", () => {
    expect(decideStatus(0.97, false, null, true)).toBe("Matched (High)");
    expect(decideStatus(0.969, false, null, true)).toBe("Name Match / Location Mismatch");
  });

  test("one shared street word confirms the location even when suburb and postcode do not match", () => {
    expect(decideStatus(0.76, false, true, true)).toBe("Probable Match");
  });

  test("no candidate, or a low score, is No Match", () => {
    expect(decideStatus(1, true, true, false)).toBe("No Match");
    expect(decideStatus(0.679, true, true, true)).toBe("No Match");
  });

  test.each([
    ["Matched (High)", "Verified"],
    ["Probable Match", "Verified"],
    ["Name Match / Location Mismatch", "Candidate Only"],
    ["Low Confidence (location unconfirmed)", "Candidate Only"],
    ["No Match", "None"],
    ["Blocked", "None"],
    ["", "None"],
    ["Something else", "None"],
  ])("status %j gives confidence %j", (status, confidence) => {
    expect(contactConfidence(status)).toBe(confidence);
  });
});

const record: LicenceRecord = { licence: "DEMO-00417", name: "Tallowmere Electrical Pty Ltd", address: "27 Wattlebird Road", suburb: "Northfield", state: "VIC", postcode: "3999" };

describe("the guard", () => {
  const filled = (status: string): OutputRow => {
    const row = Object.fromEntries(OUTPUT_COLUMNS.map((column) => [column, "x"])) as OutputRow;
    row["Match Status"] = status;
    return row;
  };

  test("a blank row carries the identity columns and nothing else", () => {
    const row = blankRow(record);
    expect(OUTPUT_COLUMNS).toHaveLength(19);
    expect(Object.keys(row)).toEqual([...OUTPUT_COLUMNS]);
    expect(row).toMatchObject({ "License No": "DEMO-00417", "Business Name": "Tallowmere Electrical Pty Ltd", Suburb: "Northfield", State: "VIC", Postcode: "3999", "Phone (Verified)": "", "Match Status": "" });
  });

  /** status, confidence, verified phone, website and email after the guard, candidate phone after the guard (from Python) */
  test.each([
    ["Matched (High)", "Verified", "x", "x", "x", "x"],
    ["Probable Match", "Verified", "x", "x", "x", "x"],
    ["Name Match / Location Mismatch", "Candidate Only", "", "", "", "x"],
    ["Low Confidence (location unconfirmed)", "Candidate Only", "", "", "", "x"],
    ["No Match", "None", "", "", "", "x"],
    ["Blocked", "None", "", "", "", "x"],
    ["", "None", "", "", "", "x"],
  ])("a row with status %j and every column filled", (status, confidence, phone, website, email, candidatePhone) => {
    const out = enforceAndValidate(filled(status));
    expect(out["Contact Confidence"]).toBe(confidence);
    expect([out["Phone (Verified)"], out["Website (Verified)"], out["Email (Verified)"]]).toEqual([phone, website, email]);
    expect(out["Candidate Phone"]).toBe(candidatePhone);
  });

  test("it overwrites a confidence someone else wrote", () => {
    const row = filled("No Match");
    row["Contact Confidence"] = "Verified";
    expect(enforceAndValidate(row)["Contact Confidence"]).toBe("None");
  });

  test("it returns a new row and leaves the one it was given alone", () => {
    const row = filled("No Match");
    enforceAndValidate(row);
    expect(row["Phone (Verified)"]).toBe("x");
  });

  test("its assertions cannot fail for any status the matcher produces: the columns are emptied before they are checked", () => {
    // This is why "0 violations" says the guard ran, not that the matches were right.
    for (const status of [...MATCH_STATUSES, "", "Unknown"]) {
      expect(() => enforceAndValidate(filled(status))).not.toThrow();
    }
  });

  test("the one thing the assertions can catch is a status that was renamed without its mapping", () => {
    expect(() => enforceAndValidate(filled("Low Confidence (renamed)"))).toThrow(/RULE 7: Low Confidence must be Candidate Only/);
  });

  test("it trusts the status it is given: a wrong match marked Verified keeps its contact details", () => {
    const out = enforceAndValidate(filled("Matched (High)"));
    for (const field of VERIFIED_FIELDS) expect(out[field]).toBe("x");
  });
});

const listing = (name: string, address: string, extra: Partial<Listing> = {}): Listing => ({
  name,
  phone: "03 5550 0142",
  website: "https://listing.example.test",
  address,
  link: "https://maps.example.test/place/listing",
  ...extra,
});

describe("the candidate loop", () => {
  const home = "27 Wattlebird Rd, Northfield VIC 3999";
  const elsewhere = "88 Foundry St, Southport VIC 3998";

  test("stops at the first confident, location-confirmed candidate and never opens the rest", () => {
    const { inspections, best } = inspectCandidates(record, [listing("Hallowick Trade Supplies", "2 Depot Rd, Northfield VIC 3999"), listing("Tallowmere Electrical", home), listing("Pellbrook Air & Solar", elsewhere)]);
    expect(inspections).toHaveLength(2);
    expect(inspections.map((item) => item.becameBest)).toEqual(["first", "higher score"]);
    expect(inspections[1].stoppedAfter).toBe(true);
    expect(best?.listing.name).toBe("Tallowmere Electrical");
    expect(best?.name?.score).toBe(1);
  });

  test("opens at most three results", () => {
    const results = Array.from({ length: 6 }, (_, index) => listing(`Hallowick Trade Supplies ${index}`, elsewhere));
    expect(inspectCandidates(record, results).inspections).toHaveLength(LEADS_SETTINGS.gate.candidatesPerRecord);
  });

  test("a place takes one of the three slots and is passed over", () => {
    const { inspections, best } = inspectCandidates(record, [listing("Northfield", "Northfield VIC 3999", { phone: "", website: "" }), listing("Hallowick Trade Supplies", elsewhere), listing("Pellbrook Air & Solar", elsewhere), listing("Tallowmere Electrical", home)]);
    expect(inspections.map((item) => item.skipped)).toEqual(["place", null, null]);
    // The real listing was fourth, so it was never opened.
    expect(best?.listing.name).toBe("Hallowick Trade Supplies");
  });

  test("a bare street address with no phone and no website is passed over; with a phone it is scored", () => {
    const bare = inspectCandidates(record, [listing("127 Wattlebird Ln", home, { phone: "", website: "" })]);
    expect(bare.inspections[0].skipped).toBe("street address");
    expect(bare.best).toBeNull();
    const withPhone = inspectCandidates(record, [listing("127 Wattlebird Ln", home, { website: "" })]);
    expect(withPhone.inspections[0].skipped).toBeNull();
  });

  test("a result with no name is passed over, and only places leaves no candidate", () => {
    const { inspections, best } = inspectCandidates(record, [listing("", home), listing("Northfield", "Northfield VIC 3999")]);
    expect(inspections.map((item) => item.skipped)).toEqual(["no name", "place"]);
    expect(best).toBeNull();
  });

  test("a location-confirmed candidate wins a near tie against an unconfirmed one listed first", () => {
    const { inspections, best } = inspectCandidates(record, [listing("Tallowmere Electrical", elsewhere, { phone: "03 5550 0188" }), listing("Tallowmere Electrical", home)]);
    expect(inspections.map((item) => item.becameBest)).toEqual(["first", "confirmed near tie"]);
    expect(best?.listing.phone).toBe("03 5550 0142");
  });

  test("between two unconfirmed candidates with the same score, the first listed stays", () => {
    const { inspections, best } = inspectCandidates(record, [listing("Tallowmere Electrical", "9 Mill Lane, Eastbrook VIC 3997", { phone: "03 5550 0188" }), listing("Tallowmere Electrical", elsewhere)]);
    expect(inspections.map((item) => item.becameBest)).toEqual(["first", null]);
    expect(best?.listing.phone).toBe("03 5550 0188");
  });

  test("the replacement rule, case by case", () => {
    const unconfirmed = { score: 0.9, locOk: false, street: null };
    expect(replacesBest(null, unconfirmed)).toBe("first");
    expect(replacesBest(unconfirmed, { score: 0.96, locOk: false, street: null })).toBe("higher score");
    expect(replacesBest(unconfirmed, { score: 0.95, locOk: false, street: null })).toBeNull();
    expect(replacesBest(unconfirmed, { score: 0.86, locOk: true, street: null })).toBe("confirmed near tie");
    expect(replacesBest(unconfirmed, { score: 0.84, locOk: false, street: true })).toBeNull();
    // A confirmed best is not displaced by another confirmed candidate inside the tie band.
    expect(replacesBest({ score: 0.9, locOk: true, street: null }, { score: 0.93, locOk: true, street: true })).toBeNull();
  });
});

describe("filling the row", () => {
  const best = (name: string, address: string) => inspectCandidates(record, [listing(name, address)]).best!;

  test("a verified match copies the phone and website into the verified columns", () => {
    const row = fillRow(blankRow(record), best("Tallowmere Electrical", "27 Wattlebird Rd, Northfield VIC 3999"), "Matched (High)");
    expect(row).toMatchObject({
      "Candidate Name": "Tallowmere Electrical",
      "Candidate Phone": "03 5550 0142",
      "Candidate Match Score": 1,
      "Phone (Verified)": "03 5550 0142",
      "Website (Verified)": "https://listing.example.test",
      "Match Status": "Matched (High)",
      "Contact Confidence": "Verified",
      "Email Status": "",
    });
  });

  test("anything else records the candidate and leaves the verified columns empty", () => {
    const status: MatchStatus = "Name Match / Location Mismatch";
    const row = fillRow(blankRow(record), best("Tallowmere Electrical", "88 Foundry St, Southport VIC 3998"), status);
    expect(row).toMatchObject({ "Candidate Phone": "03 5550 0142", "Phone (Verified)": "", "Website (Verified)": "", "Contact Confidence": "Candidate Only", "Email Status": "Skipped (unverified match)" });
  });

  test("a verified match without a website has nothing to chase", () => {
    const { best: found } = inspectCandidates(record, [listing("Tallowmere Electrical", "27 Wattlebird Rd, Northfield VIC 3999", { website: "" })]);
    expect(fillRow(blankRow(record), found!, "Matched (High)")["Email Status"]).toBe("No Website");
  });
});

describe("the email pass", () => {
  const site = (change: Partial<SimulatedSite> = {}): SimulatedSite => ({
    skipDomain: false,
    answers: { https: true, http: true },
    homepageEmails: ["info@tallowmere.example.test"],
    contactPageEmails: [],
    renderedEmail: "",
    ...change,
  });
  const url = "https://www.tallowmere.example.test";

  test("an address on the homepage is found with one request", () => {
    expect(chaseEmail(url, site())).toEqual({ email: "info@tallowmere.example.test", status: "Found", note: "homepage", requests: 1 });
  });

  test("an address on the site's own domain is preferred to one that is not", () => {
    expect(pickEmail(["builder@webshop.example.test", "office@tallowmere.example.test"], url)).toBe("office@tallowmere.example.test");
    expect(pickEmail(["builder@webshop.example.test", "other@elsewhere.example.test"], url)).toBe("builder@webshop.example.test");
    expect(domainOf(url)).toBe("tallowmere.example.test");
    expect(domainOf("not a url")).toBe("");
    expect(cleanUrl("tallowmere.example.test")).toBe("https://tallowmere.example.test");
    expect(cleanUrl("  ")).toBe("");
  });

  test("contact pages are tried next, at most three", () => {
    expect(chaseEmail(url, site({ homepageEmails: [], contactPageEmails: [[], ["hello@tallowmere.example.test"]] }))).toMatchObject({ status: "Found", note: "contact page", requests: 3 });
    expect(chaseEmail(url, site({ homepageEmails: [], contactPageEmails: [[], [], [], ["late@tallowmere.example.test"]] }))).toMatchObject({ status: "Not Found", requests: 4 });
  });

  test("a page that only shows the address once rendered is found by the browser step", () => {
    expect(chaseEmail(url, site({ homepageEmails: [], renderedEmail: "team@tallowmere.example.test" }))).toMatchObject({ email: "team@tallowmere.example.test", status: "Found (JS)" });
  });

  test("the other scheme is tried when the first does not answer", () => {
    expect(chaseEmail(url, site({ answers: { https: false, http: true } }))).toMatchObject({ status: "Found", requests: 3 });
  });

  test("a host that never answers is a site error after two requests per scheme", () => {
    expect(chaseEmail(url, site({ answers: { https: false, http: false } }))).toEqual({ email: "", status: "Site Error", note: "site not reachable", requests: 4 });
  });

  test("no website, and a host that is never fetched", () => {
    expect(chaseEmail("", site())).toMatchObject({ status: "No Website", requests: 0 });
    expect(chaseEmail(url, site({ skipDomain: true }))).toMatchObject({ status: "Skipped (Domain)", requests: 0 });
  });
});

describe("the run around one record", () => {
  test("the search text is the licence name, the suburb, the state and the country", () => {
    expect(searchQuery(record)).toBe("Tallowmere Electrical Pty Ltd Northfield VIC Australia");
    expect(searchQuery({ name: "Tallowmere Electrical", suburb: "", state: "VIC" })).toBe("Tallowmere Electrical VIC Australia");
  });

  test.each([
    ["Tallowmere Electrical Pty Ltd", true],
    ["Dell Yarrowick", false],
    ["M T Yarrowick", false],
    ["Yarrowick & Pellbrook", true],
    ["Unit 5 Holdings", true],
    ["Yarrowick Group", true],
    ["Brackenvane Air", true],
    ["Pellbrook Hallowick", false],
  ] as [string, boolean][])("looksLikeBusiness(%j) is %j", (name, expected) => {
    expect(looksLikeBusiness(name)).toBe(expected);
  });

  test("the output file is the checkpoint: a licence with any status but Blocked is done", () => {
    const done = doneLicences([
      { "License No": "DEMO-00398", "Match Status": "Matched (High)" },
      { "License No": " DEMO-00402 ", "Match Status": "No Match" },
      { "License No": "DEMO-00405", "Match Status": "Blocked" },
      { "License No": "", "Match Status": "No Match" },
      { "License No": "DEMO-00407", "Match Status": "" },
    ]);
    // A row cut off before its status still counts as done here; only the clean-up script sends it back.
    expect([...done]).toEqual(["DEMO-00398", "DEMO-00402", "DEMO-00407"]);
  });

  test("a blocked lookup is not written, so it is looked up again", () => {
    expect(isSaved({ "Match Status": "Blocked" })).toBe(false);
    expect(isSaved(null)).toBe(false);
    expect(isSaved({ "Match Status": "No Match" })).toBe(true);
  });

  test("only an error that mentions a block is temporary", () => {
    expect(statusWithoutPanel("blocked: unusual-traffic notice")).toBe("Blocked");
    // The gap: a dead browser session and a page that never loaded become a final answer.
    expect(statusWithoutPanel("navigation failed: WebDriverException")).toBe("No Match");
    expect(statusWithoutPanel("no results panel")).toBe("No Match");
  });

  test("the clean-up script keeps every No Match, whatever caused it", () => {
    expect(cleanRetryWouldRequeue({ "License No": "DEMO-00417", "Match Status": "No Match" })).toBe(false);
    expect(cleanRetryWouldRequeue({ "License No": "DEMO-00417", "Match Status": "Blocked" })).toBe(true);
    expect(cleanRetryWouldRequeue({ "License No": "DEMO-00417", "Match Status": "" })).toBe(true);
    expect(cleanRetryWouldRequeue({ "License No": "", "Match Status": "Matched (High)" })).toBe(true);
  });

  test("the watchdog waits longer after a launch that saved nothing and gives up after twelve", () => {
    expect(watchdogNext(0, 40)).toEqual({ stalled: 0, giveUp: false, pauseSeconds: 15 });
    expect(watchdogNext(0, 0)).toEqual({ stalled: 1, giveUp: false, pauseSeconds: 120 });
    expect(watchdogNext(11, 0)).toEqual({ stalled: 12, giveUp: true, pauseSeconds: 120 });
    expect(watchdogNext(11, 3)).toEqual({ stalled: 0, giveUp: false, pauseSeconds: 15 });
  });

  test("the thresholds are the repository's, kept in one object", () => {
    expect(LEADS_SETTINGS.gate).toEqual({ candidatesPerRecord: 3, matchHigh: 0.85, matchProb: 0.68, nameExact: 0.97, nearTie: 0.05 });
    expect(Object.keys(LEADS_SETTINGS)).toEqual(["gate", "run"]);
    expect(middle(LEADS_SETTINGS.run.blockedWaitSeconds)).toBe(15);
  });
});
