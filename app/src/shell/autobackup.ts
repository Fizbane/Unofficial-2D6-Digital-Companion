// Automatic backups of everything the player saves in this browser (characters, realm, fixes, notes, bookmarks,
// the journal, achievements, settings, for both games) as a JSON file, every 10 minutes while the app is open,
// keeping the newest 10. Book content never travels in a backup (lock/backup.ts): it comes from the owner's PDF.
//
// Where the files go: a folder the player picks once (File System Access API, Chromium browsers). Point it at
// OneDrive, Google Drive or iCloud Drive and the files sync to the cloud with no further setup. Browsers without
// the folder picker keep the same 10 rolling copies inside the browser (IndexedDB) and offer Export for a file.
// A snapshot identical to the last one is skipped, so an idle app never pushes good copies out of the 10.
import { collectBackup, validateBackup, type Backup } from "../lock/backup";
import { readState, writeState } from "./state";

export const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
export const BACKUP_KEEP = 10;
export const BACKUP_CONFIG_KEY = "2d6:shell:backup";
const FILE_RE = /^2d6-companion-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/;
const SUBFOLDER = "2D6 Companion backups";

export interface BackupConfig {
  v: 1;
  /** "folder": files in the player's folder; "browser": copies kept in this browser; "off": the player said not now. */
  mode: "folder" | "browser" | "off";
  /** The first-run prompt has been shown (answered or dismissed). */
  asked: boolean;
  last: number;
  lastHash: string;
  folderName: string;
}
const DEFAULT: BackupConfig = { v: 1, mode: "off", asked: false, last: 0, lastHash: "", folderName: "" };
const isConfig = (x: unknown): x is BackupConfig => {
  const o = x as Partial<BackupConfig> | null;
  return !!o && o.v === 1 && (o.mode === "folder" || o.mode === "browser" || o.mode === "off") && typeof o.asked === "boolean" &&
    typeof o.last === "number" && typeof o.lastHash === "string" && typeof o.folderName === "string";
};

// ---------------------------------------------------------------------------------------------- pure helpers

const p2 = (n: number) => String(n).padStart(2, "0");
/** "2d6-companion-backup-2026-11-12-001530.json" (local time, so the names sort and read naturally). */
export function backupFileName(d: Date): string {
  return `2d6-companion-backup-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`;
}
export const isBackupFile = (name: string): boolean => FILE_RE.test(name);

/** The backup files to delete so that only the newest `keep` remain (other files are never touched). */
export function filesToDelete(names: readonly string[], keep = BACKUP_KEEP): string[] {
  const ours = names.filter(isBackupFile).sort(); // the name sorts by time
  return ours.slice(0, Math.max(0, ours.length - keep));
}

