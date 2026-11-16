import { describe, expect, it } from "vitest";
import { filterChoices, groupsOf, hasChoiceNamed, type PickChoice } from "../src/ui/pickmodel";

const all: PickChoice[] = [
  { id: "1", name: "Leather Jerkin", meta: "AAB -1", detail: "Light body armour", group: "Armour" },
  { id: "2", name: "Chain Mail", meta: "ABB -2", detail: "Heavy; leather lining", group: "Armour" },
  { id: "3", name: "Potion of Healing", detail: "Restores 10 HP", group: "Potion" },
  { id: "4", name: "Studded Leather", group: "Armour" },
];

describe("filterChoices", () => {
  it("keeps the given order with nothing typed", () => expect(filterChoices(all, "").map((c) => c.id)).toEqual(["1", "2", "3", "4"]));
  it("ranks a name that starts with the word first, then name hits, then detail hits", () =>
    expect(filterChoices(all, "leather").map((c) => c.id)).toEqual(["1", "4", "2"]));
  it("needs every word to match", () => expect(filterChoices(all, "leather heavy").map((c) => c.id)).toEqual(["2"]));
  it("narrows by group", () => expect(filterChoices(all, "", "Potion").map((c) => c.id)).toEqual(["3"]));
  it("is empty when nothing matches", () => expect(filterChoices(all, "zzz")).toEqual([]));
});

describe("groups and typed names", () => {
  it("lists groups in first-seen order", () => expect(groupsOf(all)).toEqual(["Armour", "Potion"]));
  it("spots a typed name that is already a choice", () => {
    expect(hasChoiceNamed(all, " chain mail ")).toBe(true);
    expect(hasChoiceNamed(all, "Plate")).toBe(false);
  });
});
