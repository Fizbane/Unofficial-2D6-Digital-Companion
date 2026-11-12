import { beforeAll, describe as vDescribe, expect, it } from "vitest";
// The Void library is generated (pipeline/build.py --game void) and not in git: without it these tests are skipped.
const built = import.meta.glob("../../public/data/library-void.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const libText = Object.values(built)[0] ?? "";
const describe = (libText ? vDescribe : vDescribe.skip) as typeof vDescribe;
import { byId } from "../../src/library";
import { opaqueId, registerBoth } from "./idmap";
import type { Library } from "../../src/types";
import { armourPiece, weaponFromCard } from "../../src/tools/void/sheetmodel";
import {
  alienChoice, alienDeflect, alienIndex, armourCheck, armourSets, burstAmmo, cardEffect, conditional, damageFromFaces, diceText, doublesEffect, doublesRow,
  fatigueBonus, fightXp, finalDamage, findAlien, firingCase, firingPlan, hullAllows, insightMod, interruptFor, makeTurret, meleeDeflect, outnumberedBonus,
  parseAlienManoeuvre, parseAlienRanged, patrolSpecial, parseDeflection, parseDoubles, parseInterrupt, parseSettings, rangedDeflect, reachable, resolveThrow, searchAliens,
  shotHits, stimCombat, stimShotMod, throwProblem, tooPowerful, weaponSpecial, type Alien,
} from "../../src/tools/void/combatmodel";

let lib: Library;
let all: Alien[];
beforeAll(() => {
  lib = JSON.parse(libText) as Library;
  registerBoth(byId, lib.sections);
  all = alienIndex(lib.sections);
});
const card = (name: string) => findAlien(all, name)!;

describe("alien cards from the library", () => {
  it("indexes every card once, by level", () => {
    expect(all.length).toBeGreaterThan(70);
    expect(new Set(all.map((a) => a.key)).size).toBe(all.length);
    expect(all.some((a) => a.name === "2D6 VOID" || a.name === "")).toBe(false);
    expect(all[0].level).toBe(1);
  });
  it("every card has HP, manoeuvres, a type and parsed interrupts", () => {
    for (const a of all) {
      expect(a.hp, a.name).toBeGreaterThan(0);
      expect(a.man.length, a.name).toBeGreaterThan(0);
      expect(a.type, a.name).toMatch(/^[BCERS]$/);
      const rows = a.interruptText ? a.interruptText.split(" | ").length : 0;
      expect(a.interrupts.length, `${a.name}: ${a.interruptText}`).toBe(rows);
      if (a.deflectionText && !/none/i.test(a.deflectionText)) expect(a.deflection.length, a.name).toBeGreaterThan(0);
      if (!/^none$/i.test(a.rangedText)) expect(a.ranged, `${a.name}: ${a.rangedText}`).not.toBeNull();
    }
  });
  it("reads the Octaphex", () => {
    const o = card("OCTAPHEX");
    expect(o).toMatchObject({ level: 1, type: "B", hp: 6, xp: 9, sh: 1, cache: "NONE", ranged: null });
    expect(o.interrupts[0]).toMatchObject({ name: "Carapace Shell", die: "P", values: [4, 6], reduce: 1 });
    expect(o.deflection).toEqual([{ die: "P", value: 6 }]);
    expect(o.man[0]).toMatchObject({ p: 1, s: 4, name: "LATCHING BITE", dmg: { dice: 1, sides: 6, mod: -2 } });
  });
  it("search by name or L3, and find the Hulk turn's pending alien", () => {
    expect(searchAliens(all, "drool").map((a) => a.name)).toContain("ACID DROOLER");
    expect(searchAliens(all, "L3").every((a) => a.level === 3)).toBe(true);
    expect(searchAliens(all, "l3").length).toBeGreaterThan(0);
    expect(findAlien(all, "Acid Drooler (L1)")?.name).toBe("ACID DROOLER");
    expect(findAlien(all, "x", opaqueId("void/octaphex"))?.name).toBe("OCTAPHEX");
  });
});

describe("card field parsers", () => {
  it("interrupts, with specials and odd commas", () => {
    expect(parseInterrupt("Rust Plating on Primary 2s and 5s -1 damage + special - it  heals 1 HP.")).toMatchObject({ values: [2, 5], reduce: 1, special: "it heals 1 HP." });
    expect(parseInterrupt("Loose Cords on Primary 2s, 3s 5s and 6s -1 damage")?.values).toEqual([2, 3, 5, 6]);
    expect(parseInterrupt("Plate Armour on Secondary 2s and 3s -1 damage")).toMatchObject({ die: "S", movement: false });
    expect(parseInterrupt("Quick Dart on Primary 3s and 4s -1 damage")?.movement).toBe(true);
    expect(parseInterrupt("Shimmer Ward on Primary 1s, 2s 3s, 4s, 5s and 6s -10 damage")?.values).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseInterrupt("")).toBeNull();
  });
  it("red-boxed deflection numbers by position", () => {
    const two = [parseInterrupt("A on Primary 2s, 4s -1 damage")!, parseInterrupt("B on Secondary 2s and 5s -2 damage")!];
    expect(parseDeflection("Primary 4s; Secondary 2s", two)).toEqual([{ die: "P", value: 4 }, { die: "S", value: 2 }]);
    expect(parseDeflection("5s", two)).toEqual([{ die: "S", value: 5 }]); // the interrupt that has 5s
    expect(parseDeflection("none", two)).toEqual([]);
  });
  it("manoeuvres and alien ranged weapons", () => {
    expect(parseAlienManoeuvre("[5][2] - ARCING ELECTRICITY = D6 -2 + special - Gain the Stunned 1 Condition")).toMatchObject({ p: 5, s: 2, dmg: { dice: 1, mod: -2 }, special: "Gain the Stunned 1 Condition" });
    expect(parseAlienManoeuvre("[5][5] - LATCHES ON = D6 (-1 Marksmanship)")).toMatchObject({ special: "-1 Marksmanship" });
    expect(parseAlienManoeuvre("[2][6] - LASER SCALPELS = 3D6 +10")?.dmg).toEqual({ dice: 3, sides: 6, mod: 10 });
    expect(parseAlienManoeuvre("[2][5] - LASHING CABLE = D3 +2")?.dmg).toEqual({ dice: 1, sides: 3, mod: 2 });
    expect(parseAlienRanged("Acid Mist* 5, D6 -3")).toMatchObject({ name: "Acid Mist", hullOk: true, marks: 5, dmg: { dice: 1, mod: -3 }, uses: null });
    expect(parseAlienRanged("Grapple* (1 use) 6, D3")).toMatchObject({ name: "Grapple", hullOk: true, marks: 6, dmg: { sides: 3 }, uses: 1 });
    expect(parseAlienRanged("Lance 8, 2D6 (one use)")).toMatchObject({ hullOk: false, marks: 8, dmg: { dice: 2, mod: 0 }, uses: 1 });
    expect(parseAlienRanged("None")).toBeNull();
  });
});

