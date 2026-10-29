import { CircleCheck } from "lucide-react";
import { AppIcon, TONE_CYCLE } from "@/components/ui/Icon";
import type { Site } from "@/content/schema";

/**
 * Every role as a step on one line, newest first: the dates on the left, the
 * role's icon on the line, and the role itself in a card on the right. On a
 * phone the dates move into the card.
 */
export function ExperienceTimeline({ jobs }: { jobs: Site["experience"] }) {
  return (
    <ol className="relative">
      {jobs.map((job, index) => {
        const tone = TONE_CYCLE[index % TONE_CYCLE.length];
        const last = index === jobs.length - 1;
        return (
          <li key={job.organisation} data-tone={tone} className="reveal relative grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 md:grid-cols-[11rem_3.5rem_minmax(0,1fr)] md:gap-x-5">
            <p className="hidden pt-4 text-right text-[0.9375rem] font-bold leading-snug text-tone md:block">{job.period}</p>
            <div className="relative flex justify-center">
              {/* The line that joins one role to the next. */}
              {last ? null : <span aria-hidden className="absolute left-1/2 top-14 bottom-0 w-0.5 -translate-x-1/2 bg-line-strong" />}
              <span className="tile-solid tile relative mt-2.5 !h-12 !w-12 !rounded-2xl text-white" aria-hidden>
                <AppIcon name={job.icon} size={22} />
              </span>
            </div>
            <div className={"panel panel-link mb-4 p-4 sm:p-5" + (last ? " mb-0" : "")}>
              <p className="text-sm font-bold text-tone md:hidden">{job.period}</p>
              <h3 className="text-lg font-bold leading-snug">{job.title}</h3>
              <p className="mt-0.5 font-semibold text-tone">{job.organisation}</p>
              <p className="mt-2 leading-relaxed text-muted">{job.summary}</p>
              {job.highlights.length > 0 ? (
                <ul aria-label={`What I did at ${job.organisation}`} className="mt-3 space-y-2">
                  {job.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-[0.9375rem] leading-snug">
                      <CircleCheck size={17} aria-hidden className="mt-0.5 shrink-0 text-tone-vivid" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
