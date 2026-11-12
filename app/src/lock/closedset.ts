// Card cells whose text is not printed as such: a creature card is transcribed as Field | Value rows, but the
// page prints "L1" inside a circled type badge, a deflection as red faces inside the interrupt line, and no
// label at all for LEVEL, DEFLECTION or DESCRIPTION. Such a cell can't be read from the page, but its value
// comes from a small closed set (field names, levels, die faces, small numbers). The importer hashes each
// candidate with the owner's own PDF-derived key; a match proves the candidate exactly as a read would, and
// without the PDF no one can run the check. Only cells of two-column tables are tried.

const LABELS = [
  "Field", "Value", "NAME", "LEVEL", "HP", "XP", "SH", "CACHE", "INTERRUPT", "INTERRUPTS", "DEFLECTION", "MANOEUVRES", "MANOEUVRE",
  "RANGED WEAPON", "DESCRIPTION", "TYPE", "SPECIAL", "[1][1] MISHAP ATTACK ROLL", "[6][6] PRIME ATTACK ROLL", "None",
];
const TYPES = ["B", "C", "E", "R", "S"];

let cache: string[] | undefined;

/** Every closed-set candidate, once. */
export function closedSet(): string[] {
  if (cache) return cache;
  const out = new Set<string>(LABELS);
  for (let l = 1; l <= 9; l++) for (const t of TYPES) out.add(`L${l} {circled ${t}}`);
  const faces = [1, 2, 3, 4, 5, 6];
  for (const a of faces) {
    out.add(`${a}s`);
    for (const b of faces) if (b > a) {
      out.add(`${a}s, ${b}s`);
      for (const c of faces) if (c > b) out.add(`${a}s, ${b}s, ${c}s`);
    }
  }
  for (let n = 0; n <= 999; n++) out.add(String(n));
  for (let n = 1; n <= 9; n++) { out.add(`+${n}`); out.add(`-${n}`); }
  out.add("+0");
  return (cache = [...out]);
}

/** The first candidate whose hash is `expected`, or undefined. */
export function guessCell(expected: string, hashOf: (t: string) => string): string | undefined {
  return closedSet().find((t) => hashOf(t) === expected);
}

/**
 * A manoeuvre prints its dice pair as a picture ("[3][6] - ACID SPRAY = D6 -2" reads as "ACID SPRAY = D6 -2"):
 * the 36 pairs are tried in front of the text that was read, with and without its leading dash.
 */
export function guessDicePrefixed(expected: string, read: string, hashOf: (t: string) => string): string | undefined {
  const plain = read.replace(/^[\s|_\-–—]+/, "").replace(/[\s|_]+$/, "");
  // The page prints " = " between a manoeuvre's name and its damage; OCR often drops the spaces around it.
  const bodies = new Set([plain, plain.replace(/\s*=\s*/g, " = ").replace(/\s+/g, " ")]);
  for (const body of bodies) {
    if (!body) continue;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const t = `[${a}][${b}] - ${body}`;
      if (hashOf(t) === expected) return t;
    }
  }
  return undefined;
}

const STRIP = ["INTERRUPT", "RANGED WEAPON", "CACHE"];

/**
 * A card row read whole, label and value together ("CACHE Yellow acid"): the value is what follows the field
 * name. Used where the value's own box can't be told from its label's.
 */
export function guessLabelled(expected: string, read: string, hashOf: (t: string) => string): string | undefined {
  const up = read.toUpperCase();
  for (const l of STRIP) {
    if (!up.startsWith(l)) continue;
    const rest = read.slice(l.length).replace(/^[\s|:_]+/, "").replace(/[\s|_]+$/, "");
    if (rest && hashOf(rest) === expected) return rest;
  }
  return undefined;
}
