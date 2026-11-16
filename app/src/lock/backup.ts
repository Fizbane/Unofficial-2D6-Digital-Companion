// Backups: a strict check of a backup file before anything is written to localStorage, and the
// matching export. Book content lives in IndexedDB and never travels in a backup.
import { fail, obj, opt, rec, str, type V } from "./validate";

export const MAX_BACKUP_VALUE = 2_000_000; // characters per value (about 2 MB)
const MAX_BACKUP_KEYS = 4000; // about 8 per character (rostermodel.ts), plus settings
/** A Dungeon key ("2d6:…") or a 2D6 Void key ("2d6v:…", games.ts keyFor). */
export const BACKUP_KEY = /^2d6v?:[A-Za-z0-9:_-]{1,64}$/;
/** Keys that hold, or belong to, book content: never exported, never imported. */
const CONTENT_KEY = /^2d6v?:(content|books|pages)/;
/**
 * Keys that describe this device, not the player's game: where automatic backups go (its folder handle is in
 * this browser's IndexedDB) and the music playlist (its song files are too). Restored elsewhere they would
 * switch automatic backups off and list songs that aren't there, so they never travel either way.
 */
const DEVICE_KEYS = new Set(["2d6:shell:backup", "2d6:shell:playlist"]);

export interface Backup { app: "2d6-companion"; data: Record<string, string> }

const dataKey: V<string> = (x, path) => (typeof x === "string" && BACKUP_KEY.test(x) && !CONTENT_KEY.test(x) ? x : fail(path));
const backupShape = obj<{ app: string; saved?: string; data: Record<string, string> }>(
  { app: str(32, /^2d6-companion$/), saved: opt(str(64)), data: rec(BACKUP_KEY, str(MAX_BACKUP_VALUE), MAX_BACKUP_KEYS) },
  { extra: true },
);

/** A Backup from untrusted JSON: right app, every key a plain 2d6 key (never content), every value a string of at most 2 MB. Device keys are dropped. */
export function validateBackup(x: unknown): Backup {
  const b = backupShape(x, "backup");
  for (const k of Object.keys(b.data)) dataKey(k, `backup.data.${k}`);
  // older backups carry the device keys: accept the file, leave those out
  const data = Object.fromEntries(Object.entries(b.data).filter(([k]) => !DEVICE_KEYS.has(k)));
  return { app: "2d6-companion", data };
}

/** The 2d6 keys of a storage that a backup may carry (no book content; nothing an import would reject). */
export function collectBackup(ls: { length: number; key(i: number): string | null; getItem(k: string): string | null }): { data: Record<string, string>; omitted: string[] } {
  const data: Record<string, string> = {};
  const omitted: string[] = []; // keys that are too large to travel in a backup
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (!k || !BACKUP_KEY.test(k) || CONTENT_KEY.test(k) || DEVICE_KEYS.has(k)) continue;
    const v = ls.getItem(k);
    if (v === null) continue;
    if (v.length <= MAX_BACKUP_VALUE) data[k] = v;
    else omitted.push(k);
  }
  return { data, omitted };
}

/** Write a validated backup. If any write fails (storage full), put every key back as it was: "restored", or "partial" if even that failed. */
export function applyBackup(
  ls: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void },
  data: Record<string, string>,
): "ok" | "restored" | "partial" {
  const before = Object.keys(data).map((k) => [k, ls.getItem(k)] as const);
  try {
    for (const [k, v] of Object.entries(data)) ls.setItem(k, v);
    return "ok";
  } catch {
    let clean = true;
    for (const [k, v] of before) {
      try {
        if (v === null) ls.removeItem(k);
        else ls.setItem(k, v);
      } catch {
        clean = false;
      }
    }
    return clean ? "restored" : "partial";
  }
}
