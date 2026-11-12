// The rulebook library, built on the content gateway (content.ts) from the free and unlocked
// sections only: cross-link terms, full-text search, inline text formatting.
import MiniSearch from "minisearch";
import type { Block, Book, Library, Section } from "./types";
import { diceFaces } from "./dice";
import { esc, html, raw, type Raw } from "./ui/html";
import { bookInfo, freeBooks, getContent, initContent, isLocked, manifest, onContentChange, refreshFixes, sectionIds } from "./content";
import { remapLegacy } from "./lock/legacy";
import { getBooks } from "./lock/store";
import { bus } from "./shell/events";
import { indexTables } from "./rolltable";
import { isVoid } from "./games";

export const lib: Library = { books: [], sections: [] };
export const byId = new Map<string, Section>();
export const books = new Map<string, Book>();
let search: MiniSearch | undefined;
export let termRe: RegExp | null = null;
export const termTarget = new Map<string, string>(); // lowercased term -> section id


/** Escape, then apply bold and italic markers, dice glyphs and cross-links to other sections. */
export function inline(s: string, selfId?: string): Raw {
  let h = esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  h = diceFaces(h);
  if (termRe) {
    const seen = new Set<string>();
    // only link outside of tags
    h = h.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag, txt) => {
      if (tag) return tag;
      return txt.replace(termRe!, (t: string) => {
        const id = termTarget.get(t.toLowerCase());
        if (!id || id === selfId || seen.has(id)) return t;
        seen.add(id);
        return `<a class="xref" href="#/s/${encodeURIComponent(id)}">${t}</a>`;
      });
    });
  }
  return raw(h); // audited: the text was escaped first; only fixed tags and #/s/ links were added
}

export function blockText(b: Block): string {
  if (b.type === "para" || b.type === "heading") return b.text;
  if (b.type === "table") {
    const t = b.table;
    return [t.title, t.code, t.intro, t.columns.join(" "), ...t.rows.map((r) => r.join(" ")), t.notes]
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Load the gateway (manifest, free content, unlocked books) and build the library on it. */
export async function loadLibrary(): Promise<void> {
  await initContent();
  rebuildLibrary();
  if (!isVoid()) setTimeout(() => void remapAfterStart(), 0);      // after first paint; never blocks it (Dungeon's books only)
}

/**
 * Remaps old title-slug ids for every unlocked book (one with a BookRecord), so bookmarks, fixes and journal
 * links that arrived after its unlock (a restored backup, pasted fixes) find their sections. Idempotent: ids
 * already remapped no longer match. Remapped fixes are applied at once. Returns the references rewritten; never
 * throws (no storage: nothing to remap).
 */
export async function remapAfterStart(): Promise<number> {
  let moved = 0;
  try {
    for (const b of await getBooks()) moved += await remapLegacy(b.key, b.edition, manifest());
  } catch {
    return moved;
  }
  if (moved) {
    refreshFixes();
    bus.emit("bookmarks:changed", { source: "books" });
    bus.emit("journal:changed", { source: "books" });
  }
  return moved;
}

let subscribed = false;

/**
 * Refill `lib`, `byId`, `books`, the cross-link terms, search and the roll-table index from the
 * free and unlocked sections. Runs again whenever content changes (an import or a lock).
 * `lib` and `byId` are refilled in place, so references held by pages stay current.
 */
export function rebuildLibrary(): void {
  if (!subscribed) {
    subscribed = true;
    onContentChange(rebuildLibrary);
  }
  const sections: Section[] = [];
  for (const id of sectionIds()) {
    const r = getContent(id);
    if (r?.ok) sections.push(r.section);
  }
  const m = manifest();
  // the manifest's books, in its order, that have anything to show (free, unlocked or locked);
  // free.json's entry when it has one (title, page scans), else the manifest's name
  const has = new Set([...sections.map((s) => s.book), ...m.sections.map((s) => s.book)]);
  // (2D6 Void has no manifest: its library file's books, as listed there)
  lib.books = isVoid()
    ? freeBooks().filter((b) => has.has(b.slug))
    : m.books
        .filter((b) => has.has(b.slug))
        .map((b) => freeBooks().find((x) => x.slug === b.slug) ?? { slug: b.slug, title: bookInfo(b.slug).name, missing_pages: [], page_images: [] });
  lib.sections = sections;
  books.clear();
  lib.books.forEach((b) => books.set(b.slug, b));
  byId.clear();
  sections.forEach((s) => byId.set(s.id, s));

  // cross-link terms: table codes + table titles + multi-word chapter titles
  termTarget.clear();
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.type === "table" && b.table.code && b.table.code.length >= 3 && !termTarget.has(b.table.code.toLowerCase()))
        termTarget.set(b.table.code.toLowerCase(), s.id);
    }
    const t = s.title.trim();
    const isTable = s.blocks.some((b) => b.type === "table") && /table|list/i.test(t);
    if ((isTable || (s.level === 2 && t.split(/\s+/).length >= 2)) && t.length >= 6 && t.length < 60) {
      // strip leading code "ENAT1 - " so the plain name links too
      const name = t.replace(/^[A-Z0-9]{2,8}\s*-\s*/, "");
      for (const term of new Set([t, name])) {
        const k = term.toLowerCase();
        if (!termTarget.has(k)) termTarget.set(k, s.id);
      }
    }
  }
  // a code of a locked table links to its locked card
  for (const [code, id] of Object.entries(m.codes))
    if (code.length >= 3 && isLocked(id) && !termTarget.has(code.toLowerCase())) termTarget.set(code.toLowerCase(), id);
  const terms = [...termTarget.keys()].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  termRe = terms.length ? new RegExp(`\\b(${terms.join("|")})\\b`, "gi") : null;

  search = new MiniSearch({
    fields: ["title", "codes", "text"],
    storeFields: ["title", "book"],
    searchOptions: { boost: { title: 4, codes: 6 }, prefix: true, fuzzy: 0.15, combineWith: "AND" },
  });
  search.addAll(
    sections.map((s) => ({
      id: s.id,
      title: s.title,
      book: s.book,
      codes: s.blocks.map((b) => (b.type === "table" ? b.table.code ?? "" : "")).join(" "),
      text: s.blocks.map(blockText).join("\n"),
    })),
  );
  indexTables(sections);
}

/** Sections matching every word (falling back to any word), best first. */
export function searchLibrary(q: string): { id: string; title: string; book: string }[] {
  if (!search) return [];
  let hits = search.search(q);
  if (!hits.length) hits = search.search(q, { combineWith: "OR" });
  return hits.map((h) => ({ id: h.id as string, title: h.title as string, book: h.book as string }));
}

/** A short excerpt of the section around the first query word, with matches <mark>ed. */
export function snippet(id: string, q: string): Raw {
  const s = byId.get(id)!;
  const text = s.blocks.map(blockText).join(" ").replace(/\s+/g, " ");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const low = text.toLowerCase();
  let at = -1;
  for (const w of words) if ((at = low.indexOf(w)) >= 0) break;
  const start = Math.max(0, at - 50);
  const slice = text.slice(start, start + 160);
  const ws = words.filter((w) => w.length > 1).sort((x, y) => y.length - x.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // split on the matches (odd parts), so the text is escaped by html and only the matches are <mark>ed
  const parts = ws.length ? slice.split(new RegExp(`(${ws.join("|")})`, "gi")) : [slice];
  return html`${start > 0 ? "…" : ""}${parts.map((p, i) => (i % 2 ? html`<mark>${p}</mark>` : p))}…`;
}
