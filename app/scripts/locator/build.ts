// Locator build (private, run locally): pipeline/work/skeleton.json + the PDFs in books/ -> the text-free
// app/public/data/manifest.json and a coverage report. It locates every locked text block and table cell
// on the page, then simulates the browser importer with the same adapters (pdf.js, Tesseract, textInBox,
// countPips, verifyCell) for every edition, and stores keyed hashes and small patches.
//
//   npx tsx scripts/locator/build.ts [--book codex|realm|companions|lairs|legendary] [--edition id] [--pages 40-60] [--workers 4] [--dump]
//
// A partial run (--book/--edition/--pages) prints coverage but writes neither the manifest nor coverage.json.
// --dump writes every field's outcome (with the true text and OCR output of those not verified raw) to
// pipeline/work/locator-debug.json (private; a partial run writes locator-debug.partial.json instead), under
// a marker saying whether the run was full, which editions it covered and the skeleton's SHA-256.
// --coverage-from-debug accepts only a full, matching file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { digestFile, fieldHash, makePatch, norm, type HashField } from "../../src/lock/hash";
import {
  validateManifest, type Box, type Edition, type Hashes, type Loc, type Manifest, type SkelBlock, type SkelSection,
} from "../../src/lock/manifest";
import type { Mark, TextItem } from "../../src/lock/extract";
import { openPdf, crop, type PdfDoc, type RGBAImage } from "../../src/lock/pdf";
import { createOcr, CROP_PAD, RENDER_SCALE, type Ocr } from "../../src/lock/ocr";
import { toGray } from "../../src/lock/pips";
import { verifyCell, type CellSource } from "../../src/lock/verify";
import { guessCell, guessDicePrefixed, guessInterrupt, guessJoined, guessLabelled, guessSlice } from "../../src/lock/closedset";
import { RE } from "../../src/lock/validate";
import { MIN_SIMILARITY, align, alignDetail, alignGrid, similarity, unionBox, type Word } from "./align";
import { detectCells, orderCells } from "./grid";
import { GATE, gateFigure, honestPatch, rowCoverage, tableClass, type RowCov, type TableClass } from "./rules";
import { cellSource, ocrCrop } from "../../src/lock/cellsource";
import { BOOK_NAME, EDITIONS as DUNGEON_EDITIONS, VOID_EDITIONS, FREE_FP, type EditionFile } from "./editions";

// ---------------------------------------------------------------------------------------------- paths, args

const APP = fileURLToPath(new URL("../../", import.meta.url));
/** --game void: 2D6 Void's own skeleton, manifest and coverage (a paid game: every section locked, no free set). */
const GAME = process.argv.includes("--game") ? process.argv[process.argv.indexOf("--game") + 1] : "dungeon";
if (GAME !== "dungeon" && GAME !== "void") throw new Error(`unknown game ${GAME}`);
const SUF = GAME === "dungeon" ? "" : `-${GAME}`;
const EDITIONS: EditionFile[] = GAME === "void" ? VOID_EDITIONS : DUNGEON_EDITIONS;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WORK = ROOT + "pipeline/work/";
const OUT = APP + `public/data/manifest${SUF}.json`;

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const ONLY_BOOK = arg("--book");
const ONLY_ED = arg("--edition");
const PAGES = arg("--pages")?.split("-").map(Number) as [number, number] | undefined;
const WORKERS = Number(arg("--workers") ?? 4);
const DUMP = argv.includes("--dump");
const TRACE = !!process.env.LOC_TRACE;
const PARTIAL = !!(ONLY_BOOK || ONLY_ED || PAGES);
/** Recompute coverage.json from pipeline/work/locator-debug.json and the skeleton, without OCR. */
const FROM_DEBUG = argv.includes("--coverage-from-debug");

const DICE_TEXT = /^(\[[1-6]\])+(\+(\[[1-6]\])+)*$/;
const NO_BOX: Box = [0, 0, 0, 0];
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + "s";
const log = (...a: unknown[]) => console.log(`[${secs()}]`, ...a);

// ---------------------------------------------------------------------------------------------- skeleton

interface SkTable { title?: string | null; code?: string; intro?: string | null; notes?: string | null; dice?: string | null;
  columns: string[]; rows: string[][]; continued?: boolean; blank_rows?: number }
interface SkBlock { type: "para" | "heading" | "table" | "image"; page: number; src?: "text" | "trans"; text?: string;
  level?: number; bbox?: Box; table?: SkTable; cellBoxes?: (Box | null)[][]; colBoxes?: (Box | null)[];
  titleBox?: Box | null; rowPages?: number[] }
interface SkSection { id: string; oldId: string; book: string; title: string; level: number; chapter: string | null;
  pages: number[]; blocks: SkBlock[]; titleSrc?: string | null; titlePage?: number; titleBox?: Box }

const skeletonBytes = readFileSync(WORK + `skeleton${SUF}.json`);
const SKELETON_SHA256 = createHash("sha256").update(skeletonBytes).digest("hex");
const skeletonJson = JSON.parse(skeletonBytes.toString("utf8")) as
  { sections: SkSection[]; rotatePages?: Record<string, Record<string, number>> | Record<string, number> };
const skeleton: SkSection[] = skeletonJson.sections;
/**
 * Pages a book's reference edition is shown turned (sideways table scans), from the build: {book: {page: deg}}.
 * An older skeleton has one flat {page: deg} map for its single book (2D6 Void).
 */
function refRotatePages(book: string): number[] {
  const r = skeletonJson.rotatePages ?? {};
  const flat = Object.values(r).every((v) => typeof v === "number");
  const pages = flat ? (GAME === "void" ? r : {}) : (r as Record<string, Record<string, number>>)[book] ?? {};
  return Object.keys(pages).map(Number);
}
const idMap: Record<string, string> = JSON.parse(readFileSync(WORK + `id-map${SUF}.json`, "utf8"));
const oldOf = new Map(Object.entries(idMap).map(([old, id]) => [id, old]));
for (const s of skeleton) {
  if (oldOf.get(s.id) !== s.oldId) throw new Error(`id-map and skeleton disagree on ${s.id}`);
}

/** The text as stored, minus the "**" bold markers, with the bold spans as marks on the normalised text. */
function plainText(text: string): { plain: string; marks: Mark[] } {
  const t = norm(text);
  let plain = "";
  const marks: Mark[] = [];
  let open = -1;
  for (let i = 0; i < t.length;) {
    if (t.startsWith("**", i)) {
      if (open < 0) open = plain.length;
      else { if (plain.length > open) marks.push([open, plain.length, "b"]); open = -1; }
      i += 2;
      continue;
    }
    const ch = t[i++];
    if (ch === " " && (plain === "" || plain.endsWith(" "))) continue;
    plain += ch;
  }
  if (open >= 0 && plain.length > open) marks.push([open, plain.length, "b"]);
  if (plain.endsWith(" ")) plain = plain.slice(0, -1);
  const out = marks
    .map(([a, b, k]): Mark => [Math.min(a, plain.length), Math.min(b, plain.length), k])
    .filter(([a, b]) => b > a);
  // trim a leading space inside a mark (from "** x**")
  for (const m of out) { while (m[0] < m[1] && plain[m[0]] === " ") m[0]++; while (m[1] > m[0] && plain[m[1] - 1] === " ") m[1]--; }
  return { plain, marks: out.filter(([a, b]) => b > a) };
}
const plain = (s: string | null | undefined) => (s ? plainText(s).plain : "");

// ---------------------------------------------------------------------------------------------- OCR pool

