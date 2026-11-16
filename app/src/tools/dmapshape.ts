// Room footprints for the dungeon map. A room keeps the square count its size roll gave, but once its
// type is known it can take a shape that suits the name: a round pit, a cross-shaped chapel, an L-shaped
// workshop, a stepped tomb. A room with no `cells` is still a plain rectangle (x, y, w, h).
// Pure geometry, no DOM: the map renderers and the dressing planner read the same cells.

export type Cell = [number, number];
/** The part of a room the footprint helpers read: its bounding box, plus its squares when it isn't a rectangle. */
export interface Footprint { x: number; y: number; w: number; h: number; cells?: Cell[] }
export type Family = "round" | "octagon" | "cross" | "hall" | "stepped" | "L" | "irregular";

/** The room's squares, absolute map coordinates. */
export function roomCells(r: Footprint): Cell[] {
  if (r.cells?.length) return r.cells;
  const out: Cell[] = [];
  for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) out.push([x, y]);
  return out;
}

/** Is square (x, y) part of the room? */
export function inRoom(r: Footprint, x: number, y: number): boolean {
  if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
  return r.cells?.length ? r.cells.some(([a, b]) => a === x && b === y) : true;
}

/** The room as one SVG path in pixels (a square is C wide). */
export function roomPath(r: Footprint, C: number): string {
  if (!r.cells?.length) return `M${r.x * C} ${r.y * C}h${r.w * C}v${r.h * C}h${-r.w * C}Z`;
  return r.cells.map(([x, y]) => `M${x * C} ${y * C}h${C}v${C}h${-C}Z`).join("");
}

/** The room's outline as an SVG path: only the edges where the room meets something else. */
export function outlinePath(r: Footprint, C: number): string {
  const has = new Set(roomCells(r).map(([x, y]) => `${x},${y}`));
  let d = "";
  for (const [x, y] of roomCells(r)) {
    if (!has.has(`${x},${y - 1}`)) d += `M${x * C} ${y * C}h${C}`;
    if (!has.has(`${x},${y + 1}`)) d += `M${x * C} ${(y + 1) * C}h${C}`;
    if (!has.has(`${x - 1},${y}`)) d += `M${x * C} ${y * C}v${C}`;
    if (!has.has(`${x + 1},${y}`)) d += `M${(x + 1) * C} ${y * C}v${C}`;
  }
  return d;
}

/** Which footprint family suits a room, from its type name (the first matching rule wins). */
const RULES: [RegExp, Family][] = [
  [/POOL|FOUNTAIN|\bPIT\b|FIRE PIT|HEATED/, "round"],
  [/SPARRING|TRAINING|ARENA|CIRCLE/, "octagon"],
  [/CHAPEL|TEMPLE|PRAYER|SHRINE|SANCT|ALTAR/, "cross"],
  [/HALL|BARRACKS|DORM|CANTEEN|MESS|KENNEL|SLEEPING|CAGE|COURT/, "hall"],
  [/MORGUE|TOMB|CRYPT|LIBRARY|JAIL|HOLDING|CELL|THRONE|MURAL|MOSAIC|TAPESTRY|EFFIGY|STATUE|DOLL|IDOL|BANNER|TROPHY/, "stepped"],
  [/WORKSHOP|MASON|BLACKSMITH|APOTHECARY|STOVE|MEETING|GUARD|WASH|CAMP|SHACKLE|PENITENTIARY|STUDY/, "L"],
];
export function familyFor(name: string | undefined): Family {
  const n = (name ?? "").toUpperCase();
  return RULES.find(([re]) => re.test(n))?.[1] ?? "irregular";
}

/** Seeded 0..1 noise, so a room's shape is the same every time it is drawn. */
function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 1274126177) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function connected(set: Set<string>): boolean {
  if (set.size <= 1) return true;
  const start = set.values().next().value as string;
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const [x, y] = stack.pop()!.split(",").map(Number);
    for (const n of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`])
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
  }
  return seen.size === set.size;
}

/**
 * A connected shape of exactly `area` squares, in the given family, normalised to start at (0, 0).
 * It starts from a box about 1.8 times the area and trims outside squares one at a time, the family
 * deciding which squares go first. Returns null if the trimming ends up as a plain rectangle (try another seed).
 */
export function carve(area: number, family: Family, seed: number): Cell[] | null {
  if (area < 4) return null;
  const side = Math.ceil(Math.sqrt(area * 1.8));
  const W = family === "hall" ? Math.ceil(side * 1.5) : side;
  const H = Math.ceil((area * 1.8) / W);
  const set = new Set<string>();
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) set.add(`${x},${y}`);
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const score = (x: number, y: number): number => {
    const dx = x - cx, dy = y - cy, n = noise(x, y, seed) * 0.9;
    switch (family) {
      case "round": return Math.hypot(dx, dy) + n;
      case "octagon": case "hall": return Math.abs(dx) + Math.abs(dy) * 0.8 + n;
      case "cross": return Math.min(Math.abs(dx), Math.abs(dy)) + n;
      case "stepped": return (dy < 0 ? Math.abs(dx) * 3 : 0) + n;
      case "L": return (dx > 0 && dy > 0 ? 50 : 0) + n;
      default: return n * 10;
    }
  };
  while (set.size > area) {
    const cands: { k: string; s: number }[] = [];
    for (const k of set) {
      const [x, y] = k.split(",").map(Number);
      if (![`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`].every((n) => set.has(n))) cands.push({ k, s: score(x, y) });
    }
    cands.sort((a, b) => b.s - a.s);
    let cut = false;
    for (const { k } of cands) {
      set.delete(k);
      if (connected(set)) {
        cut = true;
        break;
      }
      set.add(k);
    }
    if (!cut) return null;
  }
  const cells = [...set].map((k) => k.split(",").map(Number) as Cell);
  const minX = Math.min(...cells.map((c) => c[0])), minY = Math.min(...cells.map((c) => c[1]));
  const out = cells.map(([x, y]) => [x - minX, y - minY] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const bw = Math.max(...out.map((c) => c[0])) + 1, bh = Math.max(...out.map((c) => c[1])) + 1;
  return bw * bh === area ? null : out; // still a rectangle: not a shape
}
