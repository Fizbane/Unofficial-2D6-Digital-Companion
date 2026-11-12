// Confusion search: OCR misreads to try when a cell's hash fails. Pure, no dependencies.

/**
 * Each group's members are swapped for one another in both directions. No quote or dash forms:
 * verifyCell norm()s the text first, which folds them, so swapping them could never change a hash.
 */
const GROUPS: string[][] = [
  ["l", "1", "I"],
  ["O", "0"],
  ["rn", "m"],
  ["cl", "d"],
  ["S", "5"],
  ["B", "8"],
  ["y", "v"],
  ["t", "f"],
  [",", "."],
];
const TRAILING = [".", ",", ";", ":"];

/** Every ordered (from, to) pair within a group. */
const PAIRS: [string, string][] = GROUPS.flatMap((g) => g.flatMap((a) => g.filter((b) => b !== a).map((b): [string, string] => [a, b])));

/** One edit: replace `len` characters at `pos` with `ins`. */
type Edit = [pos: number, len: number, ins: string];

function edits(s: string): Edit[] {
  const out: Edit[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const [a, b] of PAIRS) if (s.startsWith(a, i)) out.push([i, a.length, b]);
  }
  if (s.length > 0 && TRAILING.includes(s[s.length - 1])) out.push([s.length - 1, 1, ""]);
  for (const p of TRAILING) out.push([s.length, 0, p]);
  return out;
}

const apply1 = (s: string, [pos, len, ins]: Edit) => s.slice(0, pos) + ins + s.slice(pos + len);

/** Candidates from single substitutions, then non-overlapping pairs; distinct, never `s`, at most `max`. */
export function* confusions(s: string, max = 2000): Generator<string> {
  const seen = new Set<string>([s]);
  let n = 0;
  const es = edits(s);
  function* emit(c: string) {
    if (seen.has(c)) return;
    seen.add(c);
    n++;
    yield c;
  }
  for (const e of es) {
    if (n >= max) return;
    yield* emit(apply1(s, e));
  }
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      if (n >= max) return;
      const [a, b] = es[i][0] <= es[j][0] ? [es[i], es[j]] : [es[j], es[i]];
      if (a[0] + a[1] > b[0] || (a[0] === b[0] && a[1] === 0 && b[1] === 0)) continue; // overlapping
      yield* emit(apply1(apply1(s, b), a)); // right edit first keeps `a`'s position valid
    }
  }
}
