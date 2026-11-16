// The gameplay tutorial's sandbox: a separate roster survivor, then back to the player's own character.
import { afterEach, describe, expect, it } from "vitest";
import { _setCharForTest, _setGameForTest } from "../src/games";
import type { KeyStore } from "../src/rostermodel";
import { finishTutorial, keepTutorialSurvivor, onTutorialSurvivor, readTutorial, startTutorial } from "../src/tutorial/session";

function mem(init: Record<string, string> = {}): KeyStore & { d: Record<string, string> } {
  const d: Record<string, string> = { ...init };
  return {
    d,
    get length() {
      return Object.keys(d).length;
    },
    key: (i: number) => Object.keys(d)[i] ?? null,
    getItem: (k: string) => (k in d ? d[k] : null),
    setItem: (k: string, v: string) => void (d[k] = v),
    removeItem: (k: string) => void delete d[k],
  };
}

const OWN = "c-own001";
const roster = (active: string, ids: string[]) =>
  JSON.stringify({ v: 1, active, chars: ids.map((id) => ({ id, created: "2026-11-01T00:00:00.000Z", lastPlayed: "2026-11-01T00:00:00.000Z" })) });
const rosterIds = (s: { d: Record<string, string> }) => (JSON.parse(s.d["2d6v:roster"]) as { chars: { id: string }[] }).chars.map((c) => c.id);

function setup() {
  _setGameForTest("void");
  _setCharForTest(OWN);
  return mem({
    "2d6v:roster": roster(OWN, [OWN]),
    [`2d6v:c:${OWN}:play:vsheet`]: '{"name":"Mine"}',
    [`2d6v:c:${OWN}:play:vhulk`]: '{"level":3}',
    "2d6:achievements": '{"a":1}',
    "2d6:shell:prefs": '{"sound":true}',
  });
}

afterEach(() => {
  _setGameForTest("dungeon");
  _setCharForTest(null);
});

describe("tutorial sandbox", () => {
  it("starts as a new survivor and remembers who was playing", () => {
    const s = setup();
    let went = "";
    expect(startTutorial("void", s, (id) => (went = id))).toBe(true);
    const t = readTutorial(s)!;
    expect(t).toMatchObject({ script: "void", step: 0, prev: OWN, ach: '{"a":1}' });
    expect(went).toBe(t.char);
    expect(t.char).not.toBe(OWN);
    expect(rosterIds(s)).toEqual([OWN, t.char]);
    expect(s.d[`2d6v:c:${OWN}:play:vsheet`]).toBe('{"name":"Mine"}');
  });

  it("finishing goes back, deletes the tutorial survivor and restores achievements", () => {
    const s = setup();
    startTutorial("void", s, () => {});
    const t = readTutorial(s)!;
    _setCharForTest(t.char);
    expect(onTutorialSurvivor(t)).toBe(true);
    s.setItem(`2d6v:c:${t.char}:play:vsheet`, '{"name":"Tutorial"}');
    s.setItem("2d6:achievements", '{"a":1,"b":1}');
    let reloaded = false;
    finishTutorial(s, () => (reloaded = true));
    expect(reloaded).toBe(true);
    expect(readTutorial(s)).toBeNull();
    expect((JSON.parse(s.d["2d6v:roster"]) as { active: string }).active).toBe(OWN);
    expect(rosterIds(s)).toEqual([OWN]);
    expect(Object.keys(s.d).some((k) => k.includes(t.char))).toBe(false);
    expect(s.d["2d6:achievements"]).toBe('{"a":1}');
    expect(s.d[`2d6v:c:${OWN}:play:vhulk`]).toBe('{"level":3}');
    expect(s.d["2d6:shell:prefs"]).toBe('{"sound":true}');
  });

  it("restores no achievements as none", () => {
    const s = setup();
    s.removeItem("2d6:achievements");
    startTutorial("void", s, () => {});
    s.setItem("2d6:achievements", '{"b":1}');
    finishTutorial(s, () => {});
    expect(s.getItem("2d6:achievements")).toBeNull();
  });

  it("keeping the survivor just ends the tutorial", () => {
    const s = setup();
    startTutorial("void", s, () => {});
    const t = readTutorial(s)!;
    keepTutorialSurvivor(s);
    expect(readTutorial(s)).toBeNull();
    expect(rosterIds(s)).toEqual([OWN, t.char]);
  });

  it("ignores a malformed saved state", () => {
    const s = setup();
    s.setItem("2d6v:shell:coach", '{"script":"void","step":-1}');
    expect(readTutorial(s)).toBeNull();
  });
});
