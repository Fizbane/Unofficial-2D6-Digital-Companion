import { describe, expect, it } from "vitest";
import { canEquip, findItem, itemMods, isEquipped, lootLine, normaliseEquipped, parseMods, splitItems, splitLoot, sumMods, toggleEquip } from "../src/tools/gear";
import type { ItemEntry } from "../src/tools/itemsmodel";

const entry = (name: string, cat: ItemEntry["cat"], text = "", lines: [string, string][] = []): ItemEntry => ({
  key: `${cat}|${name}`, name, cat, book: "core", sectionId: "x", page: 1, cost: "", lines, text, foundOn: [],
});

describe("parseMods", () => {
  it("reads lasting bonuses", () => {
    expect(parseMods("Gauntlets of Power (+1 Shift)")).toEqual({ shift: 1 });
    expect(parseMods("+1 Discipline +1 Precision")).toEqual({ disc: 1, prec: 1 });
    expect(parseMods("+1 Shift - Can not be combined with gauntlets")).toEqual({ shift: 1 });
    expect(parseMods("−1 Precision")).toEqual({ prec: -1 });
  });
  it("skips temporary and conditional ones", () => {
    expect(parseMods("+2 Shift for 1 whole combat")).toEqual({});
    expect(parseMods("+1 Precision for 1 dungeon level")).toEqual({});
    expect(parseMods("The weapon feels lighter. +1 Shift against all nonhumanoid creatures.")).toEqual({});
    expect(parseMods("+1 to Discipline and +1 to the Fail to Cast roll when using Psyche magic.")).toEqual({});
    expect(parseMods("+20 HP")).toEqual({});
  });
});

describe("findItem", () => {
  const all = [entry("Gauntlets of Power", "magic", "+1 Shift"), entry("Rope", "gear"), entry("Potion of Healing", "potion")];
  it("matches names loosely", () => {
    expect(findItem(all, "gauntlets of power")?.name).toBe("Gauntlets of Power");
    expect(findItem(all, "2x Rope")?.name).toBe("Rope");
    expect(findItem(all, "Ropes")?.name).toBe("Rope");
    expect(findItem(all, "Potion of Healing (half)")?.name).toBe("Potion of Healing");
    expect(findItem(all, "Lantern")).toBeUndefined();
  });
  it("knows what can be equipped and what it gives", () => {
    expect(canEquip(all[0])).toBe(true);
    expect(canEquip(all[2])).toBe(false);
    expect(itemMods(all[0])).toEqual({ shift: 1 });
  });
});

describe("equipped list", () => {
  it("toggles and sums", () => {
    let eq = toggleEquip([], "Gauntlets of Power", { shift: 1 });
    eq = toggleEquip(eq, "Ring of Focus", { disc: 1, shift: 1 });
    expect(isEquipped(eq, "gauntlets of power")).toBe(true);
    expect(sumMods(eq)).toMatchObject({ shift: 2, disc: 1 });
    eq = toggleEquip(eq, "Gauntlets of Power", {});
    expect(sumMods(eq).shift).toBe(1);
  });
  it("cleans stored data", () => {
    expect(normaliseEquipped([{ name: "X", mods: { shift: 99, bogus: 3 } }, null, { mods: {} }])).toEqual([{ name: "X", mods: { shift: 10 } }]);
    expect(normaliseEquipped("nope")).toEqual([]);
  });
});

describe("splitItems and splitLoot", () => {
  it("splits pack text", () => {
    expect(splitItems("Flint and steel, lantern, pouch\nRope")).toEqual(["Flint and steel", "lantern", "pouch", "Rope"]);
  });
  it("splits found loot with quantities", () => {
    expect(splitLoot("a coil of wire and two spanners")).toEqual([{ name: "Coil of wire", qty: 1 }, { name: "Spanners", qty: 2 }]);
    expect(splitLoot("You find 3 bolts, a wrench and some wire.")).toEqual([{ name: "Bolts", qty: 3 }, { name: "Wrench", qty: 1 }, { name: "Wire", qty: 1 }]);
    expect(lootLine({ name: "Spanners", qty: 2 })).toBe("Spanners ×2");
  });
});

describe("lootIn", () => {
  it("finds what a result gives outright", async () => {
    const { lootIn } = await import("../src/tools/gear");
    expect(lootIn("You check the cupboard. You find a coil of wire and two spanners.")).toEqual(["Coil of wire", "Spanners ×2"]);
    expect(lootIn("Inside is a medical stim.")).toEqual(["Medical stim"]);
  });
  it("leaves finds that hang on a roll or a choice, and things that aren't items", async () => {
    const { lootIn } = await import("../src/tools/gear");
    expect(lootIn("Roll a D6. On 4+ you find a wrench.")).toEqual([]);
    expect(lootIn("If you search, you find a key.")).toEqual([]);
    expect(lootIn("You find nothing of use.")).toEqual([]);
    expect(lootIn("You find a door to the north.")).toEqual([]);
  });
});

describe("review fixes", () => {
  it("keeps a lasting bonus that shares a sentence with a conditional one", () => {
    expect(parseMods("Ring of Focus (+1 Discipline, +1 if you retry a spell)")).toEqual({ disc: 1 });
  });
  it("counts a bonus stated twice once", () => {
    const e = entry("Gauntlets of Power", "magic", "Gauntlets of Power (+1 Shift)", [["Effect", "+1 Shift"]]);
    expect(itemMods(e)).toEqual({ shift: 1 });
  });
  it("finds an item named inside a longer line", () => {
    const all = [entry("Gauntlets of Power", "magic", "+1 Shift"), entry("Rope", "gear")];
    expect(findItem(all, "Broken gauntlets of power")?.name).toBe("Gauntlets of Power");
    expect(findItem(all, "Coil of rope")?.name).toBe("Rope");
    expect(findItem(all, "Gauntlets")).toBeUndefined(); // part of a name isn't a match
  });
});
