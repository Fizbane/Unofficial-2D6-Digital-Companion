// The bar layout: two groups (player, stats) on the top or lower bar, each exactly once, moved by arrange
// mode's arrows, its "other bar" button or a drag. The dice are the floating button, not a group.
import { describe, expect, it } from "vitest";
import { canStep, DEFAULT_BARS, GROUPS, normalizeBars, placeGroup, stepGroup, swapBar, type BarLayout } from "../src/shell/barlayout";

const L = (top: BarLayout["top"], lower: BarLayout["lower"]): BarLayout => ({ v: 1, top, lower });

describe("bar layout", () => {
  it("has the player and the stats on the top bar to begin with, and no dice group", () => {
    expect([...GROUPS]).toEqual(["player", "stats"]);
    expect(DEFAULT_BARS).toEqual(L(["player", "stats"], []));
  });

  it("keeps every group exactly once, whatever was saved", () => {
    expect(normalizeBars(null)).toEqual(DEFAULT_BARS);
    expect(normalizeBars({ top: ["stats", "stats", "nope"], lower: ["player"] })).toEqual(L(["stats"], ["player"]));
    expect(normalizeBars({ top: [], lower: ["stats"] })).toEqual(L(["player"], ["stats"])); // the missing one goes where the default puts it
  });

  it("drops the old dice group from a layout saved before the floating button", () => {
    expect(normalizeBars({ top: ["dice", "stats"], lower: ["player", "dice"] })).toEqual(L(["stats"], ["player"]));
    expect(normalizeBars({ top: ["player", "stats"], lower: ["dice"] })).toEqual(DEFAULT_BARS);
  });

  it("steps along a bar, then across to the other bar's near end", () => {
    const d = DEFAULT_BARS; // top: player, stats; lower: nothing
    expect(stepGroup(d, "player", 1)).toEqual(L(["stats", "player"], []));
    expect(stepGroup(d, "stats", 1)).toEqual(L(["player"], ["stats"]));
    expect(stepGroup(L(["player"], ["stats"]), "stats", -1)).toEqual(d);
    expect(stepGroup(d, "player", -1)).toEqual(d); // already first
    expect(canStep(d, "player", -1)).toBe(false);
    expect(canStep(d, "stats", 1)).toBe(true);
    expect(canStep(L(["player"], ["stats"]), "stats", 1)).toBe(false); // last on the lower bar
    expect(canStep(L(["player"], ["stats"]), "stats", -1)).toBe(true);
  });

  it("moves a group to the other bar, or to a dropped position", () => {
    expect(swapBar(DEFAULT_BARS, "stats")).toEqual(L(["player"], ["stats"]));
    expect(swapBar(DEFAULT_BARS, "player")).toEqual(L(["stats"], ["player"]));
    expect(placeGroup(DEFAULT_BARS, "stats", "top", 0)).toEqual(L(["stats", "player"], []));
    expect(placeGroup(DEFAULT_BARS, "player", "lower", 99)).toEqual(L(["stats"], ["player"]));
  });
});
