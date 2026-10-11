"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type Lens = "recruiter" | "engineer";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-lens"] });
  return () => observer.disconnect();
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function readLens(): Lens {
  return document.documentElement.getAttribute("data-lens") === "engineer" ? "engineer" : "recruiter";
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "light");
}

export function useLens(): Lens {
  return useSyncExternalStore(subscribe, readLens, () => "recruiter");
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The
    // attribute still applies for this page view.
  }
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  save("theme", theme);
}

/**
 * Switches lens while keeping the reader where they were: the section under
 * the top of the viewport stays at the same height after content collapses or
 * expands around it.
 */
export function setLens(lens: Lens): void {
  const root = document.documentElement;
  const probe = document.elementFromPoint(window.innerWidth / 2, 140);
  const anchor = probe?.closest<HTMLElement>("[data-anchor], section[id]") ?? null;
  const before = anchor?.getBoundingClientRect().top ?? 0;

  root.setAttribute("data-lens", lens);
  save("lens", lens);

  // Browsers with scroll anchoring have already held the anchor in place by
  // the time it is measured again, so the drift is zero and nothing happens.
  // Browsers without it are corrected here.
  if (anchor && anchor.isConnected && anchor.offsetParent !== null) {
    const drift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(drift) > 1) window.scrollBy({ top: drift, behavior: "instant" });
  }
}

/**
 * React's development Strict Mode resets attributes on <html> that it does not
 * manage. Calling this from a layout effect restores them; in production it
 * changes nothing.
 */
export function reapplyPreferences(): void {
  try {
    const d = document.documentElement;
    if (!d.hasAttribute("data-theme")) {
      const stored = localStorage.getItem("theme");
      // Light unless the visitor has chosen dark.
      d.setAttribute("data-theme", stored === "dark" ? "dark" : "light");
    }
    const query = new URLSearchParams(location.search).get("lens");
    const lens = query === "engineer" || query === "recruiter" ? query : localStorage.getItem("lens");
    if (lens === "engineer" && d.getAttribute("data-lens") !== "engineer") d.setAttribute("data-lens", "engineer");
  } catch {
    // Nothing to restore.
  }
}
