import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedDuringImport, addUnlocked, bookInfo, codeTarget, getContent, initContent, isLocked, lockGeneration, refreshFixes, storeAvailable, lockAll, manifest, onContentChange, sectionIds } from "../src/content";
import { undoFixes } from "../src/fixes";
import { validateManifest } from "../src/lock/manifest";
import { StoreError, forgetAll, getBooks, getPage, getProgress, getSections, persist, putBook, putPage, putProgress, putSections } from "../src/lock/store";
import type { Section } from "../src/types";

// The app has no @types/node, so the Node built-ins are imported untyped.
const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { existsSync, readFileSync } = await nodeMod("node:fs");
const { fileURLToPath } = await nodeMod("node:url");

const H = "AbCdEfGhIjKlMnOpQrSt_-";
const FP = "393b841ef700f333e8478dee14847bdf792923fda719fe7b639f45c1faed8bd2";
const box = [0.1, 0.2, 0.3, 0.4];

const fakeManifest = {
  version: 1,
  books: [
    { slug: "core", name: "Core Rules", free: true, editions: [] },
    { slug: "codex", name: "Tables Codex", free: false, editions: [{ id: "tablet", fp: FP, pages: 120 }], freeFp: [FP] },
  ],
  sections: [
    {
      id: "codex/p52-1", book: "codex", level: 2, chapter: null, pages: [52],
      blocks: [{ type: "para", page: 52, loc: { box, kind: "text" }, h: { tablet: { v: [H] } } }],
    },
  ],
  codes: { ENAT2: "codex/p52-1" },
};
const freeSection: Section = {
  id: "core-intro", book: "core", title: "Intro", level: 1, chapter: null, pages: [3],
  blocks: [{ type: "table", page: 3, table: { title: "T", code: "FREE1", dice: "2D6", columns: ["a"], rows: [["x"]] } }],
};
const fakeFree = { books: [{ slug: "core", title: "Core Rules", missing_pages: [], page_images: [], free: true }], sections: [freeSection] };
const unlockedSection: Section = {
  id: "codex/p52-1", book: "codex", title: "Locked Title", level: 2, chapter: null, pages: [52],
  blocks: [{ type: "para", page: 52, text: "hello" }],
};

const fetchJson = async (p: string) => structuredClone(p.endsWith("manifest.json") ? fakeManifest : fakeFree);

beforeEach(async () => {
  await forgetAll();
  await initContent(fetchJson);
});

