// Dungeon map: grid model, room/exit placement by the book's rules, and a hand-drawn-style colour SVG renderer.
// Rules used (docs/spec-dungeon.md §1): rooms attach beyond an exit square; rooms never overlap
// and are clipped to the Outer Boundary ("draw it as large as fits"); max one exit per wall,
// none on the wall you entered by, none on the Outer Boundary; random placement goes clockwise
// from the entrance wall (D6: 1-2 first wall, 3-4 second, 5-6 third).

import { itemSvg, planDressing, type DecorItem } from "./dmapdecor";
import { getMapView, getTileSetId, tileSetById, type MapView, type TileSet } from "./dmaptiles";
import { renderIsoMap } from "./dmapiso";
import { carve, familyFor, inRoom, outlinePath, roomCells, roomPath, type Cell, type Family } from "./dmapshape";
import { html, type Raw } from "../ui/html";

export type Side = "N" | "E" | "S" | "W";
/** Every exit type, the one list the type and the saved-data checks (journalmodel.ts) share. */
export const EXIT_TYPE_LIST = [
  "archway", "wooden", "metal", "reinforced", "portcullis", "curtain", "slab", "unknown",
  // 2D6 Void's exits (void/hulkmodel.ts); Dungeon never produces them
  "sliding", "security", "biocoded", "barrier", "secret",
] as const;
export type ExitType = (typeof EXIT_TYPE_LIST)[number];
export type RoomKind = "entrance" | "corridor" | "small" | "regular" | "large";

export interface MapRoom {
  id: number; n: number; x: number; y: number; w: number; h: number; kind: RoomKind; label: string; sub: string; draft?: boolean;
  cells?: Cell[]; // a room drawn in a shape (dmapshape.ts): its squares, and x/y/w/h are their bounding box
  details?: [string, string][]; // the room table row (column, value) once rolled
  notes?: string; // the player's own notes
}
export interface MapExit {
  id: number;
  room: number; // room the exit belongs to
  side: Side; // wall of that room
  x: number; // the exit square (one cell outside the wall)
  y: number;
  type: ExitType;
  locked?: boolean;
  allLocked?: boolean;
  to?: number; // room reached through it
  blocked?: boolean; // no room fits beyond it
  oneWay?: boolean; // Core Rules p. 18 secret wooden door
}
export interface DungeonMap {
  w: number; h: number; rooms: MapRoom[]; exits: MapExit[]; sel: number | null; stairs: number | null; nextId: number;
  entrance: { x: number; y: number; side?: Side } | null; // entrance side: the way into its room, north unless turned (dmaprotate.ts)
  /** The level's standard grid side (20, or 25 on level 10). The half-explored rule counts against this, not a bigger custom grid. Absent on older maps (they were standard size). */
  std?: number;
}

export const MAX_DUNGEON_GRID = 1000;
export const minDungeonGrid = (level: number) => level === 10 ? 25 : 20;

export function validDungeonGrid(level: number, w: number, h: number): boolean {
  const min = minDungeonGrid(level);
  return [w, h].every((size) => Number.isInteger(size) && size >= min && size <= MAX_DUNGEON_GRID);
}

export const newMap = (level: number, w = minDungeonGrid(level), h = w): DungeonMap =>
  ({ w, h, rooms: [], exits: [], sel: null, stairs: null, nextId: 1, entrance: null, std: minDungeonGrid(level) });

export const DIR: Record<Side, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const CLOCKWISE: Side[] = ["N", "E", "S", "W"];
const opposite = (s: Side): Side => ({ N: "S", S: "N", E: "W", W: "E" })[s] as Side;
/** The way from the entrance square into its room: north, unless the map was turned for drawing. */
export const entranceStep = (e: { side?: Side }): [number, number] => DIR[e.side ?? "N"];
/** The room square just inside the entrance. */
export const insideEntrance = (e: { x: number; y: number; side?: Side }): Cell => [e.x + entranceStep(e)[0], e.y + entranceStep(e)[1]];

/** Parse an exit description from the books ("WOODEN DOORS", "ARCHWAYS (ALL LOCKED)") */
export function parseExitType(s: string | undefined): { type: ExitType; allLocked: boolean } {
  const t = (s ?? "").toUpperCase().split("/")[0];
  const allLocked = /ALL\s*LOCKED/.test(s?.toUpperCase() ?? "");
  const type: ExitType = /ARCH/.test(t) ? "archway" : /REINF/.test(t) ? "reinforced" : /METAL/.test(t) ? "metal" : /WOOD/.test(t) ? "wooden"
    : /PORTC/.test(t) ? "portcullis" : /CURTAIN/.test(t) ? "curtain" : /SLAB/.test(t) ? "slab" : "unknown";
  return { type, allLocked };
}
export const isDoor = (t: ExitType) => t === "wooden" || t === "metal" || t === "reinforced";

/**
 * The exit type a Leave-step check is about: the map exit's own type when it is a door, else the
 * kind that was checked (an archway / unknown exit checked as a "Metal door" is a metal door).
 */
export const doorCheckType = (exit: ExitType, checked?: ExitType): ExitType => (checked && !isDoor(exit) ? checked : exit);

const EXIT_NAME: Record<ExitType, string> = {
  archway: "Archway", wooden: "Wooden door", metal: "Metal door", reinforced: "Reinforced door",
  portcullis: "Portcullis", curtain: "Curtain", slab: "Stone slab", unknown: "Exit (type not rolled yet)",
  sliding: "Sliding door", security: "Security door", biocoded: "Bio-coded door", barrier: "Electrical barrier", secret: "Secret panel (one-way)",
};
const SIDE_WORD: Record<Side, string> = { N: "north", E: "east", S: "south", W: "west" };
/** Hover text for an exit on the map, e.g. "Wooden door · east wall · locked". */
export function exitLabel(e: MapExit): string {
  const bits = [e.oneWay ? "Secret wooden door (one-way)" : EXIT_NAME[e.type] ?? EXIT_NAME.unknown, `${SIDE_WORD[e.side]} wall`];
  if (e.locked) bits.push("locked");
  if (e.blocked) bits.push("blocked");
  else if (e.to === undefined) bits.push("unexplored");
  return bits.join(" · ");
}

// ---------- occupancy ----------
function occupied(m: DungeonMap, ignoreExit?: number): Set<string> {
  const o = new Set<string>();
  for (const r of m.rooms) for (const [x, y] of roomCells(r)) o.add(`${x},${y}`);
  for (const e of m.exits) if (e.id !== ignoreExit) o.add(`${e.x},${e.y}`);
  if (m.entrance) o.add(`${m.entrance.x},${m.entrance.y}`);
  return o;
}
/**
 * The fraction of the level already drawn, including entrance and exit squares. A grid made bigger than the
 * standard one counts against the standard area, so "half explored" stays reachable (and caps at 1).
 */
export function generatedFraction(m: DungeonMap): number {
  const std = m.std && m.std > 0 ? m.std * m.std : m.w * m.h;
  return Math.min(1, occupied(m).size / Math.min(m.w * m.h, std));
}

const inBounds = (m: DungeonMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;
function fits(m: DungeonMap, occ: Set<string>, x: number, y: number, w: number, h: number) {
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) if (!inBounds(m, i, j) || occ.has(`${i},${j}`)) return false;
  return true;
}

