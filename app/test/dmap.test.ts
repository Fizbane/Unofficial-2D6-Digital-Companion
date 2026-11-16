import { describe, it, expect } from "vitest";
import { addDungeonSecretDoor, mergePanelEdits, needsDungeonSecretDoor, newMap, openExits, placeEntrance, renderMap, roomReferenceHtml, sealedDungeonRooms, validDungeonGrid, type DungeonMap, type MapExit, type MapRoom } from "../src/tools/dmap";
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

describe("Core Rules p. 18 secret doors", () => {
  it("adds a marked wooden door on the room with space to continue", () => {
    const crowded = { ...room(1), x: 0, y: 0, w: 1, h: 1 };
    const roomy = { ...room(2), x: 4, y: 6 };
    const m = { ...newMap(1), rooms: [crowded, roomy], nextId: 3, stairs: 2 };
    const door = addDungeonSecretDoor(m);
    expect(door).toMatchObject({ room: 2, type: "wooden", oneWay: true });
    expect(m.sel).toBe(door?.id);
    expect(m.stairs).toBeNull();
    expect(addDungeonSecretDoor(m)).toBeUndefined();
    expect(sealedDungeonRooms(m).size).toBe(0);
    for (const view of ["top", "iso"] as const)
      expect(String(renderMap(m, null, null, "paper", view))).toContain(">s</text>");
  });

  it("uses the exact halfway threshold", () => {
    const m: DungeonMap = { ...newMap(1), rooms: [{ ...room(1), w: 20, h: 10 }] };
    expect(needsDungeonSecretDoor(m)).toBe(false);
    m.rooms[0].cells = Array.from({ length: 199 }, (_, i) => [i % 20, Math.floor(i / 20)] as [number, number]);
    expect(needsDungeonSecretDoor(m)).toBe(true);
  });

  it("prevents backtracking through a used secret door", () => {
    const m = { ...newMap(1), rooms: [room(1), room(2), room(3)], exits: [
      { ...exit(4, 1), type: "wooden" as const, oneWay: true, to: 2 },
      { ...exit(5, 2), to: 3 },
      { ...exit(8, 1), to: 3 },
      exit(6, 1), exit(7, 2),
    ] };
    expect(openExits(m).map(e => e.id)).toEqual([7]);
    expect([...sealedDungeonRooms(m)]).toEqual([1]);
    for (const view of ["top", "iso"] as const) {
      const svg = String(renderMap(m, null, null, "paper", view));
      expect(svg).toContain('data-sealed-room="1"');
      expect(svg).not.toContain('data-room="1"');
      expect(svg).not.toContain('data-exit="6"');
      expect(svg).toContain('data-room="2"');
      expect(svg).toContain('data-exit="7"');
    }
    expect(String(roomReferenceHtml(m))).toContain('R1 <small class="muted">(sealed)</small>');
  });
});

describe("dungeon grid size", () => {
  it("enforces the level-specific minimum and accepts rectangular grids up to 1000", () => {
    expect(newMap(1)).toMatchObject({ w: 20, h: 20 });
    expect(newMap(10)).toMatchObject({ w: 25, h: 25 });
    expect(validDungeonGrid(10, 24, 1000)).toBe(false);
    expect(validDungeonGrid(10, 25, 1000)).toBe(true);
    expect(validDungeonGrid(1, 1001, 20)).toBe(false);
    expect(validDungeonGrid(1, 20, 20.5)).toBe(false);
  });

  it("places the entrance against the large grid boundary and zooms the map to its rooms", () => {
    const m = newMap(1, 1000, 1000);
    const spot = placeEntrance(m, 3, 2);
    expect(m.entrance).toEqual({ x: 500, y: 999 });
    expect(spot?.y).toBe(997);
    m.rooms.push({ ...room(1), ...spot! });
    for (const view of ["top", "iso"] as const) {
      const svg = String(renderMap(m, null, null, "caves", view));
      const dimensions = svg.match(/viewBox="([^"]+)"/)?.[1].split(" ").map(Number);
      expect(dimensions).toHaveLength(4);
      expect(Math.max(...dimensions!.slice(2))).toBeLessThan(700);
      expect(svg).toContain('data-room="1"');
    }
  });
});

describe("half explored on a bigger grid", () => {
  it("counts against the level's standard grid, not the custom size", async () => {
    const { generatedFraction } = await import("../src/tools/dmap");
    const room = (id: number, x: number, w: number, h: number): MapRoom => ({ id, n: id, x, y: 0, w, h, kind: "regular", label: "" } as MapRoom);
    const big: DungeonMap = { ...newMap(1, 60, 60), rooms: [room(1, 0, 10, 10), room(2, 10, 10, 10)] };
    expect(big.std).toBe(20);
    expect(generatedFraction(big)).toBeCloseTo(200 / 400); // 200 squares of a standard 20×20 level: half explored
    const old: DungeonMap = { ...big, std: undefined };
    expect(generatedFraction(old)).toBeCloseTo(200 / 3600); // an older map without std keeps its own area
    const small: DungeonMap = { ...newMap(1), rooms: [room(1, 0, 20, 20)] };
    expect(generatedFraction(small)).toBe(1);
  });
});
