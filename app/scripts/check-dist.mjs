// Fails the build if locked-book text reaches dist/. Core and the free Codex set may ship; nothing else.
//   node scripts/check-dist.mjs            check dist/ (what `npm run build` runs)
//   node scripts/check-dist.mjs --audit    scan app/src and docs/spec-*.md instead (source audit)
// Phrase list: pipeline/work/phrases.json (private, gitignored), or the path in env D6_PHRASES.
// If it is missing (CI, clean clone) the book-text scan is SKIPPED with a loud banner, but the structural and
// manifest checks still run, so public builds work. Set D6_REQUIRE_PHRASES=1 to make a missing list a failure.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoDir = resolve(appDir, "..");

/** Same folding as norm() in src/lock/hash.ts (curly quotes, en/em dashes, whitespace), plus lower case and "…". */
export function fold(s) {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", hellip: "..." };
const cp = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");

/** Undo the escapes a bundler or HTML may have applied, so a phrase cannot hide behind ’, &rsquo;, \" or \n. */
export function decode(s) {
  return s
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'`\\])/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
}

const ALNUM = /[\p{L}\p{N}]/u;
const NON_ALNUM = /[^\p{L}\p{N}]/gu;
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const MIN_LEN = 4;
const squash = (s) => s.replace(NON_ALNUM, "");

/**
 * Phrases that are not book text, matched on the folded and edge-stripped phrase. Each entry says why. Two kinds only:
 *  - third-party library strings;
 *  - single dictionary words or bare sheet/section names that are generic game vocabulary the app needs for its
 *    own UI ("ghost" is also a button style). They carry no book prose. Never add a phrase of prose here.
 */
const ALLOW = new Map([
  ["napi-rs/canvas", "pdfjs-dist's browser build names this optional Node dependency (@napi-rs/canvas)"],
  ["ghost", "dictionary word; the ghost button/chip variant in the app's own CSS and components"],
  ["mystic", "dictionary word, used in prose by the spec docs"],
  ["turncoat", "dictionary word, used in prose by the spec docs"],
  ["landowner", "generic role word; the Realm tool's own label"],
  ["land log", "generic Realm tracker name; the Realm tool's own heading"],
  ["unclaimed land log", "generic Realm tracker name; the Realm tool's own heading"],
  ["building register", "generic Realm tracker name; the Realm tool's own heading"],
  ["realm ledger", "generic Realm tracker name, used by the spec docs"],
]);

const SKIP_EXT = new Set([
  ".wasm", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".ico", ".avif", ".bmp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot", ".traineddata", ".gz", ".zip", ".pdf", ".mp3", ".ogg", ".wav", ".bin",
]);

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p).sort()) {
      if (e === "node_modules" || e === ".git") continue;
      yield* walk(join(p, e));
    }
  } else yield p;
}

const extOf = (f) => {
  const i = f.lastIndexOf(".");
  return i < 0 ? "" : f.slice(i).toLowerCase();
};
const rel = (root, f) => relative(root, f).split(sep).join("/");

/**
 * True if the folded phrase k occurs in the folded text h. A phrase without whitespace must be a whole word: where
 * it starts or ends with a letter or digit, the neighbouring character in h must not be one. This keeps a short
 * one-word title from matching inside a base64 hash or a minified blob. Phrases with spaces need no edge rule.
 */
function has(h, k) {
  const edges = !k.includes(" ");
  for (let i = h.indexOf(k); i >= 0; i = h.indexOf(k, i + 1)) {
    if (edges) {
      if (i > 0 && ALNUM.test(h[i - 1])) continue;
      const e = i + k.length;
      if (e < h.length && ALNUM.test(h[e])) continue;
    }
    return true;
  }
  return false;
}

/** Every string value and key of a parsed JSON document, one per line. */
function jsonText(raw) {
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return "";
  }
  const out = [];
  const w = (x) => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach(w);
    else if (x && typeof x === "object")
      for (const [k, v] of Object.entries(x)) {
        out.push(k);
        w(v);
      }
  };
  w(j);
  return out.join("\n");
}

