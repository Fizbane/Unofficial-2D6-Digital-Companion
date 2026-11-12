// The content gateway: every view reads book content through here. Free content comes from free.json,
// locked books are only a text-free manifest until the owner unlocks them from their own PDF.
// 2D6 Void is a paid game with no free content: it has its own manifest (data/manifest-void.json) and every
// section is locked until the owner opens their rulebook PDF. In development only, data/library-void.json (a
// local build output of the whole book) is also read, so the Void tools can be worked on without importing
// the PDF; the dist check fails a build that would ship it.
import type { Book, Section } from "./types";
import { applyFixes, getFixes } from "./fixes";
import { game, isVoid } from "./games";
import { validateManifest, type Manifest } from "./lock/manifest";
import { StoreError, forgetAll, getBooks, getSections, putSections, useGameStore, type StoredSection } from "./lock/store";

export interface Locked { book: string; bookName: string; page: number }
export type ContentResult =
  | { ok: true; section: Section; unverified?: ReadonlySet<string> }
  | { ok: false; locked: Locked };

interface FreeData { books: (Book & { free?: boolean })[]; sections: Section[] }

let man: Manifest | undefined;
let freeBooks_: FreeData["books"] = [];
let free = new Map<string, Section>();
let unlocked = new Map<string, { section: Section; unverified: Set<string> }>();
let skel = new Map<string, Manifest["sections"][number]>();
let codes = new Map<string, string>();
let available = true;
/** `removed`: content may have gone (a Lock, or a reload of the store), so nothing locked may stay on screen. */
export interface ContentChange { removed: boolean }
const listeners = new Set<(c: ContentChange) => void>();

const fire = (removed: boolean) => {
  const c: ContentChange = { removed };
  for (const fn of [...listeners]) if (listeners.has(fn)) fn(c); // one removed by an earlier listener is skipped
};

export async function initContent(fetchJson: (path: string) => Promise<unknown> = (p) => fetch(p).then((r) => {
  if (!r.ok) throw new Error(`failed to load ${p}: ${r.status}`);
  return r.json();
})): Promise<void> {
  if (isVoid()) return initVoid(fetchJson);
  useGameStore("dungeon");
  const m = validateManifest(await fetchJson("data/manifest.json"));
  const f = (await fetchJson("data/free.json")) as FreeData;
  await install(m, f);
}

/** Shows the manifest, the free sections and whatever the owner has already unlocked on this device. */
async function install(m: Manifest, f: FreeData): Promise<void> {
  let stored: StoredSection[] = [];
  available = true;
  try {
    // Only books whose import finished (a BookRecord) are shown. A run that stopped part-way leaves its
    // finished sections in the store for the resume, hidden until the book completes.
    const done = new Set((await getBooks()).map((b) => b.slug));
    stored = (await getSections()).filter((s) => done.has(s.section.book));
  } catch (e) {
    if (!(e instanceof StoreError)) throw e;
    available = false; // no storage: run on free content only
  }
  // Fixes change the in-memory copies only: the stored sections (read fresh above) are never written back.
  const fixes = getFixes();
  applyFixes(f.sections, fixes);
  applyFixes(stored.map((s) => s.section), fixes);

  man = m;
  freeBooks_ = f.books;
  free = new Map(f.sections.map((s) => [s.id, s]));
  skel = new Map(m.sections.map((s) => [s.id, s]));
  unlocked = new Map(stored.map((s) => [s.section.id, { section: s.section, unverified: new Set(s.unverified) }]));
  codes = new Map();
  for (const s of f.sections)
    for (const b of s.blocks) if (b.type === "table" && b.table.code) codes.set(b.table.code.toUpperCase(), s.id);
  for (const [c, id] of Object.entries(m.codes)) codes.set(c.toUpperCase(), id); // locked codes
  fire(true);
}

/** True when the Void library loaded with sections (false in Dungeon). The Void tools check it to explain an empty library. */
let voidLoaded = false;
export const voidLibraryLoaded = (): boolean => voidLoaded;
/** True when a Void book is available on this device: the local library build, or (once imported) the owner's PDF. */
export const voidBookLoaded = (): boolean => voidLoaded || unlocked.size > 0;

/**
 * 2D6 Void: its own manifest (every section locked) plus whatever the owner has unlocked from their PDF on this
 * device (Void's own database: the Dungeon's books are never shown here). In development only, the local
 * library build is also read as free sections. Fixes apply as in Dungeon, to the in-memory copies.
 */
async function initVoid(fetchJson: (path: string) => Promise<unknown>): Promise<void> {
  useGameStore("void");
  let m: Manifest = { version: 1, books: [], sections: [], codes: {} };
  try {
    m = validateManifest(await fetchJson("data/manifest-void.json"));
  } catch {
    console.warn("2D6 Void: data/manifest-void.json is not available, so there is no book to unlock (build it with npm run locator -- --game void)");
  }
  let f: FreeData = { books: [], sections: [] };
  if (!import.meta.env?.PROD) {
    try {
      const j = (await fetchJson(game().libraryUrl)) as Partial<FreeData> | null;
      if (j && Array.isArray(j.books) && Array.isArray(j.sections)) f = { books: j.books, sections: j.sections };
    } catch {
      /* not built (the usual case): Void then needs the owner's PDF */
    }
  }
  voidLoaded = f.sections.length > 0;
  await install(m, f);
}

