import { describe, it, expect } from "vitest";
import { applyXp, clampXp, fatigueEditable, levelChangeText, squareCrop, stepBonusHp, stepCondition, stepFatigue } from "../src/shell/charmodel";

const LV = (xp: number) => (xp >= 500 ? 3 : xp >= 100 ? 2 : 1);

describe("clampXp", () => {
  it("is a whole number, never below 0", () => {
    expect(clampXp(-5)).toBe(0);
    expect(clampXp(12.7)).toBe(12);
    expect(clampXp(NaN)).toBe(0);
    expect(clampXp(250)).toBe(250);
  });
});

describe("applyXp", () => {
  it("sets XP and reports no change inside a level", () => {
    const c = { xp: 10, hp: 8, lastLevel: 1 };
    expect(applyXp(c, 50, LV)).toMatchObject({ from: 1, to: 1 });
    expect(c).toEqual({ xp: 50, hp: 8, lastLevel: 1 });
  });
  it("levels up like the sheet: +10 HP per new level and lastLevel follows", () => {
    const c = { xp: 90, hp: 8, lastLevel: 1 };
    expect(applyXp(c, 600, LV)).toMatchObject({ from: 1, to: 3 });
    expect(c).toEqual({ xp: 600, hp: 28, lastLevel: 3 });
  });
  it("a correction below a threshold takes the level-up HP back (10 per level dropped)", () => {
    const c = { xp: 120, hp: 18, lastLevel: 2 };
    expect(applyXp(c, 99, LV)).toMatchObject({ from: 2, to: 1 });
    expect(c).toEqual({ xp: 99, hp: 8, lastLevel: 1 });
  });
  it("an XP round trip across a threshold leaves HP unchanged", () => {
    const c = { xp: 99, hp: 7, lastLevel: 1 };
    applyXp(c, 100, LV);
    expect(c.hp).toBe(17);
    applyXp(c, 99, LV);
    expect(c).toEqual({ xp: 99, hp: 7, lastLevel: 1 });
  });
  it("a two-level drop removes 20 HP", () => {
    const c = { xp: 600, hp: 30, lastLevel: 3 };
    expect(applyXp(c, 50, LV)).toMatchObject({ from: 3, to: 1 });
    expect(c.hp).toBe(10);
  });
  it("HP never drops below 0 on a correction", () => {
    const c = { xp: 600, hp: 12, lastLevel: 3 };
    applyXp(c, 0, LV);
    expect(c.hp).toBe(0);
  });
  it("going up again after a correction grants the HP once", () => {
    const c = { xp: 120, hp: 18, lastLevel: 2 };
    applyXp(c, 99, LV); // 8
    applyXp(c, 150, LV); // 18
    applyXp(c, 160, LV); // same level: nothing more
    expect(c).toEqual({ xp: 160, hp: 18, lastLevel: 2 });
  });
  it("clamps the new XP", () => {
    const c = { xp: 3, hp: 8, lastLevel: 1 };
    applyXp(c, -10, LV);
    expect(c.xp).toBe(0);
  });
});

describe("levelChangeText", () => {
  it("uses the sheet's level-up wording going up, the HP taken back going down, nothing when unchanged", () => {
    expect(levelChangeText({ from: 1, to: 2 }, "Novice")).toBe("Level up! Novice (level 2). +10 HP. You may gain or swap a manoeuvre.");
    expect(levelChangeText({ from: 3, to: 2 }, "Novice")).toBe("Back to Novice (level 2). −10 HP.");
    expect(levelChangeText({ from: 3, to: 1 }, "Raw")).toBe("Back to Raw (level 1). −20 HP.");
    expect(levelChangeText({ from: 2, to: 2 }, "Novice")).toBeNull();
  });
});

describe("stepCondition", () => {
  it("stays within 0–8", () => {
    expect(stepCondition(0, -1)).toBe(0);
    expect(stepCondition(0, 1)).toBe(1);
    expect(stepCondition(8, 1)).toBe(8);
    expect(stepCondition(5, -1)).toBe(4);
    expect(stepCondition(undefined, 1)).toBe(1);
  });
});

