"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="container-page py-24 text-center">
      <p className="eyebrow text-danger">Something went wrong</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">This page failed to render</h1>
      <p className="mx-auto mt-3 max-w-md text-muted">
        The rest of the site is unaffected. You can try again, or go back to the home page.
        {error.digest ? <span className="code mt-2 block text-xs text-subtle">Reference: {error.digest}</span> : null}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        {/* A full navigation, not a client transition, so a broken client state is discarded. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="btn btn-secondary">
          Home
        </a>
      </div>
    </div>
  );
}
