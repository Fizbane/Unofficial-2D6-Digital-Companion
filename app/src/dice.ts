import { esc, raw, type Raw } from "./ui/html";
export const d6 = () => 1 + Math.floor(Math.random() * 6);

export interface RollResult {
  label: string; // e.g. "2D6"
  dice: number[];
  value: number; // total, or D66 as primary*10+secondary
  text: string; // display, e.g. "3 + 5 = 8"
}

export function roll(kind: string): RollResult {
  const k = kind.toUpperCase().replace(/\s/g, "");
  if (k === "D66") {
    const a = d6(), b = d6();
    return { label: "D66", dice: [a, b], value: a * 10 + b, text: `${a}${b}` };
  }
  if (k === "D3") {
    const a = d6();
    const v = Math.ceil(a / 2);
    return { label: "D3", dice: [a], value: v, text: `${v}` };
  }
  const m = k.match(/^(\d*)D(\d+)$/);
  const n = m ? parseInt(m[1] || "1", 10) : 1;
  const sides = m ? parseInt(m[2], 10) : 6;
  const dice = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
  const total = dice.reduce((s, x) => s + x, 0);
  return { label: `${n}D${sides}`, dice, value: total, text: n > 1 ? `${dice.join(" + ")} = ${total}` : `${total}` };
}

/** Does a roll-column cell like "2", "3-4", "11–13", "12+", "6 or less" match value? */
export function cellMatches(cell: string, value: number): boolean {
  const c = normRoll(cell);
  let m;
  if ((m = c.match(/^(\d+)$/))) return +m[1] === value;
  if ((m = c.match(/^(\d+)-(\d+)$/))) return value >= +m[1] && value <= +m[2];
  if ((m = c.match(/^(\d+)\+$/))) return value >= +m[1];
  if ((m = c.match(/^(\d+)(-|orless|orlower)$/))) return value <= +m[1];
  if ((m = c.match(/^(\d+)(,\d+)+$/))) return c.split(",").map(Number).includes(value);
  return false;
}

/** "[3][5]" -> "35", "[4]" -> "4", "11 – 13" -> "11-13" */
export function normRoll(cell: string): string {
  return cell
    .replace(/\]\s*\[/g, "")
    .replace(/[[\]]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s/g, "")
    .toLowerCase();
}

const ROLL_CELL = /^\d+(-\d+|\+|(,\d+)+)?$/;

/** Indices of columns holding roll results. Side-by-side layouts have several. */
export function rollColumns(rows: string[][]): number[] {
  const cols = rows[0]?.length ?? 0;
  const out: number[] = [];
  for (let ci = 0; ci < cols; ci++) {
    const filled = rows.filter((r) => (r[ci] ?? "").trim());
    const ok = filled.filter((r) => ROLL_CELL.test(normRoll(r[ci]))).length;
    if (filled.length >= 2 && ok >= filled.length * 0.8) out.push(ci);
  }
  // A roll column is narrow data; keep only ones followed by a non-roll column (avoid e.g. cost columns)
  return out.length > 1 ? out.filter((ci) => !out.includes(ci - 1) || ci === 0) : out;
}

/** Render "[5][4]+[1]" dice-icon notation as unicode die faces. */
const FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
/** The same on text that is already escaped (library inline()'s pipeline): adds only the fixed die spans. */
export function diceFaces(escaped: string): string {
  return escaped.replace(/\[([1-6])\]/g, (_, n) => `<span class="die" title="${n}">${FACES[+n]}</span>`);
}
/** Plain text with "[5][4]" notation as markup: escaped, then die faces. */
export function diceIcons(text: string): Raw {
  return raw(diceFaces(esc(text))); // audited: escaped first, then only the fixed die spans
}

/**
 * Die values from a 3D dice-box roll, in throw order (group, then roll).
 * dice-box returns a flat list of dice `{ groupId, rollId, value }`; older builds
 * returned groups with a `rolls` array, so both shapes are read.
 */
export function rollValues(results: unknown): number[] {
  if (!Array.isArray(results)) return [];
  const dice: { g: number; r: number; v: number }[] = [];
  results.forEach((e: any, i: number) => {
    const g = Number(e?.groupId ?? i);
    if (Array.isArray(e?.rolls)) e.rolls.forEach((r: any, j: number) => dice.push({ g, r: Number(r?.rollId ?? j), v: Number(r?.value) }));
    else if (e && "value" in e) dice.push({ g, r: Number(e.rollId ?? i), v: Number(e.value) });
  });
  return dice.sort((a, b) => a.g - b.g || a.r - b.r).map((d) => d.v);
}
