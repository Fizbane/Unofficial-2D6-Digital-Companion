// Locates transcribed cells on an OCR'd page: token alignment of the true cell text against OCR words.
// Pure (no Node or DOM APIs), so it is unit-tested with the app's tests.
import type { Box } from "../../src/lock/manifest";

export interface Word { text: string; box: Box }

/** Partial token matches count from this Levenshtein ratio up. */
export const MIN_RATIO = 0.6;
/** Cost of skipping one OCR token between two matches; leading and trailing words are free. */
const GAP = 0.02;

/** Lowercased, accents and punctuation dropped, split on everything that isn't a letter or digit. */
export function tokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "");
}

/** 1 − Levenshtein distance / longer length; 0 when the lengths alone rule out MIN_RATIO. */
export function ratio(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  const long = Math.max(la, lb);
  if (!long || Math.min(la, lb) / long < MIN_RATIO) return 0;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[lb] / long;
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * The word indices that make up each cell, in word order.
 * 1. Dynamic programming over the row-major cell tokens and the word tokens (in the order given):
 *    matches score their ratio (≥ MIN_RATIO), skipped cell tokens are free, skipped words between
 *    matches cost GAP each, so a cell's words stay together. Rows left with no match at all are aligned
 *    again against the unused words (up to 4 passes), for tables printed folded into side-by-side halves.
 * 2. Geometric recovery for tokens the monotone pass missed (wrapped lines, cells read out of order):
 *    unused words inside the cell's column span (from its matched neighbours) and between the rows
 *    above and below are matched to the cell's leftover tokens.
 */
export function alignWords<W extends Word>(cells: string[][], words: W[]): number[][][] {
  return alignDetail(cells, words).idx;
}

/** alignWords, plus how many of each cell's tokens were matched and how many it has. */
export function alignDetail<W extends Word>(cells: string[][], words: W[]): { idx: number[][][]; matched: number[][]; total: number[][] } {
  // Cell tokens, row-major.
  const tt: { tok: string; r: number; c: number }[] = [];
  cells.forEach((row, r) => row.forEach((cell, c) => { for (const tok of tokens(cell)) tt.push({ tok, r, c }); }));
  // Word tokens; one word can give several tokens.
  const wt: { tok: string; w: number }[] = [];
  words.forEach((wd, w) => { for (const tok of tokens(wd.text)) wt.push({ tok, w }); });

  const cache = new Map<string, number>();
  const rat = (a: string, b: string) => {
    const k = a + "\u0000" + b;
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = ratio(a, b)));
    return v;
  };
  const matchedTok = new Array<boolean>(tt.length).fill(false);
  const owner = new Map<number, string>();                         // word -> "r,c"
  const out: Set<number>[][] = cells.map((row) => row.map(() => new Set<number>()));
  const rowPass = cells.map(() => -1);

  // Passes: each aligns the rows that have nothing matched yet against the words nobody owns yet, so a
  // table printed folded (rows 1–18 on the left, 19–36 on the right) is matched half by half.
  for (let pass = 0; pass < 4; pass++) {
    const rows = new Set(cells.map((_, r) => r).filter((r) => rowPass[r] < 0));
    const ti = tt.map((_, k) => k).filter((k) => rows.has(tt[k].r));
    const wj = wt.map((_, k) => k).filter((k) => !owner.has(wt[k].w));
    if (!ti.length || !wj.length) break;
    const n = ti.length, m = wj.length;
    const W = m + 1;
    const score = new Float64Array((n + 1) * W);
    const move = new Uint8Array((n + 1) * W);                     // 1 match, 2 skip cell token, 3 skip word
    for (let j = 1; j <= m; j++) move[j] = 3;                     // leading words: free
    for (let i = 1; i <= n; i++) {
      const row = i * W, up = (i - 1) * W;
      score[row] = score[up];
      move[row] = 2;
      const tok = tt[ti[i - 1]].tok;
      for (let j = 1; j <= m; j++) {
        let best = score[up + j], mv = 2;
        const skip = score[row + j - 1] - GAP;
        if (skip > best) { best = skip; mv = 3; }
        const r = rat(tok, wt[wj[j - 1]].tok);
        if (r >= MIN_RATIO && score[up + j - 1] + r >= best) { best = score[up + j - 1] + r; mv = 1; }
        score[row + j] = best;
        move[row + j] = mv;
      }
    }
    // Trailing words are free: end at the best column of the last row.
    let j = 0;
    for (let k = 1; k <= m; k++) if (score[n * W + k] > score[n * W + j]) j = k;
    let i = n, got = 0;
    while (i > 0 && j > 0) {
      const mv = move[i * W + j];
      if (mv === 1) {
        const tk = ti[i - 1], t = tt[tk], w = wt[wj[j - 1]].w;
        const key = `${t.r},${t.c}`;
        if (!owner.has(w) || owner.get(w) === key) {
          owner.set(w, key);
          out[t.r][t.c].add(w);
          matchedTok[tk] = true;
          rowPass[t.r] = pass;
          got++;
        }
        i--; j--;
      } else if (mv === 2) i--;
      else j--;
    }
    if (!got) break;
  }

  // Geometric recovery, twice: the second pass sees the extents the first one grew.
  const cx = (b: Box) => (b[0] + b[2]) / 2, cy = (b: Box) => (b[1] + b[3]) / 2;
  const heights = words.map((w) => w.box[3] - w.box[1]).filter((h) => h > 0).sort((a, b) => a - b);
  const lineH = heights.length ? heights[heights.length >> 1] : 0.01;
  for (let pass = 0; pass < 2; pass++) {
    const ext = (sets: Set<number>[]) => unionBox([...sets].flatMap((s) => [...s].map((w) => words[w].box)));
    // Extents come from rows of the same pass (the same half of a folded table).
    const colX = (c: number, g: number) => ext(cells.map((_, r) => (rowPass[r] === g ? out[r][c] : undefined) ?? new Set<number>()));
    const rowY = cells.map((_, r) => ext(out[r]));
    const same = (k: number, r: number) => rowPass[k] === rowPass[r] && rowY[k];
    const above = (r: number) => { for (let k = r - 1; k >= 0; k--) if (same(k, r)) return rowY[k]![3]; return null; };
    const below = (r: number) => { for (let k = r + 1; k < cells.length; k++) if (same(k, r)) return rowY[k]![1]; return null; };
    for (let r = 0; r < cells.length; r++) {
      for (let c = 0; c < cells[r].length; c++) {
        const left = tt.map((t, k) => ({ t, k })).filter(({ t, k }) => t.r === r && t.c === c && !matchedTok[k]);
        const span = rowPass[r] >= 0 ? colX(c, rowPass[r]) : null;
        if (!left.length || !span) continue;
        const own = rowY[r];
        const top = above(r) ?? (own ? own[1] - 2 * lineH : null);
        const bottom = below(r) ?? (own ? own[3] + 2 * lineH : null);
        if (top === null || bottom === null) continue;
        const pad = lineH / 2;
        const cand = words.map((w, k) => ({ w, k })).filter(({ w, k }) =>
          !owner.has(k) && cx(w.box) >= span[0] - pad && cx(w.box) <= span[2] + pad && cy(w.box) > top && cy(w.box) < bottom);
        for (const { t, k } of left) {
          let best = -1, bestR = MIN_RATIO;
          for (const { w, k: wk } of cand) {
            if (owner.has(wk)) continue;
            for (const tok of tokens(w.text)) {
              const rr = rat(t.tok, tok);
              if (rr >= bestR && (best < 0 || rr > bestR)) { best = wk; bestR = rr; }
            }
          }
          if (best >= 0) {
            owner.set(best, `${r},${c}`);
            out[r][c].add(best);
            matchedTok[k] = true;
          }
        }
      }
    }
  }
  const matched = cells.map((row) => row.map(() => 0));
  const total = cells.map((row) => row.map(() => 0));
  tt.forEach((t, k) => { total[t.r][t.c]++; if (matchedTok[k]) matched[t.r][t.c]++; });
  return { idx: out.map((row) => row.map((s) => [...s].sort((a, b) => a - b))), matched, total };
}

