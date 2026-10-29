import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getScenarioRuntime } from "../engine/registry";
import { SANDBOX_SCENARIO_IDS } from "../sandbox/protocol";
import { formatSourceRef, getProject, getProjects, getSite, sourceUrl } from "./load";
import { projectSchema } from "./schema";

const projects = getProjects();

describe("content manifests", () => {
  it("load and validate", () => {
    expect(projects.length).toBeGreaterThan(0);
    expect(getSite().name).toBe("Elsayed Mustafa");
  });

  it("have unique project ids", () => {
    const ids = projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only reference projects that exist from the site capabilities", () => {
    for (const capability of getSite().capabilities) {
      for (const item of capability.evidence) {
        if (item.projectId) expect(getProject(item.projectId), item.projectId).toBeDefined();
      }
    }
  });

  it("only list a skill or a tool that a case study shows", () => {
    /** Everything a case study says it is built with, as one text to search. */
    const builtWith = (project: (typeof projects)[number]) =>
      [...project.stack.map((item) => item.name), ...project.architecture.nodes.flatMap((node) => [node.label, node.technology])].join(" | ").toLowerCase();
    // A tool's name can be shorter than the way a case study writes it ("Gemini through the google-genai SDK").
    const named = (text: string, tool: string) => text.includes(tool.toLowerCase().replace(/^google (?=gemini)/, ""));
    for (const skill of getSite().skills) {
      const project = getProject(skill.projectId);
      expect(project, skill.projectId).toBeDefined();
      for (const tool of skill.tools) expect(named(builtWith(project!), tool), `${skill.id}: ${tool} in ${skill.projectId}`).toBe(true);
    }
  });

  it("reject a manifest with a missing field", () => {
    const broken: Record<string, unknown> = { ...projects[0] };
    delete broken.title;
    expect(projectSchema.safeParse(broken).success).toBe(false);
  });

  it("reject an unknown provenance value", () => {
    const broken = { ...projects[0], role: { text: "x", provenance: "trust-me", sources: [] } };
    expect(projectSchema.safeParse(broken).success).toBe(false);
  });
});

