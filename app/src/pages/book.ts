// A book section page: rendered text and tables, Fix mode, bookmark, backlinks, table rolls.
import type { Section, Table } from "../types";
import type { ToolContext } from "../shell/shell";
import { blockText, books, byId, inline, lib, termRe, termTarget } from "../library";
import { html, setHTML, type Raw } from "../ui/html";
import { rollColumns } from "../dice";
import { exportFixes, getFixes, saveFix, undoFixes, type FixField } from "../fixes";
import { rollOnTable, tableBySection } from "../rolltable";
import { icon } from "../ui/icon";
import { card, eyebrow } from "../ui/components";
import { cardHtml, handleCardClick, logTableRoll } from "../shell/panels/results";
import { parseRoute } from "../shell/routes";
import { store } from "./store";
import { bookInfo, getContent } from "../content";
import { NO_PICTURE, cellBox, cropCanvas, pageUrl } from "../lock/pageimg";
import { lockedCard, lockedLabel } from "../ui/locked";

/** Attributes that mark a field the importer could not verify (OCR output: it opens a crop of the saved page). */
// Ids are scoped per render: every open tab keeps its section in the DOM. P is set for the length of a
// synchronous render (renderBlocks, draw).
let renders = 0;
let P = "r0-";
const nextPrefix = () => `r${++renders}-`;
const flagged = (un: ReadonlySet<string> | undefined, key: string, cls = ""): Raw | "" =>
  un?.has(key) ? html` class="${cls ? cls + " " : ""}unverified" data-crop="${key}" aria-describedby="${P}desc"` : cls ? html` class="${cls}"` : "";
/** The real button inside a flagged element (keyboard and screen readers; the element keeps its own role). */
const flagBtn = (un: ReadonlySet<string> | undefined, key: string): Raw | "" =>
  un?.has(key) ? html`<button type="button" class="unverified-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Compare with the page">${icon("image", { size: 14 })}</button>` : "";
/** Where the crop popover goes: a table cell gets a row of its own after its row, anything else follows the element. */
export const popHost = (tag: string): "row" | "body-top" | "li" | "after" =>
  tag === "TD" ? "row" : tag === "TH" ? "body-top" : tag === "LI" ? "li" : "after";

/**
 * Headings and column headers are named from their content, which would include the button. A flagged one is
 * named by a span holding exactly its text instead (aria-labelledby), and the button sits beside the span.
 */
const nameId = (key: string) => `${P}uv-${key.replace(/[^\w-]/g, "_")}`;
const namedAttr = (un: ReadonlySet<string> | undefined, key: string): Raw | "" => (un?.has(key) ? html` aria-labelledby="${nameId(key)}"` : "");
const namedInner = (un: ReadonlySet<string> | undefined, key: string, inner: Raw): Raw =>
  un?.has(key) ? html`<span id="${nameId(key)}">${inner}</span>${flagBtn(un, key)}` : inner;

const ed = (b: number, f: FixField, r?: number, c?: number) => html`contenteditable="true" spellcheck="false" data-fix="${b}|${f}|${r ?? ""}|${c ?? ""}"`;

