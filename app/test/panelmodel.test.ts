import { describe, it, expect } from "vitest";
import { Badges, isPanelId, PANEL_IDS, panelTab, rootId } from "../src/shell/panelmodel";
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
  it("has Results, Notes and Journal; a layout saved on the removed Map tab opens Results", () => {
    expect(PANEL_IDS).toEqual(["results", "notes", "journal"]);
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