describe("damage", () => {
  it("D3 from d6 faces, the 6 floor after reductions (U33)", () => {
    expect(damageFromFaces({ dice: 1, sides: 3, mod: 1 }, [5])).toMatchObject({ total: 4, six: false });
    expect(damageFromFaces({ dice: 1, sides: 6, mod: -3 }, [6])).toMatchObject({ total: 3, six: true });
    expect(damageFromFaces({ dice: 2, sides: 6, mod: 4 }, [2, 3]).total).toBe(9);
    expect(finalDamage(3, 5, true)).toBe(1);
    expect(finalDamage(3, 5, false)).toBe(0);
    expect(finalDamage(-2, 0, false)).toBe(0);
    expect(diceText({ dice: 2, sides: 6, mod: -1 })).toBe("2D6 −1");
    expect(diceText({ dice: 0, sides: 6, mod: 5 })).toBe("5");
  });
});

describe("close combat", () => {
  const mans = [{ p: 1, s: 2 }, { p: 4, s: 3 }];
  it("reach with shift points, no wrap", () => {
    expect(reachable(1, 2, mans, 0).map((x) => x.cost)).toEqual([0]);
    expect(reachable(3, 3, mans, 1).map((x) => x.m)).toEqual([{ p: 4, s: 3 }]);
    expect(reachable(6, 6, [{ p: 1, s: 1 }], 2)).toEqual([]); // 6 → 1 isn't one step
  });
  it("fatigue: +1 at 4, +2 at 5, +3 at 6", () => {
    expect([1, 2, 3, 4, 5, 6].map(fatigueBonus)).toEqual([0, 0, 0, 1, 2, 3]);
  });
  it("aliens shift to the most powerful manoeuvre they can reach", () => {
    const am = [parseAlienManoeuvre("[3][3] - A = D6 -1")!, parseAlienManoeuvre("[3][5] - B = D6 +4")!];
    expect(alienChoice(3, 3, am, 2)?.m.name).toBe("B");
    expect(alienChoice(3, 3, am, 1)?.m.name).toBe("A");
    expect(alienChoice(1, 1, am, 1)).toBeNull();
  });
  it("one interrupt per round, the best; movement ones stop at round 7", () => {
    const a = { interrupts: [parseInterrupt("Quick Dodge on Primary 2s and 4s -1 damage")!, parseInterrupt("Hard Exo-Frame on Secondary 2s and 5s -2 damage")!] };
    expect(interruptFor(a, 2, 2, { round: 1, disabled: false })?.reduce).toBe(2);
    expect(interruptFor(a, 4, 1, { round: 1, disabled: false })?.name).toBe("Quick Dodge");
    expect(interruptFor(a, 4, 1, { round: 7, disabled: false })).toBeNull();
    expect(interruptFor(a, 2, 5, { round: 9, disabled: false })?.name).toBe("Hard Exo-Frame");
    expect(interruptFor(a, 2, 5, { round: 1, disabled: true })).toBeNull();
    expect(interruptFor(a, 3, 3, { round: 1, disabled: false })).toBeNull();
  });
  it("armour: one piece, the best, matching by position; yellow dice for ranged", () => {
    const sets = armourSets([
      armourPiece({ name: "Glancing Carapace Helm", dice: "[3][2]", mod: -2 }),
      armourPiece({ name: "Composite Vest", dice: "[4]", mod: -1 }),
      armourPiece({ name: "Void Knight Battlesuit", dice: "[5][4]+[3][2]", mod: -4 }),
    ]);
    expect(meleeDeflect(sets, 3, 3)?.name).toBe("Void Knight Battlesuit"); // its [3] after the + is a Primary
    expect(meleeDeflect(sets, 1, 2)?.reduce).toBe(4);
    expect(meleeDeflect(sets, 4, 6)?.name).toBe("Composite Vest");
    expect(meleeDeflect(sets, 2, 3)).toBeNull(); // a Primary 2 doesn't match a Secondary 2
    // yellow: first die of each pair, plus the battlesuit's [3]
    expect(rangedDeflect(sets, 3, 1)?.name).toBe("Void Knight Battlesuit");
    expect(rangedDeflect(sets, 1, 2)).toBeNull(); // Secondary 2s aren't yellow
    expect(rangedDeflect(sets, 4, 1)?.name).toBe("Composite Vest");
  });
  it("armour checks: 5 damaged, 6 destroyed; the big suits only damaged on a 6", () => {
    expect(armourCheck("Composite Vest", 4)).toBe("ok");
    expect(armourCheck("Composite Vest", 5)).toBe("damaged");
    expect(armourCheck("Composite Vest", 6)).toBe("destroyed");
    expect(armourCheck("Layered Assault Suit", 5)).toBe("ok");
    expect(armourCheck("Adaptive Gel Suit", 6)).toBe("damaged");
  });
  it("too powerful (U40)", () => {
    const o = card("OCTAPHEX"); // [1][4] D6 −2: max 4
    expect(tooPowerful(o, armourSets([armourPiece({ name: "Adaptive Gel Suit", dice: "[6][4]+[3][3]", mod: -4 })]))).toBe(true);
    expect(tooPowerful(o, armourSets([armourPiece({ name: "Composite Vest", dice: "[1]", mod: -1 })]))).toBe(false);
    expect(tooPowerful(o, [])).toBe(false);
  });
  it("outnumbered: extras +1 Shift", () => {
    expect([0, 1, 2].map(outnumberedBonus)).toEqual([0, 1, 1]);
  });
});

