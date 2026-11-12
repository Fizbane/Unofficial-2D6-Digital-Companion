import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cellBox, cropCanvas, cropRect, NO_PICTURE, pageUrl } from "../src/lock/pageimg";
import { unrotate } from "../src/lock/rebuild";
import * as store from "../src/lock/store";
import { addUnlocked, initContent } from "../src/content";
import { popHost, renderBlocks } from "../src/pages/book";
import { MANIFEST, S1, S2 } from "./importfixture";
import { errorHtml } from "../src/ui/books";
import type { Section } from "../src/types";

describe("cropRect: a manifest box in the saved page image", () => {
  it("maps a 0..1 box to pixels, padded and clamped", () => {
    expect(cropRect([0.1, 0.2, 0.3, 0.4], 1000, 2000, 0)).toEqual({ x: 100, y: 400, w: 200, h: 400 });
    expect(cropRect([0, 0, 0.5, 0.5], 100, 100, 0.1)).toEqual({ x: 0, y: 0, w: 60, h: 60 });
    expect(cropRect([0.9, 0.9, 1, 1], 100, 100, 0.1)).toEqual({ x: 80, y: 80, w: 20, h: 20 });
  });
  it("an unlocated box has no crop", () => {
    expect(cropRect([0, 0, 0, 0], 100, 100, 0.01)).toBeUndefined();
  });
  it.each([90, 180, 270])("a page rendered %i° clockwise: the importer's reading region and the crop are the same pixels", (rot) => {
    // The importer reads a text box from the PDF frame at unrotate(loc.box, rot) and saves the page rendered with
    // rot. Mark that PDF-frame region on an upright page, turn the page clockwise pixel by pixel (the definition
    // of the render), and the crop of loc.box must be exactly the marked pixels.
    const W = 100, H = 200, loc: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    const [u0, v0, u1, v1] = unrotate(loc, rot);
    const marked: [number, number][] = [];
    for (let y = Math.round(v0 * H); y < Math.round(v1 * H); y++) for (let x = Math.round(u0 * W); x < Math.round(u1 * W); x++) marked.push([x, y]);
    const turn = ([x, y]: [number, number]): [number, number] =>
      rot === 90 ? [H - 1 - y, x] : rot === 180 ? [W - 1 - x, H - 1 - y] : [y, W - 1 - x];
    const out = marked.map(turn);
    const [iw, ih] = rot === 180 ? [W, H] : [H, W];
    const r = cropRect(loc, iw, ih, 0)!;
    expect(r).toBeDefined();
    expect(Math.min(...out.map((p) => p[0]))).toBe(r.x);
    expect(Math.max(...out.map((p) => p[0]))).toBe(r.x + r.w - 1);
    expect(Math.min(...out.map((p) => p[1]))).toBe(r.y);
    expect(Math.max(...out.map((p) => p[1]))).toBe(r.y + r.h - 1);
    expect(out.length).toBe(r.w * r.h);
  });
});

const fetchJson = async (p: string) =>
  structuredClone(p.endsWith("manifest.json") ? MANIFEST : { books: [{ slug: "core", title: "Core Rules", missing_pages: [], page_images: [], free: true }], sections: [] });
const g = globalThis as { localStorage?: unknown };
beforeEach(async () => {
  g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  await store.forgetAll();
  await initContent(fetchJson);
});
afterEach(() => delete g.localStorage);

describe("cells without a picture", () => {
  it("an unlocated cell has no box, a located one has its page and box", () => {
    expect(cellBox(S2, "2:0:0")).toBeUndefined();             // [0,0,0,0] dice loc
    expect(cellBox(S2, "9:9:9")).toBeUndefined();
    expect(cellBox(S2, "1:para")?.page).toBe(2);
    expect(NO_PICTURE).toBe("No picture for this cell");
  });
  it("cropCanvas gives nothing for a book that is not unlocked or a page that was not saved", async () => {
    expect(await cropCanvas("codex", 2, [0, 0, 1, 1])).toBeUndefined();
    await addUnlocked([{ section: { id: S1, book: "codex", title: "t", level: 2, chapter: null, pages: [1], blocks: [] }, unverified: [] }]);
    expect(await cropCanvas("codex", 2, [0, 0, 1, 1])).toBeUndefined();
  });
});

describe("pageUrl cache", () => {
  it("serves nothing while locked, and a fresh URL after the book's content changes", async () => {
    await store.putPage("codex", 1, new Blob(["a"]));
    expect(await pageUrl("codex", 1)).toBeUndefined();
    const sec = { section: { id: S1, book: "codex", title: "t", level: 2, chapter: null, pages: [1], blocks: [] }, unverified: [] };
    await addUnlocked([sec]);
    const a = await pageUrl("codex", 1);
    expect(a).toBeTruthy();
    expect(await pageUrl("codex", 1)).toBe(a);
    await addUnlocked([sec]);                                 // a re-import stores new images
    const b = await pageUrl("codex", 1);
    expect(b).toBeTruthy();
    expect(b).not.toBe(a);
  });
});

