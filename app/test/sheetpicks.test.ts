import { describe, it, expect } from "vitest";
import type { Section } from "../src/types";
import { addLine, armourPicks, artefactPicks, artefactTips, enhancementPicks, fillFirstEmpty, leadName, namedFor, pickFor, potionPicks, questPicks, scrollPicks, splitNamed } from "../src/tools/sheetpicks";

// made-up tables in the books' shapes (no book text in tests)
const sec = (id: string, columns: string[], rows: string[][], code?: string): [string, Section] => [
  id,
  { id, blocks: [{ type: "table", table: { title: "T", code, dice: null, columns, rows } }] } as unknown as Section,
];
const byId = new Map<string, Section>([
  sec("codex/armour-table-1", ["ARMOUR TYPE", "DICE SET", "MODIFIER", "COST"], [["TIN HAT", "[4]", "-1 Damage", "9gc"], ["", "", "", ""]]),
  sec("codex/magic-scroll-table-1", ["SCROLL OF", "EFFECT", "DURATION", "ORBIT", "DISPEL Ds", "COST", "FAIL", "MODIFIER/EFFECT"], [["HUMMING", "x", "y", "FACULTY", "NONE", "1gc", "+1", "+1 TUNE"]]),
  sec("codex/magic-potions-table-1", ["POTION OF", "EFFECT MODIFIER", "DURATION", "COST"], [["FIZZ", "Heal a bit", "INSTANT", "2gc"]]),
  sec("void/p53-1", ["Roll", "Result"], [["2", "Glass Spoon - it hums."], ["3", "Tin Whistle – it sings."]], "TEST1"),
  sec("void/x-1", ["Roll", "Result"], [
    ["1", "A thing is here. Add the ‘Lost Sock’ quest."],
    ["2", "You now have the Wobbly Knee Mutation. +1 to hopping. This is a permanent Biological Enhancement, so record it on your sheet."],
    ["3", "Something odd happens. You glow. This is a permanent Biological Enhancement, so record it on your sheet."],
  ], "ODD1"),
]);

describe("sheet pick lists", () => {
  it("reads armour, scrolls and potions as sheet rows", () => {
    expect(armourPicks(byId)).toEqual([{ label: "Tin Hat · [4] -1 Damage · 9gc", row: ["Tin Hat", "[4]", "-1 Damage"], tip: "Dice Set: [4]\nModifier: -1 Damage\nCost: 9gc" }]);
    expect(scrollPicks(byId)[0].row).toEqual(["Scroll of Humming", "FACULTY", "NONE", "+1 TUNE"]);
    expect(potionPicks(byId)[0]).toEqual({ label: "Fizz", row: ["Potion of Fizz", "Heal a bit"], tip: "Effect Modifier: Heal a bit\nDuration: INSTANT\nCost: 2gc" });
    expect(pickFor(armourPicks(byId), " tin  hat ")?.tip).toContain("Cost: 9gc");
    expect(pickFor(armourPicks(byId), "Bucket")).toBeUndefined();
    expect(pickFor(armourPicks(byId), "")).toBeUndefined();
  });

  it("gives empty lists when a table can't be read (a locked book)", () => {
    const none = new Map<string, Section>();
    expect([armourPicks(none), scrollPicks(none), potionPicks(none), artefactPicks(none), questPicks(none), enhancementPicks(none)]).toEqual([[], [], [], [], [], []]);
  });

  it("fills the first empty row, and says when there is none", () => {
    const rows = [["Kept", "", ""], ["", "", ""]];
    expect(fillFirstEmpty(rows, ["New", "[1]", "-1"])).toBe(true);
    expect(rows).toEqual([["Kept", "", ""], ["New", "[1]", "-1"]]);
    expect(fillFirstEmpty(rows, ["More", "", ""])).toBe(false);
  });

  it("names artefacts by the lead of their cell, and adds each to a text list once", () => {
    expect(artefactPicks(byId)).toEqual(["Glass Spoon", "Tin Whistle"]);
    expect(leadName("Tin Whistle – it sings.")).toBe("Tin Whistle");
    expect(addLine("Glass Spoon", "Tin Whistle")).toBe("Glass Spoon\nTin Whistle");
    expect(addLine("Glass Spoon\n", "glass spoon")).toBe("Glass Spoon");
  });

  it("finds the quests and enhancements that table results hand out", () => {
    expect(questPicks(byId)).toEqual([{ label: "Lost Sock (ODD1)", text: "Lost Sock", detail: "A thing is here. Add the ‘Lost Sock’ quest." }]);
    expect(enhancementPicks(byId).map((p) => [p.label, p.text])).toEqual([
      ["ODD1 3", "ODD1 3: You glow."],
      ["Wobbly Knee Mutation (ODD1)", "Wobbly Knee Mutation: +1 to hopping."],
    ]);
    expect(namedFor(enhancementPicks(byId), "wobbly knee mutation: +1 to hopping.")?.detail).toContain("You now have");
    expect(splitNamed("Wobbly Knee Mutation: +1 to hopping.")).toEqual({ name: "Wobbly Knee Mutation", rule: "+1 to hopping." });
    expect(splitNamed("Just a name")).toEqual({ name: "Just a name", rule: "" });
    expect(artefactTips(byId)[1]).toEqual({ label: "Tin Whistle", text: "Tin Whistle", detail: "it sings." });
  });
});
