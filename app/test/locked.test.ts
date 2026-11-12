import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initContent } from "../src/content";
import { forgetAll } from "../src/lock/store";
import { byId, lib, rebuildLibrary, searchLibrary, termTarget } from "../src/library";
import { tableByCode, tableFor } from "../src/rolltable";
import { lockedCard, lockedLabel } from "../src/ui/locked";
import { homeLists } from "../src/pages/home";
import { isValidRoute, routeTitle } from "../src/shell/tabs";
import type { Section } from "../src/types";

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
      blocks: [{ type: "table", page: 52, code: "ENAT2", dice: "2D6", cols: 2, rows: 1, cells: [[{ box, kind: "text" }, { box, kind: "text" }]], h: { tablet: { v: [H] } } }],
    },
  ],
  codes: { ENAT2: "codex/p52-1" },
};
const freeSection: Section = {
  id: "codex/enat1-enchanted-armour-table-1", book: "codex", title: "ENAT1 - ENCHANTED ARMOUR TABLE 1", level: 2, chapter: null, pages: [10],
  blocks: [{ type: "table", page: 10, table: { title: "ENAT1", code: "ENAT1", dice: "D6", columns: ["D6", "Result"], rows: [["1-3", "Plain helm"], ["4-6", "Shiny helm"]] } }],
};
const fakeFree = {
  books: [
    { slug: "core", title: "Core Rules", missing_pages: [], page_images: [], free: true },
    { slug: "codex", title: "Tables Codex", missing_pages: [], page_images: [] },
  ],
  sections: [freeSection],
};
const fetchJson = async (p: string) => structuredClone(p.endsWith("manifest.json") ? fakeManifest : fakeFree);

const OLD = "codex/enchanted-armour-table-2"; // an old title-slug id of a locked section
let data: Record<string, string> = {};
beforeEach(() => {
  data = {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("lockedCard", () => {
  it("escapes the book name and carries the unlock action", () => {
    const html = String(lockedCard({ book: "codex", bookName: `<b>"Codex"</b>`, page: 52 }));
    expect(html).toContain("🔒 Open your <em>&lt;b&gt;&quot;Codex&quot;&lt;/b&gt;</em> PDF to unlock");
    expect(html).not.toContain("<b>");
    expect(html).toContain('data-act="unlock"');
    expect(html).toContain('data-book="codex"');
  });

  it("labels a locked page with the book and page only", () => {
    expect(lockedLabel({ book: "codex", bookName: "Tables Codex", page: 52 })).toBe("🔒 Tables Codex · p. 52");
  });
});

describe("library on the gateway", () => {
  beforeEach(async () => {
    await forgetAll();
    await initContent(fetchJson);
    rebuildLibrary();
  });

  it("stale locked ids are ignored", async () => {
    data["2d6:bookmarks"] = JSON.stringify([OLD, freeSection.id]);
    data["2d6:recent"] = JSON.stringify([OLD]);
    data["2d6:fixes"] = JSON.stringify([
      { s: OLD, b: 0, f: "cell", r: 0, c: 1, from: "Old", to: "Older" },
      { s: freeSection.id, b: 0, f: "cell", r: 0, c: 1, from: "Plain helm", to: "Plain helmet" },
    ]);
    await initContent(fetchJson);
    rebuildLibrary();
    const lists = homeLists();
    expect(lists.marks).toHaveLength(1);
    expect(String(lists.marks[0])).toContain(`#/s/${encodeURIComponent(freeSection.id)}`);
    expect(lists.marks.map(String).join("")).not.toContain(encodeURIComponent(OLD));
    expect(lists.recent).toEqual([]);
    const s = byId.get(freeSection.id)!;
    expect(s.blocks[0].type === "table" && s.blocks[0].table.rows[0][1]).toBe("Plain helmet");
    // kept for Task 9's remap, never deleted
    expect(JSON.parse(data["2d6:bookmarks"])).toContain(OLD);
    expect(JSON.parse(data["2d6:fixes"])).toHaveLength(2);
  });

  it("lists a known locked bookmark by its locked label only", () => {
    data["2d6:bookmarks"] = JSON.stringify(["codex/p52-1"]);
    const { marks } = homeLists();
    expect(marks).toHaveLength(1);
    expect(String(marks[0])).toContain("🔒 Tables Codex · p. 52");
  });

  it("indexes and searches only free and unlocked sections", () => {
    expect(lib.sections.map((s) => s.id)).toEqual([freeSection.id]);
    expect(byId.has("codex/p52-1")).toBe(false);
    expect(searchLibrary("enchanted armour").map((h) => h.id)).toEqual([freeSection.id]);
    // fuzzy search may offer the free ENAT1, never the locked section
    expect(searchLibrary("ENAT2").map((h) => h.id)).not.toContain("codex/p52-1");
    // a locked code still links, to its locked card
    expect(termTarget.get("enat2")).toBe("codex/p52-1");
  });

  it("tableByCode returns a locked result for a locked code", () => {
    const free = tableByCode("enat1");
    expect(free && "table" in free && free.sectionId).toBe(freeSection.id);
    expect(tableByCode("ENAT2")).toEqual({ locked: { book: "codex", bookName: "Tables Codex", page: 52 } });
    expect(tableFor("codex/p52-1")).toEqual({ locked: { book: "codex", bookName: "Tables Codex", page: 52 } });
    expect(tableByCode("NOPE1")).toBeUndefined();
    expect(tableFor(OLD)).toBeUndefined();
  });

  it("routes: a locked id is valid and titled by its label; an unknown id is not", () => {
    expect(isValidRoute("#/s/codex%2Fp52-1")).toBe(true);
    expect(routeTitle("#/s/codex%2Fp52-1")).toBe("🔒 Tables Codex · p. 52");
    expect(isValidRoute(`#/s/${encodeURIComponent(OLD)}`)).toBe(false);
  });
});

// The tools name tables by free id, opaque locked id or code: each must be known to the real manifest
// and free.json (an old title slug of a locked section would silently find nothing).
const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { existsSync, readFileSync } = await nodeMod("node:fs");
const { fileURLToPath } = await nodeMod("node:url");
const realManifest: string = fileURLToPath(new URL("../public/data/manifest.json", import.meta.url));
const realFree: string = fileURLToPath(new URL("../public/data/free.json", import.meta.url));

describe("tool table keys", () => {
  it.skipIf(!existsSync(realManifest) || !existsSync(realFree))("all resolve in the real content", async () => {
    await forgetAll();
    await initContent(async (p) => JSON.parse(readFileSync(p.endsWith("manifest.json") ? realManifest : realFree, "utf8")));
    rebuildLibrary();
    const { dungeonTableKeys } = await import("../src/tools/dungeon");
    const { realmTableKeys } = await import("../src/tools/realm");
    const { getContent, codeTarget } = await import("../src/content");
    const missing = [...dungeonTableKeys(), ...realmTableKeys(), "codex/weapon-manoeuvres-table-1", "codex/magic-scroll-table-1", "codex/ftcct1-failed-to-cast-correctly-table-1", "RFUT1"]
      .filter((k) => getContent(k) === undefined && !codeTarget(k));
    expect(missing).toEqual([]);
    // free level 1 rolls; a locked level-2 table is locked
    expect(tableFor("codex/ext1-exit-type-table-1") && "table" in tableFor("codex/ext1-exit-type-table-1")!).toBe(true);
    expect(tableFor("EXT2")).toMatchObject({ locked: { book: "codex" } });
  });
});
