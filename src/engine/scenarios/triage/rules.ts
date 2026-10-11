/**
 * Rules of the job-triage pipeline, re-implemented in TypeScript.
 *
 * Each function mirrors one piece of the Python and Deno source and names the
 * file it was read from. The originals call a hosted model; nothing here does.
 * Reason strings in the original are Arabic and are given in English here.
 */

import { sha256Hex } from "../../sha256";

// -- Fingerprint (src/adapters.py) ---------------------------------------

/** `_normalise`: lower case, whitespace collapsed. */
export function normalise(text: string | null | undefined): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface JobPosting {
  company: string;
  title: string;
  location: string;
  remoteType: "remote" | "hybrid" | "onsite" | "unknown";
  description: string;
}

/**
 * `Job._hash`: the posting's identity. The external id and the URL are left
 * out, so a repost under a new id is the same job. The location is included
 * on purpose, so one role in two cities is two jobs.
 */
export function contentHash(job: Pick<JobPosting, "company" | "title" | "location" | "description">): string {
  return sha256Hex(
    [normalise(job.company), normalise(job.title), normalise(job.location), normalise(job.description).slice(0, 4000)].join("|"),
  );
}

// -- Targeting policy (src/targeting.py) ---------------------------------

export interface TargetingPolicy {
  roles: { include: string[]; exclude: string[] };
  seniority: { maxYearsRequired: number; excludeSeniorInTitle: boolean };
  eligibility: { blocking: string[]; open: string[] };
  /** Tier number to country names. Tier 4 is remote-only. */
  countries: Record<number, string[]>;
}

export interface Verdict {
  eligible: boolean;
  reason: string;
  eligibility: "open" | "local_only" | "unknown";
  country: string | null;
  tier: number | null;
  roleMatch: boolean;
}

const MAX_TEXT = 20_000;
const SENIOR_TITLE = /\b(?:senior|sr\.?)\b/i;
const YEARS =
  /(?:(?:at\s+least|minimum\s+(?:of\s+)?|min\.?\s*)\s*)?(\d{1,2})\s*(?:\+|plus)?\s*(?:-\s*\d{1,2}\s*)?(?:\+\s*)?years?(?:\s+(?:of\s+)?(?:\w+\s+){0,3}?experience|\s+experience|\s*\+)/gi;

function anyMatch(patterns: string[], text: string): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(text);
    if (match) return match;
  }
  return null;
}

/** `matches_role`: an exclusion wins, then "senior" in the title, then the include list. */
export function matchesRole(title: string, policy: TargetingPolicy): boolean {
  if (anyMatch(policy.roles.exclude, title)) return false;
  if (policy.seniority.excludeSeniorInTitle && SENIOR_TITLE.test(title)) return false;
  return anyMatch(policy.roles.include, title) !== null;
}

/** `required_years`: the highest number of years the posting asks for. */
export function requiredYears(text: string): number | null {
  const found = [...text.slice(0, MAX_TEXT).matchAll(YEARS)].map((match) => Number(match[1])).filter((n) => n > 0 && n <= 30);
  return found.length > 0 ? Math.max(...found) : null;
}

/**
 * `classify_eligibility`: blocking phrases are checked before open ones,
 * because "we do not offer visa sponsorship" also contains "sponsorship".
 */
export function classifyEligibility(text: string, policy: TargetingPolicy): { eligibility: Verdict["eligibility"]; phrase: string } {
  const sample = text.slice(0, MAX_TEXT);
  const blocking = anyMatch(policy.eligibility.blocking, sample);
  if (blocking) return { eligibility: "local_only", phrase: blocking[0].trim().slice(0, 80) };
  const open = anyMatch(policy.eligibility.open, sample);
  if (open) return { eligibility: "open", phrase: open[0].trim().slice(0, 80) };
  return { eligibility: "unknown", phrase: "" };
}

/** `detect_country`: longest name first, so a short name cannot shadow a longer one. */
export function detectCountry(location: string, policy: TargetingPolicy): { country: string | null; tier: number | null } {
  const haystack = location.toLowerCase();
  if (!haystack) return { country: null, tier: null };
  const names = Object.entries(policy.countries)
    .flatMap(([tier, list]) => list.map((name) => ({ name, tier: Number(tier) })))
    .sort((a, b) => b.name.length - a.name.length);
  const hit = names.find((entry) => haystack.includes(entry.name.toLowerCase()));
  return hit ? { country: hit.name, tier: hit.tier } : { country: null, tier: null };
}

/**
 * `evaluate`: the whole decision, with no model involved. A posting that says
 * nothing about work authorisation passes on purpose: most postings say
 * nothing, and a missed opportunity costs more than a minute of reading.
 */
