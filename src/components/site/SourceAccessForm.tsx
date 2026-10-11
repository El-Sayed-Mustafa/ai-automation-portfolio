"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useId, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import {
  SOURCE_REQUEST_LIMITS,
  buildSourceRequestEmail,
  validateSourceRequest,
  type SourceRequest,
  type SourceRequestErrors,
} from "@/content/source-access";

export interface SourceOption {
  id: string;
  title: string;
}

const OTHER = "other";
const FIELD_ORDER: (keyof SourceRequest)[] = ["project", "name", "purpose"];

// A link such as /source-access?project=pest-control-crm opens with that project chosen.
function subscribe(): () => void {
  return () => {};
}
function readRequestedProject(): string | null {
  return new URLSearchParams(window.location.search).get("project");
}

/**
 * Writes a source-code request as an email in the visitor's own mail app.
 * Nothing is sent or stored by the site: there is no server to send it to.
 */
export function SourceAccessForm({ email, options }: { email: string; options: SourceOption[] }) {
  const uid = useId();
  const requested = useSyncExternalStore(subscribe, readRequestedProject, () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [otherProject, setOtherProject] = useState("");
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const formRef = useRef<HTMLFormElement>(null);

  const selectedId = chosen ?? (options.some((option) => option.id === requested) ? requested : null) ?? options[0]?.id ?? OTHER;
  const project = selectedId === OTHER ? otherProject : (options.find((option) => option.id === selectedId)?.title ?? "");

  const request: SourceRequest = useMemo(() => ({ project, name, organisation, purpose }), [project, name, organisation, purpose]);
  const errors: SourceRequestErrors = validateSourceRequest(request);
  const valid = Object.keys(errors).length === 0;
  const message = buildSourceRequestEmail(email, request);
  const shown: SourceRequestErrors = attempted ? errors : {};

  function focusFirstError() {
    const first = FIELD_ORDER.find((key) => errors[key]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
  }

  function handleSend(event: MouseEvent<HTMLAnchorElement>) {
    setAttempted(true);
    if (!valid) {
      event.preventDefault();
      focusFirstError();
    }
  }

  async function handleCopy() {
    setAttempted(true);
    if (!valid) {
      focusFirstError();
      return;
    }
    try {
      await navigator.clipboard.writeText(`To: ${email}\nSubject: ${message.subject}\n\n${message.body}`);
      setCopied("done");
    } catch {
      // Clipboard access can be refused. The written-out email below can still be selected by hand.
      setCopied("failed");
    }
  }

  const fieldId = (key: string) => `${uid}-${key}`;
  const describe = (key: keyof SourceRequest, help?: string) => (shown[key] ? `${fieldId(key)}-error` : help ? `${fieldId(key)}-help` : undefined);

  return (
    <form ref={formRef} noValidate onSubmit={(event) => event.preventDefault()} className="space-y-5" aria-label="Source code request">
      <div>
        <label htmlFor={fieldId("project")} className="mb-1 block text-sm font-medium">
          Project
        </label>
        <select
          id={fieldId("project")}
          data-field={selectedId === OTHER ? undefined : "project"}
          className="field"
          value={selectedId}
          onChange={(event) => setChosen(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
          <option value={OTHER}>Another project</option>
        </select>
        {selectedId === OTHER ? (
          <div className="mt-2">
            <label htmlFor={fieldId("other")} className="mb-1 block text-sm font-medium">
              Which project?
            </label>
            <input
              id={fieldId("other")}
              data-field="project"
              type="text"
              className="field"
              autoComplete="off"
              maxLength={SOURCE_REQUEST_LIMITS.project}
              value={otherProject}
              aria-invalid={Boolean(shown.project)}
              aria-describedby={shown.project ? `${fieldId("project")}-error` : undefined}
              onChange={(event) => setOtherProject(event.target.value)}
            />
          </div>
        ) : null}
        {shown.project ? (
          <p id={`${fieldId("project")}-error`} className="mt-1 text-xs font-medium text-danger">
            {shown.project}
          </p>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId("name")} className="mb-1 block text-sm font-medium">
            Your name
          </label>
          <input
            id={fieldId("name")}
            data-field="name"
            type="text"
            className="field"
            autoComplete="name"
            maxLength={SOURCE_REQUEST_LIMITS.name}
            value={name}
            aria-invalid={Boolean(shown.name)}
            aria-describedby={describe("name")}
            onChange={(event) => setName(event.target.value)}
          />
          {shown.name ? (
            <p id={`${fieldId("name")}-error`} className="mt-1 text-xs font-medium text-danger">
              {shown.name}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={fieldId("organisation")} className="mb-1 block text-sm font-medium">
            Company or role <span className="font-normal text-subtle">(optional)</span>
          </label>
          <input
            id={fieldId("organisation")}
            type="text"
            className="field"
            autoComplete="organization"
            maxLength={SOURCE_REQUEST_LIMITS.organisation}
            value={organisation}
            onChange={(event) => setOrganisation(event.target.value)}
          />
        </div>
      </div>

      <div>
        <label htmlFor={fieldId("purpose")} className="mb-1 block text-sm font-medium">
          What do you need the code for?
        </label>
        <textarea
          id={fieldId("purpose")}
          data-field="purpose"
          rows={5}
          className="field"
          maxLength={SOURCE_REQUEST_LIMITS.purpose}
          value={purpose}
          aria-invalid={Boolean(shown.purpose)}
          aria-describedby={describe("purpose", "help")}
          onChange={(event) => setPurpose(event.target.value)}
        />
        {shown.purpose ? (
          <p id={`${fieldId("purpose")}-error`} className="mt-1 text-xs font-medium text-danger">
            {shown.purpose}
          </p>
        ) : (
          <p id={`${fieldId("purpose")}-help`} className="mt-1 text-xs text-subtle">
            For example: evaluating my work for a role, or reviewing how a part of the system was built.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a href={message.href} onClick={handleSend} className="btn btn-primary" data-testid="source-request-send">
          <Mail size={15} aria-hidden /> Open the request in my email app
        </a>
        <button type="button" onClick={handleCopy} className="btn btn-secondary">
          {copied === "done" ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          Copy the request
        </button>
        <p role="status" className="text-sm text-muted">
          {copied === "done" ? `Copied. Paste it into an email to ${email}.` : copied === "failed" ? "Copying was blocked. Select the text below instead." : ""}
        </p>
      </div>

      <details className="rounded-lg border border-line bg-surface" open={copied === "failed" || undefined}>
        <summary className="px-4 py-3 text-sm font-semibold">Read the email before it is sent</summary>
        <div className="space-y-2 border-t border-line p-4 text-sm">
          <p>
            <span className="text-subtle">To: </span>
            <span className="code">{email}</span>
          </p>
          <p>
            <span className="text-subtle">Subject: </span>
            {message.subject}
          </p>
          <pre tabIndex={0} className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-3 font-sans text-sm leading-relaxed" data-testid="source-request-preview">
            {message.body}
          </pre>
        </div>
      </details>
    </form>
  );
}
