// Pure skeleton logic shared by the browser importer and the locator: page rotation, the hashed fields of a
// locked section (where each one is and where its hash lives), section rebuilding and row coverage.
// No pdf.js, Tesseract or DOM imports, so the UI can use it too.
import type { HashField } from "./hash";
import type { Box, Edition, Hashes, Loc, SkelSection } from "./manifest";
import type { Block, Section, Table } from "../types";
import type { StoredSection } from "./store";

const deg = (r: number) => ((r % 360) + 360) % 360;

/**
 * A box in an edition page as displayed after an extra clockwise rotation of `rot` degrees (the reference
 * frame), from the same box on the page as displayed without it. pdf.js rotates clockwise: a point (u, v)
 * of the unrotated page lands at (1 − v, u) after 90°.
 */
export function rotateBox(b: Box, rot: number): Box {
  const [u0, v0, u1, v1] = b;
  switch (deg(rot)) {
    case 90: return [1 - v1, u0, 1 - v0, u1];
    case 180: return [1 - u1, 1 - v1, 1 - u0, 1 - v0];
    case 270: return [v0, 1 - u1, v1, 1 - u0];
    default: return b;
  }
}

/** The inverse of rotateBox: a reference-frame box mapped into the edition page as displayed by default. */
export function unrotate(b: Box, rot: number): Box {
  const [x0, y0, x1, y1] = b;
  switch (deg(rot)) {
    case 90: return [y0, 1 - x1, y1, 1 - x0];
    case 180: return [1 - x1, 1 - y1, 1 - x0, 1 - y0];
    case 270: return [1 - y1, x0, 1 - y0, x1];
    default: return b;
  }
}

/** Extra rotation (degrees) an edition's page is rendered with so it matches the reference frame. */
export const pageRotation = (e: Edition, page: number): number =>
  e.rotate && e.rotatePages?.includes(page) ? e.rotate : 0;

/** A box of [0, 0, 0, 0]: the locator could not place this field (any kind). It is never read. */
export const unlocated = (loc: Loc | undefined): boolean => !loc || loc.box.every((v) => v === 0);

/**
 * One hashed field of a section. `key` is how Section consumers name it: `${block}:${row}:${col}` for
 * table cells and column headers (row -1), `${block}:${field}` for the rest (the section title is block -1).
 */
export interface Field {
  key: string;
  field: HashField;
  block: number;
  row: number;
  col: number;
  page: number;
  loc: Loc | undefined;
  h: Hashes;
  i: number;                                                        // index into h[edition].v
}

/**
 * Every hashed field, in block order. Pages: the section title on its own page; a table's title, intro and
 * headers on the table's page; each cell on its row's page (rowPages); notes on the last row's page.
 */
export function fieldsOf(s: SkelSection): Field[] {
  const out: Field[] = [];
  if (s.title) out.push({ key: "-1:title", field: "title", block: -1, row: -1, col: -1, page: s.title.page, loc: s.title.loc, h: s.title.h, i: 0 });
  s.blocks.forEach((b, bi) => {
    if (b.type === "image") return;
    if (b.type === "para" || b.type === "heading") {
      out.push({ key: `${bi}:${b.type}`, field: b.type, block: bi, row: -1, col: -1, page: b.page, loc: b.loc, h: b.h, i: 0 });
      return;
    }
    if (b.type !== "table") return;
    const t = b;                                                    // a const keeps the narrowing in closures
    const rowPage = (r: number) => t.rowPages?.[r] ?? t.page;
    const head = (field: "title" | "intro" | "notes", loc: Loc | undefined, i: number, page: number) =>
      out.push({ key: `${bi}:${field}`, field, block: bi, row: -1, col: -1, page, loc, h: t.h, i });
    head("title", t.title, 0, t.page);
    head("intro", t.intro, 1, t.page);
    for (let c = 0; c < t.cols; c++) {
      out.push({ key: `${bi}:-1:${c}`, field: "col", block: bi, row: -1, col: c, page: t.page, loc: t.colLocs?.[c], h: t.h, i: 3 + c });
    }
    for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
      out.push({ key: `${bi}:${r}:${c}`, field: "cell", block: bi, row: r, col: c, page: rowPage(r), loc: t.cells[r]?.[c], h: t.h, i: 3 + t.cols + r * t.cols + c });
    }
    head("notes", t.notes, 2, t.rows ? rowPage(t.rows - 1) : t.page);
  });
  return out;
}

/** The field's keyed hash for an edition; "" when the field is empty (nothing to read or verify). */
export const expectedHash = (f: Field, ed: string): string => f.h[ed]?.v[f.i] ?? "";

