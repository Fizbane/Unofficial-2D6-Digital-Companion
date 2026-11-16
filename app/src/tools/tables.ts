// Tables: every table in the books you have open. Two views: an index on the left with the tables themselves
// stacked on the right (click an index entry to jump, the index follows your scrolling), or a sortable list.
// Roll a table in place, with a modifier, and see the row that came up. Rolls are logged in Results.
import type { ToolContext } from "../main";
import { inline, lib } from "../library";
import { bookLabel, onContentChange } from "../content";
import { rollColumns } from "../dice";
import { rollAndLog } from "../shell/panels/results";
import type { TableRef, TableRoll } from "../rolltable";
import { button } from "../ui/components";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";
import { openModal, type Modal } from "../ui/modal";
import {
  filterTables, groupTables, noTableFilter, sortTables, tableBooks, tableDice, tableEntries, tableLevels,
  type GroupBy, type SortKey, type TableEntry, type TableFilter,
} from "./tablesmodel";

const STAR_KEY = "2d6:tables:stars";
const SORT_KEY = "2d6:tables:sort";
const VIEW_KEY = "2d6:tables:view";
const GROUP_KEY = "2d6:tables:group";
const loadGroup = (): GroupBy => { try { return localStorage.getItem(GROUP_KEY) === "book" ? "book" : "type"; } catch { return "type"; } };
const saveGroup = (g: GroupBy) => { try { localStorage.setItem(GROUP_KEY, g); } catch { /* not saved */ } };
type View = "index" | "list";
const loadView = (): View => { try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "index"; } catch { return "index"; } };
const saveView = (v: View) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* not saved */ } };
const loadStars = (): Set<string> => {
  try { const v = JSON.parse(localStorage.getItem(STAR_KEY) ?? "[]"); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []); } catch { return new Set(); }
};
const saveStars = (s: Set<string>) => { try { localStorage.setItem(STAR_KEY, JSON.stringify([...s])); } catch { /* not saved */ } };
const loadSort = (): { key: SortKey; dir: 1 | -1 } => {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null");
    if (v && ["title", "code", "dice", "rows", "book", "chapter"].includes(v.key)) return { key: v.key, dir: v.dir === -1 ? -1 : 1 };
  } catch { /* default */ }
  return { key: "title", dir: 1 };
};
const saveSort = (s: { key: SortKey; dir: 1 | -1 }) => { try { localStorage.setItem(SORT_KEY, JSON.stringify(s)); } catch { /* not saved */ } };

const COLS: { key: SortKey; label: string; cls: string }[] = [
  { key: "title", label: "Table", cls: "tb-name" },
  { key: "code", label: "Code", cls: "tb-code" },
  { key: "dice", label: "Dice", cls: "tb-dice" },
  { key: "rows", label: "Rows", cls: "tb-rows" },
  { key: "book", label: "Book", cls: "tb-book" },
  { key: "chapter", label: "Chapter", cls: "tb-chap" },
];

const chip = (attr: string, value: string, label: string, on: boolean) =>
  html`<button type="button" class="chip beast-chip" data-${attr}="${value}" aria-pressed="${String(on)}">${label}</button>`;

