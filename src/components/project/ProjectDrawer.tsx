"use client";

import { PanelLeft } from "lucide-react";
import { useRef } from "react";
import { ProjectSidebar, type SidebarItem } from "./ProjectSidebar";

/**
 * The project list for screens with no room for a rail: a button that opens
 * it as a drawer from the left. It is a native dialog, so focus is kept inside
 * it while it is open, Escape closes it, and focus returns to the button.
 */
export function ProjectDrawer({ items, currentId }: { items: SidebarItem[]; currentId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const count = items.filter((item) => !item.external).length;
  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm xl:hidden" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <PanelLeft size={14} aria-hidden />
        All projects ({count})
      </button>
      <dialog
        ref={dialog}
        className="drawer"
        aria-label="Projects"
        // A click on the backdrop lands on the dialog element itself, not on anything inside it.
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <ProjectSidebar items={items} currentId={currentId} variant="drawer" onClose={close} />
      </dialog>
    </>
  );
}
