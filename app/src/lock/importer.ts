// The on-device importer: the owner's PDF in, verified sections and page images in IndexedDB out.
// Pure orchestration: pdf.js, Tesseract, the store and the page encoder are injected (the Web Worker binds
// the real ones, the tests fakes). The file never leaves the device and none of its text is logged.
import { digestFile, fieldHash } from "./hash";
import type { Edition, Manifest, SkelSection } from "./manifest";
import type { PdfDoc, RGBAImage } from "./pdf";
import type { Ocr } from "./ocr";
import type { TextItem } from "./extract";
import { RENDER_SCALE } from "./ocr";
import { verifyCell } from "./verify";
import { guessCell, guessDicePrefixed, guessLabelled } from "./closedset";
import { cellSource, ocrCrop, type PageReader } from "./cellsource";
import {
  expectedHash, fieldsOf, pageRotation, rebuildSection, rowCounts, sectionPages, unlocated, type CellResult, type Field,
} from "./rebuild";
import type * as Store from "./store";

// Legacy ids are remapped on the main thread (it has localStorage): see legacy.ts, ui/books.ts and library.ts.

/** Scale and WebP quality of the saved page images (shown as "original page" and cropped beside unverified cells). */
export const PAGE_SCALE = 1.5;
export const PAGE_QUALITY = 0.8;

export type ImportReport =
  | { kind: "free" }
  | { kind: "unknown" }
  | { kind: "done"; book: string; edition: string; rows: number; verified: number; unverified: number;
      /**
       * available: stored patch entries for this book and edition in the manifest. tried: patches whose key
       * matched a raw reading in this run (a resumed run counts only its own pages). hit: those that verified.
       */
      patches?: { available: number; tried: number; hit: number } };

export type ImportProgress = { phase: "hash" | "pages"; done: number; total: number };

export interface ImportDeps {
  manifest: Manifest;
  openPdf(data: Uint8Array): Promise<PdfDoc>;
  createOcr(): Promise<Ocr>;
  store: typeof Store;
  signal: AbortSignal;
  onProgress(p: ImportProgress): void;
  /** A heartbeat for the page's stall watchdog: after the OCR starts, and at most every ALIVE_MS in the field loop. */
  onAlive?(): void;
  /** Page image encoder; default: WebP via OffscreenCanvas. */
  encodePage?(img: RGBAImage): Promise<Blob>;
}

/** The run stopped: cancelled, or the books were locked (forgotten) while it ran. */
export class ImportCancelled extends Error {
  constructor() {
    super("import cancelled");
    this.name = "ImportCancelled";
  }
}

/** A page image as WebP (OffscreenCanvas, so it works inside the Worker). */
export async function webpPage(img: RGBAImage): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  // pdf.ts hands over a fresh, unshared buffer, so it goes into ImageData without a copy.
  canvas.getContext("2d")!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return canvas.convertToBlob({ type: "image/webp", quality: PAGE_QUALITY });
}

/** `last`: the section's last page, or 0 when it has none (it is then stored at the first page done). */
export const ALIVE_MS = 10_000;

interface Plan { s: SkelSection; fields: Field[]; last: number }

/** Reads and verifies one field. Empty fields (no hash) are not read; unlocated ones are unverified. */
async function readField(
  sid: string, f: Field, ed: string, key: Uint8Array, page: PageReader, stats: { tried: number; hit: number }, guess = false,
): Promise<CellResult> {
  const expected = expectedHash(f, ed);
  if (expected === "") return { text: "", ok: true };
  const hashOf = (t: string) => fieldHash(key, f.field, sid, f.block, f.row, f.col, t);
  /** A cell that can't be read from the page: try the closed set of card values (see closedset.ts). */
  const guessed = (): CellResult => {
    const g = guess ? guessCell(expected, hashOf) : undefined;
    return g === undefined ? { text: "", ok: false } : { text: g, ok: true };
  };
  if (unlocated(f.loc)) return guessed();
  const src = cellSource(f.loc!, page);
  if (!src) return guessed();
  await src.raw();
  const r = await verifyCell(src.cell, expected, hashOf, f.h[ed]?.patch, hashOf);
  if (r.patch) stats.tried++;
  if (r.patch === "hit") stats.hit++;
  if (!r.ok) {
    const g = guessed();
    if (g.ok) return g;
    const d = guess ? guessDicePrefixed(expected, r.text, hashOf) : undefined;
    if (d !== undefined) return { text: d, ok: true };
    const l = guess ? guessLabelled(expected, r.text, hashOf) : undefined;
    if (l !== undefined) return { text: l, ok: true };
  }
  return { text: r.text, ok: r.ok };
}

/** Two-column tables (creature cards) get the closed-set guess for cells that can't be read. */
const guessable = (pl: { s: SkelSection }, f: Field): boolean => {
  if (f.block < 0 || (f.field !== "cell" && f.field !== "col")) return false;
  const b = pl.s.blocks[f.block];
  return b?.type === "table" && b.cols === 2;
};

/**
 * Fingerprints the file and, for a known edition, reads every locked field of its book page by page.
 * Each page is rendered once at PAGE_SCALE for its saved image, and once at RENDER_SCALE when it has OCR or
 * dice fields. A section is stored as soon as all its pages are done; progress is saved after each page,
 * so a later run of the same file resumes after the last finished page. Throws ImportCancelled when the
 * signal aborts or the store is forgotten (Lock) during the run.
 */
