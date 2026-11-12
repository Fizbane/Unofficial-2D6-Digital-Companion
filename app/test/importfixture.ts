// Shared fixture for the importer tests: a fake two-page Codex built with the real hash core.
import { vi } from "vitest";
import { digestFile, fieldHash, makePatch, type HashField } from "../src/lock/hash";
import { hashIndex, validateManifest, type Manifest } from "../src/lock/manifest";
import * as store from "../src/lock/store";
import type { PdfDoc, RGBAImage } from "../src/lock/pdf";
import type { Ocr } from "../src/lock/ocr";
import type { TextItem } from "../src/lock/extract";

// ------------------------------------------------------------------------------------------- fixture

const bytes = (seed: string, n: number) => new TextEncoder().encode(seed.repeat(n));
export const FILE = new Blob([bytes("fake tablet codex pdf ", 4000)]);
export const FREE_FILE = new Blob([bytes("free codex pdf ", 3000)]);
export const { fp: FP, key: KEY } = await digestFile(FILE);
export const { fp: FREE_FP } = await digestFile(FREE_FILE);

export const S1 = "codex/p1-1";
export const S2 = "codex/p2-1";
export const OLD1 = "codex/treasure-table";
const H = (f: HashField, sid: string, block: number, row: number, col: number, text: string) => fieldHash(KEY, f, sid, block, row, col, text);

/** Grid cell (r, c) of a 10 × 10 page grid, inset. The fake render paints each grid cell's index into G. */
const cell = (r: number, c: number): [number, number, number, number] => [c / 10 + 0.01, r / 10 + 0.01, (c + 1) / 10 - 0.01, (r + 1) / 10 - 0.01];

// Table 1 (page 1, 2 cols × 3 rows, OCR): truths and what the fake OCR reads.
const T1 = [["Gold", "10"], ["Silver", "Shield"], ["Helmet", "5"]];
const OCR1 = [["Gold", "1O"], ["Si1ver", "Xyzzy"], ["Hemlet", "5"]];

function buildManifest(): Manifest {
  const cols = 2;
  const v1 = new Array<string>(3 + cols + T1.length * cols).fill("");
  T1.forEach((row, r) => row.forEach((t, c) => (v1[hashIndex(cols, { row: r, col: c })] = H("cell", S1, 0, r, c, t))));
  const patch = makePatch("Hemlet", "Helmet")!;
  const v2 = new Array<string>(3 + 2 + 2).fill("");
  v2[hashIndex(2, { row: 0, col: 0 })] = H("cell", S2, 2, 0, 0, "[3]");
  v2[hashIndex(2, { row: 0, col: 1 })] = H("cell", S2, 2, 0, 1, "Nothing");
  const m = {
    version: 1,
    books: [
      { slug: "core", name: "Core Rules", free: true, editions: [] },
      { slug: "codex", name: "Tables Codex", free: false, editions: [{ id: "tablet", fp: FP, pages: 2 }], freeFp: [FREE_FP] },
    ],
    sections: [
      {
        id: S1, book: "codex", level: 2, chapter: null, pages: [1],
        legacy: { tablet: fieldHash(KEY, "legacy", OLD1, -1, -1, -1, "") },
        title: { page: 1, loc: { box: [0, 0.9, 1, 1], kind: "text" }, h: { tablet: { v: [H("title", S1, -1, -1, -1, "Treasure")] } } },
        blocks: [{
          type: "table", page: 1, dice: "1D6", cols, rows: 3,
          cells: T1.map((row, r) => row.map((_, c) => ({ box: cell(r + 1, c), kind: "ocr" }))),
          h: { tablet: { v: v1, patch: { [H("cell", S1, 0, 2, 0, "Hemlet")]: patch } } },
        }],
      },
      {
        id: S2, book: "codex", level: 2, chapter: null, pages: [2],
        blocks: [
          { type: "heading", page: 2, level: 2, loc: { box: [0, 0, 1, 0.05], kind: "text" }, h: { tablet: { v: [H("heading", S2, 0, -1, -1, "Chapter Two")] } } },
          { type: "para", page: 2, loc: { box: cell(5, 5), kind: "ocr" }, h: { tablet: { v: [H("para", S2, 1, -1, -1, "The end.")] } } },
          {
            type: "table", page: 2, dice: "1D6", cols: 2, rows: 1,
            cells: [[{ box: [0, 0, 0, 0], kind: "dice" }, { box: cell(2, 1), kind: "ocr" }]],
            h: { tablet: { v: v2 } },
          },
          { type: "image", page: 2, box: [0, 0.5, 1, 1] },
        ],
      },
    ],
    codes: {},
  };
  return validateManifest(m);
}
export const MANIFEST = buildManifest();

/** Planned OCR output by `${page}:${gridIndex}`. */
const PLAN: Record<string, string> = { "2:55": "The end.", "2:21": "Nothing" };
OCR1.forEach((row, r) => row.forEach((t, c) => (PLAN[`1:${(r + 1) * 10 + c}`] = t)));

const TEXT: Record<number, TextItem[]> = {
  1: [{ str: "Treasure", x: 0.1, y: 0.93, w: 0.3, h: 0.03, bold: false, italic: false }],
  2: [{ str: "Chapter Two", x: 0.1, y: 0.01, w: 0.3, h: 0.03, bold: false, italic: false }],
};

export interface Fakes {
  doc: PdfDoc;
  ocr: Ocr;
  reads: number[];            // page of every OCR read
  renders: { page: number; scale: number }[];
  openPdf: ReturnType<typeof vi.fn>;
  onRead?: (page: number) => void | Promise<void>;
}

export function fakes(): Fakes {
  const f = {} as Fakes;
  f.reads = [];
  f.renders = [];
  f.doc = {
    pages: 2,
    textItems: async (p) => TEXT[p] ?? [],
    async render(p, scale): Promise<RGBAImage> {
      f.renders.push({ page: p, scale });
      const w = 300, h = 300;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        data[o] = p;
        data[o + 1] = Math.floor(y / 30) * 10 + Math.floor(x / 30);
        data[o + 2] = 200;
        data[o + 3] = 255;
      }
      return { width: w, height: h, data };
    },
    close() {},
  };
  f.ocr = {
    async read(img) {
      const o = ((img.height >> 1) * img.width + (img.width >> 1)) * 4;
      const page = img.data[o];
      f.reads.push(page);
      await f.onRead?.(page);
      return PLAN[`${page}:${img.data[o + 1]}`] ?? "";
    },
    async words() { return []; },
    async close() {},
  };
  f.openPdf = vi.fn(async () => f.doc);
  return f;
}

export const deps = (f: Fakes, signal = new AbortController().signal, onProgress = (_p: { phase: string; done: number; total: number }) => {}) => ({
  manifest: MANIFEST,
  openPdf: f.openPdf as unknown as (data: Uint8Array) => Promise<PdfDoc>,
  createOcr: async () => f.ocr,
  store,
  signal,
  onProgress,
  encodePage: async (img: RGBAImage) => new Blob([new Uint8Array(img.data.subarray(0, 4))], { type: "image/webp" }),
});

