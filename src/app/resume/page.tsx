import type { Metadata } from "next";
import Link from "next/link";
import { headlineMetric } from "@/components/project/ProjectCards";
import { PrintButton } from "@/components/site/PrintButton";
import { PROVENANCE_LABEL } from "@/components/ui/Provenance";
import { getProjects, getSite } from "@/content/load";

export const metadata: Metadata = {
  title: "Resume",
  description: "Experience, selected systems, capabilities and education on one printable page.",
  alternates: { canonical: "/resume" },
};

/**
 * A resume built from the same content as the rest of the site, so it cannot
 * drift from it. It prints on white paper in either theme.
 */
export default function ResumePage() {
  const site = getSite();
  const projects = getProjects();
  // A resume leads with a few systems in detail and names the rest in a line each.
  const selected = projects.slice(0, 4);
  const others = [
    ...projects.slice(4).map((project) => ({ key: project.id, title: project.title, detail: project.tagline })),
    ...site.catalogue.map((item) => ({ key: item.url, title: item.title, detail: `(${item.organisation}). ${item.summary}` })),
  ];
  const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

  return (
    <div className="container-page pb-24 pt-10 print:p-0">
      <div className="mx-auto mb-6 flex max-w-[52rem] flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-muted">Built from the same content as this site. Print it, or save it as a PDF from the print dialog.</p>
        <PrintButton label="Print or save as PDF" />
      </div>

      <article className="panel mx-auto max-w-[52rem] p-6 sm:p-10 print:max-w-none print:border-0 print:p-0">
        <header className="border-b border-line pb-5">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{site.name}</h1>
          <p className="mt-1 text-lg font-medium text-muted">{site.role}</p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <li>{site.location}</li>
            <li>
              <a href={`mailto:${site.links.email}`} className="link">
                {site.links.email}
              </a>
            </li>
            <li>
              <a href={site.links.linkedin} className="link">
                {host(site.links.linkedin)}
              </a>
            </li>
            <li>
              <a href={site.links.github} className="link">
                {host(site.links.github)}
              </a>
            </li>
          </ul>
        </header>

        <section aria-labelledby="resume-summary" className="mt-6">
          <h2 id="resume-summary" className="label">
            Summary
          </h2>
          <p className="mt-2 leading-relaxed">{site.about}</p>
          {site.seeking ? <p className="mt-2 font-medium leading-relaxed">{site.seeking}</p> : null}
        </section>

        <section aria-labelledby="resume-experience" className="mt-7">
          <h2 id="resume-experience" className="label">
            Experience
          </h2>
          <ul className="mt-2 space-y-4">
            {site.experience.map((job) => (
              <li key={job.organisation} className="break-inside-avoid">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <h3 className="font-sans text-base font-semibold tracking-normal">
                    {job.title} · {job.organisation}
                  </h3>
                  <p className="text-sm text-muted">{job.period}</p>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{job.summary}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="resume-systems" className="mt-7">
          <h2 id="resume-systems" className="label">
            Selected systems
          </h2>
          <ul className="mt-2 space-y-4">
            {selected.map((project) => {
              const metric = headlineMetric(project);
              return (
                <li key={project.id} className="break-inside-avoid">
                  <h3 className="font-sans text-base font-semibold tracking-normal">
                    <Link href={`/projects/${project.id}`} className="hover:text-accent">
                      {project.title}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-sm leading-relaxed">{project.tagline}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    <span className="font-medium text-fg">My part: </span>
                    {project.role.text}
                  </p>
                  {metric ? (
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      <span className="font-medium text-fg">{metric.label}: </span>
                      {metric.before && metric.after ? `${metric.before} to ${metric.after}` : metric.value}{" "}
                      <span className="text-subtle">({PROVENANCE_LABEL[metric.provenance].toLowerCase()})</span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-subtle">
                    {project.stack
                      .slice(0, 6)
                      .map((item) => item.name)
                      .join(" · ")}
                  </p>
                </li>
              );
            })}
          </ul>
          {others.length > 0 ? (
            <>
              <h3 className="mt-5 font-sans text-sm font-semibold tracking-normal">Other work</h3>
              <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed">
                {others.map((item) => (
                  <li key={item.key} className="break-inside-avoid">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-muted"> {item.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section aria-labelledby="resume-capabilities" className="mt-7 break-inside-avoid">
          <h2 id="resume-capabilities" className="label">
            Capabilities
          </h2>
          <ul className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 print:grid-cols-2">
            {site.capabilities.map((capability) => (
              <li key={capability.id}>
                <span className="font-semibold">{capability.title}.</span> <span className="text-muted">{capability.summary}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-7 grid gap-x-10 gap-y-7 sm:grid-cols-2 print:grid-cols-2">
          <section aria-labelledby="resume-education" className="break-inside-avoid">
            <h2 id="resume-education" className="label">
              Education
            </h2>
            <ul className="mt-2 space-y-2 text-sm">
              {site.education.map((item) => (
                <li key={item.title}>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-muted">
                    {item.institution} · {item.period}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="resume-certifications" className="break-inside-avoid">
            <h2 id="resume-certifications" className="label">
              Certifications
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {site.certifications.map((certificate) => (
                <li key={certificate.url}>
                  <span className="font-medium">{certificate.name}</span>
                  <span className="text-muted"> · {certificate.issuer}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </article>
    </div>
  );
}
