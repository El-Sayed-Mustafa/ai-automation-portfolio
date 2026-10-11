import { ArrowUpRight, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { GithubMark, LinkedinMark } from "@/components/ui/Icon";
import { getSite } from "@/content/load";

export function SiteFooter() {
  const site = getSite();
  const pages = [
    { label: "Projects", href: "/projects" },
    { label: "Automation Lab", href: "/automation-lab" },
    { label: "About", href: "/#about" },
    { label: "Contact", href: "/#contact" },
    ...(site.links.resume ? [{ label: "Resume", href: site.links.resume }] : []),
    { label: "Source code access", href: "/source-access" },
  ];
  return (
    <footer className="border-t border-line bg-surface print:hidden">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="font-display text-lg font-bold tracking-tight">{site.name}</p>
          <p className="mt-1 text-sm text-muted">
            {site.role} · {site.location}
          </p>
          <p className="mt-4 flex max-w-md items-start gap-2.5 rounded-xl bg-surface-2 p-3.5 text-sm leading-relaxed text-muted">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            Every claim on this site says where it comes from. The demos run on invented data, in your browser unless
            you ask for the server sandbox, and never call a production system.
          </p>
        </div>
        <nav aria-label="Footer">
          <p className="label mb-3">Site</p>
          <ul className="space-y-2 text-sm">
            {pages.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className="font-medium text-muted hover:text-accent">
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="label mb-3">Elsewhere</p>
          <ul className="space-y-2 text-sm">
            <li>
              <a href={`mailto:${site.links.email}`} className="inline-flex items-center gap-2 font-medium text-muted hover:text-accent">
                <Mail size={15} aria-hidden /> Email
              </a>
            </li>
            <li>
              <a href={site.links.github} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-medium text-muted hover:text-accent">
                <GithubMark size={15} /> GitHub <ArrowUpRight size={13} aria-hidden />
              </a>
            </li>
            <li>
              <a href={site.links.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-medium text-muted hover:text-accent">
                <LinkedinMark size={15} /> LinkedIn <ArrowUpRight size={13} aria-hidden />
              </a>
            </li>
            {site.links.upwork ? (
              <li>
                <a href={site.links.upwork} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-medium text-muted hover:text-accent">
                  Upwork <ArrowUpRight size={13} aria-hidden />
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </footer>
  );
}
