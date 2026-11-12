// Hash and text core for the content lock. Shared by the browser importer and the Node build script.
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";

export type HashField = "cell" | "col" | "para" | "heading" | "title" | "intro" | "notes" | "legacy";
/** Ops are [pos, deleteLen, insert], positions relative to the original string. */
export type Patch = [number, number, string][];

const KEY_PREFIX = "2d6-companion/key/v1";
const CHUNK = 8 * 1024 * 1024;
const MAX_OPS = 3;
const MAX_INSERT = 4;
const enc = new TextEncoder();

/** NFC, straight quotes, hyphens for en/em dashes, whitespace collapsed and trimmed. */
export function norm(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same rules as pipeline/extract.py fix_text: the PDFs' fonts lose curly quotes and dashes (U+FFFD). */
export function fixText(s: string): string {
  return s.replace(/ � /g, " – ").replace(/�/g, "'");
}

function toHex(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
}

function base64url(b: Uint8Array): string {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** One streamed pass: fp = hex(SHA-256(file)), key = SHA-256(prefix ‖ file). */
export async function digestFile(
  blob: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ fp: string; key: Uint8Array }> {
  const fpHash = sha256.create();
  const keyHash = sha256.create().update(enc.encode(KEY_PREFIX));
  const total = blob.size;
  for (let off = 0; off < total; off += CHUNK) {
    const end = Math.min(total, off + CHUNK);
    const chunk = new Uint8Array(await blob.slice(off, end).arrayBuffer());
    fpHash.update(chunk);
    keyHash.update(chunk);
    onProgress?.(end, total);
  }
  return { fp: toHex(fpHash.digest()), key: keyHash.digest() };
}

/** Keyed hash of one piece of book text; useless without the PDF-derived key. Unused row/col are -1. */
export function fieldHash(
  key: Uint8Array,
  f: HashField,
  sectionId: string,
  block: number,
  row: number,
  col: number,
  text: string,
): string {
  const msg = [f, sectionId, block, row, col, norm(text)].join("\0");
  return base64url(hmac(sha256, key, enc.encode(msg))).slice(0, 22);
}

/** Applies ops from right to left, so each position stays relative to the original string. */
export function applyPatch(s: string, p: Patch): string {
  const ops = [...p].sort((a, b) => b[0] - a[0]);
  for (const [pos, del, ins] of ops) s = s.slice(0, pos) + ins + s.slice(pos + del);
  return s;
}

/** Character-level edit diff (Levenshtein DP), adjacent edits merged. Null over the limits. */
export function makePatch(from: string, to: string): Patch | null {
  const a = Array.from(from);
  const b = Array.from(to);
  // Strip common prefix and suffix; work in code points, then convert positions to UTF-16 offsets.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const d = new Uint32Array((n + 1) * w);
  for (let i = 0; i <= n; i++) d[i * w] = i;
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = d[(i - 1) * w + j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1);
      d[i * w + j] = Math.min(sub, d[(i - 1) * w + j] + 1, d[i * w + j - 1] + 1);
    }
  }
  // Backtrack into a forward list of steps: "=" match, or an edit consuming dx from x and dy from y.
  const steps: { i: number; dx: number; ins: string }[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = d[i * w + j];
    if (i > 0 && j > 0 && x[i - 1] === y[j - 1] && here === d[(i - 1) * w + j - 1]) {
      i--; j--;
      steps.push({ i, dx: -1, ins: "" }); // match marker
    } else if (i > 0 && j > 0 && here === d[(i - 1) * w + j - 1] + 1) {
      i--; j--;
      steps.push({ i, dx: 1, ins: y[j] });
    } else if (i > 0 && here === d[(i - 1) * w + j] + 1) {
      i--;
      steps.push({ i, dx: 1, ins: "" });
    } else {
      j--;
      steps.push({ i, dx: 0, ins: y[j] });
    }
  }
  steps.reverse();
  // Merge runs of consecutive edits into ops (code-point positions within x).
  const cp: [number, number, string][] = [];
  let cur: [number, number, string] | null = null;
  for (const s of steps) {
    if (s.dx < 0) { cur = null; continue; }
    if (!cur) { cur = [s.i, 0, ""]; cp.push(cur); }
    cur[1] += s.dx;
    cur[2] += s.ins;
  }
  if (cp.length > MAX_OPS) return null;
  if (cp.reduce((t, op) => t + Array.from(op[2]).length, 0) > MAX_INSERT) return null;
  const u16 = (k: number) => a.slice(0, pre + k).join("").length;
  return cp.map(([pos, del, ins]) => [u16(pos), u16(pos + del) - u16(pos), ins]);
}
