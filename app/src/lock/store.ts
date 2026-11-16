// Device store for unlocked content: IndexedDB database "2d6". Nothing here is shipped or synced.
import type { Section } from "../types";

export type StoreErrorKind = "quota" | "unavailable";
export class StoreError extends Error {
  readonly kind: StoreErrorKind;
  readonly cause: unknown;
  constructor(kind: StoreErrorKind, cause: unknown) {
    super(`store ${kind}${cause instanceof Error ? `: ${cause.message}` : ""}`);
    this.name = "StoreError";
    this.kind = kind;
    this.cause = cause;
  }
}

export interface BookRecord { slug: string; edition: string; fp: string; key: Uint8Array; date: number }
export interface StoredSection { section: Section; unverified: string[] }
/** Resume point: every section whose pages all lie at or before `page` is stored; `fp` names the file. */
export interface Progress { page: number; fp?: string }

/** One IndexedDB per game, so a Lock in one never touches the other's books: "2d6" (Dungeon) and "2d6v" (Void). */
let DB = "2d6";
/** Pick the game's database. Call before the first read or write (the main thread at startup, the import Worker per run). */
export function useGameStore(game: string): void {
  const name = game === "void" ? "2d6v" : "2d6";
  if (name === DB) return;
  DB = name;
  dbp = undefined; // a database opened under the other name is left alone, not reused
}
const BOOKS = "2d6:books";
const CONTENT = "2d6:content";
const PAGES = "2d6:pages";
const PROGRESS = "2d6:progress";
const ALL = [BOOKS, CONTENT, PAGES, PROGRESS];

const wrap = (e: unknown): StoreError => {
  if (e instanceof StoreError) return e;
  const name = (e as { name?: string } | null)?.name;
  return new StoreError(name === "QuotaExceededError" ? "quota" : "unavailable", e);
};

let dbp: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("indexedDB is not available"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(BOOKS, { keyPath: "slug" });
        db.createObjectStore(CONTENT, { keyPath: "id" });
        db.createObjectStore(PAGES); // key: `${book}/${page}`
        db.createObjectStore(PROGRESS); // key: slug
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbp = undefined;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
      req.onblocked = () => reject(new Error("indexedDB open blocked"));
    }).catch((e) => {
      dbp = undefined;
      throw e;
    });
  }
  return dbp;
}

const runVoid = (stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest | undefined): Promise<void> =>
  run<unknown>(stores, mode, fn).then(() => undefined);

/** Run `fn` in one transaction; resolves with the request it returns once the transaction commits. */
async function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest | undefined): Promise<T> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let req: IDBRequest | undefined;
      tx.oncomplete = () => resolve(req?.result as T);
      tx.onerror = (ev) => reject(tx.error ?? (ev.target as IDBRequest | null)?.error ?? new Error("transaction failed"));
      tx.onabort = () => reject(tx.error ?? req?.error ?? new Error("transaction aborted"));
      try {
        req = fn(tx);
        if (req) req.onerror = () => reject(req!.error);
      } catch (e) {
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(e);
      }
    });
  } catch (e) {
    throw wrap(e);
  }
}

export const putBook = (rec: BookRecord): Promise<void> =>
  runVoid([BOOKS], "readwrite", (tx) => tx.objectStore(BOOKS).put(rec));
export const getBooks = (): Promise<BookRecord[]> =>
  run<BookRecord[]>([BOOKS], "readonly", (tx) => tx.objectStore(BOOKS).getAll());

export const putSections = (list: StoredSection[]): Promise<void> =>
  runVoid([CONTENT], "readwrite", (tx) => {
    const os = tx.objectStore(CONTENT);
    let last: IDBRequest | undefined;
    for (const s of list) last = os.put({ id: s.section.id, section: s.section, unverified: s.unverified });
    return last;
  });
export const getSections = async (): Promise<StoredSection[]> => {
  const rows = await run<{ section: Section; unverified: string[] }[]>([CONTENT], "readonly", (tx) => tx.objectStore(CONTENT).getAll());
  return rows.map((r) => ({ section: r.section, unverified: r.unverified }));
};

export const putPage = (book: string, page: number, blob: Blob): Promise<void> =>
  runVoid([PAGES], "readwrite", (tx) => tx.objectStore(PAGES).put(blob, `${book}/${page}`));
export const getPage = (book: string, page: number): Promise<Blob | undefined> =>
  run<Blob | undefined>([PAGES], "readonly", (tx) => tx.objectStore(PAGES).get(`${book}/${page}`));

export const putProgress = (slug: string, p: Progress): Promise<void> =>
  runVoid([PROGRESS], "readwrite", (tx) => tx.objectStore(PROGRESS).put(p, slug));
export const getProgress = (slug: string): Promise<Progress | undefined> =>
  run<Progress | undefined>([PROGRESS], "readonly", (tx) => tx.objectStore(PROGRESS).get(slug));

let epoch = 0;
/**
 * Bumped synchronously by every forgetAll() in this JS realm. A running import compares it before each
 * write and stops once it has changed, so a Lock during an import leaves none of its later writes behind.
 * Same realm only: the counter lives in this module instance, so a forgetAll() on the main thread does not
 * bump the import Worker's copy. Cross-realm, ui/books.ts cancels the Worker and waits for it before locking.
 */
export const storeEpoch = (): number => epoch;

/** Delete everything unlocked on this device. */
export const forgetAll = (): Promise<void> => {
  epoch++;
  return runVoid(ALL, "readwrite", (tx) => {
    let last: IDBRequest | undefined;
    for (const n of ALL) last = tx.objectStore(n).clear();
    return last;
  });
};

export async function persist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) === true;
  } catch {
    return false;
  }
}
