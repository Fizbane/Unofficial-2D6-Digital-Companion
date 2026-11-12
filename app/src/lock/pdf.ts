// pdf.js adapter: text items and page rendering behind one interface that runs in the browser
// (main thread or Web Worker, via OffscreenCanvas) and in Node (legacy build + @napi-rs/canvas).
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "./extract";
import type { Box } from "./manifest";

export type RGBAImage = { width: number; height: number; data: Uint8ClampedArray };

export interface PdfDoc {
  pages: number;
  /** Text items of a 1-based page in 0–1 top-origin coordinates of the page as it displays by default. */
  textItems(page: number): Promise<TextItem[]>;
  /** RGBA pixels of a 1-based page; `rotate` is added to the page's own rotation. */
  render(page: number, scale: number, rotate: number): Promise<RGBAImage>;
  close(): void;
}

/**
 * True in a Vite browser build, where Vite replaces these with constants; the Node-only branches below are
 * then dropped, so the bundle never names the Node modules. Undefined (false) under tsx or plain Node.
 */
export const BROWSER_BUILD = import.meta.env?.SSR === false && import.meta.env?.PROD === true;

/** True in Node (not in a browser window or a Web Worker). */
export function isNode(): boolean {
  if (BROWSER_BUILD) return false;
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;   // no @types/node in the app
  return typeof window === "undefined" && typeof proc !== "undefined" && !!proc.versions?.node;
}

type CanvasAndContext = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };

/** pdf.js canvas factory backed by OffscreenCanvas, so rendering works without a DOM (inside a Worker). */
class OffscreenCanvasFactory {
  constructor(_opts?: unknown) {}
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(cc: CanvasAndContext, width: number, height: number): void {
    if (!cc.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    cc.canvas.width = width;
    cc.canvas.height = height;
  }
  destroy(cc: CanvasAndContext): void {
    if (!cc.canvas) throw new Error("Canvas is not specified");
    cc.canvas.width = 0;
    cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

/** pdf.js's base (no-op) filter factory; the DOM one needs a document, which a Worker lacks. */
class NoFilterFactory {
  constructor(_opts?: unknown) {}
  addFilter() { return "none"; }
  addHCMFilter() { return "none"; }
  addAlphaFilter() { return "none"; }
  addLuminosityFilter() { return "none"; }
  addHighlightHCMFilter() { return "none"; }
  destroy() {}
}

type PdfJs = typeof import("pdfjs-dist");

async function loadPdfJs(): Promise<PdfJs> {
  if (!BROWSER_BUILD && isNode()) {
    const spec = "pdfjs-dist/legacy/build/pdf.mjs";                // a variable, so Vite never bundles it
    return (await import(/* @vite-ignore */ spec)) as PdfJs;
  }
  // GlobalWorkerOptions.workerSrc is deliberately left unset: openPdf hands pdf.js its own Worker, and with
  // no workerSrc pdf.js has nothing to load for its in-thread "fake worker" fallback.
  return await import("pdfjs-dist");
}

/** The pdf.js worker could not start (failed to load, or crashed). Raised instead of any in-thread fallback. */
export class PdfWorkerError extends Error {
  constructor(message = "The pdf.js worker could not start") {
    super(message);
    this.name = "PdfWorkerError";
  }
}

/** How long a new pdf.js worker may take to post its "ready" handshake. */
export const PDF_WORKER_START_MS = 30_000;

/** The parts of a Worker (and of pdf.js) that runWithOwnWorker uses: fakes in tests. */
export interface WorkerPortLike {
  addEventListener(type: "message" | "error" | "messageerror", fn: (e: { data?: unknown; preventDefault?(): void }) => void): void;
  removeEventListener(type: "message" | "error" | "messageerror", fn: (e: { data?: unknown; preventDefault?(): void }) => void): void;
  postMessage(m: unknown, transfer?: unknown[]): void;
  terminate(): void;
}
export interface PdfJsLike {
  PDFWorker: { fromPort(p: { port: unknown; verbosity?: number }): { destroy(): void } };
  getDocument(params: Record<string, unknown>): { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> };
}

const isReady = (d: unknown) =>
  !!d && typeof d === "object" && (d as { sourceName?: unknown }).sourceName === "worker" && (d as { action?: unknown }).action === "ready";

/**
 * Starts pdf.js's worker as a real module Worker of our own and opens the document through it, so pdf.js
 * never falls back to its "fake worker" (pdf.worker.mjs loaded into this thread). That fallback is what
 * pdf.js 4.10 always takes inside a Web Worker: PDFWorker._initialize reads `window.location.href`, which
 * throws in a Worker, and its catch silently switches to the fake worker. In the fake worker pdf.worker's
 * auto-init then claims this Worker's own `self` port and posts its "ready" handshake to the page.
 *
 * Resolves once the worker has posted "ready" and the document has loaded; rejects with PdfWorkerError if
 * the worker fails to load or start (the Worker is then terminated). `failed` rejects if it errors later, or
 * if one of its messages can't be deserialised (`messageerror`: pdf.js would otherwise wait on it for ever).
 */
export async function runWithOwnWorker(
  lib: PdfJsLike, params: Record<string, unknown>, workerSrc: string,
  makeWorker: (src: string) => WorkerPortLike = (src) => new Worker(src, { type: "module" }) as unknown as WorkerPortLike,
  startMs = PDF_WORKER_START_MS,
): Promise<{ doc: PDFDocumentProxy; failed: Promise<never>; dispose(): void }> {
  let worker: WorkerPortLike;
  try {
    worker = makeWorker(workerSrc);
  } catch {
    throw new PdfWorkerError();
  }
  let fail!: (e: Error) => void;
  const failed = new Promise<never>((_, rej) => (fail = rej));
  failed.catch(() => {});                                          // observed by whoever races it
  const onError = (e: { preventDefault?(): void }) => {
    e.preventDefault?.();                                          // handled here: not re-reported to our page
    fail(new PdfWorkerError());
  };
  worker.addEventListener("error", onError);
  const onMessageError = () => fail(new PdfWorkerError("A pdf.js worker message could not be read"));
  worker.addEventListener("messageerror", onMessageError);

  let pdfWorker: { destroy(): void } | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onMessageError);
    try { pdfWorker?.destroy(); } catch { /* already gone */ }
    worker.terminate();
  };

  try {
    // The handshake first: proves the script loaded and runs before any of the file is sent to it.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { done(); reject(new PdfWorkerError("The pdf.js worker did not start in time")); }, startMs);
      const onMsg = (e: { data?: unknown }) => { if (isReady(e.data)) { done(); resolve(); } };
      const done = () => { clearTimeout(timer); worker.removeEventListener("message", onMsg); };
      worker.addEventListener("message", onMsg);
      failed.catch((err) => { done(); reject(err); });
    });
    pdfWorker = lib.PDFWorker.fromPort({ port: worker, verbosity: params.verbosity as number | undefined });
    const task = lib.getDocument({ ...params, worker: pdfWorker });
    try {
      const doc = await Promise.race([task.promise, failed]);
      return { doc, failed, dispose };
    } catch (err) {
      task.destroy().catch(() => {});
      throw err;
    }
  } catch (err) {
    dispose();
    throw err;
  }
}

