// Several characters per game: key scoping, the boot migration (saves from before rosters, merged
// backups), and the roster's create / delete / export / import.
import { afterEach, describe, expect, it } from "vitest";
import { bootRoster, charBase, isCharBase, legacyKeys, newCharId, normalizeRoster, slotIds, type KeyStore } from "../src/rostermodel";
import { _setCharForTest, _setGameForTest, gk, keyFor } from "../src/games";

function mem(init: Record<string, string> = {}): KeyStore & { d: Record<string, string>; failAfter?: number } {
  const d: Record<string, string> = { ...init };
  const s = {
    d,
    failAfter: undefined as number | undefined,
    get length() {
      return Object.keys(d).length;
    },
    key: (i: number) => Object.keys(d)[i] ?? null,
    getItem: (k: string) => (k in d ? d[k] : null),
    setItem(k: string, v: string) {
      if (s.failAfter !== undefined && s.failAfter-- <= 0) throw new Error("QuotaExceeded");
      d[k] = v;
    },
    removeItem: (k: string) => void delete d[k],
  };
  return s;
}

const NOW = "2026-11-12T10:00:00.000Z";
let n = 0;
const ids = () => `c-test${String(++n).padStart(2, "0")}`;

afterEach(() => {
  _setGameForTest("dungeon");
  _setCharForTest(null);
  n = 0;
});

describe("per-character keys", () => {
  it("knows which keys belong to a character", () => {
    for (const k of ["2d6:play:character", "2d6:play:dungeon", "2d6:journal", "2d6:notes", "2d6:shell:results", "2d6:shell:tabs"]) expect(isCharBase(k)).toBe(true);
    for (const k of ["2d6:achievements", "2d6:bookmarks", "2d6:theme", "2d6:shell:prefs", "2d6:roster", "2d6:shell:dungeonPanes"]) expect(isCharBase(k)).toBe(false);
  });

  it("puts per-character keys in the active character's slot, in either game", () => {
    _setCharForTest("c-abc123");
    expect(gk("2d6:play:character")).toBe("2d6:c:c-abc123:play:character");
    expect(gk("2d6:journal")).toBe("2d6:c:c-abc123:journal");
    expect(gk("2d6:bookmarks")).toBe("2d6:bookmarks");
    expect(gk("2d6:achievements")).toBe("2d6:achievements");
    _setGameForTest("void");
    expect(gk("2d6:play:vsheet")).toBe("2d6v:c:c-abc123:play:vsheet");
    expect(gk("2d6:shell:prefs")).toBe("2d6:shell:prefs");
    // another game's key is never scoped by this game's character
    expect(keyFor("2d6:play:character", "dungeon")).toBe("2d6:play:character");
  });

  it("leaves keys unscoped when no character is active", () => {
    expect(gk("2d6:play:character")).toBe("2d6:play:character");
    expect(charBase("2d6:play:x", "c-abcd")).toBe("2d6:c:c-abcd:play:x");
  });

  it("makes well-formed ids", () => {
    expect(newCharId()).toMatch(/^c-[a-z0-9]{6}$/);
  });
});

describe("normalizeRoster", () => {
  it("drops anything that isn't a roster entry", () => {
    expect(normalizeRoster(null)).toEqual({ v: 1, active: "", chars: [] });
    const r = normalizeRoster({ active: "c-zzzz99", chars: [{ id: "c-abcd12", created: "x" }, { id: "c-abcd12" }, { id: "../evil" }, 5] });
    expect(r.chars.map((c) => c.id)).toEqual(["c-abcd12"]);
    expect(r.active).toBe("");
  });
});

describe("bootRoster", () => {
  it("moves a save from before rosters into the first character", () => {
    const s = mem({ "2d6:play:character": '{"name":"Ash"}', "2d6:journal": '{"v":1}', "2d6:notes": "n", "2d6:bookmarks": "[]", "2d6:shell:prefs": "{}" });
    const { roster, active } = bootRoster(s, "2d6:", NOW, ids);
    expect(active).toBe("c-test01");
    expect(roster.chars).toHaveLength(1);
    expect(s.d["2d6:c:c-test01:play:character"]).toBe('{"name":"Ash"}');
    expect(s.d["2d6:c:c-test01:journal"]).toBe('{"v":1}');
    expect(s.d["2d6:play:character"]).toBeUndefined();
    expect(s.d["2d6:bookmarks"]).toBe("[]"); // global keys stay where they are
    expect(JSON.parse(s.d["2d6:roster"]).active).toBe("c-test01");
  });

  it("keeps each game's roster apart", () => {
    const s = mem({ "2d6:play:character": "{}", "2d6v:play:vsheet": "{}" });
    bootRoster(s, "2d6v:", NOW, ids);
    expect(s.d["2d6v:c:c-test01:play:vsheet"]).toBe("{}");
    expect(s.d["2d6:play:character"]).toBe("{}"); // Dungeon's save waits for Dungeon's boot
    expect(s.d["2d6v:roster"]).toBeDefined();
    expect(s.d["2d6:roster"]).toBeUndefined();
  });

  it("gives a fresh install one blank character", () => {
    const s = mem();
    const { roster, active } = bootRoster(s, "2d6:", NOW, ids);
    expect(roster.chars).toHaveLength(1);
    expect(active).toBe(roster.chars[0].id);
  });

  it("changes nothing on a second boot", () => {
    const s = mem({ "2d6:play:character": "{}" });
    bootRoster(s, "2d6:", NOW, ids);
    const before = JSON.stringify(s.d);
    const again = bootRoster(s, "2d6:", "2027-01-01T00:00:00.000Z", ids);
    expect(JSON.stringify(s.d)).toBe(before);
    expect(again.active).toBe("c-test01");
  });

  it("adds an old single-character backup as a new character and plays it", () => {
    const s = mem({ "2d6:c:c-test01:play:character": '{"name":"Ash"}' });
    bootRoster(s, "2d6:", NOW, ids);
    s.d["2d6:play:character"] = '{"name":"Bryn"}'; // what importing an old backup writes
    const { roster, active } = bootRoster(s, "2d6:", NOW, ids);
    expect(roster.chars).toHaveLength(2);
    expect(s.d[`2d6:c:${active}:play:character`]).toBe('{"name":"Bryn"}');
    expect(s.d["2d6:c:c-test01:play:character"]).toBe('{"name":"Ash"}');
  });

  it("lists slots a merged backup brought in", () => {
    const s = mem({ "2d6:roster": JSON.stringify({ v: 1, active: "c-aaaa11", chars: [{ id: "c-aaaa11", created: NOW, lastPlayed: NOW }] }), "2d6:c:c-bbbb22:journal": "{}" });
    const { roster, active } = bootRoster(s, "2d6:", NOW, ids);
    expect(roster.chars.map((c) => c.id).sort()).toEqual(["c-aaaa11", "c-bbbb22"]);
    expect(active).toBe("c-aaaa11");
    expect(slotIds(s, "2d6:")).toEqual(["c-bbbb22"]);
  });

  it("leaves the old keys in place when storage is too full to copy them", () => {
    const s = mem({ "2d6:play:character": "{}", "2d6:journal": "{}" });
    s.failAfter = 1;
    const { active } = bootRoster(s, "2d6:", NOW, ids);
    expect(active).toBeNull();
    expect(legacyKeys(s, "2d6:").sort()).toEqual(["2d6:journal", "2d6:play:character"]);
    expect(Object.keys(s.d).some((k) => k.includes(":c:"))).toBe(false);
  });
});

