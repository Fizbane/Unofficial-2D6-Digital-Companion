import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "../src/lock/store";
import { getContent, initContent, isLocked } from "../src/content";
import { runImport, type ImportReport } from "../src/lock/importer";
import type { FromWorker, ImportPaths } from "../src/lock/import.worker";
import { bookStatus, importPackFile, lockBooks, refreshBookState, renderBooks, startImport, type WorkerLike } from "../src/ui/books";
import { bus } from "../src/shell/events";
import { remapAfterStart } from "../src/library";
import { FILE, MANIFEST, OLD1, S1, deps, fakes } from "./importfixture";

const PATHS: ImportPaths = { pdfWorker: "/p.mjs", standardFonts: "/f/", ocrWorker: "/o.js", ocrCore: "/o/", ocrLang: "/o/lang" };
const fetchJson = async (p: string) =>
  structuredClone(p.endsWith("manifest.json") ? MANIFEST : { books: [{ slug: "core", title: "Core Rules", missing_pages: [], page_images: [], free: true }], sections: [] });

function fakeWorker() {
  const w: WorkerLike & { send(m: FromWorker): void } = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessageerror: null,
    send(m) { w.onmessage?.({ data: m } as MessageEvent<FromWorker>); },
  };
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What Settings → Books shows right now (drawn into a stand-in host: no DOM in these tests). */
function shown(): string {
  const host = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
  const dispose = renderBooks(host as unknown as HTMLElement);
  const out = host.innerHTML;
  dispose();
  return out;
}
const lastReport = () => (/<p class="books-report" role="status">(.*?)<\/p>/.exec(shown())?.[1] ?? "").replace(/&#39;/g, "'");

const g = globalThis as { localStorage?: unknown };
let ls: Record<string, string>;
beforeEach(async () => {
  ls = {};
  g.localStorage = {
    getItem: (k: string) => (k in ls ? ls[k] : null),
    setItem: (k: string, v: string) => void (ls[k] = String(v)),
    removeItem: (k: string) => void delete ls[k],
  };
  await store.forgetAll();
  await initContent(fetchJson);
});
afterEach(() => delete g.localStorage);

/** What the Worker does before it posts its report: the whole import, into the shared store. */
const workerRun = () => runImport(FILE, deps(fakes())) as Promise<ImportReport>;

describe("Books: finishing an import on the main thread", () => {
  it("adds the book and remaps legacy ids (the one remapLegacy call site)", async () => {
    ls["2d6:bookmarks"] = JSON.stringify([OLD1, "core-intro"]);
    ls["2d6:fixes"] = JSON.stringify([{ s: OLD1, b: 0, f: "cell", r: 0, c: 0, from: "a", to: "b" }, { s: "other", b: 0, f: "text", from: "a", to: "b" }]);
    const r = await workerRun();
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS });
    w.send({ type: "report", report: r });
    await done;
    expect(JSON.parse(ls["2d6:bookmarks"])).toEqual([S1, "core-intro"]);
    expect(JSON.parse(ls["2d6:fixes"]).map((x: { s: string }) => x.s)).toEqual([S1, "other"]);
    expect(getContent(S1)?.ok).toBe(true);
    expect(lastReport()).toContain("2 of 4 rows verified");
    await refreshBookState();
    expect(bookStatus("codex")).toBe("Unlocked · 2 of 4 rows verified");
  });

  for (const delay of [0, 1, 2, 4, 8]) {
    it(`Lock pressed while the report is being finished leaves nothing (after ${delay} ticks)`, async () => {
      const r = await workerRun();
      const w = fakeWorker();
      const done = startImport(FILE, { worker: () => w, paths: PATHS });
      w.send({ type: "report", report: r });
      for (let i = 0; i < delay; i++) await tick();
      await lockBooks(() => true);
      await done;
      expect(await store.getSections()).toEqual([]);
      expect(await store.getBooks()).toEqual([]);
      expect(isLocked(S1)).toBe(true);
      expect(getContent(S1)?.ok).toBe(false);
    });
  }

  it("Lock pressed exactly mid-finish (between the remap and addUnlocked) leaves nothing", async () => {
    ls["2d6:bookmarks"] = JSON.stringify([OLD1]);
    const r = await workerRun();
    const w = fakeWorker();
    let locked: Promise<void> | undefined;
    const off = bus.on("bookmarks:changed", () => { locked ??= lockBooks(() => true); });
    try {
      const done = startImport(FILE, { worker: () => w, paths: PATHS });
      w.send({ type: "report", report: r });
      await done;
      expect(locked).toBeDefined();
      await locked;
    } finally {
      off();
    }
    expect(await store.getSections()).toEqual([]);
    expect(isLocked(S1)).toBe(true);
    expect(lastReport()).toContain("Books locked");
  });

  it("Lock pressed while finish reads the sections back leaves nothing", async () => {
    const r = await workerRun();
    const w = fakeWorker();
    let locked: Promise<void> | undefined;
    const orig = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["getAll"]>) {
      const req = orig.apply(this, a);
      if (this.name === "2d6:content") req.addEventListener("success", () => { locked ??= lockBooks(() => true); });
      return req;
    };
    try {
      const done = startImport(FILE, { worker: () => w, paths: PATHS });
      w.send({ type: "report", report: r });
      await done;
      await locked;
    } finally {
      IDBObjectStore.prototype.getAll = orig;
    }
    expect(locked).toBeDefined();
    expect(await store.getSections()).toEqual([]);
    expect(isLocked(S1)).toBe(true);
  });

  it("shows a generic error with only the error's name", async () => {
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS });
    w.send({ type: "error", cancelled: false, name: "InvalidPDFException" });
    await done;
    expect(lastReport()).toContain("The PDF could not be read.");
    expect(lastReport()).toContain("InvalidPDFException");
  });

  it("ignores messages outside its protocol (pdf.js's worker handshake) and keeps the run going", async () => {
    const w = fakeWorker();
    let ended = false;
    const done = startImport(FILE, { worker: () => w, paths: PATHS }).then(() => void (ended = true));
    const stray = (d: unknown) => w.onmessage?.({ data: d } as MessageEvent<FromWorker>);
    stray({ sourceName: "worker", targetName: "main", action: "ready", data: null });
    stray(null);
    stray("ready");
    stray({ type: "something-else" });
    await tick();
    expect(ended).toBe(false);
    expect(w.terminate).not.toHaveBeenCalled();
    w.send({ type: "progress", phase: "pages", done: 1, total: 3 });
    await tick();
    expect(ended).toBe(false);
    w.send({ type: "error", cancelled: false, name: "InvalidPDFException" });
    await done;
    expect(w.terminate).toHaveBeenCalled();
    expect(lastReport()).toContain("InvalidPDFException");
  });

  it("a run that stopped part-way reads as Partly read, without row figures", async () => {
    const ac = new AbortController();
    await runImport(FILE, deps(fakes(), ac.signal, (p) => { if (p.phase === "pages" && p.done === 1) ac.abort(); })).catch(() => {});
    await initContent(fetchJson);
    await refreshBookState();
    expect(isLocked(S1)).toBe(true);
    expect(bookStatus("codex")).toBe("Partly read: pick the PDF again to finish");
    expect(bookStatus("core")).toBe("Free · included");
  });
});

