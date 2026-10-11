"use client";

import { ArrowRight, Workflow as WorkflowIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TONE_CYCLE } from "@/components/ui/Icon";

export interface WorkflowStage {
  id: string;
  label: string;
  /** What the first step of the stage does, in a sentence. */
  summary: string;
  /** Steps of the stage beyond the first. */
  more: number;
  /** The components the stage's steps run on. */
  nodeIds: string[];
}

/**
 * The workflow in a few numbered stages, left to right.
 *
 * With `onActive` the stages are buttons: pointing at one, focusing it or
 * pressing it names the stage to whoever is listening, which the architecture
 * diagram uses to bring that stage's components forward. `active` is the stage
 * drawn as chosen; `pinned` is the one that was pressed and stays chosen when
 * the pointer leaves. Without `onActive` the stages are plain text.
 */
export function WorkflowSteps({
  id,
  stages,
  intro,
  footer,
  active = null,
  pinned = null,
  onActive,
}: {
  id: string;
  stages: WorkflowStage[];
  intro?: string;
  footer?: ReactNode;
  active?: string | null;
  pinned?: string | null;
  onActive?(stageId: string | null, pinned: boolean): void;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="reveal rounded-2xl border border-line bg-accent-soft/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold">
          <WorkflowIcon size={18} className="text-accent" aria-hidden />
          How it works
        </h3>
        {onActive ? <p className="text-[0.8125rem] text-subtle">Point at a stage to see where it runs in the diagram; press it to keep it.</p> : null}
      </div>
      {intro ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{intro}</p> : null}

      <ol className="mt-4 grid gap-x-2 gap-y-3 sm:grid-cols-2 xl:flex xl:items-stretch">
        {stages.map((stage, index) => {
          const tone = TONE_CYCLE[index % TONE_CYCLE.length];
          const selected = active === stage.id;
          const body = (
            <>
              <span className="tile tile-solid !h-10 !w-10 !rounded-full text-[1.1875rem] font-bold leading-none" aria-hidden>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-snug">{stage.label}</span>
                <span className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{stage.summary}</span>
                {stage.more > 0 ? (
                  <span className="mt-1 block text-xs font-semibold text-tone">
                    + {stage.more} more step{stage.more > 1 ? "s" : ""}
                  </span>
                ) : null}
              </span>
            </>
          );
          const shape = "flex h-full w-full items-start gap-3 rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ";
          return (
            <li key={stage.id} data-tone={tone} className="flex min-w-0 items-stretch gap-2 xl:flex-1">
              {onActive ? (
                <button
                  type="button"
                  aria-pressed={pinned === stage.id}
                  onMouseEnter={() => onActive(stage.id, false)}
                  onMouseLeave={() => onActive(null, false)}
                  onFocus={() => onActive(stage.id, false)}
                  onBlur={() => onActive(null, false)}
                  onClick={() => onActive(stage.id, true)}
                  className={shape + (selected ? "border-tone-vivid bg-surface shadow-sm" : "border-transparent bg-surface/70 hover:border-tone-vivid/50 hover:bg-surface")}
                >
                  {body}
                </button>
              ) : (
                <div className={shape + "border-transparent bg-surface/70"}>{body}</div>
              )}
              {index < stages.length - 1 ? <ArrowRight size={16} className="hidden shrink-0 self-center text-subtle xl:block" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">{footer}</div> : null}
    </section>
  );
}
