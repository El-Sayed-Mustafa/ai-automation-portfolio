import { KeyRound, ListChecks, Mail, SearchCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SourceAccessForm, type SourceOption } from "@/components/site/SourceAccessForm";
import { TONE_CYCLE, Tag, Tile } from "@/components/ui/Icon";
import { catalogueId, getProjects, getSite } from "@/content/load";

export const metadata: Metadata = {
  title: "Request the source code",
  description: "Most of the source code behind these projects is private. To read it, send a request that says who you are and what you need it for.",
  alternates: { canonical: "/source-access" },
};

export default function SourceAccessPage() {
  const site = getSite();
  const options: SourceOption[] = [
    ...getProjects()
      .filter((project) => project.repository && !project.repository.linkSources)
      .map((project) => ({ id: project.id, title: project.title })),
    ...site.catalogue.filter((item) => item.sourceOnRequest).map((item) => ({ id: catalogueId(item), title: item.title })),
  ];

  return (
    <div className="container-page pb-20 pt-10 sm:pt-14">
      <header className="max-w-(--container-measure)">
        <Tag tone="indigo" className="px-3 py-1 text-[0.8125rem]">
          <KeyRound size={13} aria-hidden /> Source code
        </Tag>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Request the source code</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Most of the source code behind these projects is kept in private repositories. If you would like to read the
          code behind a project, tell me who you are and what you need it for, and I will reply by email.
        </p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="panel p-5 sm:p-7">
          <SourceAccessForm email={site.links.email} options={options} />
        </div>

        <aside aria-labelledby="how-it-works" className="space-y-5">
          <div className="panel p-5">
            <h2 id="how-it-works" className="flex items-center gap-2.5 font-display text-lg font-bold">
              <Tile tone="indigo" size="sm">
                <ListChecks size={16} aria-hidden />
              </Tile>
              How this works
            </h2>
            <ol className="mt-4 space-y-3">
              {[
                "Choose the project and say what you need the code for.",
                "The request opens in your own email app, addressed to me. Nothing is sent from this page, and nothing you type is stored.",
                "I read it and reply by email.",
              ].map((step, index) => (
                <li key={step} data-tone={TONE_CYCLE[index % TONE_CYCLE.length]} className="flex items-start gap-3">
                  <span className="tile tile-sm text-sm font-bold" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="pt-1 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="panel p-5">
            <h2 className="flex items-center gap-2.5 font-display text-lg font-bold">
              <Tile tone="teal" size="sm">
                <SearchCheck size={16} aria-hidden />
              </Tile>
              Without asking
            </h2>
            <p className="mt-3 leading-relaxed text-muted">
              Every case study on this site already names the files behind its claims, and lets you run the workflow and
              explore the architecture. Switch to the Engineer view on a{" "}
              <Link href="/projects" className="link">
                case study
              </Link>{" "}
              to see them.
            </p>
          </div>
          <div className="panel p-5">
            <h2 className="flex items-center gap-2.5 font-display text-lg font-bold">
              <Tile tone="amber" size="sm">
                <Mail size={16} aria-hidden />
              </Tile>
              Prefer to write it yourself?
            </h2>
            <p className="mt-3 leading-relaxed text-muted">
              Email{" "}
              <a href={`mailto:${site.links.email}`} className="link">
                {site.links.email}
              </a>{" "}
              with the project and your reason.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
