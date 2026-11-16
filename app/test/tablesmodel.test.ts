import { describe, expect, it } from "vitest";
import type { Section, Table } from "../src/types";
import { isItemCatalogTable, itemEntries } from "../src/tools/itemsmodel";
import { filterTables, groupTables, noTableFilter, sortTables, levelOfTable, tableBooks, tableDice, tableEntries, tableLevels, typeOfTable } from "../src/tools/tablesmodel";

const tbl = (title: string | null, dice: string | null, rows: string[][], code?: string, extra: Partial<Table> = {}): Table => ({ title, code: code ?? null, dice, columns: ["ROLL", "RESULT"], rows, ...extra });
const sec = (id: string, book: string, title: string, tables: Table[]): Section => ({
  id, book, title, level: 2, chapter: null, pages: [1], blocks: tables.map((table) => ({ type: "table" as const, table, page: 7 })),
});
const roll6 = [["1", "Dust"], ["2", "Bones"], ["3", "A rusty key"], ["4", "Rats"], ["5", "Coins"], ["6", "A trap"]];
const sections = [
  sec("a", "core", "Treasure", [tbl("HIDDEN TREASURE", "d20", roll6, "HST1"), tbl("Prices", null, [["Sword", "9gc"]])]),
  sec("b", "codex", "Monsters", [tbl("Wandering monsters", "2d6", roll6, "WMT2"), tbl("Wandering monsters", null, [["x", "y"]], undefined, { continued: true }), tbl("Empty", "d6", [])]),
  sec("c", "codex", "Names", [tbl(null, "d6", roll6)]),
];
const all = tableEntries(sections);
const names = (l: typeof all) => l.map((e) => e.title);