/** Candidate top-left positions for a w×h room beyond exit square (ex,ey) going `dir`, covering the exit column/row. */
function candidates(ex: number, ey: number, dir: Side, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  if (dir === "N" || dir === "S") {
    const y = dir === "N" ? ey - h : ey + 1;
    const centre = ex - Math.floor((w - 1) / 2);
    for (let k = 0; k < w; k++) for (const s of k === 0 ? [0] : [k, -k]) {
      const x = centre + s;
      if (ex >= x && ex < x + w) out.push([x, y]);
    }
  } else {
    const x = dir === "W" ? ex - w : ex + 1;
    const centre = ey - Math.floor((h - 1) / 2);
    for (let k = 0; k < h; k++) for (const s of k === 0 ? [0] : [k, -k]) {
      const y = centre + s;
      if (ey >= y && ey < y + h) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Find space for a room through `exit`. Tries the rolled size first, then the largest
 * smaller size that fits ("draw it as large as fits within the rolled dimensions").
 */
export function findPlacement(m: DungeonMap, exit: MapExit, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const occ = occupied(m, exit.id);
  occ.delete(`${exit.x},${exit.y}`);
  const sizes: [number, number][] = [];
  for (let ww = w; ww >= 1; ww--) for (let hh = h; hh >= 1; hh--) sizes.push([ww, hh]);
  // largest area first; for equal areas, the width closest to the rolled one (4x4 squeezed tries 4x3 before 3x4)
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1] || Math.abs(a[0] - w) - Math.abs(b[0] - w));
  for (const [ww, hh] of sizes)
    for (const [x, y] of candidates(exit.x, exit.y, exit.side, ww, hh)) if (fits(m, occ, x, y, ww, hh)) return { x, y, w: ww, h: hh };
  return null;
}

/** Entrance room: the entrance square at the bottom centre, the room directly above it. */
export function placeEntrance(m: DungeonMap, w: number, h: number) {
  const ex = Math.floor(m.w / 2), ey = m.h - 1;
  m.entrance = { x: ex, y: ey };
  const fake: MapExit = { id: -1, room: 0, side: "N", x: ex, y: ey, type: "archway" };
  return findPlacement(m, fake, w, h);
}

export function addRoom(m: DungeonMap, r: Omit<MapRoom, "id">): MapRoom {
  const room = { ...r, id: m.nextId++ };
  m.rooms.push(room);
  return room;
}

const SHIFTS: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * Give room r a footprint in `family`: the same number of squares as now, drawn in a shape. Every exit
 * that reaches the room must still touch it, and the shape can't cover another room, an exit or the entrance.
 * Returns false, leaving the room as it was, when no such shape fits.
 */
export function reshapeRoom(m: DungeonMap, r: MapRoom, family: Family, seed: number): boolean {
  const own = roomCells(r);
  const area = own.length;
  const occ = occupied(m);
  for (const [x, y] of own) occ.delete(`${x},${y}`);
  const links = m.exits.filter((e) => e.room === r.id || e.to === r.id);
  for (let attempt = 0; attempt < 12; attempt++) {
    const shape = carve(area, family, seed + attempt * 977);
    if (!shape) continue;
    const sw = Math.max(...shape.map((c) => c[0])) + 1, sh = Math.max(...shape.map((c) => c[1])) + 1;
    const baseX = r.x + Math.floor((r.w - sw) / 2), baseY = r.y + Math.floor((r.h - sh) / 2);
    for (const [dx, dy] of SHIFTS) {
      const cells: Cell[] = shape.map(([a, b]) => [baseX + dx + a, baseY + dy + b]);
      if (cells.some(([x, y]) => !inBounds(m, x, y) || occ.has(`${x},${y}`))) continue;
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      const trial = { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1, cells };
      const linked = links.every((e) => {
        const [ddx, ddy] = DIR[e.side];
        // the room's square beside the exit: on the room's side of it, whichever way the exit leads
        const [rx, ry] = e.room === r.id ? [e.x - ddx, e.y - ddy] : [e.x + ddx, e.y + ddy];
        return inRoom(trial, rx, ry);
      });
      if (!linked) continue;
      Object.assign(r, trial);
      return true;
    }
  }
  return false;
}

/** The square of room r that is furthest along `score` (ties go to the first in reading order). */
export function cornerCell(r: MapRoom, score: (x: number, y: number) => number): Cell {
  let best: Cell = [r.x, r.y], bestS = -Infinity;
  for (const c of roomCells(r)) {
    const s = score(c[0], c[1]);
    if (s > bestS) [best, bestS] = [c, s];
  }
  return best;
}

/** Cells on `side` of room r where an exit square could go (outside the wall, in bounds, free). */
function exitSpots(m: DungeonMap, r: MapRoom, side: Side, occ: Set<string>): [number, number][] {
  const spots: [number, number][] = [];
  const [dx, dy] = DIR[side];
  // the room's outermost square on each line (column for N/S, row for E/W): the exit goes just outside it
  const vertical = side === "N" || side === "S";
  const outer = new Map<number, number>();
  for (const [x, y] of roomCells(r)) {
    const k = vertical ? x : y, p = vertical ? y : x;
    const cur = outer.get(k);
    if (cur === undefined || (side === "N" || side === "W" ? p < cur : p > cur)) outer.set(k, p);
  }
  const mid = vertical ? r.x + Math.floor((r.w - 1) / 2) : r.y + Math.floor((r.h - 1) / 2);
  const order = [mid];
  for (let k = 1; k < Math.max(r.w, r.h); k++) order.push(mid + k, mid - k);
  for (const v of order) {
    const p = outer.get(v);
    if (p === undefined) continue;
    spots.push(vertical ? [v, side === "N" ? p - 1 : p + 1] : [side === "W" ? p - 1 : p + 1, v]);
  }
  // the exit square must be inside the boundary (an exit onto the Outer Boundary isn't allowed),
  // free, and lead somewhere: the square beyond it must also be inside the boundary.
  return spots.filter(([x, y]) => inBounds(m, x, y) && !occ.has(`${x},${y}`) && inBounds(m, x + dx, y + dy));
}

/**
 * Add `count` exits to room r. `entry` is the wall the party came in by (no new exit there).
 * `placeRolls` are D6 results (one per exit) for the clockwise placement rule.
 * Returns how many could actually be placed (extra ones are ignored, per the rules).
 */
export function placeExits(m: DungeonMap, r: MapRoom, entry: Side | null, count: number, type: ExitType, allLocked: boolean, placeRolls: number[]): number {
  // drop any exits previously placed for this room (re-roll) that don't lead anywhere yet
  m.exits = m.exits.filter((e) => e.room !== r.id || e.to !== undefined);
  const used = new Set(m.exits.filter((e) => e.room === r.id).map((e) => e.side));
  if (entry) used.add(entry);
  const start = entry ? CLOCKWISE.indexOf(entry) : CLOCKWISE.indexOf("S");
  const order = [1, 2, 3].map((k) => CLOCKWISE[(start + k) % 4]); // first, second, third wall clockwise
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const occ = occupied(m);
    const v = placeRolls[i] ?? 1 + Math.floor(Math.random() * 6);
    const first = v <= 2 ? 0 : v <= 4 ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const side = order[(first + k) % 3];
      if (used.has(side)) continue;
      const spot = exitSpots(m, r, side, occ)[0];
      if (!spot) continue;
      m.exits.push({ id: m.nextId++, room: r.id, side, x: spot[0], y: spot[1], type, allLocked, locked: allLocked && isDoor(type) ? true : undefined });
      used.add(side);
      placed++;
      break;
    }
  }
  return placed;
}

/** The entrance room always gets 3 archways, one on each side without an exit. */
export function placeEntranceExits(m: DungeonMap, r: MapRoom) {
  return placeExits(m, r, "S", 3, "archway", false, [1, 3, 5]);
}

/**
 * Copy what the maps and the Notes panel edit (room notes, the stairs, the chosen exit) from the saved
 * map into the in-memory one, in place: room and exit objects keep their identity, so a roll that
 * is awaiting dice still writes into the live map. Rooms missing from `saved` are left alone.
 */
export function mergePanelEdits(mem: DungeonMap, saved: DungeonMap): void {
  for (const sr of saved.rooms) {
    const r = mem.rooms.find((x) => x.id === sr.id);
    if (!r) continue;
    if (sr.notes) r.notes = sr.notes;
    else delete r.notes;
  }
  mem.stairs = saved.stairs ?? null;
  mem.sel = saved.sel ?? null;
}

/** Crossing a secret door seals the part of the level generated before its destination. */
export function sealedDungeonRooms(m: DungeonMap): ReadonlySet<number> {
  const destinations = new Set(m.exits.filter((e) => e.oneWay && e.to !== undefined).map((e) => e.to));
  let firstOpen = 0;
  for (const [i, room] of m.rooms.entries()) {
    if (destinations.has(room.id)) firstOpen = i;
  }
  return new Set(m.rooms.slice(0, firstOpen).map((room) => room.id));
}

export function openExits(m: DungeonMap): MapExit[] {
  const sealed = sealedDungeonRooms(m);
  return m.exits.filter((e) => e.to === undefined && !e.blocked && !sealed.has(e.room));
}

/** The exact halfway threshold matters even when the displayed percentage rounds up. */
export function needsDungeonSecretDoor(m: DungeonMap): boolean {
  return m.rooms.length > 0 && generatedFraction(m) < 0.5 && openExits(m).length === 0;
}

/** Place the secret door leading to the largest area where a rolled room could fit. */
export function addDungeonSecretDoor(m: DungeonMap): MapExit | undefined {
  if (!needsDungeonSecretDoor(m)) return;
  const occ = occupied(m);
  const sealed = sealedDungeonRooms(m);
  let best: MapExit | undefined;
  let bestArea = 0;
  let bestChoices = 0;
  for (const r of m.rooms) {
    if (r.kind === "corridor" || r.draft || sealed.has(r.id)) continue;
    const used = new Set<Side>();
    for (const e of m.exits) {
      if (e.room === r.id) used.add(e.side);
      if (e.to === r.id) used.add(opposite(e.side));
    }
    if (m.entrance && inRoom(r, m.entrance.x, m.entrance.y - 1)) used.add("S");
    let roomBest: MapExit | undefined;
    let roomArea = 0;
    let choices = 0;
    for (const side of CLOCKWISE) {
      if (used.has(side)) continue;
      for (const [x, y] of exitSpots(m, r, side, occ)) {
        const [dx, dy] = DIR[side];
        if (occ.has(`${x + dx},${y + dy}`)) continue;
        const candidate: MapExit = { id: m.nextId, room: r.id, side, x, y, type: "wooden", oneWay: true };
        const space = findPlacement(m, candidate, 11, 11);
        if (!space) continue;
        choices++;
        const area = space.w * space.h;
        if (area <= roomArea) continue;
        roomBest = candidate;
        roomArea = area;
      }
    }
    if (roomBest && (roomArea > bestArea || (roomArea === bestArea && choices > bestChoices))) {
      best = roomBest;
      bestArea = roomArea;
      bestChoices = choices;
    }
  }
  if (!best) return;
  m.nextId++;
  m.exits.push(best);
  m.sel = best.id;
  m.stairs = null;
  return best;
}

export const entrySideFor = (exit: MapExit): Side => opposite(exit.side);

/** The exit the next room goes through: the one tapped on the map, else the newest room's first open exit. */
export function nextExit(m: DungeonMap): MapExit | undefined {
  const open = openExits(m);
  const sel = open.find((e) => e.id === m.sel);
  if (sel) return sel;
  const newest = [...m.rooms].reverse().find((r) => open.some((e) => e.room === r.id));
  return newest ? open.find((e) => e.room === newest.id) : open[0];
}

const SIDE_NAME: Record<Side, string> = { N: "north", S: "south", E: "east", W: "west" };

/** One-line instruction shown under the map. */
export function mapHint(m: DungeonMap, roomInProgress: boolean): Raw {
  if (roomInProgress) return html`Finish this room, then tap a glowing exit to choose where to go.`;
  const open = openExits(m);
  const from = (e: MapExit) => m.rooms.find((r) => r.id === e.room)?.label ?? "the newest room";
  const sel = open.find((e) => e.id === m.sel);
  if (sel) return html`Next room goes through the <strong>${sel.type === "unknown" ? "exit" : sel.type}</strong> ${SIDE_NAME[sel.side]} of <strong>${from(sel)}</strong>.`;
  const next = nextExit(m);
  return next ? html`Tap a glowing exit to choose where to go next (otherwise: the ${SIDE_NAME[next.side]} exit of ${from(next)}).` : html`Every exit is explored or blocked.`;
}

