import { describe, it, expect } from "vitest";
import { tipPosition } from "../src/ui/hovertip";

describe("hover details card", () => {
  it("sits under its target, lined up with its left edge", () => {
    expect(tipPosition({ left: 100, top: 50, bottom: 70 }, 200, 80, 1000, 800)).toEqual({ left: 100, top: 78 });
  });
  it("flips above when there is no room below, and stays inside the window", () => {
    expect(tipPosition({ left: 900, top: 700, bottom: 780 }, 200, 80, 1000, 800)).toEqual({ left: 792, top: 612 });
    expect(tipPosition({ left: -20, top: 10, bottom: 30 }, 200, 900, 1000, 800)).toEqual({ left: 8, top: 8 });
  });
});
