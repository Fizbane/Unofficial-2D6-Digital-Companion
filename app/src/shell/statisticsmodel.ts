// Statistics: how play has gone, counted from the journal and dice events. The store is per game
// (shell/statistics.ts keys it with gk), so Dungeon and Void keep their own numbers. Pure and DOM-free:
// the recorder feeds events in through the on*() reducers and saves the result. Foes defeated stands
// in for player deaths, and dice are counted as totals and doubles only.
//
// An adventure ends on death (the dungeon starts over): a monster attack that takes you to 0 HP, or an
// RFUT1 result that says the adventure is over. In Void the Escape Pod also ends it. Leaving by an exit
// shaft in the Dungeon keeps your progress, so it does not end an adventure. A companion that takes the killing blow saves you; that is
// onStatSaved, which reopens the adventure the lost fight just ended.
import type { JournalFightEvent, JournalRoomEvent } from "./events";

/** The base key; the recorder stores it per game through gk(). */
export const STATS_KEY = "2d6:stats";

/** The last this many adventures are kept, newest first. */
export const MAX_PAST = 20;

/** The largest time a JavaScript Date (and so the page's date format) can hold. */
const MAX_TIME = 8.64e15;

/** One delve: from its first recorded event until it ends in death. `endedAt` is 0 while it is open. */
export interface Adventure { id: number; startedAt: number; endedAt: number; rooms: number; fights: number; foesDefeated: number; deepest: number; how?: "death" | "escape" }

export interface StatsState {
  v: 1;
  totals: Record<string, number>; // rooms, roomsKind:<kind>, fightsWon, fightsLost, foesDefeated, longestFight, dice, doubles, adventures
  roomTypes: Record<string, number>; // ROOM TYPE table result -> count
  foes: Record<string, number>; // foe name -> times defeated
  current: Adventure | null; // the open adventure, null between adventures
  past: Adventure[]; // newest first, capped at MAX_PAST; each one ended in death or by the Escape Pod
  nextId: number;
  pendingSave: number | null; // id of the adventure a lost fight just ended, until a companion saves you (or it stays ended)
}

export const emptyStats = (): StatsState => ({ v: 1, totals: {}, roomTypes: {}, foes: {}, current: null, past: [], nextId: 1, pendingSave: null });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const okTime = (v: unknown): v is number => num(v) && Math.abs(v) <= MAX_TIME;

const isAdventure = (v: unknown): v is Adventure =>
  isObj(v) && num(v.id) && okTime(v.startedAt) && okTime(v.endedAt) && num(v.rooms) && num(v.fights) && num(v.foesDefeated) && num(v.deepest);

export function isStatsState(v: unknown): v is StatsState {
  return isObj(v) && v.v === 1 && isObj(v.totals) && isObj(v.roomTypes) && isObj(v.foes) && Array.isArray(v.past) && num(v.nextId);
}

/** Keep only non-negative numbers and well-formed adventures (a hand-edited backup can't break the page). */
export function normalizeStats(s: StatsState): StatsState {
  const nums = (src: Record<string, unknown>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(src)) if (num(v) && v >= 0) out[k] = v;
    return out;
  };
  const past = s.past.filter(isAdventure).slice(0, MAX_PAST);
  const current = isAdventure(s.current) ? s.current : null;
  const maxId = Math.max(0, ...past.map((a) => a.id), current?.id ?? 0);
  const pendingSave = num(s.pendingSave) && past[0]?.id === s.pendingSave ? s.pendingSave : null;
  return {
    v: 1,
    totals: nums(s.totals),
    roomTypes: nums(s.roomTypes),
    foes: nums(s.foes),
    current,
    past,
    nextId: Math.max(s.nextId, maxId + 1),
    pendingSave,
  };
}

const bump = (rec: Record<string, number>, key: string, by = 1) => {
  rec[key] = (rec[key] ?? 0) + by;
};

