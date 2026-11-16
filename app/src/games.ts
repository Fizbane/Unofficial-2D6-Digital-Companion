// The games the companion holds: 2D6 Dungeon (with Realm) and 2D6 Void. They share nothing but the
// shell: each has its own library file, play tools, themes, map styles, portraits, sounds and saved
// state. The current game is read once at boot from "2d6:game"; switching saves it and reloads, so
// every module can pick its game's lists at load time. Each game keeps a roster of characters
// (rostermodel.ts); the active one is picked here too, and gk() puts per-character keys in its slot.
import { bootRoster, charBase, isCharBase, ROSTER_BASE, type Roster } from "./rostermodel";

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

/** The raw prefix of a game's keys. */
export const gamePrefix = (g: GameId): string => (g === "dungeon" ? "2d6:" : "2d6v:");

/** The game key for `key` (no character scoping): "2d6:x" for Dungeon, "2d6v:x" for Void. */
const gameKey = (key: string, g: GameId): string => {
  if (g === "dungeon" || SHARED.has(key) || !key.startsWith("2d6:")) return key;
  return "2d6v:" + key.slice(4);
};

let activeChar: string | null = null;

/**
 * The storage key for `key` in a given game: "2d6:x" for Dungeon, "2d6v:x" for Void. A
 * per-character key (play state, journal, notes, rolls, tabs) goes in the character's slot,
 * "2d6:c:<id>:x"; `char` defaults to the active character (null: unscoped).
 */
export function keyFor(key: string, g: GameId, char: string | null = g === current ? activeChar : null): string {
  return gameKey(char && isCharBase(key) ? charBase(key, char) : key, g);
}

/** The storage key for `key` in the current game. */
export const gk = (key: string): string => keyFor(key, current);

/** Is this raw storage key part of the app's saved data (either game)? */
export const isAppKey = (k: string) => k.startsWith("2d6:") || k.startsWith("2d6v:");

/** For tests: pretend the current game is `g` (no storage write, no reload). */
export function _setGameForTest(g: GameId) {
  current = g;
}

/** The storage key of a game's roster. */
export const rosterKey = (g: GameId = current): string => gameKey(ROSTER_BASE, g);

function bootCharacter(): Roster | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const { roster, active } = bootRoster(ls, gamePrefix(current), new Date().toISOString());
    activeChar = active;
    return roster;
  } catch {
    return null;
  }
}
bootCharacter();

/** The character being played in the current game (null when storage couldn't hold a roster). */
export const charId = (): string | null => activeChar;

/** For tests: pretend the active character is `id`. */
export function _setCharForTest(id: string | null) {
  activeChar = id;
}

/** Make `id` the active character of the current game and reload into it, at `route` if it has no saved tabs. */
export function switchCharacter(id: string, route = "#/") {
  try {
    const r = JSON.parse(localStorage.getItem(rosterKey()) ?? "null") as Roster | null;
    const c = r?.chars.find((x) => x.id === id);
    if (!r || !c) return;
    r.active = id;
    c.lastPlayed = new Date().toISOString();
    localStorage.setItem(rosterKey(), JSON.stringify(r));
  } catch {
    return;
  }
  // no hashchange: the tabs of the character being left stay as they were; the next one opens its own (or Home)
  history.replaceState(null, "", location.pathname + location.search + route);
  location.reload();
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