describe("card text effects", () => {
  it("mishaps hurt the alien unless you're hit", () => {
    expect(cardEffect("The creature slips on the deck and hits the bulkhead. You lash out. It loses 4 HP.", "mishap").foeDamage).toEqual([{ dice: 0, sides: 6, mod: 4 }]);
    const gar = cardEffect("The blob bursts. You are hit by burning slime and lose D6 -1 HP.", "mishap");
    expect(gar.youDamage).toEqual([{ dice: 1, sides: 6, mod: -1 }]);
    expect(gar.foeDamage).toEqual([]);
    expect(cardEffect("The machine stalls and you strike it for D6 damage before it recovers.", "mishap").foeDamage[0]).toMatchObject({ dice: 1 });
    expect(cardEffect("The thing is sluggish and misses the next round of combat.", "mishap").foeSkip).toBe(true);
    expect(cardEffect("Its guns jam. It misses this round and the next.", "mishap").foeSkip).toBe(true);
    expect(cardEffect("In the smoke they collide with each other and lose 5 HP.", "mishap").foeDamage[0].mod).toBe(5);
    expect(cardEffect("It lunges but you step aside and it strikes the hatch and takes 10 damage.", "mishap").foeDamage[0].mod).toBe(10);
    const ex = cardEffect("The creature bursts. You are now Bloodied and it dies. You gain no XP.", "mishap");
    expect(ex).toMatchObject({ bloodied: true, foeDies: true, noXp: true });
    expect(cardEffect("It stumbles under its own bulk. You can take a free shot if you wish.", "mishap").freeShot).toBe(true);
    const limb = cardEffect("It swings a claw but it snaps off. It loses 8 HP and -1 Shift.", "mishap");
    expect(limb).toMatchObject({ foeShift: -1 });
    expect(limb.foeDamage[0].mod).toBe(8);
    expect(cardEffect("It grows sluggish. It loses 1 Shift next round.", "mishap")).toMatchObject({ foeShiftNext: -1, foeDamage: [] });
  });
  it("primes hurt you unless it loses HP", () => {
    expect(cardEffect("It coils round your arm and bites down. Lose D3 +1 HP.", "prime").youDamage).toEqual([{ dice: 1, sides: 3, mod: 1 }]);
    expect(cardEffect("It spits venom at your face, causing D6 -1 damage.", "prime").youDamage[0]).toMatchObject({ dice: 1, mod: -1 });
    expect(cardEffect("A shock wave rolls through the deck. Gain the Stunned 3 Condition.", "prime").stun).toBe(3);
    expect(cardEffect("It clamps on and drains you. Lose 4 HP and miss the next round.", "prime")).toMatchObject({ youSkip: true, foeSkip: false });
    const dm = cardEffect("Shards of black glass burst from it. It loses 10 HP. You lose 2D6 +12 HP.", "prime");
    expect(dm.foeDamage[0].mod).toBe(10);
    expect(dm.youDamage[0]).toEqual({ dice: 2, sides: 6, mod: 12 });
    expect(cardEffect("Every turret in the room fires together. Lose 4D6 HP +5.", "prime").youDamage[0]).toEqual({ dice: 4, sides: 6, mod: 5 });
    expect(cardEffect("It slashes you for D6 +2 damage leaving a burn. Lose 2 HP next round.", "prime").youDamage).toEqual([{ dice: 1, sides: 6, mod: 2 }]);
    expect(cardEffect("Its vines bind you. Lose 4 HP. It gains +2 Shift next round.", "prime").foeShiftNext).toBe(2);
    expect(cardEffect("It rams you off your feet. -2 Shift next round. Lose 2 HP.", "prime").youShiftNext).toBe(-2);
    expect(cardEffect("The probe darts in and stings you. Roll on NEPT1 -1.", "prime").tables).toBe(true);
    expect(cardEffect("It hurls a shard of hull at you. It cuts your side. Lose D6 +4.", "prime").youDamage[0]).toEqual({ dice: 1, sides: 6, mod: 4 });
  });
  it("every card's mishap and prime text reads without throwing", () => {
    for (const a of all) {
      cardEffect(a.mishap, "mishap");
      cardEffect(a.prime, "prime");
    }
  });
  it("conditional specials", () => {
    expect(conditional("roll a D6. On a 1 to 3 lose an extra 1 HP.")).toEqual({ lo: 1, hi: 3, then: "lose an extra 1 HP." });
    expect(conditional("Roll a D6. On a 1 your arm is damaged. Lose 1 MA.")).toMatchObject({ lo: 1, hi: 1 });
    expect(conditional("Roll a D6. 1 to 3 = 1 random large item is lost")).toMatchObject({ lo: 1, hi: 3 });
    expect(cardEffect("lose an extra 1 HP.", "prime").youDamage[0].mod).toBe(1);
    expect(conditional("armour cannot deflect this attack.")).toBeNull();
  });
});