export function evaluate(job: JobPosting, policy: TargetingPolicy): Verdict {
  const roleMatch = matchesRole(job.title, policy);
  const { country, tier } = detectCountry(job.location, policy);
  const { eligibility, phrase } = classifyEligibility(`${job.title}\n${job.location}\n${job.description}`, policy);
  const out = (eligible: boolean, reason: string): Verdict => ({ eligible, reason, eligibility, country, tier, roleMatch });

  if (!roleMatch) return out(false, "The role is not one being sought.");

  const years = requiredYears(job.description);
  if (years !== null && years >= policy.seniority.maxYearsRequired) {
    return out(false, `The posting asks for ${years} years of experience.`);
  }

  if (eligibility === "local_only") return out(false, `Local candidates only: "${phrase}".`);
  if (job.remoteType === "remote") return out(true, "Remote.");
  if (tier === null) return out(false, `The country is not on the list: ${job.location || "not stated"}.`);
  if (tier === 4) return out(false, `${country}: remote roles only.`);
  return out(true, `${country}, tier ${tier}.`);
}

// -- Model calls (src/scoring.py) ----------------------------------------

export const API_RETRIES = 4;
export const MAX_ATTEMPTS = 3;
export const VERDICTS = ["strong", "good", "partial", "weak", "no"] as const;
export type ScoreVerdict = (typeof VERDICTS)[number];

export interface FirstPass {
  score: number;
  verdict: ScoreVerdict;
  matched: string[];
  gaps: string[];
  reasoning: string;
}

export interface Refutation {
  unmet: string[];
  score: number;
  verdict: ScoreVerdict;
  note: string;
}

/** `_retry_delay`: the wait the server asks for, when it gives one. */
export function retryDelaySeconds(message: string): number | null {
  const match = /retryDelay.{0,4}(\d+(?:\.\d+)?)s/.exec(message);
  return match ? Number(match[1]) : null;
}

/** `_is_daily_quota`: a per-minute limit is waited out; a daily one is not. */
export function isDailyQuota(message: string): boolean {
  return message.includes("429") && (/PerDay|per day|daily/i.test(message) || (retryDelaySeconds(message) ?? 0) > 120);
}

/** `score_job`: only these errors are worth another attempt. */
export function isRetryable(message: string): boolean {
  return ["429", "503", "500", "UNAVAILABLE"].some((code) => message.includes(code));
}

/** `score_job`: the server's hint, or 2 to the power of the attempt, plus half a second. */
export function backoffSeconds(message: string, attempt: number): number {
  return (retryDelaySeconds(message) ?? 2 ** attempt) + 0.5;
}

/**
 * `score_job` and `refute`: the response schema guarantees the shape of the
 * answer, not its meaning, so the score's range is checked in code.
 */
export function parseScored<T extends { score: number }>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The model returned invalid JSON." };
  }
  const score = (value as { score?: unknown } | null)?.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    return { ok: false, error: `Score out of range: ${JSON.stringify(score)}.` };
  }
  return { ok: true, value: value as T };
}

export interface CombinedScore {
  scoreInitial: number;
  refuterScore: number | null;
  scoreFinal: number;
  verdict: ScoreVerdict;
  matched: string[];
  gaps: string[];
}

/**
 * `run`: the final score is the lower of the two passes. The verdict comes
 * from the refuter only when it scored lower, and its unmet requirements are
 * added to the first pass's gaps. Without a refutation the first pass stands.
 */
export function combineScores(first: FirstPass, refutation: Refutation | null): CombinedScore {
  if (!refutation) {
    return {
      scoreInitial: first.score,
      refuterScore: null,
      scoreFinal: first.score,
      verdict: first.verdict,
      matched: first.matched.slice(0, 6),
      gaps: first.gaps.slice(0, 6),
    };
  }
  return {
    scoreInitial: first.score,
    refuterScore: refutation.score,
    scoreFinal: Math.min(first.score, refutation.score),
    verdict: refutation.score < first.score ? refutation.verdict : first.verdict,
    matched: first.matched.slice(0, 6),
    gaps: [...first.gaps, ...refutation.unmet.filter((gap) => !first.gaps.includes(gap))].slice(0, 6),
  };
}

// -- Notification (src/notify.py) ----------------------------------------

export const NOTIFY_MIN_SCORE = 70;

/**
 * `unsent`: company plus title is one advertisement, whatever the city. Storage
 * keeps the cities apart; sending collapses them.
 */
export function posterKey(job: Pick<JobPosting, "company" | "title">): string {
  const company = job.company.trim().toLowerCase();
  const title = job.title.toLowerCase().replace(/[\s\W]+/g, " ").trim();
  return `${company}|${title}`;
}

// -- Tailoring (src/tailor.py, src/render.py) ----------------------------

export interface Bullet {
  id: string;
  text: string;
  rank: number;
  tags: string[];
  block: "experience" | "projects";
  parentId: string;
  parent: string;
}

