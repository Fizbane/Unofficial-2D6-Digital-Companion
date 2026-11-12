import { describe, expect, it } from "vitest";
import { addRoom, openExits } from "../../src/tools/dmap";
import {
  HULK_H, HULK_W, L10_CHAIN, LEVEL_TABLES, SSRT1, addSecretDoor, aliensIn, barrierDice, bestSingleExit, bioLimb, classifyDrawn, classifyRolled, clockwiseWalls, exitCount, exitTypeFor,
  exploredPct, forceSliding, hackSecurity, hulkMap, identityTable, isLocked, ladderCell, needsSecondRoll, parseVoidExit, patrolTable, placeHulkExits, resolveDimensions,
  restBetweenLevels, secretDoorAllowed, setupLevel, specialUniques, tableCodesIn, tickTrackers, uniqueRule, uniqueVerdict,
} from "../../src/tools/void/hulkmodel";

describe("room size roll (D66, doubles)", () => {
  it("reads Primary as X and Secondary as Y", () => {
    expect(resolveDimensions([4, 3])).toMatchObject({ x: 4, y: 3, kind: "regular" });
    expect(resolveDimensions([3, 5])).toMatchObject({ x: 3, y: 5, kind: "regular" });
  });
  it("doubles 1–5 roll again and add; double 6 is 6×6 with no re-roll", () => {
    expect(needsSecondRoll([4, 4])).toBe(true);
    expect(needsSecondRoll([6, 6])).toBe(false);
    expect(needsSecondRoll([2, 5])).toBe(false);
    expect(resolveDimensions([4, 4], [3, 2])).toMatchObject({ x: 7, y: 6, kind: "large" }); // the p17 example
    expect(resolveDimensions([6, 6])).toMatchObject({ x: 6, y: 6, kind: "large" });
    expect(resolveDimensions([2, 2], [1, 3])).toMatchObject({ x: 3, y: 5, kind: "regular" });
    expect(() => resolveDimensions([3, 3])).toThrow();
  });
  it("a second double doesn't re-roll again", () => {
    expect(resolveDimensions([5, 5], [5, 5])).toMatchObject({ x: 10, y: 10, kind: "large" });
  });
  it("a non-doubled 1 is a corridor; doubled 1s expand instead", () => {
    expect(resolveDimensions([1, 5]).kind).toBe("corridor");
    expect(resolveDimensions([6, 1]).kind).toBe("corridor");
    expect(resolveDimensions([1, 1], [1, 4])).toMatchObject({ x: 2, y: 5, kind: "regular" });
  });
});

describe("room classification", () => {
  it("rolled: 2-3 / 3-2 small, doubles ≥ 32 large", () => {
    expect(classifyRolled(2, 3, false)).toBe("small");
    expect(classifyRolled(3, 2, false)).toBe("small");
    expect(classifyRolled(6, 5, false)).toBe("regular");
    expect(classifyRolled(8, 4, true)).toBe("large");
    expect(classifyRolled(5, 6, true)).toBe("regular");
  });
  it("drawn: squeezed to one square wide = corridor, ≤ 6 squares = small, large under 32 = standard", () => {
    expect(classifyDrawn("regular", 1, 4)).toBe("corridor");
    expect(classifyDrawn("regular", 2, 3)).toBe("small");
    expect(classifyDrawn("large", 6, 6)).toBe("large");
    expect(classifyDrawn("large", 6, 4)).toBe("regular");
    expect(classifyDrawn("corridor", 5, 1)).toBe("corridor");
    expect(classifyDrawn("regular", 4, 4)).toBe("regular");
  });
});

