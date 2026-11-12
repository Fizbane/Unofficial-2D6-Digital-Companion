// Tesseract adapter: OCR of RGBA crops, the same calls in the browser (Worker) and in Node.
import { createWorker, OEM, PSM, type ImageLike } from "tesseract.js";
import type { Box } from "./manifest";
import { BROWSER_BUILD, isNode, type RGBAImage } from "./pdf";
import { splitLines } from "./lines";

/** Scale pages are rendered at before cropping for OCR. */
export const RENDER_SCALE = 3;

/** Padding (fraction of the page) added around a Loc box before it is cropped, by Loc kind. */
export const CROP_PAD = { ocr: 0.004, dice: 0 } as const;

/** White border (pixels) put around each line before read(): Tesseract misreads text that touches the edge. */
export const OCR_MARGIN = 12;

/** Lines thinner than this (pixels) are specks, not text: Tesseract can't scale them. */
const MIN_LINE = 4;

/** Lines are scaled up by this factor (bilinear, in plain JS so every runtime gets the same pixels). */
export const OCR_UPSCALE = 2;

/** Luminance (Rec. 601) in all three channels, opaque: Tesseract drops some words on coloured cells. */
export function grayscale(img: RGBAImage): RGBAImage {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = g;
    data[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

/** Bilinear resize by an integer-free factor, pixel centres aligned; deterministic. */
export function upscale(img: RGBAImage, f: number): RGBAImage {
  if (f === 1 || !img.width || !img.height) return img;
  const width = Math.round(img.width * f), height = Math.round(img.height * f);
  const out = new Uint8ClampedArray(width * height * 4);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4, o = (y * width + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = data[a + k] + (data[b + k] - data[a + k]) * fx;
        const bot = data[c + k] + (data[d + k] - data[c + k]) * fx;
        out[o + k] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return { width, height, data: out };
}

/** The image on a white canvas `m` pixels larger on every side. */
export function withMargin(img: RGBAImage, m: number): RGBAImage {
  const width = img.width + 2 * m, height = img.height + 2 * m;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < img.height; y++) {
    data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + m) * width + m) * 4);
  }
  return { width, height, data };
}

export interface Ocr {
  /**
   * All text in the image: split into lines (splitLines), each made grey, scaled by OCR_UPSCALE, put on a white
   * margin of OCR_MARGIN pixels and read as a single line; the lines are joined with spaces.
   */
  read(img: RGBAImage): Promise<string>;
  /** Words found by automatic page segmentation, with 0–1 boxes relative to the image. */
  words(img: RGBAImage): Promise<{ text: string; box: Box }[]>;
  close(): Promise<void>;
}

type NapiCanvas = { createCanvas(w: number, h: number): { getContext(t: "2d"): { putImageData(d: unknown, x: number, y: number): void }; encodeSync(f: "png"): Uint8Array }; ImageData: new (d: Uint8ClampedArray, w: number, h: number) => unknown };

let napi: Promise<NapiCanvas> | null = null;
function loadNapi(): Promise<NapiCanvas> {
  const spec = "@napi-rs/canvas";                                   // a variable, so Vite never bundles it
  return (napi ??= import(/* @vite-ignore */ spec) as Promise<NapiCanvas>);
}

