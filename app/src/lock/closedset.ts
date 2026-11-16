// Card cells whose text is not printed as such: a creature card is transcribed as Field | Value rows, but the
// page prints "L1" inside a circled type badge, a deflection as red faces inside the interrupt line, and no
// label at all for LEVEL, DEFLECTION or DESCRIPTION. Such a cell can't be read from the page, but its value
// comes from a small closed set (field names, levels, die faces, small numbers). The importer hashes each
// candidate with the owner's own PDF-derived key; a match proves the candidate exactly as a read would, and
// without the PDF no one can run the check. Only cells of two-column tables are tried.

const LABELS = [
  "Field", "Value", "NAME", "LEVEL", "HP", "XP", "SH", "CACHE", "INTERRUPT", "INTERRUPTS", "DEFLECTION", "MANOEUVRES", "MANOEUVRE",
  "RANGED WEAPON", "DESCRIPTION", "TYPE", "SPECIAL", "TREASURE", "SMALL", "MEDIUM", "LARGE", "Single", "N/A", "ROUND DAMAGE", "CAPACITY", "AMMO TYPE", "SETTINGS", "MISHAP ATTACK ROLL [1][1]", "PRIME ATTACK ROLL [6][6]", "[1][1] MISHAP ATTACK ROLL", "[6][6] PRIME ATTACK ROLL", "None",
];
const TYPES = ["A", "B", "C", "E", "F", "H", "I", "M", "P", "R", "S", "U"]; // Dungeon and Void card symbols

let cache: string[] | undefined;

/** Every closed-set candidate, once. */
export function closedSet(): string[] {
  if (cache) return cache;
  const out = new Set<string>(LABELS);
  for (let l = 1; l <= 10; l++) for (const t of TYPES) out.add(`L${l} {circled ${t}}`);
  // Expansion cards add gem icons after the level badge: one to three of four colours, in printed order.
  const gems = ["blue", "purple", "red", "yellow"];
  const gemRuns: string[] = [];
  for (const a of gems) { gemRuns.push(`{${a} gem icon}`); for (const b of gems) if (b !== a) { gemRuns.push(`{${a} gem icon}{${b} gem icon}`); for (const c of gems) if (c !== a && c !== b) gemRuns.push(`{${a} gem icon}{${b} gem icon}{${c} gem icon}`); } }
  for (let l = 1; l <= 10; l++) for (const t of ["P", "R", "B"]) for (const g of gemRuns) out.add(`L${l} {circled ${t}} ${g}`);
  const faces = [1, 2, 3, 4, 5, 6];
  for (const a of faces) {
    out.add(`${a}s`);
    for (const b of faces) if (b > a) {
      out.add(`${a}s, ${b}s`);
      for (const c of faces) if (c > b) out.add(`${a}s, ${b}s, ${c}s`);
    }
  }
  // Deflection: the faces that turn aside a primary and/or a secondary attack ("Primary 4s; Secondary 2s").
  const sets = [...faces.map((a) => `${a}s`)];
  for (const a of faces) for (const b of faces) if (b > a) { sets.push(`${a}s, ${b}s`); for (const c of faces) if (c > b) sets.push(`${a}s, ${b}s, ${c}s`); }
  out.add("none");
  for (const x of sets) { out.add(`Primary ${x}`); out.add(`Secondary ${x}`); for (const y of sets) out.add(`Primary ${x}; Secondary ${y}`); }
  for (let n = 0; n <= 999; n++) out.add(String(n));
  // Dungeon high-level XP awards are printed in multiples of five.
  for (let n = 1000; n <= 10000; n += 5) out.add(String(n));
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
  const spaced = plain.replace(/\s*=\s*/g, " = ").replace(/\s+/g, " ");
  // The dice picture of a two-line manoeuvre may be read as stray characters before the dash; "D6-2" for
  // "D6 -2"; and the word after the "+" is read badly (the rules' own word "special").
  const bare = spaced.replace(/^.*?\s[-–—]\s+(?=\S)/, "");
  const fixed = (t: string) => t.replace(/D6\s*-\s*(\d)/g, "D6 -$1").replace(/\+\s*[|\w]{2,9}\s+-\s/, "+ special - ");
  const bodies = new Set([plain, spaced, bare, fixed(spaced), fixed(bare)]);
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
    // A cache that rolls twice wraps onto a second ruled line that the read often misses.
    for (const t of [rest, rest + " twice", rest + " twice."]) if (rest && hashOf(t) === expected) return t;
  }
  return undefined;
}

const MAX_SLICE = 16;

