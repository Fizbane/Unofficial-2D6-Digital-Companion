// Copy pdf.js and Tesseract runtime assets into public/ (run automatically before dev/build).
// Everything is served same-origin: no CDN fetches at runtime.
import { cpSync, mkdirSync, rmSync } from "node:fs";

const pdfjs = "public/pdfjs";
rmSync(pdfjs, { recursive: true, force: true });
mkdirSync(pdfjs, { recursive: true });
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `${pdfjs}/pdf.worker.min.mjs`);
cpSync("node_modules/pdfjs-dist/standard_fonts", `${pdfjs}/standard_fonts`, { recursive: true });

const ocr = "public/ocr";
rmSync(ocr, { recursive: true, force: true });
mkdirSync(`${ocr}/lang`, { recursive: true });
cpSync("node_modules/tesseract.js/dist/worker.min.js", `${ocr}/worker.min.js`);
// LSTM-only core builds; tesseract.js picks simd or non-simd at runtime from corePath.
for (const core of ["tesseract-core-lstm", "tesseract-core-simd-lstm"]) {
  for (const ext of [".wasm.js", ".wasm"]) {
    cpSync(`node_modules/tesseract.js-core/${core}${ext}`, `${ocr}/${core}${ext}`);
  }
}
cpSync("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", `${ocr}/lang/eng.traineddata.gz`);
console.log("vendor assets copied");
