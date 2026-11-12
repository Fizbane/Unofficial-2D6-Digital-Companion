// Claude-assisted import. The to-do file (book-todo.json) names cells by location only and holds no text. The
// owner's own Claude Code reads their PDF and writes book-pack.json; applyPack accepts only rows whose keyed
// hash matches the manifest, exactly as the OCR path does.
import { addUnlocked, getContent, lockGeneration, manifest } from "../content";
import { fieldHash, norm } from "./hash";
import type { Box } from "./manifest";
import { expectedHash, fieldsOf, pageRotation, unlocated, withMarks, type Field } from "./rebuild";
import { getSections, type StoredSection } from "./store";
import { RE, arr, fail, obj, str } from "./validate";

export type TodoScope = "unverified" | "all";

/**
 * A cell to read. `box` is [x0, y0, x1, y1] as fractions (0..1) of the page after rendering it with `rotate`
 * extra degrees clockwise (on top of the page's own rotation), origin top-left; null when the cell could not be
 * located (read it from the page by context). `columns` is set for table cells and column headers.
 */
export interface TodoItem {
  id: string;
  page: number;
  box: Box | null;
  rotate: number;
  kind: "text" | "ocr" | "dice" | null;
  columns: { count: number; index: number } | null;
  dice: string | null;
}
export interface Todo { book: string; edition: string; items: TodoItem[] }
export interface PackItem { id: string; text: string }
export interface Pack { book: string; edition: string; items: PackItem[] }
/** `alreadyVerified`: ids of rows that were not unverified on this device; they are never touched. */
export interface PackResult { accepted: number; mismatched: PackItem[]; unknown: number; alreadyVerified: string[] }

export const MAX_PACK_ITEMS = 50_000;
export const MAX_PACK_TEXT = 2_000;

const idOf = (sectionId: string, f: Field): string => `${sectionId}#${f.field}:${f.block}:${f.row}:${f.col}`;

/** The to-do for an unlocked book: its unverified fields, or every hashed field. Never any text. */
export function makeTodo(book: string, edition: string, scope: TodoScope): Todo {
  const ed = manifest().books.find((b) => b.slug === book)?.editions.find((e) => e.id === edition);
  const items: TodoItem[] = [];
  for (const sk of manifest().sections) {
    if (sk.book !== book) continue;
    const c = lookup(sk.id);
    if (!c) continue;                                              // not stored on this device
    for (const f of fieldsOf(sk)) {
      if (expectedHash(f, edition) === "") continue;
      if (scope === "unverified" && !c.unverified.has(f.key)) continue;
      const table = f.block >= 0 ? sk.blocks[f.block] : undefined;
      const t = table?.type === "table" ? table : undefined;
      const located = !unlocated(f.loc);
      items.push({
        id: idOf(sk.id, f),
        page: f.page,
        box: located ? [...f.loc!.box] as Box : null,
        rotate: ed ? pageRotation(ed, f.page) : 0,
        kind: f.loc?.kind ?? null,
        columns: t && (f.field === "cell" || f.field === "col") ? { count: t.cols, index: f.col } : null,
        dice: t ? t.dice : null,
      });
    }
  }
  return { book, edition, items };
}

// ---------------------------------------------------------------------------------------------- the pack

const PACK_ID = /^[a-z]+\/p[0-9]{1,5}-[0-9]{1,4}#(cell|col|para|heading|title|intro|notes):-?[0-9]{1,5}:-?[0-9]{1,5}:-?[0-9]{1,5}$/;

const item = obj<PackItem>({ id: str(120, PACK_ID), text: str(MAX_PACK_TEXT) });
const packShape = obj<Pack>({ book: str(32, /^[a-z]+$/), edition: str(32, RE.edition), items: arr(item, MAX_PACK_ITEMS) });

/** A Pack from untrusted JSON: exact keys, bounded sizes, a known locked book and edition, ids of that book. */
export const validatePack: (x: unknown) => Pack = (x) => {
  const p = packShape(x, "pack");
  const b = manifest().books.find((k) => k.slug === p.book && !k.free);
  if (!b) fail("pack.book");
  if (!b!.editions.some((e) => e.id === p.edition)) fail("pack.edition");
  p.items.forEach((it, i) => { if (!it.id.startsWith(`${p.book}/`)) fail(`pack.items[${i}].id`); });
  return p;
};

interface Parsed { sectionId: string; field: string; block: number; row: number; col: number }
function parseId(id: string): Parsed | undefined {
  const m = /^(.+)#([a-z]+):(-?\d+):(-?\d+):(-?\d+)$/.exec(id);
  return m ? { sectionId: m[1], field: m[2], block: +m[3], row: +m[4], col: +m[5] } : undefined;
}