/**
 * Two card rows read from one box: a card prints its interrupts on shared ruled lines, so the box holds
 * the label, one or more interrupts and noise from the red die faces ("and[4s)-2 damage"). Brackets and
 * bars are blanks, then every run of whole words of what was read is tried, so the row is whichever run
 * hashes to the stored value. Same proof as a read: only the owner's key can confirm a candidate.
 */
export function guessSlice(expected: string, read: string, hashOf: (t: string) => string): string | undefined {
  const words = read.replace(/[[\]|()]/g, " ").split(/\s+/).filter(Boolean);
  if (words[0] && words[0].toUpperCase() === "INTERRUPT") words.shift();
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= Math.min(words.length, i + MAX_SLICE); j++) {
      const t = words.slice(i, j).join(" ");
      if (hashOf(t) === expected) return t;
    }
  }
  return undefined;
}

/** "2s", "2s and 3s", "2s, 3s and 5s": faces as the cards print them; with three or more, a comma is sometimes missing. */
function faceLists(): string[] {
  const out: string[] = [];
  const rec = (start: number, picked: number[]) => {
    if (picked.length) {
      const k = picked.length;
      if (k === 1) out.push(`${picked[0]}s`);
      else {
        const last = ` and ${picked[k - 1]}s`;
        const mid = picked.slice(0, k - 1).map((f) => `${f}s`);
        // The gaps between the leading faces: ", " or " ".
        for (let m = 0; m < 1 << Math.max(0, k - 2); m++) {
          let t = mid[0];
          for (let g = 1; g < mid.length; g++) t += ((m >> (g - 1)) & 1 ? " " : ", ") + mid[g];
          out.push(t + last);
        }
      }
    }
    for (let f = start; f <= 6; f++) if (picked.length < 6) rec(f + 1, [...picked, f]);
  };
  rec(1, []);
  return out;
}
let faceCache: string[] | undefined;

/**
 * An interrupt row ("<Name> on Primary 2s, 3s and 5s -2 damage", sometimes + a special effect) whose name
 * was read but whose faces and damage were garbled by the red die pictures: the name is whatever precedes
 * "on" in the read, and the rest is built from the card grammar (side, face list, damage); a trailing
 * "+ ..." effect is taken from the read. Hash-checked like every guess.
 */
export function guessInterrupt(expected: string, read: string, hashOf: (t: string) => string): string | undefined {
  const words = read.replace(/[[\]|()]/g, " ").split(/\s+/).filter(Boolean);
  if (words[0] && words[0].toUpperCase() === "INTERRUPT") words.shift();
  const faces = (faceCache ??= faceLists());
  const tails = [""];
  const dmg = words.findIndex((w, i) => /^damage$/i.test(w) && words[i + 1] === "+");
  if (dmg >= 0) for (let e = dmg + 2; e <= Math.min(words.length, dmg + 24); e++) tails.push(" " + words.slice(dmg + 1, e).join(" "));
  const sides = /secondary/i.test(read) && !/primar/i.test(read) ? ["Secondary"] : /primar/i.test(read) && !/secondary/i.test(read) ? ["Primary"] : ["Primary", "Secondary"];
  const seen = new Set<string>();
  for (let j = 1; j < words.length; j++) {
    if (words[j].toLowerCase() !== "on") continue;
    for (let n = 1; n <= 3 && n <= j; n++) {
      // The read often drops a word's final "g" or "y" (a descender at the crop's edge): try them back.
      let names = [""];
      for (const w of words.slice(j - n, j)) names = names.flatMap((p) => (w.length >= 4 ? [w, w + "g", w + "y"] : [w]).map((v) => (p ? p + " " + v : v)));
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        for (const side of sides) for (const f of faces) for (let d = 1; d <= 12; d++) {
          const base = `${name} on ${side} ${f} -${d} damage`;
          for (const tail of tails) if (hashOf(base + tail) === expected) return base + tail;
        }
      }
    }
  }
  return undefined;
}

/**
 * A wrapped cell read as lines joined by " | " with a few stray marks at the end ("... standard | military
 * issue. ... indestructible. EE -"): the lines are joined and up to four trailing (or two leading) words dropped.
 */
export function guessJoined(expected: string, read: string, hashOf: (t: string) => string): string | undefined {
  const words = read.replace(/\|/g, " ").split(/\s+/).filter(Boolean);
  for (let lead = 0; lead <= 2; lead++) for (let drop = 0; drop <= 4; drop++) {
    const w = words.slice(lead, words.length - drop);
    if (!w.length) continue;
    const t = w.join(" ");
    if (hashOf(t) === expected) return t;
  }
  return undefined;
}
