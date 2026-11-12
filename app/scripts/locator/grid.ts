// Finds the ruled cells of tables on a rendered page: long dark horizontal and vertical runs are the
// rules; the enclosed areas between them are the cells. Pure, no Node or DOM APIs.
import type { Box } from "../../src/lock/manifest";
import type { RGBAImage } from "../../src/lock/pdf";

export interface GridOpts {
  dark: number;      // a rule pixel is darker than this (0–255)
  minRun: number;    // a rule is at least this long, in pixels (text strokes and die squares are shorter)
  extend: number;    // rules are extended by this many pixels at both ends, to close rounded corners
  minCell: number;   // a cell is at least this wide and this tall, in pixels
  maxArea: number;   // and covers at most this fraction of the page
  halo: number;      // rules are thickened by this many pixels before the cells are filled
}

/** Tuned for pages rendered at RENDER_SCALE (3). */
export const GRID_DEFAULTS: GridOpts = { dark: 110, minRun: 100, extend: 12, minCell: 24, maxArea: 0.4, halo: 2 };

/** Interior boxes (0–1, excluding the rules) of the ruled cells on the page, in no particular order. */
export function detectCells(img: RGBAImage, o: GridOpts = GRID_DEFAULTS): Box[] {
  const { width: w, height: h, data } = img;
  const dark = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    dark[i] = g < o.dark ? 1 : 0;
  }
  const wall = new Uint8Array(w * h);
  // Horizontal runs.
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!dark[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && dark[y * w + e]) e++;
      if (e - x >= o.minRun) for (let k = Math.max(0, x - o.extend); k < Math.min(w, e + o.extend); k++) wall[y * w + k] = 1;
      x = e;
    }
  }
  // Vertical runs.
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!dark[y * w + x]) { y++; continue; }
      let e = y;
      while (e < h && dark[e * w + x]) e++;
      if (e - y >= o.minRun) for (let k = Math.max(0, y - o.extend); k < Math.min(h, e + o.extend); k++) wall[k * w + x] = 1;
      y = e;
    }
  }
  // Rules are thickened by `halo` pixels, so a cell's interior stops short of their anti-aliased edges.
  if (o.halo > 0) {
    const grow = new Uint8Array(wall);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!wall[y * w + x]) continue;
      for (let dy = -o.halo; dy <= o.halo; dy++) for (let dx = -o.halo; dx <= o.halo; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) grow[ny * w + nx] = 1;
      }
    }
    wall.set(grow);
  }
  // Flood-fill the space between rules (4-connected); keep enclosed, cell-sized regions.
  const seen = new Uint8Array(w * h);
  const out: Box[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || wall[s]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, edge = false, area = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && !seen[p - 1] && !wall[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < w - 1 && !seen[p + 1] && !wall[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - w] && !wall[p - w]) { seen[p - w] = 1; stack.push(p - w); }
      if (y < h - 1 && !seen[p + w] && !wall[p + w]) { seen[p + w] = 1; stack.push(p + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (edge || bw < o.minCell || bh < o.minCell || bw * bh > o.maxArea * w * h) continue;
    if (area < 0.5 * bw * bh) continue;                            // not a box (a sliver between rules)
    out.push([x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h]);
  }
  return out;
}

/**
 * Cells grouped into tables (cells closer than `gap` of the page touch) and ordered: tables top to
 * bottom, then left to right; within a table, rows by top edge, then left to right.
 */
export function orderCells(cells: Box[], gap = 0.008): Box[] {
  const n = cells.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a: Box, b: Box) => a[0] - gap <= b[2] && b[0] - gap <= a[2] && a[1] - gap <= b[3] && b[1] - gap <= a[3];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (near(cells[i], cells[j])) parent[find(i)] = find(j);
  const groups = new Map<number, Box[]>();
  cells.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(c); });
  const tables = [...groups.values()].map((cs) => {
    const top = Math.min(...cs.map((c) => c[1])), left = Math.min(...cs.map((c) => c[0]));
    const rows: Box[][] = [];
    for (const c of [...cs].sort((a, b) => a[1] - b[1])) {
      const r = rows[rows.length - 1];
      if (r && c[1] - r[0][1] <= 0.004) r.push(c); else rows.push([c]);
    }
    const sorted = rows.flatMap((r) => r.sort((a, b) => a[0] - b[0]));
    return { top, left, sorted };
  });
  tables.sort((a, b) => (Math.abs(a.top - b.top) <= 0.01 ? a.left - b.left : a.top - b.top));
  return tables.flatMap((t) => t.sorted);
}
