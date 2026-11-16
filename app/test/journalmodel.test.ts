import { describe, it, expect } from "vitest";
import { addRoom, doorCheckType, newMap, placeEntrance, placeEntranceExits, type DungeonMap } from "../src/tools/dmap";
import type { JournalRoomEvent } from "../src/shell/events";
import {
  capJournal, deleteEntry, editEntryText, emptyJournal, isJournalState, journalView, levelUpCheck, normalizeJournal, recordDoor, recordFight, recordLevelUp, recordMilestone,
  recordAchievement, recordRealm, recordRoom, roomKey, setAddition, setStairs, MAX_ENTRIES, type JournalEntry, type JournalState, type RoomData,
} from "../src/shell/journalmodel";
import { milestoneStory, roomStory } from "../src/shell/journalprose";

const snapOf = (e: JournalEntry) => (e.kind === "room" ? e.snap : undefined);
const roomOf = (e: JournalEntry) => (e.kind === "fight" ? e.room : undefined);

const ctx = (at: number) => ({ at, date: "Year 837 Month 3" });

function mapWithEntrance(): { m: DungeonMap; id: number } {
  const m = newMap(1);
  const p = placeEntrance(m, 3, 2)!;
  const r = addRoom(m, { n: 1, ...p, kind: "entrance", label: "Entrance Room", sub: "" });
  placeEntranceExits(m, r);
  return { m, id: r.id };
}
const roomEv = (o: Partial<JournalRoomEvent> & { n: number }): JournalRoomEvent => ({ phase: "start", level: 1, kind: "regular", w: 3, h: 3, ...o });

describe("journal state", () => {
  it("validates the saved shape (bad means empty)", () => {
    expect(isJournalState(emptyJournal())).toBe(true);
    expect(isJournalState({ v: 1, chapters: [], entries: [], nextChapter: 1, run: 0 })).toBe(true);
    expect(isJournalState({ v: 2, chapters: [], entries: [] })).toBe(false);
    expect(normalizeJournal({ v: 1, chapters: [], entries: [{ id: 1 }], nextChapter: 1, run: 0 } as never).entries).toEqual([]);
    expect(normalizeJournal({ v: 1, chapters: [{}], entries: [], nextChapter: 1, run: 0 } as never).chapters).toEqual([]);
    expect(isJournalState({ v: 1, chapters: [], entries: [], nextChapter: Infinity, run: 0 })).toBe(false);
    expect(isJournalState(null)).toBe(false);
  });
});