describe("exits", () => {
  it("counts: 1 none, 2–3 one, 4–5 two, 6 three", () => {
    expect([1, 2, 3, 4, 5, 6].map(exitCount)).toEqual([0, 1, 1, 2, 2, 3]);
  });
  it("walls run clockwise from the entry wall", () => {
    expect(clockwiseWalls("S")).toEqual(["W", "N", "E"]);
    expect(clockwiseWalls("W")).toEqual(["N", "E", "S"]);
  });
  it("D3 picks the first wall clockwise, the rest carry on clockwise; never the entry wall or the hull", () => {
    const m = hulkMap();
    const r = addRoom(m, { n: 2, x: 6, y: 10, w: 4, h: 4, kind: "regular", label: "R", sub: "" });
    const ex = placeHulkExits(m, r, "S", 2, "sliding", 2);
    expect(ex.map((e) => e.side)).toEqual(["N", "E"]);
    expect(ex.every((e) => e.type === "sliding")).toBe(true);
    const ex3 = placeHulkExits(m, r, "S", 3, "archway", 3); // re-roll replaces the unused exits
    expect(ex3.map((e) => e.side)).toEqual(["E", "W", "N"]);
    expect(m.exits.filter((e) => e.room === r.id)).toHaveLength(3);
  });
  it("skips walls on the Hull Boundary", () => {
    const m = hulkMap();
    const r = addRoom(m, { n: 2, x: 0, y: 0, w: 3, h: 3, kind: "regular", label: "R", sub: "" }); // north-west corner
    const ex = placeHulkExits(m, r, "S", 3, "archway", 1);
    expect(ex.map((e) => e.side)).toEqual(["E"]);
  });
  it("exit types come from the table, but small rooms, corridors and L10 are archways", () => {
    expect(parseVoidExit("SLIDING DOORS")).toBe("sliding");
    expect(parseVoidExit("SECURITY DOORS")).toBe("security");
    expect(parseVoidExit("BIO-CODED DOORS")).toBe("biocoded");
    expect(parseVoidExit("ELECTRICAL BARRIERS")).toBe("barrier");
    expect(parseVoidExit("ARCHWAYS")).toBe("archway");
    expect(exitTypeFor(3, "small", "SECURITY DOORS")).toBe("archway");
    expect(exitTypeFor(3, "corridor", "SECURITY DOORS")).toBe("archway");
    expect(exitTypeFor(3, "regular", "SECURITY DOORS")).toBe("security");
    expect(exitTypeFor(10, "regular", "SECURITY DOORS")).toBe("archway");
  });
});

describe("doors", () => {
  it("lock check D6: sliding on 6, security on 5–6, bio-coded on 4–6", () => {
    expect([1, 2, 3, 4, 5, 6].filter((d) => isLocked("sliding", d))).toEqual([6]);
    expect([1, 2, 3, 4, 5, 6].filter((d) => isLocked("security", d))).toEqual([5, 6]);
    expect([1, 2, 3, 4, 5, 6].filter((d) => isLocked("biocoded", d))).toEqual([4, 5, 6]);
    expect(isLocked("archway", 6)).toBe(false);
  });
  it("crowbar, hacking, limbs and barriers", () => {
    expect(forceSliding(5, 5)).toBe(true);
    expect(forceSliding(6, 5)).toBe(false);
    expect(hackSecurity(7, 5, 1)).toMatchObject({ total: 7, ok: false });
    expect(hackSecurity(7, 5, 2)).toMatchObject({ total: 5, ok: true, modifier: -2 });
    expect(bioLimb(3, false)).toBe(false);
    expect(bioLimb(3, true)).toBe(true);
    expect(barrierDice(4)).toBe("4D6");
  });
});

describe("room tables by level and size", () => {
  it("standard, small and large rooms use their level's tables", () => {
    expect(identityTable(1, "regular").sectionId).toBe(LEVEL_TABLES[1].rooms);
    expect(identityTable(4, "small").sectionId).toBe(LEVEL_TABLES[4].sr);
    expect(identityTable(7, "large").sectionId).toBe(LEVEL_TABLES[7].lr);
    expect(identityTable(2, "corridor").sectionId).toBeNull();
  });
  it("level 9 small rooms go through SSRT1; level 10 is a fixed chain", () => {
    expect(identityTable(9, "small")).toMatchObject({ sectionId: SSRT1, via: "ssrt" });
    expect(identityTable(10, "regular").sectionId).toBeNull();
    expect(L10_CHAIN).toHaveLength(9);
    expect(L10_CHAIN.filter((r) => r.alien).map((r) => r.alien)).toEqual(["AI TENTACLES", "AI GENOFRAME", "AI SPINE", "AI BRAIN"]);
    expect(L10_CHAIN[8]).toMatchObject({ w: 4, h: 4, label: "Escape Pod Room" });
  });
  it("patrols: L1–8 only", () => {
    expect(patrolTable(1)).toBe(LEVEL_TABLES[1].patrol);
    expect(patrolTable(8)).toBe(LEVEL_TABLES[8].patrol);
    expect(patrolTable(9)).toBeNull();
    expect(patrolTable(10)).toBeNull();
  });
});

