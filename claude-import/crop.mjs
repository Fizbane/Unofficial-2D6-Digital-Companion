// Renders a box of one PDF page to a PNG so you can read small print and dice pips at zoom.
// Plain Node ESM, no network. Setup, once, in this folder:  npm i pdfjs-dist @napi-rs/canvas
//
// Usage:  node crop.mjs <pdf> <page> <x0> <y0> <x1> <y1> [scale=4] [rotate=0]
//   page      1-based page number
//   x0..y1    the box as FRACTIONS (0..1) of the page, origin top-left, measured on the page as rendered
//             with `rotate` extra degrees (the "box" and "rotate" fields of book-todo.json)
//   scale     render scale, 1 = 72 dpi (default 4)
//   rotate    extra clockwise rotation in degrees, added to the page's own rotation (0, 90, 180, 270)
// Prints the path of the PNG it wrote: crop-<page>-<x0>-<y0>-<x1>-<y1>.png in the current folder.
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PAD = 0.008;                                   // a little context around the box, as a fraction of the page
const [, , pdfPath, pageArg, ...rest] = process.argv;
const nums = rest.map(Number);
const [x0, y0, x1, y1, scaleArg, rotArg] = nums;
const usage = () => {
  console.error("usage: node crop.mjs <pdf> <page> <x0> <y0> <x1> <y1> [scale=4] [rotate=0]");
  process.exit(2);
};
if (!pdfPath || !(+pageArg >= 1) || nums.length < 4 || nums.slice(0, 4).some((v) => !Number.isFinite(v))) usage();
const scale = Number.isFinite(scaleArg) ? scaleArg : 4;
const rotate = Number.isFinite(rotArg) ? rotArg : 0;
if (!(scale > 0 && scale <= 12) || rotate % 90 !== 0) usage();

const require = createRequire(import.meta.url);
const fonts = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
const data = new Uint8Array(await readFile(resolve(pdfPath)));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, standardFontDataUrl: pathToFileURL(fonts).href, verbosity: 0 }).promise;
const page = await doc.getPage(+pageArg);

// The same view the app saved: the page's own rotation plus the extra one.
const vp = page.getViewport({ scale, rotation: (((page.rotate + rotate) % 360) + 360) % 360 });
const width = Math.ceil(vp.width), height = Math.ceil(vp.height);
const full = createCanvas(width, height);
const ctx = full.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, width, height);
await page.render({ canvasContext: ctx, viewport: vp }).promise;

const cl = (v, max) => Math.min(max, Math.max(0, v));
const px0 = cl(Math.floor((Math.min(x0, x1) - PAD) * width), width), px1 = cl(Math.ceil((Math.max(x0, x1) + PAD) * width), width);
const py0 = cl(Math.floor((Math.min(y0, y1) - PAD) * height), height), py1 = cl(Math.ceil((Math.max(y0, y1) + PAD) * height), height);
if (px1 <= px0 || py1 <= py0) {
  console.error("the box is empty or outside the page");
  process.exit(1);
}
const out = createCanvas(px1 - px0, py1 - py0);
out.getContext("2d").drawImage(full, px0, py0, px1 - px0, py1 - py0, 0, 0, px1 - px0, py1 - py0);
const name = `crop-${pageArg}-${[x0, y0, x1, y1].map((v) => v.toFixed(3)).join("-")}${rotate ? `-r${rotate}` : ""}.png`;
await writeFile(name, out.toBuffer("image/png"));
console.log(resolve(name));
await doc.destroy();
