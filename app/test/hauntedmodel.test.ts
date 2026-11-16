import { describe, expect, it } from "vitest";
import { activeFears, brokenByFear, clampFear, doorIsHaunted, HOUSE, roomTableFor } from "../src/tools/hauntedmodel";

const ROWS = [["1", "", "first"], ["2", "", "second"], ["3", "", "third"], ["x", "", "junk"], ["4", "", ""]];
describe("Fear Points", () => {
  it("clamps to 0..10 and breaks at 10", () => {
    expect([-2, 0, 4.7, 10, 15, NaN].map(clampFear)).toEqual([0, 0, 4, 10, 10, 0]);
    expect(brokenByFear(9)).toBe(false);
    expect(brokenByFear(10)).toBe(true);
  });
  it("effects are cumulative: N points means rows 1..N, skipping rows that don't parse", () => {
    expect(activeFears(ROWS, 0)).toEqual([]);
    expect(activeFears(ROWS, 2).map((e) => e.effect)).toEqual(["first", "second"]);
    expect(activeFears(ROWS, 10).map((e) => e.n)).toEqual([1, 2, 3]);
  });
});
describe("doors and rooms", () => {
  it("a door is haunted on 5 or 6, never when backtracking", () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => doorIsHaunted(d))).toEqual([false, false, false, false, true, true]);
    expect(doorIsHaunted(6, true)).toBe(false);
  });
  it("levels 1 and 2 have their own room tables, 3 is the loft", () => {
    expect(roomTableFor(1)).toBe(HOUSE.level1);
    expect(roomTableFor(2)).toBe(HOUSE.level2);
    expect(roomTableFor(3)).toBe(HOUSE.loft);
  });
});