export async function runImport(file: Blob, deps: ImportDeps): Promise<ImportReport> {
  const { manifest, store, signal } = deps;
  const epoch = store.storeEpoch();
  const check = () => {
    if (signal.aborted || store.storeEpoch() !== epoch) throw new ImportCancelled();
  };

  const { fp, key } = await digestFile(file, (done, total) => deps.onProgress({ phase: "hash", done, total }));
  check();
  if (manifest.books.some((b) => b.freeFp?.includes(fp))) return { kind: "free" };
  let book: Manifest["books"][number] | undefined, edition: Edition | undefined;
  for (const b of manifest.books) {
    const e = b.editions.find((x) => x.fp === fp);
    if (e) { book = b; edition = e; break; }
  }
  if (!book || !edition) return { kind: "unknown" };
  const slug = book.slug, ed = edition.id;

  const plans: Plan[] = manifest.sections.filter((s) => s.book === slug).map((s) => {
    const fields = fieldsOf(s);
    const pages = sectionPages(s, fields);
    return { s, fields, last: pages.length ? Math.max(...pages) : 0 };
  });
  const prog = await store.getProgress(slug);
  const resumeAt = prog && prog.fp === fp ? prog.page : 0;     // pages up to here: sections stored, images saved
  const pending = plans.filter((p) => p.last === 0 || p.last > resumeAt); // a page-less one is (re)stored every run
  const results = new Map<string, Map<string, CellResult>>(pending.map((p) => [p.s.id, new Map()]));
  const stats = { tried: 0, hit: 0 };
  const encode = deps.encodePage ?? webpPage;

  check();
  const doc = await deps.openPdf(new Uint8Array(await file.arrayBuffer()));
  let lastAlive = -Infinity;
  const alive = () => {
    const t = Date.now();
    if (t - lastAlive < ALIVE_MS) return;
    lastAlive = t;
    deps.onAlive?.();
  };
  let ocr: Promise<Ocr> | undefined;
  const getOcr = () => (ocr ??= deps.createOcr().then((o) => { deps.onAlive?.(); return o; })); // the model load can be slow
  try {
    const pages = [...new Set(plans.flatMap((p) => sectionPages(p.s, p.fields)))]
      .filter((p) => p >= 1 && p <= doc.pages)
      .sort((a, b) => a - b);
    for (const [k, p] of pages.entries()) {
      check();
      const rot = pageRotation(edition, p);
      const fresh = p > resumeAt;
      if (fresh) {
        const blob = await encode(await doc.render(p, PAGE_SCALE, rot));
        check();
        await store.putPage(slug, p, blob);
      }

      const todo = pending.flatMap((pl) => pl.fields.filter((f) => f.page === p).map((f) => ({ pl, f })));
      if (todo.length) {
        const needImage = todo.some(({ f }) => f.loc && f.loc.kind !== "text" && !unlocated(f.loc) && expectedHash(f, ed) !== "");
        const img = needImage ? await doc.render(p, RENDER_SCALE, rot) : undefined;
        let items: Promise<TextItem[]> | undefined;
        const reader: PageReader = {
          rot,
          textItems: () => (items ??= doc.textItems(p)),
          image: () => img,
          read: async (box) => (await getOcr()).read(ocrCrop(img!, box)),
        };
        for (const { pl, f } of todo) {
          check();
          alive();
          results.get(pl.s.id)!.set(f.key, await readField(pl.s.id, f, ed, key, reader, stats, guessable(pl, f)));
        }
      }

      const ready = pending.filter((pl) => pl.last <= p && results.has(pl.s.id));
      if (ready.length) {
        check();
        await store.putSections(ready.map((pl) => rebuildSection(pl.s, ed, results.get(pl.s.id)!)));
        for (const pl of ready) results.delete(pl.s.id);
      }
      if (fresh) {
        check();
        await store.putProgress(slug, { page: p, fp });
      }
      deps.onProgress({ phase: "pages", done: k + 1, total: pages.length });
    }
    // Sections whose pages lie beyond the end of this file (none in a good edition): stored as read so far.
    const rest = pending.filter((pl) => results.has(pl.s.id));
    check();
    if (rest.length) await store.putSections(rest.map((pl) => rebuildSection(pl.s, ed, results.get(pl.s.id)!)));
    check();
    await store.putBook({ slug, edition: ed, fp, key, date: Date.now() });
    check();
    await store.putProgress(slug, { page: 0 });                 // done: a later run starts afresh
  } finally {
    doc.close();
    if (ocr) ocr.then((o) => o.close()).catch(() => {});
  }

  const stored = new Map((await store.getSections()).filter((s) => s.section.book === slug).map((s) => [s.section.id, new Set(s.unverified)]));
  const { rows, verified } = rowCounts(plans.map((p) => p.s), ed, (id) => stored.get(id));
  let available = 0;
  for (const { s } of plans) {
    available += Object.keys(s.title?.h[ed]?.patch ?? {}).length;
    for (const b of s.blocks) if (b.type !== "image") available += Object.keys(b.h[ed]?.patch ?? {}).length;
  }
  return { kind: "done", book: slug, edition: ed, rows, verified, unverified: rows - verified, patches: { available, ...stats } };
}
