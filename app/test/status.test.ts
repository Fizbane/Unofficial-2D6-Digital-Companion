import { describe, it, expect } from "vitest";
import { contextOf, dungeonSummary, isContext, realmSummary, statusText, characterLine, dungeonLine, realmLine } from "../src/shell/status";

const dungeon = { level: 3, room: 7, rations: 4 };
const realm = { month: 5, round: 2, treasury: 120 };

describe("contextOf", () => {
  it("maps play routes to contexts", () => {
    expect(contextOf("#/play/dungeon")).toBe("dungeon");
    expect(contextOf("#/play/combat")).toBe("dungeon");
    expect(contextOf("#/play/realm")).toBe("realm");
    expect(contextOf("#/play/realm?x=1")).toBe("realm");
    expect(contextOf("#/settings")).toBeNull();
    expect(contextOf(null)).toBeNull();
  });
});

describe("statusText", () => {
  it("shows the dungeon summary on the combat route", () => {
    expect(statusText({ route: "#/play/combat", last: null, dungeon, realm })).toEqual({
      text: "Level 3 · Room 7 · Rations 4",
      target: "#/play/dungeon",
    });
  });

  it("falls back to the last context on other routes", () => {
    expect(statusText({ route: "#/settings", last: "realm", dungeon, realm })).toEqual({
      text: "Month 5 · Round 2 · Treasury 120 gc",
      target: "#/play/realm",
    });
  });

  it("is null when that context has no summary", () => {
    expect(statusText({ route: "#/play/dungeon", last: "realm", dungeon: null, realm })).toBeNull();
  });

  it("is null with no context", () => {
    expect(statusText({ route: "#/settings", last: null, dungeon, realm })).toBeNull();
  });
});

describe("dungeonSummary", () => {
  it("is null before any room exists", () => {
    expect(dungeonSummary({ level: 1, rooms: [], current: null }, 3)).toBeNull();
  });
  it("uses the room in progress, else the number of rooms done", () => {
    expect(dungeonSummary({ level: 2, rooms: [{}, {}], current: { n: 3 } }, 4)).toEqual({ level: 2, room: 3, rations: 4 });
    expect(dungeonSummary({ level: 2, rooms: [{}, {}], current: null }, 0)).toEqual({ level: 2, room: 2, rations: 0 });
    expect(dungeonSummary({ level: 1, rooms: [], current: { n: 1 } }, 3)).toEqual({ level: 1, room: 1, rations: 3 });
  });
});

describe("realmSummary", () => {
  it("maps gc to treasury, null without a saved realm", () => {
    expect(realmSummary(null)).toBeNull();
    expect(realmSummary({ month: 4, round: 2, gc: 55 })).toEqual({ month: 4, round: 2, treasury: 55 });
  });
});

describe("isContext", () => {
  it("accepts only dungeon and realm", () => {
    expect(isContext("dungeon")).toBe(true);
    expect(isContext("realm")).toBe(true);
    for (const v of [null, "combat", 1, undefined]) expect(isContext(v)).toBe(false);
  });
});

describe("Continue card lines", () => {
  it("formats dungeon and realm summaries without rations or treasury", () => {
    expect(dungeonLine({ level: 2, room: 5, rations: 1 })).toBe("Level 2 · Room 5");
    expect(realmLine({ month: 3, round: 2, treasury: 40 })).toBe("Month 3 · Round 2");
  });
  it("formats the character, null while the sheet is blank", () => {
    expect(characterLine({ name: "Wren", xp: 120, hp: 14 }, 2, 20)).toBe("Wren · Lv 2 · HP 14/20");
    expect(characterLine({ name: "  ", xp: 0, hp: 10 }, 1, 10)).toBeNull();
    expect(characterLine({ name: "", xp: 50, hp: 10 }, 1, 10)).toBe("Unnamed adventurer · Lv 1 · HP 10/10");
  });
});
