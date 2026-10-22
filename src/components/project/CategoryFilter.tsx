"use client";

import { Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CATEGORY_LABELS, type Category } from "@/content/schema";

export interface FilterItem {
  id: string;
  categories: Category[];
  /** Interactive case studies are listed first; write-ups follow. */
  kind: "case-study" | "write-up";
  /** Lower-case text the search box matches against: title, summary and technology. */
  search: string;
  content: ReactNode;
}

/** Filters server-rendered project entries by category and by text without re-fetching them. */
export function CategoryFilter({ items }: { items: FilterItem[] }) {
  const [active, setActive] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  const categories = (Object.keys(CATEGORY_LABELS) as Category[]).filter((category) =>
    items.some((item) => item.categories.includes(category)),
  );
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matchesQuery = (item: FilterItem) => words.every((word) => item.search.includes(word));
  const searched = items.filter(matchesQuery);
  const visible = active ? searched.filter((item) => item.categories.includes(active)) : searched;
  const caseStudies = visible.filter((item) => item.kind === "case-study");
  const writeUps = visible.filter((item) => item.kind === "write-up");
  const filtered = active !== null || words.length > 0;

  return (
    <div>
      <div className="panel flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        <div className="relative lg:w-72 lg:shrink-0">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            id="project-search"
            type="search"
            className="field pl-9"
            placeholder="Search projects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          <button type="button" className="chip" aria-pressed={active === null} onClick={() => setActive(null)}>
            All ({searched.length})
          </button>
          {categories.map((category) => (
            <button key={category} type="button" className="chip" aria-pressed={active === category} onClick={() => setActive(category)}>
              {CATEGORY_LABELS[category]} ({searched.filter((item) => item.categories.includes(category)).length})
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">
        Showing {visible.length} of {items.length} projects
      </p>

      {caseStudies.length > 0 ? (
        <section aria-labelledby="case-studies-title" className="mt-10">
          <h2 id="case-studies-title" className="text-2xl font-bold">
            Interactive case studies
          </h2>
          <p className="mt-1 text-muted">Each one has a demo you can run.</p>
          <ul className="mt-5 grid gap-5 lg:grid-cols-2">
            {caseStudies.map((item) => (
              <li key={item.id}>{item.content}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {writeUps.length > 0 ? (
        <section aria-labelledby="write-ups-title" className="mt-12">
          <h2 id="write-ups-title" className="text-2xl font-bold">
            Write-ups on GitHub
          </h2>
          <p className="mt-1 text-muted">Architecture and design documents for other projects. Their interactive pages are in progress.</p>
          <ul className="mt-5 grid gap-5 lg:grid-cols-2">
            {writeUps.map((item) => (
              <li key={item.id}>{item.content}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {visible.length === 0 ? (
        <div className="panel mt-10 flex flex-col items-start gap-3 border-dashed p-6">
          <p className="text-muted">{words.length > 0 ? "No project matches that search." : "No project in this category yet."}</p>
          {filtered ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setActive(null);
                setQuery("");
              }}
            >
              <X size={14} aria-hidden /> Clear the filters
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
