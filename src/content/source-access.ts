/**
 * A request to read a project's private source code.
 *
 * The site has no backend, so a request is an email the visitor sends from
 * their own mail app. These helpers validate what they typed and write that
 * email. Kept free of content imports so the form can use them in the browser.
 */
export interface SourceRequest {
  /** Title of the project, or the visitor's own words when it is not in the list. */
  project: string;
  name: string;
  /** Company, team or role. Optional: an individual may have none to give. */
  organisation: string;
  /** Why the visitor wants to read the code. The owner decides on this. */
  purpose: string;
}

export type SourceRequestErrors = Partial<Record<keyof SourceRequest, string>>;

export const SOURCE_REQUEST_LIMITS = { name: 80, organisation: 120, project: 120, purpose: 1200 } as const;
const PURPOSE_MIN = 20;

/** Collapses whitespace so a pasted block cannot break the layout of the email. */
function clean(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function normaliseSourceRequest(request: SourceRequest): SourceRequest {
  return {
    project: clean(request.project, SOURCE_REQUEST_LIMITS.project),
    name: clean(request.name, SOURCE_REQUEST_LIMITS.name),
    organisation: clean(request.organisation, SOURCE_REQUEST_LIMITS.organisation),
    // The purpose keeps its line breaks: it is the part the owner reads most closely.
    purpose: request.purpose.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, SOURCE_REQUEST_LIMITS.purpose),
  };
}

export function validateSourceRequest(request: SourceRequest): SourceRequestErrors {
  const value = normaliseSourceRequest(request);
  const errors: SourceRequestErrors = {};
  if (!value.project) errors.project = "Choose the project you want to read.";
  if (!value.name) errors.name = "Enter your name.";
  if (value.purpose.length < PURPOSE_MIN) errors.purpose = "Say what you need the code for, in a sentence or two.";
  return errors;
}

export interface SourceRequestEmail {
  subject: string;
  body: string;
  /** A mailto: link that opens the visitor's mail app with the request written out. */
  href: string;
}

export function buildSourceRequestEmail(to: string, request: SourceRequest): SourceRequestEmail {
  const value = normaliseSourceRequest(request);
  const subject = `Source code request: ${value.project}`;
  const body = [
    "Hello Elsayed,",
    "",
    `I would like to read the source code of: ${value.project}`,
    "",
    `Name: ${value.name}`,
    ...(value.organisation ? [`Company or role: ${value.organisation}`] : []),
    "",
    "What I need it for:",
    value.purpose,
    "",
    "Thank you.",
  ].join("\n");
  // Mail apps expect CRLF line breaks in a mailto body.
  const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, "\r\n"))}`;
  return { subject, body, href };
}
