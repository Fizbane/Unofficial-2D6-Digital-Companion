// The PDF editions the locator reads (from books/), and the free Codex fingerprints.
/** `rotatePages`: pages the reference edition itself is shown turned by `rotate` (2D6 Void's sideways table scans). */
export interface EditionFile { book: "codex" | "realm" | "void"; id: string; file: string; rotate?: number; rotatePages?: number[] }

/** The first edition of each book is the reference frame: skeleton boxes and Locs are in its page coordinates. */
export const EDITIONS: EditionFile[] = [
  { book: "codex", id: "tablet", file: "2D6_Dungeon_Tables_Codex_Backers_Version_for_Tablet.pdf" },
  { book: "codex", id: "backers", file: "2D6_Dungeon_Tables_Codex_Backers_Version.pdf", rotate: 90 },
  { book: "realm", id: "v1", file: "2D6RealmVersion1.pdf" },
];

/**
 * 2D6 Void (a paid game, so no free edition): its one core rulebook PDF. The table pages are printed sideways; the
 * build lists them in skeleton-void.json (rotatePages) and the locator reads them turned upright.
 */
export const VOID_EDITIONS: EditionFile[] = [
  { book: "void", id: "core", file: "2D6_Void_A_Sci_Fi_Dungeon_Crawler.pdf", rotate: 90 },
];

/** The free Codex PDF (never in the repo): its content is already in free.json. */
export const FREE_FP: Record<string, string[]> = {
  codex: ["393b841ef700f333e8478dee14847bdf792923fda719fe7b639f45c1faed8bd2"],
};
