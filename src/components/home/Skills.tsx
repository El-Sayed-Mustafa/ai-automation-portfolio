import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AppIcon, Tile } from "@/components/ui/Icon";
import { TechTile } from "@/components/ui/TechIcon";
import type { Project, Site } from "@/content/schema";
import { brandFor } from "@/components/ui/brand";

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
              className="group panel panel-link relative flex h-full items-center gap-4 p-4 sm:p-5"
              title={project ? `Example: ${project.title}` : undefined}
            >
              <Tile tone={skill.tone} solid className="!h-12 !w-12 !rounded-2xl transition-transform duration-300 group-hover:scale-110">
                <AppIcon name={skill.icon} size={24} />
              </Tile>
              <span className="min-w-0 flex-1">
                <span className="block text-[1.0625rem] font-bold leading-snug">{skill.title}</span>
                <span className="mt-1 block text-[0.9375rem] leading-snug text-muted">{skill.text}</span>
              </span>
              <ArrowRight size={18} aria-hidden className="shrink-0 text-subtle transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
              <span className="sr-only">See an example</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** My skills in the CV's groups: a card per group, each skill with its logo when it has one. */
export function SkillGroups({ groups }: { groups: Site["skillGroups"] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group, index) => (
        <li key={group.title} data-tone={group.tone} className="reveal panel p-5" style={{ "--i": index } as React.CSSProperties}>
          <h3 className="flex items-center gap-3 text-[1.0625rem] font-bold">
            <Tile tone={group.tone} solid className="!h-10 !w-10 !rounded-xl">
              <AppIcon name={group.icon} size={19} />
            </Tile>
            {group.title}
          </h3>
          <ul aria-label={group.title} className="mt-4 flex flex-wrap gap-2">
            {group.items.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pl-1 pr-2.5 text-[0.875rem] font-semibold">
                {brandFor(item) ? <TechTile name={item} size={22} /> : <span aria-hidden className="mx-1.5 h-2 w-2 rounded-full bg-tone-vivid" />}
                {item}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
