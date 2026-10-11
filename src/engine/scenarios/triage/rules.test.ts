import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../sha256";
import {
  CALLBACK_PATTERN,
  backoffSeconds,
  balanceProjects,
  classifyEligibility,
  combineScores,
  contentHash,
  detectCountry,
  evaluate,
  isDailyQuota,
  isRetryable,
  matchesRole,
  normalise,
  orderByRank,
  parseScored,
  posterKey,
  requiredYears,
  retryDelaySeconds,
  validateIds,
  verifyCallback,
  type FirstPass,
  type JobPosting,
  type Refutation,
} from "./rules";
import { JOB_PRESETS, SAMPLE_COMPANY, SAMPLE_POLICY, WEBHOOK_CONFIG, sampleCatalogue } from "./world";

const baseJob: JobPosting = {
  company: SAMPLE_COMPANY,
  title: "Backend Engineer",
  location: "Remote",
  remoteType: "remote",
  description: "Python services. 3 years of experience.",
};

describe("sha256Hex", () => {
  it("matches the standard test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with the platform implementation around every padding boundary", () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4096]) {
      const text = "a".repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });

  it("hashes non-ASCII text as UTF-8", () => {
    const text = "موعد جديد · naïve — 日本語";
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
});

describe("content hash", () => {
  it("ignores case and spacing differences", () => {
    expect(contentHash({ ...baseJob, title: "  backend   ENGINEER " })).toBe(contentHash(baseJob));
    expect(normalise("  A\n b\t") ).toBe("a b");
  });

  it("changes with the location, so one role in two cities is two jobs", () => {
    expect(contentHash({ ...baseJob, location: "Berlin, Germany" })).not.toBe(contentHash(baseJob));
  });

  it("only reads the first 4,000 characters of the description", () => {
    const long = "x".repeat(4000);
    expect(contentHash({ ...baseJob, description: long + "tail one" })).toBe(contentHash({ ...baseJob, description: long + "tail two" }));
  });
});

describe("targeting policy", () => {
  it("accepts sought roles and rejects excluded or senior ones", () => {
    expect(matchesRole("AI Automation Engineer", SAMPLE_POLICY)).toBe(true);
    expect(matchesRole("Python Developer", SAMPLE_POLICY)).toBe(true);
    expect(matchesRole("Senior Backend Engineer", SAMPLE_POLICY)).toBe(false);
    expect(matchesRole("Sr. Data Engineer", SAMPLE_POLICY)).toBe(false);
    expect(matchesRole("Frontend Engineer", SAMPLE_POLICY)).toBe(false);
    expect(matchesRole("Office Coordinator", SAMPLE_POLICY)).toBe(false);
  });

  it("takes the highest number of years a posting asks for", () => {
    expect(requiredYears("3 years in Python and at least 8 years of experience in distributed systems")).toBe(8);
    expect(requiredYears("5+ years experience")).toBe(5);
    expect(requiredYears("minimum of 7 years of relevant experience")).toBe(7);
    expect(requiredYears("founded 12 years ago")).toBeNull();
    expect(requiredYears("")).toBeNull();
  });

  it("checks blocking phrases before open ones", () => {
    expect(classifyEligibility("We do not offer visa sponsorship.", SAMPLE_POLICY).eligibility).toBe("local_only");
    expect(classifyEligibility("Visa sponsorship is available.", SAMPLE_POLICY).eligibility).toBe("open");
    expect(classifyEligibility("Great team and snacks.", SAMPLE_POLICY)).toEqual({ eligibility: "unknown", phrase: "" });
  });

  it("finds the country and its tier in a location", () => {
    expect(detectCountry("Amsterdam, Netherlands", SAMPLE_POLICY)).toEqual({ country: "Netherlands", tier: 1 });
    expect(detectCountry("Austin, United States", SAMPLE_POLICY)).toEqual({ country: "United States", tier: 4 });
    expect(detectCountry("Atlantis", SAMPLE_POLICY)).toEqual({ country: null, tier: null });
    expect(detectCountry("", SAMPLE_POLICY)).toEqual({ country: null, tier: null });
  });

  it("applies the checks in order: role, seniority, eligibility, remote, country", () => {
    expect(evaluate(baseJob, SAMPLE_POLICY)).toMatchObject({ eligible: true, reason: "Remote.", eligibility: "unknown" });
    expect(evaluate({ ...baseJob, title: "Sales Manager" }, SAMPLE_POLICY).reason).toBe("The role is not one being sought.");
    expect(evaluate({ ...baseJob, description: "8 years of experience" }, SAMPLE_POLICY).reason).toBe(
      "The posting asks for 8 years of experience.",
    );
    expect(evaluate({ ...baseJob, description: "No visa sponsorship." }, SAMPLE_POLICY)).toMatchObject({
      eligible: false,
      eligibility: "local_only",
    });
  });

  it("decides onsite roles by country tier", () => {
    const onsite = { ...baseJob, remoteType: "onsite" as const };
    expect(evaluate({ ...onsite, location: "Berlin, Germany" }, SAMPLE_POLICY)).toMatchObject({ eligible: true, tier: 1 });
    expect(evaluate({ ...onsite, location: "Austin, United States" }, SAMPLE_POLICY)).toMatchObject({
      eligible: false,
      reason: "United States: remote roles only.",
    });
    expect(evaluate({ ...onsite, location: "Atlantis" }, SAMPLE_POLICY).reason).toBe("The country is not on the list: Atlantis.");
  });

  it("lets a posting that says nothing about authorisation through", () => {
    expect(evaluate(baseJob, SAMPLE_POLICY).eligibility).toBe("unknown");
    expect(evaluate(baseJob, SAMPLE_POLICY).eligible).toBe(true);
  });

  it("gives every preset the outcome its description promises", () => {
    const outcome = (id: string) => {
      const preset = JOB_PRESETS.find((item) => item.id === id)!;
      return evaluate({ ...preset.job, company: SAMPLE_COMPANY }, SAMPLE_POLICY);
    };
    expect(outcome("good-match").eligible).toBe(true);
    expect(outcome("generous-first-pass").eligible).toBe(true);
    expect(outcome("senior-title")).toMatchObject({ eligible: false, roleMatch: false });
    expect(outcome("no-sponsorship")).toMatchObject({ eligible: false, eligibility: "local_only" });
    expect(outcome("too-many-years").reason).toMatch(/8 years/);
  });
});