/**
 * The URL resolved against `self.location` (the page, or the Worker script when run inside a Worker).
 * pdf.js's own worker would otherwise resolve a relative URL against pdf.worker.min.mjs.
 */
function absolute(url: string): string {
  const base = (globalThis as { location?: { href: string } }).location?.href;
  try { return base ? new URL(url, base).href : url; } catch { return url; }
}

const norm = (deg: number) => (((deg % 360) + 360) % 360);

/**
 * Opens a PDF from its bytes.
 * - Browser (window or Worker): `workerSrc` is required. It and `standardFontDataUrl` (a folder URL ending
 *   in "/") may be relative: both are resolved here against `self.location`, so inside a Worker they are
 *   relative to the Worker script's URL. Pass root-relative or absolute URLs to avoid surprises.
 * - Node: `workerSrc` is ignored and `standardFontDataUrl` is a filesystem folder path ending in "/".
 */
export async function openPdf(data: Uint8Array, opts: { workerSrc?: string; standardFontDataUrl: string }): Promise<PdfDoc> {
  const node = !BROWSER_BUILD && isNode();
  if (!node && !opts.workerSrc) throw new Error("openPdf: workerSrc is required in the browser");
  const lib = await loadPdfJs();
  const params: Record<string, unknown> = {
    data,
    isEvalSupported: false,
    disableFontFace: true,                                         // glyphs drawn as paths: same in Node, window and Worker
    useSystemFonts: false,
    standardFontDataUrl: node ? opts.standardFontDataUrl : absolute(opts.standardFontDataUrl),
    verbosity: 0,
  };
  if (!node) {
    params.CanvasFactory = OffscreenCanvasFactory;
    params.useWorkerFetch = true;                                  // the main-side font fetcher needs `document`
    if (typeof document === "undefined") params.FilterFactory = NoFilterFactory;
  }
  let doc: PDFDocumentProxy;
  let failed: Promise<never> | null = null;
  let dispose = () => {};
  if (node) {
    doc = await lib.getDocument(params as Parameters<PdfJs["getDocument"]>[0]).promise;
  } else {
    ({ doc, failed, dispose } = await runWithOwnWorker(lib as unknown as PdfJsLike, params, absolute(opts.workerSrc!)));
  }
  return adaptDoc(doc, failed, dispose);
}

/**
 * The PdfDoc over an open pdf.js document. `failed` (browser only: null in Node) rejects when our pdf.js
 * worker dies, and `dispose` ends that worker. Exported for the tests.
 */
