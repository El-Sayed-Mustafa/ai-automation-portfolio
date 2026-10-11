/**
 * Invented data for the job-triage demo: a sample policy, a sample CV made of
 * numbered bullets, sample postings and the scripted answers of the model.
 *
 * None of it comes from the real project's configuration, CV or database.
 */

import type { Bullet, Catalogue, FirstPass, JobPosting, Refutation, TargetingPolicy } from "./rules";

export const SAMPLE_POLICY: TargetingPolicy = {
  roles: {
    include: ["\\b(ai|ml|automation|backend|data|python)\\b.*\\b(engineer|developer)\\b"],
    exclude: ["\\b(ios|android|frontend|sales|intern|manager)\\b"],
  },
  seniority: { maxYearsRequired: 5, excludeSeniorInTitle: true },
  eligibility: {
    blocking: [
      "(?:no|without|not\\s+(?:offer|provide)\\w*)\\s+(?:visa\\s+)?sponsorship",
      "must\\s+(?:already\\s+)?(?:be\\s+authori[sz]ed|have\\s+the\\s+right)\\s+to\\s+work",
      "citizens?\\s+only",
    ],
    open: ["visa\\s+sponsorship", "relocation\\s+(?:support|package|assistance)", "we\\s+sponsor"],
  },
  countries: {
    1: ["Netherlands", "Germany"],
    2: ["Spain", "Portugal"],
    3: ["Poland"],
    4: ["United States", "United Kingdom"],
  },
};

function bullet(id: string, block: Bullet["block"], parentId: string, parent: string, rank: number, text: string, tags: string[]): Bullet {
  return { id, block, parentId, parent, rank, text, tags };
}

const BULLETS: Bullet[] = [
  bullet("b1", "experience", "x1", "Automation Engineer, Sample Company", 2, "Built webhook-driven intake that turns inbound messages into validated records.", ["webhooks", "python"]),
  bullet("b2", "experience", "x1", "Automation Engineer, Sample Company", 1, "Moved a reporting workload from spreadsheets to PostgreSQL behind a small API.", ["postgresql", "api"]),
  bullet("b3", "experience", "x1", "Automation Engineer, Sample Company", 4, "Wrote scheduled jobs with retries and a run ledger for every execution.", ["scheduling", "reliability"]),
  bullet("b4", "experience", "x1", "Automation Engineer, Sample Company", 3, "Integrated three third-party REST APIs with rate-limit handling.", ["rest", "integrations"]),
  bullet("b5", "experience", "x1", "Automation Engineer, Sample Company", 5, "Kept internal documentation for the systems the team ran.", ["documentation"]),
  bullet("b6", "projects", "p1", "Posting triage pipeline", 2, "Scored postings with a hosted model behind a JSON schema and a range check.", ["llm", "validation"]),
  bullet("b7", "projects", "p1", "Posting triage pipeline", 1, "Added a second, adversarial pass and kept the lower of the two scores.", ["llm", "evaluation"]),
  bullet("b8", "projects", "p1", "Posting triage pipeline", 3, "Used database rows as the work queue so a failed run resumes by itself.", ["postgresql", "queues"]),
  bullet("b9", "projects", "p2", "Operations dashboard", 1, "Aggregated daily exports into cached summaries served to a web dashboard.", ["etl", "dashboards"]),
  bullet("b10", "projects", "p2", "Operations dashboard", 2, "Deduplicated overlapping exports at the aggregation cell.", ["etl", "data-quality"]),
  bullet("b11", "projects", "p3", "Field-service CRM", 1, "Deferred notifications through an outbox with retry and backoff.", ["outbox", "reliability"]),
  bullet("b12", "projects", "p3", "Field-service CRM", 2, "Enforced booking conflict rules on the server.", ["api", "validation"]),
  bullet("b13", "projects", "p4", "Lead enrichment scripts", 1, "Matched scraped listings to licence records with a scored name comparison.", ["scraping", "matching"]),
];

export function sampleCatalogue(): Catalogue {
  return Object.fromEntries(BULLETS.map((item) => [item.id, { ...item, tags: [...item.tags] }]));
}

/** What is sent to the model about the candidate: no name, contact details or links. */
export const SAMPLE_CANDIDATE = {
  skills: ["Python", "PostgreSQL", "REST APIs", "Webhooks", "Scheduled jobs"],
  not_experienced_with: ["Kubernetes", "Mobile development"],
  seeking: ["AI automation", "Backend engineering"],
} as const;

export const SAMPLE_COMPANY = "Northwind Labs (sample)";

/** A posting already stored by an earlier run, used by the repost fault. */
export const STORED_JOB_ID = 4101;
/** The id the new posting receives when it is stored. */
export const NEW_JOB_ID = 4102;
/** An earlier delivery of the same role in another city, used by the second-city fault. */
export const OTHER_CITY_JOB_ID = 4090;

export const WEBHOOK_CONFIG = { secret: "sample-secret", allowedChat: "100200300" } as const;

/** Placeholder names: the real model ids are configuration and are not reproduced. */
export const MODELS = ["model-a (primary)", "model-b (fallback)"] as const;