/** The box of each cell: the union of its words' boxes, or null when none of its words was found. */
export function align(cells: string[][], words: Word[]): (Box | null)[][] {
  return alignWords(cells, words).map((row) => row.map((ws) => unionBox(ws.map((w) => words[w].box))));
}

// ---------------------------------------------------------------------------------------------- cell level

/** Letters and digits only, lowercased: spacing and punctuation are the least reliable part of OCR. */
const squash = (s: string) => tokens(s).join("");

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}

/**
 * Similarity (0–1) of a true text and an OCR text: the Levenshtein ratio for short texts (up to 4
 * letters and digits), else the Dice coefficient of their character bigrams.
 */
export function similarity(a: string, b: string): number {
  const x = squash(a), y = squash(b);
  if (!x || !y) return 0;
  if (x.length <= 4 || y.length <= 4) return x === y ? 1 : Math.max(x.length, y.length) <= 4 ? ratio(x, y) : 0;
  const bx = bigrams(x), by = bigrams(y);
  let common = 0;
  for (const [g, k] of bx) common += Math.min(k, by.get(g) ?? 0);
  return (2 * common) / (x.length - 1 + y.length - 1);
}

/** A cell and an OCR text count as the same from this similarity up. */
export const MIN_SIMILARITY = 0.5;
/** Cost of skipping one OCR text between two matched cells. */
const CELL_GAP = 0.05;

