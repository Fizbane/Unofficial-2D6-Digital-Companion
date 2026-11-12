import { afterEach, describe, expect, it } from "vitest";
import { asStringList, store } from "../src/pages/store";

describe("asStringList", () => {
  it("keeps string arrays", () => {
    expect(asStringList(["a", "b"])).toEqual(["a", "b"]);
    expect(asStringList([])).toEqual([]);
  });
  it("treats anything else as empty", () => {
    for (const v of [null, undefined, 3, "x", { a: 1 }, [1, "a"], ["a", null]]) expect(asStringList(v), JSON.stringify(v)).toEqual([]);
  });
});

describe("store.list", () => {
  const g = globalThis as { localStorage?: unknown };
  afterEach(() => delete g.localStorage);
  const fake = (data: Record<string, string>) => {
    g.localStorage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  };
  it("reads a saved string array", () => {
    fake({ "2d6:open": '["core"]' });
    expect(store.list("open")).toEqual(["core"]);
  });
  it("returns [] for malformed or missing values (no throw)", () => {
    fake({ "2d6:open": "{}", "2d6:bookmarks": "5", "2d6:recent": "not json" });
    expect(store.list("open")).toEqual([]);
    expect(store.list("bookmarks")).toEqual([]);
    expect(store.list("recent")).toEqual([]);
    expect(store.list("missing")).toEqual([]);
  });
});