/** A few Tesseract workers; `words` jobs (page layout, needed before anything on the page) jump the queue. */
class Pool {
  private free: Ocr[];
  private waiting: ((o: Ocr) => void)[] = [];
  constructor(private all: Ocr[]) { this.free = [...all]; }
  get queued() { return this.waiting.length; }
  async run<T>(fn: (o: Ocr) => Promise<T>, urgent = false): Promise<T> {
    const o = this.free.pop() ?? await new Promise<Ocr>((res) => (urgent ? this.waiting.unshift(res) : this.waiting.push(res)));
    try { return await fn(o); } finally {
      const next = this.waiting.shift();
      if (next) next(o); else this.free.push(o);
    }
  }
  async drain(below: number) { while (this.waiting.length > below) await new Promise((r) => setTimeout(r, 200)); }
  close() { return Promise.all(this.all.map((o) => o.close())); }
}

// ---------------------------------------------------------------------------------------------- geometry

const cxOf = (b: Box) => (b[0] + b[2]) / 2, cyOf = (b: Box) => (b[1] + b[3]) / 2;

/** Words in reading order by geometry: lines by vertical centre, left to right within a line. */
function geoOrder<W extends Word>(words: W[]): W[] {
  const hs = words.map((w) => w.box[3] - w.box[1]).sort((a, b) => a - b);
  const tol = 0.5 * (hs[hs.length >> 1] ?? 0.01);
  const lines: { y: number; ws: W[] }[] = [];
  for (const w of [...words].sort((a, b) => cyOf(a.box) - cyOf(b.box))) {
    const l = lines[lines.length - 1];
    if (l && Math.abs(cyOf(w.box) - l.y) <= tol) { l.ws.push(w); l.y = l.ws.reduce((t, x) => t + cyOf(x.box), 0) / l.ws.length; }
    else lines.push({ y: cyOf(w.box), ws: [w] });
  }
  return lines.flatMap((l) => l.ws.sort((a, b) => a.box[0] - b.box[0]));
}

const round5 = (b: Box): Box => b.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1e5) / 1e5) as Box;

/**
 * Die squares inside a ruled cell: dark (< 128) squarish components at least 40 % of the cell's height,
 * of about the same size; the union of the ones on the cell's middle line, or null.
 */
function findDice(img: RGBAImage, region: Box): Box | null {
  const sub = crop(img, region, 0);
  if (!sub.width || !sub.height) return null;
  const g = toGray(sub);
  const { width: w, height: h, data } = g;
  const label = new Int32Array(w * h).fill(-1);
  const comps: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== -1 || data[s] >= 128) continue;
    const c = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    label[s] = comps.length;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      c.area++;
      c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (label[q] === -1 && data[q] < 128) { label[q] = comps.length; stack.push(q); }
      }
    }
    comps.push(c);
  }
  const minSide = 0.4 * h;
  const sq = comps.filter((c) => {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    return ch >= minSide && ch <= 0.95 * h && cw / ch > 0.75 && cw / ch < 1.33;
  });
  if (!sq.length) return null;
  const sides = sq.map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
  const med = sides[sides.length >> 1];
  const keep = sq.filter((c) => Math.abs(c.y1 - c.y0 + 1 - med) <= 0.25 * med);
  // squares of one cell share a line: keep those whose centre is nearest the region's middle
  const mid = h / 2;
  const best = Math.min(...keep.map((c) => Math.abs((c.y0 + c.y1) / 2 - mid)));
  const row = keep.filter((c) => Math.abs(Math.abs((c.y0 + c.y1) / 2 - mid) - best) <= 0.3 * med);
  const ox = Math.floor(region[0] * img.width), oy = Math.floor(region[1] * img.height);
  return [
    (ox + Math.min(...row.map((c) => c.x0))) / img.width,
    (oy + Math.min(...row.map((c) => c.y0))) / img.height,
    (ox + Math.max(...row.map((c) => c.x1)) + 1) / img.width,
    (oy + Math.max(...row.map((c) => c.y1)) + 1) / img.height,
  ];
}

// ---------------------------------------------------------------------------------------------- targets

type Status = "raw" | "confusion" | "patch" | "guess" | "fail" | "unlocated" | "empty";
type Kind = "cell" | "col" | "para" | "heading" | "title" | "intro" | "notes" | "stitle";

/** One hashed field: where it is, its true text, and where its hash goes. */
interface Target {
  kind: Kind;                         // for the coverage report ("stitle" is the section title)
  field: HashField; sid: string; block: number; row: number; col: number;
  truth: string;
  page: number; loc: Loc; located: "box" | "align" | "grid" | "dice" | "none";
  slot: { h: Hashes; i: number };     // v index in this Hashes
  tableRow?: { key: string; cls: TableClass };   // data rows, for row coverage per table class
  guess?: boolean;                    // two-column table cell: the importer also tries the closed set (closedset.ts)
}

interface Unit {
  sid: string;
  pages: number[];                    // pages this unit needs (rendered / words / text items)
  ocr: boolean;                       // needs page renders
  locate?: (ctx: LocateCtx) => Promise<void>;  // reference edition only
  targets: Target[];
}

/** Pixels kept clear of a ruled cell's rules (their anti-aliased edges read as "|"). */
const INSET = 1;

/** A ruled cell: its interior and the Loc box whose padded crop is that interior less INSET pixels. */
interface Region { raw: Box; loc: Box }

interface LocateCtx {
  pageWords(p: number): Promise<Word[]>;         // whole-page words, Tesseract's order
  regions(p: number): Region[];                  // ruled cells in table order
  regionTexts(p: number): Promise<string[]>;     // their OCR readings (the same reads the simulation uses)
  image(p: number): RGBAImage;
}

/** A single text (title, intro, notes, para) is located in one ruled cell from this similarity up. */
const FIND_SIMILARITY = 0.6;

/**
 * Best location of one text: the ruled cell whose reading is most similar to it (at least
 * FIND_SIMILARITY), else the union of the page words it aligns with when at least half its tokens match.
 */
async function findText(ctx: LocateCtx, page: number, text: string): Promise<Box | null> {
  const texts = await ctx.regionTexts(page);
  let best = -1, bestS = FIND_SIMILARITY;
  texts.forEach((t, i) => { const v = similarity(text, t); if (v >= bestS && (best < 0 || v > bestS)) { best = i; bestS = v; } });
  if (best >= 0) return ctx.regions(page)[best].loc;
  const pw = await ctx.pageWords(page);
  const d = alignDetail([[text]], pw);
  return d.total[0][0] > 0 && d.matched[0][0] / d.total[0][0] >= 0.5 ? unionBox(d.idx[0][0].map((i) => pw[i].box)) : null;
}

// ---------------------------------------------------------------------------------------------- per-book plan

interface BookPlan { sections: SkelSection[]; units: Unit[]; codes: Record<string, string> }

function emptyHashes(eds: string[], n: number): Hashes {
  const h: Hashes = {};
  for (const e of eds) h[e] = { v: new Array<string>(n).fill("") };
  return h;
}

