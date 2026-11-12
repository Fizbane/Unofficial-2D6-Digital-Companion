// The filterable contents tree beside the rail. Library mode: Bookmarks, then books → chapters →
// sections. Play mode: the tools, Settings, then Bookmarks. Open groups are kept in "2d6:open".
import type { EventBus, Events } from "./events";
import type { RailMode } from "./layout";
import {
  BOOKMARKS, bookmarksGroup, countLinks, filterTree, isRouteHref, libraryTree, playTree, revealPath, sectionHref, treeFooter, type TreeNode,
} from "./navmodel";
import { byId, lib } from "../library";
import { firstLocked, getContent, onContentChange } from "../content";
import { lockedLabel } from "../ui/locked";
import { PLAY_TOOLS } from "../tools/common";
import { icon } from "../ui/icon";
import { store } from "../pages/store";
import { html, type Raw, setHTML } from "../ui/html";

/** Bookmarks start open, so its stored flag is the inverse: present means the user closed it. */
const BOOKMARKS_CLOSED = "bookmarks:closed";

export interface Tree {
  setMode(mode: RailMode): void;
  /** Put the cursor in the filter box. */
  focusFilter(): void;
}

/** Clicking a link opens it in a new tab, or focuses the tab already showing it (`openRoute`). */
export function initTree(
  host: HTMLElement,
  opts: { mode: RailMode; events: EventBus<Events>; active: () => string | null; openRoute(route: string, o?: { newTab?: boolean }): void },
): Tree {
  host.querySelector(".pane-placeholder")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "tree-inner";
  setHTML(wrap, html`
    <div class="tree-head"><input type="search" class="tree-filter" placeholder="Filter contents…" aria-label="Filter contents" autocomplete="off"></div>
    <nav class="tree-body" aria-label="Contents"></nav>
    <div class="tree-foot muted"></div>`);
  host.prepend(wrap);
  const input = wrap.querySelector<HTMLInputElement>(".tree-filter")!;
  const body = wrap.querySelector<HTMLElement>(".tree-body")!;
  const foot = wrap.querySelector<HTMLElement>(".tree-foot")!;

  let mode = opts.mode;
  let query = "";
  let forced = new Set<string>(); // groups opened by the filter
  let books: TreeNode[] = [];
  const lockedMark = (id: string) => {
    const c = getContent(id);
    return c && !c.ok ? lockedLabel(c.locked) : undefined;
  };
  /** The books from the library (free and unlocked), plus one locked node per book with locked pages. */
  const buildBooks = () => {
    books = libraryTree({ books: lib.books, sections: lib.sections, byId }).map((n) => {
      const id = firstLocked(n.key);
      if (!id) return n;
      const locked: TreeNode = { key: `locked:${n.key}`, label: lockedMark(id)!, href: sectionHref(id), icon: "key-round" };
      // a book with nothing unlocked is just its locked node
      return n.children?.length ? { ...n, children: [...n.children, locked] } : locked;
    });
    foot.textContent = treeFooter(lib.books.length, lib.sections.length);
  };
  buildBooks();
  const tools = playTree(PLAY_TOOLS);

  const stored = () => new Set(store.list("open"));
  const fullTree = (): TreeNode[] => {
    const marks = bookmarksGroup(store.list("bookmarks"), byId, lockedMark);
    return mode === "library" ? [marks, ...books] : [...tools, marks];
  };
  const isOpen = (key: string, open: Set<string>) =>
    forced.has(key) || (key === BOOKMARKS ? !open.has(BOOKMARKS_CLOSED) : open.has(key));

  function setOpen(key: string, on: boolean) {
    const open = stored();
    if (key === BOOKMARKS) on ? open.delete(BOOKMARKS_CLOSED) : open.add(BOOKMARKS_CLOSED);
    else on ? open.add(key) : open.delete(key);
    if (!on) forced.delete(key);
    store.set("open", [...open]);
  }

  function nodeHtml(n: TreeNode, open: Set<string>, active: string | null): Raw {
    const ic = n.icon ? icon(n.icon, { size: 15 }) : "";
    if (!n.children) {
      const on = isRouteHref(n.href, active);
      return html`<li><a class="tr-link${on ? " is-active" : ""}" href="${n.href!}"${on ? html` aria-current="page"` : ""}>${ic}<span>${n.label}</span></a></li>`;
    }
    const isOn = isOpen(n.key, open);
    const k = n.key;
    const count = html`<span class="tr-count">${countLinks(n)}</span>`;
    const chev = html`<span class="tr-chev${isOn ? " is-open" : ""}">${icon("chevron-right", { size: 14 })}</span>`;
    let row: Raw;
    if (n.href) {
      const on = isRouteHref(n.href, active);
      row =
        html`<button type="button" class="tr-twist" tabindex="-1" data-toggle="${k}" aria-label="${isOn ? "Collapse" : "Expand"} ${n.label}">${chev}</button><a class="tr-link${on ? " is-active" : ""}" href="${n.href}" data-group="${k}" aria-expanded="${String(isOn)}"${on ? html` aria-current="page"` : ""}><span>${n.label}</span></a>${count}`;
    } else
      row = html`<button type="button" class="tr-label" data-toggle="${k}" data-group="${k}" aria-expanded="${String(isOn)}">${chev}${ic}<span>${n.label}</span>${count}</button>`;
    const kids = isOn ? html`<ul role="group">${n.children.map((c) => nodeHtml(c, open, active))}</ul>` : "";
    return html`<li class="tr-group"><div class="tr-row">${row}</div>${kids}</li>`;
  }

  /** The focused row as a selector + which match it was (a section can be linked twice: bookmark and book). */
  function focusedRow(): { sel: string; nth: number } | null {
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !body.contains(cur)) return null;
    const sel = cur.dataset.group
      ? `[data-group="${CSS.escape(cur.dataset.group)}"]`
      : cur.getAttribute("href")
        ? `a.tr-link[href="${CSS.escape(cur.getAttribute("href")!)}"]`
        : null;
    if (!sel) return null;
    return { sel, nth: Math.max(0, [...body.querySelectorAll(sel)].indexOf(cur)) };
  }

  function render() {
    const { nodes } = filterTree(fullTree(), query);
    const top = body.scrollTop;
    const had = focusedRow(); // rebuilding drops focus to <body>: put it back on the same row
    setHTML(body, nodes.length
      ? html`<ul class="tr-list">${nodes.map((n) => nodeHtml(n, stored(), opts.active()))}</ul>`
      : html`<p class="muted tr-empty">${query ? "Nothing matches." : ""}</p>`);
    body.scrollTop = top;
    if (had) {
      const all = body.querySelectorAll<HTMLElement>(had.sel);
      (all[had.nth] ?? all[0])?.focus({ preventScroll: true });
    }
  }

  /** Open the groups above the active route's link, then scroll it into view. */
  function reveal() {
    const route = opts.active();
    const path = route ? revealPath(fullTree(), route) : null;
    if (path?.length) {
      const open = stored();
      const missing = path.filter((k) => !isOpen(k, open));
      for (const k of missing) setOpen(k, true);
    }
    render();
    body.querySelector(".tr-link.is-active")?.scrollIntoView({ block: "nearest" });
  }

  body.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.tr-link");
    if (a && e.button === 0) {
      e.preventDefault(); // a plain hash navigation would replace the current tab
      opts.openRoute(a.getAttribute("href")!, { newTab: true });
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-toggle]");
    if (!b) return;
    const key = b.dataset.toggle!;
    setOpen(key, !isOpen(key, stored()));
    render();
    body.querySelector<HTMLElement>(`[data-group="${CSS.escape(key)}"]`)?.focus();
  });
  // ↑/↓ move between rows, → opens a group, ← closes it (or goes to its parent)
  body.addEventListener("keydown", (e) => {
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !body.contains(cur)) return;
    const rows = [...body.querySelectorAll<HTMLElement>(".tr-link, .tr-label")];
    const i = rows.indexOf(cur);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const key = cur.dataset.group;
      const want = e.key === "ArrowRight";
      if (key && isOpen(key, stored()) !== want) {
        e.preventDefault();
        setOpen(key, want);
        render();
        body.querySelector<HTMLElement>(`[data-group="${CSS.escape(key)}"]`)?.focus();
      } else if (!want) {
        const parent = cur.closest("ul[role=group]")?.closest(".tr-group")?.querySelector<HTMLElement>(".tr-link, .tr-label");
        if (parent) {
          e.preventDefault();
          parent.focus();
        }
      }
    }
  });
  input.addEventListener("input", () => {
    query = input.value;
    forced = filterTree(fullTree(), query).open;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      e.stopPropagation();
      input.value = "";
      query = "";
      forced = new Set();
      render();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      body.querySelector<HTMLElement>(".tr-link, .tr-label")?.focus();
    }
  });

  opts.events.on("tabs:changed", reveal);
  opts.events.on("bookmarks:changed", render);
  onContentChange(() => {
    buildBooks();
    render();
  });
  reveal();

  return {
    setMode(m) {
      if (m === mode) return;
      mode = m;
      reveal();
    },
    focusFilter: () => input.focus(),
  };
}
