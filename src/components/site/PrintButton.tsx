"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog, which is also how the page is saved as a PDF. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary">
      <Printer size={15} aria-hidden /> {label}
    </button>
  );
}
