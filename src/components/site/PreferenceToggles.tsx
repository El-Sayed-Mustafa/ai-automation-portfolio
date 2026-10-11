"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect } from "react";
import { reapplyPreferences, setLens, setTheme, useLens, useTheme, type Lens } from "@/lib/preferences";

export const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: "recruiter", label: "Recruiter", hint: "The short version: what was built and why it matters." },
  { id: "engineer", label: "Engineer", hint: "Full depth: source files, failure modes and trade-offs." },
];

/** Switches how much detail every page shows. The content is the same; only the depth changes. */
export function LensToggle() {
  const lens = useLens();

  useLayoutEffect(() => {
    reapplyPreferences();
  }, []);

  return (
    <div role="group" aria-label="Level of detail" className="segmented">
      {LENSES.map((option) => (
        <button key={option.id} type="button" aria-pressed={lens === option.id} title={option.hint} onClick={() => setLens(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg text-fg transition-colors hover:bg-surface-2 hover:text-accent " +
        (withLabel ? "border border-line-strong px-3 text-sm font-semibold" : "w-9")
      }
    >
      <Icon size={18} aria-hidden />
      {withLabel ? <span>{next === "dark" ? "Dark theme" : "Light theme"}</span> : null}
    </button>
  );
}