function planBook(book: string, eds: string[]): BookPlan {
  const sections: SkelSection[] = [];
  const units: Unit[] = [];
  const codes: Record<string, string> = {};
  const titleLocs = new Map<string, Promise<Box | null>>(); // page|text -> shared by section and table titles

  for (const s of skeleton.filter((x) => x.book === book)) {
    const out: SkelSection = { id: s.id, book: s.book, level: s.level, chapter: s.chapter, pages: s.pages, blocks: [] };
    sections.push(out);

    // Section title: field "title", block -1.
    const st = plain(s.title);
    if (st) {
      const h = emptyHashes(eds, 1);
      const textLoc = s.titleSrc === "text" && s.titleBox && s.titlePage;
      const target: Target = {
        kind: "stitle", field: "title", sid: s.id, block: -1, row: -1, col: -1, truth: st,
        page: textLoc ? s.titlePage! : s.pages[0], loc: { box: textLoc ? round5(s.titleBox!) : NO_BOX, kind: textLoc ? "text" : "ocr" },
        located: textLoc ? "box" : "none", slot: { h, i: 0 },
      };
      out.title = { page: target.page, loc: target.loc, h };
      const u: Unit = { sid: s.id, pages: [target.page], ocr: !textLoc, targets: [target] };
      if (!textLoc) {
        u.locate = async (ctx) => {
          const k = `${target.page}|${st}`;
          if (!titleLocs.has(k)) titleLocs.set(k, findText(ctx, target.page, st));
          const b = await titleLocs.get(k)!;
          if (b) { target.loc.box = round5(b); target.located = "align"; }
        };
      }
      units.push(u);
    }

    s.blocks.forEach((b, bi) => {
      const nextPage = s.blocks.slice(bi + 1).find((x) => x.page > b.page)?.page ?? Infinity;
      if (b.type === "image") {
        out.blocks.push({ type: "image", page: b.page, box: round5(b.bbox ?? [0, 0, 1, 1]) });
        return;
      }
      if (b.type === "para" || b.type === "heading") {
        const { plain: truth, marks } = plainText(b.text ?? "");
        const h = emptyHashes(eds, 1);
        const isText = b.src === "text" && !!b.bbox;
        const blk: SkelBlock = { type: b.type, page: b.page, loc: { box: isText ? round5(b.bbox!) : NO_BOX, kind: isText ? "text" : "ocr" }, h };
        if (b.type === "heading" && b.level !== undefined) blk.level = b.level;
        if (marks.length) blk.marks = marks;
        out.blocks.push(blk);
        const target: Target = { kind: b.type, field: b.type, sid: s.id, block: bi, row: -1, col: -1, truth, page: b.page,
          loc: blk.loc, located: isText ? "box" : "none", slot: { h, i: 0 } };
        const u: Unit = { sid: s.id, pages: [b.page], ocr: !isText, targets: [target] };
        if (!isText) u.locate = async (ctx) => {
          const bx = await findText(ctx, b.page, truth);
          if (bx) { blk.loc.box = round5(bx); target.located = "align"; }
        };
        units.push(u);
        return;
      }

      // table
      const t = b.table!;
      const cols = Math.max(t.columns.length, ...t.rows.map((r) => r.length), 1);
      const rows = t.rows.map((r) => Array.from({ length: cols }, (_, c) => plain(r[c])));
      const colText = Array.from({ length: cols }, (_, c) => plain(t.columns[c]));
      const h = emptyHashes(eds, 3 + cols + rows.length * cols);
      const isText = b.src === "text";
      const cls = tableClass(t.columns, b.src);
      const loc = (box: Box | null | undefined, kind: Loc["kind"]): Loc => ({ box: box ? round5(box) : NO_BOX, kind });
      const blk: Extract<SkelBlock, { type: "table" }> = {
        type: "table", page: b.page, dice: t.dice ?? null, cols, rows: rows.length,
        cells: rows.map((r, ri) => r.map((_, c) => loc(isText ? b.cellBoxes?.[ri]?.[c] : null, isText ? "text" : "ocr"))), h,
      };
      if (t.code && RE.code.test(t.code)) {
        blk.code = t.code;
        if (!(t.code in codes)) codes[t.code] = s.id;                // first occurrence wins
      } else if (t.code) {
        console.warn(`WARNING ${s.id} block ${bi}: table code ${JSON.stringify(t.code)} is not a valid code; left out of the manifest`);
      }
      if (t.continued !== undefined) blk.continued = t.continued;
      if (t.blank_rows !== undefined) blk.blank_rows = t.blank_rows;
      out.blocks.push(blk);

      const rowPages = isText && b.rowPages ? b.rowPages : rows.map(() => b.page);
      const targets: Target[] = [];
      const add = (kind: Kind, field: HashField, row: number, col: number, truth: string, page: number, l: Loc, i: number,
        located: Target["located"], tableRow?: string) => {
        targets.push({ kind, field, sid: s.id, block: bi, row, col, truth, page, loc: l, located, slot: { h, i },
          tableRow: tableRow ? { key: tableRow, cls } : undefined, guess: cols === 2 && (field === "cell" || field === "col") });
      };
      const tTitle = plain(t.title), tIntro = plain(t.intro), tNotes = plain(t.notes);
      if (tTitle) { blk.title = loc(isText ? b.titleBox : null, isText ? "text" : "ocr"); add("title", "title", -1, -1, tTitle, b.page, blk.title, 0, isText && b.titleBox ? "box" : "none"); }
      if (tIntro) { blk.intro = loc(null, "ocr"); add("intro", "intro", -1, -1, tIntro, b.page, blk.intro, 1, "none"); }
      if (tNotes) { blk.notes = loc(null, "ocr"); add("notes", "notes", -1, -1, tNotes, b.page, blk.notes, 2, "none"); }
      const colLocs = colText.map((_, c) => loc(isText ? b.colBoxes?.[c] : null, isText ? "text" : "ocr"));
      colText.forEach((txt, c) => { if (txt) add("col", "col", -1, c, txt, b.page, colLocs[c], 3 + c, isText && b.colBoxes?.[c] ? "box" : "none"); });
      rows.forEach((r, ri) => r.forEach((txt, c) => {
        add("cell", "cell", ri, c, txt, rowPages[ri], blk.cells[ri][c], 3 + cols + ri * cols + c,
          isText && b.cellBoxes?.[ri]?.[c] ? "box" : "none", `${s.id}#${bi}#${ri}`);
      }));
      if (isText && b.rowPages && new Set(b.rowPages).size > 1) blk.rowPages = b.rowPages;
      if (colText.some((x) => x)) blk.colLocs = colLocs;

      const pages = isText
        ? [...new Set(rowPages.concat(b.page))].sort((x, y) => x - y)
        : [b.page, ...s.pages.filter((p) => p > b.page && p < nextPage)].slice(0, 3);
      const u: Unit = { sid: s.id, pages, ocr: !isText, targets };
      if (!isText) u.locate = (ctx) => locateTable(ctx, blk, targets, pages, { tTitle, tIntro, tNotes, colText, rows }, titleLocs);
      units.push(u);
    });
  }
  return { sections, units, codes };
}

/**
 * A table printed folded (its columns repeated side by side: ROLL | ITEM | ROLL | ITEM) is read band by
 * band: when a physical row of cells repeats the column headers k ≥ 2 times, the cells are reordered by
 * band (left half top to bottom, then the right half), keeping the table order within each band.
 */
function unfold<R extends Region & { text: string }>(cells: R[], cols: string[]): R[] {
  const n = cols.length;
  if (!n || !cols.every(Boolean)) return cells;
  const rows: R[][] = [];
  for (const c of cells) {
    const r = rows.find((row) => Math.abs(row[0].raw[1] - c.raw[1]) <= 0.004);
    if (r) r.push(c); else rows.push([c]);
  }
  for (const row of rows) {
    const k = row.length / n;
    if (k < 2 || !Number.isInteger(k)) continue;
    row.sort((a, b) => a.raw[0] - b.raw[0]);
    const heads = Array.from({ length: k }, (_, g) => cols.every((h, c) => similarity(h, row[g * n + c].text) >= MIN_SIMILARITY));
    if (!heads.every(Boolean)) continue;
    const starts = Array.from({ length: k }, (_, g) => row[g * n].raw[0]);
    const band = (c: R) => { let g = 0; while (g + 1 < k && cxOf(c.raw) >= starts[g + 1]) g++; return g; };
    return cells.map((c, i) => ({ c, i, g: band(c) })).sort((a, b) => a.g - b.g || a.i - b.i).map((x) => x.c);
  }
  return cells;
}