export const LEGEND: [string, string][] = [["#b89a6a", "Archway"], ["#9a5b2a", "Wooden"], ["#8fa3b5", "Metal"], ["#3f4b5c", "Reinforced"], ["#4a4a4a", "Portcullis"], ["#b3243b", "Curtain"], ["#7d7768", "Stone slab"]];
export const legendHtml = () =>
  html`<div class="map-legend">${LEGEND.map(([c, l]) => html`<span><i style="background:${c}"></i>${l}</span>`)}<span><i style="background:#c62828;border-radius:50%"></i>Locked</span><span><i style="background:#e0a33a;border-radius:50%"></i>Unexplored exit</span></div>`;

/** Room names belong in the reference under the map. */
export function roomReferenceHtml(m: DungeonMap): Raw {
  const sealed = sealedDungeonRooms(m);
  return html`<section class="map-room-reference" aria-label="Room reference">
    <h3>Room reference</h3>
    <ul>${[...m.rooms].sort((a, b) => a.n - b.n).map((room) =>
      html`<li><b>${room.n}</b><span>${room.label}${sealed.has(room.id) ? html` <small class="muted">(sealed)</small>` : ""}</span></li>`)}</ul>
  </section>`;
}

// ---------- rendering ----------
// Drawn in the chosen tile set (dmaptiles.ts): Paper (parchment, stone blocks, hatching),
// Dungeon (grey bricks and flagstones) or Caves (rough rock and earth). Every map gets boxed
// room labels, room dressing, a footprint trail and a token for the party.
const C = 26; // pixels per square
/** Shade the sealed portion of the map while keeping its floor plan readable. */
export function sealedRoomsSvg(rooms: MapRoom[], sealed: ReadonlySet<number>): Raw {
  return html`<g pointer-events="none">${rooms.filter((room) => sealed.has(room.id)).map((room) =>
    html`<path data-sealed-room="${room.id}" d="${roomPath(room, C)}" fill="#101014" fill-opacity=".64"/>`)}</g>`;
}

export function secretDoorMarker(x: number, y: number, tiles: TileSet): Raw {
  return html`<text x="${f1(x)}" y="${f1(y)}" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${tiles.labelInk}" stroke="${tiles.labelBg}" stroke-width="2.5" paint-order="stroke" pointer-events="none">s</text>`;
}
export const CELL = C;
/** The "has notes" pencil (Lucide pencil paths, 9px), drawn inline so it survives the PNG export and the map window. */
export const NOTE_PENCIL = html`<g transform="translate(-4.5 -4.5) scale(0.375)" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></g>`;
let svgUid = 0; // each drawn map gets its own ids, so several maps can share a page
export const DOOR: Record<ExitType, string> = { archway: "#b89a6a", wooden: "#9a5b2a", metal: "#8fa3b5", reinforced: "#3f4b5c", portcullis: "#4a4a4a", curtain: "#b3243b", slab: "#7d7768", unknown: "#a8987c",
  sliding: "#8fa3b5", security: "#d9a521", biocoded: "#3f9a5a", barrier: "#38c6ff", secret: "#6b6f75" };

/** Deterministic noise in [0,1) so the drawing doesn't jitter between redraws. */
export function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + k * 2246822519, 1274126177) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const f1 = (n: number) => Math.round(n * 10) / 10;

/** An irregular rounded-ish stone outline centred on (cx,cy). */
export function stone(cx: number, cy: number, r: number, seed: number): string {
  const n = 6 + Math.floor(rnd(seed, 7) * 3);
  const rot = rnd(seed, 11) * Math.PI;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const rr = r * (0.72 + rnd(seed, i + 20) * 0.38);
    pts.push(`${f1(cx + Math.cos(a) * rr)} ${f1(cy + Math.sin(a) * rr * 0.82)}`);
  }
  return `M${pts.join("L")}Z`;
}

function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

/** Where a room's label box goes: along the bottom wall (top wall if a door is in the way), or centred in thin rooms. */
function labelLayout(r: MapRoom, exits: MapExit[] = [], entrance: DungeonMap["entrance"] = null) {
  const text = `${r.n} · ${r.label}`;
  const onWall = Math.min(r.w, r.h) >= 2;
  let fs = 10;
  const maxW = Math.max(r.w * C - 8, C * 1.6);
  let lines = wrapLabel(text, Math.max(4, Math.floor(maxW / (fs * 0.56))));
  while (fs > 6.5 && lines.some((l) => l.length * fs * 0.56 > maxW)) {
    fs -= 0.5;
    lines = wrapLabel(text, Math.max(4, Math.floor(maxW / (fs * 0.56))));
  }
  const sub = !!r.sub && r.w >= 3;
  const bw = Math.max(...lines.map((l) => l.length), sub ? r.sub.length * 0.75 : 0) * fs * 0.56 + 8;
  const bh = lines.length * fs * 1.2 + 4 + (sub ? 8 : 0);
  const cs = roomCells(r);
  const cx = (cs.reduce((s, c) => s + c[0], 0) / cs.length + 0.5) * C; // the middle of the room's squares
  let cy = (cs.reduce((s, c) => s + c[1], 0) / cs.length + 0.5) * C;
  if (onWall) {
    const near = (x: number) => Math.abs((x + 0.5) * C - cx) < bw / 2 + 8;
    const blocks = (side: Side) => exits.some((e) => e.room === r.id && e.side === side && near(e.x)) || (!!entrance && side === opposite(entrance.side ?? "N") && entrance.y === (side === "S" ? r.y + r.h : r.y - 1) && near(entrance.x));
    cy = !blocks("S") || blocks("N") ? (r.y + r.h) * C - bh / 2 - 4 : r.y * C + bh / 2 + 4;
  }
  return { lines, fs, bw, bh, cx, cy, sub };
}

/** Place one small marker on an occupied square, clear of doors and other map markers where possible. */
function numberLayout(room: MapRoom, reserved: ReadonlySet<string>): ReturnType<typeof labelLayout> {
  const cells = roomCells(room);
  const middle = room.x + (room.w - 1) / 2;
  const [x, y] = [...cells].sort(([ax, ay], [bx, by]) =>
    Number(reserved.has(`${ax},${ay}`)) - Number(reserved.has(`${bx},${by}`))
    || by - ay || Math.abs(ax - middle) - Math.abs(bx - middle))[0];
  const number = String(room.n);
  return { lines: [number], fs: 10, bw: Math.max(14, number.length * 6 + 6), bh: 15, cx: (x + 0.5) * C, cy: (y + 0.5) * C, sub: false };
}

type Owner = { kind: "room"; id: number } | { kind: "exit"; id: number } | { kind: "entrance" };

export type Edge = "none" | "wall" | "open" | "door" | "unexplored";
export type MapScene = ReturnType<typeof mapScene>;

