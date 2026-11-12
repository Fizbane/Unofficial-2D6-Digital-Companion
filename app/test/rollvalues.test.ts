import { describe, expect, it } from "vitest";
import { rollValues } from "../src/dice";

describe("rollValues (3D dice results → die values)", () => {
  it("reads dice-box's flat list of dice, ordered by group then roll", () => {
    const flat = [
      { groupId: 1, rollId: 1, value: 1 },
      { groupId: 0, rollId: 0, value: 6 },
    ];
    expect(rollValues(flat)).toEqual([6, 1]);
  });
  it("reads a grouped shape with rolls arrays too", () => {
    const grouped = [
      { groupId: 1, rolls: [{ value: 2 }] },
      { groupId: 0, rolls: [{ value: 5 }] },
    ];
    expect(rollValues(grouped)).toEqual([5, 2]);
  });
  it("returns an empty list for nothing usable", () => {
    expect(rollValues(undefined)).toEqual([]);
    expect(rollValues({ 0: { value: 3 } })).toEqual([]);
  });
});
