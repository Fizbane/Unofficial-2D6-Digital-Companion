import { describe, expect, it } from "vitest";
import { findRoll, removeLoot, revertAuto } from "../src/tools/autoapply";

describe("taking back what a room's rolls applied", () => {
  it("restores conditions, removes loot and prisoner tallies", () => {
    const c = { small: "Torch\nWrench\nWire ×2", bloodied: 1, stunned: 3, prisoners: 3 };
    const back = revertAuto(c, {
      conds: [{ field: "stunned", before: 0, after: 3 }, { field: "bloodied", before: 0, after: 1 }],
      loot: ["Wrench", "Wire ×2"],
      prisoners: 2,
    });
    expect(c).toEqual({ small: "Torch", bloodied: 0, stunned: 0, prisoners: 1 });
    expect(back.length).toBe(4);
  });
  it("leaves a condition alone that changed since", () => {
    const c = { small: "", bloodied: 4, stunned: 0 };
    revertAuto(c, { conds: [{ field: "bloodied", before: 0, after: 1 }] });
    expect(c.bloodied).toBe(4);
  });
  it("removes one copy of a found item", () => {
    expect(removeLoot("Wrench\nWrench", ["Wrench"])).toBe("Wrench");
  });
});

describe("findRoll", () => {
  it("finds a saved roll anywhere in the state by its id", () => {
    const roll = { lid: "abc", cells: [] };
    const st = { current: { results: [{ roll: { lid: "x" } }] }, loose: [{ roll }] };
    expect(findRoll(st, "abc")).toBe(roll);
    expect(findRoll(st, "nope")).toBeUndefined();
  });
});
