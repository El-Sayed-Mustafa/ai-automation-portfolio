import { ArrowUpRight, BadgeCheck, Clock, Star } from "lucide-react";
import { UpworkMark } from "@/components/ui/Icon";
import type { Site } from "@/content/schema";

/**
 * The Upwork profile, large, right under the first screen: the badge, the
 * rating and the hours as the profile shows them, one client's own words, and
 * a button to the profile. Every figure is the profile's, copied on the date
 * the content gives; nothing is computed here.
 */
export function UpworkCard({ url, profile }: { url: string; profile: NonNullable<Site["upwork"]> }) {
  const facts = [
    { icon: BadgeCheck, text: profile.badge },
    { icon: Star, text: `${profile.rating} client rating` },
    { icon: Clock, text: `${profile.hours} hours worked` },
  ];
  return (
    <section aria-labelledby="upwork-title" className="upwork-card reveal panel overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
        <div className="flex min-w-0 items-center gap-4">
          <span className="upwork-tile grid h-14 w-14 shrink-0 place-items-center rounded-2xl" aria-hidden>
            <UpworkMark size={30} />
          </span>
          <div className="min-w-0">
            <h2 id="upwork-title" className="text-xl font-bold leading-tight sm:text-2xl">
              Hire me on Upwork
            </h2>
            <ul aria-label="On my Upwork profile" className="mt-2 flex flex-wrap gap-2">
              {facts.map((fact) => (
                <li key={fact.text} className="upwork-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] font-semibold">
                  <fact.icon size={14} aria-hidden />
                  {fact.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <figure className="min-w-0 flex-1 border-line lg:border-l lg:pl-8">
          <blockquote className="text-[1.0625rem] font-medium leading-snug">“{profile.review.quote}”</blockquote>
          <figcaption className="mt-1.5 text-sm text-muted">A client on Upwork · {profile.review.job}</figcaption>
        </figure>
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-upwork shrink-0">
          View my Upwork profile <ArrowUpRight size={16} aria-hidden />
        </a>
      </div>
    </section>
  );
}
