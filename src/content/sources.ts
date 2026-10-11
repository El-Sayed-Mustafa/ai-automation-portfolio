import type { Project, SourceRef } from "./schema";

/**
 * Link to a source reference on GitHub, or null when the project's sources
 * are not linked: a private repository, or a public one the owner shares on
 * request instead.
 *
 * Kept free of content imports so client components can use it without
 * pulling the manifests into the browser bundle.
 */
export function sourceUrl(project: Pick<Project, "repository">, ref: SourceRef): string | null {
  const repo = project.repository;
  if (!repo || repo.visibility !== "public" || !repo.linkSources || !repo.url || !repo.branch) return null;
  const isFolder = !/\.[a-z0-9]+$/i.test(ref.path);
  const base = `${repo.url}/${isFolder ? "tree" : "blob"}/${repo.branch}/${ref.path.split("/").map(encodeURIComponent).join("/")}`;
  if (!ref.lines || isFolder) return base;
  const [start, end] = ref.lines.split("-");
  return end ? `${base}#L${start}-L${end}` : `${base}#L${start}`;
}

export function formatSourceRef(ref: SourceRef): string {
  return ref.lines ? `${ref.path}:${ref.lines}` : ref.path;
}
