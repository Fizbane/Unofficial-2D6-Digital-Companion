import { describe, expect, it } from "vitest";
import { alienFromTable, alienIndex } from "../src/tools/void/combatmodel";
import { isCreatureTable } from "../src/tools/common";
import type { Section, Table } from "../src/types";

// A card from a partly verified import: the NAME and LEVEL values and the interrupt text did not verify.
const table = (name: string, level: string): Table => ({
  title: "TEST CRAWLER",
  columns: ["Field", "Value"],
  rows: [
    ["NAME", name], ["LEVEL", level], ["HP", "9"], ["XP", "14"], ["SH", "+1"], ["CACHE", ""], ["INTERRUPT", ""], ["DEFLECTION", "4s"],
    ["MANOEUVRES", "[3][6] - TEST BITE = D6 -2"], ["RANGED WEAPON", "None"], ["DESCRIPTION", ""],
  ],
}) as Table;

describe("alien cards from a partly verified import", () => {
  it("takes the name from the table title and the level from the section title", () => {
    const t = table("", "");
    expect(isCreatureTable(t)).toBe(true);
    const a = alienFromTable(t, "void/test-crawler", "TEST CRAWLER (L2)");
    expect(a?.name).toBe("TEST CRAWLER");
    expect(a?.level).toBe(2);
    expect(a?.hp).toBe(9);
    expect(a?.man).toHaveLength(1);
    expect(a?.deflectionText).toBe("4s");
  });
  it("prefers the card's own cells when they verified", () => {
    const a = alienFromTable(table("OTHER NAME", "L3 {circled B}"), "void/x", "TEST CRAWLER (L2)");
    expect(a?.name).toBe("OTHER NAME");
    expect(a?.level).toBe(3);
    expect(a?.type).toBe("B");
  });
  it("lists the card in the index", () => {
    const s = { id: "void/test-crawler", book: "void", title: "TEST CRAWLER (L2)", level: 2, chapter: null, pages: [1], blocks: [{ type: "table", table: table("", "") }] } as unknown as Section;
    expect(alienIndex([s]).map((x) => `${x.name}|${x.level}`)).toEqual(["TEST CRAWLER|2"]);
  });
});
