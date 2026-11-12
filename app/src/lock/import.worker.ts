// The import Web Worker (a Vite module worker): runs runImport off the main thread with the vendored,
// same-origin pdf.js and Tesseract files. Protocol:
//   in:  { type: "start", file, manifest, paths }  |  { type: "cancel" }
//   out: { type: "progress", phase, done, total }  |  { type: "alive" }  |  { type: "report", report }  |  { type: "error", cancelled, name, kind? }
// An error carries only its name (and a StoreError's kind), never its message, which could quote the file.
// The file stays in this page's memory: nothing is uploaded, and no book text is logged or posted back.
import { ImportCancelled, runImport, type ImportProgress, type ImportReport } from "./importer";
import type { Manifest } from "./manifest";
import { createOcr } from "./ocr";
import { openPdf } from "./pdf";
import * as store from "./store";

/** Absolute same-origin URLs, resolved by the page (a Worker's own base is its script's URL). */
export interface ImportPaths {
  pdfWorker: string;          // pdfjs/pdf.worker.min.mjs
  standardFonts: string;      // pdfjs/standard_fonts/
  ocrWorker: string;          // ocr/worker.min.js
  ocrCore: string;            // ocr/ (tesseract.js picks the simd or plain LSTM core)
  ocrLang: string;            // ocr/lang
}

export type ToWorker =
  | { type: "start"; file: Blob; manifest: Manifest; paths: ImportPaths; game?: string }
  | { type: "cancel" };
export type FromWorker =
  | ({ type: "progress" } & ImportProgress)
  | { type: "alive" }                                             // a heartbeat: resets the page's watchdog only
  | { type: "report"; report: ImportReport }
  | { type: "error"; cancelled: boolean; name: string; kind?: store.StoreErrorKind };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage(m: FromWorker): void };
let running: AbortController | null = null;

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "cancel") {
    running?.abort();
    return;
  }
  if (m.type !== "start" || running) return;
  const ac = (running = new AbortController());
  store.useGameStore(m.game ?? "dungeon"); // a Worker has no localStorage: the page says which game this is
  try {
    const report = await runImport(m.file, {
      manifest: m.manifest,
      openPdf: (data) => openPdf(data, { workerSrc: m.paths.pdfWorker, standardFontDataUrl: m.paths.standardFonts }),
      createOcr: () => createOcr({ workerPath: m.paths.ocrWorker, corePath: m.paths.ocrCore, langPath: m.paths.ocrLang }),
      store,
      signal: ac.signal,
      onProgress: (p) => ctx.postMessage({ type: "progress", ...p }),
      onAlive: () => ctx.postMessage({ type: "alive" }),
    });
    ctx.postMessage({ type: "report", report });
  } catch (err) {
    const name = err instanceof Error && /^[A-Za-z][\w.]{0,63}$/.test(err.name) ? err.name : "Error";
    ctx.postMessage({
      type: "error", cancelled: err instanceof ImportCancelled, name,
      ...(err instanceof store.StoreError ? { kind: err.kind } : {}),
    });
  } finally {
    running = null;
  }
};
