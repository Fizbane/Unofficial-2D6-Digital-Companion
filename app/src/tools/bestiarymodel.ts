// The Bestiary's data: every creature, NPC and alien card in the unlocked books, as one flat list to browse.
// DOM-free so it can be tested. A card is a "Field | Value" table with a NAME and an HP (isCreatureTable).
import type { Section, Table } from "../types";
import { isCreatureTable } from "./common";
import { CREATURE_TYPES } from "../creaturetypes";

export interface BeastEntry {
  /** Unique: section id, block index. */
  key: string;
  name: string;
  /** 0 when the card has no level. */
  level: number;
  /** The circled type letter on the card ("" when none). */
  type: string;
  hp: number;
  xp: number | null;
  sectionId: string;
  book: string;
  page: number;
  /** The card itself, to draw in full. */
  table: Table;
  /** Index of the table block in its section (the card renderer keys flags by it). */
  idx: number;
}

/** Void's alien types (its card legend); Dungeon's come from the Creature Type Symbols table. */
export const VOID_TYPES: Record<string, string> = { B: "Biological", C: "Cyborg", E: "Energy", R: "Robotic", S: "Synthetic", P: "Pirate" };

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/'‘-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
const row = (t: Table, re: RegExp): string => t.rows.find((r) => re.test((r[0] ?? "").trim()))?.[1] ?? "";

/** The type's name for a letter in this game ("H" → "Humanoid"), or "" for none. */
export const typeLabel = (letter: string, game: "dungeon" | "void"): string =>
  letter ? ((game === "void" ? VOID_TYPES : CREATURE_TYPES)[letter] ?? letter) : "";

/** Every creature card in these sections, in book order. */
export function beastEntries(sections: readonly Section[]): BeastEntry[] {
  const out: BeastEntry[] = [];
  const seen = new Set<string>(); // the same card printed in two books shows once
  for (const s of sections) {
    if (/\bcharacter\s+sheet\b/i.test(s.title)) continue;
    if (s.book === "core" && /^creature card\b/i.test(s.title)) continue; // the Core Rules' worked examples; the real cards are in the Codex
    s.blocks.forEach((b, idx) => {
      if (b.type !== "table" || !isCreatureTable(b.table)) return;
      const t = b.table;
      const name = (row(t, /^NAME$/i) || t.title || "").trim();
      if (!name || /^zed\s+the\s+fearless$/i.test(name) || /\bcharacter\s+sheet\b/i.test(t.title ?? "")) return;
      const lvl = row(t, /^LEVEL/i);
      if (s.book !== "codex" && !lvl.trim() && !/\(L\s*\d+\)/i.test(s.title)) return; // no level: a character sheet example, not a creature
      const fromTitle = s.title.match(/\(L\s*(\d+)\)/i)?.[1];
      const levelText = s.book === "codex"
        ? lvl.trim().match(/^L\s*(10|[1-9])(?:\s+\{(?:circled\s+)?[A-Z]\})?$/i)?.[1] ?? fromTitle
        : lvl.match(/L\s*(\d+)/i)?.[1] ?? fromTitle;
      const parsedLevel = Number(levelText) || 0;
      const level = s.book === "codex" && parsedLevel > 10 ? 0 : parsedLevel;
      const xpText = row(t, /^XP$/i).trim();
      const xp = s.book === "codex" && !/^\d+$/.test(xpText) ? null : parseInt(xpText, 10) || 0;
      const type = lvl.match(/\{(?:circled\s+)?([A-Z])\b/i)?.[1]?.toUpperCase() ?? "";
      const id = [titleCase(name), level, parseInt(row(t, /^(HP|HEALTH POINTS)$/i), 10) || 0, xp].join("|");
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        key: `${s.id}#${idx}`,
        name: titleCase(name),
        level,
        type,
        hp: parseInt(row(t, /^(HP|HEALTH POINTS)$/i), 10) || 0,
        xp,
        sectionId: s.id,
        book: s.book,
        page: b.page,
        table: t,
        idx,
      });
    });
  }
  return out;
}

export interface BeastFilter { text: string; level: number | null; type: string; book: string }
export const noFilter = (): BeastFilter => ({ text: "", level: null, type: "", book: "" });

/** The entries that pass the filter, sorted by level then name. */
export function filterBeasts(all: readonly BeastEntry[], f: BeastFilter): BeastEntry[] {
  const q = f.text.trim().toLowerCase();
  return all
    .filter((e) => (!q || e.name.toLowerCase().includes(q)) && (f.level === null || e.level === f.level) && (!f.type || e.type === f.type) && (!f.book || e.book === f.book))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/** The distinct values to offer as filter chips, in order. */
export const levelsOf = (all: readonly BeastEntry[]): number[] => [...new Set(all.map((e) => e.level))].sort((a, b) => a - b);
export const typesOf = (all: readonly BeastEntry[]): string[] => [...new Set(all.map((e) => e.type).filter(Boolean))].sort();
export const booksOf = (all: readonly BeastEntry[]): string[] => [...new Set(all.map((e) => e.book))];