describe.each(projects)("project $id", (project) => {
  const nodeIds = new Set(project.architecture.nodes.map((n) => n.id));
  const edgeIds = new Set(project.architecture.edges.map((e) => e.id));
  const layerIds = new Set(project.architecture.layers.map((l) => l.id));

  it("has unique node and edge ids", () => {
    expect(nodeIds.size).toBe(project.architecture.nodes.length);
    expect(edgeIds.size).toBe(project.architecture.edges.length);
  });

  it("places every node in a declared layer", () => {
    for (const node of project.architecture.nodes) expect(layerIds.has(node.layer), node.id).toBe(true);
  });

  it("connects edges to nodes that exist", () => {
    for (const edge of project.architecture.edges) {
      expect(nodeIds.has(edge.from), `${edge.id}.from`).toBe(true);
      expect(nodeIds.has(edge.to), `${edge.id}.to`).toBe(true);
    }
  });

  it("leaves no node unconnected", () => {
    const connected = new Set(project.architecture.edges.flatMap((e) => [e.from, e.to]));
    for (const id of nodeIds) expect(connected.has(id), id).toBe(true);
  });

  it("builds request flows from existing edges that join end to end", () => {
    const edges = new Map(project.architecture.edges.map((e) => [e.id, e]));
    for (const flow of project.architecture.flows) {
      const visited = new Set<string>();
      for (const [index, edgeId] of flow.path.entries()) {
        const edge = edges.get(edgeId);
        expect(edge, `${flow.id}: ${edgeId}`).toBeDefined();
        if (index > 0) {
          // Each hop must touch a component the request has already reached.
          // Either end counts, because a worker pulls from a queue: the edge
          // points worker -> queue while the work moves queue -> worker.
          expect(visited.has(edge!.from) || visited.has(edge!.to), `${flow.id}: ${edgeId} is disconnected`).toBe(true);
        }
        visited.add(edge!.from);
        visited.add(edge!.to);
      }
    }
  });

  it("backs every code or documented claim about a component with a source", () => {
    for (const node of project.architecture.nodes) {
      expect(node.sources.length, node.id).toBeGreaterThan(0);
    }
  });

  it("gives every metric a method and, when measured or counted in a repo, a source", () => {
    for (const metric of project.metrics) {
      expect(metric.method.length, metric.id).toBeGreaterThan(10);
      expect(Boolean(metric.value) || (Boolean(metric.before) && Boolean(metric.after)), metric.id).toBe(true);
      if (metric.provenance === "code" || metric.provenance === "documented") {
        expect(metric.sources.length, metric.id).toBeGreaterThan(0);
      }
    }
  });

  it("records one chosen option per decision", () => {
    for (const decision of project.decisions) {
      expect(decision.options.filter((o) => o.verdict === "chosen"), decision.id).toHaveLength(1);
    }
  });

  describe.each(project.workflows)("workflow $id", (workflow) => {
    const runtime = getScenarioRuntime(workflow.scenarioId);
    const stepIds = workflow.steps.map((s) => s.id);

    it("points at a registered scenario", () => {
      expect(runtime).toBeDefined();
    });

    it("describes exactly the steps the scenario executes, in order", () => {
      expect(stepIds).toEqual([...runtime!.scenario.stepIds]);
    });

    it("maps every step to an architecture node and a declared phase", () => {
      const phases = new Set(workflow.phases.map((p) => p.id));
      for (const step of workflow.steps) {
        expect(nodeIds.has(step.nodeId), `${step.id} -> ${step.nodeId}`).toBe(true);
        expect(phases.has(step.phase), `${step.id} phase`).toBe(true);
      }
    });

    it("cites a source for every step", () => {
      for (const step of workflow.steps) expect(step.sources.length, step.id).toBeGreaterThan(0);
    });

    it("offers exactly the faults the scenario implements", () => {
      expect(workflow.faults.map((f) => f.id).sort()).toEqual([...runtime!.faultIds].sort());
      for (const fault of workflow.faults) expect(stepIds, fault.id).toContain(fault.stepId);
    });

    it("declares an input field for every scenario input", () => {
      expect(workflow.inputs.map((f) => f.key).sort()).toEqual(Object.keys(runtime!.defaultInput).sort());
    });

    it("offers only select options the validator accepts", () => {
      for (const field of workflow.inputs) {
        for (const option of field.options ?? []) {
          const result = runtime!.validate({ ...runtime!.defaultInput, [field.key]: option });
          expect(result.errors[field.key], `${field.key}=${option}`).toBeUndefined();
        }
      }
    });

    it("labels a simulation as a simulation", () => {
      if (workflow.mode === "simulation") expect(workflow.modeNote.toLowerCase()).toMatch(/no real service|simulat/);
    });

    it("offers a server run only where the server has an executor, and says what stays simulated", () => {
      expect(Boolean(workflow.sandbox), workflow.scenarioId).toBe(SANDBOX_SCENARIO_IDS.includes(workflow.scenarioId));
      if (!workflow.sandbox) return;
      // A server run is offered beside the simulation, never in place of it.
      expect(workflow.mode).toBe("simulation");
      expect(workflow.sandbox.note).toMatch(/not the production database/);
      expect(workflow.sandbox.note.toLowerCase()).toMatch(/no message is sent/);
      expect(workflow.sandbox.simulated.length).toBeGreaterThan(0);
    });
  });
});

