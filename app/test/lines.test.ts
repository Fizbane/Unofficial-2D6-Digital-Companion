import { describe, it, expect } from "vitest";
import { splitLines } from "../src/lock/lines";

/** A white image with black rectangles [x0, y0, x1, y1] (inclusive). */
function page(w: number, h: number, rects: number[][]) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  return { width: w, height: h, data };
}
const darkRows = (im: { width: number; height: number; data: Uint8ClampedArray }) => {
  const rows: number[] = [];
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (im.data[(y * im.width + x) * 4] < 128) { rows.push(y); break; }
  return rows.length;
};

describe("splitLines", () => {
  it("returns no lines for a blank crop", () => {
    expect(splitLines(page(20, 20, []))).toEqual([]);
  });

  it("gives one image per line, each holding only its own glyphs", () => {
    // two "lines" of glyphs (rows 5–10 and 20–25), with a descender of line 1 touching an ascender of line 2
    const glyphs = [5, 15, 25, 35, 45].flatMap((x) => [[x, 5, x + 5, 10], [x, 20, x + 5, 25]]);
    const im = page(60, 32, [...glyphs, [16, 11, 17, 15], [16, 16, 17, 19]]);
    const lines = splitLines(im);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l.width).toBe(60);
    // line 1: its glyph rows (6) plus the stub down to the cut row; line 2 never gets line 1's glyphs
    expect(darkRows(lines[0])).toBeLessThanOrEqual(8);
    expect(darkRows(lines[1])).toBeLessThanOrEqual(16);
    expect(darkRows(lines[0]) + darkRows(lines[1])).toBeLessThanOrEqual(23);   // rows 5–25, plus the 1 px dilation at the cut
  });

  it("drops cell-rule remnants along the edges", () => {
    const im = page(60, 20, [[0, 0, 59, 1], [58, 0, 59, 19], [10, 8, 15, 13], [20, 8, 25, 13]]);
    const lines = splitLines(im);
    expect(lines).toHaveLength(1);
    // only the two glyphs survive: no dark pixel in the last two columns or the first two rows
    const l = lines[0];
    for (let y = 0; y < l.height; y++) expect(l.data[(y * l.width + 59) * 4]).toBe(255);
  });
});
