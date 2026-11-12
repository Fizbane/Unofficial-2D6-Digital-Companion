import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { addUnlocked, getContent, initContent } from "../src/content";
import { fieldHash } from "../src/lock/hash";
import { hashIndex, type Manifest } from "../src/lock/manifest";
import { rebuildSection, type CellResult } from "../src/lock/rebuild";
import { forgetAll, getSections, putBook } from "../src/lock/store";
import { exportTodo, importPackFile, keepAnyway } from "../src/ui/books";
import { applyPack, makeTodo, validatePack } from "../src/lock/todo";

const KEY = new Uint8Array(32).map((_, i) => i * 7 + 1);
const FP = "a".repeat(64);
const ED = "backers";
const SID = "codex/p5-1";
const H = (f: Parameters<typeof fieldHash>[1], b: number, r: number, c: number, t: string) => fieldHash(KEY, f, SID, b, r, c, t);

// A section on page 5 (a rotated page of the "backers" edition): a title, a para and a 2 x 2 table.
const cols = 2;
const v = new Array<string>(3 + cols + 4).fill("");
v[hashIndex(cols, "title")] = H("title", 1, -1, -1, "Table title");
v[hashIndex(cols, { row: -1, col: 0 })] = H("col", 1, -1, 0, "Roll");
v[hashIndex(cols, { row: -1, col: 1 })] = H("col", 1, -1, 1, "Result");
const cellText = [["2", "Alpha"], ["3", "Beta [4]"]];
cellText.forEach((row, r) => row.forEach((t, c) => (v[hashIndex(cols, { row: r, col: c })] = H("cell", 1, r, c, t))));
const loc = (x: number, y: number) => ({ box: [x, y, x + 0.1, y + 0.1] as [number, number, number, number], kind: "ocr" as const });

const manifest: Manifest = {
  version: 1,
  books: [
    { slug: "core", name: "Core Rules", free: true, editions: [] },
    { slug: "codex", name: "Tables Codex", free: false, editions: [{ id: ED, fp: FP, pages: 9, rotate: 90, rotatePages: [5] }] },
  ],
  sections: [{
    id: SID, book: "codex", level: 2, chapter: null, pages: [5],
    title: { page: 5, loc: loc(0, 0), h: { [ED]: { v: [H("title", -1, -1, -1, "Sect title")] } } },
    blocks: [
      { type: "para", page: 5, loc: loc(0.1, 0.1), h: { [ED]: { v: [H("para", 0, -1, -1, "Some prose")] } } },
      {
        type: "table", page: 5, dice: "2D6", cols, rows: 2, code: "ZZ1",
        title: loc(0.2, 0.2), colLocs: [loc(0.3, 0.3), { box: [0, 0, 0, 0], kind: "text" }],
        cells: [[loc(0.4, 0.4), loc(0.5, 0.5)], [loc(0.6, 0.6), { box: [0, 0, 0, 0], kind: "ocr" }]],
        h: { [ED]: { v } },
      },
    ],
  }],
  codes: { ZZ1: SID },
};
const fetchJson = async (p: string) => structuredClone(p.endsWith("manifest.json") ? manifest : { books: [], sections: [] });

// Stored with most fields unverified: only the title, the para and cell 1:0:0 were read right.
async function seed(): Promise<void> {
  const ok = (text: string): CellResult => ({ text, ok: true });
  const cells = new Map<string, CellResult>([
    ["-1:title", ok("Sect title")], ["0:para", ok("Some prose")], ["1:0:0", ok("2")],
    ["1:0:1", { text: "Alpha?", ok: false }],
  ]);
  await addUnlocked([rebuildSection(manifest.sections[0], ED, cells)]);
}

beforeEach(async () => {
  await forgetAll();
  await initContent(fetchJson);
  await seed();
});

