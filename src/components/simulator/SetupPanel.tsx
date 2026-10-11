"use client";

import { useId } from "react";
import type { Project, Workflow } from "@/content/schema";
import type { ScenarioInput } from "@/engine/registry";
import { SourceList } from "@/components/ui/Provenance";

interface SetupPanelProps {
  workflow: Workflow;
  input: ScenarioInput;
  errors: Record<string, string>;
  faults: string[];
  repository: Project["repository"];
  onInput(key: string, value: string | number): void;
  onToggleFault(faultId: string): void;
}

/** The inputs a visitor can change and the failures they can inject. Changes apply to the next run. */
export function SetupPanel({ workflow, input, errors, faults, repository, onInput, onToggleFault }: SetupPanelProps) {
  const formId = useId();
  const stepLabels = new Map(workflow.steps.map((step) => [step.id, step.label]));

  return (
    <div className="space-y-7">
      <fieldset>
        <legend className="label mb-1">Sample input</legend>
        <p className="mb-3 text-sm text-muted">Invented data you can edit. The workflow runs on exactly what is in these fields.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {workflow.inputs.map((field) => {
            const id = `${formId}-${field.key}`;
            const value = input[field.key];
            const error = errors[field.key];
            const wide = field.type === "textarea";
            return (
              <div key={field.key} className={wide ? "sm:col-span-2" : ""}>
                <label htmlFor={id} className="mb-1 block text-sm font-medium">
                  {field.label}
                </label>
                {field.type === "select" ? (
                  <select id={id} className="field" value={String(value ?? "")} onChange={(event) => onInput(field.key, event.target.value)}>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    id={id}
                    rows={3}
                    maxLength={field.maxLength}
                    className="field"
                    value={String(value ?? "")}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-error` : field.help ? `${id}-help` : undefined}
                    onChange={(event) => onInput(field.key, event.target.value)}
                  />
                ) : (
                  <input
                    id={id}
                    type={field.type === "number" ? "number" : "text"}
                    inputMode={field.type === "number" ? "decimal" : undefined}
                    min={field.type === "number" ? 0 : undefined}
                    maxLength={field.maxLength}
                    autoComplete="off"
                    className="field"
                    value={String(value ?? "")}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-error` : field.help ? `${id}-help` : undefined}
                    onChange={(event) => onInput(field.key, field.type === "number" ? Number(event.target.value) : event.target.value)}
                  />
                )}
                {error ? (
                  <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
                    {error}
                  </p>
                ) : field.help ? (
                  <p id={`${id}-help`} className="mt-1 text-xs text-subtle">
                    {field.help}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label mb-1">Inject a failure</legend>
        <p className="mb-3 text-sm text-muted">
          Each one shows what the production code really does in that situation, including the cases it does not handle.
        </p>
        <ul className="space-y-2">
          {workflow.faults.map((fault) => {
            const id = `${formId}-fault-${fault.id}`;
            const checked = faults.includes(fault.id);
            const handled = fault.classification === "implemented";
            return (
              <li
                key={fault.id}
                className={"rounded-lg border p-3 transition-colors " + (checked ? "border-warn bg-warn-soft" : "border-line hover:border-line-strong")}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleFault(fault.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-(--warn)"
                  />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="block text-sm font-semibold">
                      {fault.label}
                    </label>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className={"font-semibold " + (handled ? "text-success" : "text-warn")}>
                        {handled ? "Handled in production code" : "Known limitation"}
                      </span>
                      <span aria-hidden> · </span>
                      At “{stepLabels.get(fault.stepId) ?? fault.stepId}”. {fault.description}
                    </p>
                    {checked ? (
                      <div className="mt-2 text-sm">
                        <p>
                          <span className="font-semibold">Expected: </span>
                          {fault.expected}
                        </p>
                        <SourceList project={{ repository }} sources={fault.sources} className="mt-1.5" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
