// The header above each tab page: a breadcrumb, a "Fix text" toggle on section pages, and the Page tools menu
// (bookmark, original page, Fix mode, find). Pages with no tools (Home, play tools) show neither.
import type { ToolContext } from "./shell";
import { crumbsFor } from "./navmodel";
import { parseRoute } from "./routes";
import { byId, lib } from "../library";
import { PLAY_TOOLS } from "../tools/common";
import { icon, type IconName } from "../ui/icon";
import { bookControls } from "../pages/book";
import { getContent } from "../content";
import { lockedLabel } from "../ui/locked";
import { askText } from "../ui/ask";
import { html, setHTML } from "../ui/html";
import { readState, writeState } from "./state";

/** The one-time hint under the "Fix text" button: shown on the first section page, then never again. */
const FIX_HINT_KEY = "2d6:shell:fixHint";
const isSeen = (v: unknown): v is { seen: boolean } => typeof (v as { seen?: unknown })?.seen === "boolean";
const fixHintSeen = (): boolean => readState(FIX_HINT_KEY, isSeen, () => ({ seen: false })).seen;

interface Item {
  id: string;
  label: string;
  icon: IconName;
  checked?: boolean; // a toggle (menuitemcheckbox)
}

/**
 * Fill `el` with the header for `route`. `root` is the page's render root, so section pages can
 * hand their controls to the menu. Call `refresh` once the page has rendered; `dispose` removes the
 * listeners on document and the bus.
 */