describe("content gateway", () => {
  it("returns a locked result for a locked section", () => {
    expect(getContent("codex/p52-1")).toEqual({ ok: false, locked: { book: "codex", bookName: "Tables Codex", page: 52 } });
    expect(isLocked("codex/p52-1")).toBe(true);
    expect(sectionIds()).toEqual(["core-intro"]);
    expect(bookInfo("codex")).toEqual({ slug: "codex", name: "Tables Codex", free: false, unlocked: false });
    expect(bookInfo("core")).toEqual({ slug: "core", name: "Core Rules", free: true, unlocked: false });
    expect(manifest().books).toHaveLength(2);
  });

  it("serves free sections and merges free and locked codes", () => {
    const r = getContent("core-intro");
    expect(r?.ok && r.section.title).toBe("Intro");
    expect(isLocked("core-intro")).toBe(false);
    expect(codeTarget("FREE1")).toBe("core-intro");
    expect(codeTarget("enat2")).toBe("codex/p52-1");
    expect(codeTarget("NOPE")).toBeUndefined();
  });

  it("unlocks after addUnlocked and fires the listener once", async () => {
    const fn = vi.fn();
    const off = onContentChange(fn);
    await addUnlocked([{ section: unlockedSection, unverified: ["c0.1"] }]);
    const r = getContent("codex/p52-1");
    expect(r?.ok && r.section.title).toBe("Locked Title");
    expect(r?.ok && r.unverified).toEqual(new Set(["c0.1"]));
    expect(isLocked("codex/p52-1")).toBe(false);
    expect(sectionIds()).toContain("codex/p52-1");
    expect(bookInfo("codex").unlocked).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    await addUnlocked([{ section: unlockedSection, unverified: [] }]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("hides stored sections of a book with no BookRecord (a run that did not finish)", async () => {
    await putSections([{ section: unlockedSection, unverified: [] }]);
    await initContent(fetchJson);
    expect(isLocked("codex/p52-1")).toBe(true);
    expect(getContent("codex/p52-1")?.ok).toBe(false);
    expect((await getSections()).length).toBe(1);          // kept for the resume
    await putBook({ slug: "codex", edition: "tablet", fp: FP, key: new Uint8Array([1]), date: 1 });
    await initContent(fetchJson);
    expect(getContent("codex/p52-1")?.ok).toBe(true);
  });

  it("loads stored sections on init and applies fixes, ignoring unknown ids", async () => {
    await putSections([{ section: unlockedSection, unverified: [] }]);
    await putBook({ slug: "codex", edition: "tablet", fp: FP, key: new Uint8Array([1]), date: 1 });
    const data: Record<string, string> = {
      "2d6:fixes": JSON.stringify([
        { s: "codex/p52-1", b: 0, f: "text", from: "hello", to: "fixed" },
        { s: "gone/p1-1", b: 0, f: "text", from: "a", to: "b" },
      ]),
    };
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => data[k] ?? null, setItem() {} };
    try {
      await initContent(fetchJson);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
    const r = getContent("codex/p52-1");
    expect(r?.ok && r.section.blocks[0]).toMatchObject({ text: "fixed" });
  });

  it("lockAll clears the store and memory and fires once", async () => {
    await addUnlocked([{ section: unlockedSection, unverified: [] }]);
    const fn = vi.fn();
    onContentChange(fn);
    await lockAll();
    expect(getContent("codex/p52-1")?.ok).toBe(false);
    expect(await getSections()).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid manifest", async () => {
    await expect(initContent(async (p) => (p.endsWith("manifest.json") ? { version: 2 } : fakeFree))).rejects.toThrow();
  });
});

describe("store", () => {
  it("round-trips books, pages, progress and forgetAll", async () => {
    await putBook({ slug: "codex", edition: "tablet", fp: FP, key: new Uint8Array([1, 2, 3]), date: 5 });
    await putPage("codex", 52, new Blob(["x"]));
    await putProgress("codex", { page: 9 });
    expect((await getBooks())[0].key).toEqual(new Uint8Array([1, 2, 3]));
    expect((await getPage("codex", 52))?.size).toBe(1);
    expect(await getPage("codex", 53)).toBeUndefined();
    expect(await getProgress("codex")).toEqual({ page: 9 });
    await forgetAll();
    expect(await getBooks()).toEqual([]);
    expect(await getPage("codex", 52)).toBeUndefined();
    expect(await getProgress("codex")).toBeUndefined();
  });

  it("persist is false when unavailable", async () => {
    expect(await persist()).toBe(false);
  });

  it("putContent quota error surfaces", async () => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("full", "QuotaExceededError");
    };
    try {
      const err = await putSections([{ section: unlockedSection, unverified: [] }]).catch((e) => e);
      expect(err).toBeInstanceOf(StoreError);
      expect(err.kind).toBe("quota");
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
    await expect(putSections([{ section: unlockedSection, unverified: [] }])).resolves.toBeUndefined();
  });

  it("other failures are unavailable", async () => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new Error("boom");
    };
    try {
      const err = await putProgress("a", { page: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(StoreError);
      expect(err.kind).toBe("unavailable");
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
  });
});

describe("review fixes", () => {
  it("unknown ids are not found and not locked", () => {
    for (const id of ["core/old-slug", "gone"]) {
      expect(getContent(id)).toBeUndefined();
      expect(isLocked(id)).toBe(false);
    }
    expect(getContent("core-intro")?.ok).toBe(true);
    expect(getContent("codex/p52-1")).toBeDefined();
  });

  it("falls back to free content when the store is unavailable", async () => {
    const orig = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () {
      throw new Error("no storage");
    };
    try {
      await initContent(fetchJson);
      expect(storeAvailable()).toBe(false);
      expect(getContent("core-intro")?.ok).toBe(true);
      expect(getContent("codex/p52-1")?.ok).toBe(false);
    } finally {
      IDBObjectStore.prototype.getAll = orig;
    }
    await initContent(fetchJson);
    expect(storeAvailable()).toBe(true);
  });

  it("addUnlocked applies saved fixes", async () => {
    const data: Record<string, string> = { "2d6:fixes": JSON.stringify([{ s: "codex/p52-1", b: 0, f: "text", from: "hello", to: "fixed" }]) };
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => data[k] ?? null, setItem() {} };
    try {
      await addUnlocked([{ section: structuredClone(unlockedSection), unverified: [] }]);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
    const r = getContent("codex/p52-1");
    expect(r?.ok && r.section.blocks[0]).toMatchObject({ text: "fixed" });
  });

  it("unverified is a copy, not the internal set", async () => {
    await addUnlocked([{ section: unlockedSection, unverified: ["a"] }]);
    const r = getContent("codex/p52-1");
    (r as unknown as { unverified: Set<string> }).unverified.add("zzz");
    const r2 = getContent("codex/p52-1");
    expect(r2?.ok && r2.unverified).toEqual(new Set(["a"]));
  });

  it("default fetcher throws on a bad response", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, json: async () => ({}) }));
    try {
      await expect(initContent()).rejects.toThrow(/404/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("quota error at commit time surfaces", async () => {
    const orig = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function () {
      const tx: Record<string, unknown> = {
        error: new DOMException("full", "QuotaExceededError"),
        objectStore: () => ({ put: () => ({}) }),
        abort() {},
      };
      setTimeout(() => (tx.onabort as () => void)(), 0);
      return tx as unknown as IDBTransaction;
    };
    try {
      const err = await putProgress("a", { page: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(StoreError);
      expect(err.kind).toBe("quota");
    } finally {
      IDBDatabase.prototype.transaction = orig;
    }
  });
});

const realManifest: string = fileURLToPath(new URL("../public/data/manifest.json", import.meta.url));
const realFree: string = fileURLToPath(new URL("../public/data/free.json", import.meta.url));
describe("shipped data", () => {
  it.skipIf(!existsSync(realManifest) || !existsSync(realFree))("loads the real manifest and free.json", async () => {
    const m = validateManifest(JSON.parse(readFileSync(realManifest, "utf8")));
    const f = JSON.parse(readFileSync(realFree, "utf8"));
    expect(m.books.map((b) => b.slug)).toContain("codex");
    expect(f.sections.length).toBeGreaterThan(0);
    await initContent(async (p) => (p.endsWith("manifest.json") ? m : f));
    expect(sectionIds().length).toBe(f.sections.length);
  });
});

describe("final fixes: the device copy and the lock generation", () => {
  const withLs = async (data: Record<string, string>, fn: () => Promise<void>) => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = String(v)),
    };
    try {
      await fn();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  };
  const book = () => putBook({ slug: "codex", edition: "tablet", fp: FP, key: new Uint8Array([1]), date: 1 });

  it("stores the clean text: a fix lives in memory only, and undo survives a reload", async () => {
    await book();
    const data: Record<string, string> = { "2d6:fixes": JSON.stringify([{ s: "codex/p52-1", b: 0, f: "text", from: "hello", to: "fixed" }]) };
    await withLs(data, async () => {
      const input = structuredClone(unlockedSection);
      await addUnlocked([{ section: input, unverified: [] }]);
      expect(input.blocks[0]).toMatchObject({ text: "hello" });                 // the caller's list is not changed
      const r = getContent("codex/p52-1");
      expect(r?.ok && r.section.blocks[0]).toMatchObject({ text: "fixed" });
      expect((await getSections())[0].section.blocks[0]).toMatchObject({ text: "hello" });
      undoFixes((r as { section: Section }).section);
      await initContent(fetchJson);
      const r2 = getContent("codex/p52-1");
      expect(r2?.ok && r2.section.blocks[0]).toMatchObject({ text: "hello" });
    });
  });

  it("initContent applies fixes in memory and never writes them back", async () => {
    await book();
    await putSections([{ section: structuredClone(unlockedSection), unverified: [] }]);
    const data: Record<string, string> = { "2d6:fixes": JSON.stringify([{ s: "codex/p52-1", b: 0, f: "text", from: "hello", to: "fixed" }]) };
    await withLs(data, () => initContent(fetchJson));
    expect((await getSections())[0].section.blocks[0]).toMatchObject({ text: "hello" });
  });

  it("addUnlocked refuses a write begun before a lock", async () => {
    const since = lockGeneration();
    await lockAll();
    await expect(addUnlocked([{ section: structuredClone(unlockedSection), unverified: [] }], { since })).rejects.toBeInstanceOf(LockedDuringImport);
    expect(await getSections()).toEqual([]);
    expect(isLocked("codex/p52-1")).toBe(true);
  });

  it("a lock waits for an addUnlocked in flight and clears it; the late write is refused", async () => {
    const since = lockGeneration();
    const adding = addUnlocked([{ section: structuredClone(unlockedSection), unverified: [] }], { since });
    const locking = lockAll();
    await expect(adding).rejects.toBeInstanceOf(LockedDuringImport);
    await locking;
    expect(await getSections()).toEqual([]);
    expect(isLocked("codex/p52-1")).toBe(true);
  });

  it("refreshFixes applies fixes that arrived later (pasted or remapped) to the unlocked sections", async () => {
    await addUnlocked([{ section: structuredClone(unlockedSection), unverified: [] }]);
    const data: Record<string, string> = { "2d6:fixes": JSON.stringify([{ s: "codex/p52-1", b: 0, f: "text", from: "hello", to: "later" }]) };
    const fn = vi.fn();
    const off = onContentChange(fn);
    await withLs(data, async () => refreshFixes());
    off();
    const r = getContent("codex/p52-1");
    expect(r?.ok && r.section.blocks[0]).toMatchObject({ text: "later" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect((await getSections())[0].section.blocks[0]).toMatchObject({ text: "hello" });
  });
});

describe("content change reasons", () => {
  it("an unlock is not a removal; a Lock is", async () => {
    const seen: boolean[] = [];
    const off = onContentChange((c) => seen.push(c.removed));
    await addUnlocked([{ section: structuredClone(unlockedSection), unverified: [] }]);
    await lockAll();
    off();
    expect(seen).toEqual([false, true]);
  });
});
