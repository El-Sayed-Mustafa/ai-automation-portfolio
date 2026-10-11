import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { LabWorkspace, type LabEntry } from "@/components/lab/LabWorkspace";
import { Tag } from "@/components/ui/Icon";
import { getProjects } from "@/content/load";

export const metadata: Metadata = {
  title: "Automation Lab",
  description: "Run real workflows from my projects: change the input, inject a failure, and inspect every step.",
  alternates: { canonical: "/automation-lab" },
};

export default function AutomationLabPage() {
  const entries: LabEntry[] = getProjects().flatMap((project) =>
    project.workflows.map((workflow) => ({
      workflow,
      projectId: project.id,
      projectTitle: project.title,
      icon: project.icon,
      tone: project.tone,
      nodeLabels: Object.fromEntries(project.architecture.nodes.map((node) => [node.id, node.label])),
      repository: project.repository,
    })),
  );

  return (
    <div className="container-wide pb-20 pt-10 sm:pt-14">
      <header className="mb-8 max-w-(--container-measure)">
        <Tag tone="indigo" className="px-3 py-1 text-[0.8125rem]">
          <FlaskConical size={13} aria-hidden /> Automation Lab
        </Tag>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Run the workflows, then break them</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Each workflow here re-implements the rules of a system I built or worked on, and runs them in your browser on invented data. One of them can also run on the server, against a database of its own.
          Change the input, inject a failure, step through it, and read what every step received, logged and wrote.
        </p>
      </header>
      {entries.length > 0 ? (
        <LabWorkspace entries={entries} />
      ) : (
        <p className="panel border-dashed p-6 text-muted">No workflow is available yet.</p>
      )}
    </div>
  );
}