function renderTable(t: Table, selfId: string, idx: number, edit = false, un?: ReadonlySet<string>): Raw {
  const h: Raw[] = [];
  if (edit) {
    h.push(html`<figure class="table-wrap editing">`);
    if (t.intro !== undefined && t.intro !== null) h.push(html`<p class="intro" ${ed(idx, "intro")}>${t.intro}</p>`);
    h.push(html`<div class="scroll"><table><thead><tr>${t.columns.map((c, ci) => html`<th ${ed(idx, "col", undefined, ci)}>${c}</th>`)}</tr></thead><tbody>`);
    t.rows.forEach((r, ri) => h.push(html`<tr>${r.map((c, ci) => html`<td ${ed(idx, "cell", ri, ci)}>${c}</td>`)}</tr>`));
    h.push(html`</tbody></table></div>`);
    if (t.notes !== undefined && t.notes !== null) h.push(html`<p class="notes" ${ed(idx, "notes")}>${t.notes}</p>`);
    return html`${h}</figure>`;
  }
  const rcs = t.dice ? rollColumns(t.rows) : [];
  const rollable = rcs.length > 0;
  h.push(html`<figure class="table-wrap" data-idx="${idx}" ${rollable ? html`data-dice="${t.dice!}" data-rc="${rcs.join(",")}"` : ""}>`);
  if (t.title && t.continued) h.push(html`<figcaption${flagged(un, `${idx}:title`)}>${t.title} <span class="muted">(continued)</span>${flagBtn(un, `${idx}:title`)}</figcaption>`);
  const code = t.code;
  // header: code chip and the dice badge (which is the Roll button when the table can be rolled)
  if (t.dice || rollable || code)
    h.push(html`<div class="table-tools">${code ? html`<span class="code-chip">${code}</span>` : ""}${
      rollable
        ? html`<button type="button" class="dice-badge roll-btn" data-roll="${idx}" title="Roll ${t.dice!} on this table" aria-label="Roll ${t.dice!} on this table">${icon("dice", { size: 16 })}<span>${t.dice!}</span></button>`
        : t.dice ? html`<span class="dice-badge is-static">${t.dice}</span>` : ""
    }</div>`);
  if (t.intro) h.push(html`<p${flagged(un, `${idx}:intro`, "intro")}>${inline(t.intro, selfId)}${flagBtn(un, `${idx}:intro`)}</p>`);
  h.push(html`<div class="scroll"><table><thead><tr>${t.columns.map((c, ci) => html`<th${flagged(un, `${idx}:-1:${ci}`)}${namedAttr(un, `${idx}:-1:${ci}`)}>${namedInner(un, `${idx}:-1:${ci}`, inline(c, selfId))}</th>`)}</tr></thead><tbody>`);
  t.rows.forEach((r, ri) => h.push(html`<tr>${r.map((c, ci) => html`<td${flagged(un, `${idx}:${ri}:${ci}`)}>${inline(c, selfId)}${flagBtn(un, `${idx}:${ri}:${ci}`)}</td>`)}</tr>`));
  if (t.blank_rows) h.push(html`<tr><td colspan="${t.columns.length}" class="muted">+ ${t.blank_rows} blank rows</td></tr>`);
  h.push(html`</tbody></table></div>`);
  if (t.notes) h.push(html`<p${flagged(un, `${idx}:notes`, "notes")}>${inline(t.notes, selfId)}${flagBtn(un, `${idx}:notes`)}</p>`);
  return html`${h}</figure>`;
}

export function renderBlocks(s: Section, edit = false, un?: ReadonlySet<string>, prefix?: string): Raw {
  P = prefix ?? nextPrefix();
  if (edit)
    return html`${s.blocks.map((b, i) =>
      b.type === "para" ? html`<p ${ed(i, "text")}>${b.text}</p>`
      : b.type === "heading" ? html`<h3 ${ed(i, "text")}>${b.text}</h3>`
      : b.type === "table" ? renderTable(b.table, s.id, i, true)
      : html`<p class="muted">[page ${b.page} image]</p>`,
    )}`;
  const h: Raw[] = un?.size ? [html`<span id="${P}desc" hidden>Not verified: compare with the page</span>`] : [];
  let listOpen = false;
  s.blocks.forEach((b, i) => {
    const isItem = b.type === "para" && /^[-•]\s/.test(b.text);
    if (listOpen && !isItem) {
      h.push(html`</ul>`);
      listOpen = false;
    }
    if (b.type === "para") {
      if (isItem) {
        if (!listOpen) {
          h.push(html`<ul>`);
          listOpen = true;
        }
        h.push(html`<li${flagged(un, `${i}:para`)}>${inline(b.text.replace(/^[-•]\s/, ""), s.id)}${flagBtn(un, `${i}:para`)}</li>`);
      } else h.push(html`<p${flagged(un, `${i}:para`)}>${inline(b.text, s.id)}${flagBtn(un, `${i}:para`)}</p>`);
    } else if (b.type === "heading") h.push(html`<h3${flagged(un, `${i}:heading`)}${namedAttr(un, `${i}:heading`)}>${namedInner(un, `${i}:heading`, inline(b.text, s.id))}</h3>`);
    else if (b.type === "table") h.push(renderTable(b.table, s.id, i, false, un));
    else if (b.type === "image")
      h.push(html`<figure class="page-img card"><figcaption class="muted">Page ${b.page} – not yet transcribed, showing the original page</figcaption><img loading="lazy" ${b.src ? html`src="${b.src}"` : html`data-pg="${s.book}/${b.page}"`} alt="Page ${b.page}"></figure>`);
  });
  if (listOpen) h.push(html`</ul>`);
  return html`${h}`;
}

