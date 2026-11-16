// The Tables page's data: every table in the open books as one flat, sortable, filterable list. DOM-free so it
// can be tested. Nothing here is book text: titles, codes and rows are read from the books at run time.
import type { Section, Table } from "../types";
import { rollColumns } from "../dice";
import { isCreatureTable } from "./common";
import { isItemCatalogTable } from "./itemsmodel";

export interface TableEntry {
  /** Unique and stable: section id and the block's place in it. */
  key: string;
  title: string;
  /** What kind of table it is (one of TABLE_TYPES). */
  type: string;
  /** The dungeon level it is for ("Level 1 Animals"), or null when it serves any level. */
  level: number | null;
  code: string;
  /** "D20", "2D6", "D66". */
  dice: string;
  rows: number;
  book: string;
  sectionId: string;
  /** The section's title, shown as the chapter. */
  chapter: string;
  page: number;
  /** Always true: only tables that can be rolled are listed. */
  rollable: boolean;
  table: Table;
  /** Lower-cased text the search looks in. */
  hay: string;
}

/**
 * The kinds of table, in the order the Tables page lists them. A table's kind is read from its title (the first
 * rule that matches wins), so a book unlocked later falls into place without changes; what no rule matches is "Other".
 */
const TYPE_RULES: [string, RegExp][] = [
  ["Rooms, doors and exits", /\brooms?\b|\bexits?\b|\bdoors?\b|\block\b|portcullis|\blever\b/],
  ["Encounters", /encounter|prisoner|\bpatrols?\b|\bguards?\b|wardens|workers|animals|\bdogs\b|fungal|martial|snakes|religious enemy/],
  ["Armour", /armou?r/],
  ["Potions", /potion/],
  ["Scrolls and spells", /scroll|failed to cast|\bspells?\b/],
  ["Gems", /\bgems?\b/],
  ["Bags and containers", /\bbags?\b|\bchests?\b|pouch|container|rubbish|\btable - table\b/],
  ["Treasure and items", /treasure|reward|\bloot\b|\bitems?\b|\bherbs?\b|hoard/],
  ["Gods and religion", /\bgods?\b|religio/],
  ["Events and rules", /fatigue|exploits|interruption|recovery|unconscious|\bshift\b/],
];
export const TABLE_TYPES: string[] = [...TYPE_RULES.map(([t]) => t), "Other"];
/** The kind of table with this title. */
export const typeOfTable = (title: string): string => TYPE_RULES.find(([, re]) => re.test(title.toLowerCase()))?.[0] ?? "Other";

/** The dungeon level a table is for, from its title ("LEVEL 1 ROOMS", "L2A - LEVEL 2 ANIMALS") or its code ("L1LR"); null if none. */
export function levelOfTable(title: string, code = ""): number | null {
  const m = title.match(/\blevel\s+(\d+)\b/i) ?? code.match(/^L(\d+)[A-Z]{0,3}$/i);
  return m ? +m[1] : null;
}
/** The distinct levels, lowest first. */
export const tableLevels = (all: TableEntry[]): number[] => [...new Set(all.map((e) => e.level).filter((l): l is number => l !== null))].sort((a, b) => a - b);

export type GroupBy = "type" | "book";

/** The list in the order a grouping shows it: by kind (then name, numbers in order), or as the books have it. */
export function groupTables(list: TableEntry[], by: GroupBy): TableEntry[] {
  if (by === "book") return list;
  const rank = (e: TableEntry) => TABLE_TYPES.indexOf(e.type);
  return list
    .map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { numeric: true }) || i - j)
    .map(([e]) => e);
}

export type SortKey ="title" | "code" | "dice" | "rows" | "book" | "chapter";
export interface TableFilter { text: string; book: string; dice: string; level: number | null; starred: boolean }
export const noTableFilter = (): TableFilter => ({ text: "", book: "", dice: "", level: null, starred: false });

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Every table you can roll on: a named table with rows, a dice formula and a roll column. Reference tables (an
 * inventory, the gods, a list of favours) are left out, and so is what the Bestiary and Items pages already show:
 * creature cards and item catalogs. A table continued on the next page is part of the one before it, and a table
 * printed twice (same book, title and rows) is listed once, at its first place.
 */
export function tableEntries(sections: Section[]): TableEntry[] {
  const out: TableEntry[] = [];
  const seen = new Set<string>();
  for (const s of sections) {
    s.blocks.forEach((b, i) => {
      if (b.type !== "table" || b.table.continued || !b.table.rows.length) return;
      const t = b.table;
      if (isCreatureTable(t) || isItemCatalogTable(t)) return;
      const title = clean(t.title || s.title);
      if (!title) return;
      const dice = t.dice ? clean(t.dice).toUpperCase() : "";
      const rollable = !!dice && rollColumns(t.rows).length > 0;
      if (!rollable) return;
      const sig = `${s.book}|${title.toLowerCase()}|${t.rows.map((r) => r.map(clean).join(" ~ ")).join(" // ")}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      const hay = [title, t.code, s.title, t.intro, t.columns.join(" "), t.rows.map((r) => r.join(" ")).join(" ")].filter(Boolean).join(" ").toLowerCase();
      out.push({ key: `${s.id}#${i}`, title, type: typeOfTable(title), level: levelOfTable(title, t.code ?? ""), code: t.code ? clean(t.code) : "", dice, rows: t.rows.length, book: s.book, sectionId: s.id, chapter: clean(s.title), page: b.page, rollable, table: t, hay });
    });
  }
  return out;
}

export const tableBooks = (all: TableEntry[]): string[] => [...new Set(all.map((e) => e.book))];

/** D6 < D20 < 2D6; any other formula (D66) after those. 0 = not rolled. */
const diceNum = (d: string): number => {
  const m = d.match(/^(\d*)D(\d+)$/i);
  return m ? (m[1] ? +m[1] : 1) * 1000 + +m[2] : d ? 1e9 : 0;
};
/** The distinct dice formulas, smallest first. */
export const tableDice = (all: TableEntry[]): string[] => [...new Set(all.map((e) => e.dice).filter(Boolean))].sort((a, b) => diceNum(a) - diceNum(b) || a.localeCompare(b));

export function filterTables(all: TableEntry[], f: TableFilter, stars: ReadonlySet<string> = new Set()): TableEntry[] {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((e) => {
    if (f.book && e.book !== f.book) return false;
    if (f.dice && e.dice !== f.dice) return false;
    if (f.level !== null && e.level !== f.level) return false;
    if (f.starred && !stars.has(e.key)) return false;
    return words.every((w) => e.hay.includes(w));
  });
}

/** A sorted copy. Blanks (no code, not rolled) go last either way; equal values keep the books' order. */
export function sortTables(list: TableEntry[], key: SortKey, dir: 1 | -1 = 1): TableEntry[] {
  const val = (e: TableEntry): string | number => (key === "dice" ? diceNum(e.dice) : key === "rows" ? e.rows : e[key].toLowerCase());
  const blank = (v: string | number) => v === "" || v === 0;
  return list
    .map((e, i) => [e, i] as const)
    .sort(([a, i], [b, j]) => {
      const x = val(a), y = val(b);
      if (blank(x) !== blank(y)) return blank(x) ? 1 : -1;
      const c = typeof x === "number" ? x - (y as number) : x.localeCompare(y as string, undefined, { numeric: true });
      return c ? c * dir : i - j;
    })
    .map(([e]) => e);
}
