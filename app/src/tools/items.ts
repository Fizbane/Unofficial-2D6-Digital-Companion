// Items: every weapon, armour, potion, scroll, magic item, gem, stim, ammo, artefact and piece of gear in the
// books you have open, as a gallery to browse. Search by name, filter by kind and book; a tile opens its details.
import type { ToolContext } from "../main";
import { inline, lib } from "../library";
import { bookLabel as bookLabelOf, onContentChange } from "../content";
import { isVoid } from "../games";
import { button } from "../ui/components";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";
import { openModal, type Modal } from "../ui/modal";
import { itemCardBody } from "../ui/itemcard";
import { loadChar, saveChar } from "./sheet";
import { addToDungeonChar, addToVoidChar } from "./itemrouting";
import { hasVChar, loadVChar, saveVChar } from "./void/sheetmodel";
import { catOf, filterItems, itemBooks, itemCats, itemEntries, noItemFilter, type ItemEntry, type ItemFilter } from "./itemsmodel";

const short = (e: ItemEntry): string => {
  const s = e.text || e.lines.map(([, v]) => v).find((v) => v.length > 12) || e.lines.map(([k, v]) => `${k} ${v}`).slice(0, 2).join(" · ");
  return s.length > 90 ? `${s.slice(0, 88).trimEnd()}…` : s;
};

function tile(e: ItemEntry): Raw {
  const c = catOf(e.cat);
  const sum = short(e);
  return html`<li><button type="button" class="item item-${e.cat}" data-item="${e.key}" aria-label="${e.name}, ${c.label}${e.cost ? `, ${e.cost}` : ""}">
    <span class="item-ico">${icon(c.icon, { size: 22 })}</span>
    <span class="item-main"><span class="item-name">${e.name}</span><span class="item-meta"><span>${c.label}</span>${e.cost ? html`<span class="item-cost">${e.cost}</span>` : ""}</span>${sum ? html`<span class="item-sum">${sum}</span>` : ""}</span>
    <span class="item-book">${bookLabelOf(e.book)}</span>
  </button></li>`;
}

type View = "cards" | "list";
const VIEW_KEY = "2d6:items:view";
const savedView = (): View => { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards"; } catch { return "cards"; } };
const saveView = (v: View) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* not saved */ } };

const chip = (attr: string, value: string, label: string, on: boolean) =>
  html`<button type="button" class="chip beast-chip" data-${attr}="${value}" aria-pressed="${String(on)}">${label}</button>`;

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "beast-page", "items-page");
  const f: ItemFilter = noItemFilter();
  let all: ItemEntry[] = [];
  let modal: Modal | null = null;
  let view: View = savedView();

  const bookLabel = (slug: string) => bookLabelOf(slug);

  const drawList = () => {
    const list = filterItems(all, f);
    root.querySelector<HTMLElement>(".beast-count")!.textContent = list.length === all.length ? `${all.length} items` : `${list.length} of ${all.length} items`;
    root.querySelectorAll<HTMLElement>("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(f.cat === b.dataset.cat)));
    root.querySelectorAll<HTMLElement>("[data-book]").forEach((b) => b.setAttribute("aria-pressed", String(f.book === b.dataset.book)));
    const grid = root.querySelector<HTMLElement>(".items-grid")!;
    grid.classList.toggle("is-list", view === "list");
    root.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(view === b.dataset.view)));
    if (!list.length) return setHTML(grid, html`<li class="beast-none muted">No item matches. Clear a filter or the search.</li>`);
    // grouped under a heading per kind when no kind is chosen
    let last = "";
    setHTML(grid, html`${list.map((e) => {
      const head = !f.cat && e.cat !== last ? html`<li class="items-head" role="presentation">${icon(catOf(e.cat).icon, { size: 16 })} ${catOf(e.cat).label}</li>` : "";
      last = e.cat;
      return html`${head}${tile(e)}`;
    })}`);
  };

  const draw = () => {
    all = itemEntries(lib.sections);
    const cats = itemCats(all), books = itemBooks(all);
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title"><h1>${icon("backpack", { size: 26 })}<span>Items</span></h1></div>
        <div class="play-actions"><span class="beast-count ach-total"></span><div class="view-toggle" role="group" aria-label="View"><button type="button" class="chip beast-chip" data-view="cards" aria-pressed="true" title="Card view">${icon("layout-grid", { size: 16 })} Cards</button><button type="button" class="chip beast-chip" data-view="list" aria-pressed="false" title="List view">${icon("menu", { size: 16 })} List</button></div></div>
      </header>
      ${all.length ? html`
        <div class="beast-tools">
          <input type="search" class="beast-search" placeholder="Search items…" aria-label="Search the items" value="${f.text}">
          <div class="beast-chips" role="group" aria-label="Kind">${cats.map((c) => chip("cat", c, catOf(c).label, f.cat === c))}</div>
          ${books.length > 1 ? html`<div class="beast-chips" role="group" aria-label="Book">${books.map((b) => chip("book", b, bookLabel(b), f.book === b))}</div>` : ""}
        </div>
        <ul class="items-grid"></ul>`
      : html`<p class="card beast-empty">No items are open yet. Unlock a book in Settings → Books to fill this page.</p>`}`);
    if (all.length) drawList();
  };

  const open = (key: string) => {
    const e = all.find((x) => x.key === key);
    if (!e) return;
    modal = openModal({
      labelledBy: "item-title",
      cls: "modal-item",
      body: itemCardBody(e, html`${button("Add to my character", { icon: "plus", attrs: html`data-item-add="${e.key}"` })}${button("Open in the book", { icon: "book-open", variant: "ghost", attrs: html`data-item-open="${e.sectionId}"` })}`),
    });
  };

  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-item]");
    if (b) return open(b.dataset.item!);
    const vw = t.closest<HTMLElement>("[data-view]");
    if (vw) { view = vw.dataset.view === "list" ? "list" : "cards"; saveView(view); return drawList(); }
    const c = t.closest<HTMLElement>("[data-cat]");
    if (c) { f.cat = f.cat === c.dataset.cat ? "" : (c.dataset.cat as ItemFilter["cat"]); return drawList(); }
    const bk = t.closest<HTMLElement>("[data-book]");
    if (bk) { f.book = f.book === bk.dataset.book ? "" : bk.dataset.book!; return drawList(); }
  });
  root.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList.contains("beast-search")) { f.text = t.value; drawList(); }
  });
  const addToCharacter = (key: string) => {
    const e = all.find((x) => x.key === key);
    if (!e) return;
    if (isVoid()) {
      if (!hasVChar()) return ctx.toast("Make a survivor on the Character sheet first.");
      const c = loadVChar();
      const r = addToVoidChar(c, e);
      if (r.ok) saveVChar(c, "items");
      return ctx.toast(r.msg);
    }
    const c = loadChar();
    const r = addToDungeonChar(c, e, ctx.byId);
    if (r.ok) saveChar(c, "items");
    ctx.toast(r.msg);
  };
  const onDoc = (ev: Event) => {
    const a = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-item-add]");
    if (a) return addToCharacter(a.dataset.itemAdd!);
    const o = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-item-open]");
    if (!o) return;
    modal?.close();
    ctx.openTab(`#/s/${o.dataset.itemOpen}`);
  };
  document.addEventListener("click", onDoc);
  ctx.onDispose(() => document.removeEventListener("click", onDoc));

  draw();
  ctx.onDispose(onContentChange(() => draw()));
}