const refOf = (e: TableEntry): TableRef => ({ key: e.code || e.sectionId, sectionId: e.sectionId, title: e.title, table: e.table });

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "beast-page", "tables-page");
  const f: TableFilter = noTableFilter();
  let all: TableEntry[] = [];
  let stars = loadStars();
  let sort = loadSort();
  let modal: Modal | null = null;
  let view: View = loadView();
  let group: GroupBy = loadGroup();
  /** The tables left open in the index view; every other page starts collapsed. */
  const expanded = new Set<string>();
  /** The index's groups left open; the rest start collapsed (a search or filter opens them all). */
  const openGroups = new Set<string>();
  const filtering = () => !!(f.text.trim() || f.book || f.dice || f.level !== null || f.starred);
  let stopSpy: (() => void) | null = null;

  const rowHtml = (e: TableEntry): Raw => {
    const on = stars.has(e.key);
    return html`<tr data-key="${e.key}">
      <td class="tb-star"><button type="button" class="tb-starbtn" data-star="${e.key}" aria-pressed="${String(on)}" aria-label="${on ? "Remove from favourites" : "Add to favourites"}: ${e.title}">${icon(on ? "star-filled" : "star", { size: 16 })}</button></td>
      <td class="tb-name"><button type="button" class="tb-open" data-open="${e.key}">${e.title}</button></td>
      <td class="tb-code">${e.code}</td>
      <td class="tb-dice">${e.dice}</td>
      <td class="tb-rows">${e.rows}</td>
      <td class="tb-book">${bookLabel(e.book)}</td>
      <td class="tb-chap">${e.chapter === e.title ? "" : e.chapter}</td>
      <td class="tb-roll">${e.rollable ? button("Roll", { size: "sm", icon: "dice", attrs: html`data-roll-row="${e.key}" aria-label="Roll ${e.title}"` }) : ""}</td>
    </tr>`;
  };

  /** One table's full card, as the modal and the index view's pages both show it. A page (`collapsible`) is a
   *  <details>: its heading is the summary and the rest opens beneath it. */
  const cardInner = (e: TableEntry, titleId: string, collapsible = false): Raw => {
    const t = e.table;
    const on = stars.has(e.key);
    const heading = html`<span class="eyebrow">${bookLabel(e.book)} · p. ${e.page}${e.code ? ` · ${e.code}` : ""}${e.dice ? ` · ${e.dice}` : ""}</span><h3 id="${titleId}">${e.title}</h3>`;
    const rest = html`${t.intro ? html`<p class="table-full-intro">${inline(t.intro)}</p>` : ""}
        ${e.rollable ? html`<div class="table-full-roll">
          <label class="table-full-mod">Modifier <input type="number" class="tb-mod" value="0" step="1" min="-20" max="20" aria-label="Roll modifier"></label>
          ${button("Roll", { icon: "dice", variant: "primary", attrs: html`data-roll-open` })}
          <span class="table-full-result" role="status" aria-live="polite"></span></div>` : ""}
        <div class="table-full-scroll"><table class="table-full-grid">
          <thead><tr>${t.columns.map((c) => html`<th>${c}</th>`)}</tr></thead>
          <tbody>${t.rows.map((r) => html`<tr>${t.columns.map((_c, i) => html`<td>${inline(r[i] ?? "")}</td>`)}</tr>`)}</tbody>
        </table></div>
        ${t.notes ? html`<p class="table-full-notes muted">${inline(t.notes)}</p>` : ""}
        <div class="beast-full-actions">${button(on ? "Favourite" : "Add to favourites", { icon: on ? "star-filled" : "star", variant: "ghost", attrs: html`data-star="${e.key}"` })}${button("Open in the book", { icon: "book-open", variant: "ghost", attrs: html`data-table-book="${e.sectionId}"` })}</div>`;
    return collapsible
      ? html`<summary class="tdoc-sum"><div class="tdoc-sum-text">${heading}<span class="tdoc-sum-result" role="status" aria-live="polite"></span></div><span class="tdoc-sum-side">${e.rollable ? button("Roll", { size: "sm", icon: "dice", attrs: html`data-roll-sum aria-label="Roll ${e.title}"` }) : ""}<span class="tdoc-chev" aria-hidden="true">${icon("chevron-down", { size: 18 })}</span></span></summary><div class="tdoc-body">${rest}</div>`
      : html`<header class="table-full-head"><div>${heading}</div></header>${rest}`;
  };

  /** The headings that open a group: a kind of table, or a book and its chapter. `c` picks the index's or the pages' styling. */
  const heads = (e: TableEntry, prev: TableEntry | undefined, c: "tix" | "tdoc"): Raw => {
    if (group === "type") return !prev || prev.type !== e.type ? html`<h2 class="${c}-book">${e.type}</h2>` : html``;
    const newBook = !prev || prev.book !== e.book;
    const newChap = newBook || prev.chapter !== e.chapter;
    return html`${newBook ? html`<h2 class="${c}-book">${bookLabel(e.book)}</h2>` : ""}${newChap && e.chapter !== e.title ? html`<h3 class="${c}-chap">${e.chapter}</h3>` : ""}`;
  };

  const drawIndex = (found: TableEntry[]) => {
    const nav = root.querySelector<HTMLElement>(".tables-index")!;
    const docs = root.querySelector<HTMLElement>(".tables-docs")!;
    if (!found.length) {
      setHTML(nav, html``);
      return setHTML(docs, html`<p class="beast-none muted">No table matches. Clear a filter or the search.</p>`);
    }
    const list = groupTables(found, group);
    // the index: one collapsible group per kind (or per book), its tables beneath
    const gkey = (e: TableEntry) => (group === "type" ? e.type : e.book);
    const groups: { key: string; items: TableEntry[] }[] = [];
    for (const e of list) {
      const g = groups[groups.length - 1];
      if (g && g.key === gkey(e)) g.items.push(e); else groups.push({ key: gkey(e), items: [e] });
    }
    const link = (e: TableEntry) => html`<button type="button" class="tix-link" data-jump="${e.key}"><span class="tix-name">${e.title}</span>${e.dice ? html`<span class="tix-dice">${e.dice}</span>` : ""}</button>`;
    setHTML(nav, html`${groups.map((g) => html`<details class="tix-group" data-g="${g.key}"${filtering() || openGroups.has(g.key) ? html` open` : ""}><summary class="tix-book"><span>${group === "book" ? bookLabel(g.key) : g.key}</span><span class="tix-count">${g.items.length}</span></summary>${g.items.map((e, i) => html`${group === "book" && (i === 0 || g.items[i - 1].chapter !== e.chapter) && e.chapter !== e.title ? html`<h3 class="tix-chap">${e.chapter}</h3>` : ""}${link(e)}`)}</details>`)}`);
    setHTML(docs, html`${list.map((e, i) => html`${heads(e, list[i - 1], "tdoc")}<details class="table-full tdoc" data-tkey="${e.key}"${expanded.has(e.key) ? html` open` : ""}>${cardInner(e, `tt-${i}`, true)}</details>`)}`);
    watch(nav, docs);
  };

  /** Keep the index entry for the page in view highlighted: the last page whose top has passed the reading line. */
  const watch = (nav: HTMLElement, docs: HTMLElement) => {
    unwatch();
    const arts = [...docs.querySelectorAll<HTMLElement>("details.tdoc")];
    const links = new Map([...nav.querySelectorAll<HTMLElement>(".tix-link")].map((l) => [l.dataset.jump!, l]));
    const paint = () => {
      if (!nav.isConnected) return;
      const line = innerHeight * 0.3;
      let cur = arts[0];
      for (const a of arts) { if (a.getBoundingClientRect().top <= line) cur = a; else break; }
      const link = cur && links.get(cur.dataset.tkey!);
      if (!link || link.classList.contains("is-active")) return;
      nav.querySelectorAll(".tix-link.is-active, .tix-group.has-active").forEach((l) => l.classList.remove("is-active", "has-active"));
      link.classList.add("is-active");
      const grp = link.closest<HTMLDetailsElement>("details.tix-group");
      grp?.classList.add("has-active"); // lit on a collapsed group, so you can see where you are
      const shown = grp?.open !== false;
      const a = (shown ? link : grp!.querySelector("summary")!).getBoundingClientRect(), n = nav.getBoundingClientRect();
      if (a.top < n.top + 40 || a.bottom > n.bottom - 8) nav.scrollTop += a.top - n.top - n.height / 3;
    };
    const onScroll = paint; // cheap: it stops at the first page below the line
    // a scroll does not bubble, so listen in the capture phase for whichever ancestor scrolls
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    stopSpy = () => { window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
    paint();
  };
  const unwatch = () => { stopSpy?.(); stopSpy = null; };

  const drawList = () => {
    const list = filterTables(all, f, stars);
    root.querySelector<HTMLElement>(".beast-count")!.textContent = list.length === all.length ? `${all.length} tables` : `${list.length} of ${all.length} tables`;
    root.querySelectorAll<HTMLElement>("[data-book]").forEach((b) => b.setAttribute("aria-pressed", String(f.book === b.dataset.book)));
    root.querySelectorAll<HTMLElement>("[data-level]").forEach((b) => b.setAttribute("aria-pressed", String(f.level === +b.dataset.level!)));
    root.querySelectorAll<HTMLElement>("[data-dice]").forEach((b) => b.setAttribute("aria-pressed", String(f.dice === b.dataset.dice)));
    root.querySelector("[data-flag=starred]")?.setAttribute("aria-pressed", String(f.starred));
    root.querySelectorAll<HTMLElement>("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(view === b.dataset.view)));
    root.querySelectorAll<HTMLElement>("[data-group]").forEach((b) => b.setAttribute("aria-pressed", String(group === b.dataset.group)));
    root.querySelector<HTMLElement>(".tables-groupby")!.hidden = view !== "index"; // the list is sorted by its columns instead
    root.querySelector<HTMLButtonElement>("[data-random]")!.disabled = !list.some((e) => e.rollable);
    root.querySelector<HTMLElement>(".tables-split")!.hidden = view !== "index";
    root.querySelector<HTMLElement>(".tables-wrap")!.hidden = view !== "list";
    // only the visible view is built
    if (view === "index") {
      setHTML(root.querySelector<HTMLElement>(".tables-body")!, html``);
      return drawIndex(list);
    }
    unwatch();
    setHTML(root.querySelector<HTMLElement>(".tables-index")!, html``);
    setHTML(root.querySelector<HTMLElement>(".tables-docs")!, html``);
    root.querySelectorAll<HTMLElement>("th[data-th]").forEach((th) => {
      const on = th.dataset.th === sort.key;
      th.setAttribute("aria-sort", on ? (sort.dir === 1 ? "ascending" : "descending") : "none");
    });
    const rows = sortTables(list, sort.key, sort.dir);
    setHTML(root.querySelector<HTMLElement>(".tables-body")!, rows.length ? html`${rows.map(rowHtml)}` : html`<tr><td colspan="8" class="beast-none muted">No table matches. Clear a filter or the search.</td></tr>`);
  };

  /** What scrolls the page: the tab's page, or the window. */
  const scroller = (): HTMLElement => root.closest<HTMLElement>(".tab-page") ?? (document.scrollingElement as HTMLElement);
  function showTop() {
    const b = root.querySelector<HTMLElement>(".tables-top");
    if (b) b.hidden = scroller().scrollTop < 400;
  }

  const draw = () => {
    all = tableEntries(lib.sections);
    const books = tableBooks(all), dice = tableDice(all), levels = tableLevels(all);
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title"><h1>${icon("table", { size: 26 })}<span>Tables</span></h1></div>
        <div class="play-actions"><span class="beast-count ach-total"></span><div class="view-toggle" role="group" aria-label="View"><button type="button" class="chip beast-chip" data-view="index" aria-pressed="true" title="Index and tables">${icon("book-open", { size: 16 })} Index</button><button type="button" class="chip beast-chip" data-view="list" aria-pressed="false" title="Sortable list">${icon("menu", { size: 16 })} List</button></div>${button("Roll a random one", { icon: "dice", attrs: html`data-random` })}</div>
      </header>
      ${all.length ? html`
        <div class="beast-tools">
          <input type="search" class="beast-search" placeholder="Search tables, codes and rows…" aria-label="Search the tables" value="${f.text}">
          ${books.length > 1 ? html`<div class="beast-chips" role="group" aria-label="Book">${books.map((b) => chip("book", b, bookLabel(b), f.book === b))}</div>` : ""}
          <div class="beast-chips tables-groupby" role="group" aria-label="Group by"><span class="tb-grouplabel">Group by</span>${chip("group", "type", "Type", group === "type")}${chip("group", "book", "Book", group === "book")}<span class="tb-grouplabel tb-expand-label">Index and tables</span><button type="button" class="chip beast-chip" data-expand="all">Expand all</button><button type="button" class="chip beast-chip" data-expand="none">Collapse all</button></div>
          ${levels.length ? html`<div class="beast-chips" role="group" aria-label="Level">${levels.map((n) => chip("level", String(n), `Level ${n}`, f.level === n))}</div>` : ""}
          <div class="beast-chips" role="group" aria-label="Dice and options">${dice.map((d) => chip("dice", d, d, f.dice === d))}
            <button type="button" class="chip beast-chip" data-flag="starred" aria-pressed="${String(f.starred)}">${icon("star", { size: 14 })} Favourites</button></div>
        </div>
        <div class="tables-split"><nav class="tables-index" aria-label="List of tables"></nav><div class="tables-docs"></div></div>
        <div class="tables-wrap" hidden><table class="tables-grid">
          <thead><tr><th class="tb-star"><span class="visually-hidden">Favourite</span></th>${COLS.map((c) => html`<th class="${c.cls}" data-th="${c.key}" aria-sort="none"><button type="button" class="tb-sort" data-sort="${c.key}">${c.label}<span class="tb-arrow" aria-hidden="true"></span></button></th>`)}<th class="tb-roll"><span class="visually-hidden">Roll</span></th></tr></thead>
          <tbody class="tables-body"></tbody>
        </table></div>`
      : html`<p class="card beast-empty">No tables are open yet. Unlock a book in Settings → Books to fill this page.</p>`}
      <button type="button" class="tables-top" data-top aria-label="Back to the top of the tables" hidden>${icon("arrow-up", { size: 16 })}<span>Top</span></button>`);
    showTop();
    if (all.length) drawList();
  };

  /** Mark the row (or, in a side-by-side table, the half) that came up. */
  const mark = (host: HTMLElement, r: TableRoll) => {
    host.querySelectorAll(".hit").forEach((el) => el.classList.remove("hit"));
    const tr = host.querySelectorAll<HTMLTableRowElement>("tbody tr")[r.rowIndex];
    if (!tr) return;
    const rcs = rollColumns(r.ref.table.rows);
    if (rcs.length > 1) {
      const start = rcs[r.half], end = rcs[r.half + 1] ?? tr.cells.length;
      for (let c = start; c < end; c++) tr.cells[c]?.classList.add("hit");
    } else tr.classList.add("hit");
    tr.scrollIntoView({ block: "nearest" });
  };

  const rollIn = async (e: TableEntry, host: HTMLElement | null, modifier = 0) => {
    const r = await rollAndLog(refOf(e), modifier, undefined, "Tables");
    if (!host) return;
    mark(host, r);
    const cells = r.cells.filter(Boolean).slice(1);
    const text = `${r.roll.label} ${r.roll.text}${r.modifier ? ` ${r.modifier > 0 ? "+" : ""}${r.modifier} → ${r.value}` : ""}${r.clamped ? " (limit of the table)" : ""}${r.rowIndex < 0 ? ": no matching row." : cells.length ? `: ${cells.join(" · ")}` : ""}`;
    const card = host.closest<HTMLElement>(".table-full");
    // the result shows under the heading too, so a collapsed table can be rolled without opening it
    for (const out of card?.querySelectorAll<HTMLElement>(".table-full-result, .tdoc-sum-result") ?? []) out.textContent = text;
  };

  const open = (key: string, thenRoll = false) => {
    const e = all.find((x) => x.key === key);
    if (!e) return;
    modal?.close();
    const id = "table-title";
    modal = openModal({
      labelledBy: id,
      cls: "modal-table",
      body: html`<div class="table-full" data-tkey="${e.key}">${cardInner(e, id)}</div>`,
    });
    if (thenRoll) void rollIn(e, document.querySelector<HTMLElement>(".modal-table .table-full-grid"));
  };

  /** Scroll the index view to a table's page. */
  const jump = (key: string, openIt = true): HTMLDetailsElement | null => {
    const el = [...root.querySelectorAll<HTMLDetailsElement>("details.tdoc")].find((a) => a.dataset.tkey === key) ?? null;
    if (el && openIt) { el.open = true; expanded.add(key); }
    if (el) { // the index follows: open the group that holds it
      const g = [...root.querySelectorAll<HTMLDetailsElement>("details.tix-group")].find((d) => d.querySelector(`[data-jump="${CSS.escape(key)}"]`));
      if (g) { g.open = true; openGroups.add(g.dataset.g!); }
    }
    el?.scrollIntoView({ block: "start" }); // an instant jump: a smooth one across dozens of tables takes seconds
    return el;
  };

  const toggleStar = (key: string) => {
    if (stars.has(key)) stars.delete(key); else stars.add(key);
    saveStars(stars);
    const on = stars.has(key);
    if (f.starred) return drawList(); // the Favourites filter is on: the list itself changes
    // repaint the star buttons in place, so a page you rolled on keeps its result and your place
    for (const b of document.querySelectorAll<HTMLElement>("[data-star]")) {
      if (b.dataset.star !== key) continue;
      if (b.classList.contains("tb-starbtn")) {
        setHTML(b, icon(on ? "star-filled" : "star", { size: 16 }));
        b.setAttribute("aria-pressed", String(on));
      } else setHTML(b, html`${icon(on ? "star-filled" : "star", { size: 17 })}<span>${on ? "Favourite" : "Add to favourites"}</span>`);
    }
  };

  root.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest(".table-full")) return; // a table's own buttons are handled on the document, below
    const vw = t.closest<HTMLElement>("[data-view]");
    if (vw) { view = vw.dataset.view === "list" ? "list" : "index"; saveView(view); return drawList(); }
    if (t.closest("[data-top]")) return scroller().scrollTo({ top: 0 }); // instant: a smooth scroll back over dozens of tables takes seconds
    const ex = t.closest<HTMLElement>("[data-expand]");
    if (ex) {
      const all2 = ex.dataset.expand === "all";
      for (const d of root.querySelectorAll<HTMLDetailsElement>("details.tdoc")) { d.open = all2; if (all2) expanded.add(d.dataset.tkey!); else expanded.delete(d.dataset.tkey!); }
      for (const d of root.querySelectorAll<HTMLDetailsElement>("details.tix-group")) { d.open = all2; if (all2) openGroups.add(d.dataset.g!); else openGroups.delete(d.dataset.g!); }
      return;
    }
    const gr = t.closest<HTMLElement>("[data-group]");
    if (gr) { group = gr.dataset.group === "book" ? "book" : "type"; saveGroup(group); openGroups.clear(); return drawList(); }
    const jp = t.closest<HTMLElement>("[data-jump]");
    if (jp) return void jump(jp.dataset.jump!);
    const o = t.closest<HTMLElement>("[data-open]");
    if (o) return open(o.dataset.open!);
    const rr = t.closest<HTMLElement>("[data-roll-row]");
    if (rr) return open(rr.dataset.rollRow!, true);
    const s = t.closest<HTMLElement>("[data-star]");
    if (s) return toggleStar(s.dataset.star!);
    if (t.closest("[data-random]")) {
      const pool = filterTables(all, f, stars).filter((e) => e.rollable);
      if (!pool.length) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (view === "list") return open(pick.key, true);
      const el = jump(pick.key, false); // index view: scroll to it and show the result under its heading
      if (el) void rollIn(pick, el.querySelector<HTMLElement>(".table-full-grid"));
      return;
    }
    const so = t.closest<HTMLElement>("[data-sort]");
    if (so) {
      const key = so.dataset.sort as SortKey;
      sort = { key, dir: sort.key === key && sort.dir === 1 ? -1 : 1 };
      saveSort(sort);
      return drawList();
    }
    const bk = t.closest<HTMLElement>("[data-book]");
    if (bk) { f.book = f.book === bk.dataset.book ? "" : bk.dataset.book!; return drawList(); }
    const lv = t.closest<HTMLElement>("[data-level]");
    if (lv) { const n = +lv.dataset.level!; f.level = f.level === n ? null : n; return drawList(); }
    const dc = t.closest<HTMLElement>("[data-dice]");
    if (dc) { f.dice = f.dice === dc.dataset.dice ? "" : dc.dataset.dice!; return drawList(); }
    const fl = t.closest<HTMLElement>("[data-flag]");
    if (fl) { f.starred = !f.starred; return drawList(); }
  });
  // a page opened or closed by hand (a toggle does not bubble, so listen in the capture phase)
  root.addEventListener("toggle", (ev) => {
    const d = ev.target as HTMLDetailsElement;
    if (d.classList?.contains("tix-group")) {
      if (filtering()) return; // a search opens every group; that is not the reader's choice to keep
      if (d.open) openGroups.add(d.dataset.g!); else openGroups.delete(d.dataset.g!);
      return;
    }
    if (!d.classList?.contains("tdoc")) return;
    if (d.open) expanded.add(d.dataset.tkey!); else expanded.delete(d.dataset.tkey!);
  }, true);
  root.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList.contains("beast-search")) { f.text = t.value; drawList(); }
  });

  // the modal lives outside the page root
  const onDoc = (ev: Event) => {
    const t = ev.target as HTMLElement;
    const card = t.closest?.<HTMLElement>(".table-full");
    if (!card) return;
    const e = all.find((x) => x.key === card.dataset.tkey);
    if (!e) return;
    if (t.closest("[data-roll-open], [data-roll-sum]")) {
      ev.preventDefault(); // a Roll in the heading must not also open or close the table
      const mod = Math.trunc(+(card.querySelector<HTMLInputElement>(".tb-mod")?.value ?? 0)) || 0;
      void rollIn(e, card.querySelector<HTMLElement>(".table-full-grid"), mod);
      return;
    }
    const s = t.closest<HTMLElement>("[data-star]");
    if (s) return toggleStar(s.dataset.star!);
    const b = t.closest<HTMLElement>("[data-table-book]");
    if (b) { modal?.close(); ctx.openTab(`#/s/${b.dataset.tableBook}`); }
  };
  document.addEventListener("click", onDoc);
  ctx.onDispose(() => { document.removeEventListener("click", onDoc); modal?.close(); unwatch(); });

  draw();
  ctx.onDispose(onContentChange(() => draw()));
  // the "Top" button shows once you have scrolled a screen or so down
  window.addEventListener("scroll", showTop, { capture: true, passive: true });
  ctx.onDispose(() => window.removeEventListener("scroll", showTop, true));
}