/** Prepares phrases: fold, strip edge punctuation, drop short or allowlisted ones, dedupe. */
function prepare(phrases) {
  const keys = [];
  const seen = new Set();
  for (const p of phrases) {
    const k = fold(p.phrase).replace(EDGE, "");
    if ([...k].length < MIN_LEN || ALLOW.has(k) || seen.has(k)) continue;
    seen.add(k);
    const words = k.split(" ").length;
    const sq = squash(k);
    // slug / camelCase / concatenated forms: only for phrases long enough that squashed collisions are implausible
    keys.push({ k, p, sq: (words >= 3 || [...k].length >= 15) && sq.length >= 8 ? sq : null });
  }
  return keys;
}

/** Scans every text file under `root` (a directory or a single file). Returns { file, phrase, where } for each hit. */
export function scan(root, phrases) {
  const keys = prepare(phrases);
  const out = [];
  const isDir = statSync(root).isDirectory();
  for (const f of walk(root)) {
    const ext = extOf(f);
    if (SKIP_EXT.has(ext)) continue;
    const raw = readFileSync(f, "utf8");
    const texts = [fold(raw), fold(decode(raw))];
    if (ext === ".json") {
      const j = jsonText(raw);
      if (j) texts.push(fold(j));
    }
    let squashed = null;
    const name = isDir ? rel(root, f) : f.split(sep).pop();
    for (const { k, p, sq } of keys) {
      let hit = texts.some((t) => has(t, k));
      if (!hit && sq) {
        squashed ??= texts.map(squash);
        hit = squashed.some((t) => t.includes(sq));
      }
      if (hit) out.push({ file: name, phrase: p.phrase, where: p.where });
    }
  }
  return out;
}

/** Things that must never be in dist/, whatever their content. Walks the whole tree, case-insensitively. */
export function structural(dist) {
  const out = [];
  const allowedPages = (s) => s[0] === "pages" && (s.length === 1 || (s[1] === "core" && s.length <= 3));
  const allowedData = (s) => s[0] === "data" && (s.length === 1 || (s.length === 2 && (s[1] === "manifest.json" || s[1] === "manifest-void.json" || s[1] === "free.json")));
  const visit = (dir, segs) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const s = [...segs, e.name];
      const low = s.map((x) => x.toLowerCase());
      const path = s.join("/");
      if (e.name.toLowerCase() === "library.json") out.push(`${path} must not ship`);
      else if (low.includes("pages") && !allowedPages(s)) {
        out.push(`${path} must not ship (only root pages/core/<file>)`);
        continue;
      } else if (low.includes("data") && !allowedData(s)) {
        out.push(`${path} must not ship (only root data/manifest.json, data/manifest-void.json and data/free.json)`);
        continue;
      }
      if (e.isDirectory()) visit(join(dir, e.name), s);
    }
  };
  visit(dist, []);
  return out;
}

