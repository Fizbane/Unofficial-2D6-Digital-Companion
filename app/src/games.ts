// The games the companion holds: 2D6 Dungeon (with Realm) and 2D6 Void. They share nothing but the
// shell: each has its own library file, play tools, themes, map styles, portraits, sounds and saved
// state. The current game is read once at boot from "2d6:game"; switching saves it and reloads, so
// every module can pick its game's lists at load time.

export type GameId = "dungeon" | "void";

export interface GameInfo {
  id: GameId;
  name: string;
  /** Header logo (public/). */
  logo: string;
  logoAlt: string;
  /** Library built by `pipeline/build.py --game <id>`. */
  libraryUrl: string;
  /** Example table code for the search tip. */
  exampleCode: string;
}

export const GAMES: Record<GameId, GameInfo> = {
  dungeon: { id: "dungeon", name: "2D6 Dungeon", logo: "logo.png", logoAlt: "2D6 Dungeon Compatible", libraryUrl: "data/library.json", exampleCode: "ENAT1" },
  void: { id: "void", name: "2D6 Void", logo: "logo-void.png", logoAlt: "2D6 Void", libraryUrl: "data/library-void.json", exampleCode: "IAUT1" },
};
export const GAME_IDS = Object.keys(GAMES) as GameId[];

export const GAME_KEY = "2d6:game";

export const isGameId = (v: unknown): v is GameId => typeof v === "string" && v in GAMES;

function readGame(): GameId {
  try {
    const v = globalThis.localStorage?.getItem(GAME_KEY);
    return isGameId(v) ? v : "dungeon";
  } catch {
    return "dungeon";
  }
}

let current: GameId = readGame();

export const gameId = (): GameId => current;
export const game = (): GameInfo => GAMES[current];
export const isVoid = () => current === "void";

/** Pick a value by game: `byGame({ dungeon: A, void: B })`. */
export const byGame = <T>(v: Record<GameId, T>): T => v[current];

/** Keys that stay shared between games: the game choice itself, shell prefs (sound levels,
 *  backdrop) and the panel layout. */
const SHARED = new Set([GAME_KEY, "2d6:shell:prefs", "2d6:shell:layout", "2d6:shell:backup", "2d6:shell:tutorial", "2d6:shell:playlist"]);

/** The storage key for `key` in a given game: "2d6:x" for Dungeon (so old saves load), "2d6v:x" for Void. */
export function keyFor(key: string, g: GameId): string {
  if (g === "dungeon" || SHARED.has(key) || !key.startsWith("2d6:")) return key;
  return "2d6v:" + key.slice(4);
}

/** The storage key for `key` in the current game. */
export const gk = (key: string): string => keyFor(key, current);

/** Is this raw storage key part of the app's saved data (either game)? */
export const isAppKey = (k: string) => k.startsWith("2d6:") || k.startsWith("2d6v:");

/** For tests: pretend the current game is `g` (no storage write, no reload). */
export function _setGameForTest(g: GameId) {
  current = g;
}

/** Save the game choice and reload into its dashboard. */
export function switchGame(g: GameId) {
  if (g === current) {
    location.hash = "#/";
    return;
  }
  try {
    localStorage.setItem(GAME_KEY, g);
  } catch {
    /* blocked storage: the reload falls back to Dungeon */
  }
  location.hash = "#/";
  location.reload();
}

/** Mark the document with the game so stylesheets can switch fonts and art. */
export function markDocument(doc: Document = document) {
  doc.documentElement.dataset.game = current;
}
