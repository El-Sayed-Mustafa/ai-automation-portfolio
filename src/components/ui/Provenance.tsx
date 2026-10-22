import { BookOpen, CircleHelp, FileCode, Lightbulb, UserCheck, type LucideIcon } from "lucide-react";
import { formatSourceRef, sourceUrl } from "@/content/sources";
import type { Claim, Project, Provenance, SourceRef } from "@/content/schema";

const META: Record<Provenance, { label: string; title: string; tone: string; Icon: LucideIcon }> = {
  code: { label: "Verified in code", title: "Read in the project's source files", tone: "text-success", Icon: FileCode },
  documented: {
    label: "Documented by author",
    title: "Stated in the project's own documentation",
    tone: "text-accent-strong",
    Icon: BookOpen,
  },
  owner: { label: "Stated by owner", title: "Stated by the portfolio owner", tone: "text-hold", Icon: UserCheck },
  inferred: { label: "Inferred", title: "Deduced from evidence and not yet confirmed", tone: "text-warn", Icon: CircleHelp },
  proposed: { label: "Proposed", title: "An improvement that has not been built", tone: "text-subtle", Icon: Lightbulb },
};

/** The label for each kind of evidence, for places that write it out in a sentence. */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  code: META.code.label,
  documented: META.documented.label,
  owner: META.owner.label,
  inferred: META.inferred.label,
  proposed: META.proposed.label,
};

/**
 * Where a claim comes from, as a quiet mark: a small icon and a label in the
 * provenance colour, with no box around it. It sits under or after the claim
 * it belongs to, so it informs without interrupting the sentence.
 */
export function ProvenanceBadge({ provenance, className = "" }: { provenance: Provenance; className?: string }) {
  const { label, title, tone, Icon } = META[provenance];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${tone} ${className}`}>
      <Icon size={12} aria-hidden />
      {label}
    </span>
  );
}

/**
 * The same mark with no visible words, for tight places such as a side column.
 * The label is still there for a screen reader and as a tooltip.
 */
export function ProvenanceMark({ provenance, className = "" }: { provenance: Provenance; className?: string }) {
  const { label, title, tone, Icon } = META[provenance];
  return (
    <span title={`${label}: ${title}`} className={`inline-flex shrink-0 ${tone} ${className}`}>
      <Icon size={14} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

type RepoContext = Pick<Project, "repository">;

/** File references behind a claim. Rendered as links only when the repository allows it. */
export function SourceList({ project, sources, className = "" }: { project: RepoContext; sources: SourceRef[]; className?: string }) {
  if (sources.length === 0) return null;
  const chip = "code inline-block max-w-full rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 text-muted [overflow-wrap:anywhere]";
  return (
    <ul className={`flex min-w-0 flex-wrap gap-1.5 ${className}`} aria-label="Sources">
      {sources.map((ref) => {
        const label = formatSourceRef(ref);
        const href = sourceUrl(project, ref);
        return (
          <li key={label + (ref.note ?? "")} title={ref.note} className="min-w-0 max-w-full">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className={`${chip} hover:border-accent hover:text-accent`}>
                {label}
              </a>
            ) : (
              <span className={chip}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The mark and, in the engineer lens, the files behind it, on one line under a claim. */
export function EvidenceLine({
  project,
  provenance,
  sources,
  className = "",
}: {
  project: RepoContext;
  provenance: Provenance;
  sources: SourceRef[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}>
      <ProvenanceBadge provenance={provenance} />
      <SourceList project={project} sources={sources} className="eng-only" />
    </div>
  );
}

/**
 * A statement, then its evidence line. In the short lens the evidence is a
 * mark at the end of the sentence, with its label as a tooltip and for a
 * screen reader, so a list of claims is not a list of labels.
 */
export function ClaimText({ project, claim, className = "" }: { project: RepoContext; claim: Claim; className?: string }) {
  return (
    <div className={className}>
      <p className="leading-relaxed">
        {claim.text} <ProvenanceMark provenance={claim.provenance} className="rec-only align-[-2px]" />
      </p>
      <EvidenceLine project={project} provenance={claim.provenance} sources={claim.sources} className="eng-only mt-1.5" />
    </div>
  );
}

export function ProvenanceLegend() {
  return (
    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {(Object.keys(META) as Provenance[]).map((key) => (
        <div key={key} className="flex flex-col">
          <dt>
            <ProvenanceBadge provenance={key} />
          </dt>
          <dd className="text-muted">{META[key].title}</dd>
        </div>
      ))}
    </dl>
  );
}
