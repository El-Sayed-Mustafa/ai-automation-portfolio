"use client";

import { FileCheck, LayoutDashboard, Network, Play, Scale, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { tabForHash, type TabId } from "@/lib/case-study-tabs";

const TAB_ICON: Record<TabId, LucideIcon> = {
  overview: LayoutDashboard,
  demo: Play,
  architecture: Network,
  decisions: Scale,
  limitations: TriangleAlert,
  evidence: FileCheck,
};

const CHANGE_EVENT = "case-study:tab";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const readHash = () => window.location.hash;

/**
 * The element a hash names, inside the case study this tab bar belongs to.
 * The router can keep the page the reader came from in the document, hidden,
 * so the same id may exist twice; a lookup on the whole document could find
 * the hidden one.
 */
function findInStudy(from: Element | null, hash: string): HTMLElement | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (!id) return null;
  return from?.closest("[data-case-study]")?.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? null;
}

/**
 * The tab bar of a case study.
 *
 * The current tab is whatever the address points at, so every tab and every
 * section inside one has a link. The tabs are ordinary links to anchors: with
 * JavaScript off, all the panels are on the page and the links jump to them.
 */
export function CaseStudyTabs({ tabs }: { tabs: { id: TabId; label: string }[] }) {
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const active = tabForHash(hash);
  const bar = useRef<HTMLElement>(null);

  // The attribute on <html> is what shows a panel. The script in <head> sets it
  // on a full load; this keeps it in step afterwards and on client navigation.
  // Set and cleared in the same layout effect: when one case study replaces
  // another, the old one's cleanup must run before the new one's setup, and a
  // passive cleanup would run after it and wipe the attribute.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-tab", active);
    return () => document.documentElement.removeAttribute("data-tab");
  }, [active]);

  // On a narrow screen the bar scrolls sideways; the current tab must not be left out of sight.
  useEffect(() => {
    const nav = bar.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !current) return;
    const left = current.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft) nav.scrollTo({ left: left - 8, behavior: "instant" });
    else if (left + current.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: left + current.offsetWidth - nav.clientWidth + 8, behavior: "instant" });
  }, [active]);

  // After a change of address, bring its target under the sticky bars. A link
  // in the page ("Try the demo") takes the reader to what it names. The tab
  // bar only switches what is shown, and moves the page just enough to show
  // the top of the panel: up if the reader had scrolled past it, and down if
  // the bar was so low on the screen that the panel would open out of sight.
  const reveal = useCallback((targetHash: string, jump: boolean) => {
    const target = findInStudy(bar.current, targetHash);
    if (!target) return;
    if (target.hasAttribute("data-panel") && !jump) {
      const styles = getComputedStyle(target);
      const limit = parseFloat(styles.scrollMarginTop) || 0;
      const top = target.getBoundingClientRect().top;
      if (top < limit || top > window.innerHeight * 0.75) window.scrollTo({ top: window.scrollY + top - limit, behavior: "instant" });
    } else {
      target.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, []);

  useEffect(() => {
    const onChange = (event: Event) => {
      const jump = event instanceof CustomEvent && event.detail === "jump";
      requestAnimationFrame(() => reveal(window.location.hash, jump));
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, [reveal]);

  // Any link on the page to one of this page's anchors switches tab the same way.
  useEffect(() => {
    const onClick = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href^='#']");
      // Only links inside the case study itself; the skip link keeps its native behaviour.
      if (!link || link.closest("[data-tabbar]") || !link.closest("[data-case-study]")) return;
      const href = link.getAttribute("href") ?? "";
      if (!bar.current || link.closest("[data-case-study]") !== bar.current.closest("[data-case-study]")) return;
      if (!findInStudy(bar.current, href)) return;
      event.preventDefault();
      window.history.pushState(null, "", href);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: "jump" }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function select(event: MouseEvent<HTMLAnchorElement>, id: TabId) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (tabForHash(window.location.hash) !== id || window.location.hash !== `#${id}`) window.history.pushState(null, "", `#${id}`);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <nav ref={bar} aria-label="Sections of this case study" data-tabbar className="tabbar">
      {tabs.map((tab) => {
        const Icon = TAB_ICON[tab.id];
        return (
          <a key={tab.id} href={`#${tab.id}`} aria-current={active === tab.id ? "true" : undefined} onClick={(event) => select(event, tab.id)}>
            <Icon size={16} aria-hidden />
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
