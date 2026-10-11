import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CircleCheck,
  FileCheck,
  ImageOff,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  Mail,
  Network,
  Play,
  Scale,
  ShieldCheck,
  Timer,
  TrendingUp,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArchitecturePicture } from "@/components/architecture/ArchitecturePicture";
import { ArchitectureStage } from "@/components/architecture/ArchitectureStage";
import { WorkflowSimulator } from "@/components/simulator/WorkflowSimulator";
import { AppIcon, CATEGORY_TONE, TONE_CYCLE, Tag, Tile } from "@/components/ui/Icon";
import { ClaimText, EvidenceLine, ProvenanceBadge, ProvenanceLegend, ProvenanceMark, SourceList } from "@/components/ui/Provenance";
import { TechGlyph } from "@/components/ui/TechIcon";
import { Disclosure } from "@/components/ui/Section";
import { CATEGORY_LABELS, type Project, type Tone } from "@/content/schema";
import type { TabId } from "@/lib/case-study-tabs";
import { MetricValue } from "./ProjectCards";
import { ProjectSummary } from "./ProjectSummary";
import { ScreenshotGallery } from "./ScreenshotGallery";
import { WorkflowSteps, type WorkflowStage } from "./WorkflowSteps";

export const ENGAGEMENT_LABEL: Record<Project["engagement"], string> = {
  client: "Client project",
  employer: "Employer project",
  personal: "Personal project",
  "open-source": "Open source",
};

/** The tabs a case study actually has, in reading order. Nothing is listed that would be empty. */
export function caseStudyTabs(project: Project): { id: TabId; label: string }[] {
  return [
    { id: "overview", label: "Overview" },
    ...(project.workflows.length > 0 ? [{ id: "demo" as const, label: "Demo" }] : []),
    { id: "architecture", label: "Architecture" },
    ...(project.decisions.length > 0 ? [{ id: "decisions" as const, label: "Decisions" }] : []),
    ...(project.limitations.length > 0 ? [{ id: "limitations" as const, label: "Limits" }] : []),
    ...(project.evidence.length > 0 ? [{ id: "evidence" as const, label: "Evidence" }] : []),
  ];
}

function sourceIsLinked(project: Project): boolean {
  return Boolean(project.repository && project.repository.visibility === "public" && project.repository.linkSources && project.repository.url);
}

