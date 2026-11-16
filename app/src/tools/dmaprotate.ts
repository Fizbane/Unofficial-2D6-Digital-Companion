// Turning the isometric camera. The iso renderer only knows one camera (looking from the south-east),
// so instead of teaching it four we turn the map itself a quarter at a time and draw the copy.
// One quarter turn is clockwise as seen from above: north becomes east, (x, y) becomes (h-1-y, x).
// The turned copy is only for drawing: it is never saved.
import { html } from "../ui/html";
import type { DecorItem } from "./dmapdecor";
import type { DungeonMap, MapExit, MapRoom, Side } from "./dmap";

const C = 26; // top-down px per square (as in dmap.ts)
const NEXT: Record<Side, Side> = { N: "E", E: "S", S: "W", W: "N" };

/** 0..3 quarter turns, from any integer. */
export const normTurn = (q: number) => ((Math.round(q) % 4) + 4) % 4;

/** A side after q clockwise quarter turns. */
export function rotateSide(s: Side, q: number): Side {
  for (let i = 0; i < normTurn(q); i++) s = NEXT[s];
  return s;
}

/** A square of a w × h map after q clockwise quarter turns. */
export function rotateCell(x: number, y: number, w: number, h: number, q: number): [number, number] {
  for (let i = 0; i < normTurn(q); i++) [x, y, w, h] = [h - 1 - y, x, h, w];
  return [x, y];
}

function turnRoom(r: MapRoom, H: number): MapRoom {
  const out: MapRoom = { ...r, x: H - r.y - r.h, y: r.x, w: r.h, h: r.w };
  if (r.cells) out.cells = r.cells.map(([x, y]) => [H - 1 - y, x]);
  if (r.details) out.details = r.details.map((d) => [...d] as [string, string]);
  return out;
}

const turnExit = (e: MapExit, H: number): MapExit => ({ ...e, x: H - 1 - e.y, y: e.x, side: NEXT[e.side] });

/** The entrance square; `side` is the way from it into its room (north unless the map was turned). */
function turnEntrance(e: NonNullable<DungeonMap["entrance"]>, H: number): NonNullable<DungeonMap["entrance"]> {
  const side = NEXT[e.side ?? "N"];
  return side === "N" ? { x: H - 1 - e.y, y: e.x } : { x: H - 1 - e.y, y: e.x, side };
}

/** A copy of the map turned q clockwise quarter turns: room squares, exits and their sides, the entrance. */
export function rotateMap(m: DungeonMap, q: number): DungeonMap {
  let out: DungeonMap = structuredClone(m);
  for (let i = 0; i < normTurn(q); i++) {
    const H = out.h;
    out = {
      ...out,
      w: out.h,
      h: out.w,
      rooms: out.rooms.map((r) => turnRoom(r, H)),
      exits: out.exits.map((e) => turnExit(e, H)),
      entrance: out.entrance && turnEntrance(out.entrance, H),
    };
  }
  return out;
}

/**
 * A placed piece of dressing after the map turned q clockwise quarter turns. Its spot, wall side
 * and top-down angle turn with the map; `turn` tells the 3D art to turn the piece's own shape too.
 * (Plan the dressing on the unturned map, then turn it, so the furniture stays put.)
 */
export function rotateDecor(it: DecorItem, m: { w: number; h: number }, q: number): DecorItem {
  let out = { ...it };
  let h = m.h, w = m.w;
  for (let i = 0; i < normTurn(q); i++) {
    const Hpx = h * C;
    out = {
      ...out,
      x: Hpx - out.y,
      y: out.x,
      rot: (out.rot + 90) % 360,
      side: out.side && NEXT[out.side],
      turn: ((out.turn ?? 0) + 1) % 4,
      // already in map pixels: turn the whole drawing
      svg: out.abs ? html`<g transform="matrix(0 1 -1 0 ${Hpx} 0)">${out.svg}</g>` : out.svg,
      flat: out.flat && out.abs ? html`<g transform="matrix(0 1 -1 0 ${Hpx} 0)">${out.flat}</g>` : out.flat,
    };
    [w, h] = [h, w];
  }
  return out;
}
