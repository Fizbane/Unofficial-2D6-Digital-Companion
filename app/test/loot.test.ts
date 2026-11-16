import { describe, it, expect } from "vitest";
import { addFind, afterFight, noteFind, readFind, type Pack } from "../src/tools/loot";

const pack = (o: Partial<Pack> = {}): Pack => ({ gc: 0, sc: 0, cc: 0, potions: [["Potion of Healing", "Heals"], ["", ""], ["", ""], ["", ""], ["", ""]], small: "Flint and steel", treasure: "", ...o });

describe("readFind", () => {
  it("reads nothing as nothing", () => {
    expect(readFind("Nothing. The pouch is empty.")).toMatchObject({ nothing: true, coins: [], potions: [], note: "" });
    expect(readFind("None")).toMatchObject({ nothing: true });
    expect(readFind("")).toMatchObject({ nothing: true });
  });
  it("reads coins: dice, dice with a bonus, and flat amounts", () => {
    expect(readFind("There are D6 SC inside the pouch.").coins).toEqual([{ dice: "D6", flat: 0, coin: "sc", label: "D6 SC" }]);
    expect(readFind("A few coins rattle in the pouch. Gain 4D6 CC and 2D6 SC.").coins).toEqual([
      { dice: "4D6", flat: 0, coin: "cc", label: "4D6 CC" }, { dice: "2D6", flat: 0, coin: "sc", label: "2D6 SC" }]);
    expect(readFind("Gain D6+2 SC and D6 GC.").coins).toEqual([
      { dice: "D6", flat: 2, coin: "sc", label: "D6+2 SC" }, { dice: "D6", flat: 0, coin: "gc", label: "D6 GC" }]);
    expect(readFind("You find 10 GC.").coins).toEqual([{ dice: "", flat: 10, coin: "gc", label: "10 GC" }]);
  });
  it("reads potions by name", () => {
    expect(readFind("Nestled inside the pouch is a Potion of Constancy.").potions).toEqual(["Potion of Constancy"]);
    expect(readFind("POTION OF SHIELD AURA").potions).toEqual(["Potion of Shield Aura"]);
  });
  it("anything else is a find to note down, with valuables marked as treasure", () => {
    expect(readFind("There are some Malako Leaves inside.")).toMatchObject({ nothing: false, note: "There are some Malako Leaves inside.", valuable: false });
    expect(readFind("Inside is a small wooden symbol embedded with 3 LQ pearls.")).toMatchObject({ valuable: true });
    expect(readFind("AN IRON BAR")).toMatchObject({ note: "AN IRON BAR", valuable: false });
  });
});

describe("addFind", () => {
  it("adds coins by the amounts rolled, and says what it added", () => {
    const c = pack({ sc: 3 });
    expect(addFind(c, readFind("Gain D6+2 SC and D6 GC."), [6, 4])).toEqual(["+6 SC", "+4 GC"]);
    expect([c.gc, c.sc, c.cc]).toEqual([4, 9, 0]);
  });
  it("puts a potion in the first free potion row", () => {
    const c = pack();
    expect(addFind(c, readFind("a Potion of Constancy."), [])).toEqual(["Potion of Constancy, with your potions"]);
    expect(c.potions[1]).toEqual(["Potion of Constancy", ""]);
  });
  it("with five potions already, the sixth goes in small items and says so", () => {
    const c = pack({ potions: Array.from({ length: 5 }, (_, i) => [`P${i}`, ""]) });
    expect(addFind(c, readFind("a Potion of Constancy."), [])[0]).toMatch(/no room/);
    expect(c.small).toContain("Potion of Constancy");
    expect(c.potions.every((r) => r[0].startsWith("P"))).toBe(true);
  });
  it("notes other finds under small items, valuables under treasure, each on its own line", () => {
    const c = pack();
    addFind(c, readFind("There are some Malako Leaves inside."), []);
    addFind(c, readFind("Inside is a small wooden symbol embedded with 3 LQ pearls."), []);
    expect(c.small).toBe("Flint and steel\nMalako Leaves");
    expect(c.treasure).toBe("Inside is a small wooden symbol embedded with 3 LQ pearls.");
  });
  it("adds nothing for nothing", () => {
    const c = pack();
    expect(addFind(c, readFind("Nothing. The pouch is empty."), [])).toEqual([]);
    expect(c).toEqual(pack());
  });
  it("a sheet from an old save with odd fields doesn't break", () => {
    const c = { gc: undefined, sc: "x", cc: 1, potions: null, small: undefined, treasure: undefined } as unknown as Pack;
    addFind(c, readFind("Gain D6 GC. a Potion of Healing"), [3]);
    expect(c.gc).toBe(3);
    expect(c.small).toContain("Potion of Healing");
  });
});

