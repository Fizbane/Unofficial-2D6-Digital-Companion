import { describe, expect, it } from "vitest";
import { hulkViewBox } from "../../src/tools/void/mappage";
import { hulkMap } from "../../src/tools/void/hulkmodel";
import type { MapRoom } from "../../src/tools/dmap";

const room = (x: number, y: number, w: number, h: number): MapRoom => ({ id: 1, n: 1, x, y, w, h, kind: "regular", label: "R", sub: "" }) as MapRoom;

describe("hulkViewBox", () => {
  it("shows the whole hull while nothing is drawn", () => {
    const m = hulkMap();
    expect(hulkViewBox(m, { ladderIn: null })).toEqual({ x: 0, y: 0, w: m.w, h: m.h });
  });
  it("crops to the drawn rooms plus a margin, at least 10 × 10, inside the hull", () => {
    const m = hulkMap();
    m.rooms.push(room(6, 24, 4, 3));
    const b = hulkViewBox(m, { ladderIn: null });
    expect(b.w).toBeGreaterThanOrEqual(10);
    expect(b.h).toBeGreaterThanOrEqual(10);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y + b.h).toBeLessThanOrEqual(m.h);
    expect(b.x).toBeLessThanOrEqual(6);
    expect(b.x + b.w).toBeGreaterThanOrEqual(10);
    expect(b.y).toBeLessThanOrEqual(24);
    expect(b.y + b.h).toBe(m.h);
  });
});
