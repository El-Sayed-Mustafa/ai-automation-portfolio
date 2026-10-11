import { SECTION_TAB, TAB_IDS } from "./case-study-tabs";

/**
 * Runs in <head> before first paint. It applies the saved theme and lens to
 * <html> so the page never flashes the wrong one, and on a case study it picks
 * the tab the address points at, so a link to #demo opens on the demo.
 *
 * The site is light unless the visitor has chosen dark. A `?lens=` query
 * parameter wins over the saved lens, which makes a lens shareable as a link.
 *
 * The Automation Lab is prerendered showing its first workflow. A link that
 * names another one (`?workflow=`) would show the wrong demo until the page
 * hydrates, so the workspace is held back for that moment: `data-lab` is set
 * here and cleared by the workspace once it shows the right one.
 */
export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("theme");d.setAttribute("data-theme",t==="dark"?"dark":"light");var q=new URLSearchParams(location.search).get("lens");var l=q==="engineer"||q==="recruiter"?q:localStorage.getItem("lens");if(l!=="engineer"&&l!=="recruiter"){l="recruiter"}d.setAttribute("data-lens",l);var r=localStorage.getItem("rail");if(r==="collapsed"||r==="expanded"){d.setAttribute("data-rail",r)}if(/^\\/projects\\/[^/]+\\/?$/.test(location.pathname)){var T=${JSON.stringify(TAB_IDS)},S=${JSON.stringify(SECTION_TAB)};var h=decodeURIComponent(location.hash.replace(/^#/,"")).replace(/-title$/,"");d.setAttribute("data-tab",T.indexOf(h)>=0?h:(S[h]||"overview"))}if(/^\\/automation-lab\\/?$/.test(location.pathname)&&new URLSearchParams(location.search).get("workflow")){d.setAttribute("data-lab","pending")}}catch(e){}})()`;
