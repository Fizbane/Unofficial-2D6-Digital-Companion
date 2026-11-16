import { describe, expect, it } from "vitest";
import { closestVariant, groupVariants, intimidation, lairById, LAIRS } from "../src/tools/lairsmodel";
import type { Section } from "../src/types";

const V = [{ level: 2 }, { level: 4 }, { level: 7 }, { level: 9 }];
describe("closestVariant", () => {
  it("picks the level closest to yours", () => {
    expect(closestVariant(V, 1, 1)?.level).toBe(2);
    expect(closestVariant(V, 4, 1)?.level).toBe(4);
    expect(closestVariant(V, 6, 1)?.level).toBe(7);
    expect(closestVariant(V, 10, 1)?.level).toBe(9);
  });
  it("on a tie takes the lower one at half HP or less, else the higher", () => {
    expect(closestVariant(V, 3, 0.5)?.level).toBe(2);
    expect(closestVariant(V, 3, 0.9)?.level).toBe(4);
    expect(closestVariant(V, 5.5, 0.4)?.level).toBe(4);
    expect(closestVariant(V, 8, 0.4)?.level).toBe(7);
  });
  it("no variants gives nothing", () => expect(closestVariant([], 3, 1)).toBeUndefined());
});
describe("intimidation", () => {
  it("is +1 per retreat, at most +3", () => {
    expect([0, 1, 2, 3, 4, 9, -1].map(intimidation)).toEqual([0, 1, 2, 3, 3, 3, 0]);
  });
});
describe("groupVariants", () => {
  const sec = (id: string, title: string, book = "lairs", field = true): Section =>
    ({ id, book, title, level: 2, chapter: null, pages: [1], blocks: [{ type: "table", table: { columns: [field ? "Field" : "Roll", "Value"], rows: [["NAME", "x"]] } }] }) as unknown as Section;
  it("groups 'NAME (Ln)' creature cards by name, sorted by level, from the Lairs book only", () => {
    const g = groupVariants([sec("a2", "FOX (L7)"), sec("a1", "FOX (L2)"), sec("b", "WOLF (L5)"), sec("c", "FOX (L4)", "core"), sec("d", "ROOMS (L1)", "lairs", false)]);
    expect([...g.keys()]).toEqual(["FOX", "WOLF"]);
    expect(g.get("FOX")!.map((v) => v.level)).toEqual([2, 7]);
  });
});
describe("lair definitions", () => {
  it("covers four lairs with unique ids and table sections, two per volume", () => {
    expect(LAIRS.map((l) => l.id)).toEqual(["caves", "swamp", "mine", "basins"]);
    expect(LAIRS.filter((l) => l.vol === 1)).toHaveLength(2);
    expect(lairById("swamp")?.flooded).toBe(true);
    expect(lairById("mine")?.finalCreature).toBeTruthy();
    expect(new Set(LAIRS.flatMap((l) => [l.rooms, l.large, l.small, l.incidents])).size).toBe(16);
  });
});
