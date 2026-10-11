import { getProject, getProjects, getSite } from "@/content/load";
import { OG_CONTENT_TYPE, OG_SIZE, shareImage } from "@/lib/og";

export const alt = "Case study: what the system is, its status, and a picture of its layers";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** One image per case study, made when the site is built. */
export function generateStaticParams() {
  return getProjects().map((project) => ({ slug: project.id }));
}

/** The share image of a case study: its title, what it is, its status and role, and its own layers as the picture. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = getSite();
  const project = getProject(slug);
  if (!project) return new Response("Not found", { status: 404 });
  return shareImage({
    eyebrow: "Case study",
    title: project.title,
    text: project.tagline,
    chips: [project.statusLabel, project.roleLabel],
    tone: project.tone,
    columns: project.architecture.layers.map((layer) => project.architecture.nodes.filter((node) => node.layer === layer.id).length).filter((count) => count > 0),
    author: site.name,
    role: site.role,
  });
}
