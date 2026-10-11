"use client";

import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { ProvenanceBadge, SourceList } from "@/components/ui/Provenance";
import { NodeTile } from "@/components/ui/TechIcon";
import type { Architecture, ArchitectureNode, Project } from "@/content/schema";
import { layerTone } from "./NodeDetails";

function PanelList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="label mb-1">{title}</p>
      <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed marker:text-subtle">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What one component is. The short version is what it does, what it is built
 * with and what the claim rests on. The rest (why this technology, what goes
 * in and out, how it fails) is always shown in the engineer lens and is one
 * press away in the recruiter lens.
 */
export function NodePanel({
  node,
  architecture,
  repository,
  onClose,
}: {
  node: ArchitectureNode;
  architecture: Architecture;
  repository: Project["repository"];
  onClose(): void;
}) {
  const [more, setMore] = useState(false);
  const label = (id: string) => architecture.nodes.find((item) => item.id === id)?.label ?? id;
  const outgoing = architecture.edges.filter((edge) => edge.from === node.id);
  const incoming = architecture.edges.filter((edge) => edge.to === node.id);
  const layer = architecture.layers.find((item) => item.id === node.layer)?.label ?? node.layer;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3" data-tone={layerTone(architecture, node.layer)}>
          <NodeTile node={node} size={40} />
          <div className="min-w-0">
            <h4 className="text-[1.0625rem] font-bold leading-snug">{node.label}</h4>
            <p className="mt-0.5 text-[0.8125rem] font-semibold text-tone">{layer}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close component details" className="btn btn-secondary btn-sm shrink-0 px-2">
          <X size={15} aria-hidden />
        </button>
      </div>

      {node.status !== "active" ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface-2 p-2.5 text-sm text-muted">
          <span className="font-semibold uppercase">{node.status}</span>
          {node.statusNote ? `: ${node.statusNote}` : ""}
        </p>
      ) : null}

      <div>
        <p className="label mb-1">Responsibility</p>
        <p className="text-sm leading-relaxed">{node.responsibility}</p>
      </div>

      <div>
        <p className="label mb-1">Technology</p>
        <p className="text-sm">{node.technology}</p>
      </div>

      <div className={"space-y-4 " + (more ? "" : "eng-only")}>
        {node.whyThisTechnology ? (
          <div>
            <p className="label mb-1">Why this technology</p>
            <p className="text-sm leading-relaxed">{node.whyThisTechnology.text}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ProvenanceBadge provenance={node.whyThisTechnology.provenance} />
              <SourceList project={{ repository }} sources={node.whyThisTechnology.sources} />
            </div>
          </div>
        ) : null}

        <PanelList title="Input" items={node.inputs} />
        <PanelList title="Output" items={node.outputs} />

        {outgoing.length + incoming.length > 0 ? (
          <div>
            <p className="label mb-1">Dependencies</p>
            <ul className="space-y-1 text-sm">
              {outgoing.map((edge) => (
                <li key={edge.id}>
                  <span className="text-subtle">calls </span>
                  <span className="font-semibold">{label(edge.to)}</span>
                  <span className="text-muted"> · {edge.protocol}</span>
                </li>
              ))}
              {incoming.map((edge) => (
                <li key={edge.id}>
                  <span className="text-subtle">called by </span>
                  <span className="font-semibold">{label(edge.from)}</span>
                  <span className="text-muted"> · {edge.protocol}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <PanelList title="Implementation details" items={node.details} />
        <PanelList title="Known failure modes" items={node.failureModes} />
        <PanelList title="Reliability strategy" items={node.reliability} />
      </div>

      <div>
        <p className="label mb-1.5">Evidence</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ProvenanceBadge provenance={node.provenance} />
          <SourceList project={{ repository }} sources={node.sources} />
        </div>
      </div>

      {/* The engineer lens shows everything already, so it has no use for this. */}
      <button type="button" className="rec-only inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-accent hover:underline" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? "Less detail" : "Inputs, dependencies and failure modes"}
        <ChevronDown size={14} className={"transition-transform " + (more ? "rotate-180" : "")} aria-hidden />
      </button>
    </div>
  );
}
