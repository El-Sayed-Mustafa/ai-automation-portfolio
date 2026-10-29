import { z } from "zod";

/**
 * Where a statement comes from. Every factual claim in the portfolio carries
 * one, and the UI shows it next to the claim.
 *
 * - code:       read in the project's source files
 * - documented: stated in the project's own docs, not independently re-derived
 * - owner:      stated or confirmed by the portfolio owner
 * - inferred:   deduced from evidence, still to be confirmed
 * - proposed:   an improvement that does not exist yet
 */
export const provenanceSchema = z.enum(["code", "documented", "owner", "inferred", "proposed"]);
export type Provenance = z.infer<typeof provenanceSchema>;

export const sourceRefSchema = z.object({
  /** Path inside the project repository. */
  path: z.string().min(1),
  lines: z
    .string()
    .regex(/^\d+(-\d+)?$/)
    .optional(),
  note: z.string().optional(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const claimSchema = z.object({
  text: z.string().min(1),
  provenance: provenanceSchema,
  sources: z.array(sourceRefSchema).default([]),
});
export type Claim = z.infer<typeof claimSchema>;

export const categorySchema = z.enum(["ai-engineering", "automation", "backend", "data-engineering", "business-apps"]);
export type Category = z.infer<typeof categorySchema>;

/** The same categories in a word, for tags in tight places. */
export const CATEGORY_SHORT: Record<Category, string> = {
  "ai-engineering": "AI",
  automation: "Automation",
  backend: "Backend",
  "data-engineering": "Data",
  "business-apps": "Business apps",
};

/** Colour families used to tell things apart: a project, a layer, a kind of tag. They never mean a status. */
export const toneSchema = z.enum(["indigo", "blue", "teal", "green", "violet", "amber", "rose", "slate", "cyan"]);
export type Tone = z.infer<typeof toneSchema>;

/** Icons content may name. The component that draws them owns the list. */
export const iconSchema = z.enum([
  "bug",
  "candlestick",
  "pulse",
  "briefcase",
  "star",
  "store",
  "radar",
  "refresh",
  "boxes",
  "bot",
  "workflow",
  "server",
  "database",
  "shield",
  "gauge",
  "plug",
  "sparkles",
  "chat",
  "sheet",
  "school",
]);
export type IconName = z.infer<typeof iconSchema>;

export const CATEGORY_LABELS: Record<Category, string> = {
  "ai-engineering": "AI Engineering",
  automation: "Automation",
  backend: "Backend Engineering",
  "data-engineering": "Data Engineering",
  "business-apps": "Business Applications",
};

// -- Architecture ---------------------------------------------------------

export const nodeKindSchema = z.enum([
  "frontend",
  "backend",
  "database",
  "queue",
  "worker",
  "external",
  "storage",
  "legacy",
  "actor",
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const architectureNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  layer: z.string().min(1),
  kind: nodeKindSchema,
  technology: z.string().min(1),
  status: z.enum(["active", "disabled", "legacy"]).default("active"),
  statusNote: z.string().optional(),
  responsibility: z.string().min(1),
  whyThisTechnology: claimSchema.optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  details: z.array(z.string()).default([]),
  failureModes: z.array(z.string()).default([]),
  reliability: z.array(z.string()).default([]),
  provenance: provenanceSchema,
  sources: z.array(sourceRefSchema).default([]),
  /** No longer read: the diagram places every component itself (see architecture-columns.ts). Older manifests still carry it. */
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ArchitectureNode = z.infer<typeof architectureNodeSchema>;

export const architectureEdgeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  from: z.string(),
  to: z.string(),
  /** Shown in the system view: how the two components talk. */
  protocol: z.string().min(1),
  /** Shown in the data-flow view: what moves along the connection. */
  data: z.string().min(1),
  kind: z.enum(["sync", "async", "fallback", "disabled"]).default("sync"),
});
export type ArchitectureEdge = z.infer<typeof architectureEdgeSchema>;

export const architectureFlowSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  description: z.string().min(1),
  /** Edge ids in the order the request travels. */
  path: z.array(z.string()).min(1),
});
export type ArchitectureFlow = z.infer<typeof architectureFlowSchema>;

export const architectureSchema = z.object({
  summary: z.string().min(1),
  layers: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
  nodes: z.array(architectureNodeSchema).min(1),
  edges: z.array(architectureEdgeSchema).min(1),
  flows: z.array(architectureFlowSchema).default([]),
});
export type Architecture = z.infer<typeof architectureSchema>;

// -- Workflows ------------------------------------------------------------

export const stepKindSchema = z.enum([
  "trigger",
  "transform",
  "validation",
  "database",
  "human",
  "api",
  "queue",
  "worker",
  "notification",
]);
export type StepKind = z.infer<typeof stepKindSchema>;

export const workflowStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: stepKindSchema,
  /** Architecture node this step runs on. */
  nodeId: z.string(),
  phase: z.string().min(1),
  /** One plain sentence for the recruiter lens. */
  summary: z.string().min(1),
  /** What the real code does at this step. */
  description: z.string().min(1),
  sources: z.array(sourceRefSchema).default([]),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const faultSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  stepId: z.string(),
  /**
   * implemented: the production code handles this case as shown.
   * limitation:  the production code does not handle it; the demo shows the real, imperfect behaviour.
   */
  classification: z.enum(["implemented", "limitation"]),
  description: z.string().min(1),
  expected: z.string().min(1),
  /** Faults in the same group cannot be combined. */
  group: z.string().optional(),
  sources: z.array(sourceRefSchema).default([]),
});
export type Fault = z.infer<typeof faultSchema>;

