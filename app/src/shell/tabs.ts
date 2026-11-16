// Live tabs in the centre: a tab bar over TabModel, one mounted page host per tab, hash sync.
import { byGame, gk } from "../games";
import type { ToolContext } from "./shell";
import { TabModel, isTabsState, type TabsState } from "./tabmodel";
import { applyHash, isValidRouteWith, normalizeRoute, parseRoute } from "./routes";
import { newTabItems } from "./navmodel";
import { readState, writeState } from "./state";
import { bus } from "./events";
import { byId } from "../library";
import { getContent, isLocked, onContentChange } from "../content";
import { lockedLabel } from "../ui/locked";
import { availableTools, hiddenToolNote, PLAY_TOOLS, toolHidden } from "../tools/common";
import { icon, type IconName } from "../ui/icon";
import { button, card } from "../ui/components";
import * as book from "../pages/book";
import * as home from "../pages/home";
import { guardTool } from "./toolguard";
import { guardRoute, VOID_UNLOCK_ROUTE, voidLocked } from "./voidgate";
import { resetForContentChange } from "./hostreset";
import { renderPageHeader } from "./pageheader";
import { html, setHTML } from "../ui/html";

export const TABS_KEY = gk("2d6:shell:tabs");

export interface Page {
  render(root: HTMLElement, ctx: ToolContext, route: string): void | Promise<void>;
  onShow?(): void;
  onHide?(): void;
}

interface ToolModule {
  render(root: HTMLElement, ctx: ToolContext): void | Promise<void>;
  onShow?(): void;
  onHide?(): void;
}

// each game's tool modules (ids match its PLAY_TOOLS); Settings is shared
const toolModules: Record<string, () => Promise<ToolModule>> = {
  ...byGame<Record<string, () => Promise<ToolModule>>>({
    dungeon: {
      dungeon: () => import("../tools/dungeon"),
      sheet: () => import("../tools/sheet"),
      combat: () => import("../tools/combat"),
      realm: () => import("../tools/realm"),
      lairs: () => import("../tools/lairs"),
      haunted: () => import("../tools/haunted"),
      map: () => import("../tools/mappage"),
    },
    void: {
      vhulk: () => import("../tools/void/hulk"),
      vcombat: () => import("../tools/void/combat"),
      vsheet: () => import("../tools/void/sheet"),
      vmap: () => import("../tools/void/mappage"),
    },
  }),
  // shared by both games: one view of every achievement
  achievements: () => import("../tools/achievements"),
  statistics: () => import("../tools/statistics"),
  bestiary: () => import("../tools/bestiary"),
  items: () => import("../tools/items"),
  tables: () => import("../tools/tables"),
  characters: () => import("../pages/characters"),
  notes: () => import("../pages/notes"),
  journal: () => import("../pages/journal"),
  settings: () => import("../settings"),
};
const TOOL_IDS = Object.keys(toolModules);

const TOOL_ICONS: Record<string, IconName> = { ...Object.fromEntries(PLAY_TOOLS.map((t) => [t.id, t.icon])), settings: "settings" };

/** A section id that exists (free, unlocked or locked), a known tool (not the bare map window), or "#/". */
export const isValidRoute = (route: string): boolean => isValidRouteWith(route, (id) => byId.has(id) || isLocked(id), TOOL_IDS);

function homePage(): Page {
  let root: HTMLElement | null = null;
  return {
    render(r) {
      root = r;
      return home.render(r);
    },
    // bookmarks and recently viewed change while the tab sits hidden
    onShow() {
      if (root) void home.render(root);
    },
  };
}

/** A fresh Page for `route`: "#/s/<id>[?find=]" → book, "#/play/<tool>" → tool module, else Home. */
export async function pageFor(route: string): Promise<Page> {
  const r = parseRoute(route);
  if (r.kind === "section") return { render: book.render };
  if (r.kind === "tool" && toolModules[r.id]) {
    const mod = await toolModules[r.id]();
    const page: Page = { render: (root, ctx) => mod.render(root, ctx), onShow: () => mod.onShow?.(), onHide: () => mod.onHide?.() };
    return guardTool(r.id, page); // a tool whose saved state breaks its first draw gets the recovery card
  }
  return homePage();
}