function backlinks(s: Section): Raw | "" {
  if (!termRe) return "";
  const myTerms = [...termTarget.entries()].filter(([, id]) => id === s.id).map(([t]) => t);
  if (!myTerms.length) return "";
  const refs = lib.sections.filter(
    (x) => x.id !== s.id && x.blocks.some((b) => { const t = blockText(b).toLowerCase(); return myTerms.some((m) => t.includes(m)); }),
  ).slice(0, 20);
  if (!refs.length) return "";
  return card(
    html`<details class="backlinks"><summary>${icon("chevron-right", { size: 16 })}<span>Referenced by ${refs.length}${refs.length === 20 ? "+" : ""} sections</span></summary><ul>${refs
      .map((r) => html`<li><a href="#/s/${encodeURIComponent(r.id)}">${r.title}</a><span class="muted">${books.get(r.book)!.title}</span></li>`)}</ul></details>`,
  );
}

/** Scroll to and flash the first element in the article whose text contains `term`. */
export function findInContent(root: HTMLElement, term: string): boolean {
  const t = term.toLowerCase();
  const els = [...root.querySelectorAll<HTMLElement>("article td, article th, article p, article h3")].filter((el) => !el.closest(".unverified-row, .crop-pop"));
  const hit = els.find((el) => el.textContent?.toLowerCase().includes(t));
  if (!hit) return false;
  setTimeout(() => {
    hit.scrollIntoView({ block: "center" });
    hit.classList.add("flash");
    setTimeout(() => hit.classList.remove("flash"), 2500);
  }, 50);
  return true;
}

/** Redraw the result boxes under the tables from the Results store (a box whose card is gone is removed). */
function refreshTableResults(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".table-result").forEach((box) => {
    const h = box.dataset.root ? cardHtml(box.dataset.root) : "";
    if (h) setHTML(box, h);
    else box.remove();
  });
}

/** The card for this table's latest roll, shown under the table (replaced on each roll). */
function showTableResult(fig: HTMLElement, id: string) {
  let box = fig.querySelector<HTMLElement>(":scope > .table-result");
  if (!box) {
    box = document.createElement("div");
    box.className = "table-result";
    box.setAttribute("aria-live", "polite");
    fig.append(box);
  }
  box.dataset.root = id;
  setHTML(box, html`${cardHtml(id)}`);
}