describe("ranged combat", () => {
  it("weapon settings and burst ammo (U26)", () => {
    expect(parseSettings("Single")).toHaveLength(1);
    expect(parseSettings("Single, Burst -2M +5d")[1]).toEqual({ name: "Burst", marks: -2, dmg: 5, burst: true });
    expect(burstAmmo(30)).toBe(10);
    expect(burstAmmo(10)).toBe(4);
    expect(burstAmmo(6)).toBe(2);
  });
  it("outer hull: only * weapons, unless reinforced", () => {
    expect(hullAllows({ hull: true, reinforced: false }, false)).toBe(false);
    expect(hullAllows({ hull: true, reinforced: false }, true)).toBe(true);
    expect(hullAllows({ hull: true, reinforced: true }, false)).toBe(true);
    expect(hullAllows({ hull: false, reinforced: false }, false)).toBe(true);
  });
  it("shot roll: 2D6 + roll modifiers ≤ Marksmanship + modifiers", () => {
    expect(shotHits([3, 4], 0, 6, 0)).toMatchObject({ total: 7, hit: false, double: false });
    expect(shotHits([3, 4], -1, 6, 0).hit).toBe(true); // charging alien
    expect(shotHits([3, 3], 0, 8, -2)).toMatchObject({ hit: true, double: true }); // burst −2M
    expect(shotHits([4, 4], 0, 8, -2).hit).toBe(false);
  });
  it("firing cases and their order (U30)", () => {
    expect(firingCase(false, null, 6)).toBe(0);
    expect(firingCase(true, null, 6)).toBe(1);
    expect(firingCase(true, 5, 6)).toBe(2);
    expect(firingCase(true, 6, 6)).toBe(3);
    expect(firingCase(false, 7, 6)).toBe(4);
    expect(firingPlan(2)).toEqual(["you", "alien", "you"]);
    expect(firingPlan(4)).toEqual(["alien"]);
    expect(firingPlan(3, true)).toEqual(["you", "you"]);
  });
  it("Deflection Roll against red-boxed numbers: Primary 3s don't block Secondary 3s; best one (U27)", () => {
    const a = { interrupts: [parseInterrupt("A on Primary 3s and 4s -1 damage")!, parseInterrupt("B on Secondary 2s and 3s -3 damage")!], deflection: [] as { die: "P" | "S"; value: number }[] };
    a.deflection = parseDeflection("Primary 4s; Secondary 2s", a.interrupts);
    expect(alienDeflect(a, 4, 1)?.reduce).toBe(1);
    expect(alienDeflect(a, 3, 1)).toBeNull(); // 3s aren't red-boxed
    expect(alienDeflect(a, 1, 4)).toBeNull(); // Secondary 4 isn't Primary 4
    expect(alienDeflect(a, 4, 2)?.reduce).toBe(3);
    expect(alienDeflect(card("OCTAPHEX"), 6, 1)?.reduce).toBe(1);
  });
  it("stims in ranged and close combat", () => {
    expect(stimShotMod([{ name: "Focused Vision" }])).toBe(-1);
    expect(stimShotMod([{ name: "Magnified Senses" }, { name: "Focused Vision" }])).toBe(-2);
    expect(stimCombat([{ name: "Electric Discharge" }, { name: "Muscle Boost" }, { name: "Toughen Skin" }], 3)).toMatchObject({ firstHit: 6, perHit: 3, toughen: 3, momentum: false });
  });
});

