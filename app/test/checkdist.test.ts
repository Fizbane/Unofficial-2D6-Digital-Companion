import { describe, it, expect, afterEach } from "vitest";

// The app has no @types/node, so the Node built-ins are imported untyped.
const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = await nodeMod("node:fs");
const { tmpdir } = await nodeMod("node:os");
const { join } = await nodeMod("node:path");
const { fileURLToPath } = await nodeMod("node:url");
// @ts-expect-error plain .mjs script, no types
import { scan, structural, manifestFindings, fileTypeFindings, decode, check } from "../scripts/check-dist.mjs";

const dirs: string[] = [];
function dist(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "chk-"));
  dirs.push(d);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(d, p, ".."), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const PH = [{ phrase: "The wizard’s tower — hums softly", where: "codex/x#0" }];

describe("check-dist scan", () => {
  it("finds a planted phrase despite case, whitespace and punctuation differences", () => {
    const d = dist({ "a.js": `var s="the  WIZARD's\n tower - hums   softly";` });
    const hits = scan(d, PH);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("a.js");
    expect(hits[0].where).toBe("codex/x#0");
  });
  it("ignores allowlisted generic words but not other phrases", () => {
    const d = dist({ "a.js": ".btn-ghost{}" });
    expect(scan(d, [{ phrase: "GHOST", where: "w" }])).toEqual([]);
  });
  it("matches whole words only: not inside a hash or blob, but yes next to punctuation", () => {
    const ph = [{ phrase: "ZORBAK", where: "w" }];
    expect(scan(dist({ "a.js": "AbcZorbakDef123" }), ph)).toEqual([]);
    expect(scan(dist({ "a.js": 'x="zorbak"' }), ph)).toHaveLength(1);
    expect(scan(dist({ "a.js": "see Zorbak." }), ph)).toHaveLength(1);
  });
  it("is clean when the phrase is absent", () => {
    expect(scan(dist({ "a.js": "console.log(1)" }), PH)).toEqual([]);
  });
  it("skips wasm and images", () => {
    const d = dist({ "a.wasm": "the wizard's tower - hums softly", "b.png": "the wizard's tower - hums softly" });
    expect(scan(d, PH)).toEqual([]);
  });
  it("scans nested json, html, css, svg and maps", () => {
    const t = "the wizard's tower - hums softly";
    const d = dist({ "x/a.json": t, "b.html": t, "c.css": t, "d.svg": t, "e.js.map": t });
    expect(scan(d, PH)).toHaveLength(5);
  });
  it("allowlists the pdfjs @napi-rs/canvas string only", () => {
    const d = dist({ "a.js": "require('@napi-rs/canvas')" });
    expect(scan(d, [{ phrase: "@napi-rs/canvas", where: "w" }])).toEqual([]);
    const d2 = dist({ "a.js": "x @napi-rs/canvas and the wizard's tower - hums softly" });
    expect(scan(d2, [...PH, { phrase: "@napi-rs/canvas", where: "w" }])).toHaveLength(1);
  });
});

describe("check-dist structural", () => {
  it("reports library.json, other book page folders and extra data files", () => {
    const d = dist({
      "data/library.json": "{}", "data/manifest.json": "{}", "data/free.json": "{}", "data/extra.json": "{}",
      "pages/core/p1.webp": "x", "pages/codex/p1.webp": "x",
    });
    const s: string[] = structural(d);
    expect(s.some((x) => x.includes("data/library.json"))).toBe(true);
    expect(s.some((x) => x.includes("pages/codex"))).toBe(true);
    expect(s.some((x) => x.includes("data/extra.json"))).toBe(true);
    expect(s.some((x) => x.startsWith("pages/core"))).toBe(false);
    expect(s.some((x) => x.startsWith("data/manifest.json"))).toBe(false);
  });
  it("allows 2D6 Void's manifest but still refuses its library", () => {
    expect(structural(dist({ "data/manifest.json": "{}", "data/manifest-void.json": "{}", "data/free.json": "{}" }))).toEqual([]);
    expect((structural(dist({ "data/library-void.json": "{}" })) as string[]).some((x) => x.includes("library-void.json"))).toBe(true);
  });
  it("is clean for core pages plus manifest and free", () => {
    const d = dist({ "data/manifest.json": "{}", "data/free.json": "{}", "pages/core/p1.webp": "x" });
    expect(structural(d)).toEqual([]);
  });
});

