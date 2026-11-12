import { describe, it, expect } from "vitest";
import { readState, writeState, onWriteFail, type KV } from "../src/shell/state";

interface Saved {
  v: 1;
  n: number;
}
const isSaved = (v: unknown): v is Saved =>
  typeof v === "object" && v !== null && (v as Saved).v === 1 && typeof (v as Saved).n === "number";
const fallback = (): Saved => ({ v: 1, n: 0 });

function mapKV(init: Record<string, string> = {}): KV {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("readState", () => {
  it("returns valid saved JSON", () => {
    const kv = mapKV({ k: JSON.stringify({ v: 1, n: 5 }) });
    expect(readState("k", isSaved, fallback, kv)).toEqual({ v: 1, n: 5 });
  });

  it("falls back when the key is missing", () => {
    expect(readState("k", isSaved, fallback, mapKV())).toEqual({ v: 1, n: 0 });
  });

  it("falls back on malformed JSON", () => {
    expect(readState("k", isSaved, fallback, mapKV({ k: "{not json" }))).toEqual({ v: 1, n: 0 });
  });

  it("falls back when JSON fails validation", () => {
    expect(readState("k", isSaved, fallback, mapKV({ k: JSON.stringify({ v: 2 }) }))).toEqual({ v: 1, n: 0 });
  });
});

describe("writeState", () => {
  it("writes JSON and returns true", () => {
    const kv = mapKV();
    expect(writeState("k", { v: 1, n: 3 }, kv)).toBe(true);
    expect(kv.getItem("k")).toBe(JSON.stringify({ v: 1, n: 3 }));
  });

  it("returns false and calls the fail handler once across two failures", () => {
    const kv: KV = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    let calls = 0;
    onWriteFail(() => calls++);
    expect(writeState("k", { v: 1, n: 1 }, kv)).toBe(false);
    expect(writeState("k", { v: 1, n: 2 }, kv)).toBe(false);
    expect(calls).toBe(1);
  });
});
