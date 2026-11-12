// Roll tables: the index of rollable tables (free and unlocked only), lookups that report a
// locked table as locked, and rolling.
import type { Section, Table } from "./types";
import { cellMatches, normRoll, rollColumns, type RollResult } from "./dice";
import { rollDice } from "./dice3d";
import { codeTarget, getContent, type Locked } from "./content";

export interface TableRef {
  key: string; // code (e.g. "HST1") or section id
  sectionId: string;
  title: string;
  table: Table;
}

export interface TableRoll {
  ref: TableRef;
  roll: RollResult;
  modifier: number;
  value: number; // after modifier and clamping
  clamped: boolean;
  rowIndex: number; // -1 = no matching row
  cells: string[];
  half: number; // for side-by-side tables: index of the matching roll column
}

const byCode = new Map<string, TableRef>();
const bySection = new Map<string, TableRef>();

export function indexTables(sections: Section[]) {
  byCode.clear();
  bySection.clear();
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.type !== "table" || !b.table.dice || !rollColumns(b.table.rows).length) continue;
      const ref: TableRef = { key: b.table.code || s.id, sectionId: s.id, title: b.table.title || s.title, table: b.table };
      if (!bySection.has(s.id)) bySection.set(s.id, ref);
      if (b.table.code) {
        const code = b.table.code.toUpperCase();
        if (!byCode.has(code)) byCode.set(code, ref);
      }
    }
  }
}

/** A table lookup: the table, a table the owner hasn't unlocked yet, or nothing by that key. */
export type TableLookup = TableRef | { locked: Locked } | undefined;
export const isTableRef = (x: TableLookup): x is TableRef => !!x && "table" in x;
export const isLockedTable = (x: TableLookup): x is { locked: Locked } => !!x && "locked" in x;

/** The locked placeholder for a section id, if it is a known locked section. */
function lockedSection(id: string | undefined): { locked: Locked } | undefined {
  const r = id ? getContent(id) : undefined;
  return r && !r.ok ? { locked: r.locked } : undefined;
}

/** The rollable table with this code, or `{ locked }` when its book is still locked. */
export function tableByCode(code: string): TableLookup {
  return byCode.get(code.toUpperCase()) ?? lockedSection(codeTarget(code));
}
/** The rollable table with this code (free or unlocked), else undefined. */
export const rollableByCode = (code: string): TableRef | undefined => byCode.get(code.toUpperCase());
export const tableBySection = (id: string) => bySection.get(id);
/** A section id or a table code: the first rollable table, `{ locked }`, or undefined. */
export function tableFor(key: string): TableLookup {
  return bySection.get(key) ?? lockedSection(key) ?? tableByCode(key);
}
export const allRollable = () => [...bySection.values()];


/** Possible roll values covered by a table's roll columns. */
function range(t: Table): [number, number] {
  const nums = rollColumns(t.rows).flatMap((ci) => t.rows.flatMap((r) => (normRoll(r[ci] ?? "").match(/\d+/g) ?? []).map(Number)));
  return [Math.min(...nums), Math.max(...nums)];
}

/** Find the row for a given (already modified) value. */
export function lookup(t: Table, value: number): { rowIndex: number; half: number } {
  const rcs = rollColumns(t.rows);
  for (let i = 0; i < t.rows.length; i++)
    for (const [h, ci] of rcs.entries()) if (cellMatches(t.rows[i][ci] ?? "", value)) return { rowIndex: i, half: h };
  return { rowIndex: -1, half: 0 };
}

/** The cells belonging to the matched entry (for side-by-side layouts, only that half). */
export function entryCells(t: Table, rowIndex: number, half: number): { columns: string[]; cells: string[] } {
  const rcs = rollColumns(t.rows);
  const start = rcs[half] ?? 0;
  const end = rcs[half + 1] ?? t.columns.length;
  return { columns: t.columns.slice(start, end), cells: (t.rows[rowIndex] ?? []).slice(start, end) };
}

export async function rollOnTable(ref: TableRef, modifier = 0): Promise<TableRoll> {
  const t = ref.table;
  const roll = await rollDice(t.dice!);
  let value = roll.value;
  let clamped = false;
  if (modifier) {
    value += modifier;
    if (t.dice!.toUpperCase() !== "D66") {
      const [lo, hi] = range(t);
      const c = Math.max(lo, Math.min(hi, value));
      clamped = c !== value;
      value = c;
    }
  }
  const { rowIndex, half } = lookup(t, value);
  const { cells } = rowIndex >= 0 ? entryCells(t, rowIndex, half) : { cells: [] };
  return { ref, roll, modifier, value, clamped, rowIndex, cells, half };
}

/**
 * Table references inside result text, e.g. "Roll on HST1", "roll on ART3 -1", "(see ENAT1)".
 * Returns rollable tables with any +/- modifier written right after the code.
 */
export function followOns(text: string): { ref: TableRef; modifier: number; label: string }[] {
  const out: { ref: TableRef; modifier: number; label: string }[] = [];
  const seen = new Set<string>();
  const re = /\b([A-Z][A-Z0-9]{1,9}\d)\b(?:\s*\((?:TCX|TC|CR)\))?(?:\s*([+-]\s?\d+)(?!\s*(?:gc|sc|cc|hp|damage|xp)))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const ref = byCode.get(m[1].toUpperCase());
    if (!ref) continue;
    const modifier = m[2] ? parseInt(m[2].replace(/\s/g, ""), 10) : 0;
    const key = ref.key + ":" + modifier;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, modifier, label: `${ref.table.code ?? ref.title}${modifier ? (modifier > 0 ? ` +${modifier}` : ` ${modifier}`) : ""}` });
  }
  return out;
}

/** Table codes inside result text whose table is still locked ("Roll on ENAT2" before the Codex is unlocked). */
export function lockedFollowOns(text: string): { code: string; locked: Locked }[] {
  const out: { code: string; locked: Locked }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,9}\d)\b/g)) {
    const code = m[1]; // codes are written in capitals; "lt1" in prose is not one
    if (seen.has(code) || byCode.has(code)) continue;
    seen.add(code);
    const l = lockedSection(codeTarget(code));
    if (l) out.push({ code, locked: l.locked });
  }
  return out;
}