/** Shared geometry for both map views: who owns each square, what is on each edge, labels and dressing. */
export function mapScene(m: DungeonMap, ids: string, roomNumbers = false) {
  const key = (x: number, y: number) => `${x},${y}`;
  // who owns each floor square
  const owner = new Map<string, Owner>();
  for (const r of m.rooms) for (const [x, y] of roomCells(r)) owner.set(key(x, y), { kind: "room", id: r.id });
  for (const e of m.exits) owner.set(key(e.x, e.y), { kind: "exit", id: e.id });
  if (m.entrance) owner.set(key(m.entrance.x, m.entrance.y), { kind: "entrance" });
  const exitById = new Map(m.exits.map((e) => [e.id, e]));
  const roomById = new Map(m.rooms.map((r) => [r.id, r]));
  const inside = m.entrance && insideEntrance(m.entrance);
  const inBox = (r: MapRoom, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const entranceRoom = m.entrance && inside ? m.rooms.find((r) => inBox(r, ...inside) && !inBox(r, m.entrance!.x, m.entrance!.y)) : undefined;

  // what sits on the edge between square a and its neighbour b: nothing, a wall, a door, an open passage or an unexplored end
  const edgeBetween = (ax: number, ay: number, bx: number, by: number): Edge => {
    const a = owner.get(key(ax, ay)), b = owner.get(key(bx, by));
    if (!a && !b) return "none";
    if (a && b && a.kind === b.kind && (a.kind === "entrance" || (a as { id: number }).id === (b as { id: number }).id)) return "none";
    const link = (p: Owner, px: number, py: number, q: Owner | undefined, qx: number, qy: number): Edge | null => {
      if (p.kind === "exit") {
        const e = exitById.get(p.id)!;
        if (q?.kind === "room" && q.id === e.room) return "door";
        if (q?.kind === "room" && q.id === e.to) return "open";
        const [dx, dy] = DIR[e.side];
        if (!q && qx === px + dx && qy === py + dy && e.to === undefined && !e.blocked) return "unexplored";
      }
      if (p.kind === "entrance") {
        if (q?.kind === "room" && entranceRoom && q.id === entranceRoom.id) return "open";
        const [dx, dy] = entranceStep(m.entrance!);
        if (!q && qx === px - dx && qy === py - dy) return "open";
      }
      return null;
    };
    return (a && link(a, ax, ay, b, bx, by)) || (b && link(b, bx, by, a, ax, ay)) || "wall";
  };

  const isFloor = (x: number, y: number) => owner.has(key(x, y));

  // labels, and each room's dressing (keeping doorways, stairs and the label clear)
  const labels = new Map<number, ReturnType<typeof labelLayout>>();
  const dressing = new Map<number, DecorItem[]>();
  for (const r of m.rooms) {
    const reserved = new Set<string>();
    for (const e of m.exits) {
      const [dx, dy] = DIR[e.side];
      if (e.room === r.id) reserved.add(key(e.x - dx, e.y - dy));
      if (e.to === r.id) reserved.add(key(e.x + dx, e.y + dy));
    }
    if (inside && entranceRoom?.id === r.id) reserved.add(key(...inside));
    if (m.stairs === r.id) reserved.add(key(...cornerCell(r, (x, y) => x + y)));
    if (r.notes?.trim()) reserved.add(key(...cornerCell(r, (x, y) => x - y)));
    const lb = roomNumbers ? numberLayout(r, reserved) : labelLayout(r, m.exits, m.entrance);
    labels.set(r.id, lb);
    for (const [x, y] of roomCells(r)) {
      const [x0, y0] = [x * C, y * C];
      if (x0 < lb.cx + lb.bw / 2 && x0 + C > lb.cx - lb.bw / 2 && y0 < lb.cy + lb.bh / 2 && y0 + C > lb.cy - lb.bh / 2) reserved.add(key(x, y));
    }
    const wallSides = (x: number, y: number) =>
      (["N", "E", "S", "W"] as Side[]).filter((sd) => edgeBetween(x, y, x + DIR[sd][0], y + DIR[sd][1]) === "wall");
    dressing.set(r.id, planDressing({ room: r, reserved, wallSides, ids }));
  }
  return { key, owner, exitById, roomById, entranceRoom, edgeBetween, isFloor, labels, dressing };
}

const FLOOR_LIGHTS = new Set(["torch", "candles", "candle", "hearth", "brazier", "firepit", "altar"]);

/** A shared light gradient, projected onto the floor in either map view. */
export function floorLightDef(tiles: TileSet, prefix: string): Raw | "" {
  if (!tiles.light) return "";
  return html`<radialGradient id="${prefix}-floor-light"><stop stop-color="${tiles.light}" stop-opacity=".48"/><stop offset=".42" stop-color="${tiles.light}" stop-opacity=".24"/><stop offset="1" stop-color="${tiles.light}" stop-opacity="0"/></radialGradient>`;
}

function floorLights(sc: MapScene, tiles: TileSet, prefix: string): Raw | "" {
  if (!tiles.light) return "";
  return html`${[...sc.dressing].map(([id, items]) => {
    const sources = items.filter((item) => FLOOR_LIGHTS.has(item.name));
    if (!sources.length) return "";
    return html`<g clip-path="url(#${prefix}-clip-${id})">${sources.map((item) =>
      html`<circle cx="${item.x}" cy="${item.y}" r="${item.kind === "centre" ? C * 2.1 : C * 1.4}" fill="url(#${prefix}-floor-light)"/>`)}</g>`;
  })}`;
}

/** Floor texture for the tile set (flagstones, worn slabs or earth) plus wall shadows, in top-down map pixels. */
export function floorTextureSvg(sc: MapScene, T: TileSet, P: string): Raw {
  const { owner, edgeBetween, key } = sc;
  const INK = T.ink;
  let flags = "", grid = "", shadow = html``, tex = html``;
  for (const [k] of owner) {
    const [x, y] = k.split(",").map(Number);
    const v = rnd(x, y, 3);
    const [x0, y0] = [x * C, y * C];
    const nearWall = (["N", "E", "S", "W"] as Side[]).some((sd) => edgeBetween(x, y, x + DIR[sd][0], y + DIR[sd][1]) === "wall");
    if (T.floorStyle === "flags") {
      if ((x + y) % 2 === 0 || v < 0.25) flags += `M${x0 + 1} ${y0 + 1}h${C - 2}v${C - 2}h${-(C - 2)}Z`;
      grid += `M${x0} ${y0}h${C}M${x0} ${y0}v${C}`;
    } else if (T.floorStyle === "slabs") {
      // worn flagstones: one or two slabs per square, mortar lines, uneven shading, grime and damp
      grid += `M${x0} ${y0}h${C}M${x0} ${y0}v${C}`;
      if (v < 0.35) grid += rnd(x, y, 4) < 0.5 ? `M${x0} ${y0 + C / 2}h${C}` : `M${x0 + C / 2} ${y0}v${C}`;
      const shade = rnd(x, y, 5);
      tex = html`${tex}<rect x="${x0 + 0.6}" y="${y0 + 0.6}" width="${C - 1.2}" height="${C - 1.2}" fill="${shade < 0.5 ? "#000" : "#fff"}" opacity="${f1(Math.abs(shade - 0.5) * 0.24)}"/>`;
      if (rnd(x, y, 6) < 0.22) tex = html`${tex}<path d="${stone(x0 + C * (0.3 + rnd(x, y, 7) * 0.4), y0 + C * (0.3 + rnd(x, y, 8) * 0.4), 5 + rnd(x, y, 9) * 6, x * 31 + y)}" fill="#1d1f17" opacity=".16"/>`;
      if (nearWall && rnd(x, y, 10) < 0.3) tex = html`${tex}<path d="${stone(x0 + C * rnd(x, y, 11), y0 + C * rnd(x, y, 12), 3 + rnd(x, y, 13) * 3, x * 17 + y * 5)}" fill="#5d7a3a" opacity=".45"/>`;
      if (rnd(x, y, 14) < 0.12) tex = html`${tex}<path d="M${f1(x0 + 4 + rnd(x, y, 15) * 8)} ${y0 + 3} l${f1(rnd(x, y, 16) * 6 - 3)} 6 l${f1(rnd(x, y, 17) * 6 - 3)} 6 l${f1(rnd(x, y, 18) * 6 - 3)} 5" stroke="#2a2b2e" stroke-width=".7" fill="none" opacity=".6"/>`;
    } else if (T.floorStyle === "cutstone" || T.floorStyle === "inlaid") {
      const inset = f1(1 + v * 0.6);
      const size = C - 2 * inset;
      const bevel = `M${x0 + inset} ${y0 + C - inset}V${y0 + inset}h${size}`;
      tex = html`${tex}<rect x="${x0 + inset}" y="${y0 + inset}" width="${size}" height="${size}" rx="1.4" fill="${v < 0.5 ? "#000" : T.flag}" opacity="${0.04 + Math.round(v * 8) / 100}" stroke="${T.ink}" stroke-width="1"/>
        <path d="${bevel}" fill="none" stroke="${T.flag}" stroke-width="1" opacity=".24"/>`;
      grid += `M${x0} ${y0}h${C}M${x0} ${y0}v${C}`;
      if (T.floorStyle === "inlaid" && owner.get(k)?.kind === "room" && (x + y) % 2 === 0) {
        const [cx, cy] = [x0 + C / 2, y0 + C / 2];
        tex = html`${tex}<path d="M${cx} ${cy - 3}l3 3-3 3-3-3Z" fill="none" stroke="${T.flag}" opacity=".42" stroke-width=".85"/>`;
      }
    } else if (T.floorStyle === "plates") {
      // deck plates: a seam round each square, rivets in the corners, a little wear and the odd oil stain
      grid += `M${x0} ${y0}h${C}M${x0} ${y0}v${C}`;
      const shade = rnd(x, y, 5);
      tex = html`${tex}<rect x="${x0 + 0.6}" y="${y0 + 0.6}" width="${C - 1.2}" height="${C - 1.2}" fill="${shade < 0.5 ? "#000" : "#fff"}" opacity="${f1(Math.abs(shade - 0.5) * 0.16)}"/>`;
      for (const [rx, ry] of [[3, 3], [C - 3, 3], [3, C - 3], [C - 3, C - 3]]) tex = html`${tex}<circle cx="${x0 + rx}" cy="${y0 + ry}" r=".9" fill="#000" opacity=".35"/>`;
      if (rnd(x, y, 6) < 0.12) tex = html`${tex}<path d="${stone(x0 + C * (0.3 + rnd(x, y, 7) * 0.4), y0 + C * (0.3 + rnd(x, y, 8) * 0.4), 4 + rnd(x, y, 9) * 5, x * 31 + y)}" fill="#0b0d10" opacity=".22"/>`;
      if (nearWall && T.walls === "organic" && rnd(x, y, 10) < 0.35)
        tex = html`${tex}<path d="${stone(x0 + C * rnd(x, y, 11), y0 + C * rnd(x, y, 12), 3 + rnd(x, y, 13) * 4, x * 17 + y * 5)}" fill="#7dff6b" opacity=".18"/>`;
    } else if (T.floorStyle === "grate") {
      // mesh grating: a frame per square and a diagonal mesh over the dark below
      grid += `M${x0} ${y0}h${C}M${x0} ${y0}v${C}`;
      let mesh = "";
      for (let i = 4; i < C * 2; i += 4) mesh += `M${x0 + Math.max(0, i - C)} ${y0 + Math.min(i, C)}L${x0 + Math.min(i, C)} ${y0 + Math.max(0, i - C)}`;
      tex = html`${tex}<path d="${mesh}" stroke="#000" stroke-width=".6" opacity=".35"/>`;
      if (rnd(x, y, 6) < 0.1) tex = html`${tex}<rect x="${x0 + 3}" y="${y0 + 3}" width="${C - 6}" height="${C - 6}" fill="#ffb627" opacity=".08"/>`;
    } else if (T.floorStyle === "blueprint") {
      // schematic grid: the square and a finer half-square line
      grid += `M${x0} ${y0}h${C}M${x0} ${y0}v${C}`;
      tex = html`${tex}<path d="M${x0 + C / 2} ${y0}v${C}M${x0} ${y0 + C / 2}h${C}" stroke="${T.grid}" stroke-width=".35" opacity=".25"/>`;
    } else {
      // earth: speckles, pebbles, the odd puddle, stalagmites by the walls
      for (let i = 0; i < 6; i++)
        tex = html`${tex}<circle cx="${f1(x0 + rnd(x, y, 20 + i) * C)}" cy="${f1(y0 + rnd(x, y, 30 + i) * C)}" r="${f1(0.5 + rnd(x, y, 40 + i) * 0.8)}" fill="${rnd(x, y, 50 + i) < 0.5 ? "#3a2a1a" : "#e6cfa6"}" opacity=".35"/>`;
      if (v < 0.18) tex = html`${tex}<path d="${stone(x0 + C * (0.2 + rnd(x, y, 60) * 0.6), y0 + C * (0.2 + rnd(x, y, 61) * 0.6), 2 + rnd(x, y, 62) * 1.5, x * 13 + y * 7)}" fill="#7a6a58" stroke="${INK}" stroke-width=".5"/>`;
      if (rnd(x, y, 63) < 0.05) tex = html`${tex}<path d="${stone(x0 + C / 2, y0 + C / 2, 7, x * 3 + y * 11)}" fill="#4f7fa8" opacity=".45"/>`;
      if (nearWall && owner.get(k)?.kind === "room" && rnd(x, y, 64) < 0.14) {
        const sx = x0 + C * (0.25 + rnd(x, y, 65) * 0.5), sy = y0 + C * (0.25 + rnd(x, y, 66) * 0.5);
        tex = html`${tex}<circle cx="${f1(sx)}" cy="${f1(sy)}" r="3.6" fill="#6b5a48" stroke="${INK}" stroke-width=".7"/><circle cx="${f1(sx - 0.8)}" cy="${f1(sy - 0.8)}" r="1.3" fill="#9a8670"/>`;
      }
    }
    if (edgeBetween(x, y, x, y - 1) === "wall") shadow = html`${shadow}<rect x="${x * C}" y="${y * C}" width="${C}" height="9" fill="url(#${P}-shN)"/>`;
    if (edgeBetween(x, y, x - 1, y) === "wall") shadow = html`${shadow}<rect x="${x * C}" y="${y * C}" width="7" height="${C}" fill="url(#${P}-shW)"/>`;
  }
  return html`<g pointer-events="none">${tex}${flags ? html`<path d="${flags}" fill="${T.flag}" opacity=".06"/>` : ""}${grid ? html`<path d="${grid}" stroke="${T.grid}" stroke-width="${T.floorStyle === "slabs" ? 1 : 0.6}" opacity="${T.gridOp}" fill="none"/>` : ""}${shadow}${floorLights(sc, T, P)}</g>`;
}

/**
 * 2D6 Void rooms are chamfered: a 45° wall cuts off each corner of every room and corridor. A corner
 * stays square where either of its walls is on the Outer Hull (the map edge), or where a neighbouring
 * room or exit square touches it (it is a doorway or a shared wall there). Returns the corner pieces,
 * drawn over the square corners. Pure, for tests: `cornersToChamfer`.
 */
export function cornersToChamfer(m: DungeonMap, isFloor: (x: number, y: number) => boolean): { x: number; y: number; dx: 1 | -1; dy: 1 | -1 }[] {
  const out: { x: number; y: number; dx: 1 | -1; dy: 1 | -1 }[] = [];
  for (const r of m.rooms) {
    if (r.draft || r.cells) continue; // shaped rooms have no square corners to cut
    const corners: [number, number, 1 | -1, 1 | -1, number, number][] = [
      // corner point, direction into the room, the corner cell
      [r.x, r.y, 1, 1, r.x, r.y],
      [r.x + r.w, r.y, -1, 1, r.x + r.w - 1, r.y],
      [r.x, r.y + r.h, 1, -1, r.x, r.y + r.h - 1],
      [r.x + r.w, r.y + r.h, -1, -1, r.x + r.w - 1, r.y + r.h - 1],
    ];
    for (const [px, py, dx, dy, cx, cy] of corners) {
      const onHullX = dx === 1 ? cx === 0 : cx === m.w - 1;
      const onHullY = dy === 1 ? cy === 0 : cy === m.h - 1;
      if (onHullX || onHullY) continue;
      if (isFloor(cx - dx, cy) || isFloor(cx, cy - dy)) continue; // a doorway or neighbour on that corner
      out.push({ x: px, y: py, dx, dy });
    }
  }
  return out;
}

function chamferSvg(m: DungeonMap, T: TileSet, isFloor: (x: number, y: number) => boolean): Raw | "" {
  const k = C * 0.34; // the cut along each wall
  const o = 7; // how far past the corner the old square wall reached
  let cover = "", wall = "";
  for (const { x, y, dx, dy } of cornersToChamfer(m, isFloor)) {
    const X = x * C, Y = y * C;
    // blank out the square corner (floor tip and the wall's corner block), then draw the 45° wall
    cover += `M${X - dx * o} ${Y - dy * o}L${X + dx * k} ${Y - dy * o}L${X + dx * k} ${Y}L${X} ${Y + dy * k}L${X - dx * o} ${Y + dy * k}Z`;
    wall += `M${X + dx * k} ${Y}L${X} ${Y + dy * k}`;
  }
  if (!cover) return "";
  const blueprint = T.walls === "blueprint";
  return html`<g pointer-events="none"><path d="${cover}" fill="${T.paper}"/><path d="${wall}" stroke="${T.ink}" stroke-width="${blueprint ? 5 : 7}" stroke-linecap="${blueprint ? "square" : "round"}"/><path d="${wall}" stroke="${blueprint ? T.floor.regular : T.wallFill[0]}" stroke-width="${blueprint ? 2.2 : 4}" stroke-linecap="round"/></g>`;
}

/** The footprint trail through every explored passage, in top-down map pixels. */
export function footprintsSvg(m: DungeonMap, sc: MapScene, T: TileSet): Raw {
  const { roomById, entranceRoom } = sc;
  let steps = html``;
  const centre = (x: number, y: number) => [(x + 0.5) * C, (y + 0.5) * C] as const;
  const roomCell = (r: MapRoom, nx: number, ny: number): [number, number] => [Math.min(Math.max(nx, r.x), r.x + r.w - 1), Math.min(Math.max(ny, r.y), r.y + r.h - 1)];
  const trail = (pts: (readonly [number, number])[], seed: number) => {
    let n = seed;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
      const ang = (Math.atan2(uy, ux) * 180) / Math.PI + 90;
      for (let t = 5; t < len - 3; t += 8) {
        const side = n++ % 2 ? 2.6 : -2.6;
        const px = ax + ux * t - uy * side, py = ay + uy * t + ux * side;
        steps = html`${steps}<ellipse cx="${f1(px)}" cy="${f1(py)}" rx="1.8" ry="2.9" transform="rotate(${f1(ang)} ${f1(px)} ${f1(py)})"/>`;
      }
    }
  };
  for (const e of m.exits) {
    if (e.to === undefined) continue;
    const a = roomById.get(e.room), b = roomById.get(e.to);
    if (!a || !b) continue;
    const [dx, dy] = DIR[e.side];
    const inA = roomCell(a, e.x - dx, e.y - dy), inB = roomCell(b, e.x + dx, e.y + dy);
    trail([centre(...inA), centre(e.x, e.y), centre(...inB)], e.id);
  }
  if (m.entrance && entranceRoom) {
    const [dx, dy] = entranceStep(m.entrance);
    trail([[(m.entrance.x + 0.5 - dx / 2) * C, (m.entrance.y + 0.5 - dy / 2) * C], centre(...insideEntrance(m.entrance))], 0);
  }
  return html`<g fill="${T.steps}" opacity=".55" pointer-events="none">${steps}</g>`;
}

