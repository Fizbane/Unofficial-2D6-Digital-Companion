// The right panel: a tab bar (Results · Notes · Journal · Combat log) over one pane per tab. Add a tab by
// adding its id to PANEL_IDS (panelmodel.ts), a row to TABS and filling its pane in shell.ts.
// The active tab is saved in "2d6:shell:layout".panelTab; a tab that gets content while it isn't
// on screen shows a badge dot until it is viewed. Each pane is filled by its module in panels/.
import type { Layout } from "./layout";
import { Badges, PANEL_IDS, panelTab, stepPanel, type PanelId } from "./panelmodel";
import { tabsBar } from "../ui/components";
import type { IconName } from "../ui/icon";
import { html, setHTML } from "../ui/html";

export type { PanelId } from "./panelmodel";

const TABS: { id: PanelId; label: string; icon: IconName }[] = [
  { id: "results", label: "Results", icon: "dice" },
  { id: "notes", label: "Notes", icon: "notebook" },
  { id: "journal", label: "Journal", icon: "book-open" },
  { id: "combat", label: "Combat log", icon: "swords" },
];

interface Panel {
  host: HTMLElement;
  bar: HTMLElement;
  panes: Map<PanelId, HTMLElement>;
  layout: Layout;
  toggleBtn: HTMLElement | null;
  active: PanelId;
}

let panel: Panel | null = null;
const badges = new Badges();
const showHooks: ((id: PanelId) => void)[] = [];
let lastShown: PanelId | null = null;
const hiddenTabs = new Set<PanelId>(); // tabs that don't apply right now (the Combat log outside a delve)

/** Is this tab on screen right now? */
function visible(id: PanelId): boolean {
  return !!panel && panel.active === id && panel.layout.shown("panel");
}

function paintBadges() {
  if (!panel) return;
  for (const id of PANEL_IDS) {
    const tab = panel.bar.querySelector<HTMLElement>(`[data-tab="${id}"]`);
    tab?.classList.toggle("has-badge", badges.has(id));
  }
  panel.toggleBtn?.classList.toggle("has-badge", badges.any());
}

/** Clear the badge of whatever is on screen now, and tell the pane it came on screen. */
function clearVisible() {
  const on = panel && visible(panel.active) ? panel.active : null;
  if (on) badges.seen(on);
  paintBadges();
  if (on !== lastShown) {
    lastShown = on;
    if (on) for (const fn of showHooks) fn(on);
  }
}

/** Run `fn` each time a tab comes on screen (tab picked, or the panel opened on it). */
export function onPanelShow(fn: (id: PanelId) => void): void {
  showHooks.push(fn);
}

/** Is tab `id` on screen right now? */
export const panelVisible = (id: PanelId): boolean => visible(id);

function select(id: PanelId, focus = false) {
  if (!panel) return;
  panel.active = id;
  for (const btn of panel.bar.querySelectorAll<HTMLElement>("[data-tab]")) {
    const on = btn.dataset.tab === id;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
    if (on && focus) btn.focus();
  }
  for (const [pid, pane] of panel.panes) pane.hidden = pid !== id;
  if (panel.layout.state.panelTab !== id) panel.layout.set({ panelTab: id });
  clearVisible();
}

/** Build the panel into `host` (the shell's aside.panel). Returns each tab's pane element. */
export function initRightPanel(host: HTMLElement, layout: Layout, toggleBtn: HTMLElement | null): Map<PanelId, HTMLElement> {
  const active = panelTab(layout.state);
  const handle = host.querySelector(".resize-handle");
  setHTML(host, tabsBar(TABS, active, html`aria-label="Side panel"`));
  if (handle) host.prepend(handle);
  const bar = host.querySelector<HTMLElement>(".tabs-bar")!;
  bar.classList.add("panel-tabs");
  const panes = new Map<PanelId, HTMLElement>();
  for (const t of TABS) {
    const pane = document.createElement("section");
    pane.className = `panel-pane pane-${t.id}`;
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-label", t.label);
    pane.hidden = t.id !== active;
    host.append(pane);
    panes.set(t.id, pane);
  }
  panel = { host, bar, panes, layout, toggleBtn, active };

  bar.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab as PanelId | undefined;
    if (!id) return;
    // mid width: the tab icons are a slim strip that opens the overlay; the open tab's icon closes it
    if (!layout.shown("panel")) layout.toggle("panel", false);
    else if (layout.bp === "mid" && panel!.active === id) return layout.toggle("panel", true);
    select(id);
  });
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    select(stepPanel(PANEL_IDS, panel!.active, e.key === "Home" ? "first" : e.key === "End" ? "last" : e.key === "ArrowRight" ? 1 : -1, hiddenTabs), true);
  });
  layout.onChange(clearVisible);
  select(active);
  return panes;
}

/**
 * Show or hide a tab that only applies some of the time. A hidden tab's button is gone from the bar; if it was
 * the open tab, Results takes its place (without changing the saved tab, so it comes back when it applies again).
 */
export function setPanelTabHidden(id: PanelId, hidden: boolean): void {
  if (!panel || hiddenTabs.has(id) === hidden) return;
  if (hidden) hiddenTabs.add(id);
  else hiddenTabs.delete(id);
  const btn = panel.bar.querySelector<HTMLElement>(`[data-tab="${id}"]`);
  if (btn) btn.hidden = hidden;
  if (hidden) {
    badges.seen(id);
    if (panel.active === id) {
      const saved = panel.layout.state.panelTab;
      select("results");
      if (saved === id) panel.layout.set({ panelTab: id });
    } else paintBadges();
  } else if (panelTab(panel.layout.state) === id && panel.active !== id) select(id);
}

/** Open (expand) the panel on tab `id`. */
export function showPanel(id: PanelId): void {
  if (!panel || hiddenTabs.has(id)) return;
  if (!panel.layout.shown("panel")) panel.layout.toggle("panel", false);
  select(id);
}

/** Mark unseen content on tab `id` when it isn't on screen. */
export function badge(id: PanelId): void {
  if (hiddenTabs.has(id)) return;
  badges.mark(id, visible(id));
  paintBadges();
}
