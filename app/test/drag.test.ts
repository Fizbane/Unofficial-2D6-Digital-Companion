// Dragging the tutorial cards: the card must always stay on screen.
import { describe, expect, it } from "vitest";
import { clampOffset, type DragBounds } from "../src/ui/drag";

// a 560 x 300 card resting bottom-centre of a 1200 x 800 window
const b: DragBounds = { left: 320, top: 420, width: 560, height: 300, viewW: 1200, viewH: 800 };

describe("clampOffset", () => {
  it("leaves a move inside the window alone", () => {
    expect(clampOffset({ x: 0, y: 0 }, b)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -200, y: -300 }, b)).toEqual({ x: -200, y: -300 });
  });
  it("stops at each edge with the whole card still showing", () => {
    expect(clampOffset({ x: -5000, y: -5000 }, b)).toEqual({ x: -b.left, y: -b.top });
    expect(clampOffset({ x: 5000, y: 5000 }, b)).toEqual({ x: b.viewW - b.width - b.left, y: b.viewH - b.height - b.top });
  });
  it("holds a card bigger than the window at the top left, where its handle is", () => {
    const small = { ...b, left: 0, top: 30, viewW: 400, viewH: 200 };
    expect(clampOffset({ x: 90, y: 90 }, small)).toEqual({ x: 0, y: -30 });
  });
});