/** One tab's content. With JavaScript off every panel is on the page, so each carries its own heading. */
function TabPanel({ id, icon: Icon, tone, title, intro, children }: { id: TabId; icon: LucideIcon; tone: Tone; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-panel={id} aria-labelledby={`${id}-title`} className="rise pb-10 pt-2">
      <div className="mb-5" data-tone={tone}>
        <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-[1.375rem] font-bold leading-tight">
          <Icon size={20} className="shrink-0 text-tone-vivid" aria-hidden />
          {title}
        </h2>
        {intro ? <p className="mt-1.5 max-w-3xl text-[0.9375rem] leading-relaxed text-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A titled card inside a panel. */
function Block({ id, title, intro, children, className = "" }: { id?: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`reveal panel p-5 sm:p-6 ${className}`}>
      <h3 id={id ? `${id}-title` : undefined} className="text-xl font-bold">
        {title}
      </h3>
      {intro ? <p className="mt-1 max-w-(--container-measure) text-sm leading-relaxed text-muted">{intro}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ProjectHero({ project, projectList }: { project: Project; projectList?: ReactNode }) {
  const hasDemo = project.workflows.length > 0;
  const repo = project.repository;
  return (
    <header>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Breadcrumb" className="min-w-0 text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/projects" className="hover:text-accent hover:underline">
                Projects
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="font-medium text-fg">
              {project.title}
            </li>
          </ol>
        </nav>
        {projectList}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-3xl flex-1">
          <div className="flex items-start gap-3.5">
            <Tile tone={project.tone} solid className="mt-0.5 hidden !h-12 !w-12 !rounded-2xl sm:grid">
              <AppIcon name={project.icon} size={24} />
            </Tile>
            <div className="min-w-0">
              <h1 className="text-[1.75rem] font-bold leading-[1.15] sm:text-[2.125rem]">{project.title}</h1>
              <p className="mt-1.5 text-base leading-relaxed text-muted">{project.tagline}</p>
            </div>
          </div>
          <ul className="mt-3.5 flex flex-wrap gap-1.5" aria-label="Kind of project and technology">
            {project.categories.map((category) => (
              <li key={category}>
                <Tag tone={CATEGORY_TONE[category]}>{CATEGORY_LABELS[category]}</Tag>
              </li>
            ))}
            {project.stack.slice(0, 2).map((item) => (
              <li key={item.name}>
                <Tag tone="slate">
                  <TechGlyph name={item.name} size={13} />
                  {item.name}
                </Tag>
              </li>
            ))}
          </ul>
        </div>

        {/* On a phone the two actions share the full width, and stack when they do not fit side by side. */}
        <div className="flex w-full shrink-0 flex-wrap gap-2.5 sm:w-52 sm:flex-col">
          {hasDemo ? (
            <a href="#demo" className="btn btn-primary max-sm:flex-1">
              <Play size={15} aria-hidden /> Try the demo
            </a>
          ) : null}
          {repo && sourceIsLinked(project) ? (
            <a href={repo.url} target="_blank" rel="noreferrer" className="btn btn-secondary max-sm:flex-1">
              Open on GitHub <ArrowUpRight size={15} aria-hidden />
            </a>
          ) : (
            <Link href={`/source-access?project=${project.id}`} className="btn btn-secondary max-sm:flex-1">
              <KeyRound size={15} aria-hidden /> Request the source
            </Link>
          )}
        </div>
      </div>

      <ProjectSummary project={project} engagementLabel={ENGAGEMENT_LABEL[project.engagement]} />
    </header>
  );
}

/** The first workflow as a few stages: one per phase, with the components its steps run on. */
function workflowStages(project: Project): WorkflowStage[] {
  const workflow = project.workflows[0];
  if (!workflow) return [];
  return workflow.phases.flatMap((phase) => {
    const steps = workflow.steps.filter((step) => step.phase === phase.id);
    if (steps.length === 0) return [];
    return [{ id: phase.id, label: phase.label, summary: steps[0].summary, more: steps.length - 1, nodeIds: [...new Set(steps.map((step) => step.nodeId))] }];
  });
}

function RunItYourself({ project }: { project: Project }) {
  const workflow = project.workflows[0];
  if (!workflow) return null;
  return (
    <>
      <a href="#demo" className="btn btn-primary btn-sm">
        <Play size={14} aria-hidden /> Run it yourself
      </a>
      <p className="text-sm text-muted">
        {workflow.steps.length} steps, {workflow.faults.length} failures you can inject.
      </p>
    </>
  );
}

function HowItWorks({ project }: { project: Project }) {
  const stages = workflowStages(project);
  if (stages.length === 0) return null;
  return <WorkflowSteps id="how-it-works" stages={stages} intro={project.workflows[0].summary} footer={<RunItYourself project={project} />} />;
}

function Screenshots({ project }: { project: Project }) {
  if (project.screenshots.length === 0) return null;
  return (
    <Block id="screenshots" title="Screenshots">
      <ScreenshotGallery shots={project.screenshots} note={project.screenshotsNote} />
    </Block>
  );
}

function Results({ project }: { project: Project }) {
  if (project.metrics.length === 0 && !project.beforeAfter) return null;
  const measured = project.metrics.filter((metric) => metric.before && metric.after);
  const others = project.metrics.filter((metric) => !(metric.before && metric.after));
  return (
    <Block id="results" title="Results, and how each was obtained" intro="Each figure says how it was measured and where it is recorded. None is an estimate made for this page.">
      {measured.length > 0 ? (
        // As many columns as there are figures, so two results do not leave a third column empty.
        <ul className={"grid gap-4 " + (measured.length === 1 ? "" : measured.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3")}>
          {measured.map((metric, index) => (
            <li key={metric.id} data-tone={TONE_CYCLE[index % TONE_CYCLE.length]} className="flex flex-col rounded-2xl border border-tone/25 bg-tone-soft p-4">
              <p className="text-sm font-semibold text-muted">{metric.label}</p>
              <p className="mt-2 text-tone">
                <MetricValue metric={metric} className="font-display text-3xl font-bold tracking-tight" />
              </p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{metric.method}</p>
              <EvidenceLine project={project} provenance={metric.provenance} sources={metric.sources} className="mt-3" />
            </li>
          ))}
        </ul>
      ) : null}

      {others.length > 0 ? (
        <dl className={"grid gap-x-10 sm:grid-cols-2 " + (measured.length > 0 ? "mt-6 border-t border-line" : "")}>
          {others.map((metric) => (
            <div key={metric.id} className="border-b border-line py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
              <dt className="text-sm font-semibold text-muted">{metric.label}</dt>
              <dd className="mt-1">
                <span className="font-display text-xl font-bold">{metric.value}</span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">{metric.method}</span>
                <EvidenceLine project={project} provenance={metric.provenance} sources={metric.sources} className="mt-2" />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {project.beforeAfter ? (
        <div className="mt-8">
          <h4 className="font-display text-lg font-bold">{project.beforeAfter.title}</h4>
          <p className="mt-1 max-w-(--container-measure) text-sm leading-relaxed text-muted">{project.beforeAfter.note}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line p-4">
              <h5 className="label flex items-center gap-2">
                <X size={14} className="text-danger" aria-hidden /> Before
              </h5>
              <ul className="mt-3 space-y-4">
                {project.beforeAfter.before.map((claim) => (
                  <li key={claim.text}>
                    <ClaimText project={project} claim={claim} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-success bg-success-soft p-4">
              <h5 className="label flex items-center gap-2">
                <Check size={14} className="text-success" aria-hidden /> After
              </h5>
              <ul className="mt-3 space-y-4">
                {project.beforeAfter.after.map((claim) => (
                  <li key={claim.text}>
                    <ClaimText project={project} claim={claim} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </Block>
  );
}

export function OverviewPanel({ project }: { project: Project }) {
  return (
    <TabPanel id="overview" icon={LayoutDashboard} tone="indigo" title="Overview" intro={project.summary}>
      <div className="space-y-6">
        <section id="system" aria-labelledby="system-title" className="reveal panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-5">
            <h3 id="system-title" className="flex items-center gap-2.5 text-lg font-bold">
              <Network size={18} className="text-accent" aria-hidden />
              System architecture
            </h3>
            <a href="#architecture" className="btn btn-secondary btn-sm">
              Explore the diagram <ArrowRight size={14} aria-hidden />
            </a>
          </div>
          {/* On a narrow screen the picture keeps a readable size and scrolls sideways inside its card. */}
          <div className="overflow-x-auto border-t border-line">
            <a href="#architecture" className="block min-w-[46rem] p-3 sm:p-4">
              <ArchitecturePicture
                architecture={project.architecture}
                label={`The architecture of ${project.title}: ${project.architecture.nodes.length} components in ${project.architecture.layers.length} layers. Opens the interactive diagram, where each one is listed with its details.`}
                className="mx-auto h-auto w-full max-w-[76rem]"
              />
            </a>
          </div>
        </section>

        <HowItWorks project={project} />
        <Screenshots project={project} />

        <div id="summary" className="grid gap-6 lg:grid-cols-2">
          <Block title="The problem">
            <ClaimText project={project} claim={project.problem} />
            {/* Background, for the reader who wants it. The short lens goes straight from the problem to what was built. */}
            <div className="eng-only">
              <h4 className="label mb-3 mt-6">Context</h4>
              <ul className="space-y-3">
                {project.context.map((claim) => (
                  <li key={claim.text}>
                    <ClaimText project={project} claim={claim} className="text-sm" />
                  </li>
                ))}
              </ul>
            </div>
          </Block>
          {/* An employer's product is not one person's work, so its heading does not say "I". */}
          <Block title={project.engagement === "employer" ? "What was built" : "What I built"}>
            <ul className="space-y-4">
              {project.solution.map((claim) => (
                <li key={claim.text} className="flex gap-3">
                  <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
                  <ClaimText project={project} claim={claim} className="text-sm" />
                </li>
              ))}
            </ul>
          </Block>
        </div>

        <div className="eng-only">
          <Block title="Engineering challenges">
            <ul className="grid gap-4 md:grid-cols-2">
              {project.challenges.map((claim) => (
                <li key={claim.text}>
                  <ClaimText project={project} claim={claim} className="text-sm" />
                </li>
              ))}
            </ul>
          </Block>
        </div>

        <Results project={project} />

        <Block title="Technology">
          {/* Names only in the short lens; what each one is used for in the engineer lens. */}
          <ul className="rec-only flex flex-wrap gap-2" aria-label="Technology used">
            {project.stack.map((item) => (
              <li key={item.name} title={item.role}>
                <Tag tone="slate" className="!gap-1.5 !px-3 !py-1 !text-[0.8125rem]">
                  <TechGlyph name={item.name} size={14} />
                  {item.name}
                </Tag>
              </li>
            ))}
          </ul>
          <dl className="eng-only grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {project.stack.map((item) => (
              <div key={item.name} className="border-l-2 border-accent/40 pl-3">
                <dt className="font-bold">{item.name}</dt>
                <dd className="text-muted">{item.role}</dd>
              </div>
            ))}
          </dl>
        </Block>

        <details className="panel">
          <summary className="px-5 py-3.5 text-sm font-semibold">What the evidence labels on this page mean</summary>
          <div className="border-t border-line p-5">
            <ProvenanceLegend />
          </div>
        </details>
      </div>
    </TabPanel>
  );
}

export function DemoPanel({ project }: { project: Project }) {
  if (project.workflows.length === 0) return null;
  const nodeLabels = Object.fromEntries(project.architecture.nodes.map((node) => [node.id, node.label]));
  return (
    <TabPanel
      id="demo"
      icon={Play}
      tone="violet"
      title="Run the workflow yourself"
      intro="Pick a scenario, change the input, inject a failure, and inspect each step: its payload, its log lines and the rows it wrote."
    >
      <div className="space-y-10">
        {project.workflows.map((workflow) => (
          <div key={workflow.id} data-anchor>
            <WorkflowSimulator workflow={workflow} nodeLabels={nodeLabels} repository={project.repository} />
          </div>
        ))}
      </div>
    </TabPanel>
  );
}

export function ArchitecturePanel({ project }: { project: Project }) {
  const { architecture } = project;
  const label = (id: string) => architecture.nodes.find((node) => node.id === id)?.label ?? id;
  return (
    // Its heading sits inside the diagram's card, beside the view switch, so this panel does not use the shared header.
    <section id="architecture" data-panel="architecture" aria-labelledby="architecture-title" className="rise pb-10 pt-2">
      <ArchitectureStage
        architecture={architecture}
        repository={project.repository}
        stages={workflowStages(project)}
        stagesFooter={<RunItYourself project={project} />}
        heading={
          <div className="flex items-start gap-3">
            <Tile tone="blue">
              <Network size={20} aria-hidden />
            </Tile>
            <div className="min-w-0">
              <h2 id="architecture-title" className="text-[1.375rem] font-bold leading-tight">
                System architecture
              </h2>
              <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-relaxed text-muted">{architecture.summary}</p>
            </div>
          </div>
        }
      />

      <details className="panel mt-5">
        <summary className="px-5 py-3.5 text-sm font-semibold">Read the architecture as a list</summary>
        <div className="space-y-7 border-t border-line p-5">
          {architecture.layers.map((layer) => {
            const nodes = architecture.nodes.filter((node) => node.layer === layer.id);
            if (nodes.length === 0) return null;
            return (
              <div key={layer.id}>
                <h3 className="label mb-2">{layer.label}</h3>
                <dl className="space-y-3">
                  {nodes.map((node) => (
                    <div key={node.id}>
                      <dt className="font-semibold">
                        {node.label}
                        <span className="font-normal text-muted"> · {node.technology}</span>
                        {node.status !== "active" ? <span className="font-normal text-subtle"> ({node.status})</span> : null}
                      </dt>
                      <dd className="text-sm leading-relaxed text-muted">{node.responsibility}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="label mb-2 text-left">Connections</caption>
              <thead className="text-xs text-subtle">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    From
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    To
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-normal">
                    How
                  </th>
                  <th scope="col" className="py-1.5 font-normal">
                    What moves
                  </th>
                </tr>
              </thead>
              <tbody>
                {architecture.edges.map((edge) => (
                  <tr key={edge.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-3 font-medium">{label(edge.from)}</td>
                    <td className="py-1.5 pr-3 font-medium">{label(edge.to)}</td>
                    <td className="py-1.5 pr-3 text-muted">
                      {edge.protocol}
                      {edge.kind !== "sync" ? <span className="text-subtle"> ({edge.kind})</span> : null}
                    </td>
                    <td className="py-1.5 text-muted">{edge.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </section>
  );
}

export function DecisionsPanel({ project }: { project: Project }) {
  if (project.decisions.length === 0) return null;
  return (
    <TabPanel
      id="decisions"
      icon={Scale}
      tone="amber"
      title="What was decided, and what it cost"
      intro="Each record gives the problem, the options, the choice and its downside. Open one to read it."
    >
      <div className="space-y-3">
        {project.decisions.map((decision) => (
          <Disclosure
            key={decision.id}
            summary={
              <>
                <span className="font-display text-lg font-bold">{decision.title}</span>
                <span className="mt-0.5 block text-sm text-muted">{decision.problem}</span>
              </>
            }
          >
            <div className="space-y-6">
              <div>
                <h3 className="label mb-2">Options considered</h3>
                <ul className="grid gap-3 md:grid-cols-2">
                  {decision.options.map((option) => (
                    <li key={option.name} className={"rounded-xl border p-3.5 " + (option.verdict === "chosen" ? "border-success bg-success-soft" : "border-line")}>
                      <p className={"flex items-center gap-1.5 text-xs font-bold " + (option.verdict === "chosen" ? "text-success" : "text-subtle")}>
                        {option.verdict === "chosen" ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
                        {option.verdict === "chosen" ? "Chosen" : "Rejected"}
                      </p>
                      <p className="mt-1 font-semibold">{option.name}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{option.note}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="label mb-1">Why</h3>
                <p className="max-w-(--container-measure) leading-relaxed">{decision.rationale}</p>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="label mb-1">Trade-offs accepted</h3>
                  <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed marker:text-subtle">
                    {decision.tradeoffs.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="label mb-1">How it could evolve</h3>
                  <p className="text-sm leading-relaxed">{decision.evolution}</p>
                  <ProvenanceBadge provenance="proposed" className="mt-1.5" />
                </div>
              </div>
              <EvidenceLine project={project} provenance={decision.provenance} sources={decision.sources} />
            </div>
          </Disclosure>
        ))}
      </div>
    </TabPanel>
  );
}

export function LimitationsPanel({ project }: { project: Project }) {
  if (project.limitations.length === 0) return null;
  return (
    <TabPanel
      id="limitations"
      icon={TriangleAlert}
      tone="rose"
      title="What the system does not do yet"
      intro="Read from the code. For each one: what ships today, and a proposal that has not been built."
    >
      <div className="space-y-3">
        {project.limitations.map((item) => (
          <Disclosure key={item.id} summary={<span className="font-display text-lg font-bold">{item.title}</span>}>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="label mb-1">Today</h3>
                <p className="text-sm leading-relaxed">{item.current}</p>
                <EvidenceLine project={project} provenance={item.provenance} sources={item.sources} className="mt-2" />
              </div>
              <div>
                <h3 className="label mb-1">Improvement</h3>
                <p className="text-sm leading-relaxed">{item.proposal}</p>
                <ProvenanceBadge provenance="proposed" className="mt-2" />
              </div>
            </div>
          </Disclosure>
        ))}
      </div>
    </TabPanel>
  );
}

const EVIDENCE_LABEL: Record<Project["evidence"][number]["kind"], string> = {
  source: "Source code",
  documentation: "Documentation",
  tests: "Tests",
  measurements: "Measurements",
  schema: "Database schema",
};

export function EvidencePanel({ project }: { project: Project }) {
  if (project.evidence.length === 0) return null;
  const repo = project.repository;
  return (
    <TabPanel id="evidence" icon={FileCheck} tone="green" title="Where to check all of this" intro="The files behind the claims on this page.">
      {repo ? (
        <div className="panel mb-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 p-4 sm:p-5">
          <p className="max-w-(--container-measure) text-sm leading-relaxed text-muted">
            {/* A repository whose address is not the author's to publish is described, not named. */}
            {repo.url ? (
              <>
                Repository: <span className="code text-fg">{repo.name}</span> ({repo.visibility}).
              </>
            ) : (
              <>{repo.name}.</>
            )}{" "}
            {sourceIsLinked(project) ? (
              <>The file references in the Engineer view link to the code.</>
            ) : (
              <>File references are shown as paths, not links. To read the code, send a request that says what you need it for.</>
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            {sourceIsLinked(project) ? (
              <a href={repo.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                Open on GitHub <ArrowUpRight size={14} aria-hidden />
              </a>
            ) : (
              <Link href={`/source-access?project=${project.id}`} className="btn btn-secondary btn-sm">
                <KeyRound size={14} aria-hidden /> Request the source code
              </Link>
            )}
            {repo.writeUpUrl ? (
              <a href={repo.writeUpUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                Public write-up <ArrowUpRight size={14} aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <dl className="panel divide-y divide-line px-5">
        {project.evidence.map((item) => (
          <div key={item.label} className="grid gap-x-10 gap-y-2 py-5 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <dt>
              <span className="label">{EVIDENCE_LABEL[item.kind]}</span>
              <span className="mt-1 block font-bold">{item.label}</span>
            </dt>
            <dd>
              <p className="text-sm leading-relaxed text-muted">{item.description}</p>
              <SourceList project={project} sources={item.sources} className="mt-2" />
            </dd>
          </div>
        ))}
        {project.screenshots.length === 0 && project.screenshotsNote ? (
          <div className="grid gap-x-10 gap-y-2 py-5 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <dt>
              <span className="label">Screenshots</span>
              <span className="mt-1 flex items-center gap-2 font-bold">
                <ImageOff size={15} className="text-subtle" aria-hidden /> None published
              </span>
            </dt>
            <dd className="text-sm leading-relaxed text-muted">{project.screenshotsNote}</dd>
          </div>
        ) : null}
      </dl>
    </TabPanel>
  );
}

const IMPACT_ICONS: LucideIcon[] = [TrendingUp, Timer, ShieldCheck, ListChecks];

/** The side column: what the project achieved, what it does, and where to go. */
export function ProjectAside({ project }: { project: Project }) {
  const metrics = project.metrics.slice(0, 4);
  const repo = project.repository;
  const links: { href: string; label: string; hint: string; icon: LucideIcon; tone: Tone; external?: boolean }[] = [
    ...(project.workflows.length > 0 ? [{ href: "#demo", label: "Interactive demo", hint: "Run it and break it", icon: Play, tone: "violet" as const }] : []),
    { href: "#architecture", label: "Full diagram", hint: "Every component and connection", icon: Network, tone: "blue" },
    ...(project.evidence.length > 0 ? [{ href: "#evidence", label: "Evidence", hint: "The files behind the claims", icon: FileCheck, tone: "green" as const }] : []),
    ...(repo?.writeUpUrl ? [{ href: repo.writeUpUrl, label: "Public write-up", hint: "On GitHub", icon: BookOpen, tone: "amber" as const, external: true }] : []),
    sourceIsLinked(project) && repo?.url
      ? { href: repo.url, label: "Source code", hint: "On GitHub", icon: KeyRound, tone: "slate", external: true }
      : { href: `/source-access?project=${project.id}`, label: "Source code", hint: "On request", icon: KeyRound, tone: "slate" },
  ];

  return (
    <div className="space-y-5">
      {metrics.length > 0 ? (
        <section aria-labelledby="impact-title" className="enter panel p-5" style={{ "--i": 1 } as React.CSSProperties}>
          <h2 id="impact-title" className="flex items-center gap-2 text-[1.0625rem] font-bold">
            <BarChart3 size={17} className="text-accent" aria-hidden />
            Project impact
          </h2>
          <ul className="mt-4 space-y-4">
            {metrics.map((metric, index) => {
              const Icon = IMPACT_ICONS[index % IMPACT_ICONS.length];
              return (
                <li key={metric.id} data-tone={TONE_CYCLE[index % TONE_CYCLE.length]} className="flex items-start gap-3">
                  <span className="tile">
                    <Icon size={20} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xl font-bold leading-tight text-tone-vivid">{metric.after ?? metric.value}</p>
                    {metric.before && metric.after ? <p className="text-xs font-semibold text-subtle">was {metric.before}</p> : null}
                    <p className="mt-0.5 text-sm leading-snug text-muted">{metric.label}</p>
                  </div>
                  <ProvenanceMark provenance={metric.provenance} className="mt-1" />
                </li>
              );
            })}
          </ul>
          <a href="#results" className="link mt-4 inline-flex items-center gap-1 text-sm">
            How each was measured <ArrowRight size={14} aria-hidden />
          </a>
        </section>
      ) : null}

      <section aria-labelledby="highlights-title" className="enter panel p-5" style={{ "--i": 2 } as React.CSSProperties}>
        <h2 id="highlights-title" className="flex items-center gap-2 text-[1.0625rem] font-bold">
          <ListChecks size={17} className="text-accent" aria-hidden />
          Key features
        </h2>
        <ul className="mt-4 space-y-3">
          {project.highlights.map((item) => (
            <li key={item.text} className="flex items-start gap-2.5 text-sm leading-snug">
              <CircleCheck size={18} className="mt-px shrink-0 text-success" aria-hidden />
              <span className="flex-1">{item.text}</span>
              <ProvenanceMark provenance={item.provenance} className="mt-0.5" />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="links-title" className="enter panel p-5" style={{ "--i": 3 } as React.CSSProperties}>
        <h2 id="links-title" className="flex items-center gap-2 text-[1.0625rem] font-bold">
          <Link2 size={17} className="text-accent" aria-hidden />
          Links and resources
        </h2>
        <ul className="mt-3 space-y-1">
          {links.map((link) => {
            const Icon = link.icon;
            const body = (
              <>
                <Tile tone={link.tone} size="sm">
                  <Icon size={16} aria-hidden />
                </Tile>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-accent">{link.label}</span>
                  <span className="block text-xs text-muted">{link.hint}</span>
                </span>
                {link.external ? <ArrowUpRight size={15} className="text-subtle" aria-hidden /> : <ArrowRight size={15} className="text-subtle" aria-hidden />}
              </>
            );
            const className = "-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2";
            return (
              <li key={link.label}>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noreferrer" className={className}>
                    {body}
                  </a>
                ) : link.href.startsWith("#") ? (
                  <a href={link.href} className={className}>
                    {body}
                  </a>
                ) : (
                  <Link href={link.href} className={className}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Where to go from the end of a case study: the next one, the full list, or a conversation. */
export function NextSteps({ next, email }: { next: Project | undefined; email: string }) {
  return (
    <section aria-label="Next steps" className="panel mt-2 grid gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      {next ? (
        <div className="flex items-start gap-4">
          <Tile tone={next.tone} solid>
            <AppIcon name={next.icon} />
          </Tile>
          <div className="min-w-0">
            <p className="eyebrow">Next case study</p>
            <h2 className="mt-1 text-xl font-bold">
              <Link href={`/projects/${next.id}`} className="hover:text-accent">
                {next.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">{next.tagline}</p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {next ? (
          <Link href={`/projects/${next.id}`} className="btn btn-primary">
            Read it <ArrowRight size={15} aria-hidden />
          </Link>
        ) : null}
        <Link href="/projects" className="btn btn-secondary">
          See all work
        </Link>
        <a href={`mailto:${email}`} className="btn btn-secondary">
          <Mail size={15} aria-hidden /> Email me
        </a>
      </div>
    </section>
  );
}