/**
 * Template boxes (page fractions) for the rows of a creature card, from the card's NAME line box. Offsets were
 * measured on the printed cards (see pipeline notes); a row with no template stays null.
 */
const CARD_X0 = -0.0145;                                            // the card's left edge, from the NAME box's left
const CARD_HP_CY = 0.0335;                                          // the HP row's centre below the NAME box's top
const CARD_LEFT_OX = 0.0765, CARD_RIGHT_OX = 0.519;                  // the NAME box's left on the left and right cards
const CARD_X1 = 0.42;                                               // and its right edge
export function cardTemplate(rows: string[][], name: Box, only?: Set<string>): (Box | null)[] {
  const [ox, oy] = [name[0], name[1]];
  const box = (x0: number, y0: number, x1: number, y1: number): Box => [ox + x0, oy + y0, ox + x1, oy + y1];
  const slot = (k: number): [number, number] => [0.177 + k * 0.0215, 0.196 + k * 0.0215];
  const L = CARD_X0;                                                // the card's left edge, relative to ox
  let k = 0;                                                        // the next free manoeuvre line
  const weapon = rows.some((r) => /^AMMO TYPE/i.test(r[0] ?? ""));
  return rows.map((r) => {
    const label = (r[0] ?? "").trim().toUpperCase();
    const want = (kind: string) => !only || only.has(kind);
    // A weapon card has its own fixed grid: label and value share a ruled row, the special text a narrow column.
    if (weapon) {
      if (label === "TYPE") return box(L + 0.087, 0.0025, L + 0.266, 0.0145);
      if (label === "SIZE") return box(L + 0.346, 0.0025, L + 0.411, 0.0145);
      if (label === "ROUND DAMAGE") return box(L + 0.179, 0.0245, L + 0.266, 0.0375);
      if (label === "CAPACITY") return box(L + 0.378, 0.0245, L + 0.411, 0.0375);
      if (label === "AMMO TYPE") return box(L + 0.138, 0.0485, L + 0.411, 0.0615);
      if (label === "SETTINGS") return box(L + 0.118, 0.0715, L + 0.411, 0.0845);
      if (label === "SPECIAL") return box(L + 0.012, 0.1185, L + 0.147, 0.2035);
    }
    if (label === "RANGED WEAPON") return box(CARD_X0, 0.244, CARD_X1, 0.273);
    if (label === "MANOEUVRES") {
      const body = (r[1] ?? "").replace(/^\[\d\]\[\d\] - /, "");
      const lines = body.length > 78 ? 3 : /special/i.test(body) || body.length > 36 ? 2 : 1;
      // A second line starts at the card's edge, under the first line's dice picture.
      const b = box(lines >= 2 ? L + 0.014 : 0.045, slot(k)[0], lines >= 2 ? L + 0.408 : CARD_X1, slot(k + lines - 1)[1]);
      k += lines;
      return b;
    }
    // The other fixed rows. The interrupt block is three ruled lines holding every interrupt (one may start
    // on the line the previous one ends on), so each interrupt's box is the whole block; the mishap and
    // prime texts are the two halves of the card's foot.
    if (label === "NAME" && want("NAME")) return box(L + 0.092, -0.004, L + 0.35, 0.0155);
    if (label === "CACHE" && want("CACHE")) {
      return (r[1] ?? "").length > 16 ? box(L + 0.012, 0.047, L + 0.2575, 0.086) : box(L + 0.1, 0.046, L + 0.2575, 0.064);
    }
    if (label === "INTERRUPT" && want("INTERRUPT")) return box(L + 0.0125, 0.09, L + 0.4155, 0.1495);
    if (/MISHAP/.test(label) && want("MISHAP")) return box(L + 0.0125, 0.366, L + 0.2115, 0.408);
    if (/PRIME/.test(label) && want("PRIME")) return box(L + 0.2225, 0.366, L + 0.4155, 0.408);
    return null;
  });
}

/** The page quadrant (x0, y0, x1, y1) holding a card's name box, when the name sits in the upper part of a card. */
function game2x2(_pw: Word[], name: Box): Box {
  const left = cxOf(name) < 0.5, top = cyOf(name) < 0.5;
  return [left ? 0 : 0.5, top ? 0 : 0.5, left ? 0.5 : 1, top ? 0.5 : 1];
}

/**
 * Locates a transcribed table's title, intro, notes, column headers and cells on the reference edition.
 * The grid (headers, then rows) is aligned against the OCR text of the page's ruled cells, in table order;
 * on the first page only cells below the title and within its width count, so tables side by side stay apart.
 * Dice cells and cells the alignment missed take the ruled cell at their column and row.
 */
