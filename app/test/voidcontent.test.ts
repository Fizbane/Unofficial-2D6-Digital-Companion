// 2D6 Void through the content gateway: its library file is a local build output, so the gateway (and
// the tools on it) must work without it, and must never show the Dungeon's unlocked books in Void.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstLocked, getContent, initContent, isLocked, manifest, sectionIds, voidBookLoaded, voidLibraryLoaded } from "../src/content";
import { _setGameForTest, GAMES } from "../src/games";
import { forgetAll, putBook, putSections, useGameStore } from "../src/lock/store";
import { lib, rebuildLibrary } from "../src/library";
import { logNodes } from "../src/tools/combatlog";
import { html } from "../src/ui/html";
import type { Section } from "../src/types";

afterEach(() => {
  _setGameForTest("dungeon");
  useGameStore("dungeon");
});

const voidSection: Section = {
  id: "void/aliens", book: "void", title: "Aliens", level: 2, chapter: null, pages: [60],
  blocks: [{ type: "table", page: 60, table: { title: "Alien", code: "IAUT1", dice: "D6", columns: ["a"], rows: [["x"]] } }],
};

describe("2D6 Void content", () => {
  it("runs on nothing when library-void.json isn't built", async () => {
    _setGameForTest("void");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const asked: string[] = [];
    await initContent(async (p) => {
      asked.push(p);
      throw new Error(`failed to load ${p}: 404`);
    });
    expect(asked).toEqual(["data/manifest-void.json", GAMES.void.libraryUrl]); // never the Dungeon's manifest or free set
    expect(sectionIds()).toEqual([]);
    expect(voidLibraryLoaded()).toBe(false);
    expect(manifest().books).toEqual([]);
    expect(getContent("void/aliens")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("treats a malformed library file like a missing one", async () => {
    _setGameForTest("void");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await initContent(async () => ({ books: "x", sections: 5 }));
    expect(sectionIds()).toEqual([]);
    expect(voidLibraryLoaded()).toBe(false);
    warn.mockRestore();
  });

  it("shows the Void library when it is there, and none of the Dungeon's unlocked books", async () => {
    await forgetAll();
    await putSections([{ section: { ...voidSection, id: "codex/p52-1", book: "codex" }, unverified: [] }]);
    _setGameForTest("void");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await initContent(async (path) => {
      if (path.includes("manifest")) throw new Error("404");
      return { books: [{ slug: "void", title: "2D6 Void", missing_pages: [], page_images: [] }], sections: [voidSection] };
    });
    warn.mockRestore();
    expect(voidLibraryLoaded()).toBe(true);
    expect(sectionIds()).toEqual(["void/aliens"]);
    expect(getContent("codex/p52-1")).toBeUndefined();
    expect(isLocked("void/aliens")).toBe(false);
    const r = getContent("void/aliens");
    expect(r?.ok && r.section.title).toBe("Aliens");
    await forgetAll();
  });
});

describe("2D6 Void is a locked game", () => {
  const FP = "a".repeat(64);
  const manifestJson = {
    version: 1,
    books: [{ slug: "void", name: "2D6 Void", free: false, editions: [{ id: "core", fp: FP, pages: 228 }] }],
    sections: [{ id: "void/p60-1", book: "void", level: 2, chapter: null, pages: [60], blocks: [] }],
    codes: {},
  };
  const fetcher = async (p: string) => {
    if (p === "data/manifest-void.json") return manifestJson;
    throw new Error(`404 ${p}`); // no dev library
  };

  it("is locked while only the manifest is there: the section is a placeholder", async () => {
    useGameStore("void");
    await forgetAll();
    _setGameForTest("void");
    await initContent(fetcher);
    expect(voidBookLoaded()).toBe(false);
    expect(manifest().books.map((b) => b.name)).toEqual(["2D6 Void"]);
    expect(isLocked("void/p60-1")).toBe(true);
    const r = getContent("void/p60-1");
    expect(r && !r.ok && r.locked.bookName).toBe("2D6 Void");
  });

  it("in development, a section the local library holds is not locked (Home's Library card asks)", async () => {
    useGameStore("void");
    await forgetAll();
    _setGameForTest("void");
    await initContent(async (p) => p === "data/manifest-void.json" ? manifestJson
      : { books: [{ slug: "void", title: "2D6 Void", missing_pages: [], page_images: [] }], sections: [{ ...voidSection, id: "void/p60-1" }] });
    expect(isLocked("void/p60-1")).toBe(false);
    expect(firstLocked("void")).toBeUndefined(); // no locked placeholder to point at, so no lock label to read
  });

  it("unlocks once the owner's book is stored, in Void's own database", async () => {
    useGameStore("void");
    await forgetAll();
    await putBook({ slug: "void", edition: "core", fp: FP, key: new Uint8Array(32), date: 0 });
    await putSections([{ section: { ...voidSection, id: "void/p60-1" }, unverified: [] }]);
    _setGameForTest("void");
    await initContent(fetcher);
    expect(voidBookLoaded()).toBe(true);
    expect(isLocked("void/p60-1")).toBe(false);
    // a release has no library file: the book list comes from the manifest, so the unlocked section has its book
    rebuildLibrary();
    expect(lib.books.map((b) => [b.slug, b.title])).toEqual([["void", "2D6 Void"]]);
    expect(lib.sections.map((s) => s.id)).toEqual(["void/p60-1"]);
    // the Dungeon's database never sees it
    useGameStore("dungeon");
    _setGameForTest("dungeon");
    const asked: string[] = [];
    await initContent(async (p) => { asked.push(p); throw new Error("x"); }).catch(() => {});
    useGameStore("void");
    await forgetAll();
  });
});

describe("2D6 Void combat log", () => {
  it("draws saved entries as data: text escaped, only known elements and classes", () => {
    const inline = (s: string) => html`<i>${s}</i>`;
    const h = String(logNodes(["You hit <b>", { el: "span", cls: "vc-effect", kids: ["→ ", { book: "Bite <x>" }] }, { el: "span", cls: 'x" onclick="y', kids: ["t"] }], inline));
    expect(h).toContain("You hit &lt;b&gt;");
    expect(h).toContain('<span class="vc-effect">→ <i>Bite &lt;x&gt;</i></span>');
    expect(h).toContain("<span>t</span>");
    expect(h).not.toContain("onclick");
  });
});
