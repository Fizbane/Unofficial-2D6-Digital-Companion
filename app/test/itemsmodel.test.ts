import { describe, expect, it } from "vitest";
import type { Section, Table } from "../src/types";
import { filterItems, itemCats, itemChoices, itemEntries, noItemFilter } from "../src/tools/itemsmodel";

const tbl = (title: string, columns: string[], rows: string[][], code?: string): Table => ({ title, code: code ?? null, dice: null, columns, rows });
const sec = (id: string, book: string, tables: Table[]): Section => ({
  id, book, title: id, level: 2, chapter: null, pages: [1], blocks: tables.map((table) => ({ type: "table" as const, table, page: 5 })),
});

describe("items model", () => {
  const all = itemEntries([
    sec("r", "codex", [
      tbl("ARMOUR TABLE 1", ["ARMOUR TYPE", "DICE SET", "MODIFIER", "COST"], [["JERKIN", "[4]", "-1 Damage", "9gc"]]),
      tbl("MAGIC POTIONS TABLE 1", ["POTION OF", "EFFECT MODIFIER", "DURATION", "COST"], [["HEALING", "+10 HP", "INSTANT", "20gc"]]),
      tbl("ART1 - ARMOUR - RANDOM T1", ["ROLL", "ITEM"], [["1", "JERKIN"], ["2", "JERKIN"], ["3", "PADDED TUNIC"], ["4", "There is a box here."]], "ART1"),
      tbl("POT1 - POTIONS T1", ["ROLL", "ITEM"], [["1", "POTION OF HEALING"], ["2", "POTION OF PHASING"], ["3", "POTION OF HEALING"], ["4", "POTION OF HEALING"]], "POT1"),
      tbl("WEAPON MANOEUVRES TABLE 1", ["Manoeuvre Level", "Dice", "WEAPON: LONGSWORD"], [["Level 1", "[1][2]", "[1][2] - THRUST = D6"]]),
      tbl("CHARACTER SHEET - ARMOUR PIECE", ["ARMOUR PIECE", "DICE SET", "MODIFIER"], [["MY ARMOUR", "[1]", "-1"]]),
    ]),
  ]);
  const by = (n: string) => all.find((e) => e.name === n);
  it("reads catalog tables with their cost and details", () => {
    expect(by("Jerkin")).toMatchObject({ cat: "armour", cost: "9gc", foundOn: ["ART1"] });
    expect(by("Jerkin")!.lines).toEqual([["Dice Set", "[4]"], ["Modifier", "-1 Damage"]]);
    expect(by("Potion of Healing")).toMatchObject({ cat: "potion", cost: "20gc", foundOn: ["POT1"] });
    expect(by("Longsword")).toMatchObject({ cat: "weapon" });
  });
  it("adds names from roll tables, merging repeats, and skips narrative finds and character sheets", () => {
    expect(by("Padded Tunic")).toMatchObject({ cat: "armour", foundOn: ["ART1"] });
    expect(all.filter((e) => e.name === "Jerkin")).toHaveLength(1);
    expect(all.some((e) => /box|my armour/i.test(e.name))).toBe(false);
  });
  it("filters by text, kind and book", () => {
    expect(filterItems(all, { ...noItemFilter(), text: "heal" }).map((e) => e.name)).toEqual(["Potion of Healing"]);
    expect(filterItems(all, { ...noItemFilter(), cat: "armour" }).map((e) => e.name)).toEqual(["Jerkin", "Padded Tunic"]);
    expect(filterItems(all, { ...noItemFilter(), book: "nope" })).toEqual([]);
    expect(itemCats(all)).toEqual(["weapon", "armour", "potion"]);
  });
  it("offers the entries of the asked kinds as picker choices, grouped and priced", () => {
    const ch = itemChoices(all, ["armour", "potion"]);
    expect(ch.map((c) => [c.name, c.group, c.meta])).toEqual([["Jerkin", "Armour", "9gc"], ["Padded Tunic", "Armour", ""], ["Potion of Healing", "Potions", "20gc"], ["Potion of Phasing", "Potions", ""]]);
    expect(itemChoices(all, ["gem"])).toEqual([]);
  });
});
