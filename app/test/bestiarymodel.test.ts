import { describe, expect, it } from "vitest";
import type { Section, Table } from "../src/types";
import { beastEntries, filterBeasts, levelsOf, noFilter, typeLabel } from "../src/tools/bestiarymodel";

const card = (name: string, level: string, hp = "6"): Table => ({
  title: null, dice: null, columns: ["Field", "Value"],
  rows: [["NAME", name], ["LEVEL", level], ["HP", hp], ["XP", "9"]],
});
const sec = (id: string, book: string, tables: Table[]): Section => ({
  id, book, title: id, level: 2, chapter: null, pages: [1],
  blocks: [{ type: "para", text: "x", page: 1 }, ...tables.map((table) => ({ type: "table" as const, table, page: 3 }))],
});

describe("bestiary model", () => {
  const all = beastEntries([
    sec("a", "void", [card("OCTAPHEX", "L2 {circled B}"), card("ACID DROOLER", "L1 {circled B}")]),
    sec("b", "void", [card("BUZZSAW DRONE", "L1 {circled R}"), { title: "Rolls", dice: "2D6", columns: ["Roll", "Result"], rows: [["2", "x"]] }]),
  ]);
  it("lists only creature cards, with level, type and title-cased name", () => {
    expect(all.map((e) => e.name)).toEqual(["Octaphex", "Acid Drooler", "Buzzsaw Drone"]);
    expect(all[0]).toMatchObject({ level: 2, type: "B", hp: 6, xp: 9, idx: 1, page: 3 });
  });
  it("filters by text, level and type, sorted by level then name", () => {
    expect(filterBeasts(all, noFilter()).map((e) => e.name)).toEqual(["Acid Drooler", "Buzzsaw Drone", "Octaphex"]);
    expect(filterBeasts(all, { ...noFilter(), text: "drone" }).map((e) => e.name)).toEqual(["Buzzsaw Drone"]);
    expect(filterBeasts(all, { ...noFilter(), level: 1, type: "B" }).map((e) => e.name)).toEqual(["Acid Drooler"]);
    expect(levelsOf(all)).toEqual([1, 2]);
  });
  it("keeps a Codex card visible when its level was unreadable", () => {
    expect(beastEntries([sec("codex/example", "codex", [card("EXAMPLE", "")])])).toMatchObject([{ name: "Example", level: 0 }]);
  });
  it("treats malformed Codex levels and experience as unknown", () => {
    const t = card("EXAMPLE", "L770]");
    t.rows[3][1] = "1850] OCR spill";
    expect(beastEntries([sec("codex/example", "codex", [t])])).toMatchObject([{ level: 0, xp: null }]);
  });
  it("names types per game", () => {
    expect(typeLabel("R", "void")).toBe("Robotic");
    expect(typeLabel("H", "dungeon")).toBe("Humanoid");
    expect(typeLabel("", "void")).toBe("");
  });
});
