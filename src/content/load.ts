import jobTriagePipeline from "../../content/projects/job-triage-pipeline.json";
import leadEnrichmentEngine from "../../content/projects/lead-enrichment-engine.json";
import marketDataPlatform from "../../content/projects/market-data-platform.json";
import reviewIntelligencePipeline from "../../content/projects/review-intelligence-pipeline.json";
import pestControlCrm from "../../content/projects/pest-control-crm.json";
import ratingEstimator from "../../content/projects/rating-estimator.json";
import rugInventorySync from "../../content/projects/rug-inventory-sync.json";
import siteJson from "../../content/site.json";
import solanaResearchPlatform from "../../content/projects/solana-research-platform.json";
import { projectSchema, siteSchema, type Project, type Site } from "./schema";

/**
 * Content is validated when this module is first imported, so an invalid
 * manifest fails the build instead of rendering a broken page.
 *
 * To add a case study: add its JSON file under content/projects, import it
 * here and append it to PROJECT_SOURCES. See docs/AUTHORING.md.
 */
/** In the order they are listed. The home page shows the first four in full. */
const PROJECT_SOURCES: unknown[] = [
  pestControlCrm,
  reviewIntelligencePipeline,
  solanaResearchPlatform,
  marketDataPlatform,
  jobTriagePipeline,
  rugInventorySync,
  leadEnrichmentEngine,
  ratingEstimator,
];

function parseProject(raw: unknown): Project {
  const result = projectSchema.safeParse(raw);
  if (!result.success) {
    const id = typeof raw === "object" && raw !== null && "id" in raw ? String((raw as { id: unknown }).id) : "unknown";
    throw new Error(`Invalid project manifest "${id}":\n${result.error.message}`);
  }
  return result.data;
}

const projects: Project[] = PROJECT_SOURCES.map(parseProject);

const site: Site = (() => {
  const result = siteSchema.safeParse(siteJson);
  if (!result.success) throw new Error(`Invalid content/site.json:\n${result.error.message}`);
  return result.data;
})();

export function getSite(): Site {
  return site;
}

export function getProjects(): Project[] {
  return projects;
}

export function getProject(id: string): Project | undefined {
  return projects.find((project) => project.id === id);
}

/** A stable id for a catalogue entry, taken from the last part of its address. */
export function catalogueId(item: Site["catalogue"][number]): string {
  return item.url.replace(/\/+$/, "").split("/").at(-1) ?? item.url;
}

/**
 * Canonical site origin: SITE_URL when set, otherwise the production host
 * Vercel assigns the deployment, otherwise the value in content/site.json.
 */
export function getSiteUrl(): string {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.SITE_URL ?? (vercelHost ? `https://${vercelHost}` : site.url)).replace(/\/+$/, "");
}

export { formatSourceRef, sourceUrl } from "./sources";
