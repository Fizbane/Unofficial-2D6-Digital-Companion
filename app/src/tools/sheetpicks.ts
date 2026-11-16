// What the character sheets offer in their "add from the book" lists, DOM-free. Every name and line of
// text is read from the books' tables at run time (a locked book gives an empty list, and the sheet then
// falls back to typing), so no book text is in this code: only section ids and the shapes of the tables.
import type { Section, Table } from "../types";

type ById = ReadonlyMap<string, Section>;

const tablesOf = (s: Section | undefined): Table[] => (s?.blocks ?? []).flatMap((b) => (b.type === "table" ? [b.table] : []));
const tableOf = (byId: ById, id: string): Table | undefined => tablesOf(byId.get(id))[0];
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/'‘-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** A choice in a list: what the list shows, the cells it writes into a sheet row, and its details for a hover card. */
export interface RowPick { label: string; row: string[]; tip: string }

/** A table row as details: each further column on its own line under the column's own heading. */
const rowTip = (t: Table, r: string[]): string =>
  t.columns.slice(1).map((col, i) => (r[i + 1]?.trim() ? `${titleCase(col)}: ${clean(r[i + 1])}` : "")).filter(Boolean).join("\n");
const rowPicks = (byId: ById, id: string, pick: (r: string[]) => { label: string; row: string[] }): RowPick[] => {
  const t = tableOf(byId, id);
  return (t?.rows ?? []).filter((r) => r[0]?.trim()).map((r) => ({ ...pick(r), tip: rowTip(t!, r) }));
};

const norm = (s: string) => s.toLowerCase().replace(/['‘’]/g, "").replace(/\s+/g, " ").trim();
/** The pick a sheet row was filled from (or matches by name), for its details. */
export const pickFor = (picks: RowPick[], name: string | undefined): RowPick | undefined => {
  const n = norm(name ?? "");
  return n ? picks.find((p) => norm(p.row[0]) === n) : undefined;
};

// ---------- 2D6 Dungeon (free Tables Codex) ----------

/** Armour pieces: [piece, dice set, modifier], as the sheet's armour rows hold them. */
export function armourPicks(byId: ById): RowPick[] {
  return rowPicks(byId, "codex/armour-table-1", (r) => ({ label: `${titleCase(r[0])} · ${r[1]} ${r[2]}${r[3] ? ` · ${r[3]}` : ""}`, row: [titleCase(r[0]), r[1] ?? "", r[2] ?? ""] }));
}

/** Scrolls: [scroll, orbit, dispel doubles, effect]. */
export function scrollPicks(byId: ById): RowPick[] {
  return rowPicks(byId, "codex/magic-scroll-table-1", (r) => ({ label: `${titleCase(r[0])} · ${titleCase(r[3] ?? "")}`, row: [`Scroll of ${titleCase(r[0])}`, r[3] ?? "", r[4] ?? "", r[7] ?? ""] }));
}

/** The id of the section whose table has this code ("RUNE1"), so code needs no locked-book section titles. */
const sectionIdByCode = (byId: ById, code: string): string | undefined => {
  for (const [id, s] of byId) if (tablesOf(s).some((t) => (t.code ?? "").toUpperCase() === code)) return id;
  return undefined;
};

/** Applied runes: [rune, applied to, effect], from the two Codex rune tables (found by code; absent while locked). */
export function runePicks(byId: ById): RowPick[] {
  return ["RUNE1", "RUNE2"].flatMap((code) => {
    const id = sectionIdByCode(byId, code);
    return id?.startsWith("codex/")
      ? rowPicks(byId, id, (r) => ({ label: `${titleCase(r[1] ?? "")} · ${titleCase(r[2] ?? "")}`, row: [titleCase(r[1] ?? ""), r[2] ?? "", r[3] ?? ""] }))
      : [];
  });
}

/** Potions: [potion, effect]. */
export function potionPicks(byId: ById): RowPick[] {
  return rowPicks(byId, "codex/magic-potions-table-1", (r) => ({ label: titleCase(r[0]), row: [`Potion of ${titleCase(r[0])}`, r[1] ?? ""] }));
}

/** Put `row` in the first empty row of `rows` (one whose first cell is blank). False when every row is taken. */
export function fillFirstEmpty(rows: string[][], row: string[]): boolean {
  const i = rows.findIndex((r) => !r[0]?.trim());
  if (i < 0) return false;
  rows[i] = row.slice();
  return true;
}

// ---------- 2D6 Void ----------

/** The alien artefacts table (rolled with its own dice from the sheet). */
export const ARTEFACT_TABLE = "void/p53-1";

/** "Name - what it does" → its name (the cell's lead, up to the first dash). */
export const leadName = (cell: string): string => clean(cell.split(/\s[-–—]\s/)[0] ?? "");

/** Alien artefacts with what each does (the rest of its cell), in table order. */
export function artefactTips(byId: ById): NamedPick[] {
  return (tableOf(byId, ARTEFACT_TABLE)?.rows ?? []).flatMap((r) => {
    const cell = clean(r[r.length - 1] ?? "");
    const name = leadName(cell);
    return name ? [{ label: name, text: name, detail: clean(cell.slice(name.length).replace(/^\s*[-–—]\s*/, "")) }] : [];
  });
}

/** Alien artefacts by name, in table order. */
export function artefactPicks(byId: ById): string[] {
  return (tableOf(byId, ARTEFACT_TABLE)?.rows ?? []).map((r) => leadName(r[r.length - 1] ?? "")).filter(Boolean);
}

/** Add a line to a free-text list (a textarea's value), skipping a line that is already there. */
export function addLine(text: string, line: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => l.toLowerCase() === line.trim().toLowerCase())) lines.push(line.trim());
  return lines.join("\n");
}