describe("check-dist manifest", () => {
  it("accepts a text-free manifest and rejects free text", () => {
    const ok = dist({ "data/manifest.json": JSON.stringify({ version: 1, books: [{ slug: "core", name: "Core Rules", free: true }], codes: { CT3: "codex/p1-1" } }) });
    expect(manifestFindings(ok)).toEqual([]);
    const bad = dist({ "data/manifest.json": JSON.stringify({ books: [{ name: "A sentence of book text." }] }) });
    expect(manifestFindings(bad)).toHaveLength(1);
  });
  it("checks 2D6 Void's manifest the same way", () => {
    const ok = dist({ "data/manifest-void.json": JSON.stringify({ version: 1, books: [{ slug: "void", name: "2D6 Void", free: false, editions: [] }], codes: {} }) });
    expect(manifestFindings(ok)).toEqual([]);
    const bad = dist({ "data/manifest-void.json": JSON.stringify({ books: [{ name: "The alien drools on the deck." }] }) });
    expect(manifestFindings(bad).length).toBeGreaterThan(0);
  });
  it("accepts the real manifest (when present)", () => {
    const data: string = fileURLToPath(new URL("../public", import.meta.url));
    if (!existsSync(join(data, "data", "manifest.json"))) return;
    expect(manifestFindings(data)).toEqual([]);
  });
});

describe("check-dist matcher edges", () => {
  const one = (phrase: string, text: string, file = "a.js") => scan(dist({ [file]: text }), [{ phrase, where: "w" }]);
  it("applies the word-edge rule only to phrases without whitespace", () => {
    expect(one("the dark tower rises", "xthe dark tower risesx")).toHaveLength(1);
    expect(one("zorbak", "xzorbakx")).toEqual([]);
  });
  it("strips edge punctuation from phrases and drops ones under 4 characters", () => {
    expect(one("...wizard hums...", "a wizard hums b")).toHaveLength(1);
    expect(one("(ab)", "ab ab ab")).toEqual([]);
    expect(one("- - -", "- - -")).toEqual([]);
  });
  it("sees through escaped double, single, backslash and backtick quotes", () => {
    expect(one('say "hello there" friend', 'x="say \\"hello there\\" friend"')).toHaveLength(1);
    expect(one("it's the tower of doom", "x='it\\'s the tower of doom'")).toHaveLength(1);
    expect(one("tower`s edge is cold", "x=`tower\\`s edge is cold`")).toHaveLength(1);
    expect(one("path a\\b is cold", "x='path a\\\\b is cold'")).toHaveLength(1);
  });
  it("scans JSON string values and keys after parsing", () => {
    expect(one("the wizard's tower", JSON.stringify({ a: ["the wizard’s tower"] }), "d.json")).toHaveLength(1);
    expect(one("hidden in the key", JSON.stringify({ "hidden in the key": 1 }), "d.json")).toHaveLength(1);
  });
  it("matches slug and camelCase forms of long phrases", () => {
    expect(one("Garla Bright Celebrations", "id: garla-bright-celebrations")).toHaveLength(1);
    expect(one("Garla Bright Celebrations", "fn garlaBrightCelebrations()")).toHaveLength(1);
    expect(one("Hello World", "hello-world")).toEqual([]); // short: no squashed pass
  });
  it("folds the ellipsis character", () => {
    expect(one("and then it fell...", "and then it fell… x")).toHaveLength(1);
    expect(one("and then it fell… x", "and then it fell... x")).toHaveLength(1);
  });
});

describe("decode", () => {
  it("handles curly escapes, entities and quote escapes", () => {
    expect(decode("a\\u2019b")).toBe("a’b");
    expect(decode("a&rsquo;b")).toBe("a'b");
    expect(decode('say \\"hi\\"')).toBe('say "hi"');
    expect(decode("a\\\\b")).toBe("a\\b");
    expect(decode("’")).toBe("’");
  });
});

