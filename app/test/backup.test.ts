// Task 13: every imported JSON is validated; book content never travels in a backup.
import { describe, expect, it } from "vitest";
import { collectBackup, validateBackup } from "../src/lock/backup";
import { ValidationError } from "../src/lock/validate";
import { validateFixes, type Fix } from "../src/fixes";
import { blankCharacter, validateCharacter } from "../src/tools/sheet";
import { freshRealm, validateRealm } from "../src/tools/realm";

// what Settings → "Export all" writes
const realExport = () => ({
  app: "2d6-companion",
  saved: "2026-11-11T10:00:00.000Z",
  data: {
    "2d6:fixes": JSON.stringify([{ s: "codex/x", b: 0, f: "text", from: "a", to: "b" }]),
    "2d6:play:character": JSON.stringify(blankCharacter()),
    "2d6:play:dungeon": JSON.stringify({ level: 1, rooms: [], current: null }),
    "2d6:shell:prefs": '{"v":1}',
    "2d6:dice-settings": '{"dice":[]}',
  },
});
const bad = (x: unknown) => expect(() => validateBackup(x)).toThrow(ValidationError);

describe("validateBackup", () => {
  it("accepts a real export", () => {
    const b = validateBackup(realExport());
    expect(b.app).toBe("2d6-companion");
    expect(Object.keys(b.data)).toHaveLength(5);
  });
  it("rejects a non-string value", () => bad({ app: "2d6-companion", data: { "2d6:fixes": [] } }));
  it("rejects a __proto__ key", () => bad({ app: "2d6-companion", data: JSON.parse('{"__proto__":"x"}') }));
  it("rejects a non-2d6 key", () => bad({ app: "2d6-companion", data: { "other:fixes": "[]" } }));
  it("rejects an oversize value", () => bad({ app: "2d6-companion", data: { "2d6:notes": "x".repeat(2_000_001) } }));
  it("accepts a value of exactly 2 MB", () => validateBackup({ app: "2d6-companion", data: { "2d6:notes": "x".repeat(2_000_000) } }));
  it("rejects book content and book keys", () => {
    for (const k of ["2d6:content", "2d6:content:codex", "2d6:books", "2d6:books:core", "2d6:pages"]) bad({ app: "2d6-companion", data: { [k]: "x" } });
  });
  it("rejects the wrong app, a missing data object and odd key shapes", () => {
    bad({ app: "other", data: {} });
    bad({ app: "2d6-companion" });
    bad({ app: "2d6-companion", data: { "2d6:": "x" } });
    bad(null);
  });
});

describe("collectBackup", () => {
  it("leaves out content and book keys, and keys an import would reject", () => {
    const store: Record<string, string> = { "2d6:fixes": "[]", "2d6:content": "BOOK", "2d6:books:x": "BOOK", "2d6:pages": "P", "other": "x", "2d6:play:realm": "{}", "2d6:Bad Key": "x" };
    const ls = { length: 7, key: (i: number) => Object.keys(store)[i] ?? null, getItem: (k: string) => store[k] ?? null };
    const { data } = collectBackup(ls);
    expect(Object.keys(data).sort()).toEqual(["2d6:fixes", "2d6:play:realm"]);
    validateBackup({ app: "2d6-companion", data });
  });
});

describe("validateFixes", () => {
  const ok: Fix = { s: "codex/level-1-rooms", b: 2, f: "cell", r: 3, c: 1, from: "a", to: "b" };
  it("keeps fixes, including ones for locked or unknown ids", () => {
    const list = [ok, { s: "codex/p44-1", b: 0, f: "text", from: "x", to: "y" }, { s: "nope/unknown-id", b: 0, f: "intro", from: "", to: "z" }];
    expect(validateFixes(list)).toEqual(list);
  });
  it("rejects non-arrays, bad fields, extra keys and prototype keys", () => {
    for (const x of [{}, "x", [{ ...ok, f: "evil" }], [{ ...ok, b: "1" }], [{ ...ok, b: -1 }], [{ ...ok, extra: 1 }], [{ ...ok, to: 5 }], [JSON.parse('{"s":"a","b":0,"f":"text","from":"","to":"","__proto__":{}}')]])
      expect(() => validateFixes(x)).toThrow(ValidationError);
  });
});