describe("weapon doubles tables and specials", () => {
  const w = (id: string) => weaponFromCard(id)!;
  it("reads the C-12 table", () => {
    const rows = parseDoubles(w("void/c-12-pistol").doubles);
    expect(rows.map((r) => [r.lo, r.hi])).toEqual([[1, 1], [2, 2], [3, 6]]);
    const one = doublesEffect(doublesRow(rows, 1).text);
    expect(one).toMatchObject({ noFire: true, lock: true, broken: true });
    const two = doublesEffect(doublesRow(rows, 2).text);
    expect(two).toMatchObject({ noFire: false, lock: true, extraAmmo: 2 });
    expect(doublesEffect(doublesRow(rows, 4).text)).toMatchObject({ noFire: false, lock: false, bonus: null, selfDamage: null });
  });
  it("gaps read as nothing happens (Halo Suppressor)", () => {
    const rows = parseDoubles(w("void/halo-suppressor").doubles);
    expect(doublesRow(rows, 2).text).toMatch(/Nothing/);
    expect(doublesEffect(doublesRow(rows, 3).text).shotMod).toBe(-1);
    expect(doublesEffect(doublesRow(rows, 1).text).selfDamage).toEqual({ dice: 2, sides: 6, mod: 0 });
    expect(doublesEffect(doublesRow(rows, 6).text).foeSkip).toBe(true);
  });
  it("bonus damage, self damage and ammo across cards", () => {
    const eff = (id: string, d: number) => doublesEffect(doublesRow(parseDoubles(w(id).doubles), d).text);
    expect(eff("void/charge-rifle", 6).bonus?.mod).toBe(10);
    expect(eff("void/charge-rifle", 1)).toMatchObject({ noFire: true, lock: true, selfDamage: { mod: 5 } });
    expect(eff("void/a-type-carbine", 6).bonus?.mod).toBe(2);
    expect(eff("void/a-type-carbine", 2)).toMatchObject({ noFire: true, lock: true });
    expect(eff("void/data-whip", 5).bonus).toEqual({ dice: 2, sides: 6, mod: 0 });
    expect(eff("void/flesh-disruptor", 3).bonus?.mod).toBe(-5);
    expect(eff("void/flesh-disruptor", 6)).toMatchObject({ bonus: { mod: 10 }, extraAmmo: 1 });
    expect(eff("void/proton-bolter", 1)).toMatchObject({ noFire: true, extraAmmo: Infinity });
    expect(eff("void/lash-caster", 4)).toMatchObject({ noFire: false, extraAmmo: -1 });
    expect(eff("void/lash-caster", 1).selfDamage).toMatchObject({ dice: 1 });
    expect(eff("void/shardcaster", 6)).toMatchObject({ noFire: false, doubleDmg: true, extraAmmo: 1 });
    expect(eff("void/ore-cannon", 2).bonus?.mod).toBe(15);
    expect(eff("void/des-stunner", 3).noFire).toBe(true);
  });
  it("specials", () => {
    expect(weaponSpecial(w("void/charge-rifle").special).bioBonus).toBe(5);
    expect(weaponSpecial(w("void/slicer-maw").special).bioBonus).toBe(5);
    expect(weaponSpecial(w("void/flesh-disruptor").special).bioOnly).toBe(true);
    expect(weaponSpecial(w("void/halo-suppressor").special).oncePerCombat).toBe(true);
    expect(weaponSpecial(w("void/thundercoil").special).onHit).toMatchObject({ lo: 4, hi: 6, bonus: 5 });
    expect(weaponSpecial(w("void/des-stunner").special).onHit).toMatchObject({ lo: 6, hi: 6, foeSkip: true });
    expect(weaponSpecial(w("void/reverb-cannon").special).onHit).toMatchObject({ lo: 4, noReturnFire: true });
    expect(weaponSpecial(w("void/sonic-disruptor").special).firstMeleeShift).toBe(-1);
    expect(weaponSpecial(w("void/ore-cannon").special).splash).toBe("same");
    expect(weaponSpecial(w("void/proton-bolter").special).onHit).toBeNull(); // a Burst rule, not a hit roll
    expect(weaponSpecial("")).toMatchObject({ bioBonus: 0, onHit: null });
  });
});

