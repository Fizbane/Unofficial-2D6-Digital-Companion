// The Void tutorial's scripted rooms on the map: taking the way the page offers by default, each room is drawn
// at the size its dice say, so the steps that follow (a standard room, then a small one) describe what is there.
import { describe, expect, it } from "vitest";
import { VOID_DICE } from "../../src/tutorial/void";
import { exitCount, placeHulkExits, setupLevel } from "../../src/tools/void/hulkmodel";
import { addRoom, entrySideFor, findPlacement, nextExit, type DungeonMap, type MapRoom } from "../../src/tools/dmap";

/** Roll a room through the default exit, as the Hulk page does, and place its exits. */
function play(m: DungeonMap, n: number, dice: { size: readonly number[]; exits: readonly number[]; wall: readonly number[] }): { room: MapRoom; fits: boolean } {
  const exit = nextExit(m)!;
  const [w, h] = dice.size;
  const pl = findPlacement(m, exit, w, h)!;
  const room = addRoom(m, { n, x: pl.x, y: pl.y, w: pl.w, h: pl.h, kind: "regular", label: "", sub: "" });
  exit.to = room.id;
  placeHulkExits(m, room, entrySideFor(exit), exitCount(dice.exits[0]), "sliding", dice.wall[0]);
  return { room, fits: pl.w === w && pl.h === h };
}

describe("Void tutorial on the map", () => {
  it("rooms 2 and 3 are drawn as rolled when you take the default way on", () => {
    const m = setupLevel(1, null).map;
    expect(play(m, 2, VOID_DICE.room2).fits).toBe(true);
    expect(play(m, 3, VOID_DICE.room3).fits).toBe(true); // a 2 × 3 small room, not squeezed against the hull
  });
});
