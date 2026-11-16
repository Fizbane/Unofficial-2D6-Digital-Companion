import { describe, expect, it } from "vitest";
import { addRangedHit, newVoidCharacter, normaliseVChar, RANGED_HITS_BAR, setRangedHits } from "../src/tools/void/sheetmodel";

describe("Ranged Hits bar", () => {
  it("pays out on the 10th hit", () => {
    const c = newVoidCharacter("Freighter Captain");
    const m = c.marksmanship;
    for (let i = 1; i < RANGED_HITS_BAR; i++) expect(addRangedHit(c).filled).toBe(false);
    const r = addRangedHit(c);
    expect(r).toMatchObject({ filled: true, capped: false });
    expect(r.xp).toBeGreaterThan(0);
    expect(c.marksmanship).toBe(m + 1);
    expect(c.rangedHits).toBe(0);
  });
  it("pays out when the last box is ticked by hand", () => {
    const c = newVoidCharacter("Freighter Captain");
    const m = c.marksmanship;
    const xp = c.xp;
    const r = setRangedHits(c, RANGED_HITS_BAR);
    expect(r.filled).toBe(true);
    expect(c.marksmanship).toBe(m + 1);
    expect(c.xp).toBeGreaterThan(xp);
    expect(c.rangedHits).toBe(0);
  });
  it("unticking just sets the count", () => {
    const c = newVoidCharacter("Freighter Captain");
    setRangedHits(c, 6);
    expect(setRangedHits(c, 3).filled).toBe(false);
    expect(c.rangedHits).toBe(3);
  });
  it("reports when Marksmanship is already at its max", () => {
    const c = newVoidCharacter("Freighter Captain");
    c.marksmanship = 10;
    const r = setRangedHits(c, RANGED_HITS_BAR);
    expect(r).toMatchObject({ filled: true, capped: true });
    expect(c.marksmanship).toBe(10);
  });
  it("keeps imported counts on the bar", () => {
    expect(normaliseVChar({ rangedHits: 14 } as never).rangedHits).toBe(RANGED_HITS_BAR - 1);
    expect(normaliseVChar({ rangedHits: -3 } as never).rangedHits).toBe(0);
  });
});
