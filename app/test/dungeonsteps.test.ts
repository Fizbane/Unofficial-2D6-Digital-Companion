import { describe, it, expect } from "vitest";
import { cleanDungeonState } from "../src/tools/dungeon";

const draft = (o: Record<string, unknown> = {}) => ({ n: 2, dice: "", x: 3, y: 4, kind: "regular", results: [], ...o });

describe("cleanDungeonState: the room in progress", () => {
  it("loads a room saved before the flow changed as it was", () => {
    const s = cleanDungeonState({ level: 1, rooms: [], current: draft() });
    expect(s.current).toEqual(draft());
  });
  it("keeps the new flags only when they are what they should be", () => {
    const ok = cleanDungeonState({ current: draft({ encDone: true, fought: true, byBook: { type: true } }) }).current!;
    expect([ok.encDone, ok.fought, ok.byBook]).toEqual([true, true, { type: true }]);
    const bad = cleanDungeonState({ current: draft({ encDone: "yes", fought: 1, byBook: "all" }) }).current!;
    expect([bad.encDone, bad.fought, bad.byBook]).toEqual([undefined, undefined, undefined]);
  });
});

describe("cleanDungeonState: doors and the level", () => {
  it("repairs doors and loose rolls that aren't what they should be", () => {
    const s = cleanDungeonState({ doors: 5, loose: "x", rest: "feast", shaftUsed: "no" });
    expect([s.doors, s.loose, s.rest, s.shaftUsed]).toEqual([{}, [], undefined, undefined]);
  });
  it("drops door notes that aren't notes (an imported backup), keeping the real ones", () => {
    const real = { k: "slab", value: 5, disc: 1 };
    const s = cleanDungeonState({ doors: { 4: { checked: true, note: [null, "x", 7, { k: 3 }, real] } } });
    expect(s.doors![4].note).toEqual([real]);
  });
  it("keeps valid door state, the rest taken and the shaft search", () => {
    const s = cleanDungeonState({ doors: { 4: { checked: true, locked: true }, x: 7 }, loose: [], rest: "ration", shaftUsed: true });
    expect(s.doors).toEqual({ 4: { checked: true, locked: true } });
    expect([s.rest, s.shaftUsed]).toEqual(["ration", true]);
  });
});
