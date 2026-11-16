// The gameplay coach's card markup and the tutorial's scripted dice.
import { afterEach, describe, expect, it } from "vitest";
import { coachBody, ruleHref, type CoachScript } from "../src/ui/coach";
import { clearRig, rig, rigArmed, takeRig } from "../src/dice/rig";

const script: CoachScript = {
  id: "t",
  name: "Test tutorial",
  steps: [
    { id: "a", title: "First", body: ["One."], rules: [{ label: "Making a survivor", section: "void/p9-1" }] },
    { id: "b", title: "Second", body: ["Two."], done: () => false },
    { id: "c", title: "Last", body: ["Three."] },
  ],
};

describe("coach card", () => {
  it("links each rule to its book section, opened by the coach", () => {
    const out = String(coachBody(script, 0));
    expect(ruleHref("void/p9-1")).toBe("#/s/void%2Fp9-1");
    expect(out).toContain('href="#/s/void%2Fp9-1"');
    expect(out).toContain('data-coach-rule="void/p9-1"');
    expect(out).toContain("Making a survivor");
    expect(out).toContain("1 of 3");
  });
  it("a step that waits for the page offers Skip ahead, not Next", () => {
    const out = String(coachBody(script, 1));
    expect(out).toContain("Skip ahead");
    expect(out).toContain("carries on by itself");
    expect(out).toContain('data-coach-act="back"');
  });
  it("the last step finishes or keeps the survivor", () => {
    const out = String(coachBody(script, 2));
    expect(out).toContain('data-coach-act="finish"');
    expect(out).toContain('data-coach-act="keep"');
    expect(out).not.toContain('data-coach-act="next"');
  });
  it("folds down to its title, and asks before ending", () => {
    const folded = String(coachBody(script, 0, { folded: true }));
    expect(folded).toContain("First");
    expect(folded).not.toContain("One.");
    expect(String(coachBody(script, 0, { confirmQuit: true }))).toContain('data-coach-act="quit-yes"');
  });
});

describe("scripted dice", () => {
  afterEach(() => clearRig());
  it("is empty unless the tutorial arms it", () => {
    expect(rigArmed()).toBe(false);
    expect(takeRig("D66")).toBeNull();
  });
  it("hands out matching entries in order, once each", () => {
    rig([{ kind: "D66", dice: [4, 3] }, { kind: "D66", dice: [2, 3] }, { kind: "D6", dice: [4] }]);
    expect(takeRig("D6")).toEqual([4]);
    expect(takeRig("d66")).toEqual([4, 3]);
    expect(takeRig("D66")).toEqual([2, 3]);
    expect(takeRig("D66")).toBeNull();
  });
  it("reads 1D6 as D6 and ignores spaces and case", () => {
    rig([{ kind: "D6", dice: [2] }]);
    expect(takeRig(" 1d6 ")).toEqual([2]);
  });
  it("a different kind or tag rolls normally", () => {
    rig([{ kind: "2D6", dice: [6, 5], tag: "foe:shot" }]);
    expect(takeRig("2D6")).toBeNull();
    expect(takeRig("D66", "foe:shot")).toBeNull();
    expect(takeRig("2D6", "foe:shot")).toEqual([6, 5]);
  });
  it("kept entries stay armed; '*' matches any kind and gets the die count", () => {
    rig([{ kind: "*", tag: "you:damage", dice: (n) => Array(n).fill(5), keep: true }]);
    expect(takeRig("2D6", "you:damage", 2)).toEqual([5, 5]);
    expect(takeRig("D6", "you:damage", 1)).toEqual([5]);
    expect(rigArmed()).toBe(true);
  });
  it("a face function returning null, or a bad face, rolls normally", () => {
    rig([{ kind: "D66", dice: () => null }, { kind: "D6", dice: [7] }]);
    expect(takeRig("D66")).toBeNull();
    expect(takeRig("D6")).toBeNull();
  });
  it("clearRig disarms everything", () => {
    rig([{ kind: "D6", dice: [1], keep: true }]);
    clearRig();
    expect(takeRig("D6")).toBeNull();
  });
});