describe("check-dist manifest schema", () => {
  const m = (o: unknown) => manifestFindings(dist({ "data/manifest.json": JSON.stringify(o) }));
  const good = () => ({
    version: 1,
    books: [{ slug: "codex", name: "Tables Codex", free: false, editions: [{ id: "tablet", fp: "a".repeat(64), pages: 3 }] }],
    sections: [{ id: "codex/p2-1", book: "codex", level: 2, chapter: null, pages: [2], blocks: [{ type: "para", page: 2, loc: { box: [0, 0, 1, 1], kind: "ocr" }, h: { tablet: { v: ["a".repeat(22)] } } }] }],
    codes: { MA1: "codex/p2-1" },
  });
  it("accepts a well-formed manifest", () => expect(m(good())).toEqual([]));
  it("catches a misplaced word in each position", () => {
    const bad: ((x: any) => void)[] = [
      (x) => (x.books[0].name = "Core"),
      (x) => (x.books[0].name = "tablet"),
      (x) => (x.books[0].slug = "MA1"),
      (x) => (x.books[0].editions[0].id = "Tables Codex"),
      (x) => (x.sections[0].chapter = "tablet"),
      (x) => (x.sections[0].blocks[0].type = "tablet"),
      (x) => (x.sections[0].blocks[0].loc.kind = "para"),
      (x) => (x.sections[0].blocks[0].h.tablet.v[0] = "tablet"),
      (x) => (x.sections[0].blocks[0].h.tablet.v[0] = "codex/p2-1"),
      (x) => (x.codes = { "codex/p2-1": "codex/p2-1" }),
      (x) => (x.codes = { MA1: "MA1" }),
      (x) => (x.sections[0].blocks[0].h = { "A sentence of text": { v: [] } }),
      (x) => (x.sections[0].blocks[0].freeText = 1),
      (x) => (x.sections[0].blocks[0].marks = [[0, 1, "tablet"]]),
      (x) => (x.sections[0].blocks[0].h.tablet.patch = { ["b".repeat(22)]: [[0, 1, "too long"]] }),
    ];
    for (const f of bad) {
      const x = good();
      f(x);
      expect(m(x).length, f.toString()).toBeGreaterThan(0);
    }
  });
});

describe("check-dist structural, whole tree", () => {
  it("flags library.json anywhere, any case", () => {
    expect(structural(dist({ "data/manifest.json": "{}", "x/Library.JSON": "{}" })).length).toBeGreaterThan(0);
  });
  it("flags pages anywhere except root pages/core/<file>", () => {
    for (const p of ["a/pages/core/p1.webp", "pages/core/sub/p1.webp", "Pages/x/p1.webp", "pages/core-extra/p.webp", "pages/p.webp"])
      expect(structural(dist({ [p]: "x" })).length, p).toBeGreaterThan(0);
    expect(structural(dist({ "pages/core/p1.webp": "x" }))).toEqual([]);
  });
  it("flags any data entry but the two files, at any depth", () => {
    for (const p of ["a/data/x.json", "Data/manifest.json", "data/sub/manifest.json", "data/library.json"])
      expect(structural(dist({ [p]: "x" })).length, p).toBeGreaterThan(0);
  });
});

describe("check-dist run", () => {
  it("still runs structural checks without a phrases file, with a banner", () => {
    const d = dist({ "data/library.json": "{}", "a.js": "x" });
    const r = check({ dist: d, phrasesFile: join(d, "nope.json"), require: false });
    expect(r.code).toBe(1);
    expect(r.findings.some((f: string) => f.includes("library.json"))).toBe(true);
    expect(r.warnings.join("\n")).toContain("SKIPPED");
  });
  it("exits 0 with a multi-line banner when the phrases file is missing and the tree is clean", () => {
    const d = dist({ "a.js": "x" });
    const r = check({ dist: d, phrasesFile: join(d, "nope.json"), require: false });
    expect(r.code).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(1);
  });
  it("exits 1 when D6_REQUIRE_PHRASES is set and the file is missing", () => {
    const d = dist({ "a.js": "x" });
    expect(check({ dist: d, phrasesFile: join(d, "nope.json"), require: true }).code).toBe(1);
  });
  it("reports where plus at most 12 characters of the phrase", () => {
    const d = dist({ "a.js": "the wizard hums softly tonight" });
    const phrasesFile = join(d, "p.json");
    writeFileSync(phrasesFile, JSON.stringify([{ phrase: "the wizard hums softly tonight", where: "codex/x#0" }]));
    const r = check({ dist: d, phrasesFile, require: false });
    expect(r.code).toBe(1);
    const line = r.findings.find((f: string) => f.includes("codex/x#0"));
    expect(line).toBeTruthy();
    expect(line).not.toContain("hums softly");
  });
});