describe("validateCharacter / validateRealm", () => {
  it("accept a real export and a partial older one", () => {
    expect(validateCharacter(JSON.parse(JSON.stringify(blankCharacter()))).name).toBe("");
    expect(validateCharacter({ name: "Old", xp: 3 })).toEqual({ name: "Old", xp: 3 });
    expect(validateRealm(JSON.parse(JSON.stringify(freshRealm()))).year).toBe(837);
  });
  it("reject wrong types, markup-sized junk and prototype keys", () => {
    for (const x of [[], "x", { name: 5 }, { xp: "9" }, { hp: Infinity }, { manoeuvres: "x" }, { portrait: "javascript:alert(1)" }, JSON.parse('{"name":"a","__proto__":{"x":1}}')])
      expect(() => validateCharacter(x)).toThrow(ValidationError);
    for (const x of [[], { year: "x" }, { lands: {} }, { lands: [{ id: "a" }] }, { gc: NaN }, { explore: 5 }, JSON.parse('{"constructor":{}}')])
      expect(() => validateRealm(x)).toThrow(ValidationError);
  });
});

// ---- fix round 1
const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { readdirSync, readFileSync, statSync } = await nodeMod("node:fs");
const { join } = await nodeMod("node:path");
const { fileURLToPath } = await nodeMod("node:url");
import { afterEach, beforeEach } from "vitest";
import { applyBackup, BACKUP_KEY, MAX_BACKUP_VALUE } from "../src/lock/backup";
import { FixSaveError, getFixes, saveFix, undoFixes } from "../src/fixes";
import type { Section } from "../src/types";

const store = () => {
  const d: Record<string, string> = {};
  const ls = {
    d,
    failAfter: Infinity,
    get length() { return Object.keys(d).length; },
    key: (i: number) => Object.keys(d)[i] ?? null,
    getItem: (k: string) => d[k] ?? null,
    setItem(k: string, v: string) { if (ls.failAfter-- === 0) throw new Error("QuotaExceededError"); d[k] = v; },
    removeItem: (k: string) => void delete d[k],
  };
  return ls;
};
const goodFix = { s: "codex/a", b: 0, f: "text", from: "x", to: "y" };
const sec = (): Section => ({ id: "codex/b", title: "t", blocks: [{ type: "para", text: "hello" }] }) as unknown as Section;

describe("saved fixes are never wiped by a bad entry", () => {
  let ls: ReturnType<typeof store>;
  beforeEach(() => { ls = store(); (globalThis as { localStorage?: unknown }).localStorage = ls; });
  afterEach(() => void delete (globalThis as { localStorage?: unknown }).localStorage);

  it("drops only the invalid entries, and keeps the good ones through a save", () => {
    ls.d["2d6:fixes"] = JSON.stringify([goodFix, { s: 5 }, null, { ...goodFix, s: "codex/c" }]);
    expect(getFixes().map((f) => f.s)).toEqual(["codex/a", "codex/c"]);
    saveFix(sec(), { b: 0, f: "text" }, "bye");
    expect(JSON.parse(ls.d["2d6:fixes"]).map((f: { s: string }) => f.s).sort()).toEqual(["codex/a", "codex/b", "codex/c"]);
    expect(JSON.parse(ls.d["2d6:fixes-bad"])[0]).toContain('"s":5'); // the original raw value is kept aside
    undoFixes(sec());
    expect(JSON.parse(ls.d["2d6:fixes"])).toHaveLength(2);
  });
  it("quarantines unreadable raw data before any write", () => {
    ls.d["2d6:fixes"] = "{not json";
    expect(getFixes()).toEqual([]);
    expect(JSON.parse(ls.d["2d6:fixes-bad"])).toEqual(["{not json"]);
    ls.d["2d6:fixes"] = '{"a":1}';
    expect(getFixes()).toEqual([]);
    expect(JSON.parse(ls.d["2d6:fixes-bad"])).toEqual(["{not json", '{"a":1}']);
  });
  it("keeps every quarantined value: B survives C, and repeats are not stored twice", () => {
    ls.d["2d6:fixes"] = "B-bad";
    getFixes();
    getFixes();
    ls.d["2d6:fixes"] = "C-bad";
    getFixes();
    expect(JSON.parse(ls.d["2d6:fixes-bad"])).toEqual(["B-bad", "C-bad"]);
  });
  it("keeps an older plain quarantine value as the first entry", () => {
    ls.d["2d6:fixes-bad"] = "legacy{";
    ls.d["2d6:fixes"] = "x0";
    getFixes();
    expect(JSON.parse(ls.d["2d6:fixes-bad"])).toEqual(["legacy{", "x0"]);
  });
  it("caps at 20, dropping the oldest", () => {
    for (let i = 0; i < 25; i++) { ls.d["2d6:fixes"] = "x" + i; getFixes(); }
    const l = JSON.parse(ls.d["2d6:fixes-bad"]) as string[];
    expect(l).toHaveLength(20);
    expect(l[0]).toBe("x5");
    expect(l[19]).toBe("x24");
  });
  it("a failing quarantine write blocks saveFix and undoFixes", () => {
    ls.d["2d6:fixes"] = JSON.stringify([goodFix, { s: 5 }]);
    const orig = ls.setItem;
    ls.setItem = (k: string, v: string) => { if (k === "2d6:fixes-bad") throw new Error("full"); orig(k, v); };
    expect(() => saveFix(sec(), { b: 0, f: "text" }, "bye")).toThrow(FixSaveError);
    expect(() => undoFixes(sec())).toThrow("Couldn't save: storage is full");
    expect(ls.d["2d6:fixes"]).toBe(JSON.stringify([goodFix, { s: 5 }])); // untouched
  });
  it("leaves a good list alone and writes no quarantine copy", () => {
    ls.d["2d6:fixes"] = JSON.stringify([goodFix]);
    expect(getFixes()).toHaveLength(1);
    expect(ls.d["2d6:fixes-bad"]).toBeUndefined();
  });
});

