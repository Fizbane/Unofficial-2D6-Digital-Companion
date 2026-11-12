// Transcription fixes: corrections the player makes in the app. Saved on this device and
// applied at startup; export them to pipeline/fixes.json to make them permanent in the build.
import { gk } from "./games";
import type { Section } from "./types";
import { arr, num, obj, oneOf, opt, str } from "./lock/validate";

export type FixField = "text" | "cell" | "col" | "intro" | "notes";
export interface Fix { s: string; b: number; f: FixField; r?: number; c?: number; from: string; to: string }

const KEY = gk("2d6:fixes"); // per game: "2d6v:fixes" in Void

const fixShape = obj<Fix>({
  s: str(160, /^[A-Za-z0-9/_.-]+$/), // any section id: free, locked or unknown (a locked one is remapped after unlock)
  b: num({ int: true, min: 0, max: 100000 }),
  f: oneOf("text", "cell", "col", "intro", "notes"),
  r: opt(num({ int: true, min: 0, max: 100000 })),
  c: opt(num({ int: true, min: 0, max: 100000 })),
  from: str(50000),
  to: str(50000),
});
/** A list of fixes from untrusted JSON (a fix file or a saved list): exact keys, bounded sizes. */
export const validateFixes = (x: unknown): Fix[] => arr(fixShape, 20000)(x, "fixes");

const BAD_KEY = KEY + "-bad";
const BAD_MAX = 20;

/** Thrown when a fix can't be saved safely; its message is meant for the user. */
export class FixSaveError extends Error {
  constructor() {
    super("Couldn't save: storage is full");
  }
}

/**
 * Keep the raw text of anything that couldn't be read. "2d6:fixes-bad" is append-only: a JSON list of
 * distinct raw strings, newest last, at most BAD_MAX (the oldest drop first). Returns false if it couldn't be written.
 */
function quarantine(raw: string): boolean {
  try {
    const cur = localStorage.getItem(BAD_KEY);
    let list: string[] = [];
    if (cur) {
      let j: unknown;
      try {
        j = JSON.parse(cur);
      } catch {
        j = undefined;
      }
      list = Array.isArray(j) && j.every((x) => typeof x === "string") ? (j as string[]) : [cur]; // an older, plain value is kept as the first entry
    }
    if (list.includes(raw)) return true;
    list.push(raw);
    localStorage.setItem(BAD_KEY, JSON.stringify(list.slice(-BAD_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** The saved fixes, and whether anything unreadable could NOT be set aside (then nothing may be written over it). */
function readFixes(): { list: Fix[]; unsafe: boolean } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return { list: [], unsafe: false };
    const j: unknown = JSON.parse(raw);
    if (!Array.isArray(j)) throw new Error("not a list");
    const ok: Fix[] = [];
    for (const e of j) {
      try {
        ok.push(fixShape(e, "fix"));
      } catch {
        /* dropped */
      }
    }
    return { list: ok, unsafe: ok.length !== j.length && !quarantine(raw) };
  } catch {
    return { list: [], unsafe: !!raw && !quarantine(raw) };
  }
}
/** The saved fixes. A bad entry is dropped on its own (never the whole list); anything dropped is kept aside in "2d6:fixes-bad". */
export const getFixes = (): Fix[] => readFixes().list;
/** The fixes to change and save; throws FixSaveError when an unreadable value couldn't be kept aside. */
function fixesForWrite(): Fix[] {
  const r = readFixes();
  if (r.unsafe) throw new FixSaveError();
  return r.list;
}
function putFixes(list: Fix[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new FixSaveError();
  }
}
const same = (a: Fix, b: Pick<Fix, "s" | "b" | "f" | "r" | "c">) => a.s === b.s && a.b === b.b && a.f === b.f && (a.r ?? -1) === (b.r ?? -1) && (a.c ?? -1) === (b.c ?? -1);

/** Read the current value a fix targets (undefined if the target doesn't exist). */
export function readTarget(sec: Section, f: Pick<Fix, "b" | "f" | "r" | "c">): string | undefined {
  const blk = sec.blocks[f.b];
  if (!blk) return undefined;
  if (f.f === "text") return blk.type === "para" || blk.type === "heading" ? blk.text : undefined;
  if (blk.type !== "table") return undefined;
  const t = blk.table;
  if (f.f === "cell") return t.rows[f.r ?? -1]?.[f.c ?? -1];
  if (f.f === "col") return t.columns[f.c ?? -1];
  if (f.f === "intro") return t.intro ?? undefined;
  if (f.f === "notes") return t.notes ?? undefined;
  return undefined;
}
function writeTarget(sec: Section, f: Fix) {
  const blk = sec.blocks[f.b];
  if (!blk) return;
  if (f.f === "text" && (blk.type === "para" || blk.type === "heading")) blk.text = f.to;
  if (blk.type !== "table") return;
  const t = blk.table;
  if (f.f === "cell" && t.rows[f.r!]) t.rows[f.r!][f.c!] = f.to;
  if (f.f === "col") t.columns[f.c!] = f.to;
  if (f.f === "intro") t.intro = f.to;
  if (f.f === "notes") t.notes = f.to;
}

/** Apply fixes to the loaded library (skips any whose original text no longer matches). */
export function applyFixes(sections: Section[], fixes: Fix[]) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  let applied = 0;
  for (const f of fixes) {
    const sec = byId.get(f.s);
    if (!sec) continue;
    const cur = readTarget(sec, f);
    if (cur === f.from || cur === f.to) {
      writeTarget(sec, f);
      applied++;
    }
  }
  return applied;
}

/** Record a correction and apply it to the in-memory section. Returns the number of fixes saved. */
export function saveFix(sec: Section, target: Pick<Fix, "b" | "f" | "r" | "c">, to: string): number {
  const list = fixesForWrite();
  const existing = list.find((x) => same(x, { s: sec.id, ...target }));
  const from = existing ? existing.from : readTarget(sec, target) ?? "";
  const rest = list.filter((x) => !same(x, { s: sec.id, ...target }));
  if (to !== from) rest.push({ s: sec.id, ...target, from, to });
  putFixes(rest);
  writeTarget(sec, { s: sec.id, ...target, from, to });
  return rest.length;
}

/** Undo every fix on one section (restores the original text in memory). */
export function undoFixes(sec: Section) {
  const list = fixesForWrite();
  putFixes(list.filter((x) => x.s !== sec.id));
  for (const f of list.filter((x) => x.s === sec.id)) writeTarget(sec, { ...f, to: f.from });
}

export function exportFixes() {
  const blob = new Blob([JSON.stringify({ app: "2d6-companion-fixes", saved: new Date().toISOString(), fixes: getFixes() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fixes.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
