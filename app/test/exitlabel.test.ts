import { describe, expect, it } from "vitest";
import { exitLabel, type MapExit } from "../src/tools/dmap";

const ex = (o: Partial<MapExit>): MapExit => ({ id: 1, room: 1, side: "E", x: 0, y: 0, type: "wooden", ...o }) as MapExit;

describe("exitLabel (hover text for map exits)", () => {
  it("names the door type and the wall it is on", () => {
    expect(exitLabel(ex({ type: "wooden", side: "E", to: 2 }))).toBe("Wooden door · east wall");
    expect(exitLabel(ex({ type: "archway", side: "N", to: 2 }))).toBe("Archway · north wall");
    expect(exitLabel(ex({ type: "slab", side: "W", to: 2 }))).toBe("Stone slab · west wall");
  });
  it("says when it is locked or still unexplored", () => {
    expect(exitLabel(ex({ type: "metal", side: "S", locked: true }))).toBe("Metal door · south wall · locked · unexplored");
    expect(exitLabel(ex({ type: "reinforced", locked: true, to: 3 }))).toBe("Reinforced door · east wall · locked");
  });
  it("covers every exit type, including one not rolled yet, and blocked exits", () => {
    expect(exitLabel(ex({ type: "portcullis", to: 2 }))).toBe("Portcullis · east wall");
    expect(exitLabel(ex({ type: "curtain", to: 2 }))).toBe("Curtain · east wall");
    expect(exitLabel(ex({ type: "unknown", to: 2 }))).toBe("Exit (type not rolled yet) · east wall");
    expect(exitLabel(ex({ type: "archway", blocked: true }))).toBe("Archway · east wall · blocked");
  });
});