describe("rooms", () => {
  it("starts a chapter when the level-1 entrance is rolled, and keys rooms by run and number", () => {
    const s = emptyJournal();
    const { m, id } = mapWithEntrance();
    const key = recordRoom(s, roomEv({ n: 1, kind: "entrance", w: 3, h: 2, map: m, mapRoom: id }), ctx(10))!;
    expect(s.chapters).toHaveLength(1);
    expect(s.chapters[0]).toMatchObject({ n: 1, level: 1, date: "Year 837 Month 3" });
    expect(key).toBe(roomKey(s.run, 1));
    const e = s.entries[0];
    expect(e.kind).toBe("room");
    expect(e.chapter).toBe(s.chapters[0].id);
    expect((e.data as RoomData).exits).toHaveLength(3);
    expect(snapOf(e)?.focus).toBe(id);
  });

  it("upserts by key: an update merges new facts and keeps the creation time", () => {
    const s = emptyJournal();
    const { m, id } = mapWithEntrance();
    recordRoom(s, roomEv({ n: 1, kind: "entrance", map: m, mapRoom: id }), ctx(10));
    recordRoom(s, roomEv({ n: 2, map: m }), ctx(20));
    recordRoom(s, roomEv({ phase: "update", n: 2, title: "GUARD ROOM", description: "Dust and old bones." }), ctx(30));
    recordRoom(s, roomEv({ phase: "update", n: 2, encounter: "Bog Brawler" }), ctx(40));
    recordRoom(s, roomEv({ phase: "update", n: 2, encounter: "Bog Brawler" }), ctx(41));

    expect(s.entries).toHaveLength(2);
    const e = s.entries[1];
    expect(e.at).toBe(20);
    expect(e.data).toMatchObject({ n: 2, title: "GUARD ROOM", description: "Dust and old bones.", encounters: ["Bog Brawler"] });
  });

  it("keeps the player's edited text when updates arrive, but still updates the facts", () => {
    const s = emptyJournal();
    const key = recordRoom(s, roomEv({ n: 4 }), ctx(1))!;
    editEntryText(s, key, "  My own words.  ");
    recordRoom(s, roomEv({ phase: "update", n: 4, title: "LIBRARY" }), ctx(2));
    const e = s.entries[0];
    expect(e.edited).toBe(true);
    expect(e.text).toBe("My own words.");
    expect((e.data as RoomData).title).toBe("LIBRARY");
    editEntryText(s, key, "   "); // blank: back to the generated story
    expect(e.edited).toBeUndefined();
    expect(e.text).toBeUndefined();
  });

  it("freezes the picture on Finish: later map changes don't reach it", () => {
    const s = emptyJournal();
    const { m, id } = mapWithEntrance();
    recordRoom(s, roomEv({ n: 1, kind: "entrance", map: m, mapRoom: id }), ctx(1));
    recordRoom(s, roomEv({ phase: "finish", n: 1, kind: "entrance", map: m, mapRoom: id }), ctx(2));
    const snapBefore = JSON.stringify(snapOf(s.entries[0]));
    m.rooms[0].label = "Renamed";
    recordRoom(s, roomEv({ phase: "update", n: 1, kind: "entrance", map: m, mapRoom: id }), ctx(3));
    expect(JSON.stringify(snapOf(s.entries[0]))).toBe(snapBefore);
    expect((s.entries[0].data as RoomData).final).toBe(true);
  });

  it("a discarded room disappears unless the player wrote in it", () => {
    const s = emptyJournal();
    recordRoom(s, roomEv({ n: 3 }), ctx(1));
    recordRoom(s, roomEv({ phase: "discard", n: 3 }), ctx(2));
    expect(s.entries).toHaveLength(0);
    const k = recordRoom(s, roomEv({ n: 3 }), ctx(3))!;
    setAddition(s, k, "Keep this");
    recordRoom(s, roomEv({ phase: "discard", n: 3 }), ctx(4));
    expect(s.entries).toHaveLength(1);
  });

  it("a new map (room 1 again) is a new run, so rooms don't collide; an empty chapter is reused", () => {
    const s = emptyJournal();
    recordRoom(s, roomEv({ n: 1, kind: "entrance" }), ctx(1));
    recordRoom(s, roomEv({ n: 2 }), ctx(2));
    recordRoom(s, roomEv({ n: 1, kind: "entrance", level: 2 }), ctx(3)); // descended: same chapter
    expect(s.chapters).toHaveLength(1);
    expect(s.entries.map((e) => e.id)).toEqual([roomKey(1, 1), roomKey(1, 2), roomKey(2, 1)]);
    recordRoom(s, roomEv({ phase: "discard", n: 1, level: 2 }), ctx(4));
    recordRoom(s, roomEv({ n: 1, kind: "entrance" }), ctx(5)); // fresh dungeon: chapter 2
    expect(s.chapters.map((c) => c.n)).toEqual([1, 2]);
    s.entries = s.entries.filter((e) => e.chapter !== s.chapters[1].id);
    recordRoom(s, roomEv({ n: 1, kind: "entrance" }), ctx(6)); // chapter 2 had nothing left: reused
    expect(s.chapters.map((c) => c.n)).toEqual([1, 2]);
  });

  it("marks the stairs on the room that holds them", () => {
    const s = emptyJournal();
    recordRoom(s, roomEv({ n: 1, kind: "entrance" }), ctx(1));
    recordRoom(s, roomEv({ n: 2 }), ctx(2));
    setStairs(s, 2);
    expect((s.entries[1].data as RoomData).stairs).toBe(true);
    setStairs(s, 1);
    expect((s.entries[1].data as RoomData).stairs).toBeUndefined();
    expect((s.entries[0].data as RoomData).stairs).toBe(true);
  });
});

