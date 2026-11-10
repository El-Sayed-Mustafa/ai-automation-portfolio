import { ArrowUpRight, Award, Clock, Crown, Quote, Star } from "lucide-react";
import { UpworkMark } from "@/components/ui/Icon";
import type { Site } from "@/content/schema";

/** Five stars, filled up to the rating. Read out as the number. */
function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <span role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((step) => (
        <Star key={step} size={size} aria-hidden className={step <= Math.round(rating) ? "star-on" : "star-off"} />
      ))}
    </span>
  );
}

/**
 * The Upwork profile, right under the introduction: the badge, the rating and
 * the hours as the profile shows them, the clients' own reviews, and a button
 * to the profile. Every figure and every word is the profile's, copied on the
 * date the content gives; nothing is computed here.
 */
export function UpworkCard({ url, profile }: { url: string; profile: NonNullable<Site["upwork"]> }) {
  const rating = Number(profile.rating);
  return (
    <section aria-labelledby="upwork-title" className="upwork-card reveal panel overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="upwork-tile grid h-14 w-14 shrink-0 place-items-center rounded-2xl" aria-hidden>
            <UpworkMark size={30} />
          </span>
          <div className="min-w-0">
            <h2 id="upwork-title" className="text-xl font-bold leading-tight sm:text-2xl">
              Hire me on Upwork
            </h2>
            <ul aria-label="On my Upwork profile" className="mt-2 flex flex-wrap items-center gap-2">
              <li className="badge-top-rated inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.875rem] font-bold">
                <Award size={15} aria-hidden />
                {profile.badge}
              </li>
              {profile.jobSuccess !== undefined ? (
                <li className="badge-job-success inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.875rem] font-bold">
                  <Crown size={15} aria-hidden />
                  {profile.jobSuccess}% Job Success
                </li>
              ) : null}
              <li className="badge-rating inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.875rem] font-bold">
                <Stars rating={rating} size={14} />
                {profile.rating} client rating
              </li>
              <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[0.875rem] font-semibold text-muted">
                <Clock size={14} aria-hidden />
                {profile.hours} hours worked
              </li>
            </ul>
          </div>
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-upwork shrink-0">
          View my Upwork profile <ArrowUpRight size={16} aria-hidden />
        </a>
      </div>

      <ul aria-label="What clients say" className={"mt-5 grid gap-4 " + (profile.reviews.length > 1 ? "md:grid-cols-2" : "")}>
        {profile.reviews.map((review) => (
          <li key={review.quote}>
            <figure className="review-card relative h-full rounded-2xl border p-5">
              <Quote size={34} aria-hidden className="review-mark absolute right-4 top-4" />
              <Stars rating={review.rating} />
              <blockquote className="mt-3 text-[1.0625rem] font-medium leading-relaxed">“{review.quote}”</blockquote>
              <figcaption className="mt-3 text-sm leading-snug">
                <span className="block font-bold">A client on Upwork</span>
                <span className="mt-0.5 block text-muted">
                  {review.job}
                  {review.period ? ` · ${review.period}` : ""}
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