describe("what a case study may claim", () => {
  it("claims nothing from code for a project known only from its public write-up", () => {
    // The rating estimator's source belongs to an employer and was never read for this site.
    const project = getProject("rating-estimator")!;
    expect(project.repository?.url).toBeUndefined();
    expect(JSON.stringify(project)).not.toContain('"provenance":"code"');
    const cited = JSON.stringify(project).match(/"path":"[^"]+"/g) ?? [];
    expect(cited.length).toBeGreaterThan(0);
    for (const path of cited) expect(path, path).toMatch(/^"path":"showcase\//);
  });

  it("keeps the client's name out of the text of a page that says its text does not name them", () => {
    // The owner allows the screenshot and the write-up, which do name the client. The prose still does not.
    const project = getProject("rug-inventory-sync")!;
    const text = JSON.stringify({ ...project, repository: { ...project.repository, writeUpUrl: undefined } });
    expect(text.toLowerCase()).not.toContain("adib");
    expect(project.engagementNote).toMatch(/does not name the client; the screenshot and the author's public write-up do/);
  });

  it("labels every role statement as the owner's once he has read and accepted it", () => {
    // The newest case study's role has not been put to him yet, so it says what the history shows and no more.
    const unread = ["review-intelligence-pipeline"];
    for (const project of projects) expect(project.role.provenance, project.id).toBe(unread.includes(project.id) ? "inferred" : "owner");
  });

  it("keeps clients, sheets and the marketplace's name out of the review pipeline's page, as its public write-up does", () => {
    const project = getProject("review-intelligence-pipeline")!;
    const text = JSON.stringify(project).toLowerCase();
    for (const word of ["amazon", "keepa", "woot", "@", "docs.google.com"]) expect(text, word).not.toContain(word);
    // Client names are checked by fingerprint, so this public file does not spell them either.
    const clients = new Set(["c312287f58281fab", "d92d82f321b1f5a2", "276287358c332484", "80811a0dc741ba70"]);
    const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
    for (const word of words) expect(clients.has(createHash("sha256").update(word).digest("hex").slice(0, 16)), "a client's name").toBe(false);
    // No sheet id, no product id of the marketplace's kind.
    expect(text).not.toMatch(/1[a-z0-9_-]{40,}/);
    expect(JSON.stringify(project)).not.toMatch(/B0[A-Z0-9]{8}/);
    expect(project.repository?.url).toBeUndefined();
    expect(project.repository?.linkSources).toBe(false);
  });

  it("serves every screenshot from this site, with its size and where it comes from", () => {
    for (const project of projects) {
      for (const shot of project.screenshots) {
        expect(shot.src, project.id).toMatch(new RegExp(`^/projects/${project.id}/[a-z0-9-]+\\.(png|webp)$`));
        expect(shot.caption.length, shot.src).toBeGreaterThan(30);
        expect(shot.alt.length, shot.src).toBeGreaterThan(30);
      }
    }
  });

  it("gives every project its own tone, so neighbours in a list never look alike", () => {
    const tones = projects.map((project) => project.tone);
    expect(new Set(tones).size).toBe(tones.length);
  });
});

describe("source links", () => {
  const project = projects[0];
  const publicRepo = { repository: { ...project.repository!, visibility: "public" as const, linkSources: true } };

  it("link a file with a line range", () => {
    expect(sourceUrl(publicRepo, { path: "GreenApiLeads.js", lines: "6-123" })).toBe(
      "https://github.com/El-Sayed-Mustafa/pest-control-crm-bahrain/blob/main/GreenApiLeads.js#L6-L123",
    );
  });

  it("link a single line and a nested path", () => {
    expect(sourceUrl(publicRepo, { path: "supabase/functions/crm-api/index.ts", lines: "807" })).toBe(
      "https://github.com/El-Sayed-Mustafa/pest-control-crm-bahrain/blob/main/supabase/functions/crm-api/index.ts#L807",
    );
  });

  it("link a folder as a tree", () => {
    expect(sourceUrl(publicRepo, { path: "supabase/migrations" })).toBe(
      "https://github.com/El-Sayed-Mustafa/pest-control-crm-bahrain/tree/main/supabase/migrations",
    );
  });

  it("produce no link while source linking is switched off or the repository is private", () => {
    expect(sourceUrl({ repository: { ...publicRepo.repository, linkSources: false } }, { path: "a.js" })).toBeNull();
    expect(sourceUrl({ repository: { ...publicRepo.repository, visibility: "private" } }, { path: "a.js" })).toBeNull();
    expect(sourceUrl({ repository: undefined }, { path: "a.js" })).toBeNull();
  });

  it("format a reference as path and lines", () => {
    expect(formatSourceRef({ path: "Utils.js", lines: "616-634" })).toBe("Utils.js:616-634");
    expect(formatSourceRef({ path: "README.md" })).toBe("README.md");
  });
});