describe("Books: Lock covers the Claude pack path, and says when it fails", () => {
  const packFile = (items: { id: string; text: string }[]) =>
    new Blob([JSON.stringify({ book: "codex", edition: "tablet", items })]);
  const unlock = async () => {
    await workerRun();
    await initContent(fetchJson);
    expect(getContent(S1)?.ok).toBe(true);
  };

  it("Lock pressed mid-importPackFile leaves the store empty and the book locked", async () => {
    await unlock();
    let locked: Promise<void> | undefined;
    const orig = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["getAll"]>) {
      const req = orig.apply(this, a);
      if (this.name === "2d6:content") req.addEventListener("success", () => { locked ??= lockBooks(() => true); });
      return req;
    };
    let note: string;
    try {
      note = await importPackFile("codex", packFile([{ id: `${S1}#cell:0:1:1`, text: "Shield" }]));
      await locked;
    } finally {
      IDBObjectStore.prototype.getAll = orig;
    }
    expect(locked).toBeDefined();
    expect(note).not.toContain("checked and verified");
    expect(await store.getSections()).toEqual([]);
    expect(isLocked(S1)).toBe(true);
    expect(getContent(S1)?.ok).toBe(false);
    expect(lastReport()).toContain("Books locked");
  });

  it("Lock waits for a pack import in flight, then clears its mismatch rows and note", async () => {
    await unlock();
    const note = await importPackFile("codex", packFile([{ id: `${S1}#cell:0:1:1`, text: "Wrong" }]));
    expect(note).toContain("did not match");
    expect(shown()).toContain("claude-mismatch");
    expect(shown()).toContain("Wrong");
    await lockBooks(() => true);
    expect(shown()).not.toContain("claude-mismatch");
    expect(shown()).not.toContain("did not match");
    expect(shown()).not.toContain("Wrong");
  });

  it("a lock that can't clear the store says so and does not claim success", async () => {
    await unlock();
    const orig = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function () { throw new Error("no storage"); };
    try {
      await expect(lockBooks(() => true)).resolves.toBeUndefined();
    } finally {
      IDBObjectStore.prototype.clear = orig;
    }
    expect(lastReport()).toContain("Couldn't lock your books: storage isn't available. Try again or clear this site's data.");
    expect(lastReport()).not.toContain("Books locked");
  });
});

