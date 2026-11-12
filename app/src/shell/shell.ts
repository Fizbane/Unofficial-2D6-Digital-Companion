// The workspace shell: top bar, character bar, icon rail, tree, tabbed centre and right panel.
// The top bar is topbar.ts, the character bar bottombar.ts; layout.ts handles breakpoints and drawers.
// Owns the ToolContext handed to every page.
import type { Library, Section } from "../types";
import { byId, inline, lib } from "../library";
import { bus, type EventBus, type Events } from "./events";
import { onWriteFail } from "./state";
import { initTabs, isValidRoute, type Tabs } from "./tabs";
import { initLayout, railMode } from "./layout";
import { initSearch } from "./search";
import { initRail } from "./rail";
import { initTree } from "./tree";
import { badge, initRightPanel, showPanel, type PanelId } from "./rightpanel";
import { initTopbar } from "./topbar";
import { initResults } from "./panels/results";
import { initBottomBar } from "./bottombar";
import { initNotes } from "./panels/notes";
import { initJournal } from "./journal";
import { initAchievements } from "./achievements";
import { achToast, initAchToast } from "./achtoast";
import { initJournalPanel } from "./panels/journal";
import { clearDice } from "../dice3d";
import { initUnlockActions } from "../ui/locked";
import { html, raw, setHTML, type Raw } from "../ui/html";

export type { PanelId };

export interface ToolContext {
  lib: Library;
  byId: Map<string, Section>;
  /** Book text as markup: escaped, then bold/italic, dice faces and cross-links. */
  inline(s: string): Raw;
  toast(msg: string): void;
  openTab(route: string, opts?: { newTab?: boolean }): void;
  showPanel(id: PanelId): void;
  events: EventBus<Events>;
  /** Runs when this page is replaced inside its tab, or its tab is closed. */
  onDispose(fn: () => void): void;
}

let toastTimer = 0;
export function toast(msg: string) {
  const t = document.getElementById("toast")!;
  t.textContent = msg;
  // restart the slide-up when a toast replaces one still showing
  if (!t.hidden) {
    t.hidden = true;
    void t.offsetWidth;
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 4000);
}

const RELOAD_TOAST = "2d6-companion:reload-toast"; // sessionStorage: not part of a backup

/**
 * Reload the page and show `msg` once it is back. Used after Settings replaces or clears saved
 * data: every live tab, panel and in-memory store (Results, tabs, the journal) would otherwise keep its
 * old state and write it back over the new data. Nothing in the app writes on unload.
 */
export function reloadWithToast(msg: string) {
  try {
    sessionStorage.setItem(RELOAD_TOAST, msg);
  } catch {
    /* no sessionStorage: reload without the message */
  }
  location.reload();
}

function takeReloadToast() {
  try {
    const msg = sessionStorage.getItem(RELOAD_TOAST);
    sessionStorage.removeItem(RELOAD_TOAST);
    if (msg) toast(msg);
  } catch {
    /* ignore */
  }
}

/** Put the icon sprite into the document once, so <use href="#i-…"> resolves. */
async function inlineIcons() {
  try {
    const res = await fetch("icons.svg");
    if (!res.ok) return;
    const holder = document.createElement("div");
    holder.className = "icon-sprite";
    holder.setAttribute("aria-hidden", "true");
    // audited: the app's own icon sprite, fetched from its own origin (public/icons.svg, built by build-icons.mjs)
    setHTML(holder, raw(await res.text()));
    document.body.prepend(holder);
  } catch {
    /* offline without cache: icons stay blank, text labels still work */
  }
}

/** ToolContext for pages outside the shell (the map window): no tabs or panels. */
export function bareContext(): ToolContext {
  return {
    lib,
    byId,
    inline: (s) => inline(s),
    toast,
    openTab: (route) => (location.hash = route),
    showPanel: (id) => console.debug("showPanel (no shell)", id),
    events: bus,
    onDispose: () => {},
  };
}

export function buildShell(mount: HTMLElement): Tabs {
  void inlineIcons();
  onWriteFail(() => toast("Couldn't save on this device — changes are kept until you close the page."));

  setHTML(mount, html`
    <div class="app">
      <header class="topbar"></header>
      <div class="charbar"></div>
      <nav class="rail" aria-label="Workspace"></nav>
      <aside class="tree" aria-label="Contents"></aside>
      <main class="centre"></main>
      <aside class="panel" aria-label="Side panel"></aside>
    </div>`);

  const q = <T extends HTMLElement>(sel: string) => mount.querySelector(sel) as T;
  const app = q(".app");
  const layout = initLayout(app, q(".tree"), q(".panel"), q(".rail"));

  let tabs: Tabs | null = null;
  let search: ReturnType<typeof initSearch> | null = null;
  const panelBtn = initTopbar(q(".topbar"), {
    layout,
    openTab: (route) => tabs!.open(route),
    openSearch: () => search?.open(),
    isSearchOpen: () => !!search?.isOpen(),
    active: () => (tabs?.model.active ? tabs.model.current(tabs.model.active) : null),
  });
  const panes = initRightPanel(q(".panel"), layout, panelBtn);
  const openTab = (route: string) => tabs!.open(route);
  initResults(panes.get("results")!, { openTab, toast });
  initNotes(panes.get("notes")!);
  // the journal records play events from boot, whichever tabs are open; new entries badge its tab
  initJournal(() => badge("journal"));
  // achievements record from boot too; each unlock shows a card that opens the Achievements page
  initAchToast(() => openTab("#/play/achievements"));
  initAchievements(achToast);
  initJournalPanel(panes.get("journal")!, { openTab, toast });

  const tabsReady = initTabs(q(".centre"), {
    lib,
    byId,
    inline: (s) => inline(s),
    toast,
    openTab: (route, opts) => tabs!.open(route, opts),
    showPanel,
    events: bus,
  }, { openSearch: () => search?.open({ newTabOnly: true }) });
  tabs = tabsReady;
  // every locked card's Unlock… button
  initUnlockActions((route) => tabsReady.open(route, { newTab: true }));

  const s = initSearch(mount, (route, opts) => tabsReady.open(route, opts));
  search = s;
  const active = () => (tabsReady.model.active ? tabsReady.model.current(tabsReady.model.active) : null);
  const tree = initTree(q(".tree"), { mode: railMode(layout.state), events: bus, active, openRoute: (route, opts) => tabsReady.open(route, opts) });
  initRail(q(".rail"), { layout, tree, openSearch: () => s.open(), openTab, hasRoute: isValidRoute });
  // narrow screens: opening a page from the contents drawer closes it
  const closeTreeDrawer = () => {
    if (layout.bp === "narrow" && layout.shown("tree")) layout.toggle("tree", true);
  };
  bus.on("tabs:changed", closeTreeDrawer);
  q(".tree").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a.tr-link")) setTimeout(closeTreeDrawer); // after the link has navigated
  });

  initBottomBar(q(".charbar"), { toast, openTab, isSearchOpen: () => s.isOpen() });
  // tap anywhere on the thrown dice to sweep them away
  document.getElementById("dice-layer")?.addEventListener("click", () => clearDice());
  takeReloadToast();
  return tabsReady;
}
