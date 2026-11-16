// The Lairs tool's model, DOM-free: which book sections make up each lair, the level-variant rule and the
// retreat counter. Rules and wording live in the owner's imported Lairs book (docs/spec-lairs.md), never here:
// this file holds section ids and arithmetic only.
import type { Section } from "../types";

export type LairId = "caves" | "swamp" | "mine" | "basins";

export interface LairDef {
  id: LairId;
  /** Vol 1 lairs cannot be re-entered after a retreat; Vol 2 lairs can, with the Intimidated counter. */
  vol: 1 | 2;
  /** The lair's own rules section and the volume's shared introduction. */
  intro: string;
  shared: string;
  /** Rollable section ids: normal rooms, large rooms (32+ squares), small rooms (6 or fewer), incidents. */
  rooms: string;
  large: string;
  small: string;
  incidents: string;
  /** The mine's final room: creature and treasure tables. */
  finalCreature?: string;
  finalTreasure?: string;
  /** The Swamp's flooded-room and Soaked rules. */
  flooded?: boolean;
  soakedTable?: string;
}

export const LAIRS: readonly LairDef[] = [
  {
    id: "caves", vol: 1, intro: "lairs/p11-1", shared: "lairs/p8-1",
    rooms: "lairs/p20-1", large: "lairs/p15-1",
    small: "lairs/p16-1", incidents: "lairs/p18-1",
  },
  {
    id: "swamp", vol: 1, intro: "lairs/p11-2", shared: "lairs/p8-1",
    rooms: "lairs/p28-1", large: "lairs/p26-1",
    small: "lairs/p27-1", incidents: "lairs/p24-1",
    flooded: true, soakedTable: "lairs/p23-1",
  },
  {
    id: "mine", vol: 2, intro: "lairs/p47-1", shared: "lairs/p44-1",
    rooms: "lairs/p50-1", large: "lairs/p66-1",
    small: "lairs/p67-1", incidents: "lairs/p63-1",
    finalCreature: "lairs/p70-2", finalTreasure: "lairs/p68-1",
  },
  {
    id: "basins", vol: 2, intro: "lairs/p48-1", shared: "lairs/p44-1",
    rooms: "lairs/p56-1", large: "lairs/p54-1",
    small: "lairs/p55-1", incidents: "lairs/p61-1",
  },
];
export const lairById = (id: string): LairDef | undefined => LAIRS.find((l) => l.id === id);

export interface Variant { level: number; id: string; title: string }

/**
 * The variant to fight: the one whose level is closest to yours at the start of the combat; on a tie, the
 * lower one when you are at half your HP or less (`hpFraction` 0..1), else the higher. (The book gives the
 * low-HP tie only; taking the higher otherwise is this tool's reading: spec §1.)
 */
export function closestVariant<T extends { level: number }>(variants: readonly T[], level: number, hpFraction: number): T | undefined {
  let best: T | undefined;
  for (const v of variants) {
    if (!best) { best = v; continue; }
    const dv = Math.abs(v.level - level), db = Math.abs(best.level - level);
    if (dv < db) best = v;
    else if (dv === db && v.level !== best.level) best = hpFraction <= 0.5 ? (v.level < best.level ? v : best) : v.level > best.level ? v : best;
  }
  return best;
}

/** The Haunted House chapter starts here in the Lairs Omnibus: its creatures belong to that tool, not the lairs. */
export const HOUSE_FIRST_PAGE = 77;

/** Creature cards grouped by name: "NAME (L7)" sections of the Lairs book's two lair volumes, each group sorted by level. */
export function groupVariants(sections: readonly Section[]): Map<string, Variant[]> {
  const out = new Map<string, Variant[]>();
  for (const s of sections) {
    if (s.book !== "lairs" || (s.pages?.[0] ?? 0) >= HOUSE_FIRST_PAGE) continue;
    const m = s.title.trim().match(/^(.+?)\s*\(L(\d+)\)$/i);
    if (!m || !s.blocks.some((b) => b.type === "table" && b.table.columns[0]?.toLowerCase() === "field")) continue;
    const name = m[1].trim();
    const list = out.get(name) ?? [];
    list.push({ level: +m[2], id: s.id, title: s.title.trim() });
    out.set(name, list);
  }
  for (const l of out.values()) l.sort((a, b) => a.level - b.level);
  return new Map([...out].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Vol 2's Intimidated bonus: +1 damage per retreat from the same creature, at most +3. */
export const intimidation = (retreats: number): number => Math.max(0, Math.min(3, Math.floor(retreats)));
