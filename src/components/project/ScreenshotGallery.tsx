"use client";

import { ImageOff, X, ZoomIn } from "lucide-react";
import { useRef, useState } from "react";
import type { Screenshot } from "@/content/schema";

/**
 * A project's screenshots as cards, each opening full size in a lightbox.
 * The lightbox is a native dialog: focus stays inside it, Escape closes it and
 * focus goes back to the card that opened it. Without JavaScript a card is a
 * plain link to the image.
 */
export function ScreenshotGallery({ shots, note }: { shots: Screenshot[]; note?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<Screenshot | null>(null);

  function show(shot: Screenshot) {
    setOpen(shot);
    dialog.current?.showModal();
  }

  return (
    <>
      <ul className={"grid gap-4 " + (shots.length > 1 ? "sm:grid-cols-2" : "")}>
        {shots.map((shot) => (
          <li key={shot.src}>
            <figure className="overflow-hidden rounded-2xl border border-line bg-surface">
              <a
                href={shot.src}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open full size: ${shot.alt}`}
                className="group relative block overflow-hidden"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  show(shot);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- screenshots are static files with known dimensions */}
                <img src={shot.src} alt={shot.alt} width={shot.width} height={shot.height} loading="lazy" className="max-h-[24rem] w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]" />
                <span className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-surface text-fg shadow-md transition-transform group-hover:scale-110" aria-hidden>
                  <ZoomIn size={16} />
                </span>
              </a>
              <figcaption className="border-t border-line p-3 text-sm leading-relaxed text-muted">{shot.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {/* What was left out, and why, sits with what is shown. */}
      {note ? (
        <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-muted">
          <ImageOff size={15} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
          {note}
        </p>
      ) : null}

      <dialog
        ref={dialog}
        aria-label={open ? `Screenshot: ${open.caption}` : "Screenshot"}
        className="lightbox"
        onClose={() => setOpen(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {open ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- the same static file, at its own size */}
            <img src={open.src} alt={open.alt} width={open.width} height={open.height} className="max-h-[82dvh] w-auto max-w-full rounded-xl" />
            <p className="mt-3 text-sm leading-relaxed text-muted">{open.caption}</p>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close the screenshot" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-surface text-fg shadow-md hover:text-accent">
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
