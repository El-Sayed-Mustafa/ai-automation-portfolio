import type { Metadata } from "next";
import { CategoryFilter, type FilterItem } from "@/components/project/CategoryFilter";
import { CaseStudyCard, CatalogueRow } from "@/components/project/ProjectCards";
import { Tag } from "@/components/ui/Icon";
import { getProjects, getSite } from "@/content/load";
import { CATEGORY_LABELS } from "@/content/schema";

export const metadata: Metadata = {
  title: "Projects",
  description: "Interactive case studies and write-ups of automation, backend, data and AI systems.",
  alternates: { canonical: "/projects" },
};

export default function ProjectsPage() {
  const site = getSite();
  const projects = getProjects();
  const items: FilterItem[] = [
    ...projects.map((project) => ({
      id: project.id,
      categories: project.categories,
      kind: "case-study" as const,
      search: [project.title, project.tagline, ...project.stack.map((item) => item.name), ...project.categories.map((category) => CATEGORY_LABELS[category])]
        .join(" ")
        .toLowerCase(),
      content: <CaseStudyCard project={project} headingLevel={3} />,
    })),
    ...site.catalogue.map((item) => ({
      id: item.url,
      categories: item.categories,
      kind: "write-up" as const,
      search: [item.title, item.summary, item.organisation, ...item.stack, ...item.categories.map((category) => CATEGORY_LABELS[category])]
        .join(" ")
        .toLowerCase(),
      content: <CatalogueRow item={item} />,
    })),
  ];

  return (
    <div className="container-page pb-20 pt-10 sm:pt-14">
      <header className="mb-8 max-w-(--container-measure)">
        <Tag tone="indigo" className="px-3 py-1 text-[0.8125rem]">
          Projects ({items.length})
        </Tag>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Projects I built</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Real systems for real businesses. Open one to see what it does, and try it.
        </p>
      </header>
      <CategoryFilter items={items} />
    </div>
  );
}
