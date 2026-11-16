import { describe, it, expect } from "vitest";
import {
  boundarySquares, clearRoomDoors, doorNeed, doorOf, encounterActions, exploredPct, finishBlock, isLockedRoll, lockedOn, passable, retypeExit, stairsHp, waitHp,
  type Doors, type FlowDraft,
} from "../src/tools/dungeonflow";
import { newMap, type DungeonMap, type ExitType, type MapExit, type MapRoom } from "../src/tools/dmap";

const exit = (type: ExitType, o: Partial<MapExit> = {}): MapExit => ({ id: 1, room: 1, side: "N", x: 0, y: 0, type, ...o });
const room = (id: number, x: number, y: number, w: number, h: number, draft = false): MapRoom => ({ id, n: id, x, y, w, h, kind: "regular", label: "", sub: "", ...(draft ? { draft } : {}) });

describe("lock checks", () => {
  it("lock by door type: wooden 6, reinforced 5-6, metal 4-6, never an archway", () => {
    expect([isLockedRoll("wooden", 5), isLockedRoll("wooden", 6)]).toEqual([false, true]);
    expect([isLockedRoll("reinforced", 4), isLockedRoll("reinforced", 5)]).toEqual([false, true]);
    expect([isLockedRoll("metal", 3), isLockedRoll("metal", 4)]).toEqual([false, true]);
    expect(isLockedRoll("archway", 6)).toBe(false);
    expect([lockedOn("wooden"), lockedOn("reinforced"), lockedOn("metal"), lockedOn("archway")]).toEqual(["6", "5–6", "4–6", null]);
  });

  it("doorOf reads an old save's locked exit, and ALL LOCKED, as checked and locked", () => {
    expect(doorOf({}, exit("wooden", { locked: true }))).toEqual({ checked: true, locked: true });
    expect(doorOf({}, exit("metal", { allLocked: true }))).toEqual({ checked: true, locked: true });
    expect(doorOf({}, exit("wooden"))).toEqual({});
    expect(doorOf({ 1: { checked: true } }, exit("wooden", { locked: true }))).toEqual({ checked: true });
  });
});

describe("doorNeed", () => {
  it("says what each exit needs before you can go through", () => {
    expect(doorNeed(exit("unknown"), {})).toBe("pick-type");
    expect(doorNeed(exit("archway"), {})).toBe("walk");
    expect(doorNeed(exit("curtain"), {})).toBe("walk");
    expect(doorNeed(exit("wooden"), {})).toBe("check");
    expect(doorNeed(exit("wooden"), { checked: true })).toBe("open");
    expect(doorNeed(exit("wooden"), { checked: true, locked: true })).toBe("locked");
    expect(doorNeed(exit("wooden"), { checked: true, locked: true, picked: true })).toBe("wait");
    expect(doorNeed(exit("wooden"), { checked: true, locked: true, picked: true, open: true })).toBe("open");
    expect(doorNeed(exit("portcullis"), {})).toBe("lever");
    expect(doorNeed(exit("portcullis"), { open: true })).toBe("open");
    expect(doorNeed(exit("slab"), {})).toBe("slab");
    expect(doorNeed(exit("slab"), { open: true })).toBe("open");
  });

  it("passable only when you can walk through or it is open", () => {
    expect(passable(exit("archway"), {})).toBe(true);
    expect(passable(exit("wooden"), {})).toBe(false);
    expect(passable(exit("wooden"), { checked: true })).toBe(true);
    expect(passable(exit("unknown"), {})).toBe(false);
  });

  it("an unknown exit given a type moves on to that type's need", () => {
    const e = exit("unknown");
    e.type = "metal";
    expect(doorNeed(e, {})).toBe("check");
    e.type = "archway";
    expect(passable(e, {})).toBe(true);
  });
});

describe("rations", () => {
  it("waiting at a lock: +2 HP per level with a ration (not above baseline), -2 per level without", () => {
    expect(waitHp(10, 20, 3, true)).toBe(16);
    expect(waitHp(18, 20, 3, true)).toBe(20);
    expect(waitHp(10, 20, 3, false)).toBe(4);
    expect(waitHp(3, 20, 3, false)).toBe(0);
  });

  it("resting on the stairs: +2 per level, +2 with cloth, or lose half (max 20)", () => {
    expect(stairsHp(10, 30, 2, true, false)).toBe(14);
    expect(stairsHp(10, 30, 2, true, true)).toBe(16);
    expect(stairsHp(29, 30, 2, true, true)).toBe(30);
    expect(stairsHp(35, 30, 2, true, false)).toBe(35); // already above baseline: not pulled down
    expect(stairsHp(50, 60, 1, false, false)).toBe(30);
    expect(stairsHp(9, 20, 1, false, false)).toBe(5);
  });
});