export function routeTitle(route: string): string {
  const r = parseRoute(route);
  if (r.kind === "section") {
    const c = getContent(r.id);
    return c ? (c.ok ? c.section.title : lockedLabel(c.locked)) : "Missing section";
  }
  if (r.kind === "tool") return PLAY_TOOLS.find((t) => t.id === r.id)?.title ?? (r.id === "settings" ? "Settings" : r.id);
  return "Home";
}

function routeIcon(route: string): IconName {
  const r = parseRoute(route);
  if (r.kind === "section") return "file-text";
  if (r.kind === "tool") return TOOL_ICONS[r.id] ?? "key";
  return "book";
}

interface Host {
  el: HTMLElement;
  route: string | null; // route rendered (or being rendered) into el
  page: Page | null;
  disposers: (() => void)[];
  token: number;
  scroll: number;
}

export interface Tabs {
  readonly model: TabModel;
  open(route: string, opts?: { newTab?: boolean }): void;
  close(id: string): void;
}

/**
 * Build the tab bar and page hosts inside `centre`. `base` is the ToolContext minus onDispose;
 * `openSearch` opens the search modal so its pick lands in a new tab (the "+" picker's last row).
 */
export function initTabs(centre: HTMLElement, base: Omit<ToolContext, "onDispose">, opts: { openSearch(): void }): Tabs {
  const bar = document.createElement("div");
  bar.className = "tabbar";
  const pages = document.createElement("div");
  pages.className = "pages";
  centre.append(bar, pages);

  const saved = readState<TabsState>(TABS_KEY, isTabsState, () => ({ v: 1, tabs: [], active: null }));
  const model = new TabModel(saved);
  model.restore(isValidRoute);
  const hash = normalizeRoute(location.hash);
  if (!model.state.tabs.length) model.open(isValidRoute(hash) ? hash : "#/");
  // a deep link (not plain Home) that isn't the restored active tab opens beside the restored tabs
  else if (hash !== "#/" && isValidRoute(hash) && model.current(model.active!) !== hash) model.open(hash, { newTab: true });

  const hosts = new Map<string, Host>();
  let shown: string | null = null;
  let booting = true;

  const dispose = (h: Host) => {
    for (const fn of h.disposers.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error("page dispose failed", e);
      }
    }
  };

  async function mount(id: string, h: Host, route: string) {
    dispose(h);
    h.route = route;
    h.page = null;
    const token = ++h.token;
    const root = document.createElement("div");
    root.className = "page";
    setHTML(root, html`<p class="muted page-loading">Loading…</p>`);
    const head = document.createElement("header");
    h.el.replaceChildren(head, root);
    h.el.scrollTop = 0;
    h.scroll = 0;
    const ctx: ToolContext = { ...base, onDispose: (fn) => void h.disposers.push(fn) };
    const header = renderPageHeader(head, route, root, ctx);
    ctx.onDispose(header.dispose);
    try {
      const page = await pageFor(route);
      if (token !== h.token) return;
      root.replaceChildren();
      h.page = page;
      await page.render(root, ctx, route);
      if (token === h.token) header.refresh();
    } catch (e) {
      if (token !== h.token) return;
      console.error(e);
      setHTML(root, card(
        html`<p class="err-msg">${(e instanceof Error ? e.message : String(e))}</p><div class="err-actions">${button("Retry", { variant: "primary", icon: "rotate-ccw", attrs: html`data-err="retry"` })}${button("Close tab", { icon: "x", attrs: html`data-err="close"` })}</div>`,
        { title: "This page hit an error", tone: "danger" },
      ));
      root.querySelector<HTMLElement>('[data-err="retry"]')!.onclick = () => mount(id, h, route);
      root.querySelector<HTMLElement>('[data-err="close"]')!.onclick = () => close(id);
    }
  }

  function renderBar() {
    const t = model.active;
    const canBack = !!t && t.index > 0;
    const canFwd = !!t && t.index < t.history.length - 1;
    const tabs = html`${model.state.tabs
      .map((tab) => {
        const route = model.current(tab);
        const on = tab.id === model.state.active;
        const title = routeTitle(route);
        return (
          html`<div class="tb-tab${on ? " is-active" : ""}" data-tab-id="${tab.id}"><button type="button" class="tb-tab-open" role="tab" aria-selected="${String(on)}" data-open="${tab.id}" title="${title}">${icon(routeIcon(route), { size: 15 })}<span>${title}</span></button><button type="button" class="tb-close" data-close="${tab.id}" aria-label="Close ${title}">${icon("x", { size: 14 })}</button></div>`
        );
      })}`;
    setHTML(bar, html`<button type="button" class="tb-nav" data-nav="back" aria-label="Back" ${canBack ? "" : "disabled"}>${icon("chevron-left")}</button><button type="button" class="tb-nav" data-nav="forward" aria-label="Forward" ${canFwd ? "" : "disabled"}>${icon("chevron-right")}</button><div class="tb-tabs" role="tablist">${tabs}</div><button type="button" class="tb-nav" data-nav="new" aria-label="New tab" title="New tab" aria-haspopup="menu" aria-expanded="false" aria-controls="tb-new-menu">${icon("plus")}</button>`);
    bar.querySelector(".tb-tab.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Bring the DOM, storage, URL and listeners in line with the model. */
  function sync() {
    closeMenu();
    for (const [id, h] of hosts) {
      if (model.state.tabs.some((t) => t.id === id)) continue;
      if (shown === id) {
        h.page?.onHide?.();
        shown = null;
      }
      h.token++;
      dispose(h);
      h.el.remove();
      hosts.delete(id);
    }
    if (!model.active) model.open("#/"); // no tabs left → Home
    // 2D6 Void without its book: every route but Settings (where the book is unlocked) shows Settings again
    const detour = guardRoute(model.current(model.active!), voidLocked());
    if (detour) model.open(detour);
    // an addon book's tool without its book (a restored tab, a typed link, a book just locked): Settings → Books
    const here = parseRoute(model.current(model.active!));
    if (here.kind === "tool" && toolHidden(here.id)) {
      const note = hiddenToolNote(here.id);
      model.open(VOID_UNLOCK_ROUTE);
      if (note) base.toast(note);
    }
    const t = model.active!;
    let h = hosts.get(t.id);
    if (!h) {
      const el = document.createElement("section");
      el.className = "tab-page";
      el.dataset.tab = t.id;
      pages.append(el);
      hosts.set(t.id, (h = { el, route: null, page: null, disposers: [], token: 0, scroll: 0 }));
    }
    let switched = false;
    if (shown !== t.id) {
      const old = shown ? hosts.get(shown) : undefined;
      if (old) {
        old.scroll = old.el.scrollTop;
        old.page?.onHide?.();
        old.el.hidden = true;
      }
      for (const [id, x] of hosts) x.el.hidden = id !== t.id;
      h.el.scrollTop = h.scroll;
      shown = t.id;
      switched = true;
    }
    const route = model.current(t);
    if (h.route !== route) void mount(t.id, h, route);
    else if (switched) h.page?.onShow?.();

    renderBar();
    writeState(TABS_KEY, model.state);
    if (location.hash !== route) {
      if (booting) history.replaceState(null, "", route);
      else history.pushState(null, "", route);
    }
    document.title = parseRoute(route).kind === "home" ? "2D6 Companion" : `${routeTitle(route)} · 2D6 Companion`;
    bus.emit("tabs:changed", { active: route });
  }

  function open(route: string, o?: { newTab?: boolean }) {
    const r = normalizeRoute(route);
    model.open(isValidRoute(r) ? r : "#/", o); // as applyHash does for a typed hash
    sync();
  }

  // the "+" picker: Home, the play tools, Settings, "Search the books…"; each opens in a new tab
  let items = newTabItems(availableTools());
  const menu = document.createElement("div");
  menu.className = "ph-menu tb-menu";
  menu.id = "tb-new-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "New tab");
  menu.hidden = true;
  const fillMenu = () => {
    items = newTabItems(availableTools()); // an addon book's tool is listed only while its book is unlocked
    setHTML(menu, html`${items
      .map((it) => html`<button type="button" role="menuitem" data-pick="${it.id}">${icon(it.icon, { size: 16 })}<span>${it.label}</span></button>`)}`);
  };
  fillMenu();
  document.body.append(menu);
  const plusBtn = () => bar.querySelector<HTMLButtonElement>('[data-nav="new"]');
  const menuButtons = () => [...menu.querySelectorAll<HTMLButtonElement>("button")];
  function openMenu() {
    const b = plusBtn();
    if (!b) return;
    const r = b.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = `${Math.round(Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)))}px`;
    b.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    menuButtons()[0]?.focus();
  }
  function closeMenu(focusBtn = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    plusBtn()?.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (focusBtn) plusBtn()?.focus();
  }
  function onOutside(e: Event) {
    const t = e.target as Node;
    if (!menu.contains(t) && !plusBtn()?.contains(t)) closeMenu();
  }
  menu.addEventListener("keydown", (e) => {
    const list = menuButtons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const n = list.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      list[e.key === "Home" ? 0 : n - 1]?.focus();
    } else if (e.key === "Tab") closeMenu();
  });
  menu.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-pick]")?.dataset.pick;
    const it = items.find((x) => x.id === id);
    if (!it) return;
    closeMenu();
    if (it.route) open(it.route, { newTab: true });
    else opts.openSearch();
  });
  // the menu is placed once under the button: close it when that position goes stale
  window.addEventListener("resize", () => closeMenu());
  bar.addEventListener("scroll", () => closeMenu(), true); // the tab strip scrolls (scroll doesn't bubble: capture)
  bar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && (e.target as HTMLElement).dataset.nav === "new" && menu.hidden) {
      e.preventDefault();
      openMenu();
    }
  });
  function close(id: string) {
    model.close(id);
    sync();
  }

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    if (b.dataset.open) model.activate(b.dataset.open);
    else if (b.dataset.close) model.close(b.dataset.close);
    else if (b.dataset.nav === "back") model.back();
    else if (b.dataset.nav === "forward") model.forward();
    else if (b.dataset.nav === "new") return menu.hidden ? openMenu() : closeMenu();
    else return;
    sync();
  });
  // middle-click a tab closes it (mousedown default would start auto-scroll)
  bar.addEventListener("mousedown", (e) => {
    if (e.button === 1 && (e.target as HTMLElement).closest(".tb-tab")) e.preventDefault();
  });
  bar.addEventListener("auxclick", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tb-tab");
    if (e.button !== 1 || !tab) return;
    e.preventDefault();
    close(tab.dataset.tabId!);
  });

  // Ctrl/Meta/middle-click on any in-app link opens it in a new tab
  const newTabLink = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.<HTMLAnchorElement>('a[href^="#/"]');
    if (!a || e.defaultPrevented) return; // the tree and search open their own links
    const middle = e.type === "auxclick" && e.button === 1;
    const mod = e.type === "click" && (e.ctrlKey || e.metaKey);
    if (!middle && !mod) return;
    e.preventDefault();
    open(a.getAttribute("href")!, { newTab: true });
  };
  document.addEventListener("click", newTabLink);
  document.addEventListener("auxclick", newTabLink);

  // hash changes we did not cause: plain links, browser back/forward, typed URLs
  const onNav = () => {
    if (applyHash(model, location.hash, isValidRoute)) sync();
    else if (normalizeRoute(location.hash) !== model.current(model.active!)) history.replaceState(null, "", model.current(model.active!));
  };
  window.addEventListener("hashchange", onNav);
  window.addEventListener("popstate", onNav);

  // a book was unlocked or locked again: section pages and Home render afresh (now the text, or the locked
  // card); after a Lock every hidden tab is emptied until it is shown again, so no locked text stays in the DOM
  onContentChange((c) => {
    fillMenu();
    resetForContentChange(hosts, shown, (r) => parseRoute(r).kind === "tool", dispose, c.removed);
    sync();
  });

  sync();
  booting = false;
  return { model, open, close };
}