export const workflowInputFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "number"]),
  options: z.array(z.string()).optional(),
  help: z.string().optional(),
  maxLength: z.number().int().positive().optional(),
});
export type WorkflowInputField = z.infer<typeof workflowInputFieldSchema>;

export const workflowSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  /** One sentence: what running this demonstration shows. */
  proves: z.string().min(1),
  /** Key of the executable scenario in the engine registry. */
  scenarioId: z.string().min(1),
  mode: z.enum(["simulation", "live-sandbox"]),
  modeNote: z.string().min(1),
  /** Shown in the workflow library. */
  technologies: z.array(z.string().min(1)).min(1),
  phases: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
  steps: z.array(workflowStepSchema).min(1),
  inputs: z.array(workflowInputFieldSchema).default([]),
  faults: z.array(faultSchema).default([]),
  /**
   * Present when the server can also run this workflow against a database
   * (see src/sandbox). `mode` stays "simulation": that is what a visitor gets
   * by default, and what they get if the server does not answer.
   */
  sandbox: z
    .object({
      /** Shown when the visitor chooses to run on the server: what that changes, and what it does not. */
      note: z.string().min(1),
      real: z.array(z.string().min(1)).min(1),
      simulated: z.array(z.string().min(1)).min(1),
    })
    .optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;

// -- Case study content ---------------------------------------------------

export const decisionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  problem: z.string().min(1),
  options: z
    .array(z.object({ name: z.string().min(1), verdict: z.enum(["chosen", "rejected"]), note: z.string().min(1) }))
    .min(2),
  rationale: z.string().min(1),
  tradeoffs: z.array(z.string()).min(1),
  evolution: z.string().min(1),
  provenance: provenanceSchema,
  sources: z.array(sourceRefSchema).default([]),
});
export type Decision = z.infer<typeof decisionSchema>;

export const metricSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  /** Shown when there is no before/after pair. */
  value: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  kind: z.enum(["measured", "count"]),
  /** How the number was obtained. Required so no figure appears without its method. */
  method: z.string().min(1),
  provenance: provenanceSchema,
  sources: z.array(sourceRefSchema).default([]),
});
export type Metric = z.infer<typeof metricSchema>;

export const limitationSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  /** What the production system does today. */
  current: z.string().min(1),
  /** A proposed improvement. Always rendered as proposed, never as shipped. */
  proposal: z.string().min(1),
  provenance: provenanceSchema,
  sources: z.array(sourceRefSchema).default([]),
});
export type Limitation = z.infer<typeof limitationSchema>;

export const screenshotSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
  caption: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Screenshot = z.infer<typeof screenshotSchema>;

export const evidenceSchema = z.object({
  label: z.string().min(1),
  kind: z.enum(["source", "documentation", "tests", "measurements", "schema"]),
  description: z.string().min(1),
  sources: z.array(sourceRefSchema).default([]),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  /** One sentence: what was built. */
  tagline: z.string().min(1),
  /** Recruiter-facing paragraph. */
  summary: z.string().min(1),
  categories: z.array(categorySchema).min(1),
  engagement: z.enum(["client", "employer", "personal", "open-source"]),
  engagementNote: z.string().min(1),
  /** How the project is recognised in lists: an icon on a coloured tile. */
  icon: iconSchema,
  tone: toneSchema,
  /** What the system does, as short lines. Each is a claim made in full elsewhere on the page. */
  highlights: z
    .array(z.object({ text: z.string().min(1).max(90), provenance: provenanceSchema }))
    .min(3)
    .max(8),
  /** The state of the project in two or three words, for places with no room for a sentence. `status` says it in full. */
  statusLabel: z.string().min(1).max(34),
  status: claimSchema,
  /** The author's part in a few words, taken from `role`, for the same places. It may say less than `role`, never more. */
  roleLabel: z.string().min(1).max(34),
  repository: z
    .object({
      /** `owner/name` on GitHub, or a plain description when the repository is someone else's to name. */
      name: z.string().min(1),
      /** Omitted when the address is not the author's to publish, for example an employer's private repository. */
      url: z.url().optional(),
      branch: z.string().min(1).optional(),
      visibility: z.enum(["public", "private"]),
      /**
       * When false, source references render as plain text and the page
       * offers the source on request instead. Always false for a private
       * repository; the owner may also keep it false for a public one.
       */
      linkSources: z.boolean(),
      /** A public write-up of the project, when its source is private. */
      writeUpUrl: z.url().optional(),
    })
    .refine((repo) => !repo.linkSources || (repo.visibility === "public" && Boolean(repo.url) && Boolean(repo.branch)), {
      message: "linkSources needs a public repository with a url and a branch",
    })
    .optional(),
  problem: claimSchema,
  context: z.array(claimSchema).min(1),
  role: claimSchema,
  challenges: z.array(claimSchema).min(1),
  solution: z.array(claimSchema).min(1),
  stack: z.array(z.object({ name: z.string().min(1), role: z.string().min(1), provenance: provenanceSchema })).min(1),
  beforeAfter: z
    .object({
      title: z.string().min(1),
      note: z.string().min(1),
      before: z.array(claimSchema).min(1),
      after: z.array(claimSchema).min(1),
    })
    .optional(),
  architecture: architectureSchema,
  workflows: z.array(workflowSchema).default([]),
  decisions: z.array(decisionSchema).default([]),
  metrics: z.array(metricSchema).default([]),
  limitations: z.array(limitationSchema).default([]),
  screenshots: z.array(screenshotSchema).default([]),
  screenshotsNote: z.string().optional(),
  evidence: z.array(evidenceSchema).default([]),
});
export type Project = z.infer<typeof projectSchema>;

