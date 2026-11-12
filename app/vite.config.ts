import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { updatePlugin } from "./scripts/vite-update";

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

// The import Worker is a module worker that code-splits (pdf.js and Tesseract load on demand): ES format.
// `npm run dev:https` (mode "https") serves a self-signed certificate for testing on the LAN.
// updatePlugin: "Check for updates" for a copy cloned from GitHub (see scripts/vite-update.ts).
export default defineConfig(({ mode }) => ({
  base: "./",
  server: { port: 5173 },
  worker: { format: "es" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [updatePlugin(appDir), dropDevLibraries(), ...(mode === "https" ? [basicSsl()] : [])],
}));
