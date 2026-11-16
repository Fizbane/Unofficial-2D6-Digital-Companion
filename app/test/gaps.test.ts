// Lair maps, the companion model, class-aware level-up HP and the Lairs creature list.
import { describe, expect, it } from "vitest";
import { addLairRoom, addSecretExit, exitsForRoll, exploredFraction, LAIR_MAPS, lairRooms, newLairMap } from "../src/tools/lairmap";
import { openExits } from "../src/tools/dmap";
import { animals, attemptSucceeds, attemptXp, combatAbilities, companionReady, foeXp, parseModifier, temperaments, withAnimal } from "../src/tools/companionmodel";
import { applyXp, levelChangeText } from "../src/shell/charmodel";
import { groupVariants } from "../src/tools/lairsmodel";
import type { Section } from "../src/types";

describe("lair maps", () => {
  it("the mine has three 25x25 levels with a 5x5 shaft and a 5x5 entrance with three exits", () => {
    const m = newLairMap(LAIR_MAPS.mine, 1);
    expect([m.w, m.h]).toEqual([25, 25]);
    expect(m.rooms.find((r) => r.label === "Central shaft")).toMatchObject({ x: 10, y: 10, w: 5, h: 5 });
    expect(lairRooms(m)).toHaveLength(1);
    expect(lairRooms(m)[0]).toMatchObject({ w: 5, h: 5, kind: "entrance" });
    expect(openExits(m)).toHaveLength(3);
    expect(lairRooms(newLairMap(LAIR_MAPS.mine, 2))).toHaveLength(0); // lower levels start empty
  });
  it("the basins are 30x30 with a 2x2 entrance; caves and swamp are 25x25 and start empty", () => {
    const b = newLairMap(LAIR_MAPS.basins, 1);
    expect([b.w, lairRooms(b)[0].w, lairRooms(b)[0].h]).toEqual([30, 2, 2]);
    expect(lairRooms(newLairMap(LAIR_MAPS.caves, 1))).toHaveLength(0);
  });
  it("draws rooms through open exits, never over the shaft, and counts what is explored", () => {
    const m = newLairMap(LAIR_MAPS.mine, 1);
    for (let i = 0; i < 12; i++) addLairRoom(m, 4, 4, 2, `Room ${i + 2}`, [1, 3]);
    const cells = new Set<string>();
    for (const r of m.rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) {
      expect(cells.has(`${x},${y}`)).toBe(false); // no two rooms (or a room and the shaft) share a square
      cells.add(`${x},${y}`);
    }
    expect(lairRooms(m).length).toBeGreaterThan(3);
    const area = lairRooms(m).reduce((n, r) => n + r.w * r.h, 0);
    expect(exploredFraction(m)).toBeCloseTo(area / (625 - 25));
  });
  it("the first room of an empty level goes in from the entrance; a secret exit reopens a dead end", () => {
    const m = newLairMap(LAIR_MAPS.caves, 1);
    const r = addLairRoom(m, 3, 3, 0, "Room 1");
    expect(r).toMatchObject({ kind: "entrance", w: 3, h: 3 });
    expect(openExits(m)).toHaveLength(0);
    expect(addLairRoom(m, 3, 3, 1, "Room 2")).toBeNull(); // nowhere to go
    expect(addSecretExit(m)).toBe(true);
    expect(openExits(m)).toHaveLength(1);
    expect(addLairRoom(m, 3, 3, 1, "Room 2")).not.toBeNull();
  });
  it("maps the exits roll", () => expect([1, 2, 3, 4, 5, 6].map(exitsForRoll)).toEqual([0, 1, 1, 2, 2, 3]));
});

const table = (columns: string[], rows: string[][]) => ({ type: "table" as const, table: { columns, rows } });
const byId = new Map<string, Section>([["companions/p7-3", {
  id: "companions/p7-3", book: "companions", title: "x", level: 2, chapter: null, pages: [7],
  blocks: [
    table(["Roll 2D6", "Rare"], [["2 = Rare", "1 = Thing"]]),
    table(["Type", "Size", "Heft", "Stealth", "HP", "General Abilities", "Combat Abilities"], [["Fox", "Small", "3", "4", "6", "Awareness, Aura", "Bite"], ["Slouse", "Medium", "4", "2", "12", "Sumpter", "Charge, Bite"]]),
    table(["Roll", "Temperament", "Modifier", "Effect"], [["1", "Aggressive", "+2 HE -1 ST", "Attacks first."], ["2", "Wary", "+3 ST -1 HP", "Cowers."]]),
  ],
} as unknown as Section]]);

