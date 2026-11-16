import { describe, it, expect, afterEach } from "vitest";
import { artFor, artThumb, setArtFiles } from "../src/ui/art";

describe("card art in Combat", () => {
  afterEach(() => setArtFiles([]));

  it("gives a thumbnail button for a creature that has a picture, whatever the case of its name", () => {
    setArtFiles(["Huge Rat.png", "Guard Dog.jpg"]);
    expect(artFor("HUGE RAT")).toBe("Huge Rat.png");
    const h = String(artThumb("HUGE RAT"));
    expect(h).toContain('class="art-thumb"');
    expect(h).toContain('data-art="Huge Rat.png"');
    expect(h).toContain("art/Huge%20Rat.png");
    expect(h).toContain("Show the picture of Huge Rat");
  });
  it("takes a size class, for the big card of the foe you are facing", () => {
    setArtFiles(["Huge Rat.png"]);
    expect(String(artThumb("Huge Rat", "art-lg"))).toContain('class="art-thumb art-lg"');
  });
  it("gives nothing for a creature with no picture, or when no art is there (a build)", () => {
    setArtFiles(["Huge Rat.png"]);
    expect(String(artThumb("GOBLIN"))).toBe("");
    setArtFiles([]);
    expect(String(artThumb("HUGE RAT"))).toBe("");
  });
  it("escapes a file name", () => {
    setArtFiles(['A "b" <c>.png']);
    const h = String(artThumb('a b c'));
    expect(h).not.toContain("<c>");
  });
});
