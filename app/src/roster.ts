// The current game's characters: list them with a short summary read from each one's slot, create,
// delete, switch, and move one character between devices as a file. The key scheme and the boot
// migration are in rostermodel.ts; games.ts picks the active character at load.
import { charId, gamePrefix, gameId, rosterKey, switchCharacter } from "./games";
import { CHAR_ID, newCharId, normalizeRoster, slotKeys, slotPrefix, type KeyStore, type Roster } from "./rostermodel";
import { BACKUP_KEY, MAX_BACKUP_VALUE } from "./lock/backup";
import { fail, obj, opt, rec, str } from "./lock/validate";
import { safePortrait } from "./shell/charmodel";

export interface CharacterSummary {
  id: string;
  active: boolean;
  name: string;
  portrait: string;
  xp: number;
  hp: number | null;
  /** Void: the saved level and profession; Dungeon works its level out from XP. */
  level: number | null;
  profession: string;
  /** Dungeon: "constable" for the Haunted House class; absent for an adventurer. */
  cls?: "constable";
  /** The dungeon or hulk level and rooms explored, when an expedition is under way. */
  delve: { level: number; rooms: number } | null;
  journal: number;
  created: string;
  lastPlayed: string;
}

const store = (): KeyStore => localStorage;

export function readRoster(s: KeyStore = store()): Roster {
  try {
    return normalizeRoster(JSON.parse(s.getItem(rosterKey()) ?? "null"));
  } catch {
    return normalizeRoster(null);
  }
}

const writeRoster = (r: Roster, s: KeyStore = store()) => s.setItem(rosterKey(), JSON.stringify(r));

const readSlot = (s: KeyStore, id: string, rest: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(s.getItem(slotPrefix(gamePrefix(gameId()), id) + rest) ?? "null");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Every character of the current game, most recently played first. */
export function listCharacters(s: KeyStore = store()): CharacterSummary[] {
  const r = readRoster(s);
  const isVoidGame = gameId() === "void";
  return r.chars
    .map((c): CharacterSummary => {
      const sheet = readSlot(s, c.id, isVoidGame ? "play:vsheet" : "play:character") ?? {};
      const delveState = readSlot(s, c.id, isVoidGame ? "play:vhulk" : "play:dungeon");
      const rooms = Array.isArray(delveState?.rooms) ? delveState.rooms.length : Array.isArray((delveState?.map as { rooms?: unknown[] })?.rooms) ? (delveState!.map as { rooms: unknown[] }).rooms.length : 0;
      const journal = readSlot(s, c.id, "journal");
      return {
        id: c.id,
        active: c.id === charId(),
        name: typeof sheet.name === "string" ? sheet.name.trim().slice(0, 80) : "",
        portrait: safePortrait(sheet.portrait),
        xp: num(sheet.xp) ?? 0,
        hp: num(sheet.hp),
        level: isVoidGame ? num(sheet.level) : null,
        profession: isVoidGame && typeof sheet.profession === "string" ? sheet.profession : "",
        ...(!isVoidGame && sheet.class === "constable" ? { cls: "constable" as const } : {}),
        delve: rooms ? { level: num(delveState?.level) ?? 1, rooms } : null,
        journal: Array.isArray(journal?.entries) ? journal.entries.length : 0,
        created: c.created,
        lastPlayed: c.lastPlayed,
      };
    })
    .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed));
}

/**
 * Add a character and switch to it. `initial` seeds its slot, by base key without the "2d6:" prefix
 * ("play:character" → the new sheet). Returns false if storage is full.
 */
export function createCharacter(initial: Record<string, unknown> = {}, s: KeyStore = store(), go: (id: string) => void = switchCharacter): boolean {
  const r = readRoster(s);
  let id = newCharId();
  while (r.chars.some((c) => c.id === id)) id = newCharId();
  const now = new Date().toISOString();
  const prefix = slotPrefix(gamePrefix(gameId()), id);
  const written: string[] = [];
  try {
    for (const [rest, v] of Object.entries(initial)) {
      s.setItem(prefix + rest, JSON.stringify(v));
      written.push(prefix + rest);
    }
    r.chars.push({ id, created: now, lastPlayed: now });
    writeRoster(r, s);
  } catch {
    for (const k of written) s.removeItem(k);
    return false;
  }
  go(id);
  return true;
}

