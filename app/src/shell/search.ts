// Search modal (rail Search button, "/" or Ctrl+K): the play tools by name, then full-text search
// over the library. Enter or a click opens the selected result in a new tab (or focuses the tab
// already showing it); Ctrl+Enter opens it in the current tab. open({ newTabOnly }) (the tab bar's
// "+" picker) always uses a new tab.
import { books, byId, searchLibrary, snippet } from "../library";
import { codeTarget, getContent, onContentChange } from "../content";
import { lockedLabel } from "../ui/locked";
import { isTypingTarget } from "./overlays";
import { availableTools, isCreatureTable } from "../tools/common";
import { icon, type IconName } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";

export interface Search {
  open(opts?: { newTabOnly?: boolean }): void;
  close(): void;
  isOpen(): boolean;
}

const TOOLS = (): { id: string; title: string; blurb: string; icon: IconName }[] => [
  ...availableTools(),
  { id: "settings", title: "Settings", blurb: "Dice, display and backups.", icon: "settings" },
];
const PLACEHOLDER = "Search everything… (try a table code like ENAT1)";

const kinds = new Map<string, IconName>();
onContentChange(() => kinds.clear()); // a section's tables change when its book is unlocked or locked
/** Creature card → swords, a section with a coded table → dice, any other section → file-text. */
function resultIcon(id: string): IconName {
  let k = kinds.get(id);
  if (!k) {
    const tables = (byId.get(id)?.blocks ?? []).flatMap((b) => (b.type === "table" ? [b.table] : []));
    k = tables.some(isCreatureTable) ? "swords" : tables.some((t) => t.code) ? "dice" : "file-text";
    kinds.set(id, k);
  }
  return k;
}

/** Escape `text` and wrap each case-insensitive occurrence of `q` in <mark>. */
export function markMatches(text: string, q: string): Raw {
  const needle = q.trim().toLowerCase();
  if (!needle) return html`${text}`;
  const low = text.toLowerCase();
  const out: Raw[] = [];
  let i = 0;
  for (let j = low.indexOf(needle); j >= 0; j = low.indexOf(needle, i)) {
    out.push(html`${text.slice(i, j)}<mark>${text.slice(j, j + needle.length)}</mark>`);
    i = j + needle.length;
  }
  return html`${out}${text.slice(i)}`;
}

const HINTS = html`<kbd>↑</kbd><kbd>↓</kbd> move <span class="sep"></span><kbd>Enter</kbd> new tab <span class="sep"></span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> this tab <span class="sep"></span><kbd>Esc</kbd> close`;
const NEW_TAB_HINTS = html`<kbd>↑</kbd><kbd>↓</kbd> move <span class="sep"></span><kbd>Enter</kbd> open in a new tab <span class="sep"></span><kbd>Esc</kbd> close`;

/** Build the modal into `host`; `openRoute` opens a result (in the current tab unless `newTab`). */
export function initSearch(host: HTMLElement, openRoute: (route: string, opts?: { newTab?: boolean }) => void): Search {
  const modal = document.createElement("div");
  modal.id = "search-modal";
  modal.className = "modal";
  modal.hidden = true;
  setHTML(modal, html`<div class="modal-box" role="dialog" aria-label="Search">
      <label class="search-field">${icon("search", { size: 20 })}<input id="search-input" type="search" placeholder="${PLACEHOLDER}" autocomplete="off" aria-label="Search" /></label>
      <ul id="search-results" class="search-results"></ul>
      <footer class="search-hints" aria-hidden="true">${HINTS}</footer>
    </div>`);
  host.append(modal);
  const box = modal.querySelector<HTMLElement>(".modal-box")!;
  const input = modal.querySelector<HTMLInputElement>("#search-input")!;
  const results = modal.querySelector<HTMLElement>("#search-results")!;
  const hints = modal.querySelector<HTMLElement>(".search-hints")!;
  let sel = 0;
  /** Opened from the "+" picker: Ctrl+Enter opens in a new tab too. */
  let newTabOnly = false;

  function open(o?: { newTabOnly?: boolean }) {
    newTabOnly = !!o?.newTabOnly;
    modal.hidden = false;
    setHTML(hints, newTabOnly ? NEW_TAB_HINTS : HINTS);
    input.value = "";
    results.replaceChildren();
    input.focus();
  }
  function close() {
    modal.hidden = true;
  }

  function doSearch() {
    const q = input.value.trim();
    if (!q) {
      results.replaceChildren();
      return;
    }
    {
      const low = q.toLowerCase();
      const tools = TOOLS().filter((t) => t.title.toLowerCase().includes(low)).map(
        (t) => html`<a href="#/play/${t.id}">${icon(t.icon, { size: 16 })}<span class="sr-body">
        <strong>${markMatches(t.title, q)}</strong> <span class="muted">${t.id === "settings" ? "Settings" : "Play tool"}</span><span class="snip">${t.blurb}</span></span></a>`,
      );
      const hits = searchLibrary(q)
        .slice(0, 30)
        .map(
          (h) => html`<a href="#/s/${encodeURIComponent(h.id)}">${icon(resultIcon(h.id), { size: 16 })}<span class="sr-body">
        <strong>${markMatches(h.title, q)}</strong> <span class="muted">${(books.get(h.book)?.title ?? h.book)}</span>
        <span class="snip">${snippet(h.id, q)}</span></span></a>`,
        );
      // a table code of a locked book finds its place (never its title)
      const target = /^[A-Z][A-Z0-9]{1,9}$/i.test(q) ? codeTarget(q) : undefined;
      const c = target ? getContent(target) : undefined;
      const locked = c && !c.ok
        ? [html`<a href="#/s/${encodeURIComponent(target!)}">${icon("key-round", { size: 16 })}<span class="sr-body"><strong>${lockedLabel(c.locked)}</strong> <span class="muted">${q.toUpperCase()} · locked</span></span></a>`]
        : [];
      const rows = [...tools, ...locked, ...hits];
      sel = 0;
      setHTML(results, rows.length ? html`${rows.map((a, i) => html`<li class="${i === 0 ? "sel" : ""}">${a}</li>`)}` : html`<li class="muted empty">No results</li>`);
    }
  }
  function moveSel(d: number) {
    const items = [...results.querySelectorAll("li a")];
    if (!items.length) return;
    items[sel]?.parentElement?.classList.remove("sel");
    sel = (sel + d + items.length) % items.length;
    items[sel].parentElement!.classList.add("sel");
    items[sel].scrollIntoView({ block: "nearest" });
  }
  /** Open a result's route. */
  function choose(a: HTMLAnchorElement, newTab: boolean) {
    close();
    openRoute(a.getAttribute("href")!, { newTab });
  }
  input.addEventListener("input", doSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (moveSel(1), e.preventDefault());
    else if (e.key === "ArrowUp") (moveSel(-1), e.preventDefault());
    else if (e.key === "Enter") {
      const a = results.querySelectorAll<HTMLAnchorElement>("li a")[sel];
      if (a) choose(a, newTabOnly || !(e.ctrlKey || e.metaKey));
    } else if (e.key === "Escape") close();
  });
  results.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a");
    if (!a) return;
    e.preventDefault(); // a plain hash navigation would replace the current tab
    choose(a, true);
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "/" && !isTypingTarget(e.target)) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      open();
    }
  });
  return { open, close, isOpen: () => !modal.hidden };
}