describe("Books: a stalled or broken import ends", () => {
  it("ends with \"The import stopped responding.\" when the Worker goes quiet, and terminates it", async () => {
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS, stallMs: 40 });
    await wait(20);
    w.send({ type: "progress", phase: "pages", done: 1, total: 3 });   // resets the watchdog
    await wait(25);
    expect(w.terminate).not.toHaveBeenCalled();
    await done;
    expect(w.terminate).toHaveBeenCalled();
    expect(lastReport()).toContain("The import stopped responding.");
  });

  it("the watchdog stops once the report has arrived", async () => {
    const r = await workerRun();
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS, stallMs: 5 });
    w.send({ type: "report", report: r });
    await done;
    await wait(15);
    expect(lastReport()).toContain("2 of 4 rows verified");
  });

  it("ends when a Worker message can't be read (messageerror)", async () => {
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS });
    w.onmessageerror?.({} as MessageEvent);
    await done;
    expect(w.terminate).toHaveBeenCalled();
    expect(lastReport()).toContain("The import stopped: this browser could not pass the reader's messages.");
  });

  it("names a pdf.js worker that can't start, not the PDF", async () => {
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS });
    w.send({ type: "error", cancelled: false, name: "PdfWorkerError" });
    await done;
    expect(lastReport()).toContain("The PDF reader could not start in this browser.");
    expect(lastReport()).not.toContain("The PDF could not be read.");
  });
});

describe("legacy ids are remapped at startup too", () => {
  it("remaps bookmarks and fixes that arrived after the unlock, applies the fixes, and is idempotent", async () => {
    await workerRun();
    await initContent(fetchJson);
    ls["2d6:bookmarks"] = JSON.stringify([OLD1]);
    ls["2d6:fixes"] = JSON.stringify([{ s: OLD1, b: 0, f: "cell", r: 0, c: 0, from: "Gold", to: "Gilt" }]);
    const seen = vi.fn();
    const off = bus.on("bookmarks:changed", seen);
    try {
      expect(await remapAfterStart()).toBeGreaterThan(0);
    } finally {
      off();
    }
    expect(JSON.parse(ls["2d6:bookmarks"])).toEqual([S1]);
    expect(JSON.parse(ls["2d6:fixes"])[0].s).toBe(S1);
    const c = getContent(S1);
    const t = c?.ok ? c.section.blocks[0] : undefined;
    expect(t?.type === "table" && t.table.rows[0][0]).toBe("Gilt");
    expect(seen).toHaveBeenCalled();
    expect(await remapAfterStart()).toBe(0);
  });

  it("does nothing (and does not throw) without stored books or storage", async () => {
    expect(await remapAfterStart()).toBe(0);
    const orig = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () { throw new Error("no storage"); };
    try {
      expect(await remapAfterStart()).toBe(0);
    } finally {
      IDBObjectStore.prototype.getAll = orig;
    }
  });
});

describe("Books: the watchdog is fed and paused", () => {
  it("an alive heartbeat resets the watchdog without ending the run", async () => {
    const w = fakeWorker();
    const done = startImport(FILE, { worker: () => w, paths: PATHS, stallMs: 40 });
    await wait(25);
    w.send({ type: "alive" });
    await wait(25);
    expect(w.terminate).not.toHaveBeenCalled();
    await done;
    expect(lastReport()).toContain("The import stopped responding.");
  });

  it("pauses while the page is hidden and restarts when it is shown", async () => {
    const ls = new Set<() => void>();
    const doc = { hidden: true, addEventListener: (_t: string, fn: () => void) => void ls.add(fn), removeEventListener: (_t: string, fn: () => void) => void ls.delete(fn) };
    vi.stubGlobal("document", doc);
    try {
      const w = fakeWorker();
      const done = startImport(FILE, { worker: () => w, paths: PATHS, stallMs: 20 });
      await wait(50);
      expect(w.terminate).not.toHaveBeenCalled();
      doc.hidden = false;
      for (const fn of [...ls]) fn();
      await done;
      expect(w.terminate).toHaveBeenCalled();
      expect(ls.size).toBe(0);                                     // the listener is removed when the run ends
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