describe("model call handling", () => {
  it("reads the server's retry hint", () => {
    expect(retryDelaySeconds("429 limit. 'retryDelay': '7s'")).toBe(7);
    expect(retryDelaySeconds('"retryDelay": "41.5s"')).toBe(41.5);
    expect(retryDelaySeconds("503 UNAVAILABLE")).toBeNull();
  });

  it("mirrors the original pattern, which is written for the quoted format the API returns", () => {
    // The pattern allows up to four characters between the key and the number,
    // which fits the quoted form. With fewer, it can swallow leading digits.
    expect(retryDelaySeconds("retryDelay: 300s")).toBe(0);
    expect(retryDelaySeconds("'retryDelay': '300s'")).toBe(300);
  });

  it("tells a daily quota from a per-minute limit", () => {
    expect(isDailyQuota("429 quota exceeded for GenerateRequestsPerDay")).toBe(true);
    expect(isDailyQuota("429 limit. 'retryDelay': '300s'")).toBe(true);
    expect(isDailyQuota("429 limit. 'retryDelay': '7s'")).toBe(false);
    expect(isDailyQuota("503 daily maintenance")).toBe(false);
  });

  it("retries only on overload and rate-limit errors", () => {
    expect(isRetryable("503 UNAVAILABLE")).toBe(true);
    expect(isRetryable("429 RESOURCE_EXHAUSTED")).toBe(true);
    expect(isRetryable("400 INVALID_ARGUMENT")).toBe(false);
    expect(isRetryable("404 model not found")).toBe(false);
  });

  it("waits for the hint, or doubles, plus half a second", () => {
    expect(backoffSeconds("429 limit. 'retryDelay': '7s'", 0)).toBe(7.5);
    expect(backoffSeconds("503 UNAVAILABLE", 0)).toBe(1.5);
    expect(backoffSeconds("503 UNAVAILABLE", 1)).toBe(2.5);
    expect(backoffSeconds("503 UNAVAILABLE", 3)).toBe(8.5);
  });

  it("rejects answers the schema alone would have accepted", () => {
    expect(parseScored('{"score": 86}')).toEqual({ ok: true, value: { score: 86 } });
    expect(parseScored('{"score": 0}').ok).toBe(true);
    expect(parseScored('{"score": 100}').ok).toBe(true);
    expect(parseScored('{"score": 140}')).toEqual({ ok: false, error: "Score out of range: 140." });
    expect(parseScored('{"score": -1}').ok).toBe(false);
    expect(parseScored('{"score": 71.5}').ok).toBe(false);
    expect(parseScored('{"score": "86"}').ok).toBe(false);
    expect(parseScored("{}").ok).toBe(false);
    expect(parseScored("null").ok).toBe(false);
    expect(parseScored('{"score": 86, "matched": [')).toEqual({ ok: false, error: "The model returned invalid JSON." });
  });
});

describe("combining the two passes", () => {
  const first: FirstPass = { score: 84, verdict: "good", matched: ["a", "b"], gaps: ["g1"], reasoning: "r" };
  const lower: Refutation = { unmet: ["g1", "g2"], score: 58, verdict: "partial", note: "n" };

  it("keeps the lower score and takes the refuter's verdict when it is lower", () => {
    expect(combineScores(first, lower)).toMatchObject({ scoreInitial: 84, refuterScore: 58, scoreFinal: 58, verdict: "partial" });
  });

  it("keeps the first verdict when the refuter scored higher", () => {
    expect(combineScores(first, { ...lower, score: 90, verdict: "strong" })).toMatchObject({ scoreFinal: 84, verdict: "good" });
  });

  it("adds the refuter's unmet requirements to the gaps without repeating them, up to six", () => {
    expect(combineScores(first, lower).gaps).toEqual(["g1", "g2"]);
    const many = { ...lower, unmet: ["g2", "g3", "g4", "g5", "g6", "g7"] };
    expect(combineScores(first, many).gaps).toHaveLength(6);
  });

  it("lets the first pass stand when there is no refutation", () => {
    expect(combineScores(first, null)).toMatchObject({ scoreFinal: 84, refuterScore: null, verdict: "good", gaps: ["g1"] });
  });
});

