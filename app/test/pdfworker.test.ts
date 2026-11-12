// The browser path of openPdf: pdf.js gets a module Worker of our own (never its in-thread fake worker).
import { describe, expect, it, vi } from "vitest";
import { PdfWorkerError, adaptDoc, runWithOwnWorker, type PdfJsLike, type WorkerPortLike } from "../src/lock/pdf";

type Ev = { data?: unknown; preventDefault?(): void };
function stubWorker() {
  const ls = { message: new Set<(e: Ev) => void>(), error: new Set<(e: Ev) => void>(), messageerror: new Set<(e: Ev) => void>() };
  const w: WorkerPortLike & { emit(t: "message" | "error" | "messageerror", e: Ev): void } = {
    addEventListener: (t, fn) => void ls[t].add(fn),
    removeEventListener: (t, fn) => void ls[t].delete(fn),
    postMessage: vi.fn(),
    terminate: vi.fn(),
    emit: (t, e) => { for (const fn of [...ls[t]]) fn(e); },
  };
  return w;
}
const READY = { data: { sourceName: "worker", targetName: "main", action: "ready", data: null } };
const tick = () => new Promise((r) => setTimeout(r, 0));

function stubLib(docPromise: Promise<unknown> = Promise.resolve({ numPages: 3 })) {
  const pdfWorker = { destroy: vi.fn() };
  const task = { promise: docPromise, destroy: vi.fn(() => Promise.resolve()) };
  const lib = {
    PDFWorker: { fromPort: vi.fn(() => pdfWorker) },
    getDocument: vi.fn(() => task),
  };
  return { lib: lib as unknown as PdfJsLike & typeof lib, pdfWorker, task };
}

