"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { layoutColumns } from "@/content/architecture-columns";
import type { Architecture, Project } from "@/content/schema";
import { ExplorerFooter, ExplorerPlaceholder } from "./ExplorerChrome";

type ExplorerProps = { architecture: Architecture; repository: Project["repository"]; heading?: ReactNode; highlight?: readonly string[] };

/**
 * The diagram library is the heaviest thing on a case-study page, so it loads
 * only in the browser and only for this component.
 *
 * Until it arrives, a placeholder with the same header and a canvas of the
 * same shape holds its place, so the sections below do not move when the
 * diagram appears. The list under the diagram carries the same information for
 * readers who never load it.
 */
export function ArchitectureExplorerLoader(props: ExplorerProps) {
  const [Explorer, setExplorer] = useState<ComponentType<ExplorerProps> | null>(null);
  // The same layout the explorer will compute, so the placeholder's canvas has the explorer's shape.
  const bounds = useMemo(() => layoutColumns(props.architecture).bounds, [props.architecture]);

  useEffect(() => {
    let cancelled = false;
    import("./ArchitectureExplorer").then((module) => {
      if (!cancelled) setExplorer(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel overflow-hidden shadow-md">
      {Explorer ? <Explorer {...props} /> : <ExplorerPlaceholder heading={props.heading} bounds={bounds} />}
      <ExplorerFooter />
    </div>
  );
}
