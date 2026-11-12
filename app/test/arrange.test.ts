import { describe, it, expect } from "vitest";
import { clampFrac, columnsFor, DEFAULT_LAYOUT, MAX_FRAC, MIN_FRAC } from "../src/shell/arrange";

describe("pane arrangement", () => {
  it("keeps each pane usable", () => {
    expect(clampFrac(0)).toBe(MIN_FRAC);
    expect(clampFrac(1)).toBe(MAX_FRAC);
    expect(clampFrac(NaN)).toBe(DEFAULT_LAYOUT.frac);
  });
  it("puts the map's share on the side it is on", () => {
    expect(columnsFor({ v: 1, frac: 0.25, swapped: false })).toBe("minmax(0, 0.25fr) 10px minmax(0, 0.75fr)");
    expect(columnsFor({ v: 1, frac: 0.25, swapped: true })).toBe("minmax(0, 0.75fr) 10px minmax(0, 0.25fr)");
  });
});