/** Delete a character and everything in its slot. The active character, or the last one, can't be deleted. */
export function deleteCharacter(id: string, s: KeyStore = store()): boolean {
  const r = readRoster(s);
  if (id === charId() || r.chars.length < 2 || !r.chars.some((c) => c.id === id)) return false;
  r.chars = r.chars.filter((c) => c.id !== id);
  writeRoster(r, s);
  for (const k of slotKeys(s, gamePrefix(gameId()), id)) s.removeItem(k);
  return true;
}

/**
 * Make `to` the active character and delete `drop` with everything in its slot (the gameplay tutorial's
 * survivor). The caller reloads. Returns false when `to` isn't in the roster.
 */
export function dropCharacterFor(drop: string, to: string, s: KeyStore = store()): boolean {
  const r = readRoster(s);
  if (drop === to || !r.chars.some((c) => c.id === to)) return false;
  r.chars = r.chars.filter((c) => c.id !== drop);
  r.active = to;
  writeRoster(r, s);
  for (const k of slotKeys(s, gamePrefix(gameId()), drop)) s.removeItem(k);
  return true;
}

// ---- one character as a file ----

export interface CharacterFile {
  app: "2d6-companion-character";
  game: "dungeon" | "void";
  saved?: string;
  /** The slot's keys without their "<game>c:<id>:" prefix ("play:character", "journal", …). */
  data: Record<string, string>;
}

const REST_KEY = /^[A-Za-z0-9:_-]{1,48}$/;
const fileShape = obj<{ app: string; game: string; saved?: string; data: Record<string, string> }>(
  { app: str(32, /^2d6-companion-character$/), game: str(8, /^(dungeon|void)$/), saved: opt(str(64)), data: rec(REST_KEY, str(MAX_BACKUP_VALUE), 64) },
  { extra: true },
);

export function validateCharacterFile(x: unknown): CharacterFile {
  const f = fileShape(x, "character");
  for (const k of Object.keys(f.data)) if (!BACKUP_KEY.test("2d6:c:c-abcdef:" + k)) fail(`character.data.${k}`);
  return { app: "2d6-companion-character", game: f.game as CharacterFile["game"], data: f.data };
}

/** One character's slot as a file body. */
export function characterFile(id: string, s: KeyStore = store()): CharacterFile {
  const prefix = slotPrefix(gamePrefix(gameId()), id);
  const data: Record<string, string> = {};
  for (const k of slotKeys(s, gamePrefix(gameId()), id)) {
    const v = s.getItem(k);
    if (v !== null && v.length <= MAX_BACKUP_VALUE) data[k.slice(prefix.length)] = v;
  }
  return { app: "2d6-companion-character", game: gameId(), saved: new Date().toISOString(), data };
}

/** Add a character from a file as a new entry (never over an existing one). Returns its id, or null if storage is full. */
export function importCharacterFile(f: CharacterFile, s: KeyStore = store()): string | null {
  const r = readRoster(s);
  let id = newCharId();
  while (r.chars.some((c) => c.id === id)) id = newCharId();
  const prefix = slotPrefix(gamePrefix(gameId()), id);
  const written: string[] = [];
  try {
    for (const [rest, v] of Object.entries(f.data)) {
      s.setItem(prefix + rest, v);
      written.push(prefix + rest);
    }
    const now = new Date().toISOString();
    r.chars.push({ id, created: now, lastPlayed: now });
    writeRoster(r, s);
  } catch {
    for (const k of written) s.removeItem(k);
    return null;
  }
  return id;
}

export const isCharId = (x: unknown): x is string => typeof x === "string" && CHAR_ID.test(x);
