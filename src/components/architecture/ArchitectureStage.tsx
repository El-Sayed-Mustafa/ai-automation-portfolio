"use client";

import { useState, type ReactNode } from "react";
import { WorkflowSteps, type WorkflowStage } from "@/components/project/WorkflowSteps";
import type { Architecture, Project } from "@/content/schema";
import { ArchitectureExplorerLoader } from "./ArchitectureExplorerLoader";

/**
 * The architecture diagram with the workflow's stages under it. The two are
 * one component because they talk: pointing at a stage brings forward the
 * components that stage runs on.
 */
export function ArchitectureStage({
  architecture,
  repository,
  stages,
  heading,
  stagesIntro,
  stagesFooter,
}: {
  architecture: Architecture;
  repository: Project["repository"];
  stages: WorkflowStage[];
  /** The card's title block, rendered on the server so the heading is in the static page. */
  heading: ReactNode;
  stagesIntro?: string;
  stagesFooter?: ReactNode;
}) {
  // A stage that was pressed stays chosen; one that is only pointed at lasts as long as the pointer does.
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const active = hovered ?? pinned;
  const highlight = stages.find((stage) => stage.id === active)?.nodeIds;

  return (
    <div className="space-y-5">
      <ArchitectureExplorerLoader architecture={architecture} repository={repository} heading={heading} highlight={highlight} />
      {stages.length > 0 ? (
        <WorkflowSteps
          id="stages"
          stages={stages}
          intro={stagesIntro}
          footer={stagesFooter}
          active={active}
          pinned={pinned}
          onActive={(stageId, pin) => {
            // Pressing the pinned stage again lets it go.
            if (pin) setPinned((current) => (current === stageId ? null : stageId));
            else setHovered(stageId);
          }}
        />
      ) : null}
    </div>
  );
}
