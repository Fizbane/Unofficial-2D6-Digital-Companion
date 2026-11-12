import { beforeAll, describe as vDescribe, expect, it } from "vitest";
// The Void library is generated (pipeline/build.py --game void) and not in git: without it these tests are skipped.
const built = import.meta.glob("../../public/data/library-void.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const libText = Object.values(built)[0] ?? "";
const describe = (libText ? vDescribe : vDescribe.skip) as typeof vDescribe;
import { byId } from "../../src/library";
import { opaqueId, registerBoth } from "./idmap";
import type { Library } from "../../src/types";
import {
  _clearLevelCache, addLarge, addRangedHit, addXp, applyDamage, armourTable, camoRest, canAddLarge, craftingItems, eatBetweenLevels,
  enterRoom, fillStim, heal, levelChangeText, levelOf, levelTable, marksmanship, meleeManoeuvres, newVoidCharacter, normaliseVChar,
  parseDamage, parseDiceSet, rangedProblem, setXp, skillCheck, stimRecipe, stun, tickSte, useStim, vstats, weaponCards,
  weaponFromCard, weaponManoeuvres, wearProblem, wornArmour, armourPiece, bloody,
} from "../../src/tools/void/sheetmodel";

beforeAll(() => {
  const lib = JSON.parse(libText) as Library;
  registerBoth(byId, lib.sections);
  _clearLevelCache();
});

describe("profession Levels tables", () => {
  it("parse all ten levels from the library", () => {
    const fc = levelTable("Freighter Captain");
    expect(fc).toHaveLength(10);
    expect(fc[0]).toMatchObject({ title: "Cadet", man: 2, maxMan: 1, next: 100, shift: 2, hp: 10 });
    expect(fc[9]).toMatchObject({ title: "Master", man: 3, maxMan: 3, next: Infinity, shift: 4, hp: 100 });
    expect(levelTable("Space Police Officer")[1]).toMatchObject({ title: "Guardian", hp: 22, next: 500 });
    expect(levelTable("Bounty Hunter")[9].hp).toBe(105);
  });

  it("level from cumulative XP, per profession (U1)", () => {
    expect(levelOf("Freighter Captain", 0)).toBe(1);
    expect(levelOf("Freighter Captain", 99)).toBe(1);
    expect(levelOf("Freighter Captain", 100)).toBe(2);
    expect(levelOf("Freighter Captain", 599)).toBe(2);
    expect(levelOf("Freighter Captain", 600)).toBe(3);
    expect(levelOf("Space Police Officer", 500)).toBe(3);
    expect(levelOf("Bounty Hunter", 549)).toBe(2);
    expect(levelOf("Bounty Hunter", 550)).toBe(3);
    expect(levelOf("Freighter Captain", 28000)).toBe(10);
    expect(levelOf("Space Police Officer", 999999)).toBe(10);
  });
});

describe("derived stats", () => {
  it("start at Technical 3, Coding 3, Marksmanship 6, Shift +2, HP 10", () => {
    const c = newVoidCharacter("Bounty Hunter");
    const s = vstats(c);
    expect(s).toMatchObject({ level: 1, title: "Pursuer", technical: 3, coding: 3, marksmanship: 6, shift: 2, baseline: 10, manoeuvres: 2, maxManLevel: 1 });
    expect(c.hp).toBe(10);
    expect(c.rations).toBe(2);
    expect(c.stims).toEqual([{ type: "Medical" }]);
    expect(c.ranged[0]).toMatchObject({ name: "C-12 Pistol", size: "small", ammo: 12, capacity: 12, starting: true });
  });

  it("add Tech / Coding Mods cumulatively as levels rise", () => {
    const c = newVoidCharacter("Freighter Captain");
    setXp(c, 600); // L3 Helmsman: +1/+1
    expect(vstats(c)).toMatchObject({ level: 3, technical: 4, coding: 4 });
    setXp(c, 7000); // L7: mods at 3, 6, 7 → +3 / +3
    expect(vstats(c)).toMatchObject({ level: 7, technical: 6, coding: 6, shift: 3, manoeuvres: 3, maxManLevel: 2 });
    const p = newVoidCharacter("Space Police Officer");
    setXp(p, 2200); // L5 Enforcer: tech at 3 and 5, coding at 4
    expect(vstats(p)).toMatchObject({ technical: 5, coding: 4 });
  });

  it("caps skills at 10", () => {
    const c = newVoidCharacter();
    c.techBonus = 20;
    expect(vstats(c).technical).toBe(10);
  });

  it("Stunned costs 1 Shift and a stim effect adds", () => {
    const c = newVoidCharacter();
    stun(c, 3);
    expect(vstats(c).shift).toBe(1);
    c.stims = [{ type: "Amplified Joints" }];
    useStim(c, 0);
    expect(vstats(c).shift).toBe(2);
  });

  it("skill checks pass at or under the skill; Special Skills give −1", () => {
    const c = newVoidCharacter();
    expect(skillCheck(c, "coding", 6, -3).pass).toBe(true); // 6 − 3 = 3 ≤ 3
    expect(skillCheck(c, "coding", 7, -3).pass).toBe(false);
    expect(skillCheck(c, "technical", 4, 0, true)).toMatchObject({ total: 3, pass: true });
  });
});

describe("level-ups", () => {
  it("add the baseline difference to current HP, even above baseline", () => {
    const c = newVoidCharacter("Space Police Officer");
    c.hp = 7;
    const ch = addXp(c, 120);
    expect(ch).toEqual({ from: 1, to: 2, hpDelta: 12 });
    expect(c.hp).toBe(19);
    expect(levelChangeText(c, ch)).toMatch(/Level up! Guardian/);
    // a correction back down takes it away again, never below 0
    c.hp = 5;
    setXp(c, 0);
    expect(c.hp).toBe(0);
    expect(c.level).toBe(1);
  });

  it("jumping several levels adds the whole difference", () => {
    const c = newVoidCharacter("Freighter Captain");
    setXp(c, 1200); // L1 → L4: 10 → 42
    expect(c.hp).toBe(42);
  });
});

describe("HP", () => {
  it("damage stops at 0 and reports being down", () => {
    const c = newVoidCharacter();
    expect(applyDamage(c, 4)).toEqual({ hp: 6, down: false });
    expect(applyDamage(c, 40)).toEqual({ hp: 0, down: true });
  });

  it("healing stops at the baseline unless it may exceed it (U7)", () => {
    const c = newVoidCharacter();
    c.hp = 5;
    expect(heal(c, 10)).toBe(5);
    expect(c.hp).toBe(10);
    expect(heal(c, 10, { exceed: true })).toBe(10);
    expect(c.hp).toBe(20);
    expect(heal(c, 5)).toBe(0); // never lowers HP above baseline
    expect(c.hp).toBe(20);
  });

  it("the Medical stim gives +10 over baseline; Potent Medical clears Stunned", () => {
    const c = newVoidCharacter();
    useStim(c, 0);
    expect(c.hp).toBe(20);
    expect(c.stims[0].type).toBe(""); // the injector is kept
    c.stims.push({ type: "Potent Medical" });
    c.stunned = 3;
    useStim(c, 1);
    expect(c.hp).toBe(70);
    expect(c.stunned).toBe(0);
  });

  it("rations between levels: half (max 20) without, a quarter with two parts", () => {
    const c = newVoidCharacter();
    c.hp = 50;
    c.rations = 0;
    expect(eatBetweenLevels(c, "none")).toBe(20);
    c.hp = 30;
    c.rationParts = 2;
    expect(eatBetweenLevels(c, "parts")).toBe(7);
    c.rations = 1;
    expect(eatBetweenLevels(c, "ration")).toBe(0);
    expect(c.rations).toBe(0);
  });

  it("Camo Tent rest: to baseline with a ration, half baseline without", () => {
    const c = newVoidCharacter();
    c.hp = 2;
    c.stunned = 2;
    camoRest(c);
    expect(c.hp).toBe(10);
    expect(c.rations).toBe(1);
    expect(c.stunned).toBe(0);
    c.rations = 0;
    c.hp = 2;
    camoRest(c);
    expect(c.hp).toBe(7);
  });
});

describe("marksmanship", () => {
  it("fills the Ranged Hits bar after 10 different enemies: +1 Marksmanship and 100 XP per level", () => {
    const c = newVoidCharacter();
    for (let i = 0; i < 9; i++) expect(addRangedHit(c).filled).toBe(false);
    expect(c.rangedHits).toBe(9);
    const r = addRangedHit(c);
    expect(r.filled).toBe(true);
    expect(r.xp).toBe(100);
    expect(c.rangedHits).toBe(0);
    expect(c.marksmanship).toBe(7);
    expect(c.xp).toBe(100);
    expect(c.level).toBe(2);
  });

  it("never passes 10", () => {
    const c = newVoidCharacter();
    c.marksmanship = 10;
    c.rangedHits = 9;
    addRangedHit(c);
    expect(c.marksmanship).toBe(10);
    c.marksTemp = 1;
    expect(marksmanship(c)).toBe(10);
    c.marksTemp = -2;
    expect(marksmanship(c)).toBe(8);
  });
});

describe("capacity", () => {
  it("10 large items", () => {
    const c = newVoidCharacter();
    for (let i = 0; i < 10; i++) expect(addLarge(c, `Rock ${i}`)).toBe(true);
    expect(canAddLarge(c)).toBe(false);
    expect(addLarge(c, "One more")).toBe(false);
  });

  it("ranged weapons: 2 small + 1 large", () => {
    const c = newVoidCharacter();
    expect(rangedProblem(c, "small")).toBeNull();
    c.ranged.push(weaponFromCard("void/proton-bolter")!);
    expect(rangedProblem(c, "small")).toMatch(/2 small/);
    expect(rangedProblem(c, "large")).toBeNull();
    c.ranged.push(weaponFromCard("void/charge-rifle")!);
    expect(rangedProblem(c, "large")).toMatch(/at most 3/);
  });

  it("armour: max 3, no duplicates, one per body part", () => {
    const c = newVoidCharacter();
    c.armour.push(armourPiece({ name: "Polymer Helmet", dice: "[5][3]", mod: -2 }));
    expect(wearProblem(c, "Glancing Carapace Helm")).toMatch(/same body part/);
    expect(wearProblem(c, "Polymer Helmet")).toMatch(/already/);
    expect(wearProblem(c, "Composite Vest")).toBeNull();
    c.armour.push(armourPiece({ name: "Composite Vest", dice: "[4]", mod: -1 }), armourPiece({ name: "Tactical Bracers", dice: "[1][6]", mod: -2 }));
    expect(wearProblem(c, "Plated Field Gloves")).toMatch(/at most 3/);
  });
});

describe("library data", () => {
  it("reads the weapon manoeuvres with their levels", () => {
    const m = weaponManoeuvres("Electro Hammer");
    expect(m.filter((x) => x.level === 1)).toHaveLength(10);
    expect(m[0]).toEqual({ name: "Shock Slam", dice: "[1][2]", damage: "D6 +3", level: 1 });
    expect(m.find((x) => x.level === 3)?.damage).toBe("2D6 +9");
  });

  it("parses dice sets and damage", () => {
    expect(parseDiceSet("[6][4]+[3][3]")).toEqual([[6, 4], [3, 3]]);
    expect(parseDamage("2D6 +9")).toEqual({ dice: 2, sides: 6, mod: 9 });
    expect(parseDamage("D6 -1")).toEqual({ dice: 1, sides: 6, mod: -1 });
  });

  it("armour table, yellow dice and Combat's armour view", () => {
    const t = armourTable();
    expect(t).toHaveLength(27);
    expect(t.filter((r) => r.start).map((r) => r.dice)).toEqual(["[4]", "[5]", "[3]", "[2]"]);
    const c = newVoidCharacter();
    c.armour.push(armourPiece({ name: "Void Knight Battlesuit", dice: "[5][4]+[3][2]", mod: -4 }));
    expect(wornArmour(c)[0]).toMatchObject({ dice: [[5, 4], [3, 2]], yellow: [[5], [3]], mod: -4 });
  });

  it("melee manoeuvres carry the melee bonus", () => {
    const c = newVoidCharacter();
    c.manoeuvres.push(weaponManoeuvres("Ion Baton")[0]);
    c.meleeBonus = 1;
    expect(meleeManoeuvres(c)[0]).toMatchObject({ primary: 1, secondary: 2, damage: { dice: 1, sides: 6, mod: 3 } });
  });

  it("weapon cards and stim recipes", () => {
    expect(weaponCards().length).toBeGreaterThanOrEqual(19);
    expect(stimRecipe("T x2 & Co")).toEqual({ T: 2, Co: 1 });
    expect(stimRecipe("I, Ca, S & Ca x2")).toEqual({ I: 1, Ca: 3, S: 1 });
    expect(stimRecipe("I, Sa & T")).toEqual({ I: 1, S: 1, T: 1 });
    expect(craftingItems("Bounty Hunter").map((x) => x.name)).toEqual(["Scramble Bolt", "Grappling Hook", "Distract Node"]);
  });

  it("fills an empty injector from gases for 10 XP per level", () => {
    const c = newVoidCharacter();
    c.stims = [{ type: "" }];
    expect(fillStim(c, 0, "Medical").ok).toBe(false);
    c.gas.Co = 1;
    c.gas.S = 1;
    expect(fillStim(c, 0, "Medical").ok).toBe(true);
    expect(c.stims[0].type).toBe("Medical");
    expect(c.gas).toMatchObject({ Co: 0, S: 0 });
    expect(c.xp).toBe(10);
  });
});

describe("conditions and STE", () => {
  it("Bounty Hunters shrug off a point of Stunned; Stunned and Bloodied tick per room", () => {
    const c = newVoidCharacter("Bounty Hunter");
    stun(c, 5);
    expect(c.stunned).toBe(4);
    bloody(c);
    expect(c.bloodied).toBe(1);
    enterRoom(c);
    expect(c).toMatchObject({ stunned: 3, bloodied: 2 });
    c.bloodied = 8;
    expect(enterRoom(c).join()).toMatch(/Fever/);
    expect(c.hp).toBe(9);
  });

  it("the 4th STE tick raises the skill and clears the row", () => {
    const c = newVoidCharacter();
    for (let i = 0; i < 3; i++) expect(tickSte(c, "crackCode").gained).toBeNull();
    expect(tickSte(c, "crackCode").gained).toBe("coding");
    expect(c.ste.crackCode).toBe(0);
    expect(vstats(c).coding).toBe(4);
  });

  it("normalises partial saves", () => {
    const c = normaliseVChar({ name: "Ash", xp: 650, profession: "Bounty Hunter" } as never);
    expect(c.level).toBe(3);
    expect(c.large).toHaveLength(10);
    expect(c.hero).toHaveLength(10);
    expect(c.ranged[0].name).toBe("C-12 Pistol");
  });
});