describe("tables model", () => {
  it("lists only tables with a dice roll, skips continued and empty ones, falls back to the section title", () => {
    expect(names(all)).toEqual(["HIDDEN TREASURE", "Wandering monsters", "Names"]); // "Prices" has no dice
    expect(all[0]).toMatchObject({ code: "HST1", dice: "D20", rows: 6, book: "core", chapter: "Treasure", page: 7, rollable: true });
    expect(new Set(all.map((e) => e.key)).size).toBe(all.length);
  });
  it("lists a table printed twice once, but keeps same-titled tables whose rows differ", () => {
    const twice = [
      sec("p59", "core", "Dungeon", [tbl("Number of Exits", "d6", roll6)]),
      sec("p60", "core", "Dungeon", [tbl("Number of  Exits", "d6", roll6)]),
      sec("p61", "codex", "Dungeon", [tbl("Number of Exits", "d6", roll6)]),
      sec("p62", "core", "Dungeon", [tbl("Number of Exits", "d6", [...roll6.slice(0, 5), ["6", "Nothing"]])]),
    ];
    expect(tableEntries(twice).map((e) => e.sectionId)).toEqual(["p59", "p61", "p62"]);
  });
  it("reads a table's kind from its title", () => {
    const kind: Record<string, string> = {
      "BT2 - BAG TABLE 2": "Bags and containers", "CT1 - CHEST TABLE 1": "Bags and containers", "RPT1 - RELIGIOUS POUCH TABLE 1": "Bags and containers",
      "ART3 - ARMOUR - RANDOM T3": "Armour", "ENAT1 - ENCHANTED ARMOUR TABLE 1": "Armour", "POT2 - POTIONS T2": "Potions", "SCT1 - SCROLLS T1": "Scrolls and spells",
      "GMT1 - GEM T1": "Gems", "GCT1 - GEM COMBINATION TABLE 1": "Gems", "L1D - LEVEL 1 DOGS": "Encounters", "L1R - LEVEL 1 RELIGIOUS ENEMY": "Encounters",
      "L1LR - LEVEL 1 LARGE ROOMS (32 SQUARES OR LARGER)": "Rooms, doors and exits", "Number of Exits": "Rooms, doors and exits", "Lock Result": "Rooms, doors and exits",
      "GOT1 - GOD T1": "Gods and religion", "Your Legendary Reward": "Treasure and items", "Tavern Exploits Table": "Events and rules", "SST1 - SYMBOL SELECTION T1": "Other",
    };
    for (const [title, want] of Object.entries(kind)) expect(typeOfTable(title), title).toBe(want);
  });
  it("groups by kind, then name with numbers in order, or leaves the books' order", () => {
    const mk = (title: string) => tableEntries([sec(title, "core", "Ch", [tbl(title, "d6", roll6)])])[0];
    const list = ["Zebra table", "BT10 - BAG TABLE 10", "ART1 - ARMOUR - RANDOM T1", "BT2 - BAG TABLE 2", "Number of Exits"].map(mk);
    expect(groupTables(list, "type").map((e) => e.title)).toEqual(["Number of Exits", "ART1 - ARMOUR - RANDOM T1", "BT2 - BAG TABLE 2", "BT10 - BAG TABLE 10", "Zebra table"]);
    expect(groupTables(list, "book")).toBe(list);
  });
  it("reads a table's level from its title or code", () => {
    expect(levelOfTable("L1A - LEVEL 1 ANIMALS", "L1A")).toBe(1);
    expect(levelOfTable("LEVEL 2 ROOMS - HUMAN ANCESTRY - THE ENTRY")).toBe(2);
    expect(levelOfTable("L3LR - Large rooms", "L3LR")).toBe(3);
    expect(levelOfTable("Level 10 Guards")).toBe(10);
    expect(levelOfTable("BT1 - BAG TABLE 1", "BT1")).toBeNull();
    expect(levelOfTable("Entry level thieves")).toBeNull(); // "level" with no number after it
    expect(levelOfTable("POT2 - POTIONS T2", "POT2")).toBeNull(); // T2 is a tier, not a level
  });
  it("filters by level and lists the levels, lowest first", () => {
    const lv = tableEntries([sec("l", "core", "Ch", [tbl("Level 2 Dogs", "d6", roll6), tbl("Level 1 Dogs", "d6", roll6), tbl("Bags", "d6", roll6)])]);
    expect(tableLevels(lv)).toEqual([1, 2]);
    expect(filterTables(lv, { ...noTableFilter(), level: 2 }).map((e) => e.title)).toEqual(["Level 2 Dogs"]);
    expect(filterTables(lv, noTableFilter())).toHaveLength(3);
  });
  it("lists books and dice, smallest dice first", () => {
    expect(tableBooks(all)).toEqual(["core", "codex"]);
    expect(tableDice(all)).toEqual(["D6", "D20", "2D6"]);
  });
  it("filters by every word of the search, in titles, codes and rows", () => {
    expect(filterTables(all, { ...noTableFilter(), text: "rusty key" })).toHaveLength(3);
    expect(names(filterTables(all, { ...noTableFilter(), text: "wmt2" }))).toEqual(["Wandering monsters"]);
    expect(filterTables(all, { ...noTableFilter(), text: "sword" })).toEqual([]); // the unrolled Prices table is not listed
    expect(filterTables(all, { ...noTableFilter(), text: "zzz" })).toEqual([]);
  });
  it("filters by book, dice and starred together", () => {
    expect(names(filterTables(all, { ...noTableFilter(), book: "codex" }))).toEqual(["Wandering monsters", "Names"]);
    expect(names(filterTables(all, { ...noTableFilter(), dice: "D6" }))).toEqual(["Names"]);
    expect(names(filterTables(all, { ...noTableFilter(), starred: true }, new Set([all[1].key])))).toEqual(["Wandering monsters"]);
  });
  it("sorts by a column, both ways, with blanks last and ties in book order", () => {
    expect(names(sortTables(all, "title"))).toEqual(["HIDDEN TREASURE", "Names", "Wandering monsters"]);
    expect(names(sortTables(all, "dice"))).toEqual(["Names", "HIDDEN TREASURE", "Wandering monsters"]);
    expect(names(sortTables(all, "dice", -1))).toEqual(["Wandering monsters", "HIDDEN TREASURE", "Names"]);
    expect(names(sortTables(all, "code"))).toEqual(["HIDDEN TREASURE", "Wandering monsters", "Names"]); // no code: last
    expect(names(sortTables(all, "code", -1))).toEqual(["Wandering monsters", "HIDDEN TREASURE", "Names"]);
    expect(names(all)).toEqual(["HIDDEN TREASURE", "Wandering monsters", "Names"]); // input untouched
  });

  describe("leaves out what the Bestiary and Items pages already show", () => {
    const card = tbl("Creature Card - VETERAN (L1)", null, [["NAME", "Veteran"], ["HP", "12"], ["Level", "1"]]);
    card.columns = ["Field", "Value"];
    const armour = tbl("ARMOUR TABLE 1", null, [["JERKIN", "[4]", "-1 Damage", "9gc"]]);
    armour.columns = ["ARMOUR TYPE", "DICE SET", "MODIFIER", "COST"];
    const potions = tbl("MAGIC POTIONS TABLE 1", null, [["HEALING", "+10 HP", "20gc"]]);
    potions.columns = ["POTION OF", "EFFECT", "COST"];
    const prices = tbl("Gear prices", null, [["Rope", "1gc"]]);
    prices.columns = ["ITEM", "COST"];
    const manoeuvres = tbl("WEAPON MANOEUVRES TABLE 1", null, [["Level 1", "[1][2]", "THRUST"]]);
    manoeuvres.columns = ["Level", "Dice", "WEAPON: LONGSWORD"];
    const itemRoll = tbl("ART1 - ARMOUR - RANDOM T1", "d6", [["1", "JERKIN"], ["2", "JERKIN"], ["3", "PADDED TUNIC"], ["4", "JERKIN"]], "ART1");
    const sheet = tbl("CHARACTER SHEET - ARMOUR PIECE", null, [["MY ARMOUR", "[1]"]]);
    sheet.columns = ["ARMOUR PIECE", "DICE SET"];
    const keep = tbl("Wandering monsters", "2d6", roll6, "WMT2");
    const s = [sec("x", "core", "Mixed", [card, armour, potions, prices, manoeuvres, itemRoll, sheet, keep])];

    it("drops creature cards, item catalogs and the unrolled, keeps item roll tables and the rest", () => {
      expect(names(tableEntries(s))).toEqual(["ART1 - ARMOUR - RANDOM T1", "Wandering monsters"]);
    });
    it("drops a catalog or card even when it carries a dice formula", () => {
      const rolled = [card, armour, potions, prices, manoeuvres].map((t) => ({ ...t, dice: "d6", rows: [...t.rows, ...t.rows, ...t.rows] }));
      expect(tableEntries([sec("z", "core", "Z", rolled)])).toEqual([]);
    });
    it("agrees with the Items page: a table is a catalog exactly when Items reads entries from it", () => {
      for (const t of [armour, potions, prices, manoeuvres, sheet, itemRoll]) {
        const reads = itemEntries([sec("y", "core", "y", [t])]).length > 0;
        const catalog = isItemCatalogTable(t);
        // a roll table also gives Items names, but it is not a catalog and stays on Tables
        expect(catalog, t.title!).toBe(t === itemRoll ? false : reads);
      }
    });
  });
});