describe("encounterActions", () => {
  const has = (c: string) => ["L1G", "L1M", "L1R"].includes(c);
  it("finds the creatures named and the tables to roll, in order", () => {
    expect(encounterActions("Roll on L1G. Then fight the BLACKSMITH.", ["BLACKSMITH", "SMITH"], has)).toEqual({ creatures: ["BLACKSMITH"], tables: [{ code: "L1G", modifier: 0 }] });
    expect(encounterActions("L1M -1 and L1R -1", [], has).tables).toEqual([{ code: "L1M", modifier: -1 }, { code: "L1R", modifier: -1 }]);
  });
  it("doesn't find a creature inside another word, or tables it doesn't know", () => {
    expect(encounterActions("A LOCKSMITHS bench. See B12.", ["SMITH"], has)).toEqual({ creatures: [], tables: [] });
    expect(encounterActions("EMPTY SPACE", ["GUARD"], has)).toEqual({ creatures: [], tables: [] });
  });
  it("finds a creature beside a longer name that contains it", () => {
    expect(encounterActions("GUARD AND GUARD DOG", ["GUARD", "GUARD DOG", "DOG"], has).creatures).toEqual(["GUARD DOG", "GUARD"]);
    expect(encounterActions("A GUARD DOG sleeps here", ["GUARD", "GUARD DOG"], has).creatures).toEqual(["GUARD DOG"]);
    expect(encounterActions("two GUARDS", ["GUARD"], has).creatures).toEqual(["GUARD"]);
  });
  it("names a table once", () => {
    expect(encounterActions("L1G, then L1G again", [], has).tables).toEqual([{ code: "L1G", modifier: 0 }]);
  });
});

describe("finishBlock", () => {
  const d = (o: Partial<FlowDraft> = {}): FlowDraft => ({ kind: "regular", hasRoom: true, duplicate: false, pctShort: false, exits: 1, exitTypeKnown: true, encDone: true, ...o });
  it("names the first unfinished step", () => {
    expect(finishBlock(d({ hasRoom: false }))).toBe("Roll the room type first");
    expect(finishBlock(d({ duplicate: true }))).toBe("This unique room is already on this level: re-roll");
    expect(finishBlock(d({ pctShort: true }))).toBe("Too early for this room: re-roll");
    expect(finishBlock(d({ exits: undefined }))).toBe("Roll the exits first");
    expect(finishBlock(d({ exitTypeKnown: false }))).toBe("Set the exit type first");
    expect(finishBlock(d({ encDone: false }))).toBe("Deal with the encounter first");
    expect(finishBlock(d())).toBeNull();
  });
  it("a dead end has no exits to type", () => {
    expect(finishBlock(d({ exits: 0, exitTypeKnown: false }))).toBeNull();
  });
  it("a step done from the printed book counts", () => {
    expect(finishBlock(d({ hasRoom: false, byBook: { type: true } }))).toBeNull();
    expect(finishBlock(d({ exitTypeKnown: false, byBook: { exits: true } }))).toBeNull();
  });
  it("corridors and the entrance have no room table or encounter", () => {
    expect(finishBlock(d({ kind: "corridor", hasRoom: false, encDone: false }))).toBeNull();
    expect(finishBlock(d({ kind: "corridor", hasRoom: false, exits: undefined }))).toBe("Roll the exits first");
    expect(finishBlock(d({ kind: "entrance", hasRoom: false, encDone: false }))).toBeNull();
  });
});

describe("the map", () => {
  const map = (): DungeonMap => ({ ...newMap(1), rooms: [room(1, 0, 0, 4, 5), room(2, 6, 6, 2, 5, true)], exits: [exit("archway", { id: 3, room: 1, x: 4, y: 2 }), exit("archway", { id: 4, room: 2, x: 8, y: 7 })] });
  it("explored counts drawn floor, the room in progress included, over the level's area", () => {
    expect(exploredPct(map())).toBe(8); // 20 + 10 + 2 exit squares = 32 of 400
  });
  it("counts a room's squares on the outer boundary (a corner once)", () => {
    const m = map();
    expect(boundarySquares(m, room(9, 0, 0, 3, 2))).toBe(4);
    expect(boundarySquares(m, room(9, 5, 5, 3, 2))).toBe(0);
    expect(boundarySquares(m, room(9, 17, 18, 3, 2))).toBe(4);
  });
  it("clearRoomDoors forgets only that room's doors", () => {
    const doors: Doors = { 3: { checked: true }, 4: { checked: true } };
    clearRoomDoors(doors, map(), 2);
    expect(doors).toEqual({ 3: { checked: true } });
  });
});

describe("retypeExit", () => {
  it("puts an exit back to unknown and forgets its door, so the type can be picked again", () => {
    const e = exit("wooden", { id: 7, locked: true, allLocked: true });
    const doors: Doors = { 7: { checked: true, locked: true }, 8: { checked: true } };
    retypeExit(doors, e);
    expect(e).toMatchObject({ type: "unknown" });
    expect(e.locked).toBeUndefined();
    expect(e.allLocked).toBeUndefined();
    expect(doors).toEqual({ 8: { checked: true } });
    expect(doorNeed(e, doorOf(doors, e))).toBe("pick-type");
  });
});

describe("prisonersIn", () => {
  it("reads the book's short codes", async () => {
    const { prisonersIn } = await import("../src/tools/dungeonflow");
    expect(prisonersIn("He runs back the way you came. L1PR.")).toBe(1);
    expect(prisonersIn("You free them. L2PR.")).toBe(2);
    expect(prisonersIn("You liberate one prisoner.")).toBe(1);
    expect(prisonersIn("Liberate two prisoners")).toBe(2);
    expect(prisonersIn("A prisoner lies dead here.")).toBe(0);
    expect(prisonersIn("Roll on L1PRX")).toBe(0);
  });
});
