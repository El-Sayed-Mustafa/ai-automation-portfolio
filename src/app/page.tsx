import {
  ArrowRight,
  ArrowUpRight,
  Award,
  FileText,
  FlaskConical,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  Mail,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { MiniArchitecture } from "@/components/architecture/MiniArchitecture";
import { runMapSystem } from "@/components/simulator/run-map-system";
import { ExperienceTimeline } from "@/components/home/Experience";
import { SkillGroups, Skills } from "@/components/home/Skills";
import { UpworkCard } from "@/components/home/Upwork";
import { SystemHub, type HubLayer, type HubRoute, type HubSide } from "@/components/home/SystemHub";
import { layerTone } from "@/components/architecture/NodeDetails";
import { WorkflowSimulator } from "@/components/simulator/WorkflowSimulator";
import { AppIcon, GithubMark, LinkedinMark, TONE_CYCLE, Tile, UpworkMark } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";
import { getProjects, getSite } from "@/content/load";
import { type ArchitectureNode, type Project, type Tone } from "@/content/schema";

/** How many case studies the home page shows in full. */
const FEATURED = 4;

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
    <article data-tone={project.tone} className="panel panel-link flex h-full flex-col p-4 shadow-sm" title={project.tagline}>
      <div className="flex items-start gap-3">
        <Tile tone={project.tone} solid className="!h-11 !w-11 !rounded-xl">
          <AppIcon name={project.icon} size={21} />
        </Tile>
        <h3 className="min-w-0 self-center text-base font-bold leading-snug">
          <Link href={href} className="hover:text-accent">
            {project.title}
          </Link>
        </h3>
      </div>
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
  const workflows = projects.flatMap((project) => project.workflows);

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
            </ul>
            <h1 id="hero-title" className="enter mt-5 text-[2.25rem] font-bold leading-[1.08] sm:text-[3rem] 2xl:text-[3.5rem]" style={{ "--i": 1 } as React.CSSProperties}>
              {lead} <span className="text-shimmer">{accent}</span>
            </h1>
            <p className="enter mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-muted 2xl:text-lg" style={{ "--i": 2 } as React.CSSProperties}>
              {site.intro}
            </p>
            <div className="enter mt-6 flex flex-wrap gap-3" style={{ "--i": 3 } as React.CSSProperties}>
              {site.links.upwork ? (
                <a href={site.links.upwork} target="_blank" rel="noreferrer" className="btn btn-upwork">
                  <UpworkMark size={17} /> Hire me on Upwork <ArrowUpRight size={15} aria-hidden />
                </a>
              ) : null}
              <a href="#contact" className="btn border-accent/25 bg-accent-soft text-accent hover:border-accent">
                <Mail size={15} aria-hidden /> Contact me
              </a>
              {site.links.resume ? (
                <Link href={site.links.resume} className="btn btn-secondary">
                  <FileText size={15} aria-hidden /> View resume
                </Link>
              ) : null}
            </div>
            <p className="enter mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" style={{ "--i": 4 } as React.CSSProperties}>
              <MapPin size={15} className="text-accent" aria-hidden />
              Based in {site.location} · Working with clients remotely
            </p>
          </div>
          {/* On a phone the picture is too small to read, and the skills below come first. */}
          <div className="enter hidden sm:block" style={{ "--i": 2 } as React.CSSProperties}>
            <SystemHub
              title={flagship.title}
              href={`/projects/${flagship.id}#architecture`}
              components={flagship.architecture.nodes.length}
              connections={flagship.architecture.edges.length}
              {...hubOf(flagship)}
            />
          </div>
        </div>

      </section>

      <section id="skills" aria-labelledby="skills-title" className="container-page scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 id="skills-title" className="text-2xl font-bold sm:text-[1.75rem]">
              What I can do for you
            </h2>
            <p className="mt-1 text-muted">Each one is a system I have built. Open it to see how it works.</p>
          </div>
        </div>
        <div className="mt-4">
          <Skills skills={site.skills} projects={projects} />
        </div>
      </section>

      <section id="experience" aria-labelledby="experience-title" className="container-page mt-14 scroll-mt-20">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent">Experience</p>
        <h2 id="experience-title" className="mt-1 text-2xl font-bold sm:text-[1.75rem]">
          Where I have worked
        </h2>
        <div className="mt-6">
          <ExperienceTimeline jobs={site.experience} />
        </div>
      </section>

      <section id="my-skills" aria-labelledby="my-skills-title" className="container-page mt-14 scroll-mt-20">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent">Skills</p>
        <h2 id="my-skills-title" className="mt-1 text-2xl font-bold sm:text-[1.75rem]">
          Tools and skills I work with
        </h2>
        <div className="mt-6">
          <SkillGroups groups={site.skillGroups} />
        </div>
      </section>

      {site.links.upwork && site.upwork ? (
        <div className="container-page mt-12">
          <UpworkCard url={site.links.upwork} profile={site.upwork} />
        </div>
      ) : null}

      <div className="container-page mt-12">
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
                <p className="mt-0.5 text-sm text-muted">Real systems I built. Open one to try it.</p>
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

        </section>

      </div>

      <div className="container-page">
        <Section
          id="demo"
          kicker="See it work"
          title="A WhatsApp message becomes a booked visit"
          intro="Press Run and follow it. When it asks, you make the decision."
          action={
            <Link href="/automation-lab" className="btn btn-secondary btn-sm">
              <FlaskConical size={14} aria-hidden /> {workflows.length} demos in the Automation Lab
            </Link>
          }
        >
          <WorkflowSimulator workflow={workflow} system={runMapSystem(flagship.architecture)} nodeLabels={nodeLabels} repository={flagship.repository} variant="compact" caseStudyHref={`/projects/${flagship.id}#demo`} />
        </Section>

        <Section id="about" kicker="About" title="About me">
          <div className="about-grid grid gap-5 lg:items-start">
            <div className="panel p-5 sm:p-6">
              <p className="text-[1.0625rem] leading-relaxed">{site.about}</p>
              <h3 className="eng-only label mt-6">How I approach a problem</h3>
              <ol className="eng-only mt-3 space-y-3">
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

            <div className="eng-only space-y-5">
              <div className="panel p-5">
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
              <div className="panel p-5">
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
              <a href={site.links.upwork} target="_blank" rel="noreferrer" className="btn btn-upwork">
                <UpworkMark size={16} /> Hire me on Upwork <ArrowUpRight size={14} aria-hidden />
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
