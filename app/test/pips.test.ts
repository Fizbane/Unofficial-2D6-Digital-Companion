import { describe, it, expect } from "vitest";
import { countPips, toGray, type Gray } from "../src/lock/pips";

const H = 60;
const S = 40; // square side
const TOP = 10;

function canvas(width: number): Gray {
  return { width, height: H, data: new Uint8ClampedArray(width * H).fill(255) };
}

function set(g: Gray, x: number, y: number, v: number) {
  if (x >= 0 && y >= 0 && x < g.width && y < g.height) g.data[y * g.width + x] = v;
}

/** Dark 2 px outline of a S×S square with its top-left at (x0, TOP). */
function square(g: Gray, x0: number, v = 0) {
  for (let i = 0; i < S; i++) {
    for (let t = 0; t < 2; t++) {
      set(g, x0 + i, TOP + t, v);
      set(g, x0 + i, TOP + S - 1 - t, v);
      set(g, x0 + t, TOP + i, v);
      set(g, x0 + S - 1 - t, TOP + i, v);
    }
  }
}

function disc(g: Gray, cx: number, cy: number, r = 3.5, v = 0) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(g, x, y, v);
}

/** Standard die faces on a 3×3 grid inside the square. */
const FACES: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function die(g: Gray, x0: number, n: number, v = 0) {
  square(g, x0, v);
  for (const [cx, cy] of FACES[n]) disc(g, x0 + 10 + cx * 10, TOP + 10 + cy * 10, 3.5, v);
}

describe("toGray", () => {
  it("converts RGBA to one luminance byte per pixel", () => {
    const g = toGray({ width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) });
    expect(g.width).toBe(2);
    expect(g.height).toBe(1);
    expect(Array.from(g.data)).toEqual([255, 0]);
  });
});

describe("countPips", () => {
  it("reads two adjacent dice", () => {
    const g = canvas(110);
    die(g, 5, 5);
    die(g, 55, 4);
    expect(countPips(g, 128)).toBe("[5][4]");
  });
  it("separates groups across a wide gap", () => {
    const g = canvas(220);
    die(g, 5, 5);
    die(g, 55, 4);
    die(g, 170, 1);
    expect(countPips(g, 128)).toBe("[5][4]+[1]");
  });
  it("reads every face", () => {
    const g = canvas(310);
    for (let n = 1; n <= 6; n++) die(g, 5 + (n - 1) * 50, n);
    expect(countPips(g, 128)).toBe("[1][2][3][4][5][6]");
  });
  it("depends on the threshold for faint ink", () => {
    const g = canvas(60);
    die(g, 5, 3, 140);
    expect(countPips(g, 128)).toBe("");
    expect(countPips(g, 160)).toBe("[3]");
  });
  it("ignores specks and small marks outside squares", () => {
    const g = canvas(110);
    die(g, 5, 2);
    set(g, 20, 30, 0); // one-pixel speck inside the square: below 1 %
    disc(g, 80, 30, 3.5); // a blob not inside any square
    expect(countPips(g, 128)).toBe("[2]");
  });
});