export function renderPageHeader(el: HTMLElement, route: string, root: HTMLElement, ctx: ToolContext): { refresh(): void; dispose(): void } {
  const r = parseRoute(route);
  const isSection = r.kind === "section";
  const c = isSection ? getContent(r.id) : undefined;
  // a locked section: its book and its locked label, never its title
  const crumbs = c && !c.ok
    ? [{ label: c.locked.bookName }, { label: lockedLabel(c.locked) }]
    : crumbsFor(route, { books: lib.books, sections: lib.sections, byId }, PLAY_TOOLS);
  el.className = "page-header";
  setHTML(el, html`<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs
      .map((c, i) => {
        const last = i === crumbs.length - 1;
        const body = c.href && !last ? html`<a href="${c.href}">${c.label}</a>` : html`<span${last ? html` aria-current="page"` : ""}>${c.label}</span>`;
        return html`<li>${body}</li>`;
      })}</ol></nav><span class="ph-mark" hidden title="Bookmarked">${icon("star-filled", { size: 16, label: "Bookmarked" })}</span><div class="ph-fix" hidden><button type="button" class="ph-fixbtn" aria-pressed="false" title="Correct typos in this page's text">${icon("pencil", { size: 15 })}<span>Fix text</span></button></div><div class="ph-tools"${isSection ? "" : " hidden"}><button type="button" class="ph-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Page tools" title="Page tools">${icon("more-horizontal")}</button><div class="ph-menu" role="menu" aria-label="Page tools" hidden></div></div>`);

  const btn = el.querySelector<HTMLButtonElement>(".ph-btn")!;
  const menu = el.querySelector<HTMLElement>(".ph-menu")!;
  const mark = el.querySelector<HTMLElement>(".ph-mark")!;
  const controls = () => (isSection ? bookControls(root) : undefined);
  const tools = el.querySelector<HTMLElement>(".ph-tools")!;
  const fixWrap = el.querySelector<HTMLElement>(".ph-fix")!;
  const fixBtn = el.querySelector<HTMLButtonElement>(".ph-fixbtn")!;
  const refreshMark = () => (mark.hidden = !controls()?.marked());
  const refreshFix = () => {
    const on = !!controls()?.fixMode();
    fixBtn.setAttribute("aria-pressed", String(on));
    fixBtn.title = on ? "Stop fixing text" : "Correct typos in this page's text";
  };
  /** After render: the menu and the Fix text button only show when the page handed over its controls. */
  const refresh = () => {
    const has = !!controls();
    tools.hidden = !has;
    fixWrap.hidden = !has;
    refreshMark();
    refreshFix();
    if (has && !fixHintSeen()) setTimeout(maybeShowFixHint, 800);
  };

  /** Not over the first-visit tour or any other dialog: wait for a later section page instead. */
  function maybeShowFixHint() {
    if (!fixWrap.isConnected || fixWrap.hidden || fixWrap.querySelector(".ph-hint") || fixHintSeen()) return;
    if (document.querySelector(".modal:not([hidden]), dialog[open]")) return;
    showFixHint();
  }

  function hideFixHint() {
    fixWrap.querySelector(".ph-hint")?.remove();
  }
  function showFixHint() {
    writeState(FIX_HINT_KEY, { seen: true });
    const hint = document.createElement("div");
    hint.className = "ph-hint";
    hint.setAttribute("role", "note");
    setHTML(hint, html`<p>Spotted a typo? Tap <strong>Fix text</strong> to correct this page. Fixes stay on this device.</p><button type="button" class="btn btn-sm btn-ghost">Got it</button>`);
    hint.querySelector("button")!.addEventListener("click", hideFixHint);
    fixWrap.append(hint);
  }
  fixBtn.addEventListener("click", () => {
    hideFixHint();
    close();
    controls()?.toggleFix();
  });
  // the page's own Done button leaves Fix mode too; it tells us through this event on its root
  root.addEventListener("fixmode", refreshFix);

  function items(): Item[] {
    const c = controls();
    const out: Item[] = [];
    if (c) {
      out.push({ id: "bookmark", label: c.marked() ? "Remove bookmark" : "Bookmark", icon: "star" });
      if (c.hasOriginal()) out.push({ id: "original", label: "Show original page", icon: "image" });
      out.push({ id: "fix", label: "Fix mode", icon: "pencil", checked: c.fixMode() });
      out.push({ id: "find", label: "Find in page…", icon: "search" });
    }
    return out;
  }

  const menuItems = () => [...menu.querySelectorAll<HTMLButtonElement>("button:not([hidden])")].filter((b) => !b.closest("[hidden]"));

  function open() {
    setHTML(menu, html`${items()
      .map((it) => {
        const role = it.checked === undefined ? "menuitem" : "menuitemcheckbox";
        const state = it.checked === undefined ? "" : html` aria-checked="${String(it.checked)}"`;
        return html`<button type="button" role="${role}" data-act="${it.id}"${state}>${icon(it.icon, { size: 16 })}<span>${it.label}</span>${
          it.checked ? html`<span class="ph-check">${icon("check", { size: 14 })}</span>` : ""
        }</button>`;
      })}`);
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    menuItems()[0]?.focus();
  }
  function close(focusBtn = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (focusBtn) btn.focus();
  }
  function onOutside(e: Event) {
    if (!el.querySelector(".ph-tools")!.contains(e.target as Node)) close();
  }

  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  menu.addEventListener("keydown", (e) => {
    const list = menuItems();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === "Tab") close();
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close(true);
    else if (e.key === "ArrowDown" && menu.hidden) {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    const c = controls();
    switch (b.dataset.act) {
      case "bookmark":
        close(true);
        c?.toggleBookmark();
        return;
      case "original":
        close();
        c?.showOriginal();
        return;
      case "fix":
        close(true);
        hideFixHint();
        c?.toggleFix();
        return;
      case "find": {
        close(true);
        void askText("Find in page", "", { ok: "Find" }).then((a) => {
          const term = a?.trim();
          if (term && c && !c.find(term)) ctx.toast(`No “${term}” on this page`);
        });
        return;
      }
    }
  });

  const off = isSection ? ctx.events.on("bookmarks:changed", refreshMark) : () => {};
  return {
    refresh,
    dispose() {
      close();
      off();
      root.removeEventListener("fixmode", refreshFix);
    },
  };
}