describe("fatigue", () => {
  it("is editable only during a fight", () => {
    expect(fatigueEditable({ phase: "you" })).toBe(true);
    expect(fatigueEditable({ phase: "foes" })).toBe(true);
    expect(fatigueEditable({ phase: "setup" })).toBe(false);
    expect(fatigueEditable({ phase: "won" })).toBe(false);
    expect(fatigueEditable({ phase: "lost" })).toBe(false);
    expect(fatigueEditable(null)).toBe(false);
  });
  it("steps within 1–6", () => {
    expect(stepFatigue(1, -1)).toBe(1);
    expect(stepFatigue(3, 1)).toBe(4);
    expect(stepFatigue(6, 1)).toBe(6);
    expect(stepFatigue(undefined, 1)).toBe(2);
  });
});

describe("stepBonusHp", () => {
  it("follows the sheet stepper (no minimum)", () => {
    expect(stepBonusHp(0, 1)).toBe(1);
    expect(stepBonusHp(0, -1)).toBe(-1);
    expect(stepBonusHp(5, -1)).toBe(4);
  });
});

describe("squareCrop", () => {
  it("takes the centred square of the short side", () => {
    expect(squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });
    expect(squareCrop(300, 400)).toEqual({ sx: 0, sy: 50, size: 300 });
    expect(squareCrop(256, 256)).toEqual({ sx: 0, sy: 0, size: 256 });
    expect(squareCrop(301, 100)).toEqual({ sx: 100, sy: 0, size: 100 });
  });
});

import { safePortrait } from "../src/shell/charmodel";
describe("safePortrait", () => {
  it("keeps only base64 image data URLs", () => {
    expect(safePortrait("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(safePortrait("data:image/png;base64,AA+/=")).toBe("data:image/png;base64,AA+/=");
    expect(safePortrait("javascript:alert(1)")).toBe("");
    expect(safePortrait('data:image/png;base64,AA" onerror="x')).toBe("");
    expect(safePortrait(undefined)).toBe("");
    expect(safePortrait(42 as unknown as string)).toBe("");
  });
});

import { setPortrait } from "../src/shell/charmodel";
describe("setPortrait", () => {
  it("keeps the new picture when it was saved", () => {
    let stored: string | undefined;
    const c: { portrait?: string } = { portrait: "old" };
    expect(setPortrait(c, "new", (x) => (stored = x.portrait), () => stored)).toBe(true);
    expect(c.portrait).toBe("new");
  });
  it("puts the previous picture back when the save didn't stick (storage full)", () => {
    const c: { portrait?: string } = { portrait: "old" };
    expect(setPortrait(c, "new", () => {}, () => "old")).toBe(false);
    expect(c.portrait).toBe("old");
  });
  it("removes the field again when there was no picture before", () => {
    const c: { portrait?: string } = {};
    expect(setPortrait(c, "new", () => {}, () => undefined)).toBe(false);
    expect("portrait" in c).toBe(false);
  });
});

import { addXp } from "../src/shell/charmodel";
describe("addXp (XP gained in play, e.g. Combat's bank XP)", () => {
  it("applies the level-up at once: +10 HP and lastLevel", () => {
    const c = { xp: 80, hp: 6, lastLevel: 1 };
    expect(addXp(c, 30, LV)).toMatchObject({ from: 1, to: 2 });
    expect(c).toEqual({ xp: 110, hp: 16, lastLevel: 2 });
  });
  it("adds plain XP inside a level", () => {
    const c = { xp: 10, hp: 6, lastLevel: 1 };
    expect(addXp(c, 5, LV)).toMatchObject({ from: 1, to: 1 });
    expect(c).toEqual({ xp: 15, hp: 6, lastLevel: 1 });
  });
  it("crossing two thresholds grants both levels", () => {
    const c = { xp: 90, hp: 4, lastLevel: 1 };
    addXp(c, 500, LV);
    expect(c).toEqual({ xp: 590, hp: 24, lastLevel: 3 });
  });
});

import { importedLastLevel } from "../src/shell/charmodel";
describe("importedLastLevel", () => {
  it("keeps a valid saved lastLevel", () => {
    expect(importedLastLevel({ xp: 600, lastLevel: 2 }, LV)).toBe(2);
    expect(importedLastLevel({ xp: 0, lastLevel: 1 }, LV)).toBe(1);
  });
  it("uses the level for the XP when it's missing", () => {
    expect(importedLastLevel({ xp: 600 }, LV)).toBe(3);
    expect(importedLastLevel({ xp: 120 }, LV)).toBe(2);
  });
  it("uses the level for the XP when it's garbage", () => {
    for (const bad of [0, -1, 1.5, "2", null, NaN, Infinity]) expect(importedLastLevel({ xp: 600, lastLevel: bad }, LV)).toBe(3);
  });
});
