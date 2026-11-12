import { describe, it, expect } from "vitest";
import { fatigueText, signed, stepHp, xpPct } from "../src/shell/charmodel";

describe("stepHp", () => {
  it("never goes below 0", () => {
    expect(stepHp(5, 1)).toBe(6);
    expect(stepHp(0, -1)).toBe(0);
    expect(stepHp(3, -1)).toBe(2);
  });
  it("is not capped at the baseline (the book lets potions, scrolls and level-ups exceed it)", () => {
    expect(stepHp(10, 1)).toBe(11);
    expect(stepHp(25, 1)).toBe(26);
    expect(stepHp(25, -1)).toBe(24);
  });
});

describe("fatigueText", () => {
  it("shows the die only during a fight", () => {
    expect(fatigueText({ phase: "you", fatigue: 3 })).toBe("3");
    expect(fatigueText({ phase: "foes", fatigue: 2 })).toBe("2");
    expect(fatigueText({ phase: "setup", fatigue: 4 })).toBe("—");
    expect(fatigueText({ phase: "won", fatigue: 4 })).toBe("—");
    expect(fatigueText(null)).toBe("—");
  });
});

describe("xpPct", () => {
  it("fills towards the next threshold and is full at the top", () => {
    expect(xpPct(50, 100)).toBe(50);
    expect(xpPct(150, 100)).toBe(100);
    expect(xpPct(9999, Infinity)).toBe(100);
  });
  it("signs numbers", () => {
    expect(signed(2)).toBe("+2");
    expect(signed(0)).toBe("+0");
    expect(signed(-1)).toBe("-1");
  });
});