describe("check-dist and 2D6 Void's phrase list", () => {
  const withLists = (voidList?: unknown[]) => {
    const d = dist({ "a.js": "a quiet hulk drifts in the dark" });
    const work = mkdtempSync(join(tmpdir(), "phr-"));
    dirs.push(work);
    writeFileSync(join(work, "phrases.json"), JSON.stringify([{ phrase: "nothing that is in the build at all", where: "codex/x#0" }]));
    if (voidList) writeFileSync(join(work, "phrases-void.json"), JSON.stringify(voidList));
    return { d, phrasesFile: join(work, "phrases.json") };
  };
  it("scans with it when it is there", () => {
    const { d, phrasesFile } = withLists([{ phrase: "a quiet hulk drifts in the dark", where: "void/x#0" }]);
    const r = check({ dist: d, phrasesFile, require: true });
    expect(r.code).toBe(1);
    expect(r.findings.some((f: string) => f.includes("void/x#0"))).toBe(true);
  });
  it("says so loudly when it is missing, and fails when lists are required", () => {
    const { d, phrasesFile } = withLists();
    const soft = check({ dist: d, phrasesFile, require: false });
    expect(soft.code).toBe(0);
    expect(soft.warnings.join("\n")).toContain("phrases-void.json");
    const hard = check({ dist: d, phrasesFile, require: true });
    expect(hard.code).toBe(1);
    expect(hard.findings.join("\n")).toContain("2D6 Void phrase list missing");
  });
});

describe("check-dist final fixes", () => {
  it("never prints an offending manifest key, nor a key on the path below it", () => {
    const key = "The wizard hums softly tonight";
    const f: string[] = manifestFindings(dist({ "data/manifest.json": JSON.stringify({
      version: 1,
      sections: [{ id: "codex/p2-1", [key]: { inner: "x" }, blocks: [{ h: { [key]: { v: [] } }, patch: 1 }] }],
      codes: { [key]: "codex/p2-1" },
    }) }));
    expect(f.length).toBeGreaterThan(2);
    for (const line of f) {
      expect(line).not.toContain("wizard");
      expect(line).not.toContain("hums");
    }
    expect(f.some((l) => l.includes("<key>"))).toBe(true);
  });

  it("fails on any PDF, zip or gzip, except the OCR language model", () => {
    for (const p of ["book.pdf", "a/B.PDF", "x.zip", "deep/y.tar.gz", "ocr/lang/other.traineddata.gz", "ocr/eng.traineddata.gz"])
      expect(fileTypeFindings(dist({ [p]: "x" })).length, p).toBe(1);
    expect(fileTypeFindings(dist({ "ocr/lang/eng.traineddata.gz": "x" }))).toEqual([]);
  });

  it("fails on an image outside the allowlisted folders", () => {
    const ok = ["pages/core/p002.jpg", "assets/dice-box/themes/gold/diffuse.png", "assets/themes/default/normal.png", "backdrops/dark.webp", "portraits/a.webp", "logo.png"];
    expect(fileTypeFindings(dist(Object.fromEntries(ok.map((p) => [p, "x"]))))).toEqual([]);
    for (const p of ["page-12.png", "assets/p1.jpg", "img/p.JPEG", "data/x.webp", "backdrops-x/a.webp", "Portraits/a.gif", "pages/core/sub/p.avif", "x/logo.png"])
      expect(fileTypeFindings(dist({ [p]: "x" })).length, p).toBe(1);
  });

  it("check() includes the file-type findings", () => {
    const d = dist({ "book.pdf": "x" });
    const r = check({ dist: d, phrasesFile: join(d, "nope.json"), require: false });
    expect(r.code).toBe(1);
    expect(r.findings.join("\n")).toContain("book.pdf");
  });
});