describe("fights, milestones, realm", () => {
  it("a fight attaches to the room in progress and collects XP and loot", () => {
    const s = emptyJournal();
    const room = recordRoom(s, roomEv({ n: 2 }), ctx(1))!;
    recordFight(s, { phase: "end", outcome: "won", foes: ["Bog Brawler"], rounds: 3, xp: 8 }, ctx(2), room);
    recordFight(s, { phase: "xp", xp: 8 }, ctx(3));
    recordFight(s, { phase: "loot", text: "TCT1: A silver ring" }, ctx(4));
    const f = s.entries[1];
    expect(f.kind).toBe("fight");
    expect(roomOf(f)).toBe(room);
    expect(f.data).toMatchObject({ outcome: "won", foes: ["Bog Brawler"], rounds: 3, xp: 8, banked: 8, loot: ["TCT1: A silver ring"] });
    const view = journalView(s);
    expect(view[0].entries).toHaveLength(1); // the fight is shown inside its room
    expect(view[0].entries[0].fights.map((x) => x.id)).toEqual([f.id]);
  });

  it("XP or loot with no fight recorded is ignored", () => {
    const s = emptyJournal();
    recordFight(s, { phase: "xp", xp: 3 }, ctx(1));
    expect(s.entries).toHaveLength(0);
  });

  it("records milestones and a level-up", () => {
    const s = emptyJournal();
    recordMilestone(s, { kind: "descend", from: 1, to: 2 }, ctx(1));
    recordLevelUp(s, 2, "Squire", ctx(2));
    expect(s.entries.map((e) => e.kind)).toEqual(["milestone", "milestone"]);
    expect(s.chapters).toHaveLength(1); // made on demand
  });

  it("realm events of a month gather into one month entry", () => {
    const s = emptyJournal();
    recordRealm(s, { kind: "plot", year: 837, month: 3, tag: "4FO", land: "Forest", type: "Area", size: 4, owner: "", claimed: true }, ctx(1));
    recordRealm(s, { kind: "event", year: 837, month: 3, title: "RMEVT1", text: "A bountiful harvest" }, ctx(2));
    recordRealm(s, { kind: "month", year: 837, month: 3 }, ctx(3));
    expect(s.entries).toHaveLength(2);
    expect(s.entries[1].data).toMatchObject({ kind: "month", year: 837, month: 3, ended: true, events: [{ title: "RMEVT1", text: "A bountiful harvest" }] });
  });
});

describe("delete and cap", () => {
  it("deleting a room keeps its fights as standalone entries", () => {
    const s = emptyJournal();
    const room = recordRoom(s, roomEv({ n: 2 }), ctx(1))!;
    recordFight(s, { phase: "end", outcome: "lost", foes: ["Rat"], rounds: 1, xp: 1 }, ctx(2), room);
    deleteEntry(s, room);
    expect(s.entries).toHaveLength(1);
    expect(roomOf(s.entries[0])).toBeUndefined();
  });

  it(`keeps the newest ${MAX_ENTRIES} entries and drops chapters left empty`, () => {
    const s: JournalState = emptyJournal();
    recordMilestone(s, { kind: "leave", level: 1 }, ctx(0));
    recordRoom(s, roomEv({ n: 1, kind: "entrance" }), ctx(1)); // chapter 2
    for (let i = 0; i < MAX_ENTRIES + 5; i++) recordMilestone(s, { kind: "rest", ration: true, hp: 2 }, ctx(10 + i));
    capJournal(s);
    expect(s.entries).toHaveLength(MAX_ENTRIES);
    expect(s.entries[0].at).toBe(15);
    expect(s.chapters.map((c) => c.n)).toEqual([2]);
  });
});

/** Entrance (room 1) and room 2 through its north archway; room 2 has a wooden door east. */
function twoRooms() {
  const s = emptyJournal();
  const { m, id } = mapWithEntrance();
  recordRoom(s, roomEv({ n: 1, kind: "entrance", map: m, mapRoom: id }), ctx(1));
  recordRoom(s, roomEv({ phase: "finish", n: 1, kind: "entrance", map: m, mapRoom: id }), ctx(2));
  const north = m.exits.find((e) => e.room === id && e.side === "N")!;
  const r2 = addRoom(m, { n: 2, x: north.x - 1, y: north.y - 3, w: 3, h: 3, kind: "regular", label: "Guard Room", sub: "" });
  north.to = r2.id;
  const east = { id: m.nextId++, room: r2.id, side: "E" as const, x: r2.x + 3, y: r2.y + 1, type: "wooden" as const };
  m.exits.push(east);
  recordRoom(s, roomEv({ n: 2, map: m, mapRoom: r2.id }), ctx(3));
  recordRoom(s, roomEv({ phase: "finish", n: 2, map: m, mapRoom: r2.id }), ctx(4));
  return { s, m, entrance: id, r2: r2.id, east };
}
const roomEntry = (s: JournalState, n: number) => s.entries.find((e) => e.kind === "room" && e.data.n === n) as Extract<JournalEntry, { kind: "room" }>;

