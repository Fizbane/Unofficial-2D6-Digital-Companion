import { describe, it, expect } from "vitest";
import { defaultPrefs, getPrefs, isPrefs, mergePrefs, PREFS_KEY, setPrefs } from "../src/shell/prefs";
import { bus } from "../src/shell/events";
import type { KV } from "../src/shell/state";

function mapKV(init: Record<string, string> = {}): KV & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("prefs", () => {
  it("defaults when nothing or something invalid is saved", () => {
    expect(getPrefs(mapKV())).toEqual({ v: 1, backdrop: true, reduceTransparency: false, sound: true, music: true, sfxVolume: 0.7, musicVolume: 0.4 });
    expect(getPrefs(mapKV({ [PREFS_KEY]: '{"v":1,"backdrop":"yes","reduceTransparency":false}' }))).toEqual(defaultPrefs());
    expect(getPrefs(mapKV({ [PREFS_KEY]: "not json" }))).toEqual(defaultPrefs());
    expect(isPrefs({ v: 2, backdrop: true, reduceTransparency: false })).toBe(false);
  });

  it("ignores the removed hotbar flag in an older save (valid or not)", () => {
    expect(getPrefs(mapKV({ [PREFS_KEY]: '{"v":1,"backdrop":false,"reduceTransparency":true,"hotbar":false}' }))).toEqual({ ...defaultPrefs(), backdrop: false, reduceTransparency: true });
    expect(getPrefs(mapKV({ [PREFS_KEY]: '{"v":1,"backdrop":false,"reduceTransparency":false,"hotbar":"no"}' }))).toEqual({ ...defaultPrefs(), backdrop: false });
  });

  it("mergePrefs keeps only boolean values for known flags", () => {
    const p = mergePrefs(defaultPrefs(), { reduceTransparency: true, backdrop: "x", hotbar: false, v: 3 } as never);
    expect(p).toEqual({ ...defaultPrefs(), reduceTransparency: true });
  });

  it("a save from before sound existed keeps its display flags and gets the sound defaults", () => {
    const p = getPrefs(mapKV({ [PREFS_KEY]: '{"v":1,"backdrop":false,"reduceTransparency":true}' }));
    expect(p).toEqual({ ...defaultPrefs(), backdrop: false, reduceTransparency: true });
  });

  it("a bad sound field falls back alone; volumes are clamped to 0–1", () => {
    const p = getPrefs(mapKV({ [PREFS_KEY]: '{"v":1,"backdrop":true,"reduceTransparency":false,"music":"loud","sfxVolume":3,"musicVolume":-1,"sound":false}' }));
    expect(p).toEqual({ ...defaultPrefs(), music: true, sound: false, sfxVolume: 1, musicVolume: 0 });
    expect(mergePrefs(defaultPrefs(), { musicVolume: Number.NaN, sfxVolume: "0.2" }).musicVolume).toBe(0.4);
    expect(mergePrefs(defaultPrefs(), { sfxVolume: "0.2" }).sfxVolume).toBe(0.7);
    expect(mergePrefs(defaultPrefs(), { sfxVolume: 0.25 }).sfxVolume).toBe(0.25);
  });

  it("setPrefs saves and emits prefs:changed", () => {
    const kv = mapKV();
    const seen: unknown[] = [];
    const off = bus.on("prefs:changed", (p) => seen.push(p));
    const p = setPrefs({ backdrop: false }, kv);
    off();
    expect(p.backdrop).toBe(false);
    expect(JSON.parse(kv.m.get(PREFS_KEY)!)).toEqual(p);
    expect(seen).toEqual([p]);
    expect(getPrefs(kv).backdrop).toBe(false);
  });
});
