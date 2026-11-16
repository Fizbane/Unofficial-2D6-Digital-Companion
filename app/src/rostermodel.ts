// The character roster: each game keeps several characters, and each one has its own copy of the
// per-character saved state (sheet, dungeon or hulk, fight, realm, journal, notes, rolls, tabs).
// That state sits under "<game>c:<id>:…" ("2d6:c:c-ab12cd:play:character", Void "2d6v:c:…"); the
// roster itself is "<game>roster". Pure, with no imports, because games.ts runs boot() while it loads.

export interface RosterEntry {
  id: string;
  /** ISO timestamps. */
  created: string;
  lastPlayed: string;
}
export interface Roster {
  v: 1;
  active: string;
  chars: RosterEntry[];
}

export interface KeyStore {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const ROSTER_BASE = "2d6:roster";
export const CHAR_ID = /^c-[a-z0-9]{4,12}$/;

const CHAR_BASES = new Set(["2d6:journal", "2d6:notes", "2d6:shell:results", "2d6:shell:tabs"]);
/** Does this base key ("2d6:…", before the game prefix) belong to a character? */
export const isCharBase = (base: string): boolean => base.startsWith("2d6:play:") || CHAR_BASES.has(base);

/** "2d6:play:x" → "2d6:c:<id>:play:x" (still a base key: keyFor adds the game prefix). */
export const charBase = (base: string, id: string): string => `2d6:c:${id}:${base.slice(4)}`;

/** The raw storage prefix of a character's slot in a game whose keys start with `game` ("2d6:" or "2d6v:"). */
export const slotPrefix = (game: string, id: string): string => `${game}c:${id}:`;

export function newCharId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)];
  return `c-${s}`;
}

const isIso = (x: unknown): x is string => typeof x === "string" && x.length <= 40 && !Number.isNaN(Date.parse(x));

/** A roster from storage, or an empty one for anything that isn't one. Duplicate and bad ids are dropped. */
export function normalizeRoster(x: unknown): Roster {
  const out: Roster = { v: 1, active: "", chars: [] };
  if (!x || typeof x !== "object") return out;
  const r = x as Partial<Roster>;
  const seen = new Set<string>();
  for (const c of Array.isArray(r.chars) ? r.chars : []) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !CHAR_ID.test(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    const created = isIso(c.created) ? c.created : new Date(0).toISOString();
    out.chars.push({ id: c.id, created, lastPlayed: isIso(c.lastPlayed) ? c.lastPlayed : created });
  }
  out.active = typeof r.active === "string" && seen.has(r.active) ? r.active : "";
  return out;
}

const keysOf = (s: KeyStore): string[] => {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k !== null) out.push(k);
  }
  return out;
};

/** The unscoped per-character keys of a game (saves from before the roster, or an old backup). */
export const legacyKeys = (s: KeyStore, game: string): string[] =>
  keysOf(s).filter((k) => k.startsWith(game) && !k.startsWith(game + "c:") && isCharBase("2d6:" + k.slice(game.length)));

/** Every key in one character's slot. */
export const slotKeys = (s: KeyStore, game: string, id: string): string[] => keysOf(s).filter((k) => k.startsWith(slotPrefix(game, id)));

/** Character ids that have saved keys in this game. */
export function slotIds(s: KeyStore, game: string): string[] {
  const ids = new Set<string>();
  const re = new RegExp(`^${game.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}c:(c-[a-z0-9]{4,12}):`);
  for (const k of keysOf(s)) {
    const m = k.match(re);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/** Copy `pairs` (from → to) and remove the sources. All or nothing: on a failed write the copies are removed again. */
function moveKeys(s: KeyStore, pairs: [string, string][]): boolean {
  const written: string[] = [];
  try {
    for (const [from, to] of pairs) {
      const v = s.getItem(from);
      if (v === null) continue;
      s.setItem(to, v);
      written.push(to);
    }
  } catch {
    for (const k of written) {
      try {
        s.removeItem(k);
      } catch {
        /* nothing more to do */
      }
    }
    return false;
  }
  for (const [from] of pairs) s.removeItem(from);
  return true;
}

export interface BootResult {
  roster: Roster;
  /** The character to play, or null when storage can't hold a slot (play then uses the unscoped keys). */
  active: string | null;
}

/**
 * Bring a game's roster up to date with what is in storage, then pick the character to play:
 * unscoped per-character keys are moved into a new character (the save from before rosters, or an
 * old backup just imported, which then becomes the active one); slots with no roster entry (a
 * merged backup) are listed; an empty roster gets a blank character.
 */
export function bootRoster(s: KeyStore, game: string, now: string, makeId: () => string = newCharId): BootResult {
  const rosterKey = game + ROSTER_BASE.slice(4);
  let raw: unknown;
  try {
    raw = JSON.parse(s.getItem(rosterKey) ?? "null");
  } catch {
    raw = null;
  }
  const r = normalizeRoster(raw);
  const before = JSON.stringify(r);
  const ids = new Set(r.chars.map((c) => c.id));
  const fresh = (): string => {
    let id = makeId();
    while (ids.has(id)) id = makeId();
    ids.add(id);
    return id;
  };

  for (const id of slotIds(s, game))
    if (!ids.has(id)) {
      ids.add(id);
      r.chars.push({ id, created: now, lastPlayed: now });
    }

  const legacy = legacyKeys(s, game);
  if (legacy.length) {
    const id = fresh();
    const moved = moveKeys(s, legacy.map((k) => [k, slotPrefix(game, id) + k.slice(game.length)]));
    if (!moved) return { roster: r, active: null };
    r.chars.push({ id, created: now, lastPlayed: now });
    r.active = id;
  }

  if (!r.chars.length) r.chars.push({ id: fresh(), created: now, lastPlayed: now });
  if (!r.chars.some((c) => c.id === r.active)) r.active = [...r.chars].sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))[0].id;

  if (JSON.stringify(r) !== before) {
    try {
      s.setItem(rosterKey, JSON.stringify(r));
    } catch {
      /* storage full: the roster is rebuilt from the slots next time */
    }
  }
  return { roster: r, active: r.active };
}