describe("door checks", () => {
  it("attach to the room that owns the exit (even when finished), name the door and its side, and mark the picture", () => {
    const { s, r2 } = twoRooms();
    recordRoom(s, roomEv({ n: 3 }), ctx(5)); // a later room is in progress
    const id = recordDoor(s, { level: 1, room: r2, side: "E", type: "wooden", check: "door", ok: false });
    const e2 = roomEntry(s, 2);
    expect(id).toBe(e2.id);
    expect(roomEntry(s, 3).data.doors ?? []).toHaveLength(0);
    expect(roomStory(e2.id, e2.data).body).toContain("The wooden door to the east is locked.");
    expect(e2.snap!.exits.find((x) => x.room === r2 && x.side === "E")!.locked).toBe(true);
    expect(e2.data.exits.find((x) => x.side === "E")!.locked).toBe(true);
  });

  it("append, so a locked door and then a picked lock both read", () => {
    const { s, r2 } = twoRooms();
    recordDoor(s, { level: 1, room: r2, side: "E", type: "wooden", check: "door", ok: false });
    recordDoor(s, { level: 1, room: r2, side: "E", type: "wooden", check: "pick", ok: true });
    const e2 = roomEntry(s, 2);
    expect(e2.data.doors).toHaveLength(2);
    const body = roomStory(e2.id, e2.data).body;
    expect(body).toContain("The wooden door to the east is locked.");
    expect(body).toMatch(/lock on the wooden door to the east gives way/);
    expect(e2.snap!.exits.find((x) => x.side === "E")!.locked).toBeUndefined();
  });

  it("phrase slabs and portcullises by side, and ignore a room with no entry", () => {
    const { s, r2, entrance } = twoRooms();
    recordDoor(s, { level: 1, room: entrance, side: "W", type: "slab", check: "slab", ok: true });
    recordDoor(s, { level: 1, room: r2, side: "E", type: "portcullis", check: "portcullis", ok: true, detail: "The lever jams" });
    expect(roomStory("a", roomEntry(s, 1).data).body).toContain("The stone slab to the west tips over.");
    expect(roomStory("b", roomEntry(s, 2).data).body).toContain("At the portcullis to the east: The lever jams.");
    expect(recordDoor(s, { level: 1, room: 999, side: "E", type: "wooden", check: "door", ok: true })).toBeUndefined();
  });
});

describe("door check types and wording", () => {
  it("a door check takes the exit's door type, else the door kind that was rolled", () => {
    expect(doorCheckType("wooden", "metal")).toBe("wooden"); // both doors: the map's exit wins
    expect(doorCheckType("archway", "metal")).toBe("metal"); // not a door on the map: the roll says what it is
    expect(doorCheckType("unknown", "reinforced")).toBe("reinforced");
    expect(doorCheckType("curtain")).toBe("curtain"); // no kind (a pick): unchanged
  });

  it("a pick on a non-door exit takes the type of the latest door check on that side", () => {
    const { s, entrance } = twoRooms();
    recordDoor(s, { level: 1, room: entrance, side: "N", type: "metal", check: "door", ok: false });
    recordDoor(s, { level: 1, room: entrance, side: "N", type: "archway", check: "pick", ok: true });
    const e = roomEntry(s, 1);
    expect(e.data.doors!.map((d) => d.type)).toEqual(["metal", "metal"]);
    expect(roomStory(e.id, e.data).body).toMatch(/lock on the metal door to the north gives way/);
  });

  it("the lock is told once: the exits sentence doesn't also call a checked exit locked", () => {
    const { s, r2 } = twoRooms();
    recordDoor(s, { level: 1, room: r2, side: "E", type: "wooden", check: "door", ok: false });
    const e2 = roomEntry(s, 2);
    const body = roomStory(e2.id, e2.data).body;
    expect(body.match(/locked/g)).toHaveLength(1);
    expect(body).toContain("The wooden door to the east is locked.");
    expect(body).toMatch(/A wooden door to the east leads on/);
  });
});

describe("stairs after Finish", () => {
  it("patch the finished room's picture", () => {
    const { s, r2 } = twoRooms();
    setStairs(s, 2);
    expect(roomEntry(s, 2).snap!.stairs).toBe(r2);
    setStairs(s, null);
    expect(roomEntry(s, 2).snap!.stairs).toBeUndefined();
  });
});