describe("afterFight", () => {
  const tables = (text: string) => [...text.matchAll(/\b([A-Z]{2,5}\d)\b(?:\s*([+-]\s?\d+)(?!\s*(?:GC|SC|CC)))?/g)].map((m) => ({ code: m[1], modifier: m[2] ? parseInt(m[2].replace(/\s/g, ""), 10) : 0, locked: m[1] === "ENT2" }));
  const foe = (id: number, name: string, treasure: string) => ({ id, name, treasure });
  it("lists XP first, then each foe's treasure rolls and extra coins, in order", () => {
    const s = afterFight([foe(1, "ARTISAN", "Roll on PT1 -2 + 2D6 SC"), foe(2, "RAT", "None")], tables, false, {});
    expect(s.map((x) => [x.kind, x.key, x.label, x.done])).toEqual([
      ["xp", "xp", "Add the XP to your sheet", false],
      ["table", "1:t:PT1", "Roll PT1 -2", false],
      ["coins", "1:c", "Roll 2D6 SC", false],
    ]);
  });
  it("a treasure that is a thing, not a table, is added as it is", () => {
    const s = afterFight([foe(3, "BAT", "D3 Geist Mushrooms.")], tables, true, {});
    expect(s.map((x) => [x.kind, x.key, x.done])).toEqual([["xp", "xp", true], ["item", "3:i", false]]);
  });
  it("marks what is done, and knows the next step and when all is done", () => {
    const foes = [foe(1, "ARTISAN", "Roll on PT1 -2 + 2D6 SC")];
    const some = afterFight(foes, tables, true, { "1:t:PT1": { text: "Nothing.", added: [] } });
    expect(some.find((x) => !x.done)?.key).toBe("1:c");
    const all = afterFight(foes, tables, true, { "1:t:PT1": { text: "", added: [] }, "1:c": { text: "", added: ["+7 SC"] } });
    expect(all.every((x) => x.done)).toBe(true);
  });
  it("a locked table is flagged, and two foes with the same table each get their own roll", () => {
    const s = afterFight([foe(1, "A", "Roll on ENT2"), foe(2, "B", "Roll on PT1"), foe(3, "C", "Roll on PT1")], tables, true, {});
    expect(s.filter((x) => x.kind === "table").map((x) => [x.key, !!x.locked])).toEqual([["1:t:ENT2", true], ["2:t:PT1", false], ["3:t:PT1", false]]);
  });
  it("a thing the card gives beside its table roll gets its own step", () => {
    const s = afterFight([foe(1, "DRONE", "Roll on PBST1 and a spool of copper wire")], tables, true, {});
    expect(s.map((x) => [x.kind, x.key, x.text ?? ""])).toEqual([["xp", "xp", ""], ["table", "1:t:PBST1", ""], ["item", "1:i", "a spool of copper wire"]]);
  });
  it("two tables joined by 'and' leave nothing over", () => {
    expect(afterFight([foe(1, "SMITH", "Roll on MIT1 and PT1")], tables, true, {}).map((x) => x.kind)).toEqual(["xp", "table", "table"]);
    expect(afterFight([foe(1, "G", "Roll on PT1 +1 {highlighted in red}")], tables, true, {}).map((x) => x.kind)).toEqual(["xp", "table"]);
  });
  it("a fight with no treasure has only the XP step", () => {
    expect(afterFight([foe(1, "RAT", "None"), foe(2, "X", "")], tables, false, {}).map((x) => x.kind)).toEqual(["xp"]);
  });
});

describe("noteFind", () => {
  it("writes a find as its own line under small items, and says so", () => {
    const c = { small: "Torch" };
    expect(noteFind(c, "You salvage some copper coils that are bent but fine.")).toEqual(["Added to small items: Copper coils"]);
    expect(c.small).toBe("Torch\nCopper coils");
  });
  it("splits a list of finds into items with quantities", () => {
    const c = { small: "" };
    noteFind(c, "a coil of wire and two spanners");
    expect(c.small).toBe("Coil of wire\nSpanners ×2");
  });
  it("keeps a description that isn't a list as one line", () => {
    const c = { small: "" };
    noteFind(c, "A strange device. It hums when you hold it near metal.");
    expect(c.small).toBe("A strange device. It hums when you hold it near metal.");
  });
  it("adds nothing for nothing, and copes with a sheet that has no small items yet", () => {
    const c = { small: undefined as unknown as string };
    expect(noteFind(c, "None")).toEqual([]);
    expect(noteFind(c, "  ")).toEqual([]);
    noteFind(c, "A magnet.");
    expect(c.small).toBe("Magnet");
  });
});
