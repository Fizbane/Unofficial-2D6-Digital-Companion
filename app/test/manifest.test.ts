import { describe, it, expect } from "vitest";
import { assertNoFreeText, hashIndex, validateManifest } from "../src/lock/manifest";
import { MANIFEST_STRING, arr, num, obj, oneOf, opt, str } from "../src/lock/validate";

const H = "AbCdEfGhIjKlMnOpQrSt_-"; // 22 chars
const PK = "zYxWvUtSrQpOnMlKjIhG-_"; // patch key: fieldHash of the raw text
const FP = "393b841ef700f333e8478dee14847bdf792923fda719fe7b639f45c1faed8bd2";
const box = [0.1, 0.2, 0.3, 0.4];

/** A hand-made manifest: one free book, one locked book with a single section. */
function sample(): any {
  return {
    version: 1,
    books: [
      { slug: "core", name: "Core Rules", free: true, editions: [] },
      {
        slug: "codex",
        name: "Tables Codex",
        free: false,
        editions: [
          { id: "tablet", fp: FP, pages: 120 },
          { id: "v1", fp: FP.replace(/3/g, "4"), pages: 118, rotate: 90 },
        ],
        freeFp: [FP],
      },
    ],
    sections: [
      {
        id: "codex/p12-1",
        book: "codex",
        level: 2,
        chapter: null,
        pages: [12],
        legacy: { tablet: H },
        blocks: [
          { type: "heading", page: 12, level: 2, loc: { box, kind: "text" }, h: { tablet: { v: [H] } } },
          {
            type: "para",
            page: 12,
            loc: { box, kind: "ocr" },
            h: { tablet: { v: [H], patch: { [PK]: [[3, 1, "é"]] } } },
            marks: [[0, 4, "b"]],
          },
          {
            type: "table",
            page: 12,
            code: "EA1",
            dice: "2D6",
            cols: 2,
            rows: 1,
            title: { box, kind: "text" },
            cells: [[{ box, kind: "dice" }, { box, kind: "text" }]],
            h: { tablet: { v: [H, H, ""] } },
            continued: false,
            blank_rows: 0,
          },
          { type: "image", page: 12, box },
        ],
      },
    ],
    codes: { EA1: "codex/p12-1" },
  };
}

const fails = (m: unknown, path: string) => expect(() => validateManifest(m)).toThrow(`manifest: ${path}`);