describe("unique rooms", () => {
  it("YES = one per level, NN% YES also waits for NN% explored", () => {
    expect(uniqueRule("YES")).toEqual({ unique: true, pct: null });
    expect(uniqueRule("NO")).toEqual({ unique: false, pct: null });
    expect(uniqueRule("75% YES")).toEqual({ unique: true, pct: 75 });
    expect(uniqueVerdict("LOADING BAY", "YES", ["LOADING BAY"], 10)).toBe("duplicate");
    expect(uniqueVerdict("HAZARD ZONE*", "YES", ["HAZARD ZONE"], 10)).toBe("duplicate");
    expect(uniqueVerdict("MESS HALL", "NO", ["MESS HALL"], 10)).toBe("ok");
    expect(uniqueVerdict("ORNATE THRONE*", "75% YES", [], 60)).toBe("too-early");
    expect(uniqueVerdict("ORNATE THRONE*", "75% YES", [], 80)).toBe("ok");
  });
  it("finds a table's special unique rooms", () => {
    const cols = ["ROLL", "ROOM TYPE", "DESCRIPTION", "UNIQUE"];
    expect(specialUniques(cols, [["[1][1]", "A", "", "NO"], ["[4][3]", "MONITOR CHAMBER*", "", "80% YES"]])).toEqual([{ name: "MONITOR CHAMBER*", pct: 80, row: 1 }]);
  });
});