/** A stored section's unverified keys, or undefined when it is not unlocked. */
function lookup(id: string): { unverified: ReadonlySet<string> } | undefined {
  const c = getContent(id);
  return c?.ok ? { unverified: c.unverified ?? new Set() } : undefined;
}

/** The section's text with `text` written to field `f`. Marks of a verified para/heading are re-applied. */
function write(st: StoredSection, f: Field, sk: ReturnType<typeof manifest>["sections"][number], text: string, ok: boolean): void {
  const s = st.section;
  if (f.block === -1) {
    s.title = text;
    return;
  }
  const b = s.blocks[f.block];
  const skb = sk.blocks[f.block];
  if (!b || !skb) return;
  if (b.type === "para" || b.type === "heading") {
    const marks = skb.type === "para" || skb.type === "heading" ? skb.marks : undefined;
    b.text = ok && marks?.length ? withMarks(text, marks) : text;
    return;
  }
  if (b.type !== "table") return;
  const t = b.table;
  if (f.field === "cell") {
    if (t.rows[f.row]) t.rows[f.row][f.col] = text;
  } else if (f.field === "col") t.columns[f.col] = text;
  else if (f.field === "title") t.title = text || null;
  else if (f.field === "intro") { if (text) t.intro = text; else delete t.intro; }
  else if (f.field === "notes") { if (text) t.notes = text; else delete t.notes; }
}

/**
 * Checks each item against the manifest's keyed hash for the pack's edition. A match is written and removed
 * from the section's unverified list. A mismatch is returned (not stored) unless its id is in `force`, in which
 * case the text is stored and the row stays unverified. Ids that name no hashed field of a stored section are
 * counted as `unknown`. Stored through addUnlocked, so the gateway, fixes and the UI see the change. `since` is the
 * caller's lockGeneration() from when its operation began (default: this call's start); a Lock after it makes
 * this throw LockedDuringImport, with nothing written.
 */
export async function applyPack(pack: Pack, key: Uint8Array, force: string[] = [], o: { since?: number } = {}): Promise<PackResult> {
  const since = o.since ?? lockGeneration();                      // before the read: a Lock from here on refuses the write
  const forced = new Set(force);
  const stored = new Map((await getSections()).map((s) => [s.section.id, s]));
  const skels = new Map(manifest().sections.filter((s) => s.book === pack.book).map((s) => [s.id, s]));
  const fields = new Map<string, Map<string, Field>>();
  const changed = new Map<string, StoredSection>();
  const out: PackResult = { accepted: 0, mismatched: [], unknown: 0, alreadyVerified: [] };

  for (const it of pack.items) {
    const p = parseId(it.id);
    const sk = p && skels.get(p.sectionId);
    const st = p && stored.get(p.sectionId);
    if (!p || !sk || !st) { out.unknown++; continue; }
    let fm = fields.get(sk.id);
    if (!fm) fields.set(sk.id, (fm = new Map(fieldsOf(sk).map((f) => [idOf(sk.id, f), f]))));
    const f = fm.get(it.id);
    const want = f && expectedHash(f, pack.edition);
    if (!f || !want) { out.unknown++; continue; }
    if (!st.unverified.includes(f.key)) { out.alreadyVerified.push(it.id); continue; }   // never overwrite a verified cell
    const text = it.text.trim();
    const ok = fieldHash(key, f.field, sk.id, f.block, f.row, f.col, text) === want;
    if (!ok && !forced.has(it.id)) { out.mismatched.push({ id: it.id, text: it.text }); continue; }
    let c = changed.get(sk.id);
    if (!c) changed.set(sk.id, (c = structuredClone(st)));
    write(c, f, sk, ok ? norm(text) : text, ok);
    if (ok) { out.accepted++; c.unverified = c.unverified.filter((k) => k !== f.key); }
    else if (!c.unverified.includes(f.key)) c.unverified.push(f.key);
  }
  for (const [id, c] of changed) {
    const sk = skels.get(id)!;
    if (!sk.title) {                                               // the title comes from the first heading or table
      const s = c.section;
      const h = s.blocks.find((b) => b.type === "heading");
      const t = s.blocks.find((b) => b.type === "table");
      s.title = (h && h.type === "heading" && h.text) || (t && t.type === "table" && t.table.title) || "";
    }
  }
  if (changed.size) await addUnlocked([...changed.values()], { since });
  return out;
}