/** The open adventure, started now if there is none. */
function open(s: StatsState, at: number): Adventure {
  if (!s.current) s.current = { id: s.nextId++, startedAt: at, endedAt: 0, rooms: 0, fights: 0, foesDefeated: 0, deepest: 0 };
  return s.current;
}

/** End the open adventure, if there is one. Returns the ended adventure's id. */
function end(s: StatsState, at: number, how: "death" | "escape"): number | null {
  if (!s.current) return null;
  const done: Adventure = { ...s.current, endedAt: at, how };
  s.past = [done, ...s.past].slice(0, MAX_PAST);
  s.current = null;
  bump(s.totals, "adventures");
  return done.id;
}

/** A room the adventurer has finished exploring (phase "finish"; other phases are ignored). */
export function onStatRoom(s: StatsState, ev: JournalRoomEvent, at: number): void {
  if (ev.phase !== "finish") return;
  const a = open(s, at);
  a.rooms++;
  a.deepest = Math.max(a.deepest, ev.level);
  bump(s.totals, "rooms");
  bump(s.totals, `roomsKind:${ev.kind}`);
  if (ev.title) bump(s.roomTypes, ev.title);
}

/**
 * A fight that has ended. Foes defeated are counted only on a win. A loss is a death, unless a
 * companion takes the killing blow (onStatSaved): until then the adventure stays ended, pending.
 */
export function onStatFight(s: StatsState, ev: JournalFightEvent, at: number): void {
  if (ev.phase !== "end") return;
  const a = open(s, at);
  a.fights++;
  if (ev.outcome === "lost") {
    bump(s.totals, "fightsLost");
    s.pendingSave = end(s, at, "death");
    return;
  }
  bump(s.totals, "fightsWon");
  bump(s.totals, "foesDefeated", ev.foes.length);
  a.foesDefeated += ev.foes.length;
  for (const name of ev.foes) bump(s.foes, name);
  s.totals.longestFight = Math.max(s.totals.longestFight ?? 0, ev.rounds);
}

/** A death from a table result: RFUT1 says the adventure is over. Cannot be saved. */
export function onStatDeath(s: StatsState, at: number): void {
  end(s, at, "death");
  s.pendingSave = null;
}

/** The Escape Pod (Void): the adventure ends, alive. Cannot be undone by a companion. */
export function onStatEscape(s: StatsState, at: number): void {
  end(s, at, "escape");
  s.pendingSave = null;
}

/** A companion took the killing blow: the adventure the lost fight ended is alive again. */
export function onStatSaved(s: StatsState): void {
  if (s.pendingSave === null || s.current || s.past[0]?.id !== s.pendingSave) return;
  const [a, ...rest] = s.past;
  s.past = rest;
  s.current = { ...a, endedAt: 0 };
  s.totals.adventures = Math.max(0, (s.totals.adventures ?? 0) - 1);
  s.pendingSave = null;
}

/** Any roll of the dice: every die counts; a roll of exactly two matching dice is a double. */
export function onStatDice(s: StatsState, dice: readonly number[], _at: number): void {
  bump(s.totals, "dice", dice.length);
  if (dice.length === 2 && dice[0] === dice[1]) bump(s.totals, "doubles");
}

/** A table roll that ends the adventure: RFUT1 (Recovery from Unconsciousness), results 2–5. */
export function isRfutDeath(card: { eyebrow: string; title: string; text: string }): boolean {
  return /^RFUT1\b/.test(card.eyebrow) && /adventure is over/i.test(`${card.title} ${card.text}`);
}

export interface StatsView {
  totals: Record<string, number>;
  roomTypes: [string, number][];
  foes: [string, number][];
  past: Adventure[];
  current: Adventure | null;
}

const ranked = (rec: Record<string, number>): [string, number][] => Object.entries(rec).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** What the page shows: totals as given, room types and foes highest first. */
export function statsView(s: StatsState): StatsView {
  return { totals: s.totals, roomTypes: ranked(s.roomTypes), foes: ranked(s.foes), past: s.past, current: s.current };
}
