// The floating dice button: where it sits, where its dashboard opens, what counts as a drag.
import { describe, expect, it } from "vitest";
import { clampFab, cubeColors, defaultFab, FAB_MARGIN, FAB_SIZE, isDrag, isFabPos, isLightColor, nudgeFab, panelAt, PIPS, SHOWN_FACES } from "../src/shell/dicefabmodel";

const VW = 1000, VH = 700;

describe("dice button position", () => {
  it("accepts only a saved position with two finite numbers", () => {
    expect(isFabPos({ x: 10, y: 20 })).toBe(true);
    for (const bad of [null, undefined, 5, "x", {}, { x: 1 }, { x: "1", y: 2 }, { x: NaN, y: 2 }, { x: 1, y: Infinity }]) expect(isFabPos(bad), String(bad)).toBe(false);
  });

  it("keeps the whole button inside the viewport", () => {
    expect(clampFab({ x: -50, y: -50 }, VW, VH)).toEqual({ x: FAB_MARGIN, y: FAB_MARGIN });
    expect(clampFab({ x: 5000, y: 5000 }, VW, VH)).toEqual({ x: VW - FAB_SIZE - FAB_MARGIN, y: VH - FAB_SIZE - FAB_MARGIN });
    expect(clampFab({ x: 300, y: 200 }, VW, VH)).toEqual({ x: 300, y: 200 });
  });

  it("pins to the margin in a viewport smaller than the button", () => {
    expect(clampFab({ x: 100, y: 100 }, 40, 40)).toEqual({ x: FAB_MARGIN, y: FAB_MARGIN });
  });

  it("starts low on the right, and inside any viewport", () => {
    const p = defaultFab(VW, VH);
    expect(p.x).toBeGreaterThan(VW / 2);
    expect(p.y).toBeGreaterThan(VH / 2);
    expect(clampFab(p, VW, VH)).toEqual(p);
    const phone = defaultFab(360, 640);
    expect(clampFab(phone, 360, 640)).toEqual(phone);
  });

  it("nudges and stays inside", () => {
    expect(nudgeFab({ x: 100, y: 100 }, 12, -12, VW, VH)).toEqual({ x: 112, y: 88 });
    expect(nudgeFab({ x: FAB_MARGIN, y: FAB_MARGIN }, -48, -48, VW, VH)).toEqual({ x: FAB_MARGIN, y: FAB_MARGIN });
  });

  it("is a drag only after the pointer has travelled a few pixels", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(3, 3)).toBe(false);
    expect(isDrag(4, 3)).toBe(true);
    expect(isDrag(-6, 0)).toBe(true);
  });
});

describe("dice dashboard placement", () => {
  const panel = { w: 300, h: 260 };
  const inside = (r: { left: number; top: number }) => {
    expect(r.left).toBeGreaterThanOrEqual(FAB_MARGIN);
    expect(r.top).toBeGreaterThanOrEqual(FAB_MARGIN);
    expect(r.left + panel.w).toBeLessThanOrEqual(VW - FAB_MARGIN);
    expect(r.top + panel.h).toBeLessThanOrEqual(VH - FAB_MARGIN);
  };

  it("opens above a button low on the screen, its right edge on the button's", () => {
    const fab = { x: 900, y: 600 };
    const r = panelAt(fab, panel, VW, VH);
    expect(r.above).toBe(true);
    expect(r.top + panel.h).toBeLessThan(fab.y);
    expect(r.left + panel.w).toBe(fab.x + FAB_SIZE);
    inside(r);
  });

  it("opens below a button at the top, its left edge on the button's when it is in the left half", () => {
    const fab = { x: 40, y: 20 };
    const r = panelAt(fab, panel, VW, VH);
    expect(r.above).toBe(false);
    expect(r.top).toBeGreaterThan(fab.y + FAB_SIZE);
    expect(r.left).toBe(fab.x);
    inside(r);
  });

  it("stays inside the viewport wherever the button is, even when it fits neither way", () => {
    for (const fab of [{ x: 8, y: 8 }, { x: 936, y: 636 }, { x: 8, y: 636 }, { x: 936, y: 8 }, { x: 480, y: 320 }]) inside(panelAt(fab, panel, VW, VH));
    const tall = panelAt({ x: 480, y: 320 }, { w: 300, h: 640 }, VW, VH);
    expect(tall.top).toBeGreaterThanOrEqual(FAB_MARGIN);
  });

  it("fits a phone", () => {
    const r = panelAt({ x: 290, y: 560 }, { w: 300, h: 260 }, 360, 640);
    expect(r.left).toBeGreaterThanOrEqual(FAB_MARGIN);
    expect(r.left + 300).toBeLessThanOrEqual(360 - FAB_MARGIN);
  });
});

describe("the cube", () => {
  it("has the right number of pips on every face, each in its own place", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(PIPS[n], String(n)).toHaveLength(n);
      expect(new Set(PIPS[n]).size).toBe(n);
      for (const cell of PIPS[n]) expect(cell >= 1 && cell <= 9).toBe(true);
    }
  });

  it("shows three faces that are not opposite each other (opposites add up to seven)", () => {
    const f = Object.values(SHOWN_FACES);
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) expect(f[i] + f[j]).not.toBe(7);
    expect(new Set(f).size).toBe(3);
  });

  it("tells a light colour from a dark one", () => {
    expect(isLightColor("#ffffff")).toBe(true);
    expect(isLightColor("#e9dfc7")).toBe(true);
    expect(isLightColor("#fff")).toBe(true);
    expect(isLightColor("#202020")).toBe(false);
    expect(isLightColor("#b8432a")).toBe(false);
    expect(isLightColor("not a colour")).toBe(false);
  });

  it("takes the die's colour for the body and a pip ink that reads on it, else a fallback", () => {
    expect(cubeColors("#e9dfc7")).toEqual({ body: "#e9dfc7", pip: "#1c1a17" });
    expect(cubeColors("#202020")).toEqual({ body: "#202020", pip: "#ffffff" });
    expect(cubeColors("").body).toBe("#b8432a");
    expect(cubeColors("red").body).toBe("#b8432a"); // only hex colours are taken
    expect(cubeColors("  #3d6bb3 ").body).toBe("#3d6bb3");
  });
});
