import { describe, expect, it } from "vitest";
import { applyCondition, conditionsIn } from "../src/tools/void/conditiontext";
import { newVoidCharacter } from "../src/tools/void/sheetmodel";

// The sentences are made up; they only follow the books' patterns ("gain the Stunned 3 condition").
describe("conditionsIn", () => {
  it("applies plain statements", () => {
    expect(conditionsIn("A steam valve bursts beside you. Gain Stunned 3.")).toEqual([{ kind: "stun", n: 3, auto: true }]);
    expect(conditionsIn("Sharp grit sprays across the deck: gain Bloodied.")).toEqual([{ kind: "bloodied", n: 1, auto: true }]);
    expect(conditionsIn("A quiet corner. Remove Stunned now.")).toEqual([{ kind: "clearStunned", n: 0, auto: true }]);
  });
  it("offers conditional ones", () => {
    expect(conditionsIn("Test your nerve: on 5 or lower, gain the Bloodied condition.")).toEqual([{ kind: "bloodied", n: 1, auto: false }]);
    expect(conditionsIn("You could climb the broken rail, and doing so gain Bloodied.")[0].auto).toBe(false);
    expect(conditionsIn("You may rinse off at the tap to remove Bloodied.")).toEqual([{ kind: "clearBloodied", n: 0, auto: false }]);
  });
  it("reads both conditions in one clause", () => {
    expect(conditionsIn("The medbay hums. Remove Bloodied and Stunned at once.").map((h) => h.kind)).toEqual(["clearBloodied", "clearStunned"]);
  });
  it("ignores text that only mentions a condition", () => {
    expect(conditionsIn("A Bloodied rag hangs from a hook.")).toEqual([]);
  });
});

describe("applyCondition", () => {
  it("changes the survivor and reports it", () => {
    const c = newVoidCharacter("Freighter Captain");
    expect(applyCondition(c, { kind: "stun", n: 3, auto: true })).toBe("Stunned 3.");
    expect(applyCondition(c, { kind: "bloodied", n: 1, auto: true })).toBe("Bloodied 1/8.");
    expect(applyCondition(c, { kind: "bloodied", n: 1, auto: true })).toBeNull();
    expect(applyCondition(c, { kind: "clearStunned", n: 0, auto: true })).toBe("No longer Stunned.");
    expect(c.stunned).toBe(0);
  });
});
