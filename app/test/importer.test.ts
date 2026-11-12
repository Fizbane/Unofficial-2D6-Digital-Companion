import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../src/lock/store";
import { lockAll } from "../src/content";
import { ImportCancelled, runImport } from "../src/lock/importer";
import { rebuildSection } from "../src/lock/rebuild";
import { FILE, FP, FREE_FILE, MANIFEST, S1, S2, deps, fakes } from "./importfixture";
// ------------------------------------------------------------------------------------------- localStorage

const g = globalThis as { localStorage?: unknown };
let ls: Record<string, string>;
beforeEach(async () => {
  await store.forgetAll();
  ls = {};
  g.localStorage = {
    getItem: (k: string) => (k in ls ? ls[k] : null),
    setItem: (k: string, v: string) => void (ls[k] = String(v)),
    removeItem: (k: string) => void delete ls[k],
  };
});
afterEach(() => delete g.localStorage);

// ------------------------------------------------------------------------------------------- tests

describe("runImport", () => {
  it("reports the free version as free", async () => {
    const f = fakes();
    expect(await runImport(FREE_FILE, deps(f))).toEqual({ kind: "free" });
    expect(f.openPdf).not.toHaveBeenCalled();
  });

  it("reports random bytes as unknown and never parses them", async () => {
    const f = fakes();
    const junk = new Uint8Array(5000).map((_, i) => (i * 7919) & 255);
    expect(await runImport(new Blob([junk]), deps(f))).toEqual({ kind: "unknown" });
    expect(f.openPdf).not.toHaveBeenCalled();
  });

  it("rejects truncated file", async () => {
    const f = fakes();
    expect(await runImport(FILE.slice(0, FILE.size >> 1), deps(f))).toEqual({ kind: "unknown" });
    expect(f.openPdf).not.toHaveBeenCalled();
  });

  it("leaves localStorage alone (the main thread remaps legacy ids)", async () => {
    ls["2d6:bookmarks"] = JSON.stringify(["codex/treasure-table"]);
    await runImport(FILE, deps(fakes()));
    expect(ls["2d6:bookmarks"]).toBe(JSON.stringify(["codex/treasure-table"]));
  });

  it("unlocks a two-page book with the planned verified and unverified rows", async () => {
    const f = fakes();
    const phases: string[] = [];
    const r = await runImport(FILE, deps(f, undefined, (p) => phases.push(p.phase)));
    // Table 1: rows 0 (confusion) and 2 (patch) verify, row 1 ("Xyzzy") does not. Table 2: its dice cell is unlocated.
    expect(r).toEqual({ kind: "done", book: "codex", edition: "tablet", rows: 4, verified: 2, unverified: 2, patches: { available: 1, tried: 1, hit: 1 } });
    expect(phases).toContain("hash");
    expect(phases).toContain("pages");
    const got = new Map((await store.getSections()).map((s) => [s.section.id, s]));
    const a = got.get(S1)!, b = got.get(S2)!;
    expect(a.section.title).toBe("Treasure");
    expect(a.unverified).toEqual(["0:1:1"]);
    const t = a.section.blocks[0];
    expect(t.type === "table" && t.table.rows).toEqual([["Gold", "10"], ["Silver", "Xyzzy"], ["Helmet", "5"]]);
    expect(b.section.title).toBe("Chapter Two");
    expect(b.unverified).toEqual(["2:0:0"]);
    expect(b.section.blocks.map((x) => x.type)).toEqual(["heading", "para", "table", "image"]);
    const books = await store.getBooks();
    expect(books.map((x) => [x.slug, x.edition, x.fp])).toEqual([["codex", "tablet", FP]]);
  });

  it("resumes from progress", async () => {
    const f = fakes();
    const ac = new AbortController();
    await expect(runImport(FILE, deps(f, ac.signal, (p) => { if (p.phase === "pages" && p.done === 1) ac.abort(); }))).rejects.toBeInstanceOf(ImportCancelled);
    expect(f.reads.every((p) => p === 1)).toBe(true);
    expect((await store.getSections()).map((s) => s.section.id)).toEqual([S1]);

    const f2 = fakes();
    const r = await runImport(FILE, deps(f2));
    expect(f2.reads.length).toBeGreaterThan(0);
    expect(f2.reads.every((p) => p === 2)).toBe(true);
    expect(r).toMatchObject({ kind: "done", rows: 4, verified: 2, unverified: 2 });
  });

  it("lock cancels running import", async () => {
    const f = fakes();
    let locked: Promise<void> | undefined;
    f.onRead = (p) => { if (p === 2 && !locked) locked = lockAll(); };
    await expect(runImport(FILE, deps(f))).rejects.toBeInstanceOf(ImportCancelled);
    await locked;
    expect(await store.getSections()).toEqual([]);
    expect(await store.getBooks()).toEqual([]);
  });

  it("stores page images", async () => {
    const f = fakes();
    await runImport(FILE, deps(f));
    expect(await store.getPage("codex", 1)).toBeInstanceOf(Blob);
    expect(await store.getPage("codex", 2)).toBeInstanceOf(Blob);
    // each page rendered once for its image (scale 1.5)
    expect(f.renders.filter((x) => x.scale === 1.5).map((x) => x.page)).toEqual([1, 2]);
  });
});

