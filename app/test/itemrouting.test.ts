import { describe, expect, it } from "vitest";
import type { ItemEntry } from "../src/tools/itemsmodel";
import { addToDungeonChar, addToVoidChar } from "../src/tools/itemrouting";
import { blankCharacter } from "../src/tools/sheet";
import { newVoidCharacter } from "../src/tools/void/sheetmodel";

const item = (name: string, cat: ItemEntry["cat"], text = ""): ItemEntry => ({ key: `${cat}|${name}`, name, cat, book: "b", sectionId: "s", page: 1, cost: "", lines: [], text, foundOn: [] });
const none = new Map();

describe("add to a Dungeon character", () => {
  it("puts each kind in its own field", () => {
    const c = blankCharacter();
    expect(addToDungeonChar(c, item("Jerkin", "armour"), none).ok).toBe(true);
    expect(c.armour[0][0]).toBe("Jerkin");
    addToDungeonChar(c, item("Potion of Healing", "potion", "+10 HP"), none); // the blank sheet already holds one
    expect(c.potions.some((r) => r[0] === "Potion of Healing" && r[1] === "+10 HP")).toBe(true);
    addToDungeonChar(c, item("Ruby", "gem"), none);
    expect(c.treasure).toContain("Ruby");
    addToDungeonChar(c, item("Greataxe", "weapon"), none);
    expect(c.large[0]).toBe("Greataxe");
    addToDungeonChar(c, item("Rope", "gear"), none);
    expect(c.small).toContain("Rope");
  });
  it("says so when the rows are full, and leaves upgrades out", () => {
    const c = blankCharacter();
    for (const n of ["A", "B", "C"]) addToDungeonChar(c, item(n, "armour"), none);
    const r = addToDungeonChar(c, item("D", "armour"), none);
    expect(r).toMatchObject({ ok: false });
    expect(r.msg).toMatch(/full \(3 \/ 3\)/);
    expect(addToDungeonChar(c, item("Rune", "upgrade"), none).ok).toBe(false);
  });
});

describe("add to a Void survivor", () => {
  it("files artefacts and kit by name, and fails a stim the book does not have", () => {
    const c = newVoidCharacter();
    expect(addToVoidChar(c, item("Odd Orb", "artefact")).ok).toBe(true);
    expect(c.artefacts).toContain("Odd Orb");
    addToVoidChar(c, item("Toolkit", "gear"));
    expect(c.small).toContain("Toolkit");
    expect(addToVoidChar(c, item("Nope", "stim")).ok).toBe(false);
  });
});