async function locateTable(
  ctx: LocateCtx, blk: Extract<SkelBlock, { type: "table" }>, targets: Target[], pages: number[],
  t: { tTitle: string; tIntro: string; tNotes: string; colText: string[]; rows: string[][] },
  titleLocs: Map<string, Promise<Box | null>>,
): Promise<void> {
  const p0 = pages[0];
  const set = (tg: Target | undefined, box: Box | null, how: Target["located"], page?: number) => {
    if (!tg || !box) return;
    tg.loc.box = round5(box);
    tg.located = how;
    if (page !== undefined) tg.page = page;
  };
  const find = (pred: (x: Target) => boolean) => targets.find(pred);

  let titleBox: Box | null = null;
  if (t.tTitle) {
    const k = `${p0}|${t.tTitle}`;
    if (!titleLocs.has(k)) titleLocs.set(k, findText(ctx, p0, t.tTitle));
    titleBox = await titleLocs.get(k)!;
    set(find((x) => x.kind === "title"), titleBox, "align");
  }
  if (t.tIntro) set(find((x) => x.kind === "intro"), await findText(ctx, p0, t.tIntro), "align");

  // Creature cards are transcribed as Field | Value rows, but printed as a card: labels and values share
  // ruled rows (HP 15 XP 85 SH +2). Their cells are found word by word in the page's own word layout,
  // within the card: the ruled cell holding the title spans the card's width.
  if (t.colText.map((c) => c.toLowerCase()).join("|") === "field|value") {
    const pw = await ctx.pageWords(p0);
    // Alien card sheets print four cards in a 2x2 grid: the card is the quadrant holding its name, from the
    // name down to the middle of the page (top row) or the page's foot (bottom row).
    const quad = titleBox && game2x2(pw, titleBox);
    const card = titleBox && ctx.regions(p0).find((g) => cxOf(titleBox!) >= g.raw[0] && cxOf(titleBox!) <= g.raw[2] && cyOf(titleBox!) >= g.raw[1] && cyOf(titleBox!) <= g.raw[3]);
    const x0 = quad ? quad[0] : card ? card.raw[0] - 0.01 : titleBox ? titleBox[0] - 0.03 : 0;
    const x1 = quad ? quad[2] : card ? card.raw[2] + 0.01 : titleBox ? titleBox[2] + 0.03 : 1;
    const y0 = titleBox ? titleBox[1] - 0.01 : 0;
    const y1 = quad ? quad[3] : 1;
    const ws = pw.filter((w) => cxOf(w.box) >= x0 && cxOf(w.box) <= x1 && cyOf(w.box) >= y0 && cyOf(w.box) <= y1);
    if (process.env.LOC_CARD_WORDS === t.tTitle) console.log("CARD", t.tTitle, JSON.stringify(ws.map((w) => w.text)), JSON.stringify(t.rows));
    const boxes = align(t.rows, ws);
    // Every card is printed from one template, so the lines that word alignment can't find (OCR drops lines
    // of the card, or merges them) sit at fixed offsets from the card's NAME line: the whole ranged weapon row
    // (the importer strips the field name) and one line per manoeuvre.
    let anchor: Box | null = titleBox;
    if (!anchor) {                                                  // title unlocated: take the card's place from its HP / XP / SH words
      const ys = t.rows.map((r, i) => ({ l: (r[0] ?? "").trim().toUpperCase(), b: boxes[i][1] }))
        .filter((x): x is { l: string; b: Box } => ["HP", "XP", "SH"].includes(x.l) && !!x.b && x.b[3] > 0);
      if (ys.length) {
        const cy = ys.map((x) => cyOf(x.b)).sort((a, b) => a - b)[Math.floor(ys.length / 2)];
        const cx = cxOf(ys[0].b);
        const oy = cy - CARD_HP_CY;
        anchor = [cx < 0.5 ? CARD_LEFT_OX : CARD_RIGHT_OX, oy, 0, oy];
      }
    }
    const tpl = anchor ? cardTemplate(t.rows, anchor) : null;
    t.rows.forEach((row, r) => row.forEach((_, c) => {
      const tg = find((x) => x.kind === "cell" && x.row === r && x.col === c);
      if (tg) set(tg, (c === 1 && tpl?.[r]) || boxes[r][c], "align");
    }));
    return;
  }

  const regions: (Region & { page: number; text: string })[] = [];
  const m = 0.03;                                                   // the title bar spans the table, give or take a margin
  const inTable = (b: Box, k: number) =>
    k > 0 || !titleBox || (cyOf(b) >= titleBox[1] && b[0] >= titleBox[0] - m && b[2] <= titleBox[2] + m);
  for (const [k, p] of pages.entries()) {
    const texts = await ctx.regionTexts(p);
    const own = ctx.regions(p).map((r, i) => ({ ...r, page: p, text: texts[i] })).filter((r) => inTable(r.raw, k));
    regions.push(...unfold(own, t.colText));
  }
  const grid = [t.colText, ...t.rows];
  const cols = t.colText.length;
  const idx = alignGrid(grid, regions.map((g) => g.text));
  const cellPage: (number | null)[][] = grid.map((row, r) => row.map((_, c) => (idx[r][c] === null ? null : regions[idx[r][c]!].page)));
  const boxes: (Box | null)[][] = grid.map((row, r) => row.map((_, c) => (idx[r][c] === null ? null : regions[idx[r][c]!].loc)));
  // Row pages: the majority page of the row's located cells, else the previous row's.
  const rowPage: number[] = [];
  grid.forEach((_, r) => {
    const ps = cellPage[r].filter((x): x is number => x !== null);
    const n = (q: number) => ps.filter((x) => x === q).length;
    rowPage[r] = ps.length ? [...ps].sort((a, b) => n(b) - n(a) || a - b)[0] : (rowPage[r - 1] ?? p0);
  });
  // Column x-extent over all rows, row y-extent per row (from aligned cells).
  const colExt = Array.from({ length: cols }, (_, c) => unionBox(grid.map((_, r) => boxes[r][c]).filter((b): b is Box => !!b)));
  const rowExt = grid.map((_, r) => unionBox(boxes[r].filter((b): b is Box => !!b)));
  const regionOf = (pg: number, loc: Box) => regions.find((g) => g.page === pg && g.loc.join() === loc.join()) ?? null;
  const gapX = 0.012;                                              // a rule and two cell margins, at most
  /**
   * The ruled cell for (r, c) found from its neighbours: the cell just left of (r, c+1)'s cell or just right
   * of (r, c-1)'s, on the same line; failing that, the largest cell at column c's span and row r's span.
   */
  const regionAt = (r: number, c: number): Region | null => {
    const pg = rowPage[r];
    const right = c + 1 < cols && boxes[r][c + 1] ? regionOf(pg, boxes[r][c + 1]!) : null;
    const left = c > 0 && boxes[r][c - 1] ? regionOf(pg, boxes[r][c - 1]!) : null;
    const line = (g: Region, n: Region) => cyOf(g.raw) > n.raw[1] && cyOf(g.raw) < n.raw[3];
    if (right) {
      const cand = regions.filter((g) => g.page === pg && line(g, right) && g.raw[2] <= right.raw[0] + 0.002 && g.raw[2] >= right.raw[0] - gapX);
      if (cand.length) return cand.sort((a, b) => b.raw[2] - a.raw[2])[0];
    }
    if (left) {
      const cand = regions.filter((g) => g.page === pg && line(g, left) && g.raw[0] >= left.raw[2] - 0.002 && g.raw[0] <= left.raw[2] + gapX);
      if (cand.length) return cand.sort((a, b) => a.raw[0] - b.raw[0])[0];
    }
    const xe = colExt[c], ye = rowExt[r];
    if (!xe || !ye) return null;
    let best: Region | null = null, bestA = 0;
    for (const g of regions) {
      if (g.page !== pg) continue;
      const cx = cxOf(g.raw), cy = cyOf(g.raw);
      if (cx < xe[0] || cx > xe[2] || cy < ye[1] || cy > ye[3]) continue;
      const a = (g.raw[2] - g.raw[0]) * (g.raw[3] - g.raw[1]);
      if (a > bestA) { best = g; bestA = a; }
    }
    return best;
  };
  // Tables without rules (or cells the ruled pass missed): word-level alignment on the page's own words,
  // below the title, for the cells still without a box. Only single-page tables (word boxes have no page).
  const missing = grid.some((row, r) => row.some((txt, c) => txt && !boxes[r][c] && !(r > 0 && DICE_TEXT.test(txt))));
  const wordBoxes: (Box | null)[][] | null = missing && pages.length === 1
    ? align(grid, (await ctx.pageWords(p0)).filter((w) => !titleBox || cyOf(w.box) >= titleBox[1] - 0.005))
    : null;
  grid.forEach((row, r) => row.forEach((txt, c) => {
    const tg = r === 0
      ? find((x) => x.kind === "col" && x.col === c)
      : find((x) => x.kind === "cell" && x.row === r - 1 && x.col === c);
    if (!tg) return;
    tg.page = rowPage[r];
    if (r > 0 && DICE_TEXT.test(txt)) {
      tg.loc.kind = "dice";
      const g = regionAt(r, c);
      if (g) set(tg, findDice(ctx.image(rowPage[r]), g.raw), "dice");
      return;
    }
    if (boxes[r][c]) { set(tg, boxes[r][c], "align"); return; }
    const g = regionAt(r, c);
    if (g) { set(tg, g.loc, "grid"); return; }
    if (wordBoxes?.[r]?.[c]) set(tg, wordBoxes[r][c], "align");
  }));
  if (new Set(rowPage.slice(1)).size > 1) blk.rowPages = rowPage.slice(1);
  // Notes sit after the last row: on the last row's page.
  if (t.tNotes) {
    const lastPage = rowPage[rowPage.length - 1] ?? p0;
    set(find((x) => x.kind === "notes"), await findText(ctx, lastPage, t.tNotes), "align", lastPage);
  }
}