describe("normalizeJournal", () => {
  it("drops malformed entries and chapters but keeps good ones", () => {
    const { s } = twoRooms();
    recordFight(s, { phase: "end", outcome: "won", foes: ["Rat"], rounds: 2, xp: 1 }, ctx(9));
    const good = s.entries.length;
    const bad: unknown[] = [
      { id: "room:9:9", kind: "room", at: 1, chapter: 1, data: { level: 1, n: 9, kind: "regular", w: 2, h: 2, encounters: [] } }, // no exits
      { id: "x", kind: "fight", at: Infinity, chapter: 1, data: { outcome: "won", foes: [], rounds: 1, xp: 1, loot: [] } },
      { id: "y", kind: "milestone", at: 1, chapter: 1, data: { kind: "teleport" } },
      { id: "z", kind: "realm", at: 1, chapter: 1, data: { kind: "month", year: 837, month: 3, events: [{ title: 1 }], ended: true } },
      { id: "w", kind: "room", at: 1, chapter: 1, data: { level: 1, n: 2, kind: "regular", w: 2, h: 2, exits: [], encounters: [] }, snap: { w: 20, h: 20, box: [0, 0], focus: "<b>", rooms: [], exits: [] } },
      { id: "v", kind: "room", at: 1, chapter: 1, addition: 5, data: { level: 1, n: 2, kind: "regular", w: 2, h: 2, exits: [], encounters: [] } },
      null,
    ];
    const raw = JSON.parse(JSON.stringify({ ...s, entries: [...s.entries, ...bad], chapters: [...s.chapters, { id: "2" }] }));
    expect(isJournalState(raw)).toBe(true); // the top-level shape is fine…
    const n = normalizeJournal(raw);
    expect(n.entries).toHaveLength(good); // …the bad entries are dropped
    expect(n.chapters).toHaveLength(1);
  });
});

describe("normalizeJournal and 2D6 Void", () => {
  it("keeps a room whose exits are Void door types", () => {
    const s = emptyJournal();
    const { m, id } = mapWithEntrance();
    m.exits.forEach((e, i) => (e.type = (["sliding", "security", "biocoded", "barrier", "secret"] as const)[i % 5]));
    recordRoom(s, roomEv({ n: 1, kind: "entrance", w: 3, h: 2, map: m, mapRoom: id }), ctx(10));
    expect(m.exits.length).toBeGreaterThan(0);
    const n = normalizeJournal(JSON.parse(JSON.stringify(s)));
    expect(n.entries).toHaveLength(s.entries.length);
  });
});

describe("levelUpCheck", () => {
  it("logs a one-level rise from play, not imports, new characters or a correction round trip", () => {
    const t = { seen: 1 };
    expect(levelUpCheck(t, 2, "combat")).toBe(true);
    expect(levelUpCheck(t, 1, "strip")).toBe(false); // corrected down…
    expect(levelUpCheck(t, 2, "strip")).toBe(false); // …and back up: already logged
    expect(levelUpCheck(t, 3, "sheet")).toBe(true);
    expect(levelUpCheck(t, 6, "sheet-import")).toBe(false); // an import resets the baseline
    expect(levelUpCheck(t, 7, "combat")).toBe(true);
    expect(levelUpCheck(t, 1, "sheet-new")).toBe(false);
    expect(levelUpCheck(t, 3, "strip")).toBe(false); // two levels at once: a correction, not play
    expect(levelUpCheck(t, 4, "combat")).toBe(true);
  });
});

describe("achievement entries", () => {
  it("records an unlock in the current chapter, validates and tells it", () => {
    const s = emptyJournal();
    const id = recordAchievement(s, "boxcars", "Boxcars", ctx(1));
    const e = s.entries.find((x) => x.id === id)!;
    expect(e).toMatchObject({ kind: "milestone", data: { kind: "achievement", id: "boxcars", title: "Boxcars" } });
    expect(normalizeJournal(s).entries).toHaveLength(1);
    expect(normalizeJournal({ ...s, entries: [{ ...e, data: { kind: "achievement", id: 3 } } as never] }).entries).toHaveLength(0);
    if (e.kind === "milestone") expect(milestoneStory(e.id, e.data).body).toContain("Boxcars");
  });
});