describe("throwing weapons", () => {
  it("always hit; each matching interrupt subtracts", () => {
    const o = card("OCTAPHEX"); // Carapace Shell Primary 4s, 6s −1
    expect(resolveThrow("pipe", o, 2, 2)).toMatchObject({ damage: 5, deflected: false });
    expect(resolveThrow("spiked", o, 4, 2)).toMatchObject({ damage: 9, deflected: true });
    const robot = { type: "R" as const, interrupts: [] };
    expect(resolveThrow("pipe", robot, 1, 1).damage).toBe(0); // U35
    expect(resolveThrow("mag", robot, 1, 1).damage).toBe(30);
    expect(resolveThrow("mag", o, 1, 1).damage).toBe(0);
    expect(resolveThrow("oil", o, 4, 1)).toMatchObject({ works: false, damage: 0 });
    expect(resolveThrow("oil", o, 1, 1).works).toBe(true);
    expect(resolveThrow("diffusion", robot, 1, 1).works).toBe(true);
    expect(resolveThrow("diffusion", o, 4, 4)).toMatchObject({ works: false, reduce: 0 });
    const both = { type: "B" as const, interrupts: [parseInterrupt("A on Primary 2s -1 damage")!, parseInterrupt("B on Secondary 3s -2 damage")!] };
    expect(resolveThrow("spiked", both, 2, 3).damage).toBe(7);
    expect(throwProblem("mag", { hull: true, reinforced: false })).not.toBeNull();
    expect(throwProblem("mag", { hull: true, reinforced: true })).toBeNull();
  });
});

