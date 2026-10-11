import type { Scenario, ScenarioContext } from "../../session";
import { sha256Hex } from "../../sha256";
import type { Json } from "../../types";
import {
  AUTO_CLOSE_DAYS,
  CONFIRM_AFTER_HOURS,
  MAX_ATTEMPTS,
  MIN_EXPERIENCE_IDS,
  MIN_PROJECT_IDS,
  NOTIFY_MIN_SCORE,
  OUTCOME_AFTER_DAYS,
  backoffSeconds,
  balanceProjects,
  combineScores,
  contentHash,
  evaluate,
  isDailyQuota,
  normalise,
  orderByRank,
  parseScored,
  posterKey,
  validateIds,
  verifyCallback,
  type CallbackRequest,
  type FirstPass,
  type JobPosting,
  type Refutation,
} from "./rules";
import {
  JOB_PRESETS,
  MODELS,
  MODEL_PROFILES,
  NEW_JOB_ID,
  OTHER_CITY_JOB_ID,
  SAMPLE_CANDIDATE,
  SAMPLE_COMPANY,
  SAMPLE_POLICY,
  SCRIPTED,
  SCRIPTED_TAILOR,
  SCRIPTED_TAILOR_INVENTED,
  SCRIPTED_TAILOR_THIN,
  STORED_JOB_ID,
  WEBHOOK_CONFIG,
  sampleCatalogue,
  type ModelProfile,
} from "./world";

export const TRIAGE_SCENARIO_ID = "triage.posting-to-decision";

export const TRIAGE_STEPS = [
  "job.fingerprint",
  "job.dedupe",
  "policy.gate",
  "llm.score",
  "llm.refute",
  "score.save",
  "notify.select",
  "llm.tailor",
  "cv.render",
  "telegram.send",
  "human.decide",
  "webhook.verify",
  "decision.record",
  "followup.confirm",
  "followup.outcome",
] as const;

export const TRIAGE_FAULTS = [
  "repost",
  "rate-limit",
  "daily-quota",
  "invalid-json",
  "score-out-of-range",
  "refuter-fails",
  "same-role-other-city",
  "invented-ids",
  "tailor-fails",
  "forged-webhook",
  "wrong-chat",
  "malformed-callback",
  "double-tap",
] as const;

export type TriageFaultId = (typeof TRIAGE_FAULTS)[number];

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export interface TriageInput {
  title: string;
  location: string;
  workMode: WorkMode;
  description: string;
  modelProfile: ModelProfile;
}

export const TRIAGE_PRESETS = JOB_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.label,
  description: preset.description,
  input: {
    title: preset.job.title,
    location: preset.job.location,
    workMode: preset.job.remoteType as WorkMode,
    description: preset.job.description,
    modelProfile: preset.modelProfile,
  } satisfies TriageInput,
}));

export const TRIAGE_DEFAULT_INPUT: TriageInput = TRIAGE_PRESETS[0].input;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function validateTriageInput(raw: Partial<Record<keyof TriageInput, unknown>>): {
  ok: boolean;
  value: TriageInput;
  errors: Partial<Record<keyof TriageInput, string>>;
} {
  const errors: Partial<Record<keyof TriageInput, string>> = {};

  const title = String(raw.title ?? "").replace(CONTROL_CHARS, " ").trim();
  if (!title) errors.title = "Enter a job title.";
  else if (title.length > 80) errors.title = "Keep the title under 80 characters.";

  const location = String(raw.location ?? "").replace(CONTROL_CHARS, " ").trim();
  if (location.length > 60) errors.location = "Keep the location under 60 characters.";

  const workMode = WORK_MODES.find((mode) => mode === raw.workMode);
  if (!workMode) errors.workMode = "Choose a work mode.";

  const description = String(raw.description ?? "").replace(CONTROL_CHARS, " ").trim();
  if (!description) errors.description = "Enter a description.";
  else if (description.length > 600) errors.description = "Keep the description under 600 characters.";

  const modelProfile = MODEL_PROFILES.find((profile) => profile === raw.modelProfile);
  if (!modelProfile) errors.modelProfile = "Choose what the scripted model answers.";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      title: title.slice(0, 80),
      location: location.slice(0, 60),
      workMode: workMode ?? "remote",
      description: description.slice(0, 600),
      modelProfile: modelProfile ?? "strong fit",
    },
  };
}

