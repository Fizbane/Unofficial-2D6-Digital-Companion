// The Dungeon turn's rules as plain functions (docs/spec-dungeon.md §1.4-1.9): what an exit needs before
// you can go through it, what a room's text asks for, what still blocks finishing a room. dungeon.ts draws
// from these; nothing here touches the page or saved state.
import { generatedFraction, isDoor, type DungeonMap, type ExitType, type MapExit, type MapRoom, type RoomKind } from "./dmap";
import { roomCells } from "./dmapshape";

/** A table roll as the saved state keeps it: data, never markup. */
export interface SavedRoll {
  title: string; dice: string; value: number; matched: boolean; columns: string[]; cells: string[];
  /** The prisoners this result freed have been tallied on the sheet. */
  liberated?: boolean;
  /** A stable id, given when a button needs to find this roll again (autoapply.ts findRoll). */
  lid?: string;
}

/** How many prisoners an Encounter Prisoner result frees: "L1PR" / "L2PR" (the book's short form), or "liberate one/two prisoner(s)". */
export function prisonersIn(text: string): number {
  const code = /\bL([12])PR\b/.exec(text);
  if (code) return +code[1];
  const words = /\bliberate (one|two|1|2) prisoners?\b/i.exec(text);
  return words ? (/^(two|2)$/i.test(words[1]) ? 2 : 1) : 0;
}
/** A door, lock, portcullis or slab roll, as data. */
export type DoorNote =
  | { k: "door"; kind: string; value: number; locked: boolean; marked: boolean }
  | { k: "pick"; q: number; mod: number; quality: number; a: number; prec: number; pick: number; total: number; ok: boolean }
  | { k: "roll"; roll: SavedRoll }
  | { k: "slab"; value: number; disc: number };

/** What is known about one exit's door. `picked`: the one pick attempt was made (or declined). `waited`: the ration step of waiting for a patrol. */
export interface DoorState { checked?: boolean; locked?: boolean; open?: boolean; picked?: boolean; waited?: "ration" | "none"; patrolled?: boolean; note?: DoorNote[] }
export type Doors = Record<number, DoorState>;

/** The D6 results a door of this type is locked on, in words; null for what never locks. */
export const lockedOn = (t: ExitType): string | null => (t === "wooden" ? "6" : t === "reinforced" ? "5–6" : t === "metal" ? "4–6" : null);
export const isLockedRoll = (t: ExitType, d6: number): boolean => (t === "wooden" ? d6 >= 6 : t === "reinforced" ? d6 >= 5 : t === "metal" ? d6 >= 4 : false);

/** An exit's door state. With none saved, a door the map already shows locked (an older save, or ALL LOCKED) is checked and locked. */
export function doorOf(doors: Doors, e: MapExit): DoorState {
  const d = doors[e.id];
  if (d) return d;
  return e.locked || e.allLocked ? { checked: true, locked: true } : {};
}

export type DoorNeed = "pick-type" | "walk" | "check" | "open" | "locked" | "wait" | "lever" | "slab";
/** What exit `e` needs next. */
export function doorNeed(e: MapExit, d: DoorState): DoorNeed {
  if (e.type === "unknown") return "pick-type";
  if (d.open) return "open";
  if (isDoor(e.type)) return !d.checked ? "check" : !d.locked ? "open" : d.picked ? "wait" : "locked";
  if (e.type === "portcullis") return "lever";
  if (e.type === "slab") return "slab";
  return "walk";
}
/** Can the next room be rolled through this exit? */
export const passable = (e: MapExit, d: DoorState): boolean => {
  const n = doorNeed(e, d);
  return n === "walk" || n === "open";
};

/** HP after waiting at a lock for a patrol: +2 per Adventurer Level with a ration (never above baseline), -2 per level without. */
export function waitHp(hp: number, baseline: number, level: number, ration: boolean): number {
  return ration ? Math.max(hp, Math.min(baseline, hp + 2 * level)) : Math.max(0, hp - 2 * level);
}
/** HP after the stairs: +2 per Adventurer Level (+2 with a cloth or bandage, never above baseline), or lose half (at most 20). */
export function stairsHp(hp: number, baseline: number, level: number, ration: boolean, cloth: boolean): number {
  return ration ? Math.max(hp, Math.min(baseline, hp + 2 * level + (cloth ? 2 : 0))) : hp - Math.min(20, Math.floor(hp / 2));
}