/** A cheap stable fingerprint of the snapshot's data (FNV-1a over the sorted keys and values). */
export function snapshotHash(data: Record<string, string>): string {
  let h = 0x811c9dc5;
  for (const k of Object.keys(data).sort()) {
    for (const ch of k + "\u0000" + data[k] + "\u0001") {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0") + String(Object.keys(data).length);
}

/** The data to save: every 2d6 key a backup may carry, minus this module's own config. */
export function snapshotData(ls: Parameters<typeof collectBackup>[0]): Record<string, string> {
  const { data } = collectBackup(ls);
  delete data[BACKUP_CONFIG_KEY];
  return data;
}

export const backupJson = (data: Record<string, string>, now = new Date()): string =>
  JSON.stringify({ app: "2d6-companion", saved: now.toISOString(), data });

/** A backup file's text, checked. Throws a ValidationError on anything unexpected. */
export function parseBackup(text: string): Backup {
  return validateBackup(JSON.parse(text));
}

// ---------------------------------------------------------------------------------------------- storage of the handle and the browser copies

const IDB = "2d6-backup";
const HANDLES = "handles";
const COPIES = "copies";
let dbp: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(IDB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(HANDLES);
      req.result.createObjectStore(COPIES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbp.catch(() => (dbp = undefined)); // try again on the next backup
  return dbp;
}
async function idb<T>(store: string, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------------------------- the file system

type DirHandle = {
  name: string;
  queryPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>; getFile(): Promise<File> }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
};

export const folderPickerSupported = (): boolean => typeof window !== "undefined" && "showDirectoryPicker" in window;

// ---------------------------------------------------------------------------------------------- state

let config: BackupConfig = readState(BACKUP_CONFIG_KEY, isConfig, () => ({ ...DEFAULT }));
let dir: DirHandle | null = null;
let needsPermission = false;
let lastError = "";
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const saveConfig = () => writeState(BACKUP_CONFIG_KEY, config);

export interface BackupStatus {
  mode: BackupConfig["mode"];
  asked: boolean;
  folderName: string;
  last: number;
  needsPermission: boolean;
  error: string;
  pickerSupported: boolean;
}
export const backupStatus = (): BackupStatus => ({
  mode: config.mode, asked: config.asked, folderName: config.folderName, last: config.last,
  needsPermission, error: lastError, pickerSupported: folderPickerSupported(),
});
export function onBackupStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The first-run prompt has been dealt with (so it is not shown again). */
export function markBackupAsked(): void {
  config = { ...config, asked: true };
  saveConfig();
  emit();
}

/** Backups need setting up: never asked, and no folder or browser copies chosen. */
export const needsBackupSetup = (): boolean => !config.asked && config.mode === "off";

/** Let the player pick the backup folder (needs a click). A "2D6 Companion backups" folder is made inside it. */
export async function chooseBackupFolder(): Promise<boolean> {
  if (!folderPickerSupported()) return false;
  try {
    const picked = await (window as unknown as { showDirectoryPicker(o: { id: string; mode: "readwrite" }): Promise<DirHandle> })
      .showDirectoryPicker({ id: "2d6-backups", mode: "readwrite" });
    const sub = await picked.getDirectoryHandle(SUBFOLDER, { create: true });
    await idb(HANDLES, "readwrite", (os) => os.put(sub, "dir"));
    dir = sub;
    needsPermission = false;
    lastError = "";
    config = { ...config, mode: "folder", asked: true, folderName: `${picked.name}/${SUBFOLDER}`, lastHash: "" };
    saveConfig();
    emit();
    await backupNow();
    return true;
  } catch (e) {
    if ((e as { name?: string })?.name !== "AbortError") lastError = "Couldn't use that folder.";
    emit();
    return false;
  }
}

/** Keep the copies inside this browser instead (for browsers without the folder picker, or when the player prefers it). */
export function useBrowserBackups(): void {
  config = { ...config, mode: "browser", asked: true, folderName: "", lastHash: "" };
  saveConfig();
  emit();
  void backupNow();
}

export function turnBackupsOff(): void {
  config = { ...config, mode: "off", asked: true };
  saveConfig();
  emit();
}

/** After a reload the saved folder needs the player's OK again: this must run from a click. */
export async function reconnectFolder(): Promise<boolean> {
  if (!dir) return false;
  try {
    needsPermission = (await dir.requestPermission({ mode: "readwrite" })) !== "granted";
  } catch {
    needsPermission = true;
  }
  emit();
  if (!needsPermission) await backupNow();
  return !needsPermission;
}

async function loadFolder(): Promise<void> {
  if (config.mode !== "folder" || dir) return;
  try {
    dir = (await idb<DirHandle | undefined>(HANDLES, "readonly", (os) => os.get("dir"))) ?? null;
    if (!dir) throw new Error("no folder saved");
    needsPermission = (await dir.queryPermission({ mode: "readwrite" })) !== "granted";
  } catch {
    dir = null;
    needsPermission = false;
    lastError = "The backup folder isn't available any more. Choose it again.";
  }
}

// ---------------------------------------------------------------------------------------------- the backup itself

export interface BackupResult { ok: boolean; skipped?: boolean; name?: string; error?: string }

/**
 * Back up now. Skips (ok: true, skipped) when nothing changed since the last backup, unless `force`. In folder
 * mode the file is written and the oldest beyond 10 are removed; in browser mode the copy goes into IndexedDB.
 */
export async function backupNow(force = false, ls: Parameters<typeof collectBackup>[0] = localStorage): Promise<BackupResult> {
  if (config.mode === "off") return { ok: false, error: "Backups are off." };
  const data = snapshotData(ls);
  const hash = snapshotHash(data);
  if (!force && hash === config.lastHash) return { ok: true, skipped: true };
  const now = new Date();
  const name = backupFileName(now);
  try {
    if (config.mode === "folder") {
      await loadFolder();
      if (!dir) return { ok: false, error: lastError || "No backup folder." };
      if (needsPermission) return { ok: false, error: "The backup folder needs permission again." };
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(backupJson(data, now));
      await w.close();
      const names: string[] = [];
      for await (const n of dir.keys()) names.push(n);
      for (const old of filesToDelete(names)) await dir.removeEntry(old).catch(() => {});
    } else {
      await idb(COPIES, "readwrite", (os) => os.put(backupJson(data, now), name));
      const keys = await idb<string[]>(COPIES, "readonly", (os) => os.getAllKeys() as IDBRequest);
      for (const old of filesToDelete(keys.map(String))) await idb(COPIES, "readwrite", (os) => os.delete(old));
    }
    config = { ...config, last: now.getTime(), lastHash: hash };
    lastError = "";
    saveConfig();
    emit();
    return { ok: true, name };
  } catch (e) {
    lastError = (e as { name?: string })?.name === "QuotaExceededError" ? "The backup location is full." : "The backup couldn't be saved.";
    emit();
    return { ok: false, error: lastError };
  }
}

/** The copies kept in this browser (newest first): [name, saved text]. */
export async function browserCopies(): Promise<[string, string][]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const out: [string, string][] = [];
      const req = d.transaction(COPIES, "readonly").objectStore(COPIES).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.push([String(c.key), String(c.value)]); c.continue(); } else resolve(out.sort((a, b) => b[0].localeCompare(a[0])));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Start the 10-minute timer (once). Backs up straight away if the last backup is older than 10 minutes. */
export function startAutoBackup(): void {
  if (timer || typeof window === "undefined") return;
  void loadFolder().then(() => {
    emit();
    if (config.mode !== "off" && Date.now() - config.last >= BACKUP_INTERVAL_MS) void backupNow();
  });
  timer = setInterval(() => void backupNow(), BACKUP_INTERVAL_MS);
  // a last copy when the tab is closed or hidden (a quick write may not finish, so the timer is the real guarantee)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void backupNow();
  });
}
