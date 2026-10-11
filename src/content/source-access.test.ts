import { describe, expect, test } from "vitest";
import { getProjects, getSite } from "./load";
import { SOURCE_REQUEST_LIMITS, buildSourceRequestEmail, normaliseSourceRequest, validateSourceRequest, type SourceRequest } from "./source-access";

const valid: SourceRequest = {
  project: "Pest Control CRM and Field Operations",
  name: "Sample Reviewer",
  organisation: "Example Engineering",
  purpose: "I am reviewing candidates for a backend role and would like to read the outbox worker.",
};

describe("validating a source request", () => {
  test("accepts a complete request", () => {
    expect(validateSourceRequest(valid)).toEqual({});
  });

  test("the organisation is optional", () => {
    expect(validateSourceRequest({ ...valid, organisation: "" })).toEqual({});
  });

  test("asks for a project, a name and a purpose", () => {
    expect(Object.keys(validateSourceRequest({ project: " ", name: "", organisation: "", purpose: "" })).sort()).toEqual(["name", "project", "purpose"]);
  });

  test("a purpose of a few characters is not a purpose", () => {
    expect(validateSourceRequest({ ...valid, purpose: "curious" }).purpose).toBeDefined();
    expect(validateSourceRequest({ ...valid, purpose: "   \n\n   " }).purpose).toBeDefined();
  });
});

describe("writing the email", () => {
  const email = buildSourceRequestEmail("owner@example.test", valid);

  test("names the project in the subject and carries every field in the body", () => {
    expect(email.subject).toBe("Source code request: Pest Control CRM and Field Operations");
    expect(email.body).toContain("Name: Sample Reviewer");
    expect(email.body).toContain("Company or role: Example Engineering");
    expect(email.body).toContain(valid.purpose);
  });

  test("leaves the company line out when none was given", () => {
    expect(buildSourceRequestEmail("owner@example.test", { ...valid, organisation: "  " }).body).not.toContain("Company or role");
  });

  test("the link decodes back to the same subject and body", () => {
    const [address, query] = email.href.replace(/^mailto:/, "").split("?");
    const params = new URLSearchParams(query);
    expect(address).toBe("owner@example.test");
    expect(params.get("subject")).toBe(email.subject);
    expect(params.get("body")?.replace(/\r\n/g, "\n")).toBe(email.body);
  });

  test("text typed by the visitor cannot add recipients or headers to the email", () => {
    const hostile = buildSourceRequestEmail("owner@example.test", {
      ...valid,
      name: "Mallory&cc=other@example.test",
      project: "X?bcc=other@example.test\r\nBcc: other@example.test",
    });
    const query = hostile.href.split("?").slice(1).join("?");
    expect([...new URLSearchParams(query).keys()]).toEqual(["subject", "body"]);
    expect(hostile.subject).not.toMatch(/[\r\n]/);
  });

  test("long input is cut to the stated limits", () => {
    const long = normaliseSourceRequest({ project: "p".repeat(500), name: "n".repeat(500), organisation: "o".repeat(500), purpose: "x ".repeat(5000) });
    expect(long.project).toHaveLength(SOURCE_REQUEST_LIMITS.project);
    expect(long.name).toHaveLength(SOURCE_REQUEST_LIMITS.name);
    expect(long.organisation).toHaveLength(SOURCE_REQUEST_LIMITS.organisation);
    expect(long.purpose.length).toBeLessThanOrEqual(SOURCE_REQUEST_LIMITS.purpose);
  });

  test("the purpose keeps its paragraphs", () => {
    const body = buildSourceRequestEmail("owner@example.test", { ...valid, purpose: "First reason, long enough.\n\n\n\nSecond reason." }).body;
    expect(body).toContain("First reason, long enough.\n\nSecond reason.");
  });
});

describe("where the source can be requested", () => {
  test("no case study links into a private repository", () => {
    for (const project of getProjects()) {
      if (project.repository?.visibility === "private") expect(project.repository.linkSources, project.id).toBe(false);
    }
  });

  test("a catalogue entry offers its source only when it points at a write-up, not at the code itself", () => {
    for (const item of getSite().catalogue) {
      if (item.sourceOnRequest) expect(item.linkLabel, item.title).not.toMatch(/^Source/);
    }
  });
});
