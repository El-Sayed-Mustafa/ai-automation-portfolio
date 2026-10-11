import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { CaseStudyTabs } from "@/components/project/CaseStudyTabs";
import {
  ArchitecturePanel,
  DecisionsPanel,
  DemoPanel,
  EvidencePanel,
  LimitationsPanel,
  NextSteps,
  OverviewPanel,
  ProjectAside,
  ProjectHero,
  caseStudyTabs,
} from "@/components/project/ProjectSections";
import { ProjectDrawer } from "@/components/project/ProjectDrawer";
import { ProjectSidebar, type SidebarItem } from "@/components/project/ProjectSidebar";
import { CATEGORY_TONE } from "@/components/ui/Icon";
import { catalogueId, getProject, getProjects, getSite } from "@/content/load";
import { CATEGORY_SHORT } from "@/content/schema";
// The diagram library's stylesheet loads with the route, so the lazily loaded
// diagram chunk is JavaScript only and never renders unstyled.
import "@xyflow/react/dist/style.css";

// Case studies are built from local, validated content, so every one of them
// is prerendered and no request ever renders on the server.
//
// The page awaits its params directly, with no Suspense boundary around the
// content. A boundary would put the content in the HTML as a hidden segment
// that a script reveals, and a link to a section (#demo, #architecture) can
// then be resolved by the browser before its target is on the page.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return getProjects().map((project) => ({ slug: project.id }));
}

export async function generateMetadata({ params }: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return { title: "Project not found" };
  return {
    title: project.title,
    description: project.tagline,
    alternates: { canonical: `/projects/${project.id}` },
    openGraph: { type: "article", title: project.title, description: project.tagline, url: `/projects/${project.id}` },
  };
}

export default async function ProjectPage({ params }: PageProps<"/projects/[slug]">) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const site = getSite();
  const projects = getProjects();
  const next = projects.length > 1 ? projects[(projects.indexOf(project) + 1) % projects.length] : undefined;
  const sidebar: SidebarItem[] = [
    ...projects.map((item) => ({
      id: item.id,
      href: `/projects/${item.id}`,
      title: item.title,
      blurb: item.tagline,
      icon: item.icon,
      tone: item.tone,
      tags: item.categories.map((category) => ({ label: CATEGORY_SHORT[category], tone: CATEGORY_TONE[category] })),
    })),
    ...site.catalogue.map((item) => ({
      id: catalogueId(item),
      href: item.url,
      title: item.title,
      blurb: item.summary,
      icon: item.icon,
      tone: item.tone,
      tags: item.categories.map((category) => ({ label: CATEGORY_SHORT[category], tone: CATEGORY_TONE[category] })),
      external: true,
    })),
  ];

  return (
    // The tab bar's height joins the header's in every anchor offset on this page.
    <article data-case-study style={{ "--subnav-h": "4.25rem" } as CSSProperties}>
      <div className="case-shell">
        <aside className="case-rail">
          <ProjectSidebar items={sidebar} currentId={project.id} />
        </aside>

        <div className="case-content">
          <div data-main className="min-w-0">
            <ProjectHero project={project} projectList={<ProjectDrawer items={sidebar} currentId={project.id} />} />
            <div className="sticky top-(--header-h) z-30 -mx-1 mt-5 bg-bg px-1 py-3">
              <CaseStudyTabs tabs={caseStudyTabs(project)} />
            </div>
            <div className="mt-3">
              <OverviewPanel project={project} />
              <DemoPanel project={project} />
              <ArchitecturePanel project={project} />
              <DecisionsPanel project={project} />
              <LimitationsPanel project={project} />
              <EvidencePanel project={project} />
            </div>
            <NextSteps next={next} email={site.links.email} />
          </div>

          <aside data-side aria-label="About this project" className="xl:sticky xl:top-[calc(var(--header-h)+1.5rem)] xl:max-h-[calc(100dvh-var(--header-h)-3rem)] xl:overflow-y-auto xl:pb-2 xl:pr-1">
            <ProjectAside project={project} />
          </aside>
        </div>
      </div>
    </article>
  );
}
