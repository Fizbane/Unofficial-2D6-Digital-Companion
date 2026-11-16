// Lair maps, DOM-free: the dungeon map model (dmap.ts) at each lair's own size (docs/spec-lairs.md §0, §4):
// one or three levels, the mine's unexplorable central shaft, the fixed entrance rooms. All exits are archways.
import { addRoom, entrySideFor, findPlacement, nextExit, placeEntrance, placeExits, type DungeonMap, type MapRoom } from "./dmap";
import type { LairId } from "./lairsmodel";

export interface LairMapSpec {
  size: number; // squares per side
  levels: number;
  /** A square hole of this size in the centre of every level (the mine's shaft). */
  shaft?: number;
  /** The first room of level 1: its size (it gets three exits, one on each free wall, and no encounter). */
  entrance: { w: number; h: number } | null;
}
export const LAIR_MAPS: Record<LairId, LairMapSpec> = {
  caves: { size: 25, levels: 1, entrance: null },
  swamp: { size: 25, levels: 1, entrance: null },
  mine: { size: 25, levels: 3, shaft: 5, entrance: { w: 5, h: 5 } },
  basins: { size: 30, levels: 1, entrance: { w: 2, h: 2 } },
};

const SHAFT = "Central shaft";
const isShaft = (r: MapRoom) => r.label === SHAFT;
const blank = (size: number): DungeonMap => ({ w: size, h: size, rooms: [], exits: [], sel: null, stairs: null, nextId: 1, entrance: null });

/** A level's empty map: the shaft, if the lair has one, and on level 1 the lair's fixed entrance room. */
export function newLairMap(spec: LairMapSpec, level: number, entranceLabel = "Entrance"): DungeonMap {
  const m = blank(spec.size);
  if (spec.shaft) {
    const at = Math.floor((spec.size - spec.shaft) / 2);
    addRoom(m, { n: 0, x: at, y: at, w: spec.shaft, h: spec.shaft, kind: "large", label: SHAFT, sub: "Open shaft: cannot be explored" });
  }
  if (level === 1 && spec.entrance) addLairRoom(m, spec.entrance.w, spec.entrance.h, 3, entranceLabel, [1, 3, 5]);
  return m;
}

/** Rooms the party has drawn (the shaft is not one). */
export const lairRooms = (m: DungeonMap): MapRoom[] => m.rooms.filter((r) => !isShaft(r));

/**
 * Draw the next room: through the chosen (or newest) open exit, or from the entrance square when the level
 * has no rooms yet. It is drawn as large as fits within w×h. Returns the room, or null when nothing fits
 * (the exit is then marked blocked).
 */
export function addLairRoom(m: DungeonMap, w: number, h: number, exits: number, label: string, placeRolls: number[] = []): MapRoom | null {
  const first = lairRooms(m).length === 0;
  const exit = first ? undefined : nextExit(m);
  if (!first && !exit) return null;
  const spot = exit ? findPlacement(m, exit, w, h) : placeEntrance(m, w, h);
  if (!spot) {
    if (exit) exit.blocked = true;
    return null;
  }
  const n = lairRooms(m).length + 1;
  const area = spot.w * spot.h;
  const room = addRoom(m, { n, ...spot, kind: first ? "entrance" : area <= 6 ? "small" : area >= 32 ? "large" : "regular", label, sub: `${spot.w}×${spot.h}` });
  if (exit) exit.to = room.id;
  m.sel = null;
  placeExits(m, room, exit ? entrySideFor(exit) : "S", Math.max(0, Math.min(3, exits)), "archway", false, placeRolls);
  return room;
}

/** The dead-end rule: an extra exit on the newest room that can take one. False when no wall has room for it. */
export function addSecretExit(m: DungeonMap): boolean {
  for (const r of [...lairRooms(m)].reverse()) {
    // placeExits replaces a room's unexplored exits: mark them as leading somewhere while one more is added
    const open = m.exits.filter((e) => e.room === r.id && e.to === undefined);
    for (const e of open) e.to = -1;
    const placed = placeExits(m, r, null, 1, "archway", false, []);
    for (const e of open) delete e.to;
    if (placed) return true;
  }
  return false;
}

/** How much of a level is drawn, 0..1: room squares over the squares that can be explored (the shaft can't). */
export function exploredFraction(m: DungeonMap): number {
  const shaft = m.rooms.filter(isShaft).reduce((n, r) => n + r.w * r.h, 0);
  const total = m.w * m.h - shaft;
  return total > 0 ? lairRooms(m).reduce((n, r) => n + r.w * r.h, 0) / total : 0;
}

/** Exits added for a D6 roll (Core Rules: 1 none, 2–3 one, 4–5 two, 6 three). */
export const exitsForRoll = (d6: number): number => (d6 <= 1 ? 0 : d6 <= 3 ? 1 : d6 <= 5 ? 2 : 3);
