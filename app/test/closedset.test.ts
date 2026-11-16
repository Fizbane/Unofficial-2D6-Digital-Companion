import { describe, expect, it } from "vitest";
import { closedSet, guessCell, guessDicePrefixed, guessSlice } from "../src/lock/closedset";
import { fieldHash } from "../src/lock/hash";

const key = new Uint8Array(32).fill(7);
const hashOf = (t: string) => fieldHash(key, "cell", "void/x", 0, 7, 1, t);

describe("closed set for card cells", () => {
  it("finds levels, deflections, numbers and field names by their keyed hash", () => {
    for (const t of ["L3 {circled R}", "4s", "2s, 5s", "14", "+1", "DEFLECTION", "[6][6] PRIME ATTACK ROLL"])
      expect(guessCell(hashOf(t), hashOf)).toBe(t);
  });
  it("recovers Dungeon card levels, XP and outcome labels", () => {
    for (const t of ["L7 {circled H}", "L10 {circled M}", "1850", "7000", "TREASURE", "MISHAP ATTACK ROLL [1][1]"])
      expect(guessCell(hashOf(t), hashOf)).toBe(t);
  });
  it("does not invent text outside the set", () => {
    expect(guessCell(hashOf("These vile creatures drool"), hashOf)).toBeUndefined();
    expect(guessCell(hashOf("L1 {circled Z}"), hashOf)).toBeUndefined();
  });
  it("is the same list every time and holds no duplicates", () => {
    const a = closedSet();
    expect(closedSet()).toBe(a);
    expect(new Set(a).size).toBe(a.length);
  });
  it("a hash made with another key matches nothing", () => {
    const other = (t: string) => fieldHash(new Uint8Array(32).fill(9), "cell", "void/x", 0, 7, 1, t);
    expect(guessCell(other("4s"), hashOf)).toBeUndefined();
  });
  it("knows deflections of both attack kinds", () => {
    for (const t of ["none", "Primary 5s", "Primary 4s; Secondary 2s", "Secondary 1s, 3s"]) expect(guessCell(hashOf(t), hashOf)).toBe(t);
  });
  it("takes one interrupt out of a box read with its label, the next interrupt and die-face noise", () => {
    const a = "Alpha Beta on Primary 3s and 4s -2 damage", b = "Gamma on Secondary 2s and 3s -1 damage";
    const read = "INTERRUPT Alpha Beta on Primary 3s and[4s)-2 damage Gamma on Secondary 2s and 3s -1 damage";
    expect(guessSlice(hashOf(a), read, hashOf)).toBe(a);
    expect(guessSlice(hashOf(b), read, hashOf)).toBe(b);
    expect(guessSlice(hashOf("Delta on Primary 1s"), read, hashOf)).toBeUndefined();
  });
  it("repairs a manoeuvre read with stray dice characters, a missing space and a misread 'special'", () => {
    const t = "[3][4] - SOME MOVE = D6 -2 + special - it does more";
    expect(guessDicePrefixed(hashOf(t), "I:l - SOME MOVE=D6-2 + vial - it does more", hashOf)).toBe(t);
  });
});
