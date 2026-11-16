import { describe, expect, it } from "vitest";
import { cleanChoice, defaultPack, FACES, PACKS, resolveFonts } from "../src/fonts";

describe("font choices", () => {
  it("Dungeon defaults to Cinzel headings and Alegreya text", () => {
    expect(resolveFonts(cleanChoice(undefined, undefined))).toEqual({ display: "cinzel", read: "alegreya", ui: "inter" });
    expect(defaultPack()).toBe("dungeon");
  });
  it("the Sci-fi pack is Orbitron and Exo 2 (Void's default)", () => {
    expect(resolveFonts(cleanChoice("scifi", {}))).toEqual({ display: "orbitron", read: "exo2", ui: "exo2" });
  });
  it("overrides one role and leaves the others on the pack", () => {
    expect(resolveFonts(cleanChoice("classic", { display: "opendyslexic" }))).toEqual({ display: "opendyslexic", read: "crimson", ui: "inter" });
  });
  it("ignores unknown packs, roles and typefaces", () => {
    expect(cleanChoice("nope", { display: "comic", bogus: "inter", read: 3 })).toEqual({ pack: "dungeon", overrides: {} });
  });
  it("every pack names real typefaces, and both dyslexia-friendly packs exist", () => {
    for (const p of PACKS) for (const id of Object.values(p.fonts)) expect(FACES.some((f) => f.id === id)).toBe(true);
    expect(PACKS.map((p) => p.id)).toEqual(expect.arrayContaining(["atkinson", "opendyslexic"]));
  });
});

import { stepRations } from "../src/shell/charmodel";
describe("ration counter", () => {
  it("steps by one, never below 0", () => {
    expect([stepRations(3, 1), stepRations(0, -1), stepRations(undefined, 1), stepRations(99, 1)]).toEqual([4, 0, 1, 99]);
  });
});