describe("companion model", () => {
  it("reads the animals and temperaments", () => {
    expect(animals(byId)).toEqual([
      { name: "Fox", size: "Small", heft: 3, stealth: 4, hp: 6, general: ["Awareness", "Aura"], combat: ["Bite"] },
      { name: "Slouse", size: "Medium", heft: 4, stealth: 2, hp: 12, general: ["Sumpter"], combat: ["Charge", "Bite"] },
    ]);
    expect(temperaments(byId).map((t) => [t.roll, t.name])).toEqual([[1, "Aggressive"], [2, "Wary"]]);
    expect(animals(new Map())).toEqual([]);
    expect(parseModifier("+3 ST -1 HP")).toEqual({ heft: 0, stealth: 3, hp: -1 });
  });
  it("fills the sheet from an animal, applies the temperament from the animal's own stats, keeps the name", () => {
    const [fox] = animals(byId), [, wary] = temperaments(byId);
    const k = withAnimal({ name: "Rex", xp: "4", a1name: "Awareness", a1desc: "mine" }, fox, wary);
    expect(k).toMatchObject({ name: "Rex", xp: "4", kind: "Fox", size: "Small", heft: "3", stealth: "7", hp: "5", baseHp: "5", a1name: "Awareness", a1type: "General", a1desc: "mine", a3name: "Bite", a3type: "Combat", a3level: "1" });
    expect(k.temperament).toBe("Wary (+3 ST -1 HP): Cowers.");
    // re-applying a different temperament starts from the animal's stats again, not the adjusted ones
    expect(withAnimal(k, fox, temperaments(byId)[0])).toMatchObject({ heft: "5", stealth: "3", hp: "6" });
    expect(combatAbilities(k)).toEqual([{ slot: 3, name: "Bite", level: 1 }]);
  });
  it("attempts, experience and the killing blow", () => {
    expect([attemptSucceeds(3, 2), attemptSucceeds(2, 2), attemptSucceeds(6, 6)]).toEqual([true, false, false]);
    expect([attemptXp(2, 2), attemptXp(2, 1)]).toEqual([1, 0]);
    expect([foeXp(5, true), foeXp(5, false)]).toEqual([2, 5]);
    expect([companionReady({ name: "Rex", hp: "3" }), companionReady({ name: "Rex", hp: "0" }), companionReady({ hp: "3" }), companionReady(undefined)]).toEqual([true, false, false, false]);
  });
});

describe("level-up HP follows the class's baseline", () => {
  const LV = (xp: number) => (xp >= 1500 ? 4 : xp >= 750 ? 3 : xp >= 200 ? 2 : 1);
  const BASE = (l: number) => [10, 20, 25, 35][l - 1];
  it("a constable gains the difference between baselines, and loses it again on a correction", () => {
    const c = { xp: 0, hp: 10, lastLevel: 1 };
    expect(applyXp(c, 800, LV, BASE)).toEqual({ from: 1, to: 3, hp: 15 });
    expect(c.hp).toBe(25);
    expect(levelChangeText(applyXp(c, 1500, LV, BASE), "Hardy")).toContain("+10 HP");
    expect(applyXp(c, 300, LV, BASE)).toEqual({ from: 4, to: 2, hp: 15 });
    expect(c.hp).toBe(20);
  });
  it("without a ladder it is 10 a level, as before", () => {
    const c = { xp: 0, hp: 10, lastLevel: 1 };
    expect(applyXp(c, 800, LV)).toEqual({ from: 1, to: 3, hp: 20 });
  });
});

describe("the Lairs creature list", () => {
  const card = (id: string, title: string, page: number): Section =>
    ({ id, book: "lairs", title, level: 2, chapter: null, pages: [page], blocks: [{ type: "table", table: { columns: ["Field", "Value"], rows: [["NAME", "x"]] } }] }) as unknown as Section;
  it("leaves out the Haunted House's creatures", () => {
    expect([...groupVariants([card("a", "WOLF (L2)", 32), card("b", "SPIRIT (L1)", 100)]).keys()]).toEqual(["WOLF"]);
  });
});
