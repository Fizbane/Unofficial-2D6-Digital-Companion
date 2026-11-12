// Real-PDF check of the pdf.js and Tesseract adapters. Runs only where the local books/ junction exists.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { openPdf, crop, type PdfDoc } from "../src/lock/pdf";
import { createOcr, checkOcrPaths, ocrFromWorker, RENDER_SCALE, type OcrWorker } from "../src/lock/ocr";

// The app has no @types/node, so the Node built-ins are imported untyped.
const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { existsSync, readFileSync } = await nodeMod("node:fs");
const { fileURLToPath } = await nodeMod("node:url");
const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const TABLET = here("../../books/2D6_Dungeon_Tables_Codex_Backers_Version_for_Tablet.pdf");
const PUB = here("../public");
const VENDORED = [TABLET, PUB + "/pdfjs/standard_fonts", PUB + "/ocr/lang/eng.traineddata.gz"].every((p) => existsSync(p));

describe.skipIf(!VENDORED)("pdf.js and Tesseract adapters (Tablet Codex)", () => {
  let doc: PdfDoc;
  const fetchSpy = vi.fn(() => Promise.reject(new Error("network access is not allowed")));
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    doc = await openPdf(new Uint8Array(readFileSync(TABLET)), { standardFontDataUrl: PUB + "/pdfjs/standard_fonts/" });
  });
  afterAll(() => {
    doc?.close();                                     // destroy errors are swallowed inside close()
    globalThis.fetch = realFetch;
  });

  it("opens the book", () => {
    expect(doc.pages).toBe(144);
  });

  it("returns text items in 0–1 top-origin coordinates with bold flags", async () => {
    const items = await doc.textItems(5);
    expect(items.length).toBeGreaterThan(10);
    for (const it of items) {
      for (const v of [it.x, it.y, it.x + it.w, it.y + it.h]) expect(v).toBeGreaterThanOrEqual(-0.01), expect(v).toBeLessThanOrEqual(1.01);
    }
    const title = items.find((it) => it.str === "Generic Tables");
    expect(title).toBeDefined();
    expect(title!.bold).toBe(true);                       // set in Garamond-Bold
    expect(title!.y).toBeLessThan(0.2);                   // near the top of the page
    const pageNo = items.find((it) => it.str === "5")!;
    expect(pageNo.y).toBeGreaterThan(0.9);                // page number at the foot
    expect(pageNo.bold).toBe(false);
  });

  it("renders a rotated page with its own rotation applied", async () => {
    const img = await doc.render(6, 2, 0);
    expect(img.width).toBeGreaterThan(0);
    expect(img.data.length).toBe(img.width * img.height * 4);
    expect(img.width).toBeGreaterThan(img.height);         // page 6 is /Rotate 90: landscape once rotated
    const back = await doc.render(6, 1, 90);
    expect(back.width).toBeLessThan(back.height);          // a further 90° turns it back upright
  });

  it("OCRs a crop of known text", async () => {
    const items = await doc.textItems(5);
    const title = items.find((it) => it.str === "Generic Tables")!;
    const img = await doc.render(5, RENDER_SCALE, 0);
    const cell = crop(img, [title.x, title.y, title.x + title.w, title.y + title.h]);
    expect(cell.width).toBeGreaterThan(0);
    const ocr = await createOcr({ workerPath: "", corePath: "", langPath: PUB + "/ocr/lang" });
    try {
      const text = await ocr.read(cell);
      expect(text.trim()).not.toBe("");
      expect(text).toMatch(/Generic/i);
      const words = await ocr.words(cell);
      expect(words.map((w) => w.text).join(" ")).toMatch(/Tables/i);
      for (const w of words) for (const v of w.box) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    } finally {
      await ocr.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
}, 120_000);

describe("crop", () => {
  it("clamps to the image bounds", () => {
    const img = { width: 10, height: 10, data: new Uint8ClampedArray(400).map((_, i) => i % 256) };
    const c = crop(img, [0.5, 0.5, 2, 2], 0);
    expect([c.width, c.height]).toEqual([5, 5]);
    expect(c.data[0]).toBe(img.data[(5 * 10 + 5) * 4]);
    const all = crop(img, [0, 0, 1, 1]);
    expect([all.width, all.height]).toEqual([10, 10]);
  });

  it("treats non-finite coordinates as 0", () => {
    const img = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
    const c = crop(img, [NaN, -Infinity, 0.5, Infinity], 0);
    expect([c.width, c.height]).toEqual([5, 0]);
    expect(crop(img, [0, 0, 1, 1], NaN).width).toBe(10);
  });
});

describe("openPdf", () => {
  it("requires workerSrc in the browser", async () => {
    vi.stubGlobal("window", {});                      // looks like a browser to isNode()
    try {
      await expect(openPdf(new Uint8Array(), { standardFontDataUrl: "/pdfjs/standard_fonts/" })).rejects.toThrow(/workerSrc/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("checkOcrPaths", () => {
  const ok = { workerPath: "/ocr/worker.min.js", corePath: "./ocr/", langPath: "ocr/lang" };
  it("accepts relative and same-origin URLs in the browser", () => {
    vi.stubGlobal("location", { href: "https://app.example/x/", origin: "https://app.example" });
    try {
      expect(() => checkOcrPaths(ok, false)).not.toThrow();
      expect(() => checkOcrPaths({ ...ok, corePath: "https://app.example/ocr/" }, false)).not.toThrow();
      expect(() => checkOcrPaths({ ...ok, corePath: "https://cdn.jsdelivr.net/npm/x/" }, false)).toThrow(/corePath/);
      expect(() => checkOcrPaths({ ...ok, langPath: "//cdn.example/lang" }, false)).toThrow(/langPath/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects empty paths, which would fall back to the CDN", () => {
    for (const k of ["workerPath", "corePath", "langPath"] as const) expect(() => checkOcrPaths({ ...ok, [k]: "" }, false)).toThrow(k);
    expect(() => checkOcrPaths({ workerPath: "", corePath: "", langPath: "" }, true)).toThrow(/langPath/);
  });
  it("needs a filesystem langPath in Node and ignores the other two", () => {
    expect(() => checkOcrPaths({ workerPath: "", corePath: "", langPath: "C:\app\public\ocr\lang" }, true)).not.toThrow();
    expect(() => checkOcrPaths({ workerPath: "", corePath: "", langPath: "/app/public/ocr/lang" }, true)).not.toThrow();
    expect(() => checkOcrPaths({ workerPath: "", corePath: "", langPath: "https://cdn.example/lang" }, true)).toThrow(/filesystem/);
  });
});

/** White, with a dark 4×4 blot in the middle (one "line" of ink for read()). */
function inked(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  return { width, height, data };
}

describe("ocrFromWorker", () => {
  it("reads nothing (and calls no worker) for a crop without ink", async () => {
    const worker: OcrWorker = {
      async setParameters() { throw new Error("unexpected"); },
      async recognize() { throw new Error("unexpected"); },
      async terminate() { return {}; },
    };
    const ocr = ocrFromWorker(worker, async () => new Uint8Array() as never);
    expect(await ocr.read({ width: 8, height: 8, data: new Uint8ClampedArray(256).fill(255) })).toBe("");
  });

  it("never lets read and words recognize under each other's page-segmentation mode", async () => {
    let mode: unknown = -1;
    const log: string[] = [];
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const worker: OcrWorker = {
      async setParameters(p) { await tick(); mode = p.tessedit_pageseg_mode; log.push(`set ${mode}`); return {}; },
      async recognize(_img, _o, out) {
        const seen = mode;
        await tick();
        log.push(`rec ${seen}`);
        return { data: { text: `mode ${seen}`, blocks: out?.blocks ? [{ paragraphs: [{ lines: [{ words: [{ text: `mode ${seen}`, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }] }] }] }] : null } };
      },
      async terminate() { log.push("end"); return {}; },
    };
    const ocr = ocrFromWorker(worker, async () => new Uint8Array() as never);
    const img = inked(10, 10);
    const [a, b, c] = await Promise.all([ocr.read(img), ocr.words(img), ocr.read(img)]);
    expect(a).toBe("mode 7");                         // PSM.SINGLE_LINE (one line per recognize)
    expect(b).toEqual([{ text: "mode 3", box: [0, 0, 0.5, 0.5] }]);   // PSM.AUTO
    expect(c).toBe("mode 7");
    // every recognize runs under the mode its own job set (job order may vary with encoding)
    expect(log).toHaveLength(6);
    for (let i = 0; i < 6; i += 2) expect(log[i + 1]).toBe(log[i].replace("set", "rec"));
    expect([...log].sort()).toEqual(["rec 3", "rec 7", "rec 7", "set 3", "set 7", "set 7"]);
    await ocr.close();
    expect(log.at(-1)).toBe("end");
  });

  it("keeps the queue running after a failed job", async () => {
    let n = 0;
    const worker: OcrWorker = {
      async setParameters() { return {}; },
      async recognize() { if (n++ === 0) throw new Error("boom"); return { data: { text: "ok" } }; },
      async terminate() { return {}; },
    };
    const ocr = ocrFromWorker(worker, async () => new Uint8Array() as never);
    const img = inked(10, 10);
    const [first, second] = await Promise.allSettled([ocr.read(img), ocr.read(img)]);
    expect(first.status).toBe("rejected");
    expect(second).toEqual({ status: "fulfilled", value: "ok" });
  });
});