describe("popover position", () => {
  it("table cells take a row after theirs, everything else goes straight after the element", () => {
    expect(popHost("TD")).toBe("row");
    expect(popHost("TH")).toBe("body-top");                   // never inside thead
    expect(popHost("LI")).toBe("li");                         // an li.unverified-row, never a div in the ul
    for (const t of ["P", "H1", "H3", "FIGCAPTION"]) expect(popHost(t)).toBe("after");
  });
});

const sec: Section = {
  id: "codex/p1-1", book: "codex", title: "T", level: 2, chapter: null, pages: [1],
  blocks: [
    { type: "para", text: "p0", page: 1 }, { type: "para", text: "p1", page: 1 }, { type: "para", text: "p2", page: 1 },
    { type: "table", page: 1, table: { title: null, dice: "D6", columns: ["A", "B"], rows: [["x", "y"], ["<b>z</b>", "w"]] } },
  ],
};

describe("renderBlocks: unverified cells", () => {
  it("marks only the flagged cell", () => {
    const h = String(renderBlocks(sec, false, new Set(["3:1:0"]))).replace(/"r\d+-/g, '"');
    expect(h.match(/class="unverified"/g)).toHaveLength(1);
    expect(h).toContain(`data-crop="3:1:0"`);
    expect(h).toContain(`<td class="unverified" data-crop="3:1:0" aria-describedby="desc">&lt;b&gt;z&lt;/b&gt;<button type="button" class="unverified-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Compare with the page">`);
    expect(h).not.toContain("role=");
  });
  it("flags headers and paragraphs by key", () => {
    const h = String(renderBlocks(sec, false, new Set(["3:-1:1", "1:para"]))).replace(/"r\d+-/g, '"');
    expect(h).toContain(`<th class="unverified" data-crop="3:-1:1"`);
    expect(h).toContain(`<p class="unverified" data-crop="1:para" aria-describedby="desc">p1<button`);
    expect(h.match(/class="unverified"/g)).toHaveLength(2);
  });
  it("a flagged th or heading is named by its own text only, never by the button", () => {
    const withHead: Section = { ...sec, blocks: [{ type: "heading", level: 2, text: "Heading", page: 1 }, sec.blocks[3]] };
    const h = String(renderBlocks(withHead, false, new Set(["0:heading", "1:-1:0"])));
    for (const [tag, text] of [["h3", "Heading"], ["th", "A"]]) {
      const m = h.match(new RegExp(`<${tag}[^>]*aria-labelledby="([^"]+)"[^>]*>(.*?)</${tag}>`))!;
      expect(m).not.toBeNull();
      expect(m[2]).toContain(`<span id="${m[1]}">${text}</span>`);
      expect(m[2].replace(/<button.*<\/button>/, "")).toBe(`<span id="${m[1]}">${text}</span>`);
    }
    expect(h).not.toMatch(/<(h3|th)[^>]*>[^<]*<button/);       // the button is never bare text content of the name
  });
  it("two renders of the same flagged keys share no ids, and every reference resolves inside its own render", () => {
    const keys = new Set(["0:heading", "1:-1:0", "-1:title"]);
    const withHead: Section = { ...sec, blocks: [{ type: "heading", level: 2, text: "Heading", page: 1 }, sec.blocks[3]] };
    const a = String(renderBlocks(withHead, false, keys)), b = String(renderBlocks(withHead, false, keys));
    const ids = (h: string) => [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const all = [...ids(a), ...ids(b)];
    expect(all.length).toBeGreaterThan(2);
    expect(new Set(all).size).toBe(all.length);
    for (const h of [a, b]) {
      const refs = [...h.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(ids(h)).toContain(r);
    }
  });
  it("a flagged list item stays a list item", () => {
    const withList: Section = { ...sec, blocks: [{ type: "para", text: "- one", page: 1 }] };
    const h = String(renderBlocks(withList, false, new Set(["0:para"])));
    expect(h).toContain(`<ul><li class="unverified"`);
  });
  it("marks nothing without a set", () => {
    expect(String(renderBlocks(sec))).not.toContain("unverified");
  });
});

describe("errorHtml", () => {
  it("copes with a worker error that has no name", () => {
    const h = String(errorHtml({ type: "error", cancelled: false } as never));
    expect(h).toContain("could not be read");
    expect(h).not.toContain("<small");
    expect(String(errorHtml({ type: "error", cancelled: false, name: "X" } as never))).toContain("<small");
  });
});
