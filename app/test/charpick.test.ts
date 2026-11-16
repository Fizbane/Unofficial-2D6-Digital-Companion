// The rail's character picker: one row per character, the active one marked, names escaped, and the
// footer's New / All actions worded for the game.
import { describe, expect, it } from "vitest";
import { charPickHtml, pickLine, pickWords } from "../src/shell/charpick";
import type { CharacterSummary } from "../src/roster";

const char = (o: Partial<CharacterSummary>): CharacterSummary => ({
  id: "c-aaaa", active: false, name: "", portrait: "", xp: 0, hp: null, level: null, profession: "",
  delve: null, journal: 0, created: "2026-11-01T00:00:00Z", lastPlayed: "2026-11-01T00:00:00Z", ...o,
});

describe("character picker", () => {
  it("lists every character and marks the one being played", () => {
    const out = charPickHtml(
      [char({ id: "c-aaaa", name: "Bryn", active: true, hp: 25 }), char({ id: "c-bbbb", name: "Odo" })],
      pickWords(false),
      () => 2,
    ).toString();
    expect(out.match(/data-pick="/g)).toHaveLength(2);
    expect(out).toContain('data-pick="c-aaaa" aria-current="true"');
    expect(out).toContain('data-pick="c-bbbb" aria-current="false"');
    expect(out).toContain("Playing");
    expect(out).toContain("Switch to Odo");
    expect(out).toContain("Level 2 · 25 HP");
    expect(out).toContain("New character");
    expect(out).toContain("All characters…");
  });

  it("names an unnamed character and escapes names", () => {
    const out = charPickHtml([char({ name: "" }), char({ id: "c-cccc", name: "<b>x</b>" })], pickWords(false), () => null).toString();
    expect(out).toContain("Unnamed adventurer");
    expect(out).not.toContain("<b>x</b>");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("uses Void's words and the survivor's own level and profession", () => {
    const c = char({ name: "Vex", level: 3, profession: "Freighter Captain" });
    expect(pickLine(c, c.level)).toBe("Freighter Captain · Level 3");
    const out = charPickHtml([c], pickWords(true), (x) => x.level).toString();
    expect(out).toContain("Survivors");
    expect(out).toContain("New survivor");
    expect(out).toContain("All survivors…");
  });

  it("says when a sheet is empty", () => {
    expect(pickLine(char({}), null)).toBe("Not started yet");
  });
});