/** Bounds of the drawn floor, with room to see the nearby unexplored area. */
export function exploredBounds(m: DungeonMap, cells: Iterable<[number, number]>): [number, number, number, number] {
  let left = m.w, top = m.h, right = 0, bottom = 0;
  for (const [x, y] of cells) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  if (left >= right || top >= bottom) return [0, 0, m.w, m.h];

  const span = (min: number, max: number, limit: number): [number, number] => {
    const padding = Math.max(2, Math.ceil((8 - (max - min)) / 2));
    const lo = Math.max(0, min - padding), hi = Math.min(limit, max + padding);
    return [Math.max(0, Math.min(lo, hi - 8)), Math.min(limit, Math.max(hi, lo + 8))];
  };
  const [x0, x1] = span(left, right, m.w);
  const [y0, y1] = span(top, bottom, m.h);
  return [x0, y0, x1, y1];
}

/** Draw rock only within two squares of occupied floor. */
function surroundingCells(m: DungeonMap, sc: MapScene): [number, number, number][] {
  const seen = new Map<string, [number, number, number]>();
  for (const k of sc.owner.keys()) {
    const [x, y] = k.split(",").map(Number);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < -1 || nx > m.w || ny < -1 || ny > m.h || sc.isFloor(nx, ny)) continue;
      const key = sc.key(nx, ny);
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      if ((seen.get(key)?.[2] ?? Infinity) > distance) seen.set(key, [nx, ny, distance]);
    }
  }
  return [...seen.values()].sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
}

/**
 * Draw the map as an SVG string. `tiles` picks a tile set and `view` top-down or isometric
 * (defaults: the ones chosen in Settings).
 */
export interface RenderOpts {
  /** Show only this part of the map (in squares), e.g. a journal picture of one room and its neighbours. Always top-down. */
  crop?: { x: number; y: number; w: number; h: number };
  /** Kept for callers; every drawing already gets its own id prefix, so pictures on one page never share ids. */
  idSuffix?: string;
  /** Accessible name for the picture (default "Dungeon map"). */
  label?: string;
  /** Use compact room numbers on maps with a separate room reference. */
  roomNumbers?: boolean;
  /** Extra top-down drawing on top of everything (2D6 Void's ladders and portals). Ignored by the isometric view. */
  overlay?: Raw;
}

/** The live Dungeon map uses the room reference for names. */
export function renderDungeonMap(m: DungeonMap, current: number | null, focus: number | null = null): Raw {
  return renderMap(m, current, focus, undefined, undefined, { roomNumbers: true });
}