describe("makeTodo", () => {
  it("lists the unverified fields and holds no text", () => {
    const t = makeTodo("codex", ED, "unverified");
    expect(t.book).toBe("codex");
    expect(t.edition).toBe(ED);
    expect(t.items.map((i) => i.id).sort()).toEqual([
      `${SID}#cell:1:0:1`, `${SID}#cell:1:1:0`, `${SID}#cell:1:1:1`, `${SID}#col:1:-1:0`, `${SID}#col:1:-1:1`, `${SID}#title:1:-1:-1`,
    ].sort());
    for (const i of t.items) expect(Object.keys(i)).not.toContain("text");
    expect(JSON.stringify(t)).not.toMatch(/"text":|Alpha|Beta|Sect title|Table title|prose/);
  });

  it("scope all lists every hashed field of the stored sections", () => {
    expect(makeTodo("codex", ED, "all").items).toHaveLength(9);     // title, para, table title, 2 headers, 4 cells
  });

  it("gives page, box, kind, column and dice, and the page rotation", () => {
    const t = makeTodo("codex", ED, "unverified");
    const c = t.items.find((i) => i.id === `${SID}#cell:1:0:1`)!;
    expect(c).toEqual({ id: c.id, page: 5, box: [0.5, 0.5, 0.6, 0.6], rotate: 90, kind: "ocr", columns: { count: 2, index: 1 }, dice: "2D6" });
    expect(t.items.find((i) => i.id === `${SID}#title:1:-1:-1`)!.columns).toBeNull();
  });

  it("emits rotate 0 on an unrotated page and box null for unlocated cells", () => {
    const m2 = structuredClone(manifest);
    (m2.books[1].editions[0] as { rotatePages: number[] }).rotatePages = [];
    return initContent(async (p) => structuredClone(p.endsWith("manifest.json") ? m2 : { books: [], sections: [] })).then(async () => {
      await seed();
      const t = makeTodo("codex", ED, "unverified");
      expect(t.items.every((i) => i.rotate === 0)).toBe(true);
      expect(t.items.find((i) => i.id === `${SID}#cell:1:1:1`)!.box).toBeNull();
      expect(t.items.find((i) => i.id === `${SID}#col:1:-1:1`)!.box).toBeNull();
    });
  });
});

const pack = (items: { id: string; text: string }[], over: object = {}) => ({ book: "codex", edition: ED, items, ...over });

describe("validatePack", () => {
  it("accepts a plain pack", () => {
    const p = pack([{ id: `${SID}#cell:1:0:1`, text: "Alpha" }]);
    expect(validatePack(p)).toEqual(p);
  });
  it("rejects extra keys, oversized text and a wrong book", () => {
    expect(() => validatePack(pack([], { extra: 1 }))).toThrow();
    expect(() => validatePack(pack([{ id: `${SID}#cell:1:0:1`, text: "x", more: 1 } as never]))).toThrow();
    expect(() => validatePack(pack([{ id: `${SID}#cell:1:0:1`, text: "x".repeat(2001) }]))).toThrow();
    expect(() => validatePack(pack([{ id: `${SID}#cell:1:0:1`, text: "x".repeat(2000) }]))).not.toThrow();
    expect(() => validatePack(pack([], { book: "nosuch" }))).toThrow();
    expect(() => validatePack(pack([], { book: "core" }))).toThrow();
    expect(() => validatePack(pack([{ id: "realm/p1-1#cell:0:0:0", text: "x" }]))).toThrow();   // an id of another book
    expect(() => validatePack(pack([{ id: "nonsense", text: "x" }]))).toThrow();
    expect(() => validatePack(pack([], { edition: "zzz" }))).toThrow();
  });
  it("caps the item count", () => {
    const it = { id: `${SID}#cell:1:0:1`, text: "a" };
    expect(() => validatePack(pack(new Array(50_001).fill(it)))).toThrow();
  });
});

