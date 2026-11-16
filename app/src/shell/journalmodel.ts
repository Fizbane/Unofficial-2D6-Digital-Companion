// The Journal's store: chapters and story entries kept in "2d6:journal", written automatically
// from play events (shell/journal.ts turns bus events into the record* calls here). The story
// text is generated at display time from each entry's facts (journalprose.ts); the player's edit
// (`text`, `edited`) and own words (`addition`) are kept whatever updates arrive. DOM-free.
import { gk } from "../games";
import { EXIT_TYPE_LIST, isDoor, type ExitType, type Side } from "../tools/dmap";
import type { JournalDoorEvent, JournalFightEvent, JournalMilestoneEvent, JournalRealmEvent, JournalRoomEvent } from "./events";
import { roomExits, sliceMap, type MapSnap } from "./journalsnap";

export const JOURNAL_KEY = gk("2d6:journal");
export const MAX_ENTRIES = 500;

export interface RoomData {
  level: number;
  n: number;
  kind: JournalRoomEvent["kind"];
  w: number;
  h: number;
  title?: string;
  description?: string;
  entry?: Side | null; // the wall you came in by
  via?: ExitType | "entrance"; // the doorway you came through
  exits: { side: Side; type: ExitType; locked?: true }[];
  exitsKnown?: boolean; // the number of exits has been rolled (so none means a dead end)
  encounters: string[];
  doors?: DoorFact[]; // Leave-step checks on this room's exits, oldest first
  mapRoom?: number; // the room's id on its map
  stairs?: boolean;
  final?: boolean; // Finish room: the picture is frozen
}
export type DoorFact = Omit<JournalDoorEvent, "level" | "room">;
export interface FightData { outcome: "won" | "lost"; foes: string[]; rounds: number; xp: number; banked?: number; loot: string[] }
export type MilestoneData =
  | JournalMilestoneEvent
  | { kind: "levelup"; level: number; title: string }
  | { kind: "achievement"; id: string; title: string };
export type RealmData =
  | Extract<JournalRealmEvent, { kind: "plot" }>
  | { kind: "month"; year: number; month: number; events: { title: string; text: string }[]; ended: boolean };

interface Base { id: string; at: number; chapter: number; text?: string; edited?: true; addition?: string }
export type JournalEntry =
  | (Base & { kind: "room"; data: RoomData; snap?: MapSnap })
  | (Base & { kind: "fight"; data: FightData; room?: string })
  | (Base & { kind: "milestone"; data: MilestoneData })
  | (Base & { kind: "realm"; data: RealmData });
export type EntryKind = JournalEntry["kind"];

export interface JournalChapter { id: number; n: number; at: number; level: number; date: string }
export interface JournalState { v: 1; chapters: JournalChapter[]; entries: JournalEntry[]; nextChapter: number; run: number }

/** When and "where" an event happened: `date` is the realm date (or the day) for a new chapter's title. */
export interface At { at: number; date: string }

export const emptyJournal = (): JournalState => ({ v: 1, chapters: [], entries: [], nextChapter: 1, run: 0 });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const KINDS = new Set(["room", "fight", "milestone", "realm"]);

/** The top-level shape; normalizeJournal then drops any malformed chapter or entry. */
export function isJournalState(v: unknown): v is JournalState {
  return isObj(v) && v.v === 1 && Array.isArray(v.chapters) && Array.isArray(v.entries) && num(v.nextChapter) && num(v.run);
}

