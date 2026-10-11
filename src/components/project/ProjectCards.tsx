import { ArrowRight, ArrowUpRight, KeyRound, Play } from "lucide-react";
import Link from "next/link";
import { MiniArchitecture } from "@/components/architecture/MiniArchitecture";
import { AppIcon, CATEGORY_TONE, Tag, Tile } from "@/components/ui/Icon";
import { ProvenanceBadge } from "@/components/ui/Provenance";
import { TechGlyph } from "@/components/ui/TechIcon";
import { catalogueId } from "@/content/load";
import { CATEGORY_LABELS, type Metric, type Project, type Site } from "@/content/schema";

/** The one figure worth showing on a card: a measured before and after if there is one. */
export function headlineMetric(project: Project): Metric | undefined {
  return project.metrics.find((metric) => metric.before && metric.after) ?? project.metrics[0];
}

export function MetricValue({ metric, className = "" }: { metric: Metric; className?: string }) {
  if (metric.before && metric.after) {
    return (
      <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
        <span className="text-[0.75em] font-semibold text-subtle line-through decoration-1">{metric.before}</span>
        <ArrowRight size={14} className="self-center text-subtle" aria-label="to" />
        <span>{metric.after}</span>
      </span>
    );
  }
  return <span className={className}>{metric.value}</span>;
}

/**
 * A project with a full interactive case study: a picture of it, what it is,
 * its state, and one figure with where the figure comes from. The engineer
 * lens adds the problem and the author's part, so two projects can still be
 * compared line by line.
 */
export function CaseStudyCard({ project, headingLevel = 3 }: { project: Project; headingLevel?: 2 | 3 }) {
  const href = `/projects/${project.id}`;
  const metric = headlineMetric(project);
  const shot = project.screenshots[0];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article data-tone={project.tone} className="reveal panel panel-link flex h-full flex-col overflow-hidden">
      {/* A screenshot where the project has one, otherwise its own architecture drawn small. */}
      <Link href={href} tabIndex={-1} aria-hidden className="block border-b border-line bg-surface-2">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- a static file with known dimensions
          <img src={shot.src} alt="" width={shot.width} height={shot.height} loading="lazy" className="aspect-[16/7] w-full object-cover object-top" />
        ) : (
          <MiniArchitecture architecture={project.architecture} className="aspect-[16/7] w-full bg-surface p-3" />
        )}
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3.5">
          <Tile tone={project.tone} solid>
            <AppIcon name={project.icon} />
          </Tile>
          <div className="min-w-0 flex-1">
            <Heading className="text-lg font-bold leading-snug">
              <Link href={href} className="hover:text-accent">
                {project.title}
              </Link>
            </Heading>
            <p className="mt-0.5 text-[0.8125rem] font-semibold text-tone">{project.statusLabel}</p>
          </div>
        </div>

        <p className="mt-3 line-clamp-3 text-[0.9375rem] leading-relaxed text-muted">{project.tagline}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Categories">
          {project.categories.map((category) => (
            <li key={category}>
              <Tag tone={CATEGORY_TONE[category]}>{CATEGORY_LABELS[category]}</Tag>
            </li>
          ))}
        </ul>

        <dl className="eng-only mt-4 grid gap-3 text-sm">
          <div>
            <dt className="label">The problem</dt>
            <dd className="mt-1 line-clamp-3 leading-relaxed">{project.problem.text}</dd>
          </div>
          <div>
            <dt className="label">My contribution</dt>
            <dd className="mt-1 leading-relaxed">{project.role.text}</dd>
          </div>
        </dl>

        {metric ? (
          <p className="mt-4 rounded-xl border border-tone-vivid/20 bg-tone-soft px-3.5 py-2.5 text-sm">
            <span className="block text-xs font-semibold text-muted">{metric.label}</span>
            <span className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <MetricValue metric={metric} className="text-lg font-bold text-tone" />
              <ProvenanceBadge provenance={metric.provenance} />
            </span>
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-2.5 pt-4">
          <Link href={href} className="btn btn-primary btn-sm">
            Read the case study <ArrowRight size={14} aria-hidden />
          </Link>
          {project.workflows.length > 0 ? (
            <Link href={`${href}#demo`} className="btn btn-secondary btn-sm">
              <Play size={13} aria-hidden /> Try the demo
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Work with a public write-up elsewhere and no interactive page here yet. */
export function CatalogueRow({ item }: { item: Site["catalogue"][number] }) {
  return (
    <article className="reveal panel flex h-full flex-col gap-4 p-5 sm:flex-row sm:items-start">
      <Tile tone={item.tone}>
        <AppIcon name={item.icon} />
      </Tile>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wider text-subtle">{item.organisation}</p>
        <h3 className="mt-1 text-lg font-bold leading-snug">{item.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.summary}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Technology">
          {item.stack.map((name) => (
            <li key={name}>
              <Tag tone="slate">
                <TechGlyph name={name} size={13} />
                {name}
              </Tag>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <a href={item.url} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-sm">
            {item.linkLabel} <ArrowUpRight size={14} aria-hidden />
          </a>
          {item.sourceOnRequest ? (
            <Link
              href={`/source-access?project=${catalogueId(item)}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-muted underline-offset-2 hover:text-accent hover:underline"
              aria-label={`Source on request: ${item.title}`}
            >
              <KeyRound size={13} aria-hidden /> Source on request
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
