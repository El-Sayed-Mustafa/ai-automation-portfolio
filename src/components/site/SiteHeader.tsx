"use client";

import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GithubMark, LinkedinMark } from "@/components/ui/Icon";
import { LENSES, LensToggle, ThemeToggle } from "./PreferenceToggles";

interface NavItem {
  href: string;
  label: string;
  match(path: string): boolean;
}

export function SiteHeader({ name, role, links }: { name: string; role: string; links: { github: string; linkedin: string; resume?: string } }) {
  const pathname = usePathname();
  // The menu is open only for the page it was opened on, so navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = () => setOpenedOn(null);

  const nav: NavItem[] = [
    { href: "/", label: "Home", match: (path) => path === "/" },
    { href: "/projects", label: "Projects", match: (path) => path.startsWith("/projects") },
    { href: "/automation-lab", label: "Automation Lab", match: (path) => path.startsWith("/automation-lab") },
    { href: "/#about", label: "About", match: () => false },
    ...(links.resume ? [{ href: links.resume, label: "Resume", match: (path: string) => path.startsWith("/resume") }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const social = (
    <>
      <a href={links.github} target="_blank" rel="noreferrer" aria-label="GitHub profile" className="grid h-9 w-9 place-items-center rounded-lg text-fg transition-colors hover:bg-surface-2 hover:text-accent">
        <GithubMark size={19} />
      </a>
      <a href={links.linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn profile" className="grid h-9 w-9 place-items-center rounded-lg text-fg transition-colors hover:bg-surface-2 hover:text-accent">
        <LinkedinMark size={18} />
      </a>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface print:hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-fg"
      >
        Skip to content
      </a>
      {/* One pixel less than --header-h: the border below makes up the difference, so bars that stick under the header start exactly where it ends. */}
      <div className="flex h-[calc(var(--header-h)-1px)] w-full items-center gap-4 px-5 sm:px-6 xl:gap-8 xl:px-8">
        <Link href="/" className="flex shrink-0 flex-col leading-tight" onClick={close}>
          <span className="font-display text-lg font-bold tracking-tight">{name}</span>
          <span className="hidden text-[0.8125rem] text-muted sm:block">{role}</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 xl:flex">
          {nav.map((item) => {
            const current = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={
                  "rounded-lg px-3.5 py-2 text-[0.9375rem] font-semibold transition-colors " +
                  (current ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1 xl:flex">
            {social}
            <span className="mx-1 h-6 w-px bg-line" aria-hidden />
            <LensToggle />
            <ThemeToggle />
          </div>
          <Link href="/#contact" className="btn btn-primary btn-sm" onClick={close}>
            Contact me <ArrowRight size={14} aria-hidden />
          </Link>
          <button
            type="button"
            className="btn btn-secondary btn-sm xl:hidden"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpenedOn(open ? null : pathname)}
          >
            {open ? <X size={15} aria-hidden /> : <Menu size={15} aria-hidden />}
            Menu
          </button>
        </div>
      </div>

      <div id="site-menu" hidden={!open} className="border-t border-line bg-surface xl:hidden">
        <div className="max-h-[calc(100dvh-var(--header-h))] space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          <nav aria-label="Main, mobile">
            <ul className="space-y-1">
              {[...nav, { href: "/#contact", label: "Contact", match: () => false }].map((item) => {
                const current = item.match(pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={close}
                      aria-current={current ? "page" : undefined}
                      className={"flex items-center justify-between rounded-xl px-3.5 py-3 text-lg font-semibold " + (current ? "bg-accent-soft text-accent" : "hover:bg-surface-2")}
                    >
                      {item.label}
                      {current ? <span className="text-xs font-medium">You are here</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div>
            <p className="label mb-2">Level of detail</p>
            <LensToggle />
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {LENSES.map((lens) => (
                <li key={lens.id}>
                  <span className="font-medium text-fg">{lens.label}.</span> {lens.hint}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle withLabel />
            <span className="flex items-center gap-1">{social}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
