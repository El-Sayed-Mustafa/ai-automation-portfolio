import type { MetadataRoute } from "next";
import { getProjects, getSiteUrl } from "@/content/load";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/projects`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/automation-lab`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/resume`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/source-access`, changeFrequency: "yearly", priority: 0.3 },
    ...getProjects().map((project) => ({
      url: `${base}/projects/${project.id}`,
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
  ];
}
