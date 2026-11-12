// Session notes model: timestamped entries kept in "2d6:notes" ({ v: 1, entries }), oldest first.
// DOM-free so it can be tested; the Notes panel renders it.
import { gk } from "../games";
import type { DungeonMap, MapRoom } from "../tools/dmap";

export const NOTES_KEY = gk("2d6:notes");

export interface NoteEntry { at: number; text: string }
export interface NotesState { v: 1; entries: NoteEntry[] }

export const emptyNotes = (): NotesState => ({ v: 1, entries: [] });

export function isNotesState(v: unknown): v is NotesState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return s.v === 1 && Array.isArray(s.entries) &&
    s.entries.every((e) => !!e && typeof e === "object" && typeof (e as NoteEntry).at === "number" && typeof (e as NoteEntry).text === "string");
}

/** Append a note (trimmed). Returns false, changing nothing, when the text is blank. */
export function addNote(s: NotesState, text: string, now: number = Date.now()): boolean {
  const t = text.trim();
  if (!t) return false;
  s.entries.push({ at: now, text: t });
  return true;
}

/** Change the text of entry i (index into s.entries); blank text deletes it. */
export function editNote(s: NotesState, i: number, text: string): void {
  if (!s.entries[i]) return;
  const t = text.trim();
  if (t) s.entries[i].text = t;
  else s.entries.splice(i, 1);
}

export function deleteNote(s: NotesState, i: number): void {
  if (s.entries[i]) s.entries.splice(i, 1);
}

/** Entries newest first, each with its index into s.entries. */
export function newestFirst(s: NotesState): { i: number; entry: NoteEntry }[] {
  return s.entries.map((entry, i) => ({ i, entry })).reverse();
}

/** The session-log line for a result card: "<eyebrow>: <title> — <text>" (no " — " part without text). */
export function noteFromCard(c: { eyebrow: string; title: string; text: string }): string {
  return `${c.eyebrow}: ${c.title}${c.text ? ` — ${c.text}` : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14:05" for today, "3 Nov 14:05" for an earlier day (local time). */
export function noteTime(at: number, now: number = Date.now()): string {
  const d = new Date(at), n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hm : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
}

/** The room "This room" edits: the room in progress, else the newest room on the map. */
export function roomForNotes(map: DungeonMap | undefined, current: { mapRoom?: number } | null): MapRoom | undefined {
  if (!map?.rooms.length) return undefined;
  const id = current?.mapRoom;
  return (id !== undefined ? map.rooms.find((r) => r.id === id) : undefined) ?? map.rooms[map.rooms.length - 1];
}
