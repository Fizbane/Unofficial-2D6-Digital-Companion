import { describe, it, expect } from "vitest";

import { indexTables, rollableByCode, type TableRoll } from "../src/rolltable";
import type { Section, Table } from "../src/types";
import { ResultStore, cardFromDice, cardFromTableRoll, isResultsState, type ResultCard } from "../src/shell/resultstore";

function section(id: string, title: string, table: Table): Section {
  return { id, book: "core", title, level: 2, chapter: null, pages: [1], blocks: [{ type: "table", table, page: 1 }] };
}

const encounter: Table = {
  title: "Encounter", code: "ENAT1", dice: "2D6", columns: ["2D6", "Result", "Notes"],
  rows: [["2-8", "Nothing", "Move on"], ["9", "Goblin pack", "Roll on HST1 -1"], ["10-12", "Treasure", ""]],
};
const hoard: Table = {
  title: "Hoard", code: "HST1", dice: "1D6", columns: ["1D6", "Item"],
  rows: [["1-3", "Coins"], ["4-6", "Gem"]],
};
indexTables([section("enat1", "Encounters", encounter), section("hst1", "Hoards", hoard)]);
const enat1 = rollableByCode("ENAT1")!;

function tableRoll(over: Partial<TableRoll>): TableRoll {
  return {
    ref: enat1, roll: { label: "2D6", dice: [4, 5], value: 9, text: "4 + 5 = 9" },
    modifier: 0, value: 9, clamped: false, rowIndex: 1, cells: ["9", "Goblin", "Roll on HST1 -1"], half: 0, ...over,
  };
}

const plain = (n: number) => ({ eyebrow: "D6", title: String(n), text: "", dice: `D6: ${n}`, follow: [] });

describe("cardFromTableRoll", () => {
  it("builds eyebrow, title, text, dice and follow-ons", () => {
    const c = cardFromTableRoll(tableRoll({ modifier: -1, value: 8 }), "Room 3");
    expect(c.eyebrow).toBe("ENAT1 · Encounter");
    expect(c.title).toBe("Goblin");
    expect(c.text).toBe("Roll on HST1 -1");
    expect(c.dice).toBe("2D6: 4 + 5 = 9 -1 → 8");
    expect(c.sectionId).toBe("enat1");
    expect(c.context).toBe("Room 3");
    expect(c.follow).toEqual([{ key: "HST1", modifier: -1, label: "HST1 -1" }]);
  });

  it("uses the result cell as title and leaves text empty for a two-column row", () => {
    const c = cardFromTableRoll(tableRoll({ value: 4, rowIndex: 0, cells: ["4", "Nothing"] }));
    expect(c.title).toBe("Nothing");
    expect(c.text).toBe("");
  });

  it("notes clamping and omits the suffix with no modifier", () => {
    expect(cardFromTableRoll(tableRoll({ modifier: 5, value: 12, clamped: true })).dice).toBe("2D6: 4 + 5 = 9 +5 (clamped) → 12");
    expect(cardFromTableRoll(tableRoll({})).dice).toBe("2D6: 4 + 5 = 9");
  });

  it("gives the no-row text and no follow-ons when nothing matches", () => {
    const c = cardFromTableRoll(tableRoll({ value: 13, modifier: 4, rowIndex: -1, cells: [] }));
    expect(c.text).toBe("No row for 13 on this table.");
    expect(c.title).toBe("No match");
    expect(c.follow).toEqual([]);
  });

  it("doesn't repeat the code when the title already starts with it", () => {
    const ref = { ...enat1, title: "ENAT1 - Encounters" };
    expect(cardFromTableRoll(tableRoll({ ref })).eyebrow).toBe("ENAT1 - Encounters");
    expect(cardFromTableRoll(tableRoll({ ref: { ...enat1, title: "enat1 Encounters" } })).eyebrow).toBe("enat1 Encounters");
  });

  it("uses the table title alone when there is no code", () => {
    const ref = { ...enat1, table: { ...encounter, code: null } };
    expect(cardFromTableRoll(tableRoll({ ref })).eyebrow).toBe("Encounter");
  });
});

describe("cardFromDice", () => {
  it("uses the die label and total", () => {
    const c = cardFromDice({ label: "D66", dice: [3, 5], value: 35, text: "35" });
    expect(c.eyebrow).toBe("D66");
    expect(c.title).toBe("35");
    expect(c.dice).toBe("D66: 35");
    expect(c.follow).toEqual([]);
  });
});

describe("ResultStore", () => {
  it("keeps children out of top and lists them oldest first", () => {
    const s = new ResultStore();
    const p = s.add(plain(1), undefined, 100);
    const a = s.add(plain(2), p.id, 200);
    const b = s.add(plain(3), p.id, 300);
    const q = s.add(plain(4));
    expect(s.top().map((c) => c.id)).toEqual([q.id, p.id]);
    expect(s.children(p.id).map((c) => c.id)).toEqual([a.id, b.id]);
    expect(a.parent).toBe(p.id);
    expect(p.at).toBe(100);
  });

  it("caps at 100 cards, dropping the oldest", () => {
    const s = new ResultStore();
    const first = s.add(plain(0));
    for (let i = 1; i <= 100; i++) s.add(plain(i));
    expect(s.state.cards).toHaveLength(100);
    expect(s.state.cards.some((c) => c.id === first.id)).toBe(false);
  });

  it("drops a capped top-level card together with its children", () => {
    const s = new ResultStore();
    const p = s.add(plain(0));
    s.add(plain(1), p.id);
    s.add(plain(2), p.id);
    for (let i = 3; i <= 100; i++) s.add(plain(i));
    expect(s.state.cards).toHaveLength(98);
    expect(s.state.cards.some((c) => c.id === p.id || c.parent === p.id)).toBe(false);
  });

  it("at the cap, a follow-on on the oldest card keeps it and evicts the next-oldest root", () => {
    const s = new ResultStore();
    const oldest = s.add(plain(0));
    const next = s.add(plain(1));
    for (let i = 2; i < 100; i++) s.add(plain(i));
    expect(s.state.cards).toHaveLength(100);
    const f = s.add(plain(100), oldest.id);
    expect(s.state.cards).toHaveLength(100);
    expect(s.state.cards.some((c) => c.id === f.id)).toBe(true);
    expect(s.state.cards.some((c) => c.id === oldest.id)).toBe(true);
    expect(s.state.cards.some((c) => c.id === next.id)).toBe(false);
  });

  it("continues ids past the highest restored id", () => {
    const card = (id: string): ResultCard => ({ id, at: 1, ...plain(1) });
    const s = new ResultStore({ v: 1, cards: [card("c7"), card("c3")] });
    expect(s.add(plain(2)).id).toBe("c8");
  });

  it("clears cards; last starts null", () => {
    const s = new ResultStore();
    expect(s.last).toBeNull();
    s.add(plain(1));
    s.clear();
    expect(s.top()).toEqual([]);
  });
});

describe("isResultsState", () => {
  it("accepts valid and rejects malformed state", () => {
    expect(isResultsState({ v: 1, cards: [] })).toBe(true);
    expect(isResultsState({ v: 1, cards: [{ id: "c1", at: 1, ...plain(1) }] })).toBe(true);
    expect(isResultsState({ v: 2, cards: [] })).toBe(false);
    expect(isResultsState({ v: 1, cards: [{ id: "c1", at: "x", ...plain(1) }] })).toBe(false);
    expect(isResultsState({ v: 1, cards: [{ id: "c1", at: 1, eyebrow: "", title: "", text: "", dice: "" }] })).toBe(false);
    expect(isResultsState(null)).toBe(false);
  });
});
