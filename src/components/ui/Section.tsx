import type { ReactNode } from "react";

/**
 * A page section: an eyebrow, a heading, an optional lead and the content.
 * The heading block keeps a reading measure; the content uses the full width.
 */
export function Section({
  id,
  kicker,
  title,
  intro,
  action,
  children,
  className = "",
}: {
  id: string;
  kicker?: string;
  title: string;
  intro?: ReactNode;
  /** A link or button aligned with the heading, such as "See all work". */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} data-tuck aria-labelledby={`${id}-title`} className={`py-12 sm:py-16 ${className}`}>
      <div className="mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-(--container-measure)">
          {kicker ? <p className="eyebrow mb-2.5">{kicker}</p> : null}
          <h2 id={`${id}-title`} className="text-[1.75rem] font-bold tracking-tight sm:text-[2.125rem]">
            {title}
          </h2>
          {intro ? <div className="mt-2.5 text-lg leading-relaxed text-muted">{intro}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "article" | "li" }) {
  return <Tag className={`panel p-5 sm:p-6 ${className}`}>{children}</Tag>;
}

/** Technologies and similar secondary lists: plain text with separators, not a row of boxes. */
export function InlineList({ items, className = "" }: { items: string[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-2 gap-y-1 text-sm text-subtle ${className}`}>
      {items.map((item, index) => (
        <li key={item} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden>·</span> : null}
          {item}
        </li>
      ))}
    </ul>
  );
}

/** An accordion row built on the native element, so it works without JavaScript. */
export function Disclosure({
  summary,
  children,
  className = "",
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={`group panel open:border-line-strong ${className}`} open={defaultOpen}>
      <summary className="flex items-start gap-3 p-4 sm:p-5">
        <span
          aria-hidden
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-bold leading-none text-accent transition-transform group-open:rotate-45"
        >
          +
        </span>
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      <div className="border-t border-line p-4 sm:p-5">{children}</div>
    </details>
  );
}