describe("validateManifest", () => {
  it("accepts a hand-made 1-section manifest", () => {
    const m = validateManifest(sample());
    expect(m.sections[0].blocks).toHaveLength(4);
    expect(m.codes.EA1).toBe("codex/p12-1");
    const e = sample(); // 4 code points (8 UTF-16 units) is within the insert limit, in the schema and in the walk
    e.sections[0].blocks[1].h.tablet.patch[PK] = [[0, 0, "😀😀😀😀"]];
    expect(() => validateManifest(e)).not.toThrow();
    expect(m.books[0].freeFp).toBeUndefined();
  });

  it("accepts a section title, a table's rowPages and colLocs, and an edition's rotatePages", () => {
    const m = sample();
    m.sections[0].title = { page: 12, loc: { box, kind: "ocr" }, h: { tablet: { v: [H], patch: { [PK]: [[0, 2, ""]] } } } };
    m.sections[0].blocks[2].rowPages = [12];
    m.sections[0].blocks[2].colLocs = [{ box, kind: "ocr" }, { box, kind: "text" }];
    m.books[1].editions[1].rotatePages = [6, 7, 12];
    const v = validateManifest(m);
    expect(v.sections[0].title!.page).toBe(12);
    expect(v.books[1].editions[1].rotatePages).toEqual([6, 7, 12]);
    const bad = sample();
    bad.sections[0].title = { page: 12, loc: { box, kind: "ocr" }, h: { other: { v: [H] } } };
    fails(bad, "sections[0].title.h.other");
    const txt = sample();
    txt.sections[0].title = { page: 12, loc: { box, kind: "ocr" }, h: { tablet: { v: [H] } }, text: "Goblins" };
    fails(txt, "sections[0].title.text");
    const rp = sample();
    rp.sections[0].blocks[2].rowPages = [0];
    fails(rp, "sections[0].blocks[2].rowPages[0]");
  });

  it("hashIndex: title, intro, notes, then column headers, then cells row-major", () => {
    expect([hashIndex(3, "title"), hashIndex(3, "intro"), hashIndex(3, "notes")]).toEqual([0, 1, 2]);
    expect(hashIndex(3, { row: -1, col: 0 })).toBe(3);
    expect(hashIndex(3, { row: -1, col: 2 })).toBe(5);
    expect(hashIndex(3, { row: 0, col: 0 })).toBe(6);
    expect(hashIndex(3, { row: 2, col: 1 })).toBe(6 + 2 * 3 + 1);
    expect(() => hashIndex(3, { row: 0, col: 3 })).toThrow(RangeError);
  });

  it("rejects an extra key with its path", () => {
    const m = sample();
    m.sections[0].blocks[0].extra = 1;
    fails(m, "sections[0].blocks[0].extra");
    const t = sample();
    t.books[1].editions[0].note = "x";
    fails(t, "books[1].editions[0].note");
  });

  it("rejects a para block carrying a text key", () => {
    const m = sample();
    m.sections[0].blocks[1].text = "The cloak shimmers";
    fails(m, "sections[0].blocks[1].text");
  });

  it("rejects bad values with their paths", () => {
    const cases: [(m: any) => void, string][] = [
      [(m) => (m.version = 2), "version"],
      [(m) => (m.books[0].name = "Dungeon Book"), "books[0].name"],
      [(m) => (m.books[1].editions[0].fp = "abc"), "books[1].editions[0].fp"],
      [(m) => (m.sections[0].blocks[0].h.tablet.v[0] = "short"), "sections[0].blocks[0].h.tablet.v[0]"],
      [(m) => (m.sections[0].blocks[2].dice = "roll two"), "sections[0].blocks[2].dice"],
      [(m) => (m.sections[0].blocks[2].code = "ea1"), "sections[0].blocks[2].code"],
      [(m) => (m.sections[0].blocks[3].box = [0, 0, 2, 1]), "sections[0].blocks[3].box[2]"],
      [(m) => (m.sections[0].blocks[3].type = "video"), "sections[0].blocks[3].type"],
      [(m) => (m.sections[0].legacy = { tablet: "nope" }), "sections[0].legacy.tablet"],
      [(m) => (m.codes = { "bad code": "codex/p12-1" }), "codes.bad code"],
      [(m) => (m.codes = { EA1: "The cloak shimmers" }), "codes.EA1"],
      [(m) => (m.sections[0].blocks[1].h.tablet.patch[PK] = [[0, 0, "cloak"]]), `sections[0].blocks[1].h.tablet.patch.${PK}[0][2]`],
      [(m) => (m.sections[0].blocks[1].h.tablet.patch[PK] = [[0, 0, "a"], [1, 0, "b"], [2, 0, "c"], [3, 0, "d"]]), `sections[0].blocks[1].h.tablet.patch.${PK}`],
      [(m) => (m.sections[0].blocks[1].h.tablet.patch[PK] = [[0, 0, "abc"], [1, 0, "de"]]), `sections[0].blocks[1].h.tablet.patch.${PK}`],
      [(m) => (m.sections[0].blocks[1].h.tablet.patch = { "0": [[0, 0, "a"]] }), "sections[0].blocks[1].h.tablet.patch.0"],
      [(m) => (m.sections[0].blocks[1].h.tablet.patch[PK] = [[0, 0, "😀😀😀"], [1, 0, "ab"]]), `sections[0].blocks[1].h.tablet.patch.${PK}`],
      [(m) => (m.books[1].editions[0].id = "a-b-c"), "books[1].editions[0].id"],
      [(m) => (m.sections[0].book = "realm"), "sections[0].book"],
      [(m) => (m.sections[0].id = "core/p12-1"), "sections[0].id"],
      [(m) => (m.sections[0].legacy = { backers: H }), "sections[0].legacy.backers"],
      [(m) => (m.sections[0].blocks[0].h = { backers: { v: [H] } }), "sections[0].blocks[0].h.backers"],
      [(m) => (m.codes = { EA2: "codex/p13-1" }), "codes.EA2"],
      [(m) => (m.sections = {}), "sections"],
      [(m) => (m.sections[0].pages = [1.5]), "sections[0].pages[0]"],
    ];
    for (const [mut, path] of cases) {
      const m = sample();
      mut(m);
      fails(m, path);
    }
  });

  it("rejects __proto__, constructor and prototype keys anywhere", () => {
    fails(JSON.parse('{"__proto__": {}, "version": 1}'), "__proto__");
    const m = sample();
    const raw = JSON.stringify(m).replace('"legacy":{', '"legacy":{"constructor":"' + H + '",');
    fails(JSON.parse(raw), "sections[0].legacy.constructor");
    const c = sample();
    c.codes = JSON.parse('{"prototype": "codex/p12-1"}');
    fails(c, "codes.prototype");
  });

  it("no free text: walking a manifest finds a free string", () => {
    const m = sample();
    expect(() => assertNoFreeText(m)).not.toThrow();
    m.sections[0].chapter = "The cloak shimmers";
    expect(() => assertNoFreeText(m)).toThrow("manifest: sections[0].chapter");
    expect(() => validateManifest(m)).toThrow("manifest: sections[0].chapter");
    expect(() => assertNoFreeText({ anywhere: ["The cloak shimmers"] })).toThrow("manifest: anywhere[0]");
    expect(MANIFEST_STRING.test("The cloak shimmers")).toBe(false);
  });

  it("no free text: title slugs are rejected by the schema and by the walk", () => {
    const cases: [(m: any) => void, string][] = [
      [(m) => (m.sections[0].chapter = "the-cloak-shimmers"), "sections[0].chapter"],
      [(m) => (m.sections[0].id = "codex/the-cloak-shimmers"), "sections[0].id"],
      [(m) => (m.codes.AT2 = "codex/enchanted-armour-table-2"), "codes.AT2"],
    ];
    for (const [mut, path] of cases) {
      const m = sample();
      mut(m);
      expect(() => validateManifest(m)).toThrow(`manifest: ${path}`);
      expect(() => assertNoFreeText(m)).toThrow(`manifest: ${path}`);
    }
    for (const s of ["codex/p12-1", "tablet", "backers", "v1", "D66", H, "Tables Codex"]) expect(MANIFEST_STRING.test(s)).toBe(true);
    for (const s of ["codex/enchanted-armour-table-1", "the-cloak-shimmers", "a-b-c"]) expect(MANIFEST_STRING.test(s)).toBe(false);
  });

  const files = import.meta.glob("../public/data/manifest.json", { eager: true, import: "default" });
  const real = files["../public/data/manifest.json"];
  it.skipIf(!real)("validates public/data/manifest.json", () => {
    expect(() => validateManifest(real)).not.toThrow();
  });
});

describe("combinators", () => {
  it("compose into typed validators", () => {
    const v = obj<{ a: number; b?: string; c: "x" | "y"; d: string[] }>({
      a: num({ int: true, min: 0 }),
      b: opt(str(4)),
      c: oneOf("x", "y"),
      d: arr(str(8, /^[a-z]+$/), 2),
    });
    expect(v({ a: 1, c: "x", d: ["ab"] }, "t")).toEqual({ a: 1, c: "x", d: ["ab"] });
    expect(() => v({ a: 1, c: "x", d: ["ab", "cd", "ef"] }, "t")).toThrow("t.d");
    expect(() => v({ a: -1, c: "x", d: [] }, "t")).toThrow("t.a");
    expect(() => v({ a: 1, b: "toolong", c: "x", d: [] }, "t")).toThrow("t.b");
    expect(() => v({ a: 1, c: "z", d: [] }, "t")).toThrow("t.c");
    expect(() => v({ a: 1, c: "x", d: [], e: 0 }, "t")).toThrow("t.e");
    expect(obj<{ a: number }>({ a: num() }, { extra: true })({ a: 1, e: 0 }, "t")).toEqual({ a: 1 });
    expect(() => num()(Infinity, "n")).toThrow("n");
  });
});
