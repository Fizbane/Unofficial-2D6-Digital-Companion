import { describe, it, expect } from "vitest";
import { mapScene, renderMap, type DungeonMap } from "../src/tools/dmap";
import { renderIsoMap } from "../src/tools/dmapiso";
import { rotateCell, rotateDecor, rotateMap, rotateSide } from "../src/tools/dmaprotate";

// a 10 × 6 map: the entrance square under an L-shaped entrance room, a corridor east through a door, stairs
const sample = (): DungeonMap => ({
  w: 10, h: 6, sel: 7, stairs: 2, nextId: 9,
  entrance: { x: 1, y: 4 },
  rooms: [
    { id: 1, n: 1, x: 0, y: 1, w: 3, h: 3, kind: "entrance", label: "Entrance", sub: "", cells: [[0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [1, 3]], details: [["Exits", "1"]] },
    { id: 2, n: 2, x: 4, y: 1, w: 4, h: 2, kind: "regular", label: "Library", sub: "", notes: "a book" },
  ],
  exits: [
    { id: 7, room: 1, side: "E", x: 3, y: 1, type: "wooden", to: 2 },
    { id: 8, room: 2, side: "S", x: 5, y: 3, type: "archway" },
  ],
});

describe("rotateMap", () => {
  it("four quarter turns give back the same map", () => {
    const m = sample();
    let t = m;
    for (let i = 0; i < 4; i++) t = rotateMap(t, 1);
    expect(t).toEqual(m);
    expect(rotateMap(m, 4)).toEqual(m);
    expect(rotateMap(m, -1)).toEqual(rotateMap(m, 3));
  });

  it("does not change the map it was given", () => {
    const m = sample();
    rotateMap(m, 1);
    expect(m).toEqual(sample());
  });

  it("turns exit sides N→E→S→W", () => {
    expect((["N", "E", "S", "W"] as const).map((s) => rotateSide(s, 1))).toEqual(["E", "S", "W", "N"]);
    const m = sample();
    expect(rotateMap(m, 1).exits.map((e) => e.side)).toEqual(["S", "W"]);
    expect(rotateMap(m, 2).exits.map((e) => e.side)).toEqual(["W", "N"]);
    expect(rotateMap(m, 3).exits.map((e) => e.side)).toEqual(["N", "E"]);
  });

  it("moves squares clockwise: (x, y) to (h-1-y, x), and swaps the map's width and height", () => {
    const t = rotateMap(sample(), 1);
    expect([t.w, t.h]).toEqual([6, 10]);
    expect(rotateCell(0, 0, 10, 6, 1)).toEqual([5, 0]); // top-left to top-right
    expect(t.exits[0]).toMatchObject({ x: 4, y: 3 });
    expect(t.rooms[1]).toMatchObject({ x: 3, y: 4, w: 2, h: 4 });
    expect(t.rooms[0].cells).toContainEqual([4, 0]); // (0,1)
    expect(t.entrance).toEqual({ x: 1, y: 1, side: "E" });
  });

  it("keeps exits on the edge of their room: the square just inside an exit is still the room's", () => {
    const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;
    for (const q of [0, 1, 2, 3]) {
      const t = rotateMap(sample(), q);
      const sc = mapScene(t, "t");
      for (const e of t.exits) {
        const [dx, dy] = DIR[e.side];
        expect(sc.owner.get(`${e.x - dx},${e.y - dy}`)).toEqual({ kind: "room", id: e.room });
      }
      expect(sc.entranceRoom?.id).toBe(1); // the entrance still leads into its room
      expect(sc.edgeBetween(t.entrance!.x, t.entrance!.y, ...([[t.entrance!.x, t.entrance!.y + 1], [t.entrance!.x - 1, t.entrance!.y], [t.entrance!.x, t.entrance!.y - 1], [t.entrance!.x + 1, t.entrance!.y]][q] as [number, number]))).toBe("open");
    }
  });
});

describe("rotateDecor", () => {
  it("turns an item's spot and wall side with the map, and four turns give it back", () => {
    const m = sample();
    const it = { kind: "wall" as const, name: "torch", x: 13, y: 39, rot: 0, side: "N" as const, seed: 1, svg: "" as never };
    const t = rotateDecor(it, m, 1);
    expect(t).toMatchObject({ x: 6 * 26 - 39, y: 13, side: "E", rot: 90, turn: 1 });
    const back = rotateDecor(it, m, 4);
    expect(back).toEqual(it);
  });
});

describe("renderIsoMap turned", () => {
  it("still has every room and open exit to tap, and the same furniture, at every turn", () => {
    const m = sample();
    const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;
    for (const q of [0, 1, 2, 3]) {
      const svg = String(renderIsoMap(m, 1, null, "paper", false, q));
      expect(svg).toContain('data-room="1"');
      expect(svg).toContain('data-room="2"');
      expect(svg).toContain('data-exit="8"');
      expect(count(svg, /data-exit=/g)).toBe(1);
    }
    // the top-down view ignores the turn
    expect(String(renderMap(m, null, null, "paper", "top"))).not.toContain("dmap-iso");
  });
});