// -- Site-level content ---------------------------------------------------

export const siteSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  headline: z.string().min(1),
  intro: z.string().min(1),
  /** A short paragraph about the work, in the owner’s own words. */
  about: z.string().min(1),
  /** How the owner approaches a problem, as the owner states it. */
  approach: z.array(z.string().min(1)).min(1),
  /** The kind of work being looked for, when the owner has said so. */
  seeking: z.string().min(1).optional(),
  location: z.string().min(1),
  availability: z.string().min(1),
  url: z.url(),
  links: z.object({
    email: z.email(),
    github: z.url(),
    linkedin: z.url(),
    upwork: z.url().optional(),
    /** Where the resume lives: the built-in /resume page, or a file under public/. */
    resume: z.string().startsWith("/").optional(),
  }),
  /**
   * What the owner can do for a client, in plain words, first on the home
   * page. Each skill names the tools it is done with and the case study that
   * shows it, so no skill is listed without a piece of work behind it.
   */
  /**
   * The Upwork profile as it showed on `asOf`, copied by hand: the badge, the
   * rating, the hours worked and one client's review, word for word.
   */
  upwork: z
    .object({
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      badge: z.string().min(1),
      rating: z.string().regex(/^[0-5]\.\d$/),
      hours: z.number().int().positive(),
      review: z.object({ quote: z.string().min(1).max(140), job: z.string().min(1) }),
    })
    .optional(),
  skills: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1).max(40),
        text: z.string().min(1).max(90),
        icon: iconSchema,
        tone: toneSchema,
        tools: z.array(z.string().min(1)).min(1).max(4),
        projectId: z.string().min(1),
      }),
    )
    .min(1),
  /** The owner's skills as the CV groups them, shown on the home page with a logo where a technology has one. */
  skillGroups: z
    .array(z.object({ title: z.string().min(1), icon: iconSchema, tone: toneSchema, items: z.array(z.string().min(1)).min(1) }))
    .min(1),
  capabilities: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
        summary: z.string().min(1),
        icon: iconSchema,
        tone: toneSchema,
        evidence: z
          .array(z.object({ text: z.string().min(1), provenance: provenanceSchema, projectId: z.string().optional() }))
          .min(1),
      }),
    )
    .min(1),
  experience: z.array(
    z.object({
      title: z.string().min(1),
      organisation: z.string().min(1),
      period: z.string().min(1),
      summary: z.string().min(1),
      /** A generic icon for the kind of work. Never an employer's logo. */
      icon: iconSchema.default("briefcase"),
      /** What the owner added there, as the owner or the CV states it. */
      highlights: z.array(z.string().min(1)).default([]),
    }),
  ),
  education: z.array(z.object({ title: z.string().min(1), institution: z.string().min(1), period: z.string().min(1) })),
  certifications: z.array(z.object({ name: z.string().min(1), issuer: z.string().min(1), url: z.url() })),
  /** Work that has a public write-up but no interactive case study yet. */
  catalogue: z.array(
    z.object({
      title: z.string().min(1),
      organisation: z.string().min(1),
      summary: z.string().min(1),
      stack: z.array(z.string()).min(1),
      categories: z.array(categorySchema).min(1),
      url: z.url(),
      linkLabel: z.string().min(1),
      icon: iconSchema,
      tone: toneSchema,
      /** True when the owner holds a private source repository for it and shares it on request. */
      sourceOnRequest: z.boolean().default(false),
    }),
  ),
});
export type Site = z.infer<typeof siteSchema>;