describe("winning", () => {
  it("XP only for close-combat kills", () => {
    expect(fightXp([{ xp: 9, killedBy: "melee" }, { xp: 14, killedBy: "ranged" }, { xp: 5, killedBy: "melee", noXp: true }, { xp: 7, killedBy: null }])).toBe(9);
  });
  it("Insight: +1 per die on cache rolls", () => {
    expect(insightMod("2D6")).toBe(2);
    expect(insightMod("D6")).toBe(1);
    expect(insightMod("D66")).toBe(11);
  });
  it("turrets are ranged-only foes", () => {
    const t = makeTurret("Automated Turret", 5, "Energy Blaster 7*, D6 -2");
    expect(t).toMatchObject({ turret: true, hp: 5, man: [], ranged: { marks: 7, hullOk: true, dmg: { dice: 1, mod: -2 } } });
  });
});

describe("patrol SPECIAL from the Hulk turn", () => {
  it("applies HP, Shift, misses and attacks-first; leaves room-size rules to the player", () => {
    expect(patrolSpecial("It’s caught off guard and misses the first round.")).toMatchObject({ skip: true, roll: null });
    expect(patrolSpecial("Drops from the vents and attacks first.").first).toBe(true);
    expect(patrolSpecial("-1 Shift in the first two rounds of combat as it wakes up.")).toMatchObject({ earlyShift: -1, earlyRounds: 2, shift: 0 });
    expect(patrolSpecial("-1 Shift in the first round of combat.")).toMatchObject({ earlyShift: -1, earlyRounds: 1 });
    expect(patrolSpecial("-1 Shift in a small room")).toMatchObject({ shift: 0, manual: "-1 Shift in a small room" });
    const roll = "Roll a D6. 4-6= It’s wounded and has -8 HP.";
    expect(patrolSpecial(roll)).toMatchObject({ roll: { lo: 4, hi: 6 }, hp: 0 });
    expect(patrolSpecial(roll, 5).hp).toBe(-8);
    expect(patrolSpecial(roll, 2).hp).toBe(0);
    expect(patrolSpecial("Roll a D6 after the combat. 4-6= Another appears.")).toMatchObject({ roll: null, manual: expect.stringMatching(/Another/) });
    expect(patrolSpecial("")).toMatchObject({ hp: 0, applied: [] });
  });
});