export type ModelProfile = "strong fit" | "first pass too generous" | "weak fit";
export const MODEL_PROFILES: ModelProfile[] = ["strong fit", "first pass too generous", "weak fit"];

interface ScriptedAnswers {
  first: FirstPass;
  refutation: Refutation;
}

/**
 * The scripted model. These answers are fixed per profile and are not produced
 * by a model; the code that checks and combines them is what the demo runs.
 */
export const SCRIPTED: Record<ModelProfile, ScriptedAnswers> = {
  "strong fit": {
    first: {
      score: 86,
      verdict: "good",
      matched: ["Python automation", "REST API integrations", "PostgreSQL"],
      gaps: ["Kubernetes in production"],
      reasoning: "Meets the core requirements. The one stated gap is container orchestration, which is listed as desirable.",
    },
    refutation: {
      unmet: ["Kubernetes in production"],
      score: 81,
      verdict: "good",
      note: "The claims hold. Slightly lower because the orchestration requirement is written as required, not desirable.",
    },
  },
  "first pass too generous": {
    first: {
      score: 84,
      verdict: "good",
      matched: ["Python automation", "LLM evaluation", "Team leadership"],
      gaps: [],
      reasoning: "Strong overlap with the automation work and the model-evaluation requirement.",
    },
    refutation: {
      unmet: ["Three years of LLM evaluation work", "Leading a team"],
      score: 58,
      verdict: "partial",
      note: "Evaluation experience is one project, not three years, and no leadership is described. Both were stretched to fit.",
    },
  },
  "weak fit": {
    first: {
      score: 44,
      verdict: "weak",
      matched: ["Python"],
      gaps: ["Distributed systems at scale", "On-call ownership"],
      reasoning: "Shares the language but is missing most of the platform requirements.",
    },
    refutation: {
      unmet: ["Distributed systems at scale", "On-call ownership"],
      score: 41,
      verdict: "weak",
      note: "Agrees with the first pass.",
    },
  },
};

export const SCRIPTED_TAILOR = {
  experience_ids: ["b2", "b1", "b4", "b3"],
  project_ids: ["b7", "b6", "b9", "b10", "b11", "b12", "b13"],
  headline: "AI and Automation Engineer",
  note: "I build automation pipelines with validated model output and a human decision at the end. Happy to walk through the triage project.",
};

/** A model answer that invents an id, repeats one and puts an experience id among the projects. */
export const SCRIPTED_TAILOR_INVENTED = {
  ...SCRIPTED_TAILOR,
  experience_ids: ["b2", "b1", "b99", "b4", "b3"],
  project_ids: ["b7", "b6", "b7", "b3", "b9", "b10", "b11", "b12", "b13"],
};

/** A model answer that leaves too little once the invalid ids are removed. */
export const SCRIPTED_TAILOR_THIN = {
  ...SCRIPTED_TAILOR,
  experience_ids: ["b2", "b98", "b99"],
  project_ids: ["b7", "b6", "b13"],
};

export interface JobPreset {
  id: string;
  label: string;
  description: string;
  job: Pick<JobPosting, "title" | "location" | "remoteType" | "description">;
  modelProfile: ModelProfile;
}

export const JOB_PRESETS: JobPreset[] = [
  {
    id: "good-match",
    label: "A good match",
    description: "Passes the policy, scores well on both passes and is sent with a tailored CV.",
    job: {
      title: "AI Automation Engineer",
      location: "Remote",
      remoteType: "remote",
      description:
        "We need someone to build Python automation around REST APIs and PostgreSQL. Experience with Kubernetes in production is required. 3 years of experience.",
    },
    modelProfile: "strong fit",
  },
  {
    id: "generous-first-pass",
    label: "First pass too generous",
    description: "The first score clears the threshold; the adversarial pass does not agree.",
    job: {
      title: "Automation Engineer",
      location: "Remote",
      remoteType: "remote",
      description:
        "Python automation role. Requires three years of LLM evaluation work and experience leading a team. 3+ years experience.",
    },
    modelProfile: "first pass too generous",
  },
  {
    id: "senior-title",
    label: "Senior in the title",
    description: "Stopped by the policy before any model is called.",
    job: {
      title: "Senior Backend Engineer",
      location: "Remote",
      remoteType: "remote",
      description: "Backend services in Python. 4 years of experience.",
    },
    modelProfile: "strong fit",
  },
  {
    id: "no-sponsorship",
    label: "No sponsorship",
    description: "An onsite role whose text rules out candidates from abroad.",
    job: {
      title: "Backend Engineer",
      location: "Amsterdam, Netherlands",
      remoteType: "onsite",
      description: "Python and PostgreSQL. Please note we do not offer visa sponsorship for this position. 2 years of experience.",
    },
    modelProfile: "strong fit",
  },
  {
    id: "too-many-years",
    label: "Eight years required",
    description: "The posting asks for more experience than the policy allows.",
    job: {
      title: "Data Engineer",
      location: "Remote",
      remoteType: "remote",
      description: "Pipelines in Python. 3 years in Python and at least 8 years of experience in distributed systems.",
    },
    modelProfile: "weak fit",
  },
];