/** Simulated latencies in virtual milliseconds. They pace playback; they are not measurements. */
const LATENCY = { hash: 3, dbRead: 120, dbWrite: 160, policy: 2, modelCall: 2_400, failedCall: 400, telegram: 500, webhook: 180 } as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A fixed instant, so recorded timestamps are the same on every run. */
const BASE_EPOCH_MS = Date.UTC(2026, 2, 16, 9, 7, 0);
const SCORER_VERSION = "v1";

function iso(virtualMs: number): string {
  return new Date(BASE_EPOCH_MS + virtualMs).toISOString();
}

function snap(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function* run({ input, faults, t }: ScenarioContext<TriageInput>): Generator<void, void, string> {
  const catalogue = sampleCatalogue();
  const job: JobPosting = {
    company: SAMPLE_COMPANY,
    title: input.title,
    location: input.location,
    remoteType: input.workMode,
    description: input.description,
  };

  // -- 1. Fingerprint ----------------------------------------------------
  t.start("job.fingerprint", {
    source: "job board API (sample)",
    external_id: "req-7781",
    url: "https://jobs.example.test/req-7781",
    company_name: job.company,
    title: job.title,
    location: job.location,
    remote_type: job.remoteType,
    description: job.description,
  });
  t.advance(LATENCY.hash);
  const hash = contentHash(job);
  t.log("info", "Hashed the company, title, location and the first 4,000 characters of the description, all normalised.");
  t.log("info", "The external id and the URL are not part of the hash, so a repost under a new id is the same job.");
  t.ok({ content_hash: hash, normalised_title: normalise(job.title), normalised_location: normalise(job.location) });

  // -- 2. Dedupe ---------------------------------------------------------
  t.start("job.dedupe", { lookup: "jobs.content_hash", content_hash: hash });
  t.advance(LATENCY.dbRead);
  if (faults.has("repost")) {
    const before = { id: STORED_JOB_ID, external_id: "req-6120", content_hash: hash, last_seen_at: iso(-3 * DAY) };
    t.change("jobs", "update", String(STORED_JOB_ID), before, { ...before, last_seen_at: iso(t.time) });
    t.log("info", `The hash is already stored as job ${STORED_JOB_ID} under another external id. Only its last-seen time changes.`);
    t.ok({ known: true, job_id: STORED_JOB_ID, inserted: 0 });
    t.skipRemaining("The posting was already stored, so there is nothing new to score or send.");
    t.finish("success", `Repost detected: this is job ${STORED_JOB_ID} again. It is not scored or sent a second time.`, {
      jobId: STORED_JOB_ID,
      inserted: 0,
    });
    return;
  }
  const jobId = NEW_JOB_ID;
  t.change("jobs", "insert", String(jobId), null, {
    id: jobId,
    company_name: job.company,
    title: job.title,
    location: job.location,
    remote_type: job.remoteType,
    content_hash: hash,
    first_seen_at: iso(t.time),
    last_seen_at: iso(t.time),
  });
  t.advance(LATENCY.dbWrite);
  t.log("info", `New posting stored as job ${jobId}. A job with no score row is, by definition, waiting to be scored.`);
  t.ok({ known: false, job_id: jobId, inserted: 1 });

  // -- 3. Policy gate ----------------------------------------------------
  t.start("policy.gate", {
    title: job.title,
    location: job.location,
    remote_type: job.remoteType,
    policy: {
      max_years_required: SAMPLE_POLICY.seniority.maxYearsRequired,
      exclude_senior_in_title: SAMPLE_POLICY.seniority.excludeSeniorInTitle,
      countries: SAMPLE_POLICY.countries,
    },
  });
  t.advance(LATENCY.policy);
  const verdict = evaluate(job, SAMPLE_POLICY);
  t.log("info", "Regular expressions only. No model is involved in this step, so it is free, instant and repeatable.");
  if (!verdict.eligible) {
    t.log("warn", verdict.reason);
    t.ok(snap(verdict));
    t.skipRemaining("Filtered out by the policy before any model was called.");
    t.finish("success", `Filtered out: ${verdict.reason} No model was called for this posting.`, {
      jobId,
      eligible: false,
      reason: verdict.reason,
    });
    return;
  }
  t.log("info", `Eligible: ${verdict.reason}`);
  t.ok(snap(verdict));

  // -- 4. First-pass score -----------------------------------------------
  const script = SCRIPTED[input.modelProfile];
  let model: string = MODELS[0];
  const scoreRequest = (name: string): Json => ({
    model: name,
    response_mime_type: "application/json",
    response_schema: ["score", "verdict", "matched", "gaps", "reasoning"],
    prompt: {
      rubric: "five anchored score bands",
      candidate: snap(SAMPLE_CANDIDATE),
      job: { title: job.title, company: job.company, location: job.location || "not stated", work_mode: job.remoteType },
    },
    never_sent: ["name", "email", "phone", "links"],
  });

  if (faults.has("rate-limit")) {
    const errors = ["429 RESOURCE_EXHAUSTED: per-minute limit reached, 'retryDelay': '7s'", "503 UNAVAILABLE: the model is overloaded"];
    for (const [attempt, message] of errors.entries()) {
      t.start("llm.score", scoreRequest(model));
      t.advance(LATENCY.failedCall);
      const wait = backoffSeconds(message, attempt) * 1000;
      t.log("warn", `${message}. Waiting ${wait / 1000} s: the server's hint when it gives one, otherwise 2 to the power of the attempt, plus half a second.`);
      t.fail(message.startsWith("429") ? "HTTP_429" : "HTTP_503", message, wait);
      t.advance(wait);
    }
  } else if (faults.has("daily-quota")) {
    const message = "429 RESOURCE_EXHAUSTED: quota exceeded for GenerateRequestsPerDay";
    t.start("llm.score", scoreRequest(model));
    t.advance(LATENCY.failedCall);
    t.log("warn", `${message}. isDailyQuota is ${isDailyQuota(message)}: waiting will not help, so the next model is tried at once.`);
    t.fail("DAILY_QUOTA", message, 0);
    model = MODELS[1];
  }

  t.start("llm.score", scoreRequest(model));
  t.advance(LATENCY.modelCall);
  const rawFirst = faults.has("invalid-json")
    ? '{"score": 86, "verdict": "good", "matched": ["Python automation"'
    : JSON.stringify(faults.has("score-out-of-range") ? { ...script.first, score: 140 } : script.first);
  t.log("info", `Scripted answer for the profile "${input.modelProfile}". No model was called.`);
  const parsedFirst = parseScored<FirstPass>(rawFirst);
  if (!parsedFirst.ok) {
    t.log("error", `${parsedFirst.error} The response schema constrains the shape of the answer, not its meaning.`);
    t.change("score_attempts", "insert", `${jobId}:${SCORER_VERSION}`, null, {
      job_id: jobId,
      scorer_version: SCORER_VERSION,
      attempts: 1,
      last_error: parsedFirst.error,
      last_try_at: iso(t.time),
    });
    t.fail("INVALID_OUTPUT", `${parsedFirst.error} Attempt 1 of ${MAX_ATTEMPTS} recorded.`);
    t.skipRemaining("Scoring failed, so there is nothing to send.");
    t.finish(
      "failed",
      `Scoring failed: ${parsedFirst.error} The job still has no score row, so the next hourly run picks it up again. After ${MAX_ATTEMPTS} failed attempts it is left out of the queue.`,
      { jobId, scored: false, attempts: 1 },
    );
    return;
  }
  const first = parsedFirst.value;
  if (model !== MODELS[0]) t.log("info", "The model that answered moves to the front of the list for the rest of the run.");
  t.log("info", "Parsed as JSON and checked: the score is an integer between 0 and 100.");
  t.ok({ model, ...snap(first) as Record<string, Json> });

  // -- 5. Adversarial pass -----------------------------------------------
  t.start("llm.refute", {
    model,
    sees: { claimed_strengths: first.matched },
    does_not_see: ["the first pass's score"],
    instruction: "When unsure whether a requirement is met, treat it as not met.",
    response_schema: ["unmet", "score", "verdict", "note"],
  });
  let refutation: Refutation | null = null;
  let refuterNote: string;
  if (faults.has("refuter-fails")) {
    t.advance(LATENCY.failedCall);
    refuterNote = "ClientError: 400 INVALID_ARGUMENT (injected)";
    t.log("warn", "The second call failed with an error that is not worth retrying.");
    t.ok({ refutation: null, error: refuterNote }, "The adversarial pass failed, so the first score stands unchallenged. A missing challenge is better than a job with no score.");
  } else {
    t.advance(LATENCY.modelCall);
    refutation = script.refutation;
    refuterNote = refutation.note;
    t.log("info", `Scripted answer for the profile "${input.modelProfile}". No model was called.`);
    t.ok({ model, ...snap(refutation) as Record<string, Json> });
  }

  // -- 6. Combine and store ----------------------------------------------
  t.start("score.save", { first_pass: first.score, refuter: refutation?.score ?? null, rule: "final = the lower of the two" });
  const combined = combineScores(first, refutation);
  const drop = combined.scoreInitial - combined.scoreFinal;
  t.change("scores", "insert", `${jobId}:${SCORER_VERSION}`, null, {
    job_id: jobId,
    scorer_version: SCORER_VERSION,
    model,
    cv_version: sha256Hex("sample cv file").slice(0, 12),
    score_initial: combined.scoreInitial,
    refuter_score: combined.refuterScore,
    refuter_notes: refuterNote,
    score_final: combined.scoreFinal,
    verdict: combined.verdict,
    matched: combined.matched,
    gaps: combined.gaps,
    reasoning: first.reasoning,
  });
  t.advance(LATENCY.dbWrite);
  t.log(
    "info",
    refutation
      ? `Final score ${combined.scoreFinal}: the lower of ${first.score} and ${refutation.score}${drop > 0 ? `, a drop of ${drop}` : ""}.`
      : `Final score ${combined.scoreFinal}: the first pass, with no second opinion.`,
  );
  t.log("info", "The row is keyed by job and scorer version, so changing the prompt re-queues every job and keeps the old scores for comparison.");
  t.ok(snap(combined));

  // -- 7. Select for notification ----------------------------------------
  t.start("notify.select", { min_score: NOTIFY_MIN_SCORE, score_final: combined.scoreFinal, poster_key: posterKey(job), max_per_run: 5 });
  t.advance(LATENCY.dbRead);
  if (combined.scoreFinal < NOTIFY_MIN_SCORE) {
    const reason = `Score ${combined.scoreFinal} is below the threshold of ${NOTIFY_MIN_SCORE}.`;
    t.log("info", reason);
    t.ok({ selected: false, reason });
    t.skipRemaining("The score is below the notification threshold.");
    t.finish(
      "success",
      drop > 0
        ? `Not sent. The first pass scored ${first.score}, which would have been sent; the adversarial pass scored ${refutation?.score}, so the final score is ${combined.scoreFinal}.`
        : `Not sent: the final score of ${combined.scoreFinal} is below the threshold of ${NOTIFY_MIN_SCORE}. The score is stored.`,
      { jobId, scoreInitial: combined.scoreInitial, scoreFinal: combined.scoreFinal, sent: false },
    );
    return;
  }
  if (faults.has("same-role-other-city")) {
    const reason = `The same company and title were already delivered for another city (job ${OTHER_CITY_JOB_ID}).`;
    t.log("info", `${reason} Storage keeps the two cities apart; sending treats them as one advertisement.`);
    t.ok({ selected: false, reason, already_delivered_job: OTHER_CITY_JOB_ID });
    t.skipRemaining("The same advertisement was already delivered.");
    t.finish("success", `Stored and scored ${combined.scoreFinal}, but not sent: ${reason}`, {
      jobId,
      scoreFinal: combined.scoreFinal,
      sent: false,
    });
    return;
  }
  t.log("info", `Score ${combined.scoreFinal} clears the threshold and there is no delivery row for this job.`);
  t.ok({ selected: true });

  // -- 8. Tailor the CV by id --------------------------------------------
  t.start("llm.tailor", {
    model,
    catalogue: Object.values(catalogue).map((item) => `${item.id}: ${item.text} (${item.tags.join(", ")})`),
    instruction: "Return ids from this list only. Nothing else exists.",
    response_schema: ["experience_ids", "project_ids", "headline", "note"],
  });
  t.advance(LATENCY.modelCall);
  const rawTailor = faults.has("invented-ids") ? SCRIPTED_TAILOR_INVENTED : faults.has("tailor-fails") ? SCRIPTED_TAILOR_THIN : SCRIPTED_TAILOR;
  t.log("info", "Scripted answer. No model was called.", { experience_ids: rawTailor.experience_ids, project_ids: rawTailor.project_ids });
  const experience = validateIds(rawTailor.experience_ids, catalogue, "experience");
  const projects = validateIds(rawTailor.project_ids, catalogue, "projects");
  const balanced = balanceProjects(projects.kept, catalogue);
  const dropped = [...experience.dropped, ...projects.dropped];
  const unbalanced = projects.kept.filter((id) => !balanced.includes(id));
  if (dropped.length > 0) {
    t.log("warn", `Dropped ids that are unknown, repeated or in the wrong section: ${dropped.join(", ")}.`);
  }
  if (unbalanced.length > 0) {
    t.log("info", `Project balance removed ${unbalanced.join(", ")}: a project is shown with two bullets or not at all.`);
  }
  let bulletIds: string[] | null = null;
  if (experience.kept.length < MIN_EXPERIENCE_IDS || balanced.length < MIN_PROJECT_IDS) {
    const error = `Only ${experience.kept.length} experience and ${balanced.length} project bullets survived validation: too few.`;
    t.log("error", error);
    t.ok(
      { tailored: false, error, dropped },
      "Tailoring failed, so the posting is sent without a CV. A posting that arrives without a CV is better than one that does not arrive.",
    );
  } else {
    bulletIds = [...experience.kept, ...balanced];
    t.ok({
      tailored: true,
      bullet_ids: bulletIds,
      dropped,
      headline_from_model: rawTailor.headline,
      headline_used: "the title in the CV file; the model's headline is not rendered",
      note: rawTailor.note,
    });
  }

  // -- 9. Build the CV ---------------------------------------------------
  if (!bulletIds) {
    t.skip("cv.render", "Tailoring failed, so there is no CV to build.");
  } else {
    const chosen = bulletIds;
    t.start("cv.render", { bullet_ids: chosen });
    t.advance(900);
    const parents = [...new Set(chosen.map((id) => catalogue[id].parentId))];
    const sections = parents.map((parentId) => {
      const ids = orderByRank(
        chosen.filter((id) => catalogue[id].parentId === parentId),
        catalogue,
      );
      return { entry: catalogue[ids[0]].parent, bullets: ids.map((id) => `${id}: ${catalogue[id].text}`) };
    });
    t.log("info", "Every line is read from the CV file by id. Within an entry the owner's rank decides the order, not the model.");
    t.log("info", "The real pipeline renders one A4 page with headless Chromium. This simulation stops at the selected text.");
    t.ok({ sections, pdf: "not rendered in this simulation" });
  }

  // -- 10. Send to Telegram ----------------------------------------------
  const keyboard = [
    { text: "Applied", callback_data: `a:${jobId}` },
    { text: "Not suitable", callback_data: `s:${jobId}` },
    { text: "Later", callback_data: `l:${jobId}` },
  ];
  t.start("telegram.send", {
    method: bulletIds ? "sendDocument" : "sendMessage",
    chat_id: "••••••••",
    caption: {
      score: combined.scoreFinal,
      company: job.company,
      title: job.title,
      location: job.location || "not stated",
      matched: combined.matched.slice(0, 3),
      gaps: combined.gaps.slice(0, 3),
      reasoning: first.reasoning,
    },
    reply_markup: { inline_keyboard: [keyboard] },
  });
  t.advance(LATENCY.telegram);
  const delivery = {
    job_id: jobId,
    channel: "telegram",
    message_id: 9001,
    score_at_send: combined.scoreFinal,
    bullet_ids: bulletIds,
    sent_at: iso(t.time),
    error: null,
  };
  t.change("deliveries", "insert", `${jobId}:telegram`, null, snap(delivery));
  t.log("info", "A delivery row is written whether the send works or fails. Recording only successes would retry a failing send every hour.");
  t.log("info", "No message is sent by this simulation.");
  t.ok({ message_id: delivery.message_id, attachment: bulletIds ? "tailored CV" : "none", buttons: keyboard.map((button) => button.text) });

  // -- 11. Human decision ------------------------------------------------
  t.start("human.decide", { message_id: delivery.message_id, buttons: snap(keyboard) });
  t.wait("You are the candidate. The posting has arrived with its score, its gaps and a CV. The pipeline never applies for you. What do you tap?", [
    { id: "applied", label: "Applied", description: "You intend to apply through the posting's own link." },
    { id: "skipped", label: "Not suitable", description: "The score was wrong about this one." },
    { id: "later", label: "Later", description: "Decide another time." },
  ]);
  const decision = yield;
  t.resumed(decision);
  const decisionKey = decision === "applied" ? "a" : decision === "skipped" ? "s" : "l";
  const callbackData = `${decisionKey}:${jobId}`;
  t.log("info", "Human step: the time taken to decide is not simulated.");
  t.ok({ tapped: decision, callback_data: callbackData });

  // -- 12. Verify the webhook --------------------------------------------
  t.start("webhook.verify", {
    request: "POST /functions/v1/telegram-webhook",
    headers: { "x-telegram-bot-api-secret-token": "••••••••" },
    body: { callback_query: { data: callbackData, message: { chat: { id: "••••••••" } } } },
  });
  t.advance(LATENCY.webhook);
  const genuine: CallbackRequest = { secretHeader: WEBHOOK_CONFIG.secret, chatId: WEBHOOK_CONFIG.allowedChat, data: callbackData };
  const hostile: { label: string; request: CallbackRequest } | null = faults.has("forged-webhook")
    ? { label: "A request without the secret header", request: { ...genuine, secretHeader: null } }
    : faults.has("wrong-chat")
      ? { label: "A request with the right secret from another chat", request: { ...genuine, chatId: "999000111" } }
      : faults.has("malformed-callback")
        ? { label: "A request whose data is not a key and a number", request: { ...genuine, data: `a:${jobId}; drop table applications` } }
        : null;
  const rejected: Json[] = [];
  if (hostile) {
    const result = verifyCallback(hostile.request, WEBHOOK_CONFIG);
    if (!result.accepted) {
      t.log("warn", `${hostile.label} arrived first. Rejected at check ${result.layer} of 3 (HTTP ${result.httpStatus}): ${result.reply}.`);
      rejected.push({ check: result.layer, http_status: result.httpStatus, reply: result.reply });
    }
    t.advance(LATENCY.webhook);
  }
  const accepted = verifyCallback(genuine, WEBHOOK_CONFIG);
  if (!accepted.accepted) throw new Error("The genuine callback was rejected.");
  t.log("info", "Check 1: the secret header matches. Check 2: the chat is the allowed one. Check 3: the data is a known key and a number.");
  t.ok({ accepted: true, job_id: accepted.jobId, key: accepted.key, rejected_first: rejected });

  // -- 13. Record the decision -------------------------------------------
  t.start("decision.record", { upsert: snap(accepted.write), on_conflict: "job_id" });
  const application: Record<string, Json> = {
    job_id: jobId,
    status: accepted.write.status,
    decided_at: iso(t.time),
    confirmed: null,
    asked_at: null,
    outcome: null,
    outcome_asked_at: null,
    notes: null,
  };
  const decidedAt = t.time;
  t.change("applications", "insert", String(jobId), null, snap(application));
  t.advance(LATENCY.dbWrite);
  t.log("info", "The tap is answered with a toast, and the three buttons are replaced by the chosen label.");
  if (faults.has("double-tap")) {
    t.advance(700);
    const before = snap(application);
    application.decided_at = iso(t.time);
    t.change("applications", "update", String(jobId), before, snap(application));
    t.log("info", "The button was tapped a second time. The write is an upsert on the job id, so the same row is updated.");
  }
  t.ok({ rows_for_this_job: 1, status: application.status });

  if (decision !== "applied") {
    t.skipRemaining("There is no follow-up for a posting that was not applied to.");
    t.finish("success", `Recorded as "${application.status}". No follow-up is scheduled.`, {
      jobId,
      scoreFinal: combined.scoreFinal,
      sent: true,
      status: application.status,
    });
    return;
  }

  // -- 14. Follow-up: did you really apply? ------------------------------
  t.advance(CONFIRM_AFTER_HOURS * HOUR);
  t.start("followup.confirm", {
    query: { status: "applied", confirmed: null, asked_at: null, decided_before: `${CONFIRM_AFTER_HOURS} hour ago` },
    job_id: jobId,
  });
  {
    const before = snap(application);
    application.asked_at = iso(t.time);
    t.change("applications", "update", String(jobId), before, snap(application));
  }
  t.log("info", "The question is stamped as asked even when the send fails, so the same question is never sent twice.");
  t.wait("One hour later the pipeline asks whether the intention became an application. Did you finish applying?", [
    { id: "yes", label: "Yes, I applied" },
    { id: "no", label: "No, I did not finish" },
  ]);
  const confirmation = yield;
  t.resumed(confirmation);
  {
    const answer = verifyCallback({ ...genuine, data: `${confirmation === "yes" ? "c" : "n"}:${jobId}` }, WEBHOOK_CONFIG);
    if (!answer.accepted) throw new Error("The confirmation callback was rejected.");
    const before = snap(application);
    application.confirmed = answer.write.confirmed ?? null;
    t.change("applications", "update", String(jobId), before, snap(application));
  }
  t.log("info", 'Tapping "Applied" records an intention. This answer records what actually happened, and the two are stored separately.');
  t.ok({ confirmed: application.confirmed });

  if (application.confirmed !== true) {
    t.skipRemaining("The application was not completed, so there is no outcome to ask about.");
    t.finish("success", "Recorded as intended but not applied. Keeping that apart from real applications keeps the outcome data honest.", {
      jobId,
      scoreFinal: combined.scoreFinal,
      status: "applied",
      confirmed: false,
    });
    return;
  }

  // -- 15. Follow-up: what happened? -------------------------------------
  t.advance(OUTCOME_AFTER_DAYS * DAY);
  t.start("followup.outcome", {
    query: { confirmed: true, outcome: null, outcome_asked_at: null, decided_before: `${OUTCOME_AFTER_DAYS} days ago` },
    job_id: jobId,
  });
  {
    const before = snap(application);
    application.outcome_asked_at = iso(t.time);
    t.change("applications", "update", String(jobId), before, snap(application));
  }
  t.wait(`${OUTCOME_AFTER_DAYS} days later it asks what happened.`, [
    { id: "interview", label: "An interview" },
    { id: "rejected", label: "A rejection" },
    { id: "silence", label: "I never answer the question", description: `The pipeline closes it by itself after ${AUTO_CLOSE_DAYS} days.` },
  ]);
  const outcome = yield;
  t.resumed(outcome);
  {
    const before = snap(application);
    if (outcome === "silence") {
      t.advance(Math.max(0, decidedAt + AUTO_CLOSE_DAYS * DAY - t.time));
      application.outcome = "none";
      application.outcome_at = iso(t.time);
      application.notes = `auto-closed after ${AUTO_CLOSE_DAYS} days`;
      t.log("info", `No button was pressed. ${AUTO_CLOSE_DAYS} days after the decision the application is closed as "none": silence is an answer, and recording it keeps the sample complete.`);
    } else {
      const answer = verifyCallback({ ...genuine, data: `${outcome === "interview" ? "oi" : "oj"}:${jobId}` }, WEBHOOK_CONFIG);
      if (!answer.accepted) throw new Error("The outcome callback was rejected.");
      application.outcome = answer.write.outcome ?? null;
      application.outcome_at = iso(t.time);
    }
    t.change("applications", "update", String(jobId), before, snap(application));
  }
  t.ok({ outcome: application.outcome });

  t.finish(
    "success",
    `Applied, confirmed, outcome "${application.outcome}". Score ${combined.scoreFinal} now has a real result next to it. Measuring how well scores predict outcomes is planned and not built yet.`,
    { jobId, scoreFinal: combined.scoreFinal, status: "applied", confirmed: true, outcome: application.outcome },
  );
}

export const triageScenario: Scenario<TriageInput> = {
  id: TRIAGE_SCENARIO_ID,
  stepIds: TRIAGE_STEPS,
  run,
};
