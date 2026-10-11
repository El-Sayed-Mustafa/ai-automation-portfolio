/**
 * The tabs of a case study, and which tab each linkable section belongs to.
 *
 * Kept free of React so the script that runs before first paint can be built
 * from the same table as the component that switches tabs later.
 */
export const TAB_IDS = ["overview", "demo", "architecture", "decisions", "limitations", "evidence"] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Sections that live inside a tab under their own anchor. */
export const SECTION_TAB: Record<string, TabId> = {
  system: "overview",
  "how-it-works": "overview",
  results: "overview",
  screenshots: "overview",
  summary: "overview",
};

/** A case study lives at /projects/<id>. The index page has no tabs. */
export const CASE_STUDY_PATH = /^\/projects\/[^/]+\/?$/;

/** The tab a link such as #demo, #results or #decisions-title opens. Unknown anchors open the overview. */
export function tabForHash(hash: string): TabId {
  const id = decodeURIComponent(hash.replace(/^#/, "")).replace(/-title$/, "");
  if ((TAB_IDS as readonly string[]).includes(id)) return id as TabId;
  return SECTION_TAB[id] ?? "overview";
}