export type Catalogue = Record<string, Bullet>;

export const MAX_BULLETS = 16;
export const WANT_PROJECTS = 3;
export const MAX_PER_PROJECT = 2;
export const MIN_PER_PROJECT = 2;
export const MIN_EXPERIENCE_IDS = 3;
export const MIN_PROJECT_IDS = 4;

/**
 * `validate`: the barrier. An id that is not in the catalogue, is repeated, or
 * belongs to the other block is dropped. The model only ever returns ids, so
 * it has no way to put invented text into the document.
 */
export function validateIds(rawIds: unknown, known: Catalogue, block: Bullet["block"]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(rawIds) ? rawIds : []) {
    const id = String(raw).trim();
    const bullet = Object.hasOwn(known, id) ? known[id] : undefined;
    if (bullet && !seen.has(id) && bullet.block === block) {
      seen.add(id);
      kept.push(id);
    } else {
      dropped.push(id);
    }
  }
  return { kept: kept.slice(0, MAX_BULLETS), dropped };
}

/**
 * `balance_projects`: at most three projects, two bullets each, and a project
 * with fewer than two is removed, so no project on the page looks thin. A rule
 * in code, because a model forgets an instruction and code does not.
 */
export function balanceProjects(ids: string[], known: Catalogue): string[] {
  const byProject = new Map<string, string[]>();
  for (const id of ids) {
    const project = known[id].parentId;
    byProject.set(project, [...(byProject.get(project) ?? []), id]);
  }
  const keep = new Map<string, string[]>();
  for (const [project, bullets] of byProject) {
    if (bullets.length >= MIN_PER_PROJECT && keep.size < WANT_PROJECTS) keep.set(project, bullets.slice(0, MAX_PER_PROJECT));
  }
  if (keep.size === 0 && byProject.size > 0) {
    const [first, bullets] = [...byProject.entries()][0];
    keep.set(first, bullets);
  }
  const allowed = new Set([...keep.values()].flat());
  return ids.filter((id) => allowed.has(id));
}

/** `render._bullets`: within one entry, the owner's rank decides the order, not the model. */
export function orderByRank(ids: string[], known: Catalogue): string[] {
  return [...ids].sort((a, b) => known[a].rank - known[b].rank);
}

// -- Webhook (supabase/functions/telegram-webhook/index.ts) --------------

export const CALLBACK_PATTERN = /^([a-z]{1,2}):(\d{1,12})$/;

export const DECIDE = { a: "applied", s: "skipped", l: "later" } as const;
export const CONFIRM = { c: true, n: false } as const;
export const OUTCOME = { or: "reply", oi: "interview", of: "offer", oj: "rejected", on: "none" } as const;

export interface CallbackRequest {
  secretHeader: string | null;
  chatId: string;
  data: string;
}

export type CallbackResult =
  | { accepted: false; layer: 1 | 2 | 3; httpStatus: number; reply: string }
  | {
      accepted: true;
      jobId: number;
      key: string;
      write: { status: string; confirmed?: boolean; outcome?: string };
    };

/**
 * The three checks the function makes before it writes anything: the shared
 * secret header, the chat allow-list, then the shape and key of the data.
 */
export function verifyCallback(request: CallbackRequest, config: { secret: string; allowedChat: string }): CallbackResult {
  if (request.secretHeader !== config.secret) {
    return { accepted: false, layer: 1, httpStatus: 403, reply: "forbidden" };
  }
  if (request.chatId !== config.allowedChat) {
    return { accepted: false, layer: 2, httpStatus: 200, reply: "unauthorised alert; nothing written" };
  }
  const match = CALLBACK_PATTERN.exec(request.data);
  if (!match) return { accepted: false, layer: 3, httpStatus: 200, reply: "answered '?'; nothing written" };

  const [, key, id] = match;
  const jobId = Number(id);
  if (Object.hasOwn(DECIDE, key)) return { accepted: true, jobId, key, write: { status: DECIDE[key as keyof typeof DECIDE] } };
  if (Object.hasOwn(CONFIRM, key)) {
    return { accepted: true, jobId, key, write: { status: "applied", confirmed: CONFIRM[key as keyof typeof CONFIRM] } };
  }
  if (Object.hasOwn(OUTCOME, key)) {
    return { accepted: true, jobId, key, write: { status: "applied", confirmed: true, outcome: OUTCOME[key as keyof typeof OUTCOME] } };
  }
  return { accepted: false, layer: 3, httpStatus: 200, reply: "unknown key answered '?'; nothing written" };
}

// -- Follow-up (src/followup.py) -----------------------------------------

export const CONFIRM_AFTER_HOURS = 1;
export const OUTCOME_AFTER_DAYS = 7;
export const AUTO_CLOSE_DAYS = 21;
