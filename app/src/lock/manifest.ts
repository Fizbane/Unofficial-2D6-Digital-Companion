// The shipped manifest: the books' structure, keyed hashes and page locations. It holds no book text.
import type { Patch } from "./hash";
import {
  BOOK_NAMES, MANIFEST_STRING, RE, ValidationError, arr, bool, fail, idx, key, num, obj, oneOf, opt, orNull, rec,
  str, tuple, type V,
} from "./validate";

export interface Manifest {
  version: 1;
  books: { slug: string; name: string; free: boolean;            // name: product name, e.g. "Tables Codex"
           editions: Edition[];
           freeFp?: string[] }[];                                // free-version fingerprints ("already included")
  sections: SkelSection[];                                       // locked books only
  codes: Record<string, string>;                                 // table code -> section id (all books)
}
/**
 * One PDF edition of a book. Locs are in the first edition's page frame. `rotate` (degrees) is added to
 * the pages listed in `rotatePages` (only those) so they render, and their boxes map, as in that frame.
 */
export interface Edition { id: string; fp: string; pages: number; rotate?: number; rotatePages?: number[] }
export interface SkelSection { id: string; book: string; level: number; chapter: string | null; pages: number[];
                        blocks: SkelBlock[]; legacy?: Record<string /*edition*/, string>; // keyed hash of the old title-slug id
                        /** The section title: field "title", block -1, row -1, col -1. */
                        title?: { page: number; loc: Loc; h: Hashes } }
export type SkelBlock =
  | { type: "para" | "heading"; page: number; level?: number; loc: Loc; h: Hashes; marks?: [number, number, "b"|"i"][] }
  | { type: "table"; page: number; code?: string; dice: string | null; cols: number; rows: number;
      title?: Loc; intro?: Loc; notes?: Loc; colLocs?: Loc[]; cells: Loc[][]; h: Hashes; continued?: boolean;
      blank_rows?: number;
      rowPages?: number[] }  // colLocs: column headers (index = col). rowPages: each row's page when the table spans pages
                             // (title, intro and headers are on `page`, notes on the last row's page)
  | { type: "image"; page: number; box: Box };                     // shown as a crop of the user's PDF
export interface Loc { box: Box; kind: "text" | "ocr" | "dice" }
export type Box = [number, number, number, number];                       // x0, y0, x1, y1 in 0..1
export type Hashes = Record<string /*edition id*/, { v: string[]; patch?: Record<string, Patch> }>;
export type { Patch };

/**
 * Layout of `Hashes[edition].v`. Every hash is fieldHash(key, field, sectionId, blockIndex, row, col, text),
 * where blockIndex is the block's index in `SkelSection.blocks` (-1 for the section title).
 * - para / heading: `[text]`, field "para" / "heading", row -1, col -1.
 * - section title: `[text]`, field "title", block -1, row -1, col -1.
 * - table: `[title, intro, notes, ...cols, ...cells row-major]`. The first three are fields "title", "intro",
 *   "notes" (row -1, col -1); then `cols` hashes of field "col" (row -1, col c); then `rows × cols` hashes of
 *   field "cell" (row r, col c) at `3 + cols + r * cols + c`. An absent or empty field is "" (no hash).
 * Patches are keyed by the fieldHash of the raw (unrepaired) extracted text for the same field and position.
 */
export const TABLE_HEAD = { title: 0, intro: 1, notes: 2 } as const;

/** Index into a table's `v` for a table-level field, a column header (row -1) or a cell. */
export function hashIndex(cols: number, at: "title" | "intro" | "notes" | { row: number; col: number }): number {
  if (typeof at === "string") return TABLE_HEAD[at];
  if (at.col < 0 || at.col >= cols || at.row < -1) throw new RangeError("hashIndex: out of range");
  return at.row === -1 ? 3 + at.col : 3 + cols + at.row * cols + at.col;
}

const MAX_EDITIONS = 16;
const MAX_PATCH_OPS = 3;
const MAX_PATCH_INSERT = 4;

const int = (min: number, max: number) => num({ int: true, min, max });
const page = int(1, 10_000);
const slug = str(32, /^[a-z]+$/);
const sectionId = str(80, RE.id);
const hash = str(22, RE.hash);
const edition = str(32, RE.edition);
const unit = num({ min: 0, max: 1 });

const box: V<Box> = tuple<Box>(unit, unit, unit, unit);
const loc = obj<Loc>({ box, kind: oneOf("text", "ocr", "dice") });

// Insert lengths are counted in code points, as makePatch counts them.
const cpLen = (s: string) => Array.from(s).length;
const insert: V<string> = (x, path) => (typeof x === "string" && cpLen(x) <= MAX_PATCH_INSERT ? x : fail(path));
const patch: V<Patch> = (x, path) => {
  const p = arr(tuple<[number, number, string]>(int(0, 100_000), int(0, 100_000), insert), MAX_PATCH_OPS)(x, path);
  if (p.reduce((t, op) => t + cpLen(op[2]), 0) > MAX_PATCH_INSERT) fail(path);
  return p;
};
// An empty cell has no hash and is written as "".
const cellHash: V<string> = (x, path) => (x === "" ? "" : hash(x, path));
const hashes: V<Hashes> = rec(
  RE.edition,
  // Patch keys are the fieldHash of the raw (unpatched) text for that field and position.
  obj<Hashes[string]>({ v: arr(cellHash, 20_000), patch: opt(rec(RE.hash, patch, 20_000)) }),
  MAX_EDITIONS,
);

