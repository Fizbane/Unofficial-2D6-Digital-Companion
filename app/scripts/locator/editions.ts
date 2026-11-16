// The PDF editions the locator reads (from books/), and the free Codex fingerprints.
export type LockedBook = "codex" | "realm" | "companions" | "lairs" | "legendary" | "void" | "palbot" | "pirates";
/** `rotatePages`: pages the reference edition itself is shown turned by `rotate` (sideways table scans). */
export interface EditionFile { book: LockedBook; id: string; file: string; rotate?: number; rotatePages?: number[] }

/** The first edition of each book is the reference frame: skeleton boxes and Locs are in its page coordinates. */
export const EDITIONS: EditionFile[] = [
  { book: "codex", id: "tablet", file: "2D6_Dungeon_Tables_Codex_Backers_Version_for_Tablet.pdf" },
  { book: "codex", id: "backers", file: "2D6_Dungeon_Tables_Codex_Backers_Version.pdf", rotate: 90 },
  { book: "realm", id: "v1", file: "2D6RealmVersion1.pdf" },
  // Expansions. Lairs and Legendary print their table runs sideways: build.py lists those pages (rotate_pages)
  // per book in skeleton.json, and the locator reads them turned upright.
  { book: "companions", id: "v1", file: "2D6_Animal_Companions_An_expansion_for_2D6_Dungeon.pdf" },
  { book: "lairs", id: "v1", file: "2D6_Dungeon_Lairs_Omnibus.pdf", rotate: 90 },
  { book: "legendary", id: "v1", file: "2D6_Legendary_Dungeon_An_Expansion_for_2D6_Dungeon.pdf", rotate: 90 },
];

/**
 * 2D6 Void (a paid game, so no free edition): its core rulebook and its two expansions. The table pages are printed sideways; the
 * build lists them in skeleton-void.json (rotatePages) and the locator reads them turned upright.
 */
export const VOID_EDITIONS: EditionFile[] = [
  { book: "void", id: "core", file: "2D6_Void_A_Sci_Fi_Dungeon_Crawler.pdf", rotate: 90 },
  // Void expansions. Space Pirates prints its tables sideways (rotate_pages in books.py, per book in the skeleton).
  { book: "palbot", id: "v1", file: "PAL_BOT_A_2D6_Void_Expansion.pdf" },
  { book: "pirates", id: "v1", file: "Space_Pirates_A_2D6_Void_Expansion.pdf", rotate: 90 },
];

/** Each locked book's product name in the manifest (and in "Open your <name> PDF to unlock"). */
export const BOOK_NAME: Record<LockedBook, string> = {
  codex: "Tables Codex", realm: "Realm", companions: "Animal Companions", lairs: "Lairs Omnibus",
  legendary: "Legendary Dungeon", void: "2D6 Void",
  palbot: "PAL-BOT", pirates: "Space Pirates",
};

/** The free Codex PDF (never in the repo): its content is already in free.json. */
export const FREE_FP: Record<string, string[]> = {
  codex: ["393b841ef700f333e8478dee14847bdf792923fda719fe7b639f45c1faed8bd2"],
};