/** The book list from free.json (titles, page scans), for every book it names. */
export const freeBooks = (): readonly Book[] => freeBooks_;

/** False when the device store could not be read at startup (only free content is available). */
export const storeAvailable = (): boolean => available;

export function manifest(): Manifest {
  if (!man) throw new Error("content not initialised");
  return man;
}

const bookName = (slug: string) =>
  manifest().books.find((b) => b.slug === slug)?.name ?? freeBooks_.find((b) => b.slug === slug)?.title ?? slug;

/** Undefined when the id is not in free content, the unlocked set or the manifest. */
export function getContent(id: string): ContentResult | undefined {
  const f = free.get(id);
  if (f) return { ok: true, section: f };
  const u = unlocked.get(id);
  if (u) return { ok: true, section: u.section, unverified: u.unverified.size ? new Set(u.unverified) : undefined };
  const sk = skel.get(id);
  if (sk) return { ok: false, locked: { book: sk.book, bookName: bookName(sk.book), page: sk.pages[0] ?? 1 } };
  return undefined;
}

/** Free and unlocked ids, each once (the dev library and an imported book can hold the same Void ids). */
export const sectionIds = (): string[] => [...new Set([...free.keys(), ...unlocked.keys()])];

export function isLocked(id: string): boolean {
  return skel.has(id) && !unlocked.has(id);
}

/** A book's locked section with the lowest page, while any of the book is still locked. */
export function firstLocked(book: string): string | undefined {
  let best: Manifest["sections"][number] | undefined;
  for (const s of skel.values())
    if (s.book === book && !unlocked.has(s.id) && (!best || (s.pages[0] ?? Infinity) < (best.pages[0] ?? Infinity))) best = s;
  return best?.id;
}

export function bookInfo(slug: string): { slug: string; name: string; free: boolean; unlocked: boolean } {
  const b = manifest().books.find((x) => x.slug === slug);
  const isUnlocked = [...unlocked.values()].some((u) => u.section.book === slug);
  return { slug, name: bookName(slug), free: b?.free ?? freeBooks_.find((x) => x.slug === slug)?.free ?? false, unlocked: isUnlocked };
}

/** Table code to section id: free codes plus the manifest's locked codes. */
export const codeTarget = (code: string): string | undefined => codes.get(code.toUpperCase());

/** A write was refused because the books were locked after the operation that made it began. */
export class LockedDuringImport extends Error {
  constructor() {
    super("the books were locked during the import");
    this.name = "LockedDuringImport";
  }
}

let generation = 0;
const inflight = new Set<Promise<unknown>>();
/**
 * The lock generation, bumped synchronously when lockAll() starts. An operation that will end in addUnlocked
 * captures it when it begins and passes it as `since`, so a Lock pressed in between refuses its write.
 */
export const lockGeneration = (): number => generation;

/**
 * Stores sections (as given: no fixes in them) and shows them, with the saved fixes applied to the in-memory
 * copies only. Throws LockedDuringImport, writing nothing to memory, if a lock began after `since` (default:
 * now). A lock waits for any addUnlocked in flight before it clears the store, so no write lands after it.
 */
export async function addUnlocked(list: StoredSection[], o: { since?: number } = {}): Promise<void> {
  const since = o.since ?? generation;
  if (since !== generation) throw new LockedDuringImport();
  const write = putSections(list);
  inflight.add(write);
  try {
    await write;
  } finally {
    inflight.delete(write);
  }
  if (since !== generation) throw new LockedDuringImport();
  const mem = structuredClone(list);
  applyFixes(mem.map((s) => s.section), getFixes());
  for (const s of mem) unlocked.set(s.section.id, { section: s.section, unverified: new Set(s.unverified) });
  fire(false);
}

/** Applies the saved fixes again to what is shown (fixes pasted, restored or remapped since startup). In memory only. */
export function refreshFixes(): void {
  applyFixes([...free.values(), ...[...unlocked.values()].map((u) => u.section)], getFixes());
  fire(false);
}

/**
 * Forgets every unlocked book. The generation is bumped first, so nothing begun before this call can still be
 * added; then `before` runs (Books stops its import Worker and waits for a pack import), then every addUnlocked
 * in flight is waited for, and only then is the store cleared. Throws a StoreError if it can't be cleared.
 */
export async function lockAll(before?: () => Promise<void>): Promise<void> {
  generation++;
  try {
    await before?.();
  } finally {
    await Promise.allSettled([...inflight]);
  }
  await forgetAll();
  unlocked = new Map();
  fire(true);
}

export function onContentChange(fn: (c: ContentChange) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
