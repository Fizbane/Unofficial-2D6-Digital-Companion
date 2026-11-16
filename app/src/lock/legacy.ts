// Old ids remapped after an unlock: bookmarks, recent items, fixes and journal links that point at a locked
// section's old title-slug id are rewritten to its new id. Light (no pdf.js or Tesseract), for the main thread.
import { fieldHash } from "./hash";
import type { Manifest } from "./manifest";

const readJson = (k: string): unknown => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
};
const writeJson = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the old ids stay */
  }
};

/** Section links in free text: `#/s/<encoded id>` (the app's section routes). */
const SECTION_LINK = /#\/s\/([^\s)"'<>\]]+)/g;

/**
 * Rewrites references to locked sections' old title-slug ids to their new ids, after a book is unlocked:
 * "2d6:bookmarks" and "2d6:recent" (string lists), the `s` of each "2d6:fixes" entry, and `#/s/<id>`
 * links in the text and additions of "2d6:journal" entries. An id matches when
 * fieldHash(key, "legacy", id, -1, -1, -1, "") equals a section's `legacy[edition]`. Returns the number of
 * references rewritten. Malformed stored values are left alone.
 */
export async function remapLegacy(key: Uint8Array, edition: string, manifest: Manifest): Promise<number> {
  const byHash = new Map<string, string>();
  for (const s of manifest.sections) {
    const h = s.legacy?.[edition];
    if (h) byHash.set(h, s.id);
  }
  if (!byHash.size || typeof localStorage === "undefined") return 0;
  const memo = new Map<string, string | undefined>();
  const to = (id: string): string | undefined => {
    if (!memo.has(id)) {
      const n = byHash.get(fieldHash(key, "legacy", id, -1, -1, -1, ""));
      memo.set(id, n && n !== id ? n : undefined);
    }
    return memo.get(id);
  };
  let count = 0;

  for (const k of ["2d6:bookmarks", "2d6:recent"]) {
    const list = readJson(k);
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) continue;
    let changed = false;
    const out: string[] = [];
    for (const id of list as string[]) {
      const n = to(id);
      if (n) { count++; changed = true; }
      const v = n ?? id;
      if (!out.includes(v)) out.push(v);
    }
    if (changed) writeJson(k, out);
  }

  const fixes = readJson("2d6:fixes");
  if (Array.isArray(fixes)) {
    let changed = false;
    for (const f of fixes) {
      if (!f || typeof f !== "object" || typeof (f as { s?: unknown }).s !== "string") continue;
      const n = to((f as { s: string }).s);
      if (n) { (f as { s: string }).s = n; count++; changed = true; }
    }
    if (changed) writeJson("2d6:fixes", fixes);
  }

  // every Dungeon character's journal (rostermodel.ts slots), and one from before rosters
  for (const jk of Object.keys(localStorage).filter((k) => /^2d6:(c:c-[a-z0-9]{4,12}:)?journal$/.test(k))) count += remapJournal(jk, to);
  return count;
}

function remapJournal(jk: string, to: (id: string) => string | undefined): number {
  let count = 0;
  const journal = readJson(jk) as { entries?: unknown } | undefined;
  if (journal && typeof journal === "object" && Array.isArray(journal.entries)) {
    let changed = false;
    const relink = (s: string) => s.replace(SECTION_LINK, (m, enc: string) => {
      let id: string;
      try { id = decodeURIComponent(enc); } catch { return m; }
      const n = to(id);
      if (!n) return m;
      count++;
      changed = true;
      return `#/s/${encodeURIComponent(n)}`;
    });
    for (const e of journal.entries as Record<string, unknown>[]) {
      if (!e || typeof e !== "object") continue;
      for (const f of ["text", "addition"]) if (typeof e[f] === "string") e[f] = relink(e[f] as string);
    }
    if (changed) writeJson(jk, journal);
  }
  return count;
}
