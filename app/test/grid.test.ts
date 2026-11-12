import { describe, it, expect } from "vitest";
import { detectCells, orderCells } from "../scripts/locator/grid";

/** A white 400×300 page with a 2×2 ruled table (rules 3 px) at x 50–350, y 50–250. */
function table() {
  const w = 400, h = 300;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  };
  for (const y of [50, 150, 250]) ink(50, y, 352, y + 2);
  for (const x of [50, 200, 350]) ink(x, 50, x + 2, 252);
  ink(80, 90, 90, 110);                                          // a "glyph" inside the first cell
  return { width: w, height: h, data };
}

describe("detectCells / orderCells", () => {
  it("finds the four ruled cells, glyphs and all, in row order", () => {
    const cells = orderCells(detectCells(table()));
    expect(cells).toHaveLength(4);
    const px = cells.map((b) => [Math.round(b[0] * 400), Math.round(b[1] * 300)]);
    // top-left corners, inside the rules and their 2 px halo, row by row
    expect(px[0][0]).toBeLessThan(px[1][0]);
    expect(px[0][1]).toBe(px[1][1]);
    expect(px[2][1]).toBeGreaterThan(px[0][1]);
    for (const b of cells) expect(b[2] - b[0]).toBeGreaterThan(0.3);
  });
});
