// Splits a crop of text into one image per line, so OCR never sees one line's descenders touching the
// next line's ascenders (the Codex's tables are set with very tight leading). Pure, no dependencies.
import type { RGBAImage } from "./pdf";

/** Pixels darker than this are ink. */
const INK = 140;
/** A row belongs to a line's core when its ink is above this share of the busiest row. */
const CORE = 0.08;
/** Ink lying within this many pixels of the crop's edge (and at least 3× as long) is a cell-rule remnant. */
const RULE = 4;
/** A component stays whole in one line when that line holds this share of its pixels. */
const SPLIT = 0.75;

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

interface Comp { px: number[]; y0: number; y1: number }

/**
 * Ink is labelled into 8-connected components; rule remnants (thin, long components lying along the
 * edge, or thin ones spanning nearly the whole width) are dropped. Line cores are runs of rows with enough ink
 * (cores thinner than a third of the tallest are ignored); lines meet at the emptiest row between two
 * cores. Each component goes to the line holding most of its pixels, unless glyphs of two lines touch
 * (no line holds SPLIT of it): then its pixels are split at the cut rows. Each line image holds only its own components, dilated by one pixel to keep their
 * anti-aliased edges, on white, cut to their rows. No ink: no lines.
 */
export function splitLines(img: RGBAImage): RGBAImage[] {
  const { width: w, height: h, data } = img;
  if (!w || !h) return [];
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (lum(data, i * 4) < INK) ink[i] = 1;

  const label = new Int32Array(w * h).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!ink[s] || label[s] !== -1) continue;
    const px: number[] = [];
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    label[s] = comps.length;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      px.push(p);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (ink[q] && label[q] === -1) { label[q] = comps.length; stack.push(q); }
      }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    // Along the edge: it touches the edge and nearly all of it lies within RULE pixels of an edge, over a
    // run at least 3 RULE long (an L at a corner counts). Across: a thin line over nearly the whole width.
    let rim = 0;
    for (const p of px) { const x = p % w, y = (p - x) / w; if (x < RULE || y < RULE || x >= w - RULE || y >= h - RULE) rim++; }
    const edge = x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1;
    const along = edge && rim >= 0.9 * px.length && Math.max(cw, ch) >= 3 * RULE;
    const across = cw >= 0.9 * w && ch <= 2 * RULE;
    const rule = along || across;
    comps.push({ px: rule ? [] : px, y0, y1 });
  }

  const prof = new Float64Array(h);
  for (const c of comps) for (const p of c.px) prof[(p - (p % w)) / w]++;
  const max = Math.max(0, ...prof);
  if (!max) return [];
  const cores: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    if (prof[y] <= CORE * max) continue;
    const last = cores[cores.length - 1];
    if (last && y - last[1] <= 2) last[1] = y; else cores.push([y, y]);
  }
  const tall = Math.max(...cores.map(([a, b]) => b - a + 1));
  const lines = cores.filter(([a, b]) => b - a + 1 >= tall / 3);

  const cuts: number[] = [];
  for (let k = 0; k + 1 < lines.length; k++) {
    let at = lines[k][1], v = Infinity;
    for (let y = lines[k][1]; y <= lines[k + 1][0]; y++) if (prof[y] < v) { v = prof[y]; at = y; }
    cuts.push(at);
  }
  const lineOfRow = (y: number) => { let k = 0; while (k < cuts.length && y > cuts[k]) k++; return k; };
  // A component goes whole to the line holding most of its pixels (a "g" keeps its tail); only when no
  // line holds SPLIT of them (glyphs of two lines touching) are its pixels split at the cut rows.
  const owner = comps.map((c) => {
    if (!c.px.length) return -2;
    const n = new Array<number>(lines.length).fill(0);
    for (const p of c.px) n[lineOfRow((p - (p % w)) / w)]++;
    const best = n.indexOf(Math.max(...n));
    return n[best] >= SPLIT * c.px.length ? best : -1;
  });

  return lines.map((_, k) => {
    let top = h, bottom = -1;
    const keep = new Uint8Array(w * h);
    comps.forEach((c, id) => {
      if (owner[id] !== k && owner[id] !== -1) return;
      for (const p of c.px) {
        const x = p % w, y = (p - x) / w;
        if (owner[id] === -1 && lineOfRow(y) !== k) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          keep[ny * w + nx] = 1;
          if (ny < top) top = ny;
          if (ny > bottom) bottom = ny;
        }
      }
    });
    if (bottom < top) return { width: w, height: 0, data: new Uint8ClampedArray(0) };
    const lh = bottom - top + 1;
    const out = new Uint8ClampedArray(w * lh * 4).fill(255);
    for (let y = top; y <= bottom; y++) for (let x = 0; x < w; x++) {
      if (!keep[y * w + x]) continue;
      const i = (y * w + x) * 4, o = ((y - top) * w + x) * 4;
      out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2];
    }
    return { width: w, height: lh, data: out };
  }).filter((im) => im.height > 0);
}