export function adaptDoc(doc: PDFDocumentProxy, failed: Promise<never> | null, dispose: () => void): PdfDoc {
  /** A page call, ended by the worker crashing rather than left to hang. */
  const guard = <T>(p: Promise<T>): Promise<T> => (failed ? Promise.race([p, failed]) : p);
  /** A page's text items (see PdfDoc.textItems). */
  async function readText(page: PDFPageProxy): Promise<TextItem[]> {
    const vp = page.getViewport({ scale: 1 });
    const tc = await guard(page.getTextContent());
    const fontNames = new Set<string>();
    for (const it of tc.items) if ("fontName" in it) fontNames.add(it.fontName);
    if ([...fontNames].some((f) => !page.commonObjs.has(f))) {
      try { await guard(page.getOperatorList()); } catch { /* fall back to the styles map */ }
    }
    const style = new Map<string, { bold: boolean; italic: boolean }>();
    for (const f of fontNames) {
      const font = page.commonObjs.has(f) ? (page.commonObjs.get(f) as { name?: string }) : null;
      const s = (tc.styles as Record<string, { fontFamily?: string }>)[f];
      const name = `${font?.name ?? ""} ${s?.fontFamily ?? ""}`;
      style.set(f, { bold: /bold/i.test(name), italic: /italic|oblique/i.test(name) });
    }
    const out: TextItem[] = [];
    for (const it of tc.items) {
      if (!("str" in it)) continue;                              // marked-content markers
      const [a, b, c, d, e, f] = it.transform as number[];
      const ul = Math.hypot(a, b) || 1, vl = Math.hypot(c, d) || 1;
      const s = (tc.styles as Record<string, { ascent?: number; descent?: number }>)[it.fontName];
      const ascent = s?.ascent ?? (s?.descent != null ? 1 + s.descent : 0.8);
      const [ux, uy, vx, vy] = [a / ul, b / ul, c / vl, d / vl];
      const ox = e - vx * it.height * (1 - ascent), oy = f - vy * it.height * (1 - ascent);
      const corners = [
        [ox, oy],
        [ox + ux * it.width, oy + uy * it.width],
        [ox + vx * it.height, oy + vy * it.height],
        [ox + ux * it.width + vx * it.height, oy + uy * it.width + vy * it.height],
      ].map(([x, y]) => vp.convertToViewportPoint(x, y));
      const xs = corners.map((p) => p[0] / vp.width), ys = corners.map((p) => p[1] / vp.height);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const st = style.get(it.fontName) ?? { bold: false, italic: false };
      out.push({ str: it.str, x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0, bold: st.bold, italic: st.italic });
    }
    return out;
  }
  const canvasFactory = doc.canvasFactory as { create(w: number, h: number): { canvas: unknown; context: unknown }; destroy(cc: unknown): void };

  return {
    pages: doc.numPages,

    async textItems(n) {
      const page = await guard(doc.getPage(n));
      try {
        return await readText(page);
      } finally {
        page.cleanup();                                            // its fonts and operator list are not needed again
      }
    },

    async render(n, scale, rotate) {
      const page: PDFPageProxy = await guard(doc.getPage(n));
      const vp = page.getViewport({ scale, rotation: norm(page.rotate + rotate) });
      const width = Math.ceil(vp.width), height = Math.ceil(vp.height);
      const cc = canvasFactory.create(width, height);
      const ctx = cc.context as CanvasRenderingContext2D;
      try {
        await guard(page.render({ canvasContext: ctx, viewport: vp }).promise);
        const img = ctx.getImageData(0, 0, width, height);
        return { width, height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
      } finally {
        canvasFactory.destroy(cc);
        page.cleanup();
      }
    },

    close() {
      if (!failed) { doc.destroy().catch(() => {}); return; }      // Node: no worker of ours
      // The document first (it asks the worker to terminate and waits for its reply), then our Worker.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise((r) => (timer = setTimeout(r, 2000)));
      Promise.race([doc.destroy(), wait]).catch(() => {}).finally(() => {
        clearTimeout(timer);
        dispose();
      });
    },
  };
}

/** The box (0–1, padded by `pad`) cut out of an image, clamped to its bounds. */
export function crop(img: RGBAImage, box: Box, pad = 0.004): RGBAImage {
  const fin = (v: number) => (Number.isFinite(v) ? v : 0);         // NaN/±Infinity coordinates count as 0
  const [bx0, by0, bx1, by1] = box.map(fin), p = fin(pad);
  const clampX = (v: number) => Math.min(img.width, Math.max(0, v));
  const clampY = (v: number) => Math.min(img.height, Math.max(0, v));
  const x0 = clampX(Math.floor((bx0 - p) * img.width)), x1 = clampX(Math.ceil((bx1 + p) * img.width));
  const y0 = clampY(Math.floor((by0 - p) * img.height)), y1 = clampY(Math.ceil((by1 + p) * img.height));
  const width = Math.max(0, x1 - x0), height = Math.max(0, y1 - y0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + width * 4), y * width * 4);
  }
  return { width, height, data };
}
