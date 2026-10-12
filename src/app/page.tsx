import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Boxes,
  Briefcase,
  ChevronDown,
  FileText,
  FlaskConical,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  Mail,
  MapPin,
  Play,
  ShieldAlert,
  Workflow as WorkflowIcon,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { MiniArchitecture } from "@/components/architecture/MiniArchitecture";
import { runMapSystem } from "@/components/simulator/run-map-system";
import { SystemHub, type HubLayer, type HubRoute, type HubSide } from "@/components/home/SystemHub";
import { CountUp } from "@/components/ui/CountUp";
import { layerTone } from "@/components/architecture/NodeDetails";
import { CatalogueRow } from "@/components/project/ProjectCards";
import { WorkflowSimulator } from "@/components/simulator/WorkflowSimulator";
import { AppIcon, CATEGORY_TONE, GithubMark, LinkedinMark, TONE_CYCLE, Tag, Tile } from "@/components/ui/Icon";
import { ProvenanceBadge } from "@/components/ui/Provenance";
import { Section } from "@/components/ui/Section";
import { getProjects, getSite } from "@/content/load";
import { CATEGORY_SHORT, type ArchitectureNode, type Project, type Tone } from "@/content/schema";

/** How many case studies the home page shows in full. */
const FEATURED = 4;