describe("notification key", () => {
  it("treats the same company and title as one advertisement, whatever the punctuation", () => {
    expect(posterKey({ company: " Northwind Labs ", title: "Backend Engineer (Python)" })).toBe(
      posterKey({ company: "northwind labs", title: "backend engineer - python" }),
    );
    expect(posterKey({ company: "A", title: "Backend Engineer" })).not.toBe(posterKey({ company: "A", title: "Data Engineer" }));
  });
});

describe("tailoring barrier", () => {
  const catalogue = sampleCatalogue();

  it("drops ids that are unknown, repeated or in the wrong section", () => {
    expect(validateIds(["b2", "b99", "b1", "b2", "b7"], catalogue, "experience")).toEqual({
      kept: ["b2", "b1"],
      dropped: ["b99", "b2", "b7"],
    });
  });

  it("cannot be tricked by ids that look like object properties", () => {
    expect(validateIds(["constructor", "__proto__", "toString"], catalogue, "experience")).toEqual({
      kept: [],
      dropped: ["constructor", "__proto__", "toString"],
    });
  });

  it("treats anything that is not a list as no ids", () => {
    expect(validateIds("b1", catalogue, "experience")).toEqual({ kept: [], dropped: [] });
    expect(validateIds(null, catalogue, "projects")).toEqual({ kept: [], dropped: [] });
  });

  it("keeps three projects with two bullets each and removes a project with one", () => {
    expect(balanceProjects(["b7", "b6", "b9", "b10", "b11", "b12", "b13"], catalogue)).toEqual(["b7", "b6", "b9", "b10", "b11", "b12"]);
  });

  it("caps a project at two bullets", () => {
    expect(balanceProjects(["b6", "b7", "b8", "b9", "b10"], catalogue)).toEqual(["b6", "b7", "b9", "b10"]);
  });

  it("keeps the strongest project when none has two bullets", () => {
    expect(balanceProjects(["b13", "b9"], catalogue)).toEqual(["b13"]);
    expect(balanceProjects([], catalogue)).toEqual([]);
  });

  it("orders bullets by the owner's rank, not the model's order", () => {
    expect(orderByRank(["b3", "b1", "b2"], catalogue)).toEqual(["b2", "b1", "b3"]);
  });
});

describe("webhook checks", () => {
  const genuine = { secretHeader: WEBHOOK_CONFIG.secret, chatId: WEBHOOK_CONFIG.allowedChat, data: "a:4102" };

  it("accepts a genuine decision", () => {
    expect(verifyCallback(genuine, WEBHOOK_CONFIG)).toEqual({ accepted: true, jobId: 4102, key: "a", write: { status: "applied" } });
    expect(verifyCallback({ ...genuine, data: "s:7" }, WEBHOOK_CONFIG)).toMatchObject({ write: { status: "skipped" } });
  });

  it("maps confirmations and outcomes to their own columns", () => {
    expect(verifyCallback({ ...genuine, data: "n:4102" }, WEBHOOK_CONFIG)).toMatchObject({ write: { status: "applied", confirmed: false } });
    expect(verifyCallback({ ...genuine, data: "oi:4102" }, WEBHOOK_CONFIG)).toMatchObject({
      write: { status: "applied", confirmed: true, outcome: "interview" },
    });
  });

  it("rejects a missing or wrong secret before looking at anything else", () => {
    expect(verifyCallback({ ...genuine, secretHeader: null }, WEBHOOK_CONFIG)).toMatchObject({ accepted: false, layer: 1, httpStatus: 403 });
    expect(verifyCallback({ secretHeader: "guess", chatId: "x", data: "garbage" }, WEBHOOK_CONFIG)).toMatchObject({ layer: 1 });
  });

  it("rejects another chat even with the right secret", () => {
    expect(verifyCallback({ ...genuine, chatId: "999" }, WEBHOOK_CONFIG)).toMatchObject({ accepted: false, layer: 2 });
  });

  it("rejects data that is not a known key and a number", () => {
    for (const data of ["a:4102; drop table applications", "a:", ":4102", "A:4102", "abc:1", "a:1234567890123", "", "zz:1", "x:1", "toString:1"]) {
      expect(verifyCallback({ ...genuine, data }, WEBHOOK_CONFIG), data).toMatchObject({ accepted: false, layer: 3 });
    }
  });

  it("uses an anchored pattern", () => {
    expect(CALLBACK_PATTERN.test("a:1")).toBe(true);
    expect(CALLBACK_PATTERN.test("a:1\n")).toBe(false);
    expect(CALLBACK_PATTERN.test(" a:1")).toBe(false);
  });
});
