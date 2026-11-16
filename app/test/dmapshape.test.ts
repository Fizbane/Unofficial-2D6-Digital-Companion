import { describe, expect, it } from "vitest";
import { carve, familyFor, inRoom, roomCells, type Family } from "../src/tools/dmapshape";
import { addRoom, newMap, placeExits, reshapeRoom, type DungeonMap, type MapRoom } from "../src/tools/dmap";
import { roomThemes } from "../src/tools/dmapdecor";

const FAMILIES: Family[] = ["round", "octagon", "cross", "hall", "stepped", "L", "irregular"];

function connected(cells: [number, number][]): boolean {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const seen = new Set<string>([`${cells[0][0]},${cells[0][1]}`]);
  const stack = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const n of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
      const k = `${n[0]},${n[1]}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push(n);
      }
    }
  }
  return seen.size === set.size;
}

describe("room shapes", () => {
  it("carves exactly the rolled square count, connected, and never a plain rectangle", () => {
    for (const family of FAMILIES)
      for (let area = 6; area <= 40; area++)
        for (let seed = 1; seed <= 6; seed++) {
          const cells = carve(area, family, seed);
          if (!cells) continue;
          expect(cells.length, `${family} ${area}`).toBe(area);
          expect(connected(cells), `${family} ${area} connected`).toBe(true);
          const bw = Math.max(...cells.map((c) => c[0])) + 1, bh = Math.max(...cells.map((c) => c[1])) + 1;
          expect(bw * bh, `${family} ${area} not a rectangle`).not.toBe(area);
        }
  });

  it("is deterministic for a seed", () => {
    expect(carve(12, "cross", 7)).toEqual(carve(12, "cross", 7));
  });

  it("maps the Level 1 room names to families", () => {
    expect(familyFor("FIRE PIT ROOM")).toBe("round");
    expect(familyFor("TEMPLE")).toBe("cross");
    expect(familyFor("SPARRING CHAMBER")).toBe("octagon");
    expect(familyFor("MARBLE HALL")).toBe("hall");
    expect(familyFor("MORGUE")).toBe("stepped");
    expect(familyFor("MASON’S WORKSHOP")).toBe("L");
    expect(familyFor("EMPTY SPACE")).toBe("irregular");
  });

  it("gives every Level 1 room name scatter (the empty space is left bare on purpose)", () => {
    const names = [
      "ABANDONED GUARD POST", "GUARD POST", "MASON’S WORKSHOP", "STORAGE AREA", "MEETING ROOM",
      "BLACKSMITHS", "SCUFFED UP SPACE", "HOLDING CELL", "WASH ROOM", "FIRE PIT ROOM", "KENNEL", "SNAKE PIT",
      "WEAPON DUMP", "SHACKLE ROOM", "PRAYER ROOM", "INDOOR CAMP", "SMALL SHRINE", "POOL ROOM", "BARRACKS",
      "CANTEEN", "MORGUE", "SLEEPING QUARTERS", "TRAINING ROOM", "ABATTOIR", "DUMP", "APOTHECARY", "DAMP SPACE",
      "JAIL", "CHAPEL", "STOVE ROOM", "GRAKADA MURAL", "INTUNERIC MOSAIC", "MADUVA STATUE", "MURATAYNIE EFFIGY",
      "NEVAZATOR DOLL", "RADACINA TAPESTRY", "HEATED SPACE", "WALL SHRINE", "BANNER ARMS", "STRANGE TEXT",
      "STONE WORKSHOP", "MARBLE HALL", "OLD MESS HALL", "PENITENTIARY", "FOUNTAIN ROOM", "TEMPLE",
      "SPARRING CHAMBER", "CRATE STORE", "SLATE SHRINE", "DORMITORY", "LIBRARY",
    ];
    const bare = names.filter((n) => roomThemes(n).flatMap((t) => t.scatter ?? []).length < 2);
    expect(bare).toEqual([]);
  });

  it("reshapes a room without losing its exits, squares or room", () => {
    const m: DungeonMap = newMap(1);
    const room = addRoom(m, { n: 1, x: 6, y: 6, w: 3, h: 4, kind: "regular", label: "Room", sub: "" });
    placeExits(m, room, null, 4, "archway", false, [1, 3, 5, 6]);
    const exitsBefore = m.exits.map((e) => ({ ...e }));
    let shaped = 0;
    for (const family of FAMILIES) {
      if (reshapeRoom(m, room, family, 42)) shaped++;
      expect(roomCells(room).length).toBe(12);
      for (const e of exitsBefore) {
        const [dx, dy] = e.side === "N" ? [0, -1] : e.side === "S" ? [0, 1] : e.side === "E" ? [1, 0] : [-1, 0];
        expect(inRoom(room, e.x - dx, e.y - dy)).toBe(true);
      }
    }
    expect(shaped).toBeGreaterThan(0);
  });

  it("never reshapes a room onto another room", () => {
    const m: DungeonMap = newMap(1);
    const a: MapRoom = addRoom(m, { n: 1, x: 2, y: 2, w: 3, h: 3, kind: "regular", label: "A", sub: "" });
    const b: MapRoom = addRoom(m, { n: 2, x: 6, y: 2, w: 3, h: 3, kind: "regular", label: "B", sub: "" });
    reshapeRoom(m, a, "round", 9);
    for (const [x, y] of roomCells(a)) expect(inRoom(b, x, y)).toBe(false);
  });
});