function CardHeading({ icon: Icon, tone, title, note, action }: { icon: LucideIcon; tone: Tone; title: string; note?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-start gap-3">
        <Tile tone={tone} className="!h-10 !w-10 !rounded-xl">
          <Icon size={19} aria-hidden />
        </Tile>
        <div className="min-w-0">
          <h2 className="text-lg font-bold leading-snug">{title}</h2>
          {note ? <p className="mt-0.5 text-sm text-muted">{note}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function SideHeading({ icon: Icon, tone, children }: { icon: LucideIcon; tone: Tone; children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-[1.0625rem] font-bold">
      <Tile tone={tone} size="sm">
        <Icon size={16} aria-hidden />
      </Tile>
      {children}
    </h3>
  );
}

/** How many components of a side layer the hero's picture has room for. */
const HUB_SIDE = 3;

/**
 * The first case study as the parts of the hero's picture: three of its
 * layers as cards, two as stacks of their components, and the requests traced
 * in its diagram as routes between those parts.
 *
 * A hop whose two ends land in the same part, or whose component has no place
 * in the picture, is left out, and a request that keeps fewer than two hops is
 * not played. Nothing is added: every part and every hop is in the manifest.
 */
function hubOf(project: Project) {
  const { architecture } = project;
  const layers = architecture.layers
    .map((layer) => ({ layer, tone: layerTone(architecture, layer.id), nodes: architecture.nodes.filter((node) => node.layer === layer.id) }))
    .filter((item) => item.nodes.length > 0);
  const [top, centre, bottom, right, left] = layers;
  type Layer = (typeof layers)[number];
  const tile = (node: ArchitectureNode) => ({ kind: node.kind, label: node.label, technology: node.technology });
  /** Which part of the picture a component is drawn in. */
  const place = new Map<string, string>();

  const card = (item: Layer | undefined, pick: (nodes: ArchitectureNode[]) => ArchitectureNode): HubLayer | undefined => {
    if (!item) return undefined;
    const id = `layer-${item.layer.id}`;
    for (const node of item.nodes) place.set(node.id, id);
    return { id, tone: item.tone, title: item.layer.label, text: item.nodes.map((node) => node.label).join(" · "), node: tile(pick(item.nodes)) };
  };
  const stack = (item: Layer | undefined): HubSide | undefined => {
    if (!item) return undefined;
    const shown = item.nodes.slice(0, HUB_SIDE);
    for (const node of shown) place.set(node.id, node.id);
    return { tone: item.tone, title: item.layer.label, items: shown.map((node) => ({ id: node.id, label: node.label, node: tile(node) })) };
  };

  const parts = {
    top: card(top, (nodes) => nodes[0]),
    centre: card(centre, (nodes) => nodes[0]),
    bottom: card(bottom, (nodes) => nodes[nodes.length - 1]),
    right: stack(right),
    left: stack(left),
  };
  const label = (id: string) => architecture.nodes.find((node) => node.id === id)?.label ?? id;
  const routes: HubRoute[] = architecture.flows
    .map((flow) => ({
      id: flow.id,
      label: flow.label,
      hops: flow.path.flatMap((edgeId) => {
        const edge = architecture.edges.find((item) => item.id === edgeId);
        const from = edge ? place.get(edge.from) : undefined;
        const to = edge ? place.get(edge.to) : undefined;
        return edge && from && to && from !== to ? [{ from, to, label: `${label(edge.from)} → ${label(edge.to)}` }] : [];
      }),
    }))
    .filter((route) => route.hops.length >= 2);
  return { ...parts, routes };
}

/** A case study on the home page: what it is, its kind, and a picture of it. The figures are in the case study. */
function FeaturedCard({ project }: { project: Project }) {
  const href = `/projects/${project.id}`;
  const shot = project.screenshots[0];
  return (
    <article data-tone={project.tone} className="panel panel-link flex h-full flex-col p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <Tile tone={project.tone} solid className="!h-11 !w-11 !rounded-xl">
          <AppIcon name={project.icon} size={21} />
        </Tile>
        <h3 className="min-w-0 text-[0.9375rem] font-bold leading-snug">
          <Link href={href} className="hover:text-accent">
            {project.title}
          </Link>
        </h3>
      </div>
      <p className="mt-2.5 line-clamp-3 text-[0.8125rem] leading-relaxed text-muted">{project.tagline}</p>
      {/* One row: a category that does not fit is left out here and shown in the case study. */}
      <ul className="mt-2.5 flex max-h-[1.375rem] flex-wrap gap-1 overflow-hidden" aria-label="Categories">
        {project.categories.map((category) => (
          <li key={category}>
            <Tag tone={CATEGORY_TONE[category]} className="!px-2 !py-px !text-[0.6875rem]">
              {CATEGORY_SHORT[category]}
            </Tag>
          </li>
        ))}
      </ul>
      <Link href={href} className="group relative mt-3 block overflow-hidden rounded-xl border border-line bg-surface-2" aria-label={`Read the case study: ${project.title}`}>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- a static file with known dimensions
          <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" className="aspect-[16/10] w-full object-cover object-top" />
        ) : (
          <MiniArchitecture architecture={project.architecture} className="aspect-[16/10] w-full bg-surface p-2.5" />
        )}
        <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-surface text-fg shadow-md transition-transform group-hover:translate-x-0.5" aria-hidden>
          <ArrowRight size={15} />
        </span>
      </Link>
    </article>
  );
}

export default function HomePage() {
  const site = getSite();
  const projects = getProjects();
  const flagship = projects[0];
  const workflow = flagship.workflows[0];
  const nodeLabels = Object.fromEntries(flagship.architecture.nodes.map((node) => [node.id, node.label]));
  const featured = projects.slice(0, FEATURED);
  const more = projects.slice(FEATURED);
  const workflows = projects.flatMap((project) => project.workflows);

  // Counted from the content of this site, so none of these is a claim that needs taking on trust.
  const counts: { icon: LucideIcon; tone: Tone; value: number; label: string }[] = [
    { icon: LayoutGrid, tone: "blue", value: projects.length, label: "Interactive case studies" },
    { icon: WorkflowIcon, tone: "teal", value: workflows.length, label: "Workflows you can run" },
    { icon: ShieldAlert, tone: "violet", value: workflows.reduce((sum, item) => sum + item.faults.length, 0), label: "Failures you can inject" },
    { icon: Boxes, tone: "amber", value: projects.reduce((sum, project) => sum + project.architecture.nodes.length, 0), label: "Components documented" },
  ];

  // The last two words of the headline carry the accent.
  const words = site.headline.split(" ");
  const lead = words.slice(0, -2).join(" ");
  const accent = words.slice(-2).join(" ");

  return (
    <>
      <section aria-labelledby="hero-title" className="container-page overflow-x-clip">
        <div className="grid grid-cols-1 gap-10 pb-8 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-12">
          <div>
            <div className="enter mb-5 flex items-center gap-4">
              <Image src="/elsayed-mustafa.jpg" alt={`Portrait of ${site.name}`} width={640} height={640} sizes="88px" priority className="h-[5.5rem] w-[5.5rem] rounded-full border-2 border-surface object-cover shadow-md ring-2 ring-accent/30" />
              <p className="leading-tight">
                <span className="block text-xl font-bold">{site.name}</span>
                <span className="mt-1 block text-[0.9375rem] text-muted">{site.role}</span>
              </p>
            </div>
            <ul className="enter flex flex-wrap gap-2" aria-label="At a glance">
              <li className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.8125rem] font-medium shadow-sm">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
                {site.availability}
              </li>
              <li className="rounded-full border border-line bg-surface px-3 py-1 text-[0.8125rem] font-medium text-muted shadow-sm">{site.role}</li>
            </ul>
            <h1 id="hero-title" className="enter mt-5 text-[2.25rem] font-bold leading-[1.08] sm:text-[3rem] 2xl:text-[3.5rem]" style={{ "--i": 1 } as React.CSSProperties}>
              {lead} <span className="text-shimmer">{accent}</span>
            </h1>
            <p className="enter mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-muted 2xl:text-lg" style={{ "--i": 2 } as React.CSSProperties}>
              {site.intro}
            </p>
            <div className="enter mt-6 flex flex-wrap gap-3" style={{ "--i": 3 } as React.CSSProperties}>
              <Link href="/projects" className="btn btn-primary">
                <Play size={15} aria-hidden /> Explore my projects <ArrowRight size={15} aria-hidden />
              </Link>
              <a href="#demo" className="btn border-accent/25 bg-accent-soft text-accent hover:border-accent">
                <Zap size={15} aria-hidden /> Try an automation demo
              </a>
              {site.links.resume ? (
                <Link href={site.links.resume} className="btn btn-secondary">
                  <FileText size={15} aria-hidden /> View resume
                </Link>
              ) : null}
            </div>
            <p className="enter mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" style={{ "--i": 4 } as React.CSSProperties}>
              <MapPin size={15} className="text-accent" aria-hidden />
              Based in {site.location}
            </p>
          </div>
          <div className="enter" style={{ "--i": 2 } as React.CSSProperties}>
            <SystemHub
              title={flagship.title}
              href={`/projects/${flagship.id}#architecture`}
              components={flagship.architecture.nodes.length}
              connections={flagship.architecture.edges.length}
              {...hubOf(flagship)}
            />
          </div>
        </div>

        <div className="enter panel grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-center" style={{ "--i": 5 } as React.CSSProperties}>
          <ul className="contents" aria-label="This site in numbers">
            {counts.map((item) => (
              <li key={item.label} className="flex items-center gap-3">
                <Tile tone={item.tone} className="!h-11 !w-11 !rounded-xl">
                  <item.icon size={20} aria-hidden />
                </Tile>
                <p className="min-w-0">
                  <span className="block text-[1.375rem] font-bold leading-none">
                    <CountUp value={item.value} />
                  </span>
                  <span className="mt-1 block text-[0.8125rem] leading-tight text-muted">{item.label}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container-page mt-5">
        <section id="work" aria-labelledby="work-title" className="reveal panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-start gap-3">
              <Tile tone="blue" className="!h-10 !w-10 !rounded-xl">
                <LayoutGrid size={19} aria-hidden />
              </Tile>
              <div className="min-w-0">
                <h2 id="work-title" className="text-lg font-bold leading-snug">
                  Featured projects
                </h2>
                <p className="mt-0.5 text-sm text-muted">Each has a workflow you can run and an architecture you can explore.</p>
              </div>
            </div>
            <Link href="/projects" className="btn btn-secondary btn-sm">
              All {projects.length + site.catalogue.length} projects <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          <ul className="mt-4 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {featured.map((project) => (
              <li key={project.id}>
                <FeaturedCard project={project} />
              </li>
            ))}
          </ul>

          {more.length > 0 ? (
            <>
              <h3 className="mt-5 text-[0.8125rem] font-bold uppercase tracking-[0.06em] text-subtle">More case studies</h3>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {more.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      data-tone={project.tone}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3.5 text-[0.8125rem] font-semibold shadow-sm transition-colors hover:border-accent hover:text-accent"
                    >
                      <span className="tile !h-7 !w-7 !rounded-full" aria-hidden>
                        <AppIcon name={project.icon} size={14} />
                      </span>
                      {project.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

      </div>

      <section id="capabilities" aria-labelledby="capabilities-title" className="container-page mt-5">
        <div className="reveal panel p-4 sm:p-5">
          <CardHeading
            icon={Zap}
            tone="violet"
            title="Core engineering capabilities"
            note="Open one to see where it is implemented."
            action={
              <Link href="/projects" className="btn btn-secondary btn-sm">
                See the systems <ArrowRight size={14} aria-hidden />
              </Link>
            }
          />
          {/* The section's heading is the card's title above; this keeps the landmark named. */}
          <span id="capabilities-title" className="sr-only">
            Core engineering capabilities
          </span>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {site.capabilities.map((capability) => (
              <li key={capability.id} data-tone={capability.tone}>
                <details className="group h-full rounded-xl border border-line bg-surface open:border-tone/40 open:shadow-sm">
                  <summary className="flex items-start gap-3 p-3">
                    <span className="tile !h-10 !w-10 !rounded-xl" aria-hidden>
                      <AppIcon name={capability.icon} size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold leading-snug">{capability.title}</span>
                      <span className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-muted group-open:line-clamp-none">{capability.summary}</span>
                    </span>
                    <ChevronDown size={16} className="mt-0.5 shrink-0 text-subtle transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <ul className="space-y-2.5 border-t border-line p-3">
                    {capability.evidence.map((item) => (
                      <li key={item.text} className="text-[0.8125rem] leading-snug">
                        {item.projectId ? (
                          <Link href={`/projects/${item.projectId}`} className="font-semibold hover:text-accent hover:underline">
                            {item.text}
                          </Link>
                        ) : (
                          <span className="font-semibold">{item.text}</span>
                        )}
                        <span className="mt-0.5 block">
                          <ProvenanceBadge provenance={item.provenance} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container-page">
        <Section
          id="demo"
          kicker="Try the work"
          title="Watch one WhatsApp message become a booked visit"
          intro="The core workflow of a CRM I built for a field-service client. Press Run, then make the coordinator's decision when the workflow asks for it."
          action={
            <Link href="/automation-lab" className="btn btn-secondary btn-sm">
              <FlaskConical size={14} aria-hidden /> {workflows.length} demos in the Automation Lab
            </Link>
          }
        >
          <WorkflowSimulator workflow={workflow} system={runMapSystem(flagship.architecture)} nodeLabels={nodeLabels} repository={flagship.repository} variant="compact" caseStudyHref={`/projects/${flagship.id}#demo`} />
        </Section>

        {site.catalogue.length > 0 ? (
          <Section id="write-ups" kicker="More work" title="Written up on GitHub" intro="Architecture and design write-ups. Their interactive pages are in progress.">
            <ul className="grid gap-4 md:grid-cols-2">
              {site.catalogue.map((item) => (
                <li key={item.url}>
                  <CatalogueRow item={item} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section id="about" kicker="About" title="How I work">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="panel p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <Image src="/elsayed-mustafa.jpg" alt={`Portrait of ${site.name}`} width={640} height={640} sizes="144px" className="h-36 w-36 shrink-0 rounded-2xl object-cover shadow-md" />
                <p className="text-[1.0625rem] leading-relaxed">{site.about}</p>
              </div>
              <h3 className="label mt-6">How I approach a problem</h3>
              <ol className="mt-3 space-y-3">
                {site.approach.map((item, index) => (
                  <li key={item} data-tone={TONE_CYCLE[index % TONE_CYCLE.length]} className="flex items-start gap-3.5">
                    <span className="tile tile-sm text-sm font-bold" aria-hidden>
                      {index + 1}
                    </span>
                    <span className="pt-1 leading-relaxed">{item}</span>
                  </li>
                ))}
              </ol>
              {site.seeking ? (
                <p className="mt-6 rounded-xl border border-accent/25 bg-accent-soft p-4 font-semibold">
                  {site.seeking}{" "}
                  <a href="#contact" className="link">
                    Get in touch
                  </a>
                </p>
              ) : null}
            </div>

            <div className="space-y-5">
              <div className="panel p-5">
                <SideHeading icon={Briefcase} tone="blue">
                  Experience
                </SideHeading>
                <ol className="mt-4 space-y-4">
                  {site.experience.map((job) => (
                    <li key={job.organisation} className="border-l-2 border-accent/40 pl-4">
                      <p className="font-bold">{job.title}</p>
                      <p className="text-sm text-muted">
                        {job.organisation} · {job.period}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{job.summary}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="eng-only panel p-5">
                <SideHeading icon={GraduationCap} tone="violet">
                  Education
                </SideHeading>
                <ul className="mt-4 space-y-3">
                  {site.education.map((item) => (
                    <li key={item.title}>
                      <p className="font-bold">{item.title}</p>
                      <p className="text-sm text-muted">
                        {item.institution} · {item.period}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="eng-only panel p-5">
                <SideHeading icon={Award} tone="amber">
                  Certifications
                </SideHeading>
                <ul className="mt-4 space-y-2 text-sm">
                  {site.certifications.map((certificate) => (
                    <li key={certificate.url}>
                      <a href={certificate.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-accent hover:underline">
                        {certificate.name} <ArrowUpRight size={13} aria-hidden />
                      </a>
                      <span className="text-muted"> · {certificate.issuer}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Section>
      </div>

      <section id="contact" aria-labelledby="contact-title" className="container-page pb-16 pt-4 sm:pb-20">
        <div className="reveal panel overflow-hidden bg-primary p-7 text-primary-fg sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.08em] opacity-80">Contact</p>
          <h2 id="contact-title" className="mt-3 max-w-3xl text-3xl font-bold sm:text-[2.5rem] sm:leading-[1.1]">
            Have a workflow that should run itself?
          </h2>
          <p className="mt-4 max-w-2xl text-[1.0625rem] leading-relaxed opacity-85">
            Email is the fastest way to reach me about a role or a project. {site.location}. {site.availability}.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <a href={`mailto:${site.links.email}`} className="btn bg-surface text-fg hover:opacity-90">
              <Mail size={16} aria-hidden /> {site.links.email}
            </a>
            <a href={site.links.linkedin} target="_blank" rel="noreferrer" className="btn border-primary-fg/30 text-primary-fg hover:bg-primary-fg/10">
              <LinkedinMark size={15} /> LinkedIn <ArrowUpRight size={14} aria-hidden />
            </a>
            <a href={site.links.github} target="_blank" rel="noreferrer" className="btn border-primary-fg/30 text-primary-fg hover:bg-primary-fg/10">
              <GithubMark size={16} /> GitHub <ArrowUpRight size={14} aria-hidden />
            </a>
            {site.links.upwork ? (
              <a href={site.links.upwork} target="_blank" rel="noreferrer" className="btn border-primary-fg/30 text-primary-fg hover:bg-primary-fg/10">
                Upwork <ArrowUpRight size={14} aria-hidden />
              </a>
            ) : null}
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-2 text-sm opacity-85">
            <KeyRound size={15} aria-hidden />
            Want to read the code behind a project?{" "}
            <Link href="/source-access" className="font-semibold underline underline-offset-4 hover:opacity-80">
              Request access
            </Link>{" "}
            and say what you need it for.
          </p>
        </div>
      </section>
    </>
  );
}