/** Archives and documents: a book PDF or a bundle of one must never ship. The one exception is named. */
const ARCHIVE_EXT = new Set([".pdf", ".zip", ".gz"]);
const ARCHIVE_OK = new Set([
  "ocr/lang/eng.traineddata.gz", // Tesseract's English model (@tesseract.js-data/eng), needed by on-device OCR; no book text
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
/** Where images may ship (what `npm run build` emits today). Paths are case-sensitive, from the dist root. */
const IMAGE_OK = [
  "pages/core/",          // the free Core Rules page scans (files directly inside only)
  "assets/dice-box/",     // dice-box textures (scripts/copy-dice.mjs)
  "assets/themes/",       // the default dice theme's textures
  "backdrops/",           // app backgrounds
  "portraits/",           // character portraits
];
const IMAGE_FILES = new Set(["logo.png", "logo-void.png"]); // the two game logos (both listed for review before any public repo)

/** Every file whose type is not allowed where it is: archives and PDFs, and images outside the allowlist. */
export function fileTypeFindings(dist) {
  const out = [];
  for (const f of walk(dist)) {
    const path = rel(dist, f);
    const low = path.toLowerCase();
    const ext = extOf(low);
    if (ARCHIVE_EXT.has(ext) && !ARCHIVE_OK.has(path)) out.push(`${path} must not ship (no PDF, zip or gzip files)`);
    else if (IMAGE_EXT.has(ext) && !IMAGE_FILES.has(path) && !IMAGE_OK.some((d) => path.startsWith(d) && (d !== "pages/core/" || !path.slice(d.length).includes("/"))))
      out.push(`${path} must not ship (images only under ${IMAGE_OK.join(", ")} or ${[...IMAGE_FILES].join(", ")})`);
  }
  return out;
}

// Schema-aware mirror of the manifest validator (src/lock/manifest.ts, validate.ts); a .mjs cannot import those
// extensionless TS sources. Every string value and every object key must sit where its kind belongs.
const ID = /^[a-z]+\/p[0-9]{1,5}-[0-9]{1,4}$/;
const CODE = /^[A-Z0-9]{2,8}$/;
const HASH = /^[A-Za-z0-9_-]{22}$/;
const DICE = /^(1D6|2D6|D66|[0-9D+]{2,8})$/;
const FP = /^[0-9a-f]{64}$/;
const EDITION = /^[a-z0-9]{1,12}(?:-[a-z0-9]{1,12})?$/;
const SLUG = /^[a-z]+$/;
const BOOK_NAMES = ["Core Rules", "Tables Codex", "Realm", "2D6 Void"];
const oneOf = (...v) => ({ test: (s) => v.includes(s) });
// Generalised path (array indexes as "#") -> what a string value there may be.
const VALUES = [
  [/^books\.#\.name$/, oneOf(...BOOK_NAMES)],
  [/^books\.#\.slug$/, SLUG],
  [/^books\.#\.editions\.#\.id$/, EDITION],
  [/^books\.#\.editions\.#\.fp$/, FP],
  [/^books\.#\.freeFp\.#$/, FP],
  [/^sections\.#\.id$/, ID],
  [/^sections\.#\.book$/, SLUG],
  [/^sections\.#\.chapter$/, ID],
  [/^sections\.#\.legacy\.<ed>$/, HASH],
  [/^sections\.#\.(title\.|blocks\.#\.)h\.<ed>\.v\.#$/, { test: (s) => s === "" || HASH.test(s) }],
  [/^sections\.#\.blocks\.#\.type$/, oneOf("para", "heading", "table", "image")],
  [/^sections\.#\.(title|blocks\.#)\.loc\.kind$/, oneOf("text", "ocr", "dice")],
  [/^sections\.#\.blocks\.#\.(title|intro|notes|colLocs\.#|cells\.#\.#)\.kind$/, oneOf("text", "ocr", "dice")],
  [/^sections\.#\.blocks\.#\.marks\.#\.#$/, oneOf("b", "i")],
  [/^sections\.#\.blocks\.#\.code$/, CODE],
  [/^sections\.#\.blocks\.#\.dice$/, DICE],
  [/^codes\.<code>$/, ID],
];
const KNOWN_KEYS = new Set([
  "version", "books", "slug", "name", "free", "editions", "id", "fp", "pages", "rotate", "rotatePages", "freeFp",
  "sections", "book", "level", "chapter", "blocks", "legacy", "title", "type", "page", "loc", "box", "kind", "h", "v",
  "patch", "marks", "code", "dice", "cols", "rows", "intro", "notes", "colLocs", "cells", "continued", "blank_rows",
  "rowPages", "codes",
]);

/**
 * data/manifest.json may hold only what the validator allows, each in its own place. No book text. A finding
 * never prints an offending key: it is shown as <key>, on its own path and on every path below it.
 */
export function manifestFindings(dist) {
  return ["manifest.json", "manifest-void.json"].flatMap((name) => manifestFile(dist, name));
}

function manifestFile(dist, name) {
  const f = join(dist, "data", name);
  if (!existsSync(f)) return [];
  const out = [];
  const bad = (path, why) => out.length < 20 && out.push(`data/${name}: ${why} at ${path || "(root)"}`);
  let m;
  try {
    m = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return [`data/${name}: not valid JSON`];
  }
  // g: generalised path, p: real path
  const walkJson = (x, g, p) => {
    if (typeof x === "string") {
      const last = p.split(".").pop();
      if (/\.patch\.<hash>\.#\.#$/.test(g) && last === "2" && [...x].length <= 4) return; // a patch's inserted characters
      const rule = VALUES.find(([re]) => re.test(g));
      if (!rule || !rule[1].test(x)) bad(p, "string in the wrong place or of the wrong shape");
    } else if (Array.isArray(x)) x.forEach((e, i) => walkJson(e, `${g}.#`, `${p}.${i}`));
    else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x)) {
        let gk = k;
        let why = null;
        if (/(^|\.)(h|legacy)$/.test(g)) {
          if (!EDITION.test(k)) why = "bad edition key";
          gk = "<ed>";
        } else if (/\.patch$/.test(g)) {
          if (!HASH.test(k)) why = "bad patch key";
          gk = "<hash>";
        } else if (g === "codes") {
          if (!CODE.test(k)) why = "bad code key";
          gk = "<code>";
        } else if (!KNOWN_KEYS.has(k)) why = "unknown key";
        const pk = why ? "<key>" : k;                                // a bad key could be book text: never printed
        const here = p ? `${p}.${pk}` : pk;
        if (why) bad(here, why);
        walkJson(v, g ? `${g}.${gk}` : gk, here);
      }
    }
  };
  walkJson(m, "", "");
  return out;
}

function loadPhrases(file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  return j.map((x) => (typeof x === "string" ? { phrase: x, where: "" } : x));
}

/** A finding line never carries the phrase itself: where it came from plus a short prefix. */
const describe = (h) => `${h.file}: ${h.where || "?"} "${process.env.D6_FULL ? fold(h.phrase) : [...fold(h.phrase)].slice(0, 12).join("") + "..."}"`;

const banner = (file, require) => [
  "check-dist: ################################################################",
  `check-dist: WARNING: phrase list not found at ${file}`,
  "check-dist: the book-text scan was SKIPPED. Only structural and manifest checks ran.",
  "check-dist: set D6_PHRASES to the list, or D6_REQUIRE_PHRASES=1 to make this fail.",
  ...(require ? ["check-dist: D6_REQUIRE_PHRASES=1 is set, so this is a failure."] : []),
  "check-dist: ################################################################",
];

/** Runs the whole dist check. Returns { code, findings, warnings } without printing or exiting. */
export function check({ dist, phrasesFile, require }) {
  const findings = [];
  const warnings = [];
  if (!existsSync(dist)) return { code: 1, findings: [`no dist/ at ${dist}; run vite build first`], warnings };
  findings.push(...structural(dist), ...fileTypeFindings(dist), ...manifestFindings(dist));
  if (!existsSync(phrasesFile)) {
    warnings.push(...banner(phrasesFile, require));
    if (require) findings.push("phrase list missing and D6_REQUIRE_PHRASES=1");
  } else {
    // 2D6 Void's own phrase list sits beside the Dungeon one (phrases.json -> phrases-void.json), when built
    const voidFile = phrasesFile.replace(/phrases\.json$/, "phrases-void.json");
    const lists = [loadPhrases(phrasesFile), ...(voidFile !== phrasesFile && existsSync(voidFile) ? [loadPhrases(voidFile)] : [])];
    for (const h of scan(dist, lists.flat())) findings.push(describe(h));
  }
  return { code: findings.length ? 1 : 0, findings, warnings };
}

function main() {
  const file = resolve(process.env.D6_PHRASES || join(repoDir, "pipeline", "work", "phrases.json"));
  const require = process.env.D6_REQUIRE_PHRASES === "1";
  if (process.argv.includes("--audit")) {
    if (!existsSync(file)) {
      console.warn(banner(file, false).join("\n"));
      return 0;
    }
    const phrases = loadPhrases(file);
    const docs = join(repoDir, "docs");
    const targets = [join(appDir, "src"), ...readdirSync(docs).filter((n) => /^spec-.*\.md$/.test(n)).map((n) => join(docs, n))];
    const findings = [];
    for (const t of targets) {
      const dir = statSync(t).isDirectory();
      for (const h of scan(t, phrases)) findings.push(`${rel(repoDir, t)}${dir ? "/" + h.file : ""}: ${h.where || "?"} "${[...fold(h.phrase)].slice(0, 12).join("")}..."`);
    }
    for (const f of findings) console.error("check-dist: " + f);
    console.log(`check-dist: ${findings.length} findings`);
    return findings.length ? 1 : 0;
  }
  const r = check({ dist: join(appDir, "dist"), phrasesFile: file, require });
  for (const w of r.warnings) console.warn(w);
  for (const f of r.findings) console.error("check-dist: " + f);
  console.log(`check-dist: ${r.findings.length} findings`);
  return r.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