/**
 * Maps each cell (row-major) to one OCR text (a ruled cell's reading, in table order): a monotone
 * alignment maximising the summed similarity, where leading and trailing texts are free and skipped
 * texts in between cost CELL_GAP. Rows with no match at all are aligned again against the texts left
 * over (up to 4 passes), for tables printed folded into side-by-side halves. Null: no text found.
 */
export function alignGrid(cells: string[][], texts: string[]): (number | null)[][] {
  const out: (number | null)[][] = cells.map((r) => r.map(() => null));
  const used = new Set<number>();
  const flat: { r: number; c: number }[] = [];
  cells.forEach((row, r) => row.forEach((_, c) => flat.push({ r, c })));
  const sims = new Map<string, number>();
  const sim = (i: number, j: number) => {
    const k = i + ":" + j;
    let v = sims.get(k);
    if (v === undefined) {
      const { r, c } = flat[i];
      sims.set(k, (v = cells[r][c] ? similarity(cells[r][c], texts[j]) : 0));
    }
    return v;
  };
  for (let pass = 0; pass < 4; pass++) {
    const rows = new Set(cells.map((_, r) => r).filter((r) => out[r].every((x) => x === null)));
    const ai = flat.map((_, i) => i).filter((i) => rows.has(flat[i].r));
    const bj = texts.map((_, j) => j).filter((j) => !used.has(j));
    if (!ai.length || !bj.length) break;
    const n = ai.length, m = bj.length, W = m + 1;
    const score = new Float64Array((n + 1) * W);
    const move = new Uint8Array((n + 1) * W);
    for (let j = 1; j <= m; j++) move[j] = 3;
    for (let i = 1; i <= n; i++) {
      const row = i * W, up = (i - 1) * W;
      score[row] = score[up];
      move[row] = 2;
      for (let j = 1; j <= m; j++) {
        let best = score[up + j], mv = 2;
        const skip = score[row + j - 1] - CELL_GAP;
        if (skip > best) { best = skip; mv = 3; }
        const s = sim(ai[i - 1], bj[j - 1]);
        if (s >= MIN_SIMILARITY && score[up + j - 1] + s >= best) { best = score[up + j - 1] + s; mv = 1; }
        score[row + j] = best;
        move[row + j] = mv;
      }
    }
    let j = 0;
    for (let k = 1; k <= m; k++) if (score[n * W + k] > score[n * W + j]) j = k;
    let i = n, got = 0;
    while (i > 0 && j > 0) {
      const mv = move[i * W + j];
      if (mv === 1) {
        const { r, c } = flat[ai[i - 1]];
        out[r][c] = bj[j - 1];
        used.add(bj[j - 1]);
        got++;
        i--; j--;
      } else if (mv === 2) i--;
      else j--;
    }
    if (!got) break;
  }
  return out;
}
