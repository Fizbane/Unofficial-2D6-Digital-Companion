// Bestiary: every creature, NPC and alien card in the books you have open, as a gallery to browse.
// Search by name, filter by level, type and book; a tile opens the whole card. Read-only.
import type { ToolContext } from "../main";
import { lib } from "../library";
import { bookLabel as bookLabelOf, onContentChange, unlockedRows } from "../content";
import { isVoid } from "../games";
import { renderCard } from "../pages/book";
import { artSrc } from "../ui/art";
import { button } from "../ui/components";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";
import { openModal, type Modal } from "../ui/modal";
import { beastEntries, booksOf, filterBeasts, levelsOf, noFilter, typeLabel, typesOf, type BeastEntry, type BeastFilter } from "./bestiarymodel";

const game = () => (isVoid() ? "void" : "dungeon");

const needsReview = (e: BeastEntry) =>
  [...(unlockedRows(e.sectionId) ?? [])].some((field) => field.startsWith(`${e.idx}:`));

function tile(e: BeastEntry): Raw {
  const src = artSrc(e.name);
  const type = typeLabel(e.type, game());
  const sub = [e.level ? `L${e.level}` : "", type].filter(Boolean).join(" · ");
  return html`<li><button type="button" class="beast" data-beast="${e.key}" aria-label="${e.name}${sub ? `, ${sub}` : ""}">
    <span class="beast-art${src ? "" : " is-blank"}">${src ? html`<img src="${src}" alt="" loading="lazy">` : html`<span class="beast-initial" aria-hidden="true">${e.name.charAt(0)}</span>`}${e.level ? html`<span class="beast-lv">L${e.level}</span>` : ""}</span>
    <span class="beast-name">${e.name}</span>
    <span class="beast-meta">${type ? html`<span>${type}</span>` : ""}<span>HP ${e.hp}</span>${e.xp === null ? html`<span>XP unknown</span>` : e.xp ? html`<span>XP ${e.xp}</span>` : ""}</span>
    ${needsReview(e) ? html`<span class="beast-meta">Needs verification</span>` : ""}
  </button></li>`;
}

const chip = (attr: string, value: string, label: string, on: boolean) =>
  html`<button type="button" class="chip beast-chip" data-${attr}="${value}" aria-pressed="${String(on)}">${label}</button>`;

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "beast-page");
  const f: BeastFilter = noFilter();
  let all: BeastEntry[] = [];
  let modal: Modal | null = null;

  const bookLabel = (slug: string) => bookLabelOf(slug);

  const drawList = () => {
    const list = filterBeasts(all, f);
    const grid = root.querySelector<HTMLElement>(".beast-grid")!;
    const count = root.querySelector<HTMLElement>(".beast-count")!;
    count.textContent = list.length === all.length ? `${all.length} cards` : `${list.length} of ${all.length} cards`;
    setHTML(grid, list.length ? html`${list.map(tile)}` : html`<li class="beast-none muted">No card matches. Clear a filter or the search.</li>`);
    root.querySelectorAll<HTMLElement>("[data-level]").forEach((b) => b.setAttribute("aria-pressed", String(f.level === (b.dataset.level === "" ? null : Number(b.dataset.level)))));
    root.querySelectorAll<HTMLElement>("[data-type]").forEach((b) => b.setAttribute("aria-pressed", String(f.type === b.dataset.type)));
    root.querySelectorAll<HTMLElement>("[data-book]").forEach((b) => b.setAttribute("aria-pressed", String(f.book === b.dataset.book)));
  };

  const draw = () => {
    all = beastEntries(lib.sections);
    const levels = levelsOf(all), types = typesOf(all), books = booksOf(all);
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title"><h1>${icon("skull", { size: 26 })}<span>Bestiary</span></h1></div>
        <div class="play-actions"><span class="beast-count ach-total"></span></div>
      </header>
      ${all.length ? html`
        <div class="beast-tools">
          <input type="search" class="beast-search" placeholder="Search by name…" aria-label="Search the Bestiary" value="${f.text}">
          <div class="beast-chips" role="group" aria-label="Level">${chip("level", "", "All levels", f.level === null)}${levels.filter((l) => l > 0).map((l) => chip("level", String(l), `L${l}`, f.level === l))}</div>
          ${types.length > 1 ? html`<div class="beast-chips" role="group" aria-label="Type">${types.map((t) => chip("type", t, typeLabel(t, game()), f.type === t))}</div>` : ""}
          ${books.length > 1 ? html`<div class="beast-chips" role="group" aria-label="Book">${books.map((b) => chip("book", b, bookLabel(b), f.book === b))}</div>` : ""}
        </div>
        <ul class="beast-grid"></ul>`
      : html`<p class="card beast-empty">No creature cards are open yet. Unlock a book in Settings → Books to fill the Bestiary.</p>`}`);
    if (all.length) drawList();
  };

  const open = (key: string) => {
    const e = all.find((x) => x.key === key);
    if (!e) return;
    const id = "beast-title";
    modal = openModal({
      labelledBy: id,
      cls: "modal-beast",
      body: html`<div class="beast-full"><span id="${id}" class="visually-hidden">${e.name}</span>${needsReview(e) ? html`<p class="warn">This card has unverified fields. Open it in the book to compare with the original page.</p>` : ""}${renderCard(e.table, e.sectionId, e.idx, undefined, `${bookLabel(e.book)} · p. ${e.page}`)}
        <div class="beast-full-actions">${button("Open in the book", { icon: "book-open", variant: "ghost", attrs: html`data-beast-open="${e.sectionId}"` })}</div></div>`,
    });
  };

  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const b = t.closest<HTMLElement>("[data-beast]");
    if (b) return open(b.dataset.beast!);
    const lv = t.closest<HTMLElement>("[data-level]");
    if (lv) { f.level = lv.dataset.level === "" || f.level === Number(lv.dataset.level) ? null : Number(lv.dataset.level); return drawList(); }
    const ty = t.closest<HTMLElement>("[data-type]");
    if (ty) { f.type = f.type === ty.dataset.type ? "" : ty.dataset.type!; return drawList(); }
    const bk = t.closest<HTMLElement>("[data-book]");
    if (bk) { f.book = f.book === bk.dataset.book ? "" : bk.dataset.book!; return drawList(); }
  });
  root.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList.contains("beast-search")) { f.text = t.value; drawList(); }
  });
  // "Open in the book" sits in the modal, outside this page
  const onDoc = (ev: Event) => {
    const o = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-beast-open]");
    if (!o) return;
    modal?.close();
    ctx.openTab(`#/s/${o.dataset.beastOpen}`);
  };
  document.addEventListener("click", onDoc);
  ctx.onDispose(() => document.removeEventListener("click", onDoc));

  draw();
  ctx.onDispose(onContentChange(() => draw())); // a book unlocked or locked
}