describe("openPdf's own pdf.js worker", () => {
  it("starts a module Worker from workerSrc and passes it to getDocument as `worker`", async () => {
    const w = stubWorker();
    const make = vi.fn(() => w);
    const { lib, pdfWorker } = stubLib();
    const p = runWithOwnWorker(lib, { data: new Uint8Array(1), verbosity: 0 }, "https://x.test/pdfjs/pdf.worker.min.mjs", make);
    await tick();
    expect(make).toHaveBeenCalledWith("https://x.test/pdfjs/pdf.worker.min.mjs");
    expect(lib.getDocument).not.toHaveBeenCalled();             // nothing is sent before the handshake
    w.emit("message", READY);
    const r = await p;
    expect(lib.PDFWorker.fromPort).toHaveBeenCalledWith({ port: w, verbosity: 0 });
    const params = (lib.getDocument.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.worker).toBe(pdfWorker);
    expect(params.data).toBeInstanceOf(Uint8Array);
    expect((r.doc as unknown as { numPages: number }).numPages).toBe(3);
    expect(w.terminate).not.toHaveBeenCalled();
    r.dispose();
    expect(pdfWorker.destroy).toHaveBeenCalled();
    expect(w.terminate).toHaveBeenCalledTimes(1);
    r.dispose();
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it("the default factory builds `new Worker(src, { type: \"module\" })`", async () => {
    const w = stubWorker();
    const ctor = vi.fn(function (this: unknown) { return w; });
    const g = globalThis as { Worker?: unknown };
    const prev = g.Worker;
    g.Worker = ctor;
    try {
      const { lib } = stubLib();
      const p = runWithOwnWorker(lib, {}, "/pdfjs/pdf.worker.min.mjs");
      w.emit("message", READY);
      await p;
      expect(ctor).toHaveBeenCalledWith("/pdfjs/pdf.worker.min.mjs", { type: "module" });
    } finally {
      g.Worker = prev;
    }
  });

  it("rejects with PdfWorkerError (no fallback) when the worker fails to load, and terminates it", async () => {
    const w = stubWorker();
    const { lib } = stubLib();
    const p = runWithOwnWorker(lib, {}, "/w.mjs", () => w);
    const ev = { preventDefault: vi.fn() };
    w.emit("error", ev);
    await expect(p).rejects.toBeInstanceOf(PdfWorkerError);
    await expect(p).rejects.toMatchObject({ name: "PdfWorkerError" });
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(lib.getDocument).not.toHaveBeenCalled();
    expect(w.terminate).toHaveBeenCalled();
  });

  it("rejects with PdfWorkerError when the worker errors while the document loads", async () => {
    const w = stubWorker();
    const { lib, task } = stubLib(new Promise(() => {}));
    const p = runWithOwnWorker(lib, {}, "/w.mjs", () => w);
    w.emit("message", READY);
    await tick();
    w.emit("error", {});
    await expect(p).rejects.toBeInstanceOf(PdfWorkerError);
    expect(task.destroy).toHaveBeenCalled();
    expect(w.terminate).toHaveBeenCalled();
  });

  it("rejects with PdfWorkerError when no handshake arrives in time", async () => {
    const w = stubWorker();
    const { lib } = stubLib();
    await expect(runWithOwnWorker(lib, {}, "/w.mjs", () => w, 5)).rejects.toBeInstanceOf(PdfWorkerError);
    expect(w.terminate).toHaveBeenCalled();
  });

  it("terminates the worker when the PDF itself cannot be opened, and passes that error on", async () => {
    const w = stubWorker();
    const bad = Object.assign(new Error("x"), { name: "InvalidPDFException" });
    const rejected = Promise.reject(bad);
    rejected.catch(() => {});                                   // raced later, once the handshake is in
    const { lib } = stubLib(rejected);
    const p = runWithOwnWorker(lib, {}, "/w.mjs", () => w);
    w.emit("message", READY);
    await expect(p).rejects.toBe(bad);
    expect(w.terminate).toHaveBeenCalled();
  });

  it("reports a later worker crash through `failed`", async () => {
    const w = stubWorker();
    const { lib } = stubLib();
    const p = runWithOwnWorker(lib, {}, "/w.mjs", () => w);
    w.emit("message", READY);
    const r = await p;
    w.emit("error", {});
    await expect(r.failed).rejects.toBeInstanceOf(PdfWorkerError);
    r.dispose();
  });
});

describe("final fixes: pdf.ts", () => {
  it("a messageerror before the handshake fails the start with PdfWorkerError", async () => {
    const w = stubWorker();
    const { lib } = stubLib();
    const p = runWithOwnWorker(lib, {}, "/w.mjs", () => w);
    w.emit("messageerror", {});
    await expect(p).rejects.toBeInstanceOf(PdfWorkerError);
    expect(w.terminate).toHaveBeenCalled();
  });

  it("a later messageerror rejects `failed`", async () => {
    const w = stubWorker();
    const { lib } = stubLib();
    const p = runWithOwnWorker(lib, {}, "/w.mjs", () => w);
    w.emit("message", READY);
    const r = await p;
    w.emit("messageerror", {});
    await expect(r.failed).rejects.toBeInstanceOf(PdfWorkerError);
    r.dispose();
  });

  const fakePage = () => ({
    getViewport: () => ({ width: 100, height: 100, convertToViewportPoint: (x: number, y: number) => [x, y] }),
    getTextContent: async () => ({ items: [{ str: "a", fontName: "f", transform: [1, 0, 0, 1, 10, 10], width: 5, height: 5 }], styles: { f: {} } }),
    getOperatorList: async () => ({}),
    commonObjs: { has: () => true, get: () => ({ name: "Plain" }) },
    cleanup: vi.fn(),
  });

  it("textItems cleans the page up after reading it", async () => {
    const page = fakePage();
    const doc = { numPages: 1, getPage: async () => page, destroy: async () => {}, canvasFactory: {} };
    const d = adaptDoc(doc as never, null, () => {});
    expect(await d.textItems(1)).toHaveLength(1);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("close() clears its 2 s timer once the document is destroyed", async () => {
    vi.useFakeTimers();
    try {
      const dispose = vi.fn();
      const doc = { numPages: 1, getPage: async () => fakePage(), destroy: () => Promise.resolve(), canvasFactory: {} };
      const failed = new Promise<never>(() => {});
      adaptDoc(doc as never, failed, dispose).close();
      await vi.advanceTimersByTimeAsync(0);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
