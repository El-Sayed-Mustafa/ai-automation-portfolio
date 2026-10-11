"use client";

import { Building2, ChevronDown, CircleDot, UserRound, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { EvidenceLine, ProvenanceMark } from "@/components/ui/Provenance";
import type { Project, Provenance, Tone } from "@/content/schema";

function Item({
  icon: Icon,
  tone,
  label,
  value,
  provenance,
  note,
  open,
  children,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string;
  /** Where the value comes from, as a mark beside it. The words are in the details. */
  provenance?: Provenance;
  /** The sentence behind the value. One line until the details are opened. */
  note?: string;
  open: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-start gap-3">
      <span data-tone={tone} className="tile !h-10 !w-10 !rounded-xl" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label !text-[0.6875rem]">{label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] font-bold leading-snug">
          <span className="min-w-0">{value}</span>
          {provenance ? <ProvenanceMark provenance={provenance} /> : null}
        </p>
        {note ? <p className={"mt-0.5 text-[0.8125rem] leading-snug text-muted " + (open ? "" : "summary-clamp")}>{note}</p> : null}
        {children ? (
          <div data-evidence className={open ? "mt-1.5" : "summary-more mt-1.5"}>
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Status, role and context in one compact row: a few words each, and at most
 * one line under them. "Details" opens the full sentences and what they rest
 * on, in place. The text is on the page once, so opening the details reveals
 * it and does not repeat it.
 *
 * Without JavaScript nothing is clamped and the evidence is shown, so the row
 * is simply taller.
 */
export function ProjectSummary({ project, engagementLabel }: { project: Project; engagementLabel: string }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const plain = (text: string) => text.trim().replace(/\.$/, "").toLowerCase();
  // A sentence that only repeats its own label is not shown under it.
  const statusNote = plain(project.status.text) === plain(project.statusLabel) ? undefined : project.status.text;
  const roleNote = plain(project.role.text) === plain(project.roleLabel) ? undefined : project.role.text;

  return (
    <div className="panel mt-4 flex items-start gap-2 px-4 py-3.5 sm:px-5" id={detailsId}>
      <ul aria-label="Status, role and context" className="grid min-w-0 flex-1 gap-x-6 gap-y-3.5 md:grid-cols-3">
        <Item icon={CircleDot} tone="green" label="Status" value={project.statusLabel} provenance={project.status.provenance} note={statusNote} open={open}>
          <EvidenceLine project={project} provenance={project.status.provenance} sources={project.status.sources} />
        </Item>
        <Item icon={UserRound} tone="blue" label="My role" value={project.roleLabel} provenance={project.role.provenance} note={roleNote} open={open}>
          <EvidenceLine project={project} provenance={project.role.provenance} sources={project.role.sources} />
        </Item>
        <Item icon={Building2} tone="violet" label="Context" value={engagementLabel} note={project.engagementNote} open={open} />
      </ul>
      <button
        type="button"
        className="summary-toggle -mr-1.5 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[0.8125rem] font-semibold text-accent hover:bg-accent-soft"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen(!open)}
      >
        {open ? "Show less" : "Details"}
        <ChevronDown size={14} className={"transition-transform " + (open ? "rotate-180" : "")} aria-hidden />
      </button>
    </div>
  );
}
