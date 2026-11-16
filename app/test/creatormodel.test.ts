import { describe, expect, it } from "vitest";
import {
  armourOptions, averageDamage, blankDraft, buildCharacter, parseManoeuvre, problems, randomDraft, scrollOptions,
  toggleManoeuvre, weaponManoeuvres, withWeapon,
} from "../src/tools/creatormodel";
import type { Section } from "../src/types";

const table = (id: string, columns: string[], rows: string[][]): [string, Section] =>
  [id, { id, book: "codex", title: id, level: 2, chapter: null, pages: [1], blocks: [{ type: "table", table: { columns, rows } }] } as unknown as Section];
const byId = new Map<string, Section>([
  table("codex/weapon-manoeuvres-table-1", ["Manoeuvre Level", "Dice", "WEAPON: LONGSWORD", "WEAPON: GREATAXE", "WEAPON: HEAVY MACE"], [
    ["Level 1 Manoeuvres", "[1][2]", "[1][2] - SWOOP = D6 +2 damage", "[1][2] - CHARGE = D6 +3 damage", "[1][2] - BELT = D6 +2 damage"],
    ["Level 1 Manoeuvres", "[5][2]", "[5][2] - CUT = D6 +1 damage", "[5][2] - SWISH = D6 +1 damage", "[5][2] - THUMP = D6 +1 damage"],
    ["Level 1 Manoeuvres", "[3][2]", "[3][2] - THRUST = D6 damage", "[3][2] - HACK = D6 damage", "[3][2] - HIT = D6 +1 damage"],
    ["Level 2 Manoeuvres", "[1][2]", "[1][2] - SUNDER = D6 +6 damage", "[1][2] - A = D6 +6 damage", "[1][2] - B = D6 +6 damage"],
  ]),
  table("codex/starting-armour-table-1", ["ARMOUR TYPE", "DICE SET", "MODIFIER"], [["JERKIN", "[4]", "-1 Damage"], ["PADDED TUNIC", "[5]", "-1 Damage"]]),
  table("codex/starting-scroll-table-1", ["SCROLL TYPE", "MODIFIER"], [["SCROLL OF BALANCE", "+1 Discipline"], ["SCROLL OF MENTAL WHIP", "1 strike"]]),
  table("codex/magic-scroll-table-1", ["SCROLL OF", "EFFECT DESCRIPTION", "DURATION", "ORBIT", "DISPEL Ds", "COST", "FAIL", "MODIFIER/EFFECT"], [
    ["BALANCE", "Stable.", "UNTIL USED", "FACULTY", "NONE", "15gc", "+1", "+1 DISCIPLINE FOR 1 DUNGEON LEVEL"],
  ]),
]);
const full = () => ({ ...blankDraft(), name: " Vel ", weapon: "Longsword", manoeuvres: ["SWOOP", "THRUST"], armour: "Padded Tunic", scroll: "Balance" });

describe("options from the tables", () => {
  it("parses manoeuvres and their damage", () => {
    expect(parseManoeuvre(1, "[1][2] - SWOOP = D6 +2 damage")).toEqual({ level: 1, dice: "[1][2]", name: "SWOOP", damage: "D6 +2 damage" });
    expect(parseManoeuvre(1, "junk")).toBeUndefined();
    expect(weaponManoeuvres(byId, "Greataxe").map((m) => m.name)).toEqual(["CHARGE", "SWISH", "HACK", "A"]);
    expect(weaponManoeuvres(byId, "Spoon")).toEqual([]);
    expect([averageDamage("D6 +2 damage"), averageDamage("D6 damage"), averageDamage("2D6 +9 damage"), averageDamage("D6 -1 damage"), averageDamage("x")]).toEqual([5.5, 3.5, 16, 2.5, null]);
  });
  it("reads armour and scrolls, with fallbacks when the tables are missing", () => {
    expect(armourOptions(byId).map((a) => a.name)).toEqual(["Jerkin", "Padded Tunic"]);
    expect(scrollOptions(byId)[0]).toMatchObject({ name: "Balance", orbit: "FACULTY", dispel: "NONE", fail: "+1", effect: "+1 DISCIPLINE FOR 1 DUNGEON LEVEL" });
    expect(scrollOptions(byId)[1]).toMatchObject({ name: "Mental Whip", effect: "1 strike" }); // not in the full table: its summary
    expect(armourOptions(new Map())).toHaveLength(4);
    expect(scrollOptions(new Map()).map((s) => s.name)).toEqual(["Balance", "Mental Whip", "Reflexes", "Melt Metal"]);
  });
});

describe("the draft", () => {
  it("lists what is missing, in step order, and nothing when complete", () => {
    expect(problems(blankDraft(), byId)).toEqual(["Give your character a name", "Choose a weapon", "Choose a piece of armour", "Choose a scroll"]);
    expect(problems({ ...full(), manoeuvres: ["SWOOP"] }, byId)).toEqual(["Pick 2 manoeuvres (1 chosen)"]);
    expect(problems({ ...full(), manoeuvres: ["SWOOP", "CHARGE"] }, byId)).toEqual(["Pick 2 manoeuvres (1 chosen)"]); // CHARGE is the axe's
    expect(problems(full(), byId)).toEqual([]);
    expect(problems({ ...full(), manoeuvres: [] }, new Map())).toEqual([]); // no table: nothing to pick from
  });
  it("a third manoeuvre replaces the oldest; changing weapon clears them", () => {
    let d = toggleManoeuvre(toggleManoeuvre(toggleManoeuvre(full(), "CUT"), "CUT"), "CUT");
    expect(d.manoeuvres).toEqual(["THRUST", "CUT"]);
    d = toggleManoeuvre(d, "THRUST");
    expect(d.manoeuvres).toEqual(["CUT"]);
    expect(withWeapon(full(), "Greataxe", byId).manoeuvres).toEqual([]);
    expect(withWeapon(full(), "Longsword", byId).manoeuvres).toEqual(["SWOOP", "THRUST"]);
  });
  it("builds the full starting character", () => {
    const c = buildCharacter({ ...full(), cls: "constable", expansions: { lairs: true } }, byId);
    expect(c).toMatchObject({ name: "Vel", weapon: "Longsword", class: "constable", expansions: { lairs: true }, xp: 0, hp: 10, rations: 3, gc: 0 });
    expect(c.manoeuvres.slice(0, 2)).toEqual([["SWOOP", "[1][2]", "D6 +2 damage"], ["THRUST", "[3][2]", "D6 damage"]]);
    expect(c.armour[0]).toEqual(["Padded Tunic", "[5]", "-1 Damage"]);
    expect(c.scrolls[0]).toEqual(["Scroll of BALANCE", "FACULTY", "NONE", "+1 DISCIPLINE FOR 1 DUNGEON LEVEL"]);
    expect(c.potions[0][0]).toBe("Potion of Healing");
    expect(c.small).toContain("lantern");
  });
  it("a random draft is complete once it has a name", () => {
    for (let i = 0; i < 20; i++) {
      const d = randomDraft({ ...blankDraft(), name: "X" }, byId);
      expect(problems(d, byId)).toEqual([]);
      expect(new Set(d.manoeuvres).size).toBe(2);
    }
  });
});
