// Journal room pictures: a small frozen copy of the dungeon map around one room (the room, its
// direct neighbours and their doorways) kept as JSON on the journal entry, and re-drawn with the
// live map renderer at display time so it follows the current map style. DOM-free.
import { renderMap, type DungeonMap, type ExitType, type RoomKind, type Side } from "../tools/dmap";
import { html, type Raw } from "../ui/html";

export interface SnapRoom { id: number; n: number; x: number; y: number; w: number; h: number; kind: RoomKind; label: string; draft?: true }
export interface SnapExit { room: number; side: Side; x: number; y: number; type: ExitType; locked?: true; to?: number; blocked?: true }
export interface MapSnap {
  w: number; // the full map's size, in squares
  h: number;
  box: [number, number, number, number]; // x, y, w, h of the part shown
  focus: number; // the room the picture is of
  rooms: SnapRoom[];
  exits: SnapExit[];
  entrance?: [number, number];
  stairs?: number;
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number) =>
  a.x < x + w && a.x + a.w > x && a.y < y + h && a.y + a.h > y;

/** Copy the part of `m` around room `roomId`: null when the room isn't on the map. */
export function sliceMap(m: DungeonMap, roomId: number): MapSnap | null {
  const r = m.rooms.find((x) => x.id === roomId);
  if (!r) return null;
  const near = new Set<number>([r.id]);
  for (const e of m.exits) {
    if (e.room === r.id && e.to !== undefined) near.add(e.to);
    if (e.to === r.id) near.add(e.room);
  }
  // the box: the room, its neighbours and its exit squares, one square of margin, inside the map
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  const grow = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const n of m.rooms) if (near.has(n.id)) grow(n.x, n.y, n.w, n.h);
  for (const e of m.exits) if (e.room === r.id) grow(e.x, e.y, 1, 1);
  if (r.kind === "entrance" && m.entrance) grow(m.entrance.x, m.entrance.y, 1, 1);
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(m.w, x1 + 1);
  y1 = Math.min(m.h, y1 + 1);
  const [bx, by, bw, bh] = [x0, y0, x1 - x0, y1 - y0];

  const rooms: SnapRoom[] = m.rooms
    .filter((n) => near.has(n.id) || overlaps(n, bx, by, bw, bh))
    .map((n) => ({ id: n.id, n: n.n, x: n.x, y: n.y, w: n.w, h: n.h, kind: n.kind, label: n.label, ...(n.draft ? { draft: true as const } : {}) }));
  const kept = new Set(rooms.map((n) => n.id));
  const exits: SnapExit[] = m.exits
    .filter((e) => kept.has(e.room) && e.x >= bx && e.x < bx + bw && e.y >= by && e.y < by + bh)
    .map((e) => ({
      room: e.room, side: e.side, x: e.x, y: e.y, type: e.type,
      ...(e.locked ? { locked: true as const } : {}),
      ...(e.to !== undefined ? { to: e.to } : {}),
      ...(e.blocked ? { blocked: true as const } : {}),
    }));
  const snap: MapSnap = { w: m.w, h: m.h, box: [bx, by, bw, bh], focus: r.id, rooms, exits };
  if (m.entrance && m.entrance.x >= bx && m.entrance.x < bx + bw && m.entrance.y >= by && m.entrance.y < by + bh) snap.entrance = [m.entrance.x, m.entrance.y];
  if (m.stairs !== null && kept.has(m.stairs)) snap.stairs = m.stairs;
  return snap;
}

/** A DungeonMap holding just the snapshot, for the renderer (numbers forced, so no stored text reaches the SVG unescaped). */
export function snapToMap(s: MapSnap): DungeonMap {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  let id = Math.max(0, ...s.rooms.map((r) => n(r.id))) + 1;
  return {
    w: n(s.w),
    h: n(s.h),
    rooms: s.rooms.map((r) => ({ id: n(r.id), n: n(r.n), x: n(r.x), y: n(r.y), w: n(r.w), h: n(r.h), kind: r.kind, label: String(r.label), sub: "", ...(r.draft ? { draft: true } : {}) })),
    exits: s.exits.map((e) => ({ id: id++, room: n(e.room), side: e.side, x: n(e.x), y: n(e.y), type: e.type, locked: e.locked, to: e.to === undefined ? undefined : n(e.to), blocked: e.blocked })),
    sel: null,
    stairs: s.stairs === undefined ? null : n(s.stairs),
    nextId: id,
    entrance: s.entrance ? { x: n(s.entrance[0]), y: n(s.entrance[1]) } : null,
  };
}

/** The picture: the snapshot drawn by the map renderer, cropped to its box, the room outlined. */
export function renderSnap(s: MapSnap, idSuffix: string): Raw {
  const [x, y, w, h] = s.box;
  const room = s.rooms.find((r) => r.id === s.focus);
  return renderMap(snapToMap(s), Number(s.focus), null, undefined, "top", { crop: { x: +x, y: +y, w: +w, h: +h }, idSuffix, label: room ? `Map around room ${+room.n}, ${room.label}` : "Map" });
}

export interface RoomExits { entry: Side | null; via?: ExitType | "entrance"; exits: { side: Side; type: ExitType; locked?: true }[] }

/** How room `roomId` was entered (wall and doorway) and its exits, other than the one you came in by. */
export function roomExits(m: DungeonMap, roomId: number): RoomExits {
  const r = m.rooms.find((x) => x.id === roomId);
  const came = m.exits.find((e) => e.to === roomId);
  const opposite: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };
  const entry: Side | null = came ? opposite[came.side] : r?.kind === "entrance" ? "S" : null;
  const via: RoomExits["via"] = came ? came.type : r?.kind === "entrance" ? "entrance" : undefined;
  const exits = m.exits.filter((e) => e.room === roomId).map((e) => ({ side: e.side, type: e.type, ...(e.locked ? { locked: true as const } : {}) }));
  return { entry, via, exits };
}
