"use client";

/**
 * Shown when the root layout itself fails, which the page-level error screen
 * cannot catch. It renders its own document and has none of the site's styles,
 * so everything it needs is written inline, and it says only what is true:
 * something broke, and trying again may fix it.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f8faff", color: "#101b35", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", margin: 0 }}>This page could not be shown</h1>
          <p style={{ color: "#47546f", lineHeight: 1.6 }}>Something went wrong while loading the site. Nothing you did caused it. Trying again often works.</p>
          {error.digest ? <p style={{ color: "#47546f", fontSize: "0.875rem" }}>Reference: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: "0.5rem", padding: "0.7rem 1.4rem", border: 0, borderRadius: "0.625rem", background: "#101b35", color: "#ffffff", fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