// ---------- validation: a hand-edited or imported journal must not break drawing or export ----------
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
const str = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown) => v === undefined || str(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const SIDES = new Set(["N", "E", "S", "W"]);
const EXIT_TYPES = new Set<string>(EXIT_TYPE_LIST);
const ROOM_KINDS = new Set(["entrance", "corridor", "small", "regular", "large"]);
const exitOk = (x: unknown) => isObj(x) && SIDES.has(x.side as string) && EXIT_TYPES.has(x.type as string);
const doorOk = (x: unknown) => isObj(x) && exitOk(x) && ["door", "pick", "portcullis", "slab"].includes(x.check as string) && typeof x.ok === "boolean" && optStr(x.detail);

function snapOk(v: unknown): boolean {
  if (!isObj(v) || !num(v.w) || !num(v.h) || !num(v.focus) || !Array.isArray(v.box) || v.box.length !== 4 || !v.box.every(num)) return false;
  if (v.stairs !== undefined && !num(v.stairs)) return false;
  if (v.entrance !== undefined && !(Array.isArray(v.entrance) && v.entrance.length === 2 && v.entrance.every(num))) return false;
  const roomsOk = Array.isArray(v.rooms) && v.rooms.every((r) => isObj(r) && [r.id, r.n, r.x, r.y, r.w, r.h].every(num) && ROOM_KINDS.has(r.kind as string) && str(r.label));
  const exitsOk = Array.isArray(v.exits) && v.exits.every((x) => isObj(x) && exitOk(x) && num(x.room) && num(x.x) && num(x.y) && (x.to === undefined || num(x.to)));
  return roomsOk && exitsOk;
}

function dataOk(kind: unknown, d: unknown): boolean {
  if (!isObj(d)) return false;
  if (kind === "room")
    return [d.level, d.n, d.w, d.h].every(num) && ROOM_KINDS.has(d.kind as string) && Array.isArray(d.exits) && d.exits.every(exitOk) && strs(d.encounters) &&
      optStr(d.title) && optStr(d.description) && (d.doors === undefined || (Array.isArray(d.doors) && d.doors.every(doorOk))) && (d.mapRoom === undefined || num(d.mapRoom));
  if (kind === "fight")
    return (d.outcome === "won" || d.outcome === "lost") && strs(d.foes) && num(d.rounds) && num(d.xp) && strs(d.loot) && (d.banked === undefined || num(d.banked));
  if (kind === "milestone")
    return d.kind === "descend" ? num(d.from) && num(d.to)
      : d.kind === "rest" ? typeof d.ration === "boolean" && num(d.hp)
        : d.kind === "leave" ? num(d.level)
          : d.kind === "levelup" ? num(d.level) && str(d.title)
            : d.kind === "achievement" ? str(d.id) && str(d.title) : false;
  if (kind === "realm")
    return d.kind === "plot"
      ? [d.year, d.month, d.size].every(num) && str(d.tag) && str(d.land) && str(d.owner) && typeof d.claimed === "boolean" && optStr(d.type) && optStr(d.encounter)
      : d.kind === "month" && num(d.year) && num(d.month) && typeof d.ended === "boolean" && Array.isArray(d.events) && d.events.every((x) => isObj(x) && str(x.title) && str(x.text));
  return false;
}

/** Is `e` a well-formed entry (every field the panel and export read)? */
export function isJournalEntry(e: unknown): e is JournalEntry {
  return isObj(e) && str(e.id) && num(e.at) && num(e.chapter) && KINDS.has(e.kind as string) && optStr(e.text) && optStr(e.addition) &&
    dataOk(e.kind, e.data) && (e.snap === undefined || (e.kind === "room" && snapOk(e.snap))) && (e.room === undefined || str(e.room));
}
const chapterOk = (c: unknown): c is JournalChapter => isObj(c) && num(c.id) && num(c.n) && num(c.at) && num(c.level) && str(c.date);

/** Keep only well-formed chapters and entries (a bad backup loses those, not the whole journal). */
export function normalizeJournal(s: JournalState): JournalState {
  return { ...s, chapters: s.chapters.filter(chapterOk), entries: s.entries.filter(isJournalEntry) };
}

// ---------- level-ups ----------
/** Saves of the character made by play (Combat, the sheet's XP field, the character bar). */
export const LEVEL_UP_SOURCES: ReadonlySet<string> = new Set(["combat", "sheet", "strip", "vsheet", "vcombat", "vhulk"]);

/**
 * Should a level-up entry be written? `t.seen` is the highest level already accounted for. Only a
 * one-level rise above it, saved by play, counts; any other save (an import, a new character)
 * re-bases it on the current level, and a correction back down then up again isn't logged twice.
 */
export function levelUpCheck(t: { seen: number }, level: number, source: string): boolean {
  if (!LEVEL_UP_SOURCES.has(source)) {
    t.seen = level;
    return false;
  }
  if (level <= t.seen) return false;
  const one = level === t.seen + 1;
  t.seen = level;
  return one;
}

export const roomKey = (run: number, n: number) => `room:${run}:${n}`;
const find = (s: JournalState, id: string) => s.entries.find((e) => e.id === id);
const lastChapter = (s: JournalState) => s.chapters[s.chapters.length - 1];

/** Open a new chapter, or retitle the newest one when nothing has been written in it yet. */
export function startChapter(s: JournalState, level: number, c: At): JournalChapter {
  const last = lastChapter(s);
  if (last && !s.entries.some((e) => e.chapter === last.id)) {
    Object.assign(last, { at: c.at, level, date: c.date });
    return last;
  }
  const n = (last?.n ?? 0) + 1;
  const ch: JournalChapter = { id: s.nextChapter++, n, at: c.at, level, date: c.date };
  s.chapters.push(ch);
  return ch;
}
const chapterFor = (s: JournalState, level: number, c: At) => lastChapter(s) ?? startChapter(s, level, c);

let uid = 0;
const newId = (kind: string, at: number) => `${kind}:${at.toString(36)}:${(uid++).toString(36)}`;

/** Record a room event. Returns the room entry's id (undefined when a discard removed it). */
export function recordRoom(s: JournalState, ev: JournalRoomEvent, c: At): string | undefined {
  if (ev.phase === "start" && ev.n === 1) {
    s.run++; // a new map: room numbers start again
    if (ev.level === 1 && ev.kind === "entrance") startChapter(s, 1, c);
  }
  const id = roomKey(s.run, ev.n);
  let e = find(s, id) as Extract<JournalEntry, { kind: "room" }> | undefined;
  if (ev.phase === "discard") {
    if (e && !e.edited && !e.addition) deleteEntry(s, id);
    return find(s, id) ? id : undefined;
  }
  if (!e) {
    e = { id, kind: "room", at: c.at, chapter: chapterFor(s, ev.level, c).id, data: { level: ev.level, n: ev.n, kind: ev.kind, w: ev.w, h: ev.h, exits: [], encounters: [] } };
    s.entries.push(e);
  }
  const d = e.data;
  if (ev.phase === "start" && !d.final) {
    // a restart of the same room (re-rolled size): forget what the old roll told us
    Object.assign(d, { exits: [], encounters: [], title: undefined, description: undefined, doors: undefined, exitsKnown: undefined });
  }
  Object.assign(d, { level: ev.level, kind: ev.kind, w: ev.w, h: ev.h });
  if (ev.title !== undefined) d.title = ev.title || undefined;
  if (ev.description !== undefined) d.description = ev.description || undefined;
  if (ev.encounter && !d.encounters.includes(ev.encounter)) d.encounters.push(ev.encounter);
  if (ev.mapRoom !== undefined) d.mapRoom = ev.mapRoom;
  if (ev.map && ev.mapRoom !== undefined && !d.final) {
    const x = roomExits(ev.map, ev.mapRoom);
    d.entry = x.entry;
    d.via = x.via;
    d.exits = x.exits;
    if (ev.kind === "entrance" || x.exits.length) d.exitsKnown = true;
    const snap = sliceMap(ev.map, ev.mapRoom);
    if (snap) e.snap = snap;
    d.stairs = ev.map.stairs === ev.mapRoom || undefined;
  }
  if (ev.exitsKnown) d.exitsKnown = true;
  if (ev.phase === "finish") d.final = true;
  return id;
}

/** The stairs are now in room `n` of the current run (null: nowhere). Finished pictures get just this one fact. */
export function setStairs(s: JournalState, n: number | null): void {
  const prefix = `room:${s.run}:`;
  for (const e of s.entries) {
    if (e.kind !== "room" || !e.id.startsWith(prefix)) continue;
    const here = e.data.n === n;
    if (here) e.data.stairs = true;
    else delete e.data.stairs;
    if (!e.snap) continue;
    if (here) e.snap.stairs = e.snap.focus;
    else if (e.snap.stairs === e.snap.focus) delete e.snap.stairs;
  }
}

/**
 * A door / lock / slab / portcullis check on an exit: added to the entry of the room that owns the
 * exit (finished or not), and the exit's lock is updated in its facts and picture. Returns that
 * entry's id, or undefined when the room has no entry in the current run.
 */
export function recordDoor(s: JournalState, ev: JournalDoorEvent): string | undefined {
  const prefix = `room:${s.run}:`;
  const e = s.entries.find((x): x is Extract<JournalEntry, { kind: "room" }> => x.kind === "room" && x.id.startsWith(prefix) && x.data.mapRoom === ev.room);
  if (!e) return undefined;
  const doors = (e.data.doors ??= []);
  // a lock picked on an exit the map doesn't call a door: it is the door checked there before
  const before = ev.check === "pick" && !isDoor(ev.type) ? [...doors].reverse().find((f) => f.side === ev.side && isDoor(f.type)) : undefined;
  const fact: DoorFact = { side: ev.side, type: before?.type ?? ev.type, check: ev.check, ok: ev.ok, ...(ev.detail ? { detail: ev.detail } : {}) };
  const last = doors[doors.length - 1];
  if (!last || JSON.stringify(last) !== JSON.stringify(fact)) doors.push(fact);
  const lock = ev.check === "door" ? !ev.ok : ev.check === "pick" && ev.ok ? false : undefined;
  if (lock !== undefined) {
    const own = e.data.exits.filter((x) => x.side === ev.side);
    const pic = e.snap?.exits.filter((x) => x.room === ev.room && x.side === ev.side) ?? [];
    for (const x of [...own, ...pic]) {
      if (lock) x.locked = true;
      else delete x.locked;
    }
  }
  return e.id;
}

/** Record the end of a fight, or the XP / loot that came after it (added to the newest fight). */
export function recordFight(s: JournalState, ev: JournalFightEvent, c: At, roomId?: string): string | undefined {
  if (ev.phase === "end") {
    const room = roomId && find(s, roomId)?.kind === "room" ? roomId : undefined;
    const level = room ? (find(s, room)!.data as RoomData).level : 1;
    const e: JournalEntry = { id: newId("fight", c.at), kind: "fight", at: c.at, chapter: chapterFor(s, level, c).id, data: { outcome: ev.outcome, foes: ev.foes, rounds: ev.rounds, xp: ev.xp, loot: [] }, ...(room ? { room } : {}) };
    s.entries.push(e);
    return e.id;
  }
  const f = [...s.entries].reverse().find((e): e is Extract<JournalEntry, { kind: "fight" }> => e.kind === "fight");
  if (!f) return undefined;
  if (ev.phase === "xp") f.data.banked = ev.xp;
  else if (ev.text.trim()) f.data.loot.push(ev.text.trim());
  return f.id;
}

export function recordMilestone(s: JournalState, ev: JournalMilestoneEvent, c: At): string {
  const level = ev.kind === "descend" ? ev.to : ev.kind === "leave" ? ev.level : (lastChapter(s)?.level ?? 1);
  const e: JournalEntry = { id: newId("milestone", c.at), kind: "milestone", at: c.at, chapter: chapterFor(s, level, c).id, data: ev };
  s.entries.push(e);
  return e.id;
}

export function recordLevelUp(s: JournalState, level: number, title: string, c: At): string {
  const e: JournalEntry = { id: newId("milestone", c.at), kind: "milestone", at: c.at, chapter: chapterFor(s, 1, c).id, data: { kind: "levelup", level, title } };
  s.entries.push(e);
  return e.id;
}

/** An achievement unlocked: a line in the current chapter. */
export function recordAchievement(s: JournalState, id: string, title: string, c: At): string {
  const e: JournalEntry = { id: newId("milestone", c.at), kind: "milestone", at: c.at, chapter: chapterFor(s, lastChapter(s)?.level ?? 1, c).id, data: { kind: "achievement", id, title } };
  s.entries.push(e);
  return e.id;
}

/** Record a realm event: a plot explored, or a month's events (one entry per month). */
export function recordRealm(s: JournalState, ev: JournalRealmEvent, c: At): string {
  if (ev.kind === "plot") {
    const e: JournalEntry = { id: newId("realm", c.at), kind: "realm", at: c.at, chapter: chapterFor(s, 1, c).id, data: { ...ev } };
    s.entries.push(e);
    return e.id;
  }
  const id = `month:${ev.year}:${ev.month}`;
  let e = find(s, id) as Extract<JournalEntry, { kind: "realm" }> | undefined;
  if (!e) {
    e = { id, kind: "realm", at: c.at, chapter: chapterFor(s, 1, c).id, data: { kind: "month", year: ev.year, month: ev.month, events: [], ended: false } };
    s.entries.push(e);
  }
  const d = e.data;
  if (d.kind === "month") {
    if (ev.kind === "event") d.events.push({ title: ev.title, text: ev.text });
    else d.ended = true;
  }
  return id;
}

/** Replace the story with the player's own text; blank text goes back to the generated story. */
export function editEntryText(s: JournalState, id: string, text: string): void {
  const e = find(s, id);
  if (!e) return;
  const t = text.trim();
  if (t) {
    e.text = t;
    e.edited = true;
  } else {
    delete e.text;
    delete e.edited;
  }
}

/** The player's own words under the story (blank removes them). */
export function setAddition(s: JournalState, id: string, text: string): void {
  const e = find(s, id);
  if (!e) return;
  const t = text.trim();
  if (t) e.addition = t;
  else delete e.addition;
}

/** Delete an entry; fights that were shown inside a deleted room become entries of their own. */
export function deleteEntry(s: JournalState, id: string): void {
  s.entries = s.entries.filter((e) => e.id !== id);
  for (const e of s.entries) if (e.kind === "fight" && e.room === id) delete e.room;
}

/** Keep the newest MAX_ENTRIES entries; drop chapters left with nothing (except the newest). */
export function capJournal(s: JournalState): void {
  if (s.entries.length > MAX_ENTRIES) {
    const keep = new Set([...s.entries].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES));
    s.entries = s.entries.filter((e) => keep.has(e));
    const ids = new Set(s.entries.map((e) => e.id));
    for (const e of s.entries) if (e.kind === "fight" && e.room && !ids.has(e.room)) delete e.room;
  }
  const used = new Set(s.entries.map((e) => e.chapter));
  const last = lastChapter(s);
  s.chapters = s.chapters.filter((c) => used.has(c.id) || c === last);
}

export interface ViewEntry { entry: JournalEntry; fights: JournalEntry[] }
export interface ViewChapter { chapter: JournalChapter; entries: ViewEntry[] }

/** Chapters oldest first, each with its entries oldest first; a room's fights are listed inside it. */
export function journalView(s: JournalState): ViewChapter[] {
  const ids = new Set(s.entries.map((e) => e.id));
  const inside = (e: JournalEntry) => e.kind === "fight" && !!e.room && ids.has(e.room);
  const byAt = [...s.entries].sort((a, b) => a.at - b.at);
  return s.chapters
    .map((chapter) => ({
      chapter,
      entries: byAt
        .filter((e) => e.chapter === chapter.id && !inside(e))
        .map((entry) => ({ entry, fights: byAt.filter((f) => f.kind === "fight" && f.room === entry.id) })),
    }))
    .filter((c) => c.entries.length);
}