describe("applyPack", () => {
  const unv = async () => new Set((await getSections()).find((s) => s.section.id === SID)!.unverified);
  const table = () => {
    const s = getContent(SID);
    const b = s?.ok ? s.section.blocks[1] : undefined;
    if (!b || b.type !== "table") throw new Error("no table");
    return b.table;
  };

  it("accepts a matching row, updates the text and drops it from unverified", async () => {
    expect(await unv()).toContain("1:0:1");
    const r = await applyPack(pack([{ id: `${SID}#cell:1:0:1`, text: "Alpha" }]), KEY);
    expect(r).toEqual({ accepted: 1, mismatched: [], unknown: 0, alreadyVerified: [] });
    expect(await unv()).not.toContain("1:0:1");
    expect(await unv()).toContain("1:1:0");
    const s = getContent(SID);
    expect(s?.ok && s.unverified?.has("1:0:1")).toBe(false);
    expect(table().rows[0][1]).toBe("Alpha");
  });

  it("matches after normalisation and fills a column header", async () => {
    const r = await applyPack(pack([{ id: `${SID}#col:1:-1:1`, text: " Result " }, { id: `${SID}#cell:1:1:1`, text: "Beta  [4]" }]), KEY);
    expect(r.accepted).toBe(2);
    expect(table().columns[1]).toBe("Result");
    expect(table().rows[1][1]).toBe("Beta [4]");
  });

  it("lists a mismatch and leaves the stored row alone", async () => {
    const r = await applyPack(pack([{ id: `${SID}#cell:1:0:1`, text: "Alpa" }, { id: `${SID}#cell:1:1:0`, text: "3" }]), KEY);
    expect(r.accepted).toBe(1);
    expect(r.mismatched).toEqual([{ id: `${SID}#cell:1:0:1`, text: "Alpa" }]);
    expect(await unv()).toContain("1:0:1");
    expect(table().rows[0][1]).toBe("Alpha?");
  });

  it("stores a forced row as unverified", async () => {
    const id = `${SID}#cell:1:0:1`;
    const r = await applyPack(pack([{ id, text: "Alpa" }]), KEY, [id]);
    expect(r).toEqual({ accepted: 0, mismatched: [], unknown: 0, alreadyVerified: [] });
    expect(await unv()).toContain("1:0:1");
    expect(table().rows[0][1]).toBe("Alpa");
  });

  it("never touches a verified cell: a match or a forced mismatch is reported as already verified", async () => {
    const id = `${SID}#cell:1:0:0`;                                 // verified at seed time
    const r = await applyPack(pack([{ id, text: "2" }, { id, text: "9" }]), KEY, [id]);
    expect(r.accepted).toBe(0);
    expect(r.mismatched).toEqual([]);
    expect(r.alreadyVerified).toEqual([id, id]);
    expect(table().rows[0][0]).toBe("2");
    expect(await unv()).not.toContain("1:0:0");
  });

  it("counts ids that name no hashed field as unknown, and mismatches under a wrong key", async () => {
    const r = await applyPack(pack([{ id: `${SID}#cell:1:9:9`, text: "x" }, { id: "codex/p77-1#cell:0:0:0", text: "x" }]), KEY);
    expect(r).toEqual({ accepted: 0, mismatched: [], unknown: 2, alreadyVerified: [] });
    const wrong = await applyPack(pack([{ id: `${SID}#cell:1:0:1`, text: "Alpha" }]), new Uint8Array(32));
    expect(wrong.accepted).toBe(0);
    expect(wrong.mismatched).toHaveLength(1);
  });

  it("rebuilds the section title from a verified title field", async () => {
    await applyPack(pack([{ id: `${SID}#title:-1:-1:-1`, text: "Sect title" }]), KEY);
    const s = getContent(SID);
    expect(s?.ok && s.section.title).toBe("Sect title");
  });
});

describe("Books UI helpers", () => {
  const rec = { slug: "codex", edition: ED, fp: FP, key: KEY, date: 1 };
  const file = (o: unknown) => new Blob([JSON.stringify(o)]);

  it("needs the book's key: without a BookRecord it says to unlock first", async () => {
    expect(await exportTodo("codex", "all")).toEqual({ note: "Unlock this book from its PDF first" });
    expect(await importPackFile("codex", file(pack([])))).toBe("Unlock this book from its PDF first");
  });

  it("exports a to-do with no text once the key is on the device", async () => {
    await putBook(rec);
    const r = await exportTodo("codex", "unverified");
    if (!("json" in r)) throw new Error("no json");
    expect(r.count).toBe(6);
    expect(r.json).not.toMatch(/"text":/);
  });

  it("imports a pack, lists mismatches escaped, and Keep anyway stores the row unverified", async () => {
    await putBook(rec);
    const note = await importPackFile("codex", file(pack([{ id: `${SID}#cell:1:0:1`, text: "Alpha" }, { id: `${SID}#cell:1:1:0`, text: "<b>3</b>" }])));
    expect(note).toContain("1 row checked and verified");
    expect(note).toContain("1 did not match");
    await keepAnyway(`${SID}#cell:1:1:0`);
    const st = (await getSections()).find((x) => x.section.id === SID)!;
    expect(st.unverified).toContain("1:1:0");
    const b = st.section.blocks[1];
    expect(b.type === "table" && b.table.rows[1][0]).toBe("<b>3</b>");
  });

  it("lists rows left as is, and a save failure becomes a note", async () => {
    await putBook(rec);
    const note = await importPackFile("codex", file(pack([{ id: `${SID}#cell:1:0:0`, text: "2" }])));
    expect(note).toContain("1 already checked, left as is");
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => { throw new Error("boom"); };
    try {
      const n2 = await importPackFile("codex", file(pack([{ id: `${SID}#cell:1:0:1`, text: "Alpha" }])));
      expect(n2).toContain("Nothing was changed.");
      expect(n2).toContain("save the checked rows");
    } finally {
      IDBObjectStore.prototype.put = orig;
    }
  });

  it("refuses a pack whose edition differs from the BookRecord", async () => {
    await putBook({ ...rec, edition: "other" });
    expect(await importPackFile("codex", file(pack([])))).toContain("different book or edition");
  });

  it("refuses garbage and a pack for another edition", async () => {
    await putBook(rec);
    expect(await importPackFile("codex", new Blob(["{not json"]))).toContain("isn't a valid pack");
    expect(await importPackFile("codex", file({ ...pack([]), extra: 1 }))).toContain("isn't a valid pack");
  });
});