type Text = Extract<SkelBlock, { type: "para" | "heading" }>;
type Table = Extract<SkelBlock, { type: "table" }>;
type Image = Extract<SkelBlock, { type: "image" }>;
const textBlock = obj<Text>({
  type: oneOf("para", "heading"),
  page,
  level: opt(int(0, 9)),
  loc,
  h: hashes,
  marks: opt(arr(tuple<[number, number, "b" | "i"]>(int(0, 100_000), int(0, 100_000), oneOf("b", "i")), 1000)),
});
const tableBlock = obj<Table>({
  type: oneOf("table"),
  page,
  code: opt(str(8, RE.code)),
  dice: orNull(str(8, RE.dice)),
  cols: int(1, 64),
  rows: int(0, 2000),
  title: opt(loc),
  intro: opt(loc),
  notes: opt(loc),
  colLocs: opt(arr(loc, 64)),
  cells: arr(arr(loc, 64), 2000),
  h: hashes,
  continued: opt(bool),
  blank_rows: opt(int(0, 2000)),
  rowPages: opt(arr(page, 2000)),
});
const imageBlock = obj<Image>({ type: oneOf("image"), page, box });

const block: V<SkelBlock> = (x, path) => {
  const t = typeof x === "object" && x !== null ? (x as { type?: unknown }).type : undefined;
  if (t === "para" || t === "heading") return textBlock(x, path);
  if (t === "table") return tableBlock(x, path);
  if (t === "image") return imageBlock(x, path);
  return typeof x === "object" && x !== null && !Array.isArray(x) ? fail(key(path, "type")) : fail(path);
};

const section = obj<SkelSection>({
  id: sectionId,
  book: slug,
  level: int(0, 9),
  chapter: orNull(sectionId),
  pages: arr(page, 100),
  blocks: arr(block, 5000),
  legacy: opt(rec(RE.edition, hash, MAX_EDITIONS)),
  title: opt(obj<NonNullable<SkelSection["title"]>>({ page, loc, h: hashes })),
});

const book = obj<Manifest["books"][number]>({
  slug,
  name: oneOf(...BOOK_NAMES),
  free: bool,
  editions: arr(
    obj<Edition>({
      id: edition,
      fp: str(64, RE.fp),
      pages: page,
      rotate: opt(oneOf(0, 90, 180, 270)),
      rotatePages: opt(arr(page, 10_000)),
    }),
    MAX_EDITIONS,
  ),
  freeFp: opt(arr(str(64, RE.fp), MAX_EDITIONS)),
});

const manifest = obj<Manifest>({
  version: oneOf(1),
  books: arr(book, 16),
  sections: arr(section, 20_000),
  codes: rec(RE.code, sectionId, 20_000),
});

const PATCH_INSERT = /\.patch\.[A-Za-z0-9_-]{22}\[\d+\]\[2\]$/;
const HASH_SLOT = /\.v\[\d+\]$/;

/**
 * Walks every string value in x and throws unless it matches MANIFEST_STRING; also rejects prototype keys.
 * (Record keys are checked by the schema's key regexes.)
 * Exempt: patch insert strings (at most 4 characters) and "" in a Hashes.v slot (an empty cell).
 */
export function assertNoFreeText(x: unknown, path = ""): void {
  try {
    walk(x, path);
  } catch (e) {
    if (e instanceof ValidationError) throw new Error(`manifest: ${e.path}`);
    throw e;
  }
}

function walk(x: unknown, path: string): void {
  if (typeof x === "string") {
    if (MANIFEST_STRING.test(x)) return;
    if (PATCH_INSERT.test(path) && cpLen(x) <= MAX_PATCH_INSERT) return;
    if (x === "" && HASH_SLOT.test(path)) return;
    fail(path);
  } else if (Array.isArray(x)) {
    x.forEach((e, i) => walk(e, idx(path, i)));
  } else if (typeof x === "object" && x !== null) {
    for (const [k, v] of Object.entries(x)) {
      const p = key(path, k);
      if (k === "__proto__" || k === "constructor" || k === "prototype") fail(p);
      walk(v, p);
    }
  }
}

/** References must resolve: section books and ids, the editions their hashes name, and the codes' targets. */
function crossCheck(m: Manifest): void {
  const editions = new Map(m.books.map((b) => [b.slug, new Set(b.editions.map((e) => e.id))]));
  const ids = new Set<string>();
  m.sections.forEach((s, i) => {
    const p = idx("sections", i);
    const eds = editions.get(s.book);
    if (!eds) fail(key(p, "book"));
    if (!s.id.startsWith(`${s.book}/`)) fail(key(p, "id"));
    for (const ed of Object.keys(s.legacy ?? {})) if (!eds!.has(ed)) fail(key(key(p, "legacy"), ed));
    for (const ed of Object.keys(s.title?.h ?? {})) if (!eds!.has(ed)) fail(key(key(key(p, "title"), "h"), ed));
    s.blocks.forEach((b, j) => {
      if (b.type === "image") return;
      for (const ed of Object.keys(b.h)) if (!eds!.has(ed)) fail(key(key(idx(key(p, "blocks"), j), "h"), ed));
    });
    ids.add(s.id);
  });
  for (const [c, id] of Object.entries(m.codes)) if (!ids.has(id)) fail(key("codes", c));
}

/** Strict schema check, then a walk that rejects any string that could be book text. */
export function validateManifest(x: unknown): Manifest {
  let m: Manifest;
  try {
    m = manifest(x, "");
    crossCheck(m);
  } catch (e) {
    if (e instanceof ValidationError) throw new Error(`manifest: ${e.path}`);
    throw e;
  }
  assertNoFreeText(m);
  return m;
}
