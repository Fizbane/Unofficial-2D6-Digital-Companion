import { describe, it, expect } from "vitest";
import { Badges, combatLogShown, isPanelId, PANEL_IDS, panelTab, rootId, stepPanel } from "../src/shell/panelmodel";
import type { ResultCard } from "../src/shell/types";

const card = (id: string, parent?: string): ResultCard => ({
  id, at: 0, eyebrow: "", title: "", text: "", dice: "", follow: [], ...(parent ? { parent } : {}),
});

describe("panelTab", () => {
  it("reads a saved tab and falls back to Results", () => {
    expect(panelTab({ panelTab: "notes" })).toBe("notes");
    expect(panelTab({})).toBe("results");
    expect(panelTab({ panelTab: "bogus" })).toBe("results");
    expect(panelTab({ panelTab: 3 })).toBe("results");
    // the Character tab was removed: a layout saved on it opens Results
    expect(isPanelId("character")).toBe(false);
    expect(panelTab({ panelTab: "character" })).toBe("results");
    expect(isPanelId("Results")).toBe(false);
  });
  it("has Results, Notes, Journal and the Combat log; a layout saved on the removed Map tab opens Results", () => {
    expect(PANEL_IDS).toEqual(["results", "notes", "journal", "combat"]);
    expect(panelTab({ panelTab: "combat" })).toBe("combat");
    expect(isPanelId("map")).toBe(false);
    expect(panelTab({ panelTab: "map" })).toBe("results");
  });
});

describe("rootId", () => {
  const cards = [card("c1"), card("c2", "c1"), card("c3", "c2"), card("c4")];
  it("returns a top-level card itself", () => {
    expect(rootId(cards, "c1")).toBe("c1");
    expect(rootId(cards, "c4")).toBe("c4");
  });
  it("walks parents up to the root", () => {
    expect(rootId(cards, "c2")).toBe("c1");
    expect(rootId(cards, "c3")).toBe("c1");
  });
  it("leaves unknown ids and evicted parents alone", () => {
    expect(rootId(cards, "zz")).toBe("zz");
    expect(rootId([card("c9", "gone")], "c9")).toBe("c9");
  });
  it("stops on a cycle", () => {
    const loop = [card("a", "b"), card("b", "a")];
    expect(["a", "b"]).toContain(rootId(loop, "a"));
  });
});

describe("Badges", () => {
  it("badges only tabs that are not on screen, and clears on view", () => {
    const b = new Badges();
    expect(b.mark("results", true)).toBe(false);
    expect(b.any()).toBe(false);
    expect(b.mark("results", false)).toBe(true);
    expect(b.mark("notes", false)).toBe(true);
    expect(b.has("results")).toBe(true);
    b.seen("results");
    expect(b.has("results")).toBe(false);
    expect(b.any()).toBe(true);
    b.seen("notes");
    expect(b.any()).toBe(false);
  });
});

describe("combatLogShown", () => {
  const none = { dungeon: null, lairs: null, haunted: null, vhulk: null, fighting: false };
  it("is hidden when you aren't anywhere a fight happens", () => {
    expect(combatLogShown("dungeon", none)).toBe(false);
    expect(combatLogShown("void", none)).toBe(false);
    expect(combatLogShown("dungeon", { ...none, dungeon: { rooms: [], current: null }, lairs: { lair: "" }, haunted: { fear: 0, rooms: [0, 0], loftCleared: false } })).toBe(false);
  });
  it("shows in a dungeon level that has begun", () => {
    expect(combatLogShown("dungeon", { ...none, dungeon: { rooms: [{}], current: null } })).toBe(true);
    expect(combatLogShown("dungeon", { ...none, dungeon: { rooms: [], current: { n: 1 } } })).toBe(true);
  });
  it("shows in a lair or the haunted house", () => {
    expect(combatLogShown("dungeon", { ...none, lairs: { lair: "swamp" } })).toBe(true);
    expect(combatLogShown("dungeon", { ...none, haunted: { fear: 0, rooms: [1, 0], loftCleared: false } })).toBe(true);
    expect(combatLogShown("dungeon", { ...none, haunted: { fear: 2, rooms: [0, 0], loftCleared: false } })).toBe(true);
  });
  it("shows aboard the Dark Hulk once a level is entered, in Void only", () => {
    expect(combatLogShown("void", { ...none, vhulk: { map: {} } })).toBe(true);
    expect(combatLogShown("void", { ...none, vhulk: {} })).toBe(false);
    expect(combatLogShown("void", { ...none, dungeon: { rooms: [{}], current: null } })).toBe(false);
    expect(combatLogShown("dungeon", { ...none, vhulk: { map: {} } })).toBe(false);
  });
  it("shows while a fight is under way wherever you are, so its log is never out of reach", () => {
    expect(combatLogShown("dungeon", { ...none, fighting: true })).toBe(true);
  });
  it("reads broken saved state as not there", () => {
    expect(combatLogShown("dungeon", { ...none, dungeon: { rooms: "x" }, lairs: 5, haunted: { rooms: "y" } })).toBe(false);
  });
});

describe("stepPanel", () => {
  const ids = ["results", "notes", "journal", "combat"] as const;
  it("moves to the next or previous tab that is showing, wrapping round", () => {
    expect(stepPanel(ids, "journal", 1, new Set())).toBe("combat");
    expect(stepPanel(ids, "journal", 1, new Set(["combat"]))).toBe("results");
    expect(stepPanel(ids, "results", -1, new Set(["combat"]))).toBe("journal");
    expect(stepPanel(ids, "notes", "first", new Set())).toBe("results");
    expect(stepPanel(ids, "notes", "last", new Set(["combat"]))).toBe("journal");
  });
});