async function rollTable(s: Section, btn: HTMLButtonElement, ctx: ToolContext) {
  const fig = btn.closest<HTMLElement>("figure")!;
  const block = s.blocks[+fig.dataset.idx!];
  if (!block || block.type !== "table") return;
  const ref = tableBySection(s.id) && tableBySection(s.id)!.table === block.table
    ? tableBySection(s.id)!
    : { key: s.id, sectionId: s.id, title: block.table.title || s.title, table: block.table };
  btn.disabled = true;
  try {
    const r = await rollOnTable(ref);
    fig.querySelectorAll(".hit").forEach((el) => el.classList.remove("hit"));
    const tr = fig.querySelectorAll<HTMLTableRowElement>("tbody tr")[r.rowIndex];
    if (tr) {
      const rcs = fig.dataset.rc!.split(",").map(Number);
      if (rcs.length > 1) {
        // side-by-side layout: highlight just this half of the row
        const start = rcs[r.half], end = rcs[r.half + 1] ?? tr.cells.length;
        for (let c = start; c < end; c++) tr.cells[c].classList.add("hit");
      } else tr.classList.add("hit");
      tr.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const c = logTableRoll(r);
    showTableResult(fig, c.id);
  } finally {
    btn.disabled = false;
  }
}

/**
 * Fill the saved-page images (data-pg="book/page") of a drawn page from the device store; one that is missing goes.
 * Images inside the closed "Show original page" details wait until it opens.
 */
function hydratePages(root: HTMLElement, book: string): void {
  const fill = (img: HTMLImageElement) => {
    if (img.getAttribute("src") || img.dataset.busy) return;
    img.dataset.busy = "1";
    const page = Number(img.dataset.pg!.slice(img.dataset.pg!.lastIndexOf("/") + 1));
    void pageUrl(book, page).then((u) => {
      if (!img.isConnected) return;
      if (u) img.src = u;
      else img.replaceWith(Object.assign(document.createElement("p"), { className: "muted", textContent: `Page ${page} has no saved image.` }));
    });
  };
  root.querySelectorAll<HTMLImageElement>("img[data-pg]").forEach((img) => {
    const d = img.closest<HTMLDetailsElement>("details.orig");
    if (!d || d.open) return fill(img);
    d.addEventListener("toggle", () => d.open && d.querySelectorAll<HTMLImageElement>("img[data-pg]").forEach(fill), { once: true });
  });
}

/** What the page header's Page tools menu can do on a section page (one per rendered page). */
export interface BookControls {
  marked(): boolean;
  toggleBookmark(): void;
  hasOriginal(): boolean;
  showOriginal(): void;
  fixMode(): boolean;
  toggleFix(): void;
  /** Scroll to and flash the first match; false when nothing matches. */
  find(term: string): boolean;
}
const controlsByRoot = new WeakMap<HTMLElement, BookControls>();
/** The controls of the section page rendered into `root`, if it is one. */
export const bookControls = (root: HTMLElement): BookControls | undefined => controlsByRoot.get(root);

/** Render the section named by `route` ("#/s/<id>[?find=…]") into `root`. */
export function render(root: HTMLElement, ctx: ToolContext, route: string) {
  const r = parseRoute(route);
  const id = r.kind === "section" ? r.id : "";
  const c = getContent(id);
  if (c && !c.ok) {
    // a section of a book the owner hasn't unlocked: its place, never its title or text
    setHTML(root, html`<div class="book-page"><header class="book-head">${eyebrow(c.locked.bookName)}<h1 class="page-title">${lockedLabel(c.locked)}</h1></header>${lockedCard(c.locked)}</div>`);
    return;
  }
  const s = byId.get(id);
  if (!s) {
    setHTML(root, html`<div class="book-page"><header class="book-head">${eyebrow("Library")}<h1 class="page-title">Section not found</h1></header><p class="muted">There is no section “${id}” in the library.</p><p><a href="#/">Back to Home</a></p></div>`);
    return;
  }
  const un = c?.ok ? c.unverified : undefined;
  // an unlocked book's page images are the ones saved on this device (object URLs); Core keeps its shipped scans
  const saved = bookInfo(s.book).unlocked && !bookInfo(s.book).free;
  let editMode = false;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

  const draw = () => {
    const book = books.get(s.book)!;
    const all = lib.sections.filter((x) => x.book === s.book);
    const i = all.indexOf(s);
    const prev = all[i - 1], next = all[i + 1];
    const kids = s.level === 2 ? all.filter((x) => x.chapter === s.id) : [];
    const imgs = saved ? s.pages : s.pages.filter((p) => book.page_images.includes(p));
    // sections with no text (e.g. Contents) just show the book's pages
    const pictureOnly = !s.blocks.length && imgs.length > 0;

    const nFix = getFixes().length;
    const fixBanner = card(
      html`<div class="fix-banner">${icon("pencil", { size: 18 })}<span class="fix-text"><strong>Fixing text.</strong> Tap any text to correct it, then tap elsewhere to save.
        <span class="muted">${nFix} fix${nFix === 1 ? "" : "es"} saved on this device.</span></span>
        <span class="fix-actions"><button type="button" class="btn btn-sm btn-ghost" id="fix-export">${icon("download", { size: 15 })}<span>Export fixes</span></button>
        ${getFixes().some((f) => f.s === s.id) ? html`<button type="button" class="btn btn-sm btn-ghost" id="fix-undo">${icon("rotate-ccw", { size: 15 })}<span>Undo this page's fixes</span></button>` : ""}
        <button type="button" class="btn btn-sm btn-primary" id="fix-done">${icon("check", { size: 15 })}<span>Done</span></button></span></div>`,
      { tone: "accent" },
    );
    const scan = (p: number, lazy = true) => html`<img${lazy ? html` loading="lazy"` : ""} ${saved ? html`data-pg="${s.book}/${p}"` : html`src="pages/${s.book}/p${String(p).padStart(3, "0")}.jpg"`} alt="Page ${p}">`;

    const pre = nextPrefix();
    P = pre;
    const titleUn = editMode || pictureOnly ? undefined : un;  // its description node lives in the article
    setHTML(root, html`<div class="book-page${editMode ? " is-fixing" : ""}">
    <header class="book-head">
      ${eyebrow(book.title)}
      <h1${flagged(titleUn, "-1:title", "page-title")}${namedAttr(titleUn, "-1:title")}>${namedInner(titleUn, "-1:title", html`${s.title}`)}</h1>
      <p class="source">Source: ${book.title}, p.${s.pages.join(", ")}</p>
    </header>
    ${editMode ? html`${fixBanner}
      <div class="fix-layout ${imgs.length ? "" : "no-scan"}"><article>${renderBlocks(s, true)}</article>
        ${imgs.length ? html`<aside class="fix-scan card">${imgs.map((p) => html`<figure><figcaption class="muted">Page ${p}</figcaption>${scan(p, false)}</figure>`)}</aside>` : html`<p class="muted fix-note">This page was real text in the PDF, so there's no scan to compare against.</p>`}</div>`
    : pictureOnly
      ? html`<article class="scan-only">${imgs.map((p) => html`<figure class="page-img card"><figcaption class="muted">Page ${p}</figcaption>${scan(p)}</figure>`)}</article>`
      : html`<article>${renderBlocks(s, false, un, pre)}</article>`}
    ${kids.length ? html`<h2 class="sub">In this chapter</h2><ul class="kids">${kids.map((k) => html`<li><a href="#/s/${encodeURIComponent(k.id)}">${k.title}</a></li>`)}</ul>` : ""}
    ${imgs.length && !pictureOnly && !s.blocks.some((b) => b.type === "image") ? card(html`<details class="orig"><summary>${icon("image", { size: 16 })}<span>Show original page${imgs.length > 1 ? "s" : ""}</span></summary>${imgs
      .map((p) => scan(p))}</details>`) : ""}
    ${backlinks(s)}
    <nav class="page-links" aria-label="Previous and next section">${prev ? html`<a href="#/s/${encodeURIComponent(prev.id)}" rel="prev">${icon("chevron-left", { size: 16 })}<span>${prev.title}</span></a>` : html`<span></span>`}${
      next ? html`<a href="#/s/${encodeURIComponent(next.id)}" rel="next"><span>${next.title}</span>${icon("chevron-right", { size: 16 })}</a>` : ""
    }</nav></div>`);
    if (editMode) {
      $("#fix-done").onclick = () => {
        editMode = false;
        draw();
      };
      $("#fix-export").onclick = () => exportFixes();
      const undo = root.querySelector<HTMLButtonElement>("#fix-undo");
      if (undo) undo.onclick = () => {
        if (!confirm("Undo every fix on this page?")) return;
        try {
          undoFixes(s);
        } catch (e) {
          return void ctx.toast(e instanceof Error ? e.message : "Couldn't save: storage is full");
        }
        draw();
      };
      root.querySelectorAll<HTMLElement>("[data-fix]").forEach((el) => {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            el.blur();
          }
        });
        el.addEventListener("blur", () => {
          const [b, f, r, c] = el.dataset.fix!.split("|");
          const target = { b: +b, f: f as FixField, r: r === "" ? undefined : +r, c: c === "" ? undefined : +c };
          const to = el.innerText.replace(/\s+/g, " ").trim();
          const before = getFixes().length;
          let n: number;
          try {
            n = saveFix(s, target, to);
          } catch (e) {
            ctx.toast(e instanceof Error ? e.message : "Couldn't save: storage is full");
            return;
          }
          if (n !== before || el.dataset.saved !== to) {
            el.classList.add("fixed");
            el.dataset.saved = to;
            const banner = root.querySelector(".fix-banner .muted");
            if (banner) banner.textContent = `${n} fix${n === 1 ? "" : "es"} saved on this device.`;
          }
        });
      });
    }
    hydratePages(root, s.book);
    root.querySelectorAll<HTMLButtonElement>(".roll-btn").forEach((btn) => (btn.onclick = () => rollTable(s, btn, ctx)));
  };
  // unverified fields: tap one (or its button, by keyboard) to check it against the saved page image, in place;
  // Escape closes it and returns to the button. A link inside the field still just follows the link.
  const closePop = (refocus = false) => {
    const pop = root.querySelector<HTMLElement>(".crop-pop");
    if (!pop) return;
    const from = pop.dataset.from;
    (pop.closest(".unverified-row") ?? pop).remove();
    const btn = from ? root.querySelector<HTMLElement>(`[data-crop="${CSS.escape(from)}"] > .unverified-btn`) : null;
    btn?.setAttribute("aria-expanded", "false");
    if (refocus) btn?.focus();
  };
  const openPop = async (el: HTMLElement) => {
    const key = el.dataset.crop!;
    closePop();
    const pop = document.createElement("div");
    pop.className = "crop-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Saved page image of this text");
    pop.dataset.from = key;
    pop.tabIndex = -1;
    setHTML(pop, html`<p class="muted">Not verified against the book. Compare it with the page:</p><div class="crop-body muted">Loading…</div>`);
    const where = popHost(el.tagName), tr = el.closest("tr");
    if (where === "li") {
      const li = document.createElement("li");                 // a div may not be a child of a ul/ol
      li.className = "unverified-row";
      li.append(pop);
      el.after(li);
    } else if ((where === "row" || where === "body-top") && tr) {
      const row = document.createElement("tr");
      row.className = "unverified-row";
      const td = row.appendChild(document.createElement("td"));
      td.colSpan = tr.cells.length;
      td.append(pop);
      const body = tr.closest("table")?.tBodies[0];
      if (where === "body-top" && body) body.prepend(row);     // a header cell's row goes in tbody, never thead
      else tr.after(row);
    } else el.after(pop);
    el.querySelector(":scope > .unverified-btn")?.setAttribute("aria-expanded", "true");
    const body = pop.querySelector<HTMLElement>(".crop-body")!;
    const loc = cellBox(s.id, key);
    const canvas = loc ? await cropCanvas(s.book, loc.page, loc.box) : undefined;
    if (!pop.isConnected) return;
    if (canvas) {
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Cropped page image of the cell");
      body.replaceChildren(canvas);
      body.classList.remove("muted");
    } else body.textContent = NO_PICTURE;
    pop.focus();
  };
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const cell = t.closest<HTMLElement>(".unverified[data-crop]");
    if (cell && !t.closest("a") && !t.closest(".crop-pop")) return void openPop(cell);
    if (!t.closest(".crop-pop") && !t.closest("a")) closePop();
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.querySelector(".crop-pop")) {
      e.stopPropagation();
      closePop(true);
    }
  });
  // follow-ons, → Notes and table links on the cards under the tables
  root.addEventListener("click", async (e) => {
    const box = (e.target as HTMLElement).closest<HTMLElement>(".table-result");
    if (!box) return;
    await handleCardClick(e, { openTab: (route) => ctx.openTab(route), toast: ctx.toast });
  });
  // keep the boxes current: follow-ons rolled here or in Results nest into them, Clear empties them
  ctx.onDispose(ctx.events.on("roll", () => refreshTableResults(root)));
  ctx.onDispose(ctx.events.on("results:cleared", () => refreshTableResults(root)));

  const marked = () => store.list("bookmarks").includes(id);
  controlsByRoot.set(root, {
    marked,
    toggleBookmark() {
      const set = new Set(store.list("bookmarks"));
      const on = !set.has(id);
      on ? set.add(id) : set.delete(id);
      store.set("bookmarks", [...set]);
      ctx.events.emit("bookmarks:changed", { source: "book" });
      ctx.toast(on ? `Bookmarked “${s.title}”` : "Bookmark removed");
    },
    hasOriginal: () => !!root.querySelector("details.orig"),
    showOriginal() {
      const d = root.querySelector<HTMLDetailsElement>("details.orig");
      if (!d) return;
      d.open = true;
      d.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    fixMode: () => editMode,
    toggleFix() {
      editMode = !editMode;
      draw();
    },
    find: (term) => findInContent(root, term),
  });
  ctx.onDispose(() => controlsByRoot.delete(root));

  draw();
  const recent = store.list("recent").filter((x) => x !== id);
  store.set("recent", [id, ...recent].slice(0, 12));
  if (r.kind === "section" && r.find) findInContent(root, r.find);
}