describe("level setup and transitions", () => {
  it("level 1: a 17×28 hull, the 4×2 entrance room mid-south with three archways", () => {
    const s = setupLevel(1, null);
    expect([s.map.w, s.map.h]).toEqual([HULK_W, HULK_H]);
    expect(s.entrance).toMatchObject({ w: 4, h: 2, kind: "entrance" });
    expect(s.map.entrance?.y).toBe(HULK_H - 1);
    expect(openExits(s.map)).toHaveLength(3);
    expect(openExits(s.map).every((e) => e.type === "archway")).toBe(true);
  });
  it("later levels: the up-ladder sits directly below the last down-ladder", () => {
    const s = setupLevel(3, { x: 10, y: 2 });
    expect(s.ladderIn).toEqual({ x: 10, y: 2 });
    const ladder = s.map.exits.find((e) => e.to === -1)!;
    expect([ladder.x, ladder.y]).toEqual([10, 2]);
    expect(ladder.room).toBe(s.entrance.id);
    expect(s.entrance).toMatchObject({ w: 2, h: 3 });
    expect(openExits(s.map).length).toBeGreaterThanOrEqual(2);
  });
  it("level 9 draws the Void Chamber in the middle; level 10 has one exit in the west wall", () => {
    const s9 = setupLevel(9, { x: 4, y: 3 });
    const vc = s9.map.rooms.find((r) => r.id === s9.voidChamber)!;
    expect(vc).toMatchObject({ w: 3, h: 3, label: "Void Chamber" });
    expect(s9.map.exits.some((e) => e.room === vc.id)).toBe(false);
    const s10 = setupLevel(10, { x: 4, y: 3 });
    expect(s10.entrance).toMatchObject({ w: 3, h: 2 });
    expect(openExits(s10.map).map((e) => e.side)).toEqual(["W"]);
  });
  it("level 10's single exit opens towards room for the next room", () => {
    const s = setupLevel(10, null);
    const m = s.map;
    const r = addRoom(m, { n: 2, x: 0, y: 20, w: 2, h: 3, kind: "small", label: "S", sub: "" });
    const e = bestSingleExit(m, r, "W", { w: 6, h: 6 });
    expect(e?.side).not.toBe("W");
  });
  it("the ladder goes in the room's bottom-right square", () => {
    expect(ladderCell({ id: 1, n: 1, x: 3, y: 4, w: 3, h: 2, kind: "regular", label: "", sub: "" })).toEqual({ x: 5, y: 5 });
  });
  it("explored % and the secret door", () => {
    const s = setupLevel(1, null);
    const pct = exploredPct(s.map);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(5);
    expect(secretDoorAllowed(s.map, pct)).toBe(false); // open exits remain
    for (const e of s.map.exits) e.blocked = true;
    expect(secretDoorAllowed(s.map, pct)).toBe(true);
    const sd = addSecretDoor(s.map)!;
    expect(sd.type).toBe("secret");
    expect(openExits(s.map)).toHaveLength(1);
  });
  it("resting between levels", () => {
    expect(restBetweenLevels({ hp: 10, baseline: 22, charLevel: 2, ration: "full", cloth: false })).toMatchObject({ hp: 14, delta: 4 });
    expect(restBetweenLevels({ hp: 10, baseline: 22, charLevel: 2, ration: "full", cloth: true })).toMatchObject({ hp: 16 });
    expect(restBetweenLevels({ hp: 21, baseline: 22, charLevel: 2, ration: "full", cloth: false })).toMatchObject({ hp: 22 });
    expect(restBetweenLevels({ hp: 30, baseline: 22, charLevel: 2, ration: "full", cloth: false })).toMatchObject({ hp: 30 }); // above baseline stays
    expect(restBetweenLevels({ hp: 15, baseline: 22, charLevel: 2, ration: "none", cloth: false })).toMatchObject({ hp: 8, delta: -7 });
    expect(restBetweenLevels({ hp: 60, baseline: 60, charLevel: 5, ration: "none", cloth: false })).toMatchObject({ hp: 40 }); // max 20
    expect(restBetweenLevels({ hp: 15, baseline: 22, charLevel: 2, ration: "parts", cloth: false })).toMatchObject({ hp: 12 });
  });
});

describe("per-room trackers", () => {
  it("Bloodied ticks to 8 then fever; Stunned counts down", () => {
    expect(tickTrackers({ bloodied: 0, stunned: 0 })).toMatchObject({ bloodied: 0, stunned: 0, hpLoss: 0 });
    expect(tickTrackers({ bloodied: 3, stunned: 2 })).toMatchObject({ bloodied: 4, stunned: 1, hpLoss: 0 });
    expect(tickTrackers({ bloodied: 8, stunned: 1 })).toMatchObject({ bloodied: 8, stunned: 0, hpLoss: 1 });
  });
});

describe("reading room text", () => {
  const has = (c: string) => ["UTIT1", "GACT1", "L1PT", "IAUT1"].includes(c);
  it("finds tables to roll, in order, with modifiers", () => {
    expect(tableCodesIn("You can search the space by rolling on UTIT1 and GACT1.", has)).toEqual([{ code: "UTIT1", modifier: 0 }, { code: "GACT1", modifier: 0 }]);
    expect(tableCodesIn("Roll on L1PT -2 and defend yourself. Also, roll on IAUT1.", has)).toEqual([{ code: "L1PT", modifier: -2 }, { code: "IAUT1", modifier: 0 }]);
    expect(tableCodesIn("Lose 3 HP. Roll on the Level Patrol Table +1.", has, "L1PT")).toEqual([{ code: "L1PT", modifier: 1 }]);
    expect(tableCodesIn("A HC-5 and nothing else", has)).toEqual([]);
  });
  it("finds aliens named in capitals", () => {
    expect(aliensIn("an OCTAPHEX jumps out and attacks", ["Octaphex", "Acid Drooler"])).toEqual(["OCTAPHEX"]);
    expect(aliensIn("two ACID DROOLERS attack", ["ACID DROOLER"])).toEqual(["ACID DROOLER"]);
    expect(aliensIn("an octaphex shell", ["OCTAPHEX"])).toEqual([]);
  });
});