// ---------------------------------------------------------------------------------------------- simulation

interface Outcome { tg: Target; status: Status; raw: string }

async function simulate(
  tg: Target, ed: string, key: Uint8Array, src: () => { cell: CellSource; raw: () => Promise<string> } | null,
): Promise<Outcome> {
  const hashOf = (txt: string) => fieldHash(key, tg.field, tg.sid, tg.block, tg.row, tg.col, txt);
  const slot = tg.slot.h[ed];
  if (!tg.truth) return { tg, status: "empty", raw: "" };
  const expected = hashOf(tg.truth);
  slot.v[tg.slot.i] = expected;
  const guessed = (raw: string): Outcome | null => (tg.guess && (guessCell(expected, hashOf) !== undefined || (raw !== "" && (guessDicePrefixed(expected, raw, hashOf) !== undefined || guessLabelled(expected, raw, hashOf) !== undefined || guessSlice(expected, raw, hashOf) !== undefined || guessInterrupt(expected, raw, hashOf) !== undefined || guessJoined(expected, raw, hashOf) !== undefined))) ? { tg, status: "guess", raw } : null);
  if (tg.located === "none") return guessed("") ?? { tg, status: "unlocated", raw: "" };
  const s = src();
  if (!s) return guessed("") ?? { tg, status: "unlocated", raw: "" };
  const raw = norm(await s.raw());
  if (hashOf(raw) === expected) return { tg, status: "raw", raw };
  // What the runtime gets without a patch: confusion search (OCR, text) or other pip thresholds.
  const r1 = await verifyCell(s.cell, expected, hashOf, undefined, hashOf);
  if (r1.ok) return { tg, status: "confusion", raw };
  const p = makePatch(raw, norm(tg.truth));
  if (p && p.length && honestPatch(p, norm(tg.truth))) {
    (slot.patch ??= {})[hashOf(raw)] = p;
    const r2 = await verifyCell(s.cell, expected, hashOf, slot.patch, hashOf);
    if (!r2.ok) throw new Error(`patch did not verify: ${tg.sid} ${tg.field} ${tg.block} ${tg.row} ${tg.col}`);
    return { tg, status: "patch", raw };
  }
  return guessed(raw) ?? { tg, status: "fail", raw };
}

// ---------------------------------------------------------------------------------------------- per edition

interface EdRun { file: EditionFile; edition: Edition; outcomes: Outcome[]; seconds: number; renders: number; key: Uint8Array }

async function runEdition(file: EditionFile, plan: BookPlan, pool: Pool, isRef: boolean,
  refAspect: Map<number, boolean> | null): Promise<EdRun & { aspect: Map<number, boolean>; doc: PdfDoc }> {
  const start = Date.now();
  const bytes = readFileSync(ROOT + "books/" + file.file);
  const { fp, key } = await digestFile(new Blob([bytes]));
  if ((FREE_FP[file.book] ?? []).includes(fp)) throw new Error(`${file.file} is the free edition`);
  const doc = await openPdf(new Uint8Array(bytes), { standardFontDataUrl: APP + "public/pdfjs/standard_fonts/" });
  log(`${file.id}: ${file.file} fp ${fp.slice(0, 12)}… ${doc.pages} pages`);

  // Page orientation (landscape?) per page; pages whose orientation differs from the reference edition's
  // are rotated by file.rotate, and listed in the manifest as rotatePages.
  const aspect = new Map<number, boolean>();
  for (let p = 1; p <= doc.pages; p++) { const im = await doc.render(p, 0.02, 0); aspect.set(p, im.width > im.height); }
  const rotatePages: number[] = [];
  if (isRef && file.rotate) rotatePages.push(...refRotatePages(file.book).filter((p) => p <= doc.pages));
  if (!isRef && file.rotate && refAspect) {
    for (const [p, land] of aspect) if (refAspect.has(p) && refAspect.get(p) !== land) rotatePages.push(p);
  }
  const rotOf = (p: number) => (rotatePages.includes(p) ? file.rotate ?? 0 : 0);
  const edition: Edition = { id: file.id, fp, pages: doc.pages };
  if (file.rotate && rotatePages.length) { edition.rotate = file.rotate; edition.rotatePages = rotatePages; }

  // Page caches: text items (all, small), renders (a few), words (reference edition, all).
  const items = new Map<number, Promise<TextItem[]>>();
  const textItems = (p: number) => { let v = items.get(p); if (!v) items.set(p, (v = doc.textItems(p))); return v; };
  const renders = new Map<number, RGBAImage>();
  let nRenders = 0;
  const image = async (p: number) => {
    let im = renders.get(p);
    if (!im) {
      if (TRACE) log(`${file.id} render p${p}`);
      im = await doc.render(p, RENDER_SCALE, rotOf(p));
      nRenders++;
      renders.set(p, im);
      while (renders.size > 6) renders.delete(renders.keys().next().value!);
    }
    return im;
  };
  // OCR of a Loc box, memoised: the locator's reads of ruled cells are the simulation's reads too.
  const memo = new Map<string, Promise<string>>();
  const read = (p: number, box: Box): Promise<string> => {
    const k = `${p}|${box.join(",")}`;
    let pr = memo.get(k);
    if (!pr) {
      const c = ocrCrop(renders.get(p)!, box);                       // cut now, while the page is cached
      if (TRACE) log(`${file.id} read p${p} ${c.width}x${c.height}`);
      memo.set(k, (pr = pool.run((o) => o.read(c))));
    }
    return pr;
  };
  // Reference edition only: page words, ruled cells and their OCR tokens.
  const pageWords = new Map<number, Promise<Word[]>>();
  const regions = new Map<number, Region[]>();
  const regionTexts = new Map<number, Promise<string[]>>();
  const regionsOf = (p: number): Region[] => {
    let r = regions.get(p);
    if (!r) {
      const im = renders.get(p)!;
      const dx = CROP_PAD.ocr + INSET / im.width, dy = CROP_PAD.ocr + INSET / im.height;
      r = orderCells(detectCells(im)).map((b) => ({ raw: b, loc: round5([b[0] + dx, b[1] + dy, b[2] - dx, b[3] - dy]) }))
        .filter((g) => g.loc[2] > g.loc[0] && g.loc[3] > g.loc[1]);
      regions.set(p, r);
    }
    return r;
  };
  const ctx: LocateCtx = {
    image: (q) => renders.get(q)!,
    regions: regionsOf,
    pageWords(q) {
      let v = pageWords.get(q);
      if (!v) {
        const im = renders.get(q)!, t = Date.now();
        pageWords.set(q, (v = pool.run((o) => o.words(im), true).then((ws) => {
          log(`${file.id} p${q}: ${ws.length} page words (${((Date.now() - t) / 1000).toFixed(1)}s)`);
          return ws;
        })));
      }
      return v;
    },
    regionTexts(q) {
      let v = regionTexts.get(q);
      if (!v) {
        const rs = regionsOf(q), t = Date.now();
        regionTexts.set(q, (v = Promise.all(rs.map((g) => read(q, g.loc))).then((texts) => {
          log(`${file.id} p${q}: ${rs.length} ruled cells read (${((Date.now() - t) / 1000).toFixed(1)}s)`);
          if (process.env.LOC_DEBUG_PAGE === String(q)) texts.forEach((x, i) => console.log(i, rs[i].loc.join(","), JSON.stringify(x)));
          return texts;
        })));
      }
      return v;
    },
  };

  const inRange = (u: Unit) => !PAGES || u.pages.every((p) => p >= PAGES[0] && p <= PAGES[1]);
  const units = plan.units.filter(inRange);
  const pages = [...new Set(units.flatMap((u) => u.pages))].sort((a, b) => a - b);
  const done = new Set<Unit>();
  const pending: Promise<Outcome>[] = [];
  const outcomes: Outcome[] = [];

  for (const p of pages) {
    const need = units.filter((u) => !done.has(u) && u.ocr && u.pages.includes(p));
    if (need.length) await image(p);
    const ready = units.filter((u) => !done.has(u) && Math.max(...u.pages) <= p);
    for (const u of ready) {
      done.add(u);
      if (u.ocr) for (const q of u.pages) await image(q);       // in cache: pages are processed in order
      if (isRef && u.locate) await u.locate(ctx);
      for (const tg of u.targets) {
        const pg = tg.page;
        // The importer's reader (cellSource). Crops are cut now, while the page is in the cache; OCR runs in the pool.
        const s = cellSource(tg.loc, { rot: rotOf(pg), textItems: () => textItems(pg), image: () => renders.get(pg), read: (box) => read(pg, box) });
        pending.push(simulate(tg, file.id, key, () => s).then((o) => (outcomes.push(o), o)));
      }
    }
    if (pool.queued > 400) await pool.drain(100);
    if (outcomes.length && p % 10 === 0) log(`${file.id} p${p}: ${outcomes.length}/${pending.length} fields simulated`);
  }
  await Promise.all(pending);
  const seconds = (Date.now() - start) / 1000;
  log(`${file.id}: ${outcomes.length} fields in ${seconds.toFixed(0)}s, ${nRenders} page renders`);
  return { file, edition, outcomes, seconds, renders: nRenders, aspect, doc, key };
}

