import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AppIcon, Tile } from "@/components/ui/Icon";
import { TechTile } from "@/components/ui/TechIcon";
import type { Project, Site } from "@/content/schema";

/**
 * What I can do for a client, in plain words: one card per skill, the tools it
 * is done with as logos, and the case study that shows it. Nothing here needs
 * a technical reader.
 */
export function Skills({ skills, projects }: { skills: Site["skills"]; projects: Project[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {skills.map((skill, index) => {
        const project = projects.find((item) => item.id === skill.projectId);
        return (
          <li key={skill.id} data-tone={skill.tone} className="enter" style={{ "--i": 4 + index } as React.CSSProperties}>
            <Link
              href={project ? `/projects/${project.id}` : "/projects"}
              className="group panel panel-link flex h-full items-start gap-4 p-4"
              title={project ? `Example: ${project.title}` : undefined}
            >
              <Tile tone={skill.tone} solid className="!h-12 !w-12 !rounded-2xl transition-transform duration-300 group-hover:scale-110">
                <AppIcon name={skill.icon} size={24} />
              </Tile>
              <span className="min-w-0 flex-1">
                <span className="block font-bold leading-snug">{skill.title}</span>
                <span className="mt-1 block text-sm leading-snug text-muted">{skill.text}</span>
                <span className="mt-3 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5" aria-hidden>
                    {skill.tools.map((tool) => (
                      <span key={tool} title={tool} className="flex">
                        <TechTile name={tool} size={24} />
                      </span>
                    ))}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-semibold text-accent">
                    See an example <ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The tools I work with, as one row of logos with their names. */
export function ToolStrip({ tools }: { tools: string[] }) {
  return (
    <ul aria-label="Tools I work with" className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      {tools.map((tool) => (
        <li key={tool} className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
          <TechTile name={tool} size={24} />
          {tool}
        </li>
      ))}
    </ul>
  );
}
