// 2D6 Void's character bar: the name chip always opens the hover flyout, as in Dungeon, including
// before the survivor is made (then the card offers to create one on the sheet).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _setCharForTest, _setGameForTest, gk } from "../src/games";
import { voidCard, voidChips } from "../src/shell/vcharbar";

function store() {
  const d: Record<string, string> = {};
  return {
    get length() { return Object.keys(d).length; },
    key: (i: number) => Object.keys(d)[i] ?? null,
    getItem: (k: string) => (k in d ? d[k] : null),
    setItem: (k: string, v: string) => void (d[k] = v),
    removeItem: (k: string) => void delete d[k],
    clear: () => Object.keys(d).forEach((k) => delete d[k]),
  };
}

describe("Void character bar", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = store();
    _setGameForTest("void");
    _setCharForTest("c-test1");
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    _setGameForTest("dungeon");
    _setCharForTest(null);
  });

  it("before a survivor is made: a name chip the flyout opens from, and a card to create one", () => {
    expect(voidChips().toString()).toContain("data-name-chip");
    const card = voidCard()?.toString() ?? "";
    expect(card).toContain("Create your survivor");
    expect(card).toContain("data-open-sheet");
  });

  it("with a survivor: their name on the chip and their card", () => {
    localStorage.setItem(gk("2d6:play:vsheet"), JSON.stringify({ name: "Vex", profession: "Freighter Captain" }));
    expect(voidChips().toString()).toContain("Vex · Lv 1");
    expect(voidCard()?.toString()).toContain("Freighter Captain");
  });
});