describe("every key the app writes survives a backup", () => {
  it("passes the key rule (book content excepted)", () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir) as string[]) { const p: string = join(dir, n); statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p); } };
    walk(fileURLToPath(new URL("../src", import.meta.url)));
    const found = new Set<string>(["2d6:play:dungeon", "2d6:play:realm", "2d6:play:combat", "2d6:play:character", "2d6:fixes-bad",
      "2d6v:play:vhulk", "2d6v:play:vsheet", "2d6v:play:vcombat", "2d6v:fixes", "2d6v:dice-settings"]); // 2D6 Void's keys (games.ts keyFor)
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](2d6v?:[A-Za-z0-9:_-]*[A-Za-z0-9_-])["'`]/g)) found.add(m[1]);
    expect(found.has("2d6:shell:dungeonMap")).toBe(true);
    for (const k of found) {
      if (/^2d6v?:(content|books|pages)/.test(k)) continue;
      expect(BACKUP_KEY.test(k), k).toBe(true);
    }
  });
});

describe("export reports what it left out", () => {
  it("lists oversize keys", () => {
    const s = store();
    s.d["2d6:notes"] = "x".repeat(MAX_BACKUP_VALUE + 1);
    s.d["2d6:fixes"] = "[]";
    const r = collectBackup(s);
    expect(Object.keys(r.data)).toEqual(["2d6:fixes"]);
    expect(r.omitted).toEqual(["2d6:notes"]);
  });
});

describe("applyBackup", () => {
  it("restores the previous values when a write fails partway", () => {
    const s = store();
    s.d["2d6:a"] = "old-a";
    s.d["2d6:b"] = "old-b";
    s.failAfter = 2;
    const ok = applyBackup(s, { "2d6:c": "new-c", "2d6:a": "new-a", "2d6:b": "new-b" }); // c did not exist before: it must be removed again
    expect(ok).toBe("restored");
    expect(s.d).toEqual({ "2d6:a": "old-a", "2d6:b": "old-b" });
  });
  it("writes everything when storage is fine", () => {
    const s = store();
    expect(applyBackup(s, { "2d6:a": "1" })).toBe("ok");
    expect(s.d["2d6:a"]).toBe("1");
  });
});

describe("applyBackup when the rollback also fails", () => {
  it('says "partial"', () => {
    const s = store();
    s.d["2d6:a"] = "old";
    let down = false;
    s.setItem = (k: string, v: string) => { if (down || k === "2d6:a") { down = true; throw new Error("full"); } s.d[k] = v; };
    expect(applyBackup(s, { "2d6:z": "n", "2d6:a": "new" })).toBe("partial");
  });
});

describe("unknown keys are capped", () => {
  it("rejects more than 200 extras and keys over 64 characters", () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => ["k" + i, 1]));
    expect(() => validateCharacter(many)).toThrow(ValidationError);
    expect(() => validateCharacter({ ["k".repeat(65)]: 1 })).toThrow(ValidationError);
    expect(validateCharacter(Object.fromEntries(Array.from({ length: 200 }, (_, i) => ["k" + i, 1])))).toBeTruthy();
  });
});

describe("imports keep unknown keys", () => {
  it("keeps extra keys of a character and realm, still rejecting prototype keys", () => {
    expect(validateCharacter({ name: "A", mod: { x: [1, "y"] } })).toEqual({ name: "A", mod: { x: [1, "y"] } });
    expect(validateRealm({ year: 3, other: "z" })).toEqual({ year: 3, other: "z" });
    expect(() => validateCharacter({ extra: JSON.parse('{"__proto__":1}') })).toThrow(ValidationError);
  });
});