/** Every page a section needs: its own pages, its fields' pages and its image blocks' pages. */
export function sectionPages(s: SkelSection, fields: Field[] = fieldsOf(s)): number[] {
  const set = new Set<number>(s.pages);
  for (const f of fields) set.add(f.page);
  for (const b of s.blocks) set.add(b.page);
  return [...set].sort((a, b) => a - b);
}

/** Bold and italic spans as the "**" / "*" markers the renderer reads. Closing markers go before opening ones. */
export function withMarks(text: string, marks: [number, number, "b" | "i"][]): string {
  const at: { pos: number; s: string; close: boolean }[] = [];
  for (const [a, b, k] of marks) {
    if (a < 0 || b > text.length || b <= a) continue;
    const m = k === "b" ? "**" : "*";
    at.push({ pos: a, s: m, close: false }, { pos: b, s: m, close: true });
  }
  at.sort((x, y) => y.pos - x.pos || (x.close === y.close ? 0 : x.close ? 1 : -1));
  let out = text;
  for (const x of at) out = out.slice(0, x.pos) + x.s + out.slice(x.pos);
  return out;
}

export type CellResult = { text: string; ok: boolean };

/**
 * The Section rebuilt from read fields (`cells`, by Field key). A field with a hash that is missing from
 * `cells` or not ok goes into `unverified` (and keeps whatever text it has). The title is the section title
 * field, else the first heading's text, else the first table's title.
 */
export function rebuildSection(skel: SkelSection, ed: string, cells: Map<string, CellResult>): StoredSection {
  const text = (k: string) => cells.get(k)?.text ?? "";
  const unverified: string[] = [];
  for (const f of fieldsOf(skel)) {
    if (expectedHash(f, ed) === "") continue;
    if (!cells.get(f.key)?.ok) unverified.push(f.key);
  }
  const blocks: Block[] = skel.blocks.map((b, bi): Block => {
    if (b.type === "image") return { type: "image", src: "", page: b.page };
    if (b.type === "para" || b.type === "heading") {
      const r = cells.get(`${bi}:${b.type}`);
      const t = r?.ok && b.marks?.length ? withMarks(r.text, b.marks) : r?.text ?? "";
      return b.type === "para" ? { type: "para", text: t, page: b.page } : { type: "heading", level: b.level ?? 2, text: t, page: b.page };
    }
    if (b.type !== "table") throw new Error("rebuildSection: unknown block type");
    const opt = (k: string) => text(`${bi}:${k}`) || null;
    const table: Table = {
      title: opt("title"),
      dice: b.dice,
      columns: Array.from({ length: b.cols }, (_, c) => text(`${bi}:-1:${c}`)),
      rows: Array.from({ length: b.rows }, (_, r) => Array.from({ length: b.cols }, (_, c) => text(`${bi}:${r}:${c}`))),
    };
    if (b.code) table.code = b.code;
    const intro = opt("intro"), notes = opt("notes");
    if (intro) table.intro = intro;
    if (notes) table.notes = notes;
    if (b.continued !== undefined) table.continued = b.continued;
    if (b.blank_rows !== undefined) table.blank_rows = b.blank_rows;
    return { type: "table", table, page: b.page };
  });
  const heading = blocks.find((b): b is Extract<Block, { type: "heading" }> => b.type === "heading");
  const table = blocks.find((b): b is Extract<Block, { type: "table" }> => b.type === "table");
  const title = (skel.title ? text("-1:title") : "") || heading?.text || table?.table.title || "";
  const section: Section = { id: skel.id, book: skel.book, title, level: skel.level, chapter: skel.chapter, pages: skel.pages, blocks };
  return { section, unverified };
}

/**
 * Table rows of a book's sections for an edition: rows with at least one hashed cell, and those whose hashed
 * cells are all verified. `unverified(id)` gives a stored section's unverified keys, or undefined when the
 * section is not stored (all its rows then count as unverified).
 */
export function rowCounts(sections: SkelSection[], ed: string, unverified: (id: string) => ReadonlySet<string> | undefined): { rows: number; verified: number } {
  let rows = 0, verified = 0;
  for (const s of sections) {
    const un = unverified(s.id);
    s.blocks.forEach((b, bi) => {
      if (b.type !== "table") return;
      const v = b.h[ed]?.v ?? [];
      for (let r = 0; r < b.rows; r++) {
        let any = false, ok = true;
        for (let c = 0; c < b.cols; c++) {
          if (!v[3 + b.cols + r * b.cols + c]) continue;
          any = true;
          if (!un || un.has(`${bi}:${r}:${c}`)) ok = false;
        }
        if (!any) continue;
        rows++;
        if (ok) verified++;
      }
    });
  }
  return { rows, verified };
}
