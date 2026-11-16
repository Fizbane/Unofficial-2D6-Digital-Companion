// The 2D6 Dungeon tutorial against the free books it is played on: its rule links exist, and its scripted
// dice land on the rooms the steps describe.
import { describe, expect, it } from "vitest";
import { bestManoeuvreFaces, DUNGEON_DICE, DUNGEON_TUTORIAL, FIGHT_DICE } from "../src/tutorial/dungeon";
import { tutorialFor } from "../src/tutorial/run";
import { coachBody } from "../src/ui/coach";
import type { Library, Table } from "../src/types";

const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { readFileSync, existsSync } = await nodeMod("node:fs");
const { fileURLToPath } = await nodeMod("node:url");
const freePath = fileURLToPath(new URL("../public/data/free.json", import.meta.url));
const free: Library | null = existsSync(freePath) ? (JSON.parse(readFileSync(freePath, "utf8")) as Library) : null;

describe("Dungeon tutorial script", () => {
  it("is the Dungeon game's tutorial, and calls its character an adventurer", () => {
    expect(tutorialFor("dungeon")).toBe(DUNGEON_TUTORIAL);
    const last = String(coachBody(DUNGEON_TUTORIAL, DUNGEON_TUTORIAL.steps.length - 1));
    expect(last).toContain("Keep this adventurer");
    expect(last).not.toContain("survivor");
  });

  it("has unique step ids, and every step but the first and last happens on a tab", () => {
    const ids = DUNGEON_TUTORIAL.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DUNGEON_TUTORIAL.steps.slice(1).every((s) => !!s.route)).toBe(true);
  });

  it("follows the turn page: the room names its fight, the encounter is resolved, the door is checked on the way out", () => {
    const ids = DUNGEON_TUTORIAL.steps.map((s) => s.id);
    const at = (id: string) => ids.indexOf(id);
    expect(ids).not.toContain("fight-add"); // the Fight button queues the creature
    expect(DUNGEON_TUTORIAL.steps[at("encounter2")].target).toBe("[data-fight]");
    expect(at("resolve2")).toBeGreaterThan(at("followon2"));
    expect(at("finish2")).toBeGreaterThan(at("resolve2"));
    expect(at("door2")).toBeGreaterThan(at("finish2")); // doors are checked between rooms
    expect(at("size3")).toBeGreaterThan(at("door2"));
    expect(DUNGEON_TUTORIAL.steps[at("door2")].target).toBe('[data-door="check"]');
    expect(DUNGEON_TUTORIAL.steps[at("resolve2")].target).toBe('[data-act="enc-done"]');
    expect(DUNGEON_TUTORIAL.steps[at("followon2")].target).toBe('[data-follow^="HST1"]'); // tables are followed by code
    // no step points at a control the page no longer has
    const targets = DUNGEON_TUTORIAL.steps.map((s) => s.target ?? "").join(" ");
    expect(targets).not.toContain('data-act="fight"');
    expect(targets).not.toContain('data-door="Wooden"');
  });

  it("sizes: a 12-square entrance, a standard room 2 and a small room 3, none of them a corridor or a double", () => {
    const [ep, es] = DUNGEON_DICE.entrance;
    expect(ep * es).toBeLessThanOrEqual(12); // over 12 the entrance is halved
    expect(ep * es).toBeGreaterThanOrEqual(6); // under 6 it is redrawn
    const [a, b] = DUNGEON_DICE.room2.size;
    const [c, d] = DUNGEON_DICE.room3.size;
    for (const [p, s] of [[a, b], [c, d]]) {
      expect(p).not.toBe(s);
      expect(Math.min(p, s)).toBeGreaterThan(1);
    }
    expect(a * b).toBeGreaterThan(6);
    expect(a * b).toBeLessThan(32);
    expect(c * d).toBeLessThanOrEqual(6);
  });

  it("exits: both rooms get at least one (a D6 of 1 is a dead end), and the door doesn't lock", () => {
    expect(DUNGEON_DICE.room2.exits[0]).toBeGreaterThan(1);
    expect(DUNGEON_DICE.room3.exits[0]).toBeGreaterThan(1);
    expect(DUNGEON_DICE.door[0]).toBeLessThan(6); // a wooden door locks on a 6
  });

  it("the fight's attack roll lands on the strongest manoeuvre, away from interrupt faces", () => {
    const rows = [["SWING", "[4][3]", "D6 -1 damage"], ["SWOOP", "[1][2]", "D6 +2 damage"], ["LUNGE", "[2][6]", "2D6 damage"], ["", "", ""]];
    expect(bestManoeuvreFaces(rows)).toEqual([1, 2]); // the 2D6 one sits on a Secondary 6
    expect(bestManoeuvreFaces([["LUNGE", "[2][6]", "2D6 damage"]])).toEqual([2, 6]); // nothing else to choose
    expect(bestManoeuvreFaces([["", "", ""]])).toBeNull();
    expect(FIGHT_DICE.every((e) => e.keep)).toBe(true);
  });
});

(free ? describe : describe.skip)("Dungeon tutorial against the free books", () => {
  const lib = free!;
  const table = (id: string): Table => {
    const b = lib.sections.find((s) => s.id === id)?.blocks.find((x) => x.type === "table");
    if (b?.type !== "table") throw new Error(`no table in ${id}`);
    return b.table;
  };

  it("links only rules that are in the free books", () => {
    const ids = new Set(lib.sections.map((s) => s.id));
    const missing = DUNGEON_TUTORIAL.steps.flatMap((s) => s.rules ?? []).filter((r) => !ids.has(r.section)).map((r) => r.section);
    expect(missing).toEqual([]);
  });

  it("room 2 is one creature the tutorial names, wooden doors, and a follow-on table", () => {
    const [p, s] = DUNGEON_DICE.room2.type;
    const rooms = table("codex/level-1-rooms-human-ancestry-the-entry-part-1");
    const row = rooms.rows.find((r) => r[0] === `[${p}][${s}]`)!;
    const text = row.join(" ");
    expect(text).toContain("ARTISAN");
    expect(text).toContain("HST1");
    expect(text).toContain("WOODEN DOORS");
    // the creature has a card, and is weak enough to drop to one good hit
    const card = table("codex/artisan");
    expect(+String(card.rows.find((r) => r[0] === "HP")?.[1])).toBeLessThanOrEqual(5);
    // the follow-on is a D6 table, as the scripted die assumes
    expect(table("codex/hst1-herbs-t1").dice?.replace(/^1D/, "D")).toBe("D6");
  });

  it("room 3 is a small room that isn't unique", () => {
    const [p, s] = DUNGEON_DICE.room3.type;
    const small = table("codex/l1sr-level-1-small-rooms-6-squares-or-smaller");
    expect(small.dice).toBe("2D6");
    const row = small.rows.find((r) => r[0] === String(p + s))!;
    expect(row).toBeTruthy();
    expect(row[row.length - 1]).toBe("NO");
  });
});