/**
 * The creature cards a text names in CAPITALS, longest name first. A name found is taken out of the text, so
 * "GUARD AND GUARD DOG" is a guard dog and a guard, and "GUARD DOG" alone is not also a guard.
 */
export function creaturesIn(text: string, names: string[]): string[] {
  const out: string[] = [];
  let rest = text;
  for (const n of [...new Set(names.map((x) => x.toUpperCase().trim()))].sort((a, b) => b.length - a.length)) {
    if (n.length < 3) continue;
    const re = new RegExp(`(^|[^A-Z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}S?(?=$|[^A-Z])`, "g");
    if (!re.test(rest)) continue;
    out.push(n);
    rest = rest.replace(re, "$1 ");
  }
  return out;
}

export interface EncounterActions { creatures: string[]; tables: { code: string; modifier: number }[] }
/** What a room's text asks for: the creature cards it names in CAPITALS, and the tables it says to roll (each once, in order). */
export function encounterActions(text: string, creatureNames: string[], hasTable: (code: string) => boolean): EncounterActions {
  const tables: { code: string; modifier: number }[] = [];
  const re = /\b([A-Z][A-Z0-9]{1,6})\b(?:\s*([+\-−]\s?\d+)(?!\d|\s*(?:HP|XP|c\b|damage|Shift)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)))
    if (/\d/.test(m[1]) && hasTable(m[1]) && !tables.some((t) => t.code === m![1]))
      tables.push({ code: m[1], modifier: m[2] ? parseInt(m[2].replace(/\s/g, "").replace("−", "-"), 10) : 0 });
  return { creatures: creaturesIn(text, creatureNames), tables };
}

/** What finishBlock needs to know about the room in progress. */
export interface FlowDraft {
  kind: RoomKind; hasRoom: boolean; duplicate: boolean; pctShort: boolean; exits?: number; exitTypeKnown: boolean; encDone?: boolean;
  byBook?: { type?: boolean; exits?: boolean };
}
/** Why the room can't be finished yet (its first unfinished step), or null when it can. */
export function finishBlock(d: FlowDraft): string | null {
  const tabled = d.kind !== "corridor" && d.kind !== "entrance";
  if (tabled && !d.byBook?.type) {
    if (!d.hasRoom) return "Roll the room type first";
    if (d.duplicate) return "This unique room is already on this level: re-roll";
    if (d.pctShort) return "Too early for this room: re-roll";
  }
  if (d.kind !== "entrance") {
    if (d.exits === undefined) return "Roll the exits first"; // a D6, never a locked table
    if (d.exits > 0 && !d.exitTypeKnown && !d.byBook?.exits) return "Set the exit type first"; // a dead end has none to type
  }
  if (tabled && !d.encDone) return "Deal with the encounter first";
  return null;
}

/** Percent of the level drawn so far: room floor (the room in progress too) and exit squares, over the map's area. */
export function exploredPct(m: DungeonMap): number {
  return Math.round(generatedFraction(m) * 100);
}

/** How many of room r's squares lie against the Outer Boundary (exit shafts are searched there). */
export function boundarySquares(m: DungeonMap, r: MapRoom): number {
  let n = 0;
  for (const [x, y] of roomCells(r)) if (x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1) n++;
  return n;
}

/**
 * Give an exit back for re-typing: a mis-tap in the type picker, or a room whose exits aren't all one kind
 * (doors on most walls but a slab on one). It forgets what was known about its door.
 */
export function retypeExit(doors: Doors, e: MapExit): void {
  e.type = "unknown";
  delete e.locked;
  delete e.allLocked;
  delete doors[e.id];
}

/** Forget the doors of a room that is leaving the map. */
export function clearRoomDoors(doors: Doors, m: DungeonMap, roomId: number): void {
  for (const e of m.exits) if (e.room === roomId) delete doors[e.id];
}
