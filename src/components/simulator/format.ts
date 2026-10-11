import type { Json, RunEvent, RunStatus, StepStatus } from "@/engine/types";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  running: "Running",
  success: "Success",
  failed: "Failed",
  retrying: "Retrying",
  skipped: "Skipped",
  waiting: "Waiting for approval",
  cancelled: "Cancelled",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  idle: "Not started",
  running: "Running",
  waiting: "Waiting for a decision",
  success: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** A virtual duration in the largest sensible unit. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 2 : 1)} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = Math.round(totalSeconds - totalMinutes * 60);
    return `${totalMinutes} min ${String(seconds).padStart(2, "0")} s`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} h ${String(totalMinutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(totalHours / 24)} d ${String(totalHours % 24).padStart(2, "0")} h`;
}

/** Offset from the start of the run: mm:ss.mmm, or with hours and days once it is long enough. */
export function formatOffset(ms: number): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000) % 24;
  const days = Math.floor(ms / 86_400_000);
  if (ms < 3_600_000) return `${pad(minutes)}:${pad(seconds)}.${pad(Math.floor(ms % 1000), 3)}`;
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export function formatJson(value: Json | undefined): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

/** For an update, the fields whose value changed; for anything else, the whole record. */
export function changedFields(before: Json, after: Json): { field: string; before: Json; after: Json }[] | null {
  if (!isRecord(before) || !isRecord(after)) return null;
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: { field: string; before: Json; after: Json }[] = [];
  for (const field of fields) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field, before: a, after: b });
  }
  return changes;
}

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * How long playback rests on an event, in real milliseconds at 1x speed.
 * This only paces the animation; it has no effect on what was executed.
 */
export function playbackDelay(event: RunEvent): number {
  switch (event.type) {
    case "run.started":
      return 150;
    case "step.started":
      return event.attempt > 1 ? 650 : 380;
    case "step.log":
    case "state.changed":
      return 240;
    case "step.succeeded":
      return 320;
    case "step.failed":
      return 700;
    case "step.skipped":
      return 70;
    case "step.resumed":
      return 150;
    case "step.waiting":
    case "run.finished":
      return 250;
  }
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A short, deterministic id for a run, derived from what was run. */
export function makeRunId(sequence: number, input: unknown, faults: readonly string[]): string {
  return "run-" + fnv1a(JSON.stringify([sequence, input, [...faults].sort()])).toString(16).padStart(8, "0");
}