describe("roster", () => {
  async function withStorage(init: Record<string, string>) {
    const s = mem(init);
    (globalThis as { localStorage?: unknown }).localStorage = s;
    const roster = await import("../src/roster");
    return { s, roster };
  }
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const two = () => ({
    "2d6:roster": JSON.stringify({ v: 1, active: "c-aaaa11", chars: [{ id: "c-aaaa11", created: NOW, lastPlayed: NOW }, { id: "c-bbbb22", created: NOW, lastPlayed: "2026-11-01T00:00:00.000Z" }] }),
    "2d6:c:c-aaaa11:play:character": JSON.stringify({ name: "Ash", xp: 12, hp: 20 }),
    "2d6:c:c-aaaa11:play:dungeon": JSON.stringify({ level: 2, rooms: [1, 2, 3] }),
    "2d6:c:c-bbbb22:play:character": JSON.stringify({ name: "Bryn", xp: 0, hp: 15 }),
    "2d6:c:c-bbbb22:journal": JSON.stringify({ v: 1, entries: [{}, {}] }),
  });

  it("lists characters with a summary from each slot, most recently played first", async () => {
    _setCharForTest("c-aaaa11");
    const { roster } = await withStorage(two());
    const list = roster.listCharacters();
    expect(list.map((c) => [c.name, c.active])).toEqual([["Ash", true], ["Bryn", false]]);
    expect(list[0].delve).toEqual({ level: 2, rooms: 3 });
    expect(list[1].journal).toBe(2);
  });

  it("creates a character with a seeded slot and hands its id to the switch", async () => {
    _setCharForTest("c-aaaa11");
    const { s, roster } = await withStorage(two());
    let went = "";
    expect(roster.createCharacter({ "play:character": { name: "Cai" } }, s, (id) => (went = id))).toBe(true);
    expect(went).toMatch(/^c-/);
    expect(JSON.parse(s.d[`2d6:c:${went}:play:character`]).name).toBe("Cai");
    expect(roster.readRoster(s).chars).toHaveLength(3);
  });

  it("deletes another character's slot, never the one being played", async () => {
    _setCharForTest("c-aaaa11");
    const { s, roster } = await withStorage(two());
    expect(roster.deleteCharacter("c-aaaa11", s)).toBe(false);
    expect(roster.deleteCharacter("c-bbbb22", s)).toBe(true);
    expect(Object.keys(s.d).some((k) => k.includes("c-bbbb22"))).toBe(false);
    expect(s.d["2d6:c:c-aaaa11:play:character"]).toBeDefined();
    expect(roster.readRoster(s).chars.map((c) => c.id)).toEqual(["c-aaaa11"]);
  });

  it("exports one character and imports it as a new entry", async () => {
    _setCharForTest("c-aaaa11");
    const { s, roster } = await withStorage(two());
    const file = roster.validateCharacterFile(JSON.parse(JSON.stringify(roster.characterFile("c-bbbb22", s))));
    expect(Object.keys(file.data).sort()).toEqual(["journal", "play:character"]);
    const id = roster.importCharacterFile(file, s)!;
    expect(id).not.toBe("c-bbbb22");
    expect(s.d[`2d6:c:${id}:play:character`]).toBe(s.d["2d6:c:c-bbbb22:play:character"]);
    expect(roster.readRoster(s).chars).toHaveLength(3);
  });

  it("rejects a character file with odd keys", async () => {
    const { roster } = await withStorage({});
    expect(() => roster.validateCharacterFile({ app: "2d6-companion-character", game: "dungeon", data: { "../x": "1" } })).toThrow();
    expect(() => roster.validateCharacterFile({ app: "2d6-companion", game: "dungeon", data: {} })).toThrow();
  });
});