/** A PNG tesseract.js accepts: a Buffer (from @napi-rs/canvas) in Node, a Blob in the browser. */
async function toPng(img: RGBAImage): Promise<ImageLike> {
  if (!BROWSER_BUILD && isNode()) {
    const { createCanvas, ImageData } = await loadNapi();
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext("2d").putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    // Synchronous: async encodes run on libuv threads and crashed @napi-rs/canvas (segfault) while pdf.js
    // rendered on the main thread.
    return canvas.encodeSync("png") as unknown as ImageLike;        // a Node Buffer
  }
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

type OcrPaths = { workerPath: string; corePath: string; langPath: string };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;                      // "https://", "file://", "blob://"…

/** A relative URL, or an absolute one on the page's own origin. */
function sameOrigin(url: string): boolean {
  if (url.startsWith("//")) return false;                           // protocol-relative: another host
  if (!HAS_SCHEME.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
  const here = (globalThis as { location?: { href: string; origin: string } }).location;
  try { return !!here && new URL(url, here.href).origin === here.origin; } catch { return false; }
}

/**
 * Rejects paths that would make tesseract.js reach its jsdelivr CDN fallback (empty ones) or another host.
 * Browser: workerPath, corePath and langPath must be non-empty, relative or same-origin URLs.
 * Node: langPath must be a non-empty filesystem path (no URL scheme); workerPath/corePath are not used.
 */
export function checkOcrPaths(paths: OcrPaths, node: boolean): void {
  const keys = node ? (["langPath"] as const) : (["workerPath", "corePath", "langPath"] as const);
  for (const k of keys) {
    const v = paths[k];
    if (typeof v !== "string" || v.trim() === "") throw new Error(`createOcr: ${k} is required`);
    if (node ? HAS_SCHEME.test(v) || v.startsWith("//") : !sameOrigin(v)) {
      throw new Error(`createOcr: ${k} must be ${node ? "a filesystem path" : "a relative or same-origin URL"}: ${v}`);
    }
  }
}

/** The part of a tesseract.js worker the adapter uses (a fake one in unit tests). */
export interface OcrWorker {
  setParameters(params: { tessedit_pageseg_mode: PSM }): Promise<unknown>;
  recognize(image: ImageLike, options?: object, output?: { blocks?: boolean }): Promise<{ data: {
    text: string;
    blocks?: { paragraphs: { lines: { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null;
  } }>;
  terminate(): Promise<unknown>;
}

/**
 * Wraps a worker. Each "set page-segmentation mode + recognize" pair runs alone through a promise queue,
 * so concurrent read() and words() calls can never recognize under each other's mode.
 */
export function ocrFromWorker(worker: OcrWorker, encode: (img: RGBAImage) => Promise<ImageLike> = toPng): Ocr {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  return {
    async read(img) {
      if (!img.width || !img.height) return "";
      const lines = splitLines(img).filter((l) => l.width >= MIN_LINE && l.height >= MIN_LINE);
      const pngs = await Promise.all(lines.map((line) => encode(withMargin(upscale(grayscale(line), OCR_UPSCALE), OCR_MARGIN))));
      if (!pngs.length) return "";
      return serial(async () => {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const out: string[] = [];
        for (const png of pngs) out.push((await worker.recognize(png)).data.text.trim());
        return out.filter(Boolean).join(" ");
      });
    },

    async words(img) {
      if (!img.width || !img.height) return [];
      const png = await encode(img);
      const { data } = await serial(async () => {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        return worker.recognize(png, {}, { blocks: true });
      });
      const out: { text: string; box: Box }[] = [];
      const cl = (v: number) => Math.min(1, Math.max(0, v));
      for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) for (const w of line.words) {
        const { x0, y0, x1, y1 } = w.bbox;
        out.push({ text: w.text, box: [cl(x0 / img.width), cl(y0 / img.height), cl(x1 / img.width), cl(y1 / img.height)] });
      }
      return out;
    },

    async close() {
      await serial(() => worker.terminate());
    },
  };
}

/**
 * A Tesseract worker using vendored files only (see checkOcrPaths). In Node `workerPath`/`corePath` are
 * ignored (tesseract.js uses its bundled Node defaults), `langPath` is a filesystem folder and the
 * traineddata cache is off, so nothing outside the project is ever read as language data.
 */
export async function createOcr(paths: OcrPaths): Promise<Ocr> {
  const node = !BROWSER_BUILD && isNode();
  checkOcrPaths(paths, node);
  const options: Record<string, unknown> = { langPath: paths.langPath, workerBlobURL: false, gzip: true };
  if (node) options.cacheMethod = "none";
  else Object.assign(options, { workerPath: paths.workerPath, corePath: paths.corePath });
  const worker = await createWorker("eng", OEM.LSTM_ONLY, options);
  return ocrFromWorker(worker as unknown as OcrWorker);
}