describe("rebuildSection", () => {
  it("takes the title from the first heading, else the first table's title, and flags unverified keys", () => {
    const skel = MANIFEST.sections[1];
    const cells = new Map([
      ["0:heading", { text: "Chapter Two", ok: true }],
      ["1:para", { text: "The emd.", ok: false }],
      ["2:0:0", { text: "", ok: false }],
      ["2:0:1", { text: "Nothing", ok: true }],
    ]);
    const s = rebuildSection(skel, "tablet", cells);
    expect(s.section.title).toBe("Chapter Two");
    expect(s.unverified.sort()).toEqual(["1:para", "2:0:0"]);
    expect(s.section.blocks[1]).toEqual({ type: "para", page: 2, text: "The emd." });
    const t = s.section.blocks[2];
    expect(t.type === "table" && t.table).toMatchObject({ dice: "1D6", columns: ["", ""], rows: [["", "Nothing"]] });

    const noHeading = { ...skel, blocks: [{ ...skel.blocks[2] }] } as typeof skel;
    const t2 = rebuildSection(noHeading, "tablet", new Map([["0:title", { text: "Roll Table", ok: true }]]));
    expect(t2.section.title).toBe("Roll Table");
  });
});

describe("a section with no pages", () => {
  const EMPTY = "codex/p9-1";
  const withEmpty = () => ({
    ...MANIFEST,
    sections: [...MANIFEST.sections, { id: EMPTY, book: "codex", level: 2, chapter: null, pages: [], blocks: [] }],
  }) as typeof MANIFEST;

  it("is stored once the run's pages are done", async () => {
    const r = await runImport(FILE, { ...deps(fakes()), manifest: withEmpty() });
    expect(r.kind).toBe("done");
    expect((await store.getSections()).map((s) => s.section.id)).toContain(EMPTY);
  });

  it("is stored by a resumed run too", async () => {
    const ac = new AbortController();
    await runImport(FILE, { ...deps(fakes(), ac.signal, (p) => { if (p.phase === "pages" && p.done === 1) ac.abort(); }), manifest: withEmpty() }).catch(() => {});
    await runImport(FILE, { ...deps(fakes()), manifest: withEmpty() });
    expect((await store.getSections()).map((s) => s.section.id)).toContain(EMPTY);
  });
});

describe("the heartbeat", () => {
  it("calls onAlive once the OCR has started and from the field loop", async () => {
    const alive: number[] = [];
    await runImport(FILE, { ...deps(fakes()), onAlive: () => alive.push(Date.now()) });
    expect(alive.length).toBeGreaterThanOrEqual(2);              // the OCR start, and the field loop's first beat
  });
});
