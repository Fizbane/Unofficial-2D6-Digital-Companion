import { describe, it, expect } from "vitest";
import { applyPatch, digestFile, fieldHash, fixText, makePatch, norm } from "../src/lock/hash";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("norm and fixText", () => {
  it("normalises quotes, dashes and whitespace", () => {
    expect(norm("  A’s – b ")).toBe("A's - b");
    expect(norm("“x”‘y’ —\n\tz")).toBe("\"x\"'y' - z");
    expect(norm("é")).toBe("é");
  });
  it("matches pipeline fix_text", () => {
    expect(fixText("a � b�c")).toBe("a – b'c");
  });
});

describe("digestFile", () => {
  it("streamed digest equals one-shot digest across slice boundaries", async () => {
    const size = 20 * 1024 * 1024 + 123;
    const buf = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(buf.subarray(i, Math.min(size, i + 65536)));
    const calls: [number, number][] = [];
    const { fp, key } = await digestFile(new Blob([buf]), (d, t) => calls.push([d, t]));
    expect(fp).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))));
    const prefix = new TextEncoder().encode("2d6-companion/key/v1");
    const both = new Uint8Array(prefix.length + size);
    both.set(prefix);
    both.set(buf, prefix.length);
    expect(hex(key)).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", both))));
    expect(calls.length).toBe(3);
    expect(calls[calls.length - 1]).toEqual([size, size]);
  }, 30000);
});

describe("fieldHash", () => {
  const k0 = new Uint8Array(32);
  const k1 = new Uint8Array(32).fill(1);
  const h = fieldHash(k0, "cell", "codex/p6-1", 2, 0, 1, "Fire Touched");
  it("is 22 chars, deterministic, and sensitive to every input", () => {
    expect(h).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fieldHash(k0, "cell", "codex/p6-1", 2, 0, 1, "Fire Touched")).toBe(h);
    expect(fieldHash(k0, "cell", "codex/p6-1", 2, 0, 1, "  Fire   Touched ")).toBe(h);
    const variants = [
      fieldHash(k1, "cell", "codex/p6-1", 2, 0, 1, "Fire Touched"),
      fieldHash(k0, "col", "codex/p6-1", 2, 0, 1, "Fire Touched"),
      fieldHash(k0, "cell", "codex/p6-2", 2, 0, 1, "Fire Touched"),
      fieldHash(k0, "cell", "codex/p6-1", 3, 0, 1, "Fire Touched"),
      fieldHash(k0, "cell", "codex/p6-1", 2, 1, 1, "Fire Touched"),
      fieldHash(k0, "cell", "codex/p6-1", 2, 0, 2, "Fire Touched"),
      fieldHash(k0, "cell", "codex/p6-1", 2, 0, 1, "Fire Touches"),
    ];
    for (const v of variants) expect(v).not.toBe(h);
  });
  it("matches the fixed vector", () => {
    expect(h).toBe("lpfY2VknCrHdqQEuU880DQ");
  });
});

describe("patches", () => {
  it("round-trips a small OCR fix", () => {
    const p = makePatch("Tbe c1oak", "The cloak");
    expect(p).not.toBeNull();
    expect(applyPatch("Tbe c1oak", p!)).toBe("The cloak");
  });
  it("handles insertions, deletions and identity", () => {
    expect(makePatch("abc", "abc")).toEqual([]);
    for (const [a, b] of [["abc", "abxc"], ["abcd", "ad"], ["", "ab"], ["xyz", ""], ["cloak", "c1oaks"]] as const) {
      const p = makePatch(a, b);
      expect(p).not.toBeNull();
      expect(applyPatch(a, p!)).toBe(b);
    }
  });
  it("merges adjacent edits into one op", () => {
    expect(makePatch("abXYcd", "abZWcd")).toEqual([[2, 2, "ZW"]]);
  });
  it("returns null over the limits", () => {
    expect(makePatch("abc", "abcdefgh")).toBeNull(); // 5 inserted
    expect(makePatch("abc", "abcdefg")).not.toBeNull(); // 4 inserted
  });
  it("returns null with more than 3 ops", () => {
    expect(makePatch("a-b-c-d-e", "a+b-c+d-e")).not.toBeNull();
    expect(makePatch("a-b-c-d-e", "a+b+c+d+e")).toBeNull();
  });
});
