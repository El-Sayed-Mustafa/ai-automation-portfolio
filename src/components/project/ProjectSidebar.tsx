"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { AppIcon, Tag, Tile } from "@/components/ui/Icon";
import type { IconName, Tone } from "@/content/schema";

export interface SidebarItem {
  id: string;
  href: string;
  title: string;
  blurb: string;
  icon: IconName;
  tone: Tone;
  tags: { label: string; tone: Tone }[];
  /** A write-up hosted elsewhere, not a page of this site. */
  external?: boolean;
}

/** From this width the rail is a list unless the visitor folded it; below it, a strip of icons unless they opened it. */
const OPEN_BY_DEFAULT = "(min-width: 1660px)";

// Whether the rail is a list or a strip of icons is an attribute on <html>,
// restored before first paint, so the page does not jump when it loads.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-rail"] });
  const media = window.matchMedia(OPEN_BY_DEFAULT);
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function readCollapsed(): boolean {
  const choice = document.documentElement.getAttribute("data-rail");
  if (choice === "collapsed") return true;
  if (choice === "expanded") return false;
  return !window.matchMedia(OPEN_BY_DEFAULT).matches;
}

function setCollapsed(collapsed: boolean) {
  const value = collapsed ? "collapsed" : "expanded";
  document.documentElement.setAttribute("data-rail", value);
  try {
    localStorage.setItem("rail", value);
  } catch {
    // Storage can be unavailable; the attribute still applies for this page view.
  }
}

/**
 * Every project, one click away from any case study. As a rail it is
 * searchable and folds to a strip of icons; as a drawer it is always the full
 * list, with a button to close it.
 */
export function ProjectSidebar({ items, currentId, variant = "rail", onClose }: { items: SidebarItem[]; currentId: string; variant?: "rail" | "drawer"; onClose?(): void }) {
  const searchId = useId();
  const folded = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const collapsed = variant === "rail" && folded;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter((item) => `${item.title} ${item.blurb} ${item.tags.map((tag) => tag.label).join(" ")}`.toLowerCase().includes(needle)) : items;
  const pages = visible.filter((item) => !item.external);
  const writeUps = visible.filter((item) => item.external);

  const row = (item: SidebarItem) => {
    const current = item.id === currentId;
    const body = (
      <>
        <Tile tone={item.tone} solid={current} className="!h-10 !w-10 !rounded-xl">
          <AppIcon name={item.icon} size={19} />
        </Tile>
        <span data-rail-full className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-[0.9375rem] font-semibold leading-snug">{item.title}</span>
            {item.external ? <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden /> : null}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{item.blurb}</span>
          <span className="mt-2 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <Tag key={tag.label} tone={tag.tone} className="!px-2 !py-px !text-[0.6875rem]">
                {tag.label}
              </Tag>
            ))}
          </span>
        </span>
      </>
    );
    const className =
      "flex gap-3 rounded-xl border p-2.5 transition-all duration-150 " +
      (current ? "border-accent/60 bg-accent-soft shadow-sm" : "border-line bg-surface hover:-translate-y-px hover:border-accent/50 hover:shadow-sm");
    return (
      <li key={item.id}>
        {item.external ? (
          <a href={item.href} target="_blank" rel="noreferrer" title={item.title} className={className}>
            {body}
          </a>
        ) : (
          <Link href={item.href} aria-current={current ? "page" : undefined} title={item.title} className={className} onClick={onClose}>
            {body}
          </Link>
        )}
      </li>
    );
  };

  return (
    <nav aria-label="Projects" className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 data-rail-full className="text-base font-bold">
          Projects <span className="font-medium text-subtle">({items.filter((item) => !item.external).length})</span>
        </h2>
        {variant === "drawer" ? (
          <button type="button" onClick={onClose} aria-label="Close the project list" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-accent hover:text-accent">
            <X size={16} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show the project list" : "Fold the project list"}
            className="mx-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {collapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronLeft size={16} aria-hidden />}
          </button>
        )}
      </div>

      <div data-rail-full className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search projects
        </label>
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" className="field bg-surface py-2 pl-9 text-sm" autoComplete="off" />
      </div>

      <ul className="space-y-2">{pages.map(row)}</ul>

      {writeUps.length > 0 ? (
        <div>
          <p data-rail-full className="label mb-2 mt-1 px-1">
            Write-ups on GitHub
          </p>
          <ul className="space-y-2">{writeUps.map(row)}</ul>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p data-rail-full role="status" className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">
          No project matches “{query}”.
        </p>
      ) : null}
    </nav>
  );
}
