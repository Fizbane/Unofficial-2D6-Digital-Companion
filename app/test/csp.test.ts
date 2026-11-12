import { describe, it, expect } from "vitest";
import html from "../index.html?raw";
import sw from "../public/sw.js?raw";
import rules from "../public/sw-rules.js?raw";

const SPEC_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

describe("CSP", () => {
  it("index.html carries exactly the spec policy", () => {
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
    expect(m?.[1]).toBe(SPEC_CSP);
  });
});

describe("service worker", () => {
  const shouldCache = new Function(rules + "; return shouldCache;")() as (u: string, o: string) => boolean;
  const O = "https://x.test";
  it("uses cache v4 and the shared rules", () => {
    expect(sw).toContain('CACHE = "2d6-v4"');
    expect(sw).toContain("sw-rules.js");
    expect(sw).toContain("shouldCache(");
  });
  it("caches the shell", () => {
    for (const p of ["/", "/assets/index-abc.js", "/data/manifest.json", "/data/free.json", "/pages/core/p1.webp", "/app/pdfjs/pdf.worker.mjs", "/ocr/core.wasm", "/audio/void/music/bay.mp3", "/portraits/void/anime/orc-brawler.webp"])
      expect(shouldCache(O + p, O), p).toBe(true);
  });
  it("never caches book pages or library.json", () => {
    for (const p of ["/pages/book1/p1.webp", "/sub/pages/x/p2.webp", "/data/library.json", "/library.json", "/data/other.json", "/data/library-void.json"])
      expect(shouldCache(O + p, O), p).toBe(false);
  });
  it("only caches files directly inside pages/core/", () => {
    for (const p of ["/pages/core-extra/x.webp", "/pages/x/pages/core/y", "/pages/core/sub/p1.webp", "/%2Fpages%2Fcodex%2Fp1.webp", "/a%2Fpages%2Fx%2Fp1.webp", "/%2Fdata%2Fother.json", "/%E0%A4%A"])
      expect(shouldCache(O + p, O), p).toBe(false);
    expect(shouldCache(O + "/sub/pages/core/p1.webp", O)).toBe(true);
  });
  it("core page names cannot hide a backslash path, and data is anchored", () => {
    expect(shouldCache(O + "/pages/core/%5Cx%5Cy.webp", O)).toBe(false);
    for (const p of ["/data/sub/manifest.json", "/data/x/data/manifest.json", "/x/data/other/free.json"])
      expect(shouldCache(O + p, O), p).toBe(false);
    expect(shouldCache(O + "/sub/data/manifest.json", O)).toBe(true);
  });
  it("background fetch in sw.js swallows errors", () => {
    expect(sw).toContain("fetched.catch(() => {})");
  });
  it("never caches cross-origin", () => {
    expect(shouldCache("https://evil.test/a.js", O)).toBe(false);
  });
});
