import { describe, expect, it } from "vitest";
import { cornersToChamfer, type DungeonMap } from "../src/tools/dmap";

const map = (rooms: DungeonMap["rooms"], exits: DungeonMap["exits"] = []): DungeonMap =>
  ({ w: 17, h: 28, rooms, exits, sel: null, stairs: null, nextId: rooms.length + 1, entrance: null });
const room = (id: number, x: number, y: number, w: number, h: number) => ({ id, n: id, x, y, w, h, kind: "regular" as const, label: "", sub: "" });
const floorOf = (m: DungeonMap) => (x: number, y: number) =>
  m.rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || m.exits.some((e) => e.x === x && e.y === y);

describe("Dark Hulk chamfered corners", () => {
  it("cuts all four corners of a free-standing room", () => {
    const m = map([room(1, 5, 5, 4, 3)]);
    expect(cornersToChamfer(m, floorOf(m))).toHaveLength(4);
  });

  it("leaves corners on the Outer Hull square", () => {
    const m = map([room(1, 0, 25, 4, 3)]); // against the west hull and the south hull
    expect(cornersToChamfer(m, floorOf(m))).toEqual([{ x: 4, y: 25, dx: -1, dy: 1 }]);
  });

  it("chamfers corridors too", () => {
    const m = map([room(1, 8, 4, 1, 5)]);
    expect(cornersToChamfer(m, floorOf(m))).toHaveLength(4);
  });

  it("keeps a corner square where a neighbouring room or exit square touches it", () => {
    const a = room(1, 5, 5, 3, 3), b = room(2, 8, 5, 3, 3); // side by side, sharing a wall
    const m = map([a, b]);
    const cut = cornersToChamfer(m, floorOf(m));
    expect(cut).toHaveLength(4); // only each room's four outer corners
    expect(cut.some((c) => c.x === 8)).toBe(false);
  });
});
