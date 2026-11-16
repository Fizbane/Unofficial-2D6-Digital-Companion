// The Void gameplay tutorial script: every rule link points at a real book section, and the scripted dice play
// the rooms it describes (checked against the generated library when it is built; skipped otherwise).
import { describe, expect, it } from "vitest";
import manifest from "../../public/data/manifest-void.json";
import { VOID_DICE, VOID_TUTORIAL } from "../../src/tutorial/void";
import { aliensIn, classifyRolled, exitCount } from "../../src/tools/void/hulkmodel";
import { entryCells, lookup } from "../../src/rolltable";
import { isCreatureTable } from "../../src/tools/common";
import type { Library, Table } from "../../src/types";

const built = import.meta.glob("../../public/data/library-void.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const libText = Object.values(built)[0] ?? "";

const ids = new Set((manifest as { sections: { id: string }[] }).sections.map((s) => s.id));

describe("Void tutorial script", () => {
  const steps = VOID_TUTORIAL.steps;
  it("links only to sections the book has", () => {
    for (const s of steps) for (const r of s.rules ?? []) expect(ids.has(r.section), `${s.id}: ${r.section}`).toBe(true);
  });
  it("links at least one rule on every step but the welcome", () => {
    for (const s of steps.slice(1)) expect(s.rules?.length ?? 0, s.id).toBeGreaterThan(0);
  });
  it("has unique step ids and plain-sentence bodies", () => {
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) for (const p of s.body) expect(p).not.toMatch(/[<>]/);
  });
  it("follows the Hulk page: exits before the room type, and the encounter is resolved before the room is finished", () => {
    const at = (id: string) => steps.findIndex((s) => s.id === id);
    expect(at("exits2")).toBeLessThan(at("type2")); // the book's order
    expect(at("exits3")).toBeLessThan(at("type3"));
    expect(at("resolve2")).toBeGreaterThan(at("followon2"));
    expect(at("finish2")).toBeGreaterThan(at("resolve2"));
    expect(steps[at("resolve2")].target).toBe('[data-act="enc-done"]');
    expect(steps[at("encounter3")].done).toBeTypeOf("function"); // Finish is blocked until the encounter is resolved
  });
  it("covers the survivor, the Hulk and three rooms, in order", () => {
    const at = (id: string) => steps.findIndex((s) => s.id === id);
    expect(at("create")).toBeLessThan(at("enter"));
    expect(at("finish1")).toBeLessThan(at("finish2"));
    expect(at("finish2")).toBeLessThan(at("finish3"));
    expect(steps[steps.length - 1].id).toBe("done");
  });
  it("scripts room sizes that make a standard room, then a small one", () => {
    const [a, b] = VOID_DICE.room2.size;
    const [c, d] = VOID_DICE.room3.size;
    expect(a).not.toBe(b);
    expect(classifyRolled(a, b, false)).toBe("regular");
    expect(classifyRolled(c, d, false)).toBe("small");
    expect(exitCount(VOID_DICE.room2.exits[0])).toBeGreaterThan(0);
    expect(exitCount(VOID_DICE.room3.exits[0])).toBeGreaterThan(0);
  });
});

(libText ? describe : describe.skip)("Void tutorial dice against the library", () => {
  const lib = libText ? (JSON.parse(libText) as Library) : ({ sections: [] } as unknown as Library);
  const table = (id: string): Table => {
    const b = lib.sections.find((s) => s.id === id)?.blocks.find((x) => x.type === "table");
    if (b?.type !== "table") throw new Error(`no table in ${id}`);
    return b.table;
  };
  const cardName = (t: Table) => String(t.rows.find((r) => /^NAME$/i.test(r[0] ?? ""))?.[1] ?? "");
  const names = [...new Set(lib.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "table" && isCreatureTable(b.table) ? [cardName(b.table)] : []))))].filter(Boolean);
  const text = (t: Table, value: number) => {
    const { rowIndex, half } = lookup(t, value);
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    return entryCells(t, rowIndex, half).cells.join(" ");
  };
  it("room 2 brings one fight, with the alien card the tutorial links, then a follow-on table", () => {
    const [p, s] = VOID_DICE.room2.type;
    const row = text(table("void/p98-1"), p * 10 + s);
    const found = aliensIn(row, names);
    expect(found).toHaveLength(1);
    expect(cardName(table("void/p192-1"))).toBe(found[0]);
    expect(row).toContain("IAUT1");
  });
  it("room 3 and the follow-on roll bring no fight", () => {
    const [a, b] = VOID_DICE.room3.type;
    expect(aliensIn(text(table("void/p97-1"), a + b), names)).toEqual([]);
    const [p, s] = VOID_DICE.followOn;
    expect(aliensIn(text(table("void/p93-1"), p * 10 + s), names)).toEqual([]);
  });
});
