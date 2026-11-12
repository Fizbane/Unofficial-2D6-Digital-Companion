import { describe, it, expect } from "vitest";
import { mergePanelEdits, newMap, renderMap, type DungeonMap, type MapExit, type MapRoom } from "../src/tools/dmap";
import { renderRealmMap } from "../src/tools/rmap";

const room = (id: number, notes?: string): MapRoom => ({ id, n: id, x: 0, y: 0, w: 2, h: 2, kind: "regular", label: `R${id}`, sub: "", ...(notes ? { notes } : {}) });
const exit = (id: number, roomId: number): MapExit => ({ id, room: roomId, side: "N", x: 0, y: 0, type: "archway" });
const clone = (m: DungeonMap): DungeonMap => JSON.parse(JSON.stringify(m));

describe("mergePanelEdits", () => {
  it("copies room notes, the stairs and the chosen exit from the saved map", () => {
    const mem: DungeonMap = { ...newMap(1), rooms: [room(1), room(2, "old")], exits: [exit(3, 1)], sel: null, stairs: null };
    const saved = clone(mem);
    saved.rooms[0].notes = "Chest by the door";
    delete saved.rooms[1].notes;
    saved.stairs = 2;
    saved.sel = 3;
    mergePanelEdits(mem, saved);
    expect(mem.rooms.map((r) => r.notes)).toEqual(["Chest by the door", undefined]);
    expect(mem.stairs).toBe(2);
    expect(mem.sel).toBe(3);
  });

  it("keeps room and exit object identity (a roll awaiting dice still writes into the live map)", () => {
    const mem: DungeonMap = { ...newMap(1), rooms: [room(1)], exits: [exit(3, 1)] };
    const r1 = mem.rooms[0], ex = mem.exits[0], rooms = mem.rooms, exits = mem.exits;
    const saved = clone(mem);
    saved.rooms[0].notes = "x";
    mergePanelEdits(mem, saved);
    expect(mem.rooms).toBe(rooms);
    expect(mem.exits).toBe(exits);
    expect(mem.rooms[0]).toBe(r1);
    expect(mem.exits[0]).toBe(ex);
    expect(r1.notes).toBe("x");
  });

  it("leaves rooms that aren't in the saved map alone, and ignores saved rooms we don't have", () => {
    const mem: DungeonMap = { ...newMap(1), rooms: [room(1, "keep"), room(2, "new room, not saved yet")] };
    const saved: DungeonMap = { ...newMap(1), rooms: [room(1, "edited"), room(9, "gone")] };
    mergePanelEdits(mem, saved);
    expect(mem.rooms.map((r) => [r.id, r.notes])).toEqual([[1, "edited"], [2, "new room, not saved yet"]]);
  });
});

describe("map markers are drawn, not text glyphs", () => {
  it("marks a room with notes by a drawn pencil (no ✎ character)", () => {
    const m: DungeonMap = { ...newMap(1), rooms: [room(1, "Chest left behind"), room(2)] };
    const svg = String(renderMap(m, null));
    expect(svg).not.toContain("✎");
    expect(svg.match(/m15 5 4 4/g)).toHaveLength(1); // one pencil, for the room with notes
  });
  it("crosses unclaimed realm plots with a drawn path (no ✕ character)", () => {
    const svg = String(renderRealmMap({ plots: [{ code: "HI", cells: [[3, 3]], claimed: false, tag: "1HI" }, { code: "FI", cells: [[8, 8]], claimed: true, tag: "2FI" }] }));
    expect(svg).not.toContain("✕");
    expect(svg.match(/l6 6 m0 -6 l-6 6/g)).toHaveLength(1); // only the unclaimed plot
  });
});
