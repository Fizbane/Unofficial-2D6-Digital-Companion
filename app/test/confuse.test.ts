import { describe, it, expect } from "vitest";
import { confusions } from "../src/lock/confuse";

describe("confusions", () => {
  it("swaps 1 for l", () => {
    expect([...confusions("c1oak")]).toContain("cloak");
  });
  it("swaps rn for m", () => {
    expect([...confusions("rnage")]).toContain("mage");
  });
  it("finds a pair of substitutions", () => {
    expect([...confusions("5ce1l")]).toContain("Scell");
    expect([...confusions("B0ok")]).toContain("8Ook");
  });
  it("yields singles before pairs", () => {
    const all = [...confusions("1O")];
    expect(all.indexOf("lO")).toBeLessThan(all.indexOf("l0"));
  });
  it("swaps the Codex font's common misreads: y/v, t/f and comma/period", () => {
    expect([...confusions("If vou survive")]).toContain("If you survive");
    expect([...confusions("stafs")]).toContain("stats");
    expect([...confusions("pots. cutting")]).toContain("pots, cutting");
  });
  it("edits trailing punctuation", () => {
    const all = [...confusions("Gold")];
    expect(all).toContain("Gold.");
    expect(all).toContain("Gold:");
    expect([...confusions("Gold;")]).toContain("Gold");
  });
  it("tries no quote or dash forms (norm() folds them, so they could never change a hash)", () => {
    expect([...confusions("it's a - b")].some((c) => /[’‘–—]/.test(c))).toBe(false);
  });
  it("never yields the input or a duplicate", () => {
    const all = [...confusions("ll1I")];
    expect(all).not.toContain("ll1I");
    expect(new Set(all).size).toBe(all.length);
  });
  it("caps candidates at 2000 for a 200-character string", () => {
    const s = "l1IO0rnclS5B8'\"-.".repeat(12).slice(0, 200);
    let n = 0;
    for (const _ of confusions(s)) n++;
    expect(n).toBeLessThanOrEqual(2000);
    expect(n).toBe(2000);
  });
  it("honours a smaller max", () => {
    expect([...confusions("l1l1l1", 5)].length).toBe(5);
  });
});
