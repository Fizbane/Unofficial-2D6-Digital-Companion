// Escape-by-default guard: markup reaches the page only through ui/html.ts (setHTML), and every
// raw() — markup that skips escaping — is a known, audited use.
import { describe, expect, it } from "vitest";

const nodeMod = (m: string) => import(/* @vite-ignore */ m);
const { readdirSync, readFileSync } = await nodeMod("node:fs");
const { join, relative, sep } = await nodeMod("node:path");
const { fileURLToPath } = await nodeMod("node:url");

const SRC: string = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  return (readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]).flatMap((d) =>
    d.isDirectory() ? tsFiles(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : [],
  );
}
const files = tsFiles(SRC).map((f) => ({ path: (relative(SRC, f) as string).split(sep).join("/"), text: readFileSync(f, "utf8") as string }));

/** The source without its comments (prose such as "the raw (unpatched) text" is not a call). */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Ways to turn a string into DOM. Only ui/html.ts may use them. */
const SINKS = /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\.write(ln)?\b|\bDOMParser\b|\bcreateContextualFragment\b|\bsrcdoc\b|\bsetHTMLUnsafe\b|\bparseHTMLUnsafe\b/g;

/** Audited exceptions: file → the sink it may use, and why. */
const SINK_EXCEPTIONS: Record<string, { sink: string; count: number; why: string }> = {
  "tools/dmap.ts": {
    sink: "DOMParser",
    count: 1,
    why: "parses the app's own map SVG as image/svg+xml to export a PNG; the document is never attached",
  },
};

/** Every raw() use, per file (see the task 12 report for the justification of each). */
const RAW_USES: Record<string, number> = {
  "dice.ts": 1, // diceIcons: escaped text, plus fixed die-face spans
  "library.ts": 1, // inline(): escaped text, plus fixed strong/em/die spans and #/s/ cross-links
  "shell/shell.ts": 1, // the app's own icon sprite, fetched from its own origin
};

describe("no HTML sinks outside ui/html.ts", () => {
  it("scans the sources", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.path === "ui/html.ts")).toBe(true);
  });

  it("innerHTML, outerHTML, insertAdjacentHTML, document.write, DOMParser and friends appear only in ui/html.ts", () => {
    const found: string[] = [];
    for (const f of files) {
      if (f.path === "ui/html.ts") continue;
      const hits = [...f.text.matchAll(SINKS)].map((m) => m[0]);
      const ex = SINK_EXCEPTIONS[f.path];
      const rest = ex ? hits.filter((h) => h !== ex.sink) : hits;
      if (ex && hits.length - rest.length !== ex.count) found.push(`${f.path}: ${ex.sink} ×${hits.length - rest.length} (expected ${ex.count})`);
      for (const h of rest) found.push(`${f.path}: ${h}`);
    }
    expect(found).toEqual([]);
  });

  it("ui/html.ts assigns innerHTML exactly once", () => {
    const h = files.find((f) => f.path === "ui/html.ts")!.text;
    expect(h.match(/\.innerHTML\s*=/g)).toHaveLength(1);
  });

  it("raw() is used only where audited", () => {
    const uses: Record<string, number> = {};
    for (const f of files) {
      if (f.path === "ui/html.ts") continue;
      const n = (code(f.text).match(/(?<![.\w`])raw\s*\(/g) ?? []).length; // not a method such as src.raw(), nor a comment
      if (n) uses[f.path] = n;
    }
    expect(uses).toEqual(RAW_USES);
  });

  it("raw is never imported under another name, or reached through a namespace import", () => {
    const bad = files.filter((f) => /\braw\s+as\b/.test(f.text) || /import\s*\*\s*as\s+\w+\s+from\s*["'][^"']*ui\/html["']/.test(f.text)).map((f) => f.path);
    expect(bad).toEqual([]);
  });
});
