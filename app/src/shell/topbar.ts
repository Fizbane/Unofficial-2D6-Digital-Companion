// The top bar. Left: the contents menu button (narrow screens) and the logo (text fallback when
// logo.png fails). Centre: the dungeon / realm status, which opens that tool. Right: the search
// box, the side-panel toggle and Settings. Also owns the shell's Esc (closes a drawer or overlay).
import { bus } from "./events";
import { lastContext, type Layout } from "./layout";
import { contextOf, dungeonSummary, realmSummary, statusText, type DungeonLike } from "./status";
import { inPopover, popoverOpen } from "./overlays";
import { hasSaved, load } from "../tools/common";
import { icon } from "../ui/icon";
import { html, setHTML } from "../ui/html";
import { GAME_IDS, GAMES, game, gameId, isVoid, switchGame, type GameId } from "../games";

type SheetModule = typeof import("../tools/sheet");
let sheet: SheetModule | null = null;
let voidStatus: ((route: string | null) => { text: string; target: string; title: string } | null) | null = null;

export interface TopbarOptions {
  layout: Layout;
  openTab(route: string): void;
  openSearch(): void;
  isSearchOpen(): boolean;
  /** The active tab's route (null before the tabs exist). */
  active(): string | null;
}

/** Build the top bar into `header`; returns the side-panel toggle (it carries the panel badge). */
export function initTopbar(header: HTMLElement, o: TopbarOptions): HTMLElement {
  setHTML(header, html`
    <button type="button" class="icon-btn topbar-menu" data-tree-toggle aria-label="Contents" title="Contents" aria-expanded="false">${icon("menu")}</button>
    <a href="#/" class="brand" aria-label="${game().name} home" aria-current="true"><img class="brand-logo" src="${game().logo}" alt="${game().logoAlt}"><span class="brand-text">${game().name}</span></a>
    <span class="game-switch">${GAME_IDS.filter((g) => g !== gameId()).map((g) =>
      html`<button type="button" class="game-other" data-game="${g}" aria-label="Switch to ${GAMES[g].name}" title="Switch to ${GAMES[g].name}"><img src="${GAMES[g].logo}" alt=""></button>`)}</span>
    <div class="topbar-chars"></div>
    <div class="topbar-centre"><button type="button" class="topbar-status" hidden></button></div>
    <button type="button" id="search-btn" class="search-trigger" aria-label="Search">${icon("search", { size: 16 })}<span>Search rules &amp; tables…</span><kbd>/</kbd></button>
    <button type="button" id="panel-btn" class="icon-btn" data-panel-toggle aria-label="Side panel" title="Side panel" aria-expanded="false">${icon("panel-right")}</button>
    <button type="button" class="icon-btn topbar-settings" data-settings aria-label="Settings" title="Settings">${icon("settings")}</button>`);
  const $ = <T extends HTMLElement>(sel: string) => header.querySelector(sel) as T;
  const brand = $<HTMLAnchorElement>(".brand");
  const logo = $<HTMLImageElement>(".brand-logo");
  logo.onload = () => brand.classList.add("has-logo");
  logo.onerror = () => logo.remove();
  if (logo.complete && logo.naturalWidth) brand.classList.add("has-logo");
  // the logo opens Home through the tab model (a plain #/ link does nothing when Home is already the hash)
  brand.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // new-tab clicks: the tabs module handles them
    e.preventDefault();
    o.openTab("#/");
  });

  // the other game's logo: switch to it (saves the choice, reloads into its dashboard)
  header.querySelectorAll<HTMLButtonElement>(".game-other").forEach((b) => {
    b.onclick = () => switchGame(b.dataset.game as GameId);
  });

  const menuBtn = $(".topbar-menu");
  const panelBtn = $("#panel-btn");
  const status = $<HTMLButtonElement>(".topbar-status");
  menuBtn.onclick = () => o.layout.toggle("tree");
  panelBtn.onclick = () => o.layout.toggle("panel");
  $("#search-btn").onclick = () => o.openSearch();
  $(".topbar-settings").onclick = () => o.openTab("#/play/settings");

  const syncButtons = () => {
    const l = o.layout;
    menuBtn.setAttribute("aria-expanded", String(l.shown("tree")));
    panelBtn.setAttribute("aria-expanded", String(l.shown("panel")));
  };
  o.layout.onChange(syncButtons);
  syncButtons();

  // Esc: menus, dialogs, popovers and the search modal handle it first. Otherwise it closes an open
  // drawer or overlay. Whether one was open is noted on the way down
  // (capture), because the search modal has already closed itself by the time Esc bubbles up.
  let busy = false;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") busy = o.isSearchOpen() || popoverOpen() || inPopover(e.target);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || busy || e.defaultPrevented) return;
    if (o.layout.closeTransient()) e.preventDefault();
  });

  // ---------- context status ----------
  let route = o.active(); // kept from tabs:changed, which also fires while the tabs are first built
  const draw = () => {
    if (isVoid()) {
      // Void's status line comes from its own tools
      const st = voidStatus?.(route) ?? null;
      status.hidden = !st;
      status.textContent = st?.text ?? "";
      if (st) {
        status.dataset.target = st.target;
        status.title = st.title;
        status.setAttribute("aria-label", `${st.text}. ${st.title}`);
      }
      return;
    }
    const ctx = contextOf(route);
    if (ctx && ctx !== lastContext(o.layout.state)) o.layout.set({ lastContext: ctx });
    const d = load<DungeonLike>("dungeon", { level: 1, rooms: [], current: null });
    const dungeon = sheet ? dungeonSummary(d, sheet.loadChar().rations) : null;
    const realm = realmSummary(hasSaved("realm") ? load("realm", { month: 1, round: 1, gc: 0 }) : null);
    const st = statusText({ route, last: lastContext(o.layout.state), dungeon, realm });
    status.hidden = !st;
    status.textContent = st?.text ?? "";
    if (st) {
      status.dataset.target = st.target;
      const tool = st.target === "#/play/realm" ? "Realm" : "Dungeon";
      status.title = `Open the ${tool} tab`;
      status.setAttribute("aria-label", `${st.text}. Open the ${tool} tab`);
    }
  };
  status.onclick = () => status.dataset.target && o.openTab(status.dataset.target);
  bus.on("tabs:changed", (p) => {
    route = p.active;
    draw();
  });
  for (const ev of ["dungeon:changed", "realm:changed", "character:changed"] as const) bus.on(ev, draw);
  draw();
  if (isVoid()) {
    void import("../tools/void/status").then((m) => {
      voidStatus = m.voidStatus;
      bus.on("void:changed", draw);
      draw();
    });
  } else {
    void import("../tools/sheet").then((m) => {
      sheet = m;
      draw();
    });
  }
  return panelBtn;
}
