import { describe, expect, it } from "vitest";
import { closedSet, guessCell } from "../src/lock/closedset";
import { fieldHash } from "../src/lock/hash";

const key = new Uint8Array(32).fill(7);
const hashOf = (t: string) => fieldHash(key, "cell", "void/x", 0, 7, 1, t);

describe("closed set for card cells", () => {
  it("finds levels, deflections, numbers and field names by their keyed hash", () => {
    for (const t of ["L3 {circled R}", "4s", "2s, 5s", "14", "+1", "DEFLECTION", "[6][6] PRIME ATTACK ROLL"])
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
});
