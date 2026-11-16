import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { celestialDice } from "./scripts/vite-celestial";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { directHost, updatePlugin } from "./scripts/vite-update";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

/**
 * public/data/library*.json are local, git-ignored builds of whole books, read only in development
 * (content.ts). Vite copies all of public/ into dist/, so drop them from production builds; check-dist
 * still fails any build where book text gets through some other way.
 */
const DEV_ONLY = ["library.json", "library-void.json"];
function dropDevLibraries(): Plugin {
  let outDir = "dist";
  return {
    name: "2d6-drop-dev-libraries",
    apply: "build",
    configResolved: (c) => void (outDir = c.build.outDir),
    writeBundle: () => DEV_ONLY.forEach((f) => rmSync(join(appDir, outDir, "data", f), { force: true })),
  };
}

/**
 * Development only: "pages/<book>/pNNN.jpg" that public/ doesn't have (only Core's scans ship) come from the
 * private page renders build.py writes to pipeline/work/render/<book>/. The dev libraries link to them, so
 * "Show original page" works without importing the PDF. Never part of a build.
 */
function devPageScans(): Plugin {
  const renders = join(appDir, "..", "pipeline", "work", "render");
  return {
    name: "2d6-dev-page-scans",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/pages\/([a-z]+)\/(p\d{3}\.jpg)$/.exec((req.url ?? "").split("?")[0]);
        if (!m) return next();
        if (!directHost(req.headers.host)) return next(); // private scans: only to a page addressed at this machine
        try {
          const body = readFileSync(join(renders, m[1], m[2]));
          res.setHeader("Content-Type", "image/jpeg");
          res.end(body);
        } catch {
          next(); // public/pages has it (Core), or there is no such page
        }
      });
    },
  };
}

/**
 * Development only: "dev/unlock.json", every locked Dungeon book's sections as a PDF import would store them,
 * so the addon tools can be tested without importing PDFs (Settings → Books → "Unlock all books (dev)").
 * Structure (id, chapter, level, pages) comes from the manifest; title and text from the local whole-book
 * build pipeline/work/library-full.json, matched through pipeline/work/id-map.json. Never part of a build.
 */
function devUnlock(): Plugin {
  const work = join(appDir, "..", "pipeline", "work");
  return {
    name: "2d6-dev-unlock",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== "/dev/unlock.json" || !directHost(req.headers.host)) return next();
        try {
          const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
          const full = read(join(work, "library-full.json")) as { sections: { id: string; title: string; blocks: unknown[] }[] };
          const ids = read(join(work, "id-map.json")) as Record<string, string>;
          const man = read(join(appDir, "public", "data", "manifest.json")) as { sections: { id: string; book: string; level: number; chapter: string | null; pages: number[] }[] };
          const byId = new Map(man.sections.map((s) => [s.id, s]));
          const out = full.sections.flatMap((s) => {
            const m = byId.get(ids[s.id] ?? "");
            return m ? [{ section: { id: m.id, book: m.book, title: s.title, level: m.level, chapter: m.chapter, pages: m.pages, blocks: s.blocks }, unverified: [] }] : [];
          });
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(out));
        } catch (e) {
          res.statusCode = 404;
          res.end(`dev unlock unavailable: ${String(e)}`);
        }
      });
    },
  };
}

/**
 * Development only: the card art in books/Art and its sub folders, e.g. "Void Art" (git-ignored, from the
 * owner's own books), is served as "art/index.json" (the file names) and "art/<file>". The app only ever
 * sees file names, never folders; a name in two folders is served from books/Art itself, then the folders
 * in name order. Nothing is copied into public/, so no build ships it.
 */
function devArt(): Plugin {
  const dir = join(appDir, "..", "books", "Art");
  const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  const ext = (f: string) => f.slice(f.lastIndexOf(".") + 1).toLowerCase();
  /** Each picture's file name → the folder it is in. */
  const found = (): Map<string, string> => {
    const out = new Map<string, string>();
    const add = (d: string) => {
      try { for (const f of readdirSync(d)) if (ext(f) in TYPES && !out.has(f)) out.set(f, d); } catch { /* no such folder */ }
    };
    add(dir);
    try {
      for (const e of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) add(join(dir, e.name));
    } catch { /* no art folder */ }
    return out;
  };
  return {
    name: "2d6-dev-art",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/art\/(.+)$/.exec((req.url ?? "").split("?")[0]);
        if (!m || !directHost(req.headers.host)) return next(); // private art: only to a page addressed at this machine
        try {
          if (m[1] === "index.json") {
            res.setHeader("Content-Type", "application/json");
            return void res.end(JSON.stringify([...found().keys()]));
          }
          const name = decodeURIComponent(m[1]);
          const folder = found().get(name);
          if (!folder) return next(); // only files listed in the folders (no paths)
          res.setHeader("Content-Type", TYPES[ext(name)]);
          res.setHeader("Cache-Control", "max-age=3600");
          res.end(readFileSync(join(folder, name)));
        } catch {
          next();
        }
      });
    },
  };
}

// The import Worker is a module worker that code-splits (pdf.js and Tesseract load on demand): ES format.
// `npm run dev:https` (mode "https") serves a self-signed certificate for testing on the LAN.
// updatePlugin: "Check for updates" for a copy cloned from GitHub (see scripts/vite-update.ts).
export default defineConfig(({ mode }) => ({
  base: "./",
  server: { port: 5173 },
  worker: { format: "es" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [celestialDice(), updatePlugin(appDir), dropDevLibraries(), devPageScans(), devArt(), devUnlock(), ...(mode === "https" ? [basicSsl()] : [])],
}));
