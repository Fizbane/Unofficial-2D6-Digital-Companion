import { describe, it, expect } from "vitest";
import { GATE, gateFigure, honestPatch, rotateBox, rowCoverage, tableClass, unrotate } from "../scripts/locator/rules";
import { openPdf } from "../src/lock/pdf";
import type { Box } from "../src/lock/manifest";

// The app has no @types/node, so the Node built-ins are imported untyped.
const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { existsSync, readFileSync } = await nodeMod("node:fs");
const { fileURLToPath } = await nodeMod("node:url");
const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const TABLET = here("../../books/2D6_Dungeon_Tables_Codex_Backers_Version_for_Tablet.pdf");
const BACKERS = here("../../books/2D6_Dungeon_Tables_Codex_Backers_Version.pdf");
const FONTS = here("../public/pdfjs/standard_fonts") + "/";
const BOOKS = [TABLET, BACKERS, FONTS].every((p) => existsSync(p));

const close = (a: Box, b: Box, tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));

describe("unrotate / rotateBox", () => {
  const box: Box = [0.1, 0.2, 0.4, 0.3];
  it("are inverses at every right angle", () => {
    for (const r of [0, 90, 180, 270, -90, 450]) close(unrotate(rotateBox(box, r), r), box, 1e-12);
  });
  it("90°: a point (u, v) of the unrotated page lands at (1 − v, u)", () => {
    close(rotateBox([0.1, 0.2, 0.1, 0.2], 90), [0.8, 0.1, 0.8, 0.1], 1e-12);
    close(unrotate([0.8, 0.1, 0.8, 0.1], 90), [0.1, 0.2, 0.1, 0.2], 1e-12);
  });

  // Page 6 is /Rotate 90 in the Tablet edition and unrotated in the Backers edition: the same page number
  // item, taken from pdf.js text items of each, must map across with unrotate(·, 90).
  it.skipIf(!BOOKS)("maps a Tablet text box onto the Backers page as pdf.js lays it out", async () => {
    const t = await openPdf(new Uint8Array(readFileSync(TABLET)), { standardFontDataUrl: FONTS });
    const b = await openPdf(new Uint8Array(readFileSync(BACKERS)), { standardFontDataUrl: FONTS });
    try {
      const it6 = (items: { str: string; x: number; y: number; w: number; h: number }[]) => {
        const i = items.find((x) => x.str.trim() === "6")!;
        return [i.x, i.y, i.x + i.w, i.y + i.h] as Box;
      };
      const tb = it6(await t.textItems(6)), bb = it6(await b.textItems(6));
      close(unrotate(tb, 90), bb, 0.003);
      close(rotateBox(bb, 90), tb, 0.003);
    } finally {
      t.close();
      b.close();
    }
  }, 60_000);
});

describe("honestPatch", () => {
  it("allows repairs, refuses a patch that spells out most of the answer", () => {
    expect(honestPatch([[3, 1, "y"]], "If you")).toBe(true);           // vou -> you
    expect(honestPatch([[0, 9, ""]], "GHOST")).toBe(true);              // deletions are free
    expect(honestPatch([[0, 0, "15"]], "15")).toBe(false);              // from an empty reading
    expect(honestPatch([[0, 3, "2"]], "2")).toBe(false);                // "[7]" -> "2": the whole text
    expect(honestPatch([[0, 0, "ab"]], "abcd")).toBe(true);             // exactly half
  });
});

describe("table classes and row coverage", () => {
  it("classifies cards, text tables and transcribed tables", () => {
    expect(tableClass(["Field", "Value"], "trans")).toBe("card");
    expect(tableClass(["ROLL", "ITEM"], "text")).toBe("text");
    expect(tableClass(["ROLL", "ITEM"], "trans")).toBe("trans");
  });
  it("counts a row verified only when all its cells are, per class, and gates on ordinary tables", () => {
    const cov = rowCoverage([
      { cls: "trans", row: "a", ok: true }, { cls: "trans", row: "a", ok: true },
      { cls: "trans", row: "b", ok: true }, { cls: "trans", row: "b", ok: false },
      { cls: "text", row: "c", ok: true },
      { cls: "card", row: "d", ok: false },
    ]);
    expect(cov.trans).toEqual({ rows: 2, verified: 1, pct: 50 });
    expect(cov.text).toEqual({ rows: 1, verified: 1, pct: 100 });
    expect(cov.card).toEqual({ rows: 1, verified: 0, pct: 0 });
    expect(cov.all).toEqual({ rows: 4, verified: 2, pct: 50 });
    expect(GATE.classes).not.toContain("card");
    expect(gateFigure(cov)).toEqual({ rows: 3, verified: 2, pct: 66.7, pass: false });
  });
  it("compares the gate unrounded: 94.96 % fails even though it rounds to 95.0", () => {
    const rows = (n: number, ok: number) => Array.from({ length: n }, (_, i) => ({ cls: "trans" as const, row: String(i), ok: i < ok }));
    const near = gateFigure(rowCoverage(rows(2500, 2374)));             // 94.96 %
    expect(near.pct).toBe(95);
    expect(near.pass).toBe(false);
    expect(gateFigure(rowCoverage(rows(2000, 1900))).pass).toBe(true); // exactly 95 %
    expect(gateFigure(rowCoverage([])).pass).toBe(false);               // nothing to gate on
  });
});