/** A named thing a table hands out: its list label, the text the sheet keeps, and the table result in full. */
export interface NamedPick { label: string; text: string; detail: string }

/** The pick whose sheet text is `text` (as picked, or typed the same), for its details. */
export const namedFor = (picks: NamedPick[], text: string | undefined): NamedPick | undefined => {
  const n = norm(text ?? "");
  return n ? picks.find((p) => norm(p.text) === n) : undefined;
};

/** "Name: what it does" (an enhancement as the sheet keeps it) → its parts; no colon means a name only. */
export function splitNamed(text: string): { name: string; rule: string } {
  const i = text.indexOf(": ");
  return i < 0 ? { name: text.trim(), rule: "" } : { name: text.slice(0, i).trim(), rule: text.slice(i + 2).trim() };
}

const QUEST = /['‘’"“”]([^'‘’"“”]{3,40})['‘’"“”]\s+quest/i;
/** Side quests the book's tables hand out (a result that names a quest in quotes), each once, by name. */
export function questPicks(byId: ById): NamedPick[] {
  const seen = new Map<string, NamedPick>();
  for (const s of byId.values())
    for (const t of tablesOf(s))
      for (const r of t.rows)
        for (const c of r) {
          const name = c.match(QUEST)?.[1]?.trim();
          if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { label: t.code ? `${name} (${t.code})` : name, text: name, detail: clean(c) });
        }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const ENHANCEMENT = /this is a permanent biological enhancement/i;
const NAMED = /\b(?:the|a|an) ((?:Grade \d+ )?[A-Z][a-z’']+(?: [A-Z][a-z’']+)+)/g;
/**
 * The permanent enhancements the book's tables give: each result that says it is one. The label is the
 * enhancement's name where the result names it ("the Such And Such"), else its table and roll; the text
 * is that plus the result's last sentence before the notice, which is the rule the player needs.
 */
export function enhancementPicks(byId: ById): NamedPick[] {
  const out: NamedPick[] = [];
  const seen = new Set<string>();
  for (const s of byId.values())
    for (const t of tablesOf(s))
      for (const r of t.rows)
        for (const c of r) {
          const at = c.search(ENHANCEMENT);
          if (at < 0) continue;
          const before = clean(c.slice(0, at));
          const names = [...before.matchAll(NAMED)];
          const name = names.length ? names[names.length - 1][1] : `${t.code ?? clean(t.title ?? "")} ${r[0] ?? ""}`.trim();
          const sentences = before.split(/(?<=[.!?])\s+/).filter(Boolean);
          const rule = (sentences.filter((x) => !x.includes(name)).pop() ?? "").trim();
          const text = rule ? `${name}: ${rule}` : name;
          if (seen.has(text)) continue;
          seen.add(text);
          out.push({ label: t.code && names.length ? `${name} (${t.code})` : name, text, detail: clean(c) });
        }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
