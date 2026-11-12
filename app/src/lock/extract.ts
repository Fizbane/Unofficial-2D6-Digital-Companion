// Text-layer extraction: joins the pdf.js text items in a box in reading order. Pure, no pdf.js import.
import { fixText } from "./hash";
import type { Box } from "./manifest";

/** One pdf.js text item in 0–1 page coordinates, y origin at the top; (x, y) is its top-left corner. */
export interface TextItem { str: string; x: number; y: number; w: number; h: number; bold: boolean; italic: boolean }

export type Mark = [number, number, "b" | "i"];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Items whose centre lies in the box, grouped into lines by y centre (tolerance 0.4 × median height),
 * sorted by y then x. Items join with a space unless the gap is under 0.15 × the item height; lines
 * join with a space. Marks are bold/italic spans in the final string, adjacent ones merged.
 */
export function textInBox(items: TextItem[], box: Box): { text: string; marks: Mark[] } {
  const [bx0, by0, bx1, by1] = box;
  const cy = (it: TextItem) => it.y + it.h / 2;
  const hits = items
    .map((it) => ({ ...it, str: it.str.trim() }))
    .filter((it) => {
      const cx = it.x + it.w / 2;
      return it.str !== "" && cx >= bx0 && cx <= bx1 && cy(it) >= by0 && cy(it) <= by1;
    });
  if (!hits.length) return { text: "", marks: [] };

  const tol = 0.4 * median(hits.map((it) => it.h));
  const lines: { y: number; items: TextItem[] }[] = [];
  for (const it of [...hits].sort((a, b) => cy(a) - cy(b))) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(cy(it) - line.y) <= tol) {
      line.items.push(it);
      line.y = line.items.reduce((t, x) => t + cy(x), 0) / line.items.length;
    } else lines.push({ y: cy(it), items: [it] });
  }

  // fixText maps one character to one character, so offsets taken on the raw join stay valid.
  let raw = "";
  const marks: Mark[] = [];
  const mark = (start: number, end: number, k: "b" | "i") => {
    let last: Mark | undefined;
    for (let i = marks.length - 1; i >= 0 && !last; i--) if (marks[i][2] === k) last = marks[i];
    if (last && (last[1] === start || (last[1] + 1 === start && raw[last[1]] === " "))) last[1] = end;
    else marks.push([start, end, k]);
  };
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.items.forEach((it, i) => {
      if (raw !== "") {
        const prev = line.items[i - 1];
        const tight = prev !== undefined && it.x - (prev.x + prev.w) < 0.15 * it.h;
        if (!tight) raw += " ";
      }
      const start = raw.length;
      raw += it.str;
      if (it.bold) mark(start, raw.length, "b");
      if (it.italic) mark(start, raw.length, "i");
    });
  }
  return { text: fixText(raw), marks };
}