// ---------------------------------------------------------------------------------------------- coverage

interface Cov {
  edition: string; book: string;
  seconds: number | null; renders: number | null;   // null when recomputed from locator-debug.json
  recomputed?: true;
  cells: number; raw: number; patch: number; confusion: number; unverified: number; unlocated: number; gridLocated: number;
  rows: number; rowsVerified: number; rowPct: number;
  byClass: Record<TableClass | "all", RowCov>;
  other: Record<string, { n: number; ok: number; patch: number; unlocated: number }>;
}

function coverage(run: EdRun): Cov {
  const cells = run.outcomes.filter((o) => o.tg.kind === "cell" && o.status !== "empty");
  const ok = (o: Outcome) => o.status === "raw" || o.status === "patch" || o.status === "confusion" || o.status === "guess";
  const byClass = rowCoverage(cells.map((o) => ({ cls: o.tg.tableRow!.cls, row: o.tg.tableRow!.key, ok: ok(o) })));
  const other: Cov["other"] = {};
  for (const o of run.outcomes) {
    if (o.tg.kind === "cell" || o.status === "empty") continue;
    const k = o.tg.kind;
    other[k] ??= { n: 0, ok: 0, patch: 0, unlocated: 0 };
    other[k].n++;
    if (ok(o)) other[k].ok++;
    if (o.status === "patch") other[k].patch++;
    if (o.status === "unlocated") other[k].unlocated++;
  }
  return {
    edition: run.file.id, book: run.file.book, seconds: Math.round(run.seconds), renders: run.renders,
    cells: cells.length,
    raw: cells.filter((o) => o.status === "raw").length,
    patch: cells.filter((o) => o.status === "patch").length,
    confusion: cells.filter((o) => o.status === "confusion" || o.status === "guess").length,
    unverified: cells.filter((o) => !ok(o)).length,
    unlocated: cells.filter((o) => o.status === "unlocated").length,
    gridLocated: cells.filter((o) => o.tg.located === "grid").length,
    rows: byClass.all.rows, rowsVerified: byClass.all.verified, rowPct: byClass.all.pct, byClass,
    other,
  };
}

function printCoverage(cs: Cov[]): void {
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log("\nedition  book     cells  raw    patch  confus unverif (unloc) | rows   verified  %     | secs");
  for (const c of cs) {
    console.log(`${c.edition.padEnd(8)} ${c.book.padEnd(8)}${pad(c.cells, 6)}${pad(c.raw, 7)}${pad(c.patch, 7)}${pad(c.confusion, 7)}${pad(c.unverified, 8)} ${pad(`(${c.unlocated})`, 6)} |${pad(c.rows, 6)}${pad(c.rowsVerified, 10)}${pad(c.rowPct, 6)} |${pad(c.seconds ?? "-", 5)}`);
    for (const k of ["text", "trans", "card"] as const) {
      const r = c.byClass[k];
      console.log(`         rows ${k.padEnd(6)} ${pad(r.verified, 5)}/${r.rows} = ${r.pct}%${k === "card" ? " (creature cards: exempt from the gate)" : ""}`);
    }
    for (const [k, v] of Object.entries(c.other)) {
      console.log(`         ${k.padEnd(8)} ${pad(v.n, 5)} fields, ${pad(v.ok, 5)} verified (${v.patch} via patch), ${v.unlocated} unlocated`);
    }
  }
}

function printGate(covs: Cov[]): void {
  const c = covs.find((x) => x.book === GATE.book && x.edition === GATE.edition);
  if (!c) return;
  const g = gateFigure(c.byClass);
  console.log(`\nGATE Codex ${GATE.edition}, ordinary tables (${GATE.classes.join(" + ")}): ${g.verified}/${g.rows} = ${g.pct}% ` +
    `(target ${GATE.minPct}%) ${g.pass ? "PASS" : "FAIL"}; all rows incl. cards ${c.rowsVerified}/${c.rows} = ${c.rowPct}%`);
}

interface DebugMarker { full: boolean; editions: string[]; skeletonSha256: string; date: string }

/**
 * --coverage-from-debug: coverage recomputed from locator-debug.json and the skeleton, with no PDF and no
 * OCR. The file must come from a full run (marker.full) over every edition, against this very skeleton
 * (SHA-256); anything else is refused. A field with no recorded outcome counts as unverified ("missing").
 * Timings and render counts are not known here and are left null.
 */
