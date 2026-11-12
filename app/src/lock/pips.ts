// Dice pip counter for "[5][4]" cells. Deterministic and dependency-free: threshold, label, count.

export interface Gray { width: number; height: number; data: Uint8ClampedArray }

/** RGBA to one luminance byte per pixel (Rec. 601 weights). */
export function toGray(img: { width: number; height: number; data: Uint8ClampedArray }): Gray {
  const n = img.width * img.height;
  const data = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    data[i] = Math.round(0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]);
  }
  return { width: img.width, height: img.height, data };
}

interface Comp { x0: number; y0: number; x1: number; y1: number; area: number }

/** 8-connected components of pixels darker than `threshold`. */
function components(g: Gray, threshold: number): Comp[] {
  const { width: w, height: h, data } = g;
  const label = new Int32Array(w * h).fill(-1);
  const out: Comp[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start] >= threshold) continue;
    const id = out.length;
    const c: Comp = { x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (label[q] === -1 && data[q] < threshold) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    out.push(c);
  }
  return out;
}

const inside = (a: Comp, s: Comp) => a.x0 > s.x0 && a.x1 < s.x1 && a.y0 > s.y0 && a.y1 < s.y1;

/**
 * Squares are dark components wider than half the crop height, read left to right. Pips are other
 * components inside a square with an area of 1–12 % of the square's box. Groups split on a gap
 * wider than 1.5 square widths: "[5][4]+[1]".
 */
export function countPips(g: Gray, threshold: number): string {
  const comps = components(g, threshold);
  const squares = comps.filter((c) => c.x1 - c.x0 + 1 > 0.5 * g.height).sort((a, b) => a.x0 - b.x0);
  let out = "";
  squares.forEach((s, i) => {
    const sw = s.x1 - s.x0 + 1;
    const box = sw * (s.y1 - s.y0 + 1);
    const pips = comps.filter((c) => c !== s && inside(c, s) && c.area >= 0.01 * box && c.area <= 0.12 * box).length;
    if (i > 0) {
      const prev = squares[i - 1];
      if (s.x0 - prev.x1 - 1 > 1.5 * sw) out += "+";
    }
    out += `[${pips}]`;
  });
  return out;
}
