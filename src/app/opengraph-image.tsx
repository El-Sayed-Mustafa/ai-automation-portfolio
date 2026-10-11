import { getProjects, getSite } from "@/content/load";
import { OG_CONTENT_TYPE, OG_SIZE, shareImage } from "@/lib/og";

const site = getSite();

export const alt = `${site.name}, ${site.role}: ${site.headline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The share image of the site: its headline, and the first case study's layers as the little picture. */
export default function Image() {
  const projects = getProjects();
  const flagship = projects[0];
  const workflows = projects.reduce((sum, project) => sum + project.workflows.length, 0);
  return shareImage({
    eyebrow: "Interactive engineering portfolio",
    title: site.headline,
    text: site.intro,
    chips: [`${projects.length} case studies`, `${workflows} workflows you can run`],
    tone: "blue",
    columns: flagship.architecture.layers.map((layer) => flagship.architecture.nodes.filter((node) => node.layer === layer.id).length).filter((count) => count > 0),
    author: site.name,
    role: site.role,
  });
}