function coverageFromDebug(): void {
  type D = { ed: string; sid: string; kind: Target["kind"]; block: number; row: number; col: number; status: Status; located: Target["located"] };
  const file = JSON.parse(readFileSync(WORK + `locator-debug${SUF}.json`, "utf8")) as { marker?: DebugMarker; fields?: D[] };
  const m = file.marker;
  const fail = (why: string): never => { throw new Error(`--coverage-from-debug: locator-debug.json refused: ${why}. Re-run: npm run locator -- --dump`); };
  if (!m || !Array.isArray(file.fields)) fail("no full-run marker");
  if (!m!.full) fail("it was written by a partial run");
  if (m!.skeletonSha256 !== SKELETON_SHA256) fail("it was built from a different skeleton.json");
  const missingEds = EDITIONS.map((e) => e.id).filter((id) => !m!.editions.includes(id));
  if (missingEds.length) fail(`editions not covered: ${missingEds.join(", ")}`);

  const ok = (st: Status | undefined) => st === "raw" || st === "patch" || st === "confusion" || st === "guess";
  const covs: Cov[] = [];
  for (const ed of EDITIONS) {
    const mine = file.fields!.filter((d) => d.ed === ed.id);
    const at = new Map(mine.map((d) => [`${d.sid}|${d.kind}|${d.block}|${d.row}|${d.col}`, d]));
    const cells: { cls: TableClass; row: string; ok: boolean; d: D | undefined }[] = [];
    for (const s of skeleton.filter((x) => x.book === ed.book)) {
      s.blocks.forEach((b, bi) => {
        if (b.type !== "table") return;
        const cls = tableClass(b.table!.columns, b.src);
        b.table!.rows.forEach((r, ri) => r.forEach((txt, c) => {
          if (!plain(txt)) return;
          const d = at.get(`${s.id}|cell|${bi}|${ri}|${c}`);
          cells.push({ cls, row: `${s.id}#${bi}#${ri}`, ok: ok(d?.status), d });
        }));
      });
    }
    const missing = cells.filter((c) => !c.d).length;
    if (missing) console.warn(`WARNING ${ed.id}: ${missing} cells have no recorded outcome; counted as unverified`);
    const other: Cov["other"] = {};
    for (const d of mine) {
      if (d.kind === "cell") continue;
      other[d.kind] ??= { n: 0, ok: 0, patch: 0, unlocated: 0 };
      other[d.kind].n++;
      if (ok(d.status)) other[d.kind].ok++;
      if (d.status === "patch") other[d.kind].patch++;
      if (d.status === "unlocated") other[d.kind].unlocated++;
    }
    const byClass = rowCoverage(cells);
    const st = (c: { d: D | undefined }) => c.d?.status;
    covs.push({
      edition: ed.id, book: ed.book, seconds: null, renders: null, recomputed: true,
      cells: cells.length,
      raw: cells.filter((c) => st(c) === "raw").length,
      patch: cells.filter((c) => st(c) === "patch").length,
      confusion: cells.filter((c) => st(c) === "confusion" || st(c) === "guess").length,
      unverified: cells.filter((c) => !c.ok).length,
      unlocated: cells.filter((c) => st(c) === "unlocated").length,
      gridLocated: cells.filter((c) => c.d?.located === "grid").length,
      rows: byClass.all.rows, rowsVerified: byClass.all.verified, rowPct: byClass.all.pct, byClass,
      other,
    });
  }
  printCoverage(covs);
  printGate(covs);
  writeFileSync(WORK + `coverage${SUF}.json`, JSON.stringify({ date: new Date().toISOString(), from: { file: "locator-debug.json", marker: m }, editions: covs }, null, 2));
  log("wrote pipeline/work/coverage.json (recomputed from locator-debug.json)");
}

// ---------------------------------------------------------------------------------------------- main

async function main(): Promise<void> {
  const ocrs = await Promise.all(Array.from({ length: WORKERS }, () =>
    createOcr({ workerPath: "", corePath: "", langPath: APP + "public/ocr/lang" })));
  const pool = new Pool(ocrs);
  const books = [...new Set(EDITIONS.map((e) => e.book))].filter((b) => !ONLY_BOOK || b === ONLY_BOOK);
  const manifest: Manifest = {
    version: 1,
    books: GAME === "dungeon" ? [{ slug: "core", name: "Core Rules", free: true, editions: [] }] : [],
    sections: [],
    codes: {},
  };
  const covs: Cov[] = [];
  const debug: unknown[] = [];
  const runEds: string[] = [];
  const keys = new Map<string, Map<string, Uint8Array>>();
  for (const book of books) {
    const files = EDITIONS.filter((e) => e.book === book);
    const plan = planBook(book, files.map((f) => f.id));
    log(`${book}: ${plan.sections.length} sections, ${plan.units.length} units`);
    const editions: Edition[] = [];
    let refAspect: Map<number, boolean> | null = null;
    for (const [k, file] of files.entries()) {
      const isRef = k === 0;
      if (ONLY_ED && file.id !== ONLY_ED && !isRef) continue;         // the reference edition always runs (it locates)
      const run = await runEdition(file, plan, pool, isRef, refAspect);
      if (isRef) refAspect = run.aspect;
      run.doc.close();
      editions.push(run.edition);
      if (!keys.has(book)) keys.set(book, new Map());
      keys.get(book)!.set(file.id, run.key);
      const c = coverage(run);
      covs.push(c);
      printCoverage([c]);
      if (DUMP) {
        runEds.push(file.id);
        for (const o of run.outcomes) {
          if (o.status === "empty") continue;
          const f = { ed: file.id, sid: o.tg.sid, kind: o.tg.kind, block: o.tg.block, row: o.tg.row, col: o.tg.col, page: o.tg.page,
            status: o.status, located: o.tg.located, box: o.tg.loc.box, loc: o.tg.loc.kind };
          debug.push(o.status === "raw" ? f : { ...f, truth: o.tg.truth, raw: o.raw });
        }
      }
    }
    const name = BOOK_NAME[book];
    manifest.books.push({ slug: book, name, free: false, editions, ...(FREE_FP[book] ? { freeFp: FREE_FP[book] } : {}) });
    manifest.sections.push(...plan.sections);
    for (const [c, id] of Object.entries(plan.codes)) if (!(c in manifest.codes)) manifest.codes[c] = id;
  }
  await pool.close();

  // Legacy ids: the keyed hash of each locked section's old title-slug id, per edition.
  for (const s of manifest.sections) {
    for (const [ed, key] of keys.get(s.book) ?? []) (s.legacy ??= {})[ed] = fieldHash(key, "legacy", oldOf.get(s.id)!, -1, -1, -1, "");
  }
  // A partial run skips editions: drop their (empty) hash slots so the cross-check holds.
  for (const s of manifest.sections) {
    const eds = new Set((keys.get(s.book) ?? new Map()).keys());
    const prune = (h: Hashes) => { for (const e of Object.keys(h)) if (!eds.has(e)) delete h[e]; };
    if (s.title) prune(s.title.h);
    for (const b of s.blocks) if (b.type !== "image") prune(b.h);
  }

  // Free codes are served by free.json; a locked section must never claim one.
  if (GAME === "dungeon") try {
    const free = JSON.parse(readFileSync(APP + "public/data/free.json", "utf8")) as { sections: { blocks: { type: string; table?: { code?: string } }[] }[] };
    for (const s of free.sections) for (const b of s.blocks) if (b.table?.code && b.table.code in manifest.codes) {
      log(`code ${b.table.code} is free: dropped from manifest.codes`);
      delete manifest.codes[b.table.code];
    }
  } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") throw e;
    log("free.json not found: free-code check skipped");
  }

  printCoverage(covs);
  printGate(covs);

  const checked = validateManifest(JSON.parse(JSON.stringify(manifest)));
  log(`manifest valid: ${checked.sections.length} sections, ${Object.keys(checked.codes).length} codes`);
  if (DUMP) {
    const marker: DebugMarker = { full: !PARTIAL, editions: runEds, skeletonSha256: SKELETON_SHA256, date: new Date().toISOString() };
    // A partial run never overwrites the full run's file (which --coverage-from-debug reads).
    const name = PARTIAL ? `locator-debug${SUF}.partial.json` : `locator-debug${SUF}.json`;
    writeFileSync(WORK + name, JSON.stringify({ marker, fields: debug }, null, 1));
    log(`debug: ${debug.length} fields -> pipeline/work/${name}`);
  }
  if (PARTIAL) { log("partial run: manifest and coverage.json not written"); return; }
  mkdirSync(APP + "public/data", { recursive: true });
  writeFileSync(OUT, JSON.stringify(checked));
  writeFileSync(WORK + `coverage${SUF}.json`, JSON.stringify({ date: new Date().toISOString(), editions: covs }, null, 2));
  log(`wrote ${OUT} (${(JSON.stringify(checked).length / 1024).toFixed(0)} KB) and pipeline/work/coverage.json`);
}

if (FROM_DEBUG) coverageFromDebug();
else main().catch((e) => { console.error(e); process.exit(1); });
