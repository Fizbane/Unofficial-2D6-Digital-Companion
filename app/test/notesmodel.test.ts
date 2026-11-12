import { describe, it, expect } from "vitest";
import { addNote, deleteNote, editNote, emptyNotes, isNotesState, newestFirst, noteFromCard, noteTime, roomForNotes } from "../src/shell/notesmodel";
import { newMap, type MapRoom } from "../src/tools/dmap";

describe("notes state", () => {
  it("validates the saved shape", () => {
    expect(isNotesState({ v: 1, entries: [] })).toBe(true);
    expect(isNotesState({ v: 1, entries: [{ at: 1, text: "x" }] })).toBe(true);
    expect(isNotesState({ v: 2, entries: [] })).toBe(false);
    expect(isNotesState({ v: 1, entries: [{ at: "1", text: "x" }] })).toBe(false);
    expect(isNotesState({ v: 1, entries: [null] })).toBe(false);
    expect(isNotesState({ v: 1 })).toBe(false);
    expect(isNotesState(null)).toBe(false);
  });

  it("adds trimmed notes and ignores blank ones", () => {
    const s = emptyNotes();
    expect(addNote(s, "  Found a key  ", 10)).toBe(true);
    expect(addNote(s, "   ", 11)).toBe(false);
    expect(s.entries).toEqual([{ at: 10, text: "Found a key" }]);
  });

  it("edits, deletes on blank edit, and deletes", () => {
    const s = emptyNotes();
    addNote(s, "a", 1);
    addNote(s, "b", 2);
    addNote(s, "c", 3);
    editNote(s, 1, " B ");
    expect(s.entries.map((e) => e.text)).toEqual(["a", "B", "c"]);
    editNote(s, 0, "");
    expect(s.entries.map((e) => e.text)).toEqual(["B", "c"]);
    deleteNote(s, 1);
    deleteNote(s, 5);
    expect(s.entries).toEqual([{ at: 2, text: "B" }]);
  });

  it("lists newest first with indexes", () => {
    const s = emptyNotes();
    addNote(s, "a", 1);
    addNote(s, "b", 2);
    expect(newestFirst(s)).toEqual([{ i: 1, entry: { at: 2, text: "b" } }, { i: 0, entry: { at: 1, text: "a" } }]);
  });
});

describe("noteFromCard", () => {
  it("joins eyebrow, title and text", () => {
    expect(noteFromCard({ eyebrow: "ENAT1 - Encounters", title: "Goblin", text: "Roll on HST1" })).toBe("ENAT1 - Encounters: Goblin — Roll on HST1");
  });
  it("omits the text part when empty", () => {
    expect(noteFromCard({ eyebrow: "2D6", title: "7", text: "" })).toBe("2D6: 7");
  });
});

describe("noteTime", () => {
  it("shows the time today and the date before that", () => {
    const now = new Date(2026, 10, 10, 18, 0).getTime();
    expect(noteTime(new Date(2026, 10, 10, 9, 5).getTime(), now)).toBe("09:05");
    expect(noteTime(new Date(2026, 10, 3, 14, 30).getTime(), now)).toBe("3 Nov 14:30");
  });
});

describe("roomForNotes", () => {
  const room = (id: number): MapRoom => ({ id, n: id, x: 0, y: 0, w: 2, h: 2, kind: "regular", label: `R${id}`, sub: "" });
  it("prefers the room in progress, else the newest room", () => {
    const m = { ...newMap(1), rooms: [room(1), room(2), room(3)] };
    expect(roomForNotes(m, { mapRoom: 2 })?.id).toBe(2);
    expect(roomForNotes(m, null)?.id).toBe(3);
    expect(roomForNotes(m, { mapRoom: 99 })?.id).toBe(3);
    expect(roomForNotes(newMap(1), null)).toBeUndefined();
    expect(roomForNotes(undefined, null)).toBeUndefined();
  });
});