export function renderMap(m: DungeonMap, current: number | null, focus: number | null = null, tiles?: string, view?: MapView, o: RenderOpts = {}): Raw {
  if (!o.crop && (view ?? getMapView()) === "iso") return renderIsoMap(m, current, focus, tiles, o.roomNumbers);
  const T = tileSetById(tiles ?? getTileSetId());
  const INK = T.ink, FLOOR = T.floor, STONE = T.wallFill;
  const P = `dm${++svgUid}`;
  const W = m.w * C, H = m.h * C, pad = 16;
  const parts: Raw[] = [];
  const key = (x: number, y: number) => `${x},${y}`;

  const sc = mapScene(m, P, o.roomNumbers);
  const sealed = sealedDungeonRooms(m);
  const { owner, exitById, roomById, entranceRoom, edgeBetween, isFloor, labels } = sc;

  const large = m.w > 40 || m.h > 40;
  const [left, top, right, bottom] = large
    ? exploredBounds(m, [...owner.keys()].map((k) => k.split(",").map(Number) as [number, number]))
    : [0, 0, m.w, m.h];
  const box = o.crop
    ? `${o.crop.x * C - 6} ${o.crop.y * C - 6} ${o.crop.w * C + 12} ${o.crop.h * C + 12}`
    : `${left * C - pad} ${top * C - pad} ${(right - left) * C + pad * 2} ${(bottom - top) * C + pad * 2}`;
  parts.push(html`<svg class="dmap${o.crop ? " dmap-crop" : ""}" viewBox="${box}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${o.label ?? "Dungeon map"}">
  <defs>
    ${floorLightDef(T, P)}
    <pattern id="${P}-dots" x="${-C / 2}" y="${-C / 2}" width="${C}" height="${C}" patternUnits="userSpaceOnUse"><circle cx="${C / 2}" cy="${C / 2}" r="1.3" fill="${T.dots ?? "none"}"/></pattern>
    <linearGradient id="${P}-shN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.wallShadow}" stop-opacity="${T.floorStyle === "flags" ? 0.28 : 0.4}"/><stop offset="1" stop-color="${T.wallShadow}" stop-opacity="0"/></linearGradient>
    <linearGradient id="${P}-shW" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.wallShadow}" stop-opacity="${T.floorStyle === "flags" ? 0.22 : 0.34}"/><stop offset="1" stop-color="${T.wallShadow}" stop-opacity="0"/></linearGradient>
    <radialGradient id="${P}-vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="${T.vignette}" stop-opacity="${T.dots ? 0.22 : 0.4}"/></radialGradient>
    <filter id="${P}-glow"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${P}-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <filter id="${P}-mist" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    ${m.rooms.map((r) => html`<clipPath id="${P}-clip-${r.id}"><path d="${roomPath(r, C)}"/></clipPath>`)}
  </defs>
  <rect x="${-pad}" y="${-pad}" width="${W + pad * 2}" height="${H + pad * 2}" fill="${T.paper}" rx="8"/>
  ${T.dots ? html`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${P}-dots)"/>` : ""}
  <rect x="${-pad}" y="${-pad}" width="${W + pad * 2}" height="${H + pad * 2}" fill="url(#${P}-vig)" rx="8" pointer-events="none"/>
  <rect x="-4" y="-4" width="${W + 8}" height="${H + 8}" fill="none" stroke="${T.edge}" stroke-width="1.2" stroke-dasharray="6 4"/>`);

  // the rock around the rooms: cross-hatching, or lumpy cave rock
  let hatch = "";
  const rocks: string[] = T.rockFill.map(() => "");
  let panels = "", rivets = "";
  for (const [x, y, d] of T.surround === "none" ? [] : surroundingCells(m, sc)) {
    if (T.surround === "hull") {
      // the hull around the rooms: inset plates with a rivet in each corner, fading out with distance
      if (d === 2 && rnd(x, y, 1) < 0.35) continue;
      const [x0, y0] = [x * C, y * C];
      panels += `M${x0 + 1.5} ${y0 + 1.5}h${C - 3}v${C - 3}h${-(C - 3)}Z`;
      if (d === 1) for (const [rx, ry] of [[4, 4], [C - 4, 4], [4, C - 4], [C - 4, C - 4]]) rivets += `M${x0 + rx} ${y0 + ry}h.01`;
      continue;
    }
    if (T.surround === "cave") {
      const n = d === 1 ? 3 : rnd(x, y, 1) < 0.6 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const seed = x * 7349 + y * 3911 + k * 17;
        const cx = (x + 0.1 + rnd(x, y, 10 + k) * 0.8) * C, cy = (y + 0.1 + rnd(x, y, 20 + k) * 0.8) * C;
        rocks[Math.floor(rnd(seed, 2) * rocks.length)] += stone(cx, cy, (d === 1 ? 7 : 5) + rnd(seed, 3) * 4, seed);
      }
      continue;
    }
    const clusters = d === 1 ? 4 : rnd(x, y, 1) < 0.7 ? 2 : 1;
    for (let k = 0; k < clusters; k++) {
      const cx = (x + 0.15 + rnd(x, y, 10 + k) * 0.7) * C, cy = (y + 0.15 + rnd(x, y, 20 + k) * 0.7) * C;
      const a = rnd(x, y, 30 + k) * Math.PI;
      const [ux, uy] = [Math.cos(a), Math.sin(a)];
      const [px, py] = [-uy, ux];
      const lines = 3 + Math.floor(rnd(x, y, 40 + k) * 2);
      const len = 4.5 + rnd(x, y, 50 + k) * 2.5;
      for (let i = 0; i < lines; i++) {
        const o = (i - (lines - 1) / 2) * 2.3;
        const bx = cx + px * o, by = cy + py * o;
        hatch += `M${f1(bx - ux * len)} ${f1(by - uy * len)}L${f1(bx + ux * len)} ${f1(by + uy * len)}`;
      }
    }
  }
  if (hatch) parts.push(html`<path d="${hatch}" stroke="${T.surroundInk}" stroke-width=".9" stroke-linecap="round" opacity="${T.surroundOp}" fill="none" pointer-events="none"/>`);
  if (panels)
    parts.push(html`<g pointer-events="none" opacity="${T.surroundOp}"><path d="${panels}" fill="${T.surroundInk}" stroke="#000" stroke-width=".8" stroke-opacity=".5"/><path d="${rivets}" stroke="${T.edge}" stroke-width="2" stroke-linecap="round"/></g>`);
  if (T.surround === "cave")
    parts.push(html`<g pointer-events="none">${rocks.map((d, i) => (d ? html`<path d="${d}" fill="${T.rockFill[i]}" stroke="${T.surroundInk}" stroke-width="1"/>` : ""))}</g>`);

  // floors: room rects are the click targets; flagstone shading and wall shadows go on top
  if (m.entrance) parts.push(html`<rect x="${m.entrance.x * C}" y="${m.entrance.y * C}" width="${C}" height="${C}" fill="${FLOOR.entrance}"/>`);
  for (const e of m.exits) parts.push(html`<rect x="${e.x * C}" y="${e.y * C}" width="${C}" height="${C}" fill="${FLOOR.corridor}"/>`);
  for (const r of m.rooms)
    parts.push(html`<path class="dmap-room" ${sealed.has(r.id) ? "" : html`data-room="${r.id}" style="cursor:pointer"`} d="${roomPath(r, C)}" fill="${FLOOR[r.kind]}" ${r.draft ? html`opacity=".7"` : ""}/>`);
  parts.push(floorTextureSvg(sc, T, P));

  // footprint trail through every explored passage
  parts.push(footprintsSvg(m, sc, T));
  const centre = (x: number, y: number) => [(x + 0.5) * C, (y + 0.5) * C] as const;
  const roomCell = (r: MapRoom, nx: number, ny: number): [number, number] => [Math.min(Math.max(nx, r.x), r.x + r.w - 1), Math.min(Math.max(ny, r.y), r.y + r.h - 1)];

  // room dressing from the room's name
  for (const r of m.rooms) {
    const items = sc.dressing.get(r.id) ?? [];
    if (items.length) parts.push(html`<g class="dmap-decor" pointer-events="none" clip-path="url(#${P}-clip-${r.id})">${items.map(itemSvg)}</g>`);
  }

  // walls: stone blocks along every wall edge, a dashed line on unexplored ends
  const wallEdges: [number, number, number, number][] = [];
  let dashed = "";
  const consider = (ax: number, ay: number, bx: number, by: number, x1: number, y1: number, x2: number, y2: number) => {
    const e = edgeBetween(ax, ay, bx, by);
    if (e === "wall") wallEdges.push([x1, y1, x2, y2]);
    else if (e === "unexplored") dashed += `M${x1 * C} ${y1 * C}L${x2 * C} ${y2 * C}`;
  };
  for (const [k] of owner) {
    const [x, y] = k.split(",").map(Number);
    consider(x, y, x, y - 1, x, y, x + 1, y); // top
    consider(x, y, x - 1, y, x, y, x, y + 1); // left
    if (!owner.has(key(x, y + 1))) consider(x, y, x, y + 1, x, y + 1, x + 1, y + 1); // bottom
    if (!owner.has(key(x + 1, y))) consider(x, y, x + 1, y, x + 1, y, x + 1, y + 1); // right
  }
  const stonesByFill: string[] = STONE.map(() => "");
  let wallLine = "";
  const corners = new Set<string>();
  let bricks = html``;
  for (const [x1, y1, x2, y2] of wallEdges) {
    wallLine += `M${x1 * C} ${y1 * C}L${x2 * C} ${y2 * C}`;
    corners.add(`${x1},${y1}`);
    corners.add(`${x2},${y2}`);
    if (T.walls === "bricks") {
      // two bricks per edge, joints staggered from edge to edge
      const horiz = y1 === y2, joint = (x1 + y1) % 2 ? 0.35 : 0.65;
      for (const [a, b] of [[0, joint], [joint, 1]]) {
        const seed = x1 * 9173 + y1 * 131 + (horiz ? 1 : 2) + Math.round(a * 10);
        const fill = STONE[Math.floor(rnd(seed, 1) * STONE.length)];
        const [px, py] = [(x1 + (x2 - x1) * a) * C, (y1 + (y2 - y1) * a) * C];
        const len = (b - a) * C;
        bricks = html`${bricks}${horiz
          ? html`<rect x="${f1(px + 0.4)}" y="${y1 * C - 4.5}" width="${f1(len - 0.8)}" height="9" fill="${fill}" stroke="${INK}" stroke-width=".9"/>`
          : html`<rect x="${x1 * C - 4.5}" y="${f1(py + 0.4)}" width="9" height="${f1(len - 0.8)}" fill="${fill}" stroke="${INK}" stroke-width=".9"/>`}`;
      }
      continue;
    }
    if (T.walls === "plating") {
      // one steel plate per edge with a rivet at each end
      const horiz = y1 === y2;
      const fill = STONE[Math.floor(rnd(x1 * 9173 + y1 * 131 + (horiz ? 1 : 2), 1) * STONE.length)];
      bricks = html`${bricks}${horiz
        ? html`<rect x="${x1 * C + 0.5}" y="${y1 * C - 4.5}" width="${C - 1}" height="9" fill="${fill}" stroke="${INK}" stroke-width="1"/><path d="M${x1 * C + 4} ${y1 * C}h.01M${x2 * C - 4} ${y1 * C}h.01" stroke="#c9d3dc" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`
        : html`<rect x="${x1 * C - 4.5}" y="${y1 * C + 0.5}" width="9" height="${C - 1}" fill="${fill}" stroke="${INK}" stroke-width="1"/><path d="M${x1 * C} ${y1 * C + 4}h.01M${x1 * C} ${y2 * C - 4}h.01" stroke="#c9d3dc" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`}`;
      continue;
    }
    if (T.walls === "pipes") {
      // a steel wall with two pipes along it and a bracket in the middle
      const horiz = y1 === y2;
      const [a, b] = [STONE[0], STONE[1]];
      bricks = html`${bricks}${horiz
        ? html`<rect x="${x1 * C}" y="${y1 * C - 4.5}" width="${C}" height="9" fill="${STONE[1]}" stroke="${INK}" stroke-width=".9"/><path d="M${x1 * C} ${y1 * C - 2}h${C}" stroke="${a}" stroke-width="2.4"/><path d="M${x1 * C} ${y1 * C + 2}h${C}" stroke="${STONE[2] ?? b}" stroke-width="1.8"/><path d="M${x1 * C + C / 2} ${y1 * C - 4.5}v9" stroke="${INK}" stroke-width="1.4"/>`
        : html`<rect x="${x1 * C - 4.5}" y="${y1 * C}" width="9" height="${C}" fill="${STONE[1]}" stroke="${INK}" stroke-width=".9"/><path d="M${x1 * C - 2} ${y1 * C}v${C}" stroke="${a}" stroke-width="2.4"/><path d="M${x1 * C + 2} ${y1 * C}v${C}" stroke="${STONE[2] ?? b}" stroke-width="1.8"/><path d="M${x1 * C - 4.5} ${y1 * C + C / 2}h9" stroke="${INK}" stroke-width="1.4"/>`}`;
      continue;
    }
    if (T.walls === "blueprint") continue; // drawn as a double line below
    const rock = T.walls === "rock" || T.walls === "organic";
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3 + (rnd(x1 * 3 + i, y1 * 5 + x2, 4) - 0.5) * 0.08;
      const j = rock ? 5 : 1.6;
      const cx = (x1 + (x2 - x1) * t) * C + (rnd(x1, y1 * 7 + i, 5) - 0.5) * j;
      const cy = (y1 + (y2 - y1) * t) * C + (rnd(x1 * 7 + i, y1, 6) - 0.5) * j;
      const seed = x1 * 9173 + y1 * 131 + x2 * 17 + y2 * 3 + i;
      stonesByFill[Math.floor(rnd(seed, 1) * STONE.length)] += stone(cx, cy, rock ? 6.5 + rnd(seed, 2) * 2.5 : 4.6, seed);
    }
  }
  for (const c of corners) {
    const [x, y] = c.split(",").map(Number);
    const seed = x * 7919 + y * 104729;
    if (T.walls === "bricks" || T.walls === "plating" || T.walls === "pipes") bricks = html`${bricks}<rect x="${x * C - 5.5}" y="${y * C - 5.5}" width="11" height="11" fill="${STONE[3] ?? STONE[0]}" stroke="${INK}" stroke-width="1"/>`;
    else if (T.walls !== "blueprint") stonesByFill[Math.floor(rnd(seed, 2) * STONE.length)] += stone(x * C, y * C, T.walls === "rock" || T.walls === "organic" ? 8.5 : 5.2, seed);
  }
  const lumpy = T.walls === "rock" || T.walls === "organic";
  parts.push(html`<g pointer-events="none">
    ${T.walls === "blueprint"
      ? html`<path d="${wallLine}" stroke="${INK}" stroke-width="5" stroke-linecap="square"/><path d="${wallLine}" stroke="${FLOOR.regular}" stroke-width="2.2" stroke-linecap="square"/>`
      : html`<path d="${wallLine}" stroke="${T.wallShadow}" stroke-width="${lumpy ? 12 : 7}" stroke-linecap="round" opacity=".35" filter="url(#${P}-soft)" transform="translate(1.5 2)"/>
    <path d="${wallLine}" stroke="${lumpy ? STONE[1] : INK}" stroke-width="${lumpy ? 9 : 5}" stroke-linecap="round"/>`}
    ${bricks}
    ${stonesByFill.map((d, i) => (d ? html`<path d="${d}" fill="${STONE[i]}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>` : ""))}
    ${dashed ? html`<path d="${dashed}" stroke="${T.unexplored}" stroke-width="2.4" stroke-dasharray="4 3" stroke-linecap="round"/>` : ""}
  </g>`);
  if (T.chamfer) {
    const ch = chamferSvg(m, T, isFloor);
    if (ch) parts.push(ch);
  }
  if (m.entrance) {
    const { x, y } = m.entrance;
    const cx = (x + 0.5) * C, by = (y + 1) * C;
    parts.push(html`<g pointer-events="none"><path d="M${cx - 7} ${by + 9} L${cx} ${by + 2} L${cx + 7} ${by + 9}" fill="none" stroke="#2f6b3a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`);
  }

  // current / focused room highlight
  for (const r of m.rooms) {
    if (sealed.has(r.id) || (r.id !== current && r.id !== focus)) continue;
    const col = r.id === current ? "#d0582c" : "#2f7fd8";
    parts.push(r.cells
      ? html`<path pointer-events="none" d="${outlinePath(r, C)}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="square" stroke-dasharray="${r.id === current ? "none" : "6 4"}" opacity=".85"/>`
      : html`<rect pointer-events="none" x="${r.x * C + 6}" y="${r.y * C + 6}" width="${r.w * C - 12}" height="${r.h * C - 12}" rx="4" fill="none" stroke="${col}" stroke-width="2.5" stroke-dasharray="${r.id === current ? "none" : "6 4"}" opacity=".85"/>`);
  }
  for (const r of m.rooms)
    if (r.draft) parts.push(r.cells
      ? html`<path pointer-events="none" d="${outlinePath(r, C)}" fill="none" stroke="${T.draft}" stroke-width="1.5" stroke-dasharray="5 4"/>`
      : html`<rect pointer-events="none" x="${r.x * C + 4}" y="${r.y * C + 4}" width="${r.w * C - 8}" height="${r.h * C - 8}" fill="none" stroke="${T.draft}" stroke-width="1.5" stroke-dasharray="5 4"/>`);

  // doors: drawn across the wall between a room and its exit square
  for (const e of m.exits) {
    const r = roomById.get(e.room);
    if (!r) continue;
    let cx: number, cy: number, horiz: boolean;
    // the wall line is on the room's side of the exit square, so it's right for shaped rooms too
    if (e.side === "N") [cx, cy, horiz] = [e.x * C + C / 2, (e.y + 1) * C, true];
    else if (e.side === "S") [cx, cy, horiz] = [e.x * C + C / 2, e.y * C, true];
    else if (e.side === "W") [cx, cy, horiz] = [(e.x + 1) * C, e.y * C + C / 2, false];
    else [cx, cy, horiz] = [e.x * C, e.y * C + C / 2, false];
    const L = C - 10, T = 7;
    const rot = horiz ? 0 : 90;
    const g: Raw[] = [];
    switch (e.type) {
      case "archway":
        g.push(html`<rect x="${-L / 2 - 3}" y="-4" width="5" height="8" rx="1.5" fill="${DOOR.archway}" stroke="${INK}" stroke-width="1"/><rect x="${L / 2 - 2}" y="-4" width="5" height="8" rx="1.5" fill="${DOOR.archway}" stroke="${INK}" stroke-width="1"/>`);
        g.push(html`<path d="M${-L / 2} -1 Q0 -11 ${L / 2} -1" fill="none" stroke="${DOOR.archway}" stroke-width="2.6"/><path d="M${-L / 2} -1 Q0 -11 ${L / 2} -1" fill="none" stroke="${INK}" stroke-width=".8"/>`);
        break;
      case "curtain":
        g.push(html`<path d="M${-L / 2} 0 q2 -4 4 0 t4 0 t4 0 t4 0" fill="none" stroke="${DOOR.curtain}" stroke-width="3" stroke-linecap="round"/><circle cx="${-L / 2 - 1}" cy="0" r="1.8" fill="#e2b44a"/><circle cx="${L / 2 + 1}" cy="0" r="1.8" fill="#e2b44a"/>`);
        break;
      case "portcullis":
        g.push(html`<rect x="${-L / 2}" y="${-T / 2}" width="${L}" height="${T}" fill="#00000022" stroke="${DOOR.portcullis}" stroke-width="1.6"/>`);
        for (let i = 1; i < 5; i++) g.push(html`<line x1="${-L / 2 + (i * L) / 5}" y1="${-T / 2 - 1.5}" x2="${-L / 2 + (i * L) / 5}" y2="${T / 2 + 1.5}" stroke="${DOOR.portcullis}" stroke-width="1.6"/>`);
        g.push(html`<line x1="${-L / 2}" y1="0" x2="${L / 2}" y2="0" stroke="${DOOR.portcullis}" stroke-width="1.2"/>`);
        break;
      case "barrier":
        // an archway filled with energy: jambs and a crackling zigzag
        g.push(html`<rect x="${-L / 2 - 3}" y="-4" width="5" height="8" rx="1" fill="#59636d" stroke="${INK}" stroke-width="1"/><rect x="${L / 2 - 2}" y="-4" width="5" height="8" rx="1" fill="#59636d" stroke="${INK}" stroke-width="1"/>`);
        g.push(html`<path d="M${-L / 2} 0 l2.5 -3 l2.5 6 l2.5 -6 l2.5 6 l2.5 -6 l2.5 6 l1 -3" fill="none" stroke="${DOOR.barrier}" stroke-width="3" opacity=".35"/><path d="M${-L / 2} 0 l2.5 -3 l2.5 6 l2.5 -6 l2.5 6 l2.5 -6 l2.5 6 l1 -3" fill="none" stroke="#e6fbff" stroke-width="1.1"/>`);
        break;
      case "secret":
        g.push(html`<rect x="${-L / 2}" y="${-T / 2}" width="${L}" height="${T}" fill="${DOOR.secret}" stroke="${INK}" stroke-width="1" stroke-dasharray="2 1.5"/><text x="0" y="2.6" font-size="7.5" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">s</text>`);
        break;
      case "slab":
        g.push(html`<path d="${stone(0, 0, L / 2, e.id * 31).replace(/[-\d.]+ [-\d.]+/g, (p) => { const [a, b] = p.split(" ").map(Number); return `${f1(a)} ${f1(b * 0.45)}`; })}" fill="${DOOR.slab}" stroke="${INK}" stroke-width="1.3"/>`);
        break;
      default: {
        const fill = DOOR[e.type];
        g.push(html`<rect x="${-L / 2}" y="${-T / 2}" width="${L}" height="${T}" rx="1.5" fill="${fill}" stroke="${INK}" stroke-width="1.3"/>`);
        if (e.type === "wooden") g.push(html`<path d="M${-L / 2 + 3} -1.2 H${L / 2 - 3} M${-L / 2 + 3} 1.4 H${L / 2 - 5}" stroke="#5e3515" stroke-width=".7"/>`);
        if (e.type === "metal") g.push(html`${[-L / 2 + 2.5, L / 2 - 2.5].map((x) => html`<circle cx="${x}" cy="0" r="1" fill="#e9eef3"/>`)}`);
        if (e.type === "sliding") g.push(html`<path d="M0 ${-T / 2} V${T / 2}" stroke="${INK}" stroke-width="1.1"/><path d="M-3 0 h-2 M3 0 h2" stroke="#e9eef3" stroke-width=".9"/>`);
        if (e.type === "security") g.push(html`<path d="M${-L / 2 + 2} ${T / 2} l3 ${-T} M${-L / 2 + 6} ${T / 2} l3 ${-T} M${-L / 2 + 10} ${T / 2} l3 ${-T}" stroke="#1d1f22" stroke-width="1.4"/><rect x="${L / 2 - 4}" y="-1.6" width="2.6" height="3.2" fill="#c62828"/>`);
        if (e.type === "biocoded") g.push(html`<circle cx="0" cy="0" r="2" fill="#bff5c8" stroke="${INK}" stroke-width=".5"/><path d="M-1 0 a1 1 0 0 1 2 0" fill="none" stroke="${INK}" stroke-width=".5"/>`);
        if (e.type === "reinforced") g.push(html`<path d="M${-L / 4} ${-T / 2} V${T / 2} M${L / 4} ${-T / 2} V${T / 2}" stroke="#c8ccd2" stroke-width="1.2"/><circle cx="0" cy="0" r="1.3" fill="#e2b44a"/>`);
      }
    }
    parts.push(html`<g class="dmap-door" transform="translate(${cx} ${cy}) rotate(${rot})"><title>${exitLabel(e)}</title><rect x="${-L / 2 - 4}" y="-7" width="${L + 8}" height="14" fill="transparent"/>${g}</g>`);
    if (e.locked)
      parts.push(html`<g pointer-events="none" transform="translate(${cx + (horiz ? L / 2 + 6 : 8)} ${cy + (horiz ? -9 : -L / 2 - 5)})"><rect x="-6" y="-2" width="12" height="9" rx="2" fill="#c62828" stroke="#fff" stroke-width="1.2"/><path d="M-3.2 -2 V-4.5 a3.2 3.2 0 0 1 6.4 0 V-2" fill="none" stroke="#c62828" stroke-width="1.8"/><circle cx="0" cy="2.5" r="1.2" fill="#fff"/></g>`);
  }

  // stairs down
  if (m.stairs !== null && !sealed.has(m.stairs)) {
    const r = roomById.get(m.stairs);
    if (r) {
      const [ax, ay] = cornerCell(r, (x, y) => x + y);
      const sx = ax * C + 3, sy = ay * C + 3, s = C - 6;
      parts.push(html`<g pointer-events="none"><rect x="${sx}" y="${sy}" width="${s}" height="${s}" rx="2" fill="#4a3a2e" stroke="${INK}" stroke-width="1.2"/>${[0, 1, 2, 3].map((i) => html`<rect x="${sx + 2 + i * 1.5}" y="${sy + 2 + i * (s / 4.3)}" width="${s - 4 - i * 3}" height="${s / 6}" fill="${["#efe2c4", "#d9c7a2", "#bfa97f", "#a08a62"][i]}"/>`)}</g>`);
    }
  }

  for (const e of m.exits) {
    if (!e.oneWay) continue;
    const [dx, dy] = DIR[e.side];
    parts.push(secretDoorMarker((e.x + 0.5 - dx * 0.32 + dy * 0.34) * C, (e.y + 0.5 - dy * 0.32 - dx * 0.34) * C, T));
  }

  if (sealed.size) parts.push(sealedRoomsSvg(m.rooms, sealed));

  // Room markers (or full labels for views without a separate reference).
  for (const r of m.rooms) {
    const { lines, fs, bw, bh, cx, cy, sub } = labels.get(r.id)!;
    parts.push(html`<g pointer-events="none" font-family="Georgia, 'Palatino Linotype', serif" text-anchor="middle">
      <rect x="${f1(cx - bw / 2)}" y="${f1(cy - bh / 2)}" width="${f1(bw)}" height="${f1(bh)}" rx="2" fill="${T.labelBg}" stroke="${T.labelInk}" stroke-width="1"/>
      ${lines.map((ln, i) => html`<text x="${cx}" y="${f1(cy - bh / 2 + 2 + (i + 0.8) * fs * 1.2)}" font-size="${fs}" fill="${T.labelInk}">${ln}</text>`)}
      ${sub ? html`<text x="${cx}" y="${f1(cy + bh / 2 - 3.5)}" font-size="7" font-style="italic" fill="${T.sub}">${r.sub}</text>` : ""}
    </g>`);
  }
  for (const r of m.rooms)
    if (r.notes?.trim()) {
      const [nx, ny] = cornerCell(r, (x, y) => x - y);
      parts.push(html`<g pointer-events="none" transform="translate(${(nx + 1) * C - 11} ${ny * C + 11})"><circle r="6.5" fill="#2f7fd8" stroke="#fff" stroke-width="1.5"/>${NOTE_PENCIL}</g>`);
    }

  // the party: a token in the current room, by the door they came in through
  const cur = current !== null ? roomById.get(current) : undefined;
  if (cur) {
    const via = m.exits.find((e) => e.to === cur.id);
    let [tx, ty] = cornerCell(cur, (x, y) => y * 2 - x); // bottom-left, as the party token has always stood
    if (via) [tx, ty] = roomCell(cur, via.x + DIR[via.side][0], via.y + DIR[via.side][1]);
    else if (m.entrance && entranceRoom?.id === cur.id) [tx, ty] = [m.entrance.x, m.entrance.y - 1];
    const [px, py] = centre(tx, ty);
    parts.push(html`<g pointer-events="none" transform="translate(${px} ${py})"><circle r="9" fill="#00000033" transform="translate(1 1.5)"/><circle r="8.5" fill="#c0392b" stroke="#fff" stroke-width="2"/><circle cy="-2.6" r="2.4" fill="#fff"/><path d="M-4.2 4.6 a4.2 4 0 0 1 8.4 0 Z" fill="#fff"/></g>`);
  }

  // clickable open exits (choose where to go next)
  for (const e of openExits(m)) {
    const sel = m.sel === e.id;
    const [dx, dy] = DIR[e.side];
    const cx = e.x * C + C / 2, cy = e.y * C + C / 2;
    const ang = Math.atan2(dy, dx) * (180 / Math.PI);
    parts.push(html`<g class="dmap-exit${sel ? " sel" : ""}" data-exit="${e.id}" style="cursor:pointer">
      <title>${exitLabel(e)} — tap to go this way</title>
      <circle cx="${cx}" cy="${cy}" r="${C * 0.62}" fill="transparent"/>
      <circle cx="${cx}" cy="${cy}" r="${sel ? 9 : 7}" fill="${sel ? "#d0582c" : "#e0a33a"}" stroke="#fff" stroke-width="2" ${sel ? html`filter="url(#${P}-glow)"` : ""}/>
      <path d="M-3.5 -4 L3.5 0 L-3.5 4 Z" fill="#fff" transform="translate(${cx} ${cy}) rotate(${ang})"/>
    </g>`);
  }
  if (o.overlay) parts.push(o.overlay);
  parts.push(html`</svg>`);
  return html`${parts}`;
}

/** Save the map as a PNG (draws the SVG onto a canvas at 2x). */
export async function downloadMapPng(svgText: string, filename: string) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  // drop the interactive exit markers from the exported picture
  svg.querySelectorAll(".dmap-exit").forEach((n) => n.remove());
  const [, , vw, vh] = (svg.getAttribute("viewBox") ?? "0 0 600 600").split(/\s+/).map(Number);
  const scale = Math.min(2, 8192 / Math.max(vw, vh));
  const width = Math.max(1, Math.round(vw * scale)), height = Math.max(1, Math.round(vh * scale));
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("Couldn't draw the map"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d")!;
    g.drawImage(img, 0, 0, width, height);
    const png: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!png) throw new Error("Couldn't make the image");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
