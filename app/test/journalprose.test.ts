import { describe, it, expect } from "vitest";
import { entryStory, fightStory, milestoneStory, plainText, realmStory, roomStory, softCaps, titleCase } from "../src/shell/journalprose";
import { exportJournalHtml } from "../src/shell/journalexport";
import { raw } from "../src/ui/html";
import { emptyJournal, editEntryText, recordFight, recordRoom, setAddition, type RoomData } from "../src/shell/journalmodel";

const guard: RoomData = {
  level: 2, n: 5, kind: "regular", w: 2, h: 3, title: "GUARD ROOM", description: "Dust and old bones cover the floor.",
  entry: "N", via: "wooden", exits: [{ side: "E", type: "metal" }, { side: "S", type: "archway" }], encounters: ["Bog Brawler"],
};

describe("room story", () => {
  it("heads with the level, room and title, and tells the door, description, exits and encounter", () => {
    const s = roomStory("room:1:5", guard);
    expect(s.heading).toBe("Level 2 · Room 5 — The Guard Room");
    expect(s.body).toMatch(/wooden door/);
    expect(s.body).toMatch(/north/);
    expect(s.body).toContain("Dust and old bones cover the floor.");
    expect(s.body).toMatch(/metal door to the east/);
    expect(s.body).toMatch(/archway to the south/);
    expect(s.body).toContain("Bog Brawler");
  });

  it("is the same text every time for one id, and varies between ids", () => {
    expect(roomStory("room:1:5", guard).body).toBe(roomStory("room:1:5", guard).body);
    const bodies = new Set(Array.from({ length: 12 }, (_, i) => roomStory(`room:1:${i}`, guard).body));
    expect(bodies.size).toBeGreaterThan(1);
  });

  it("copes with a room that has nothing known yet", () => {
    const s = roomStory("room:1:2", { level: 1, n: 2, kind: "corridor", w: 1, h: 4, exits: [], encounters: [] });
    expect(s.heading).toBe("Level 1 · Room 2 — A Corridor");
    expect(s.body.length).toBeGreaterThan(10);
    expect(s.body).not.toMatch(/undefined|null|NaN/);
  });

  it("says when a room is a dead end, locked exits, the stairs and the entrance", () => {
    const dead = roomStory("x", { ...guard, exits: [], exitsKnown: true });
    expect(dead.body).toMatch(/dead end|no other way/i);
    const locked = roomStory("x", { ...guard, exits: [{ side: "W", type: "reinforced", locked: true }], stairs: true });
    expect(locked.body).toMatch(/locked reinforced door to the west/);
    expect(locked.body).toMatch(/stairs/i);
    const ent = roomStory("x", { level: 1, n: 1, kind: "entrance", w: 3, h: 2, entry: "S", via: "entrance", exits: [{ side: "N", type: "archway" }], encounters: [] });
    expect(ent.heading).toBe("Level 1 · Room 1 — The Entrance");
    expect(ent.body).toMatch(/archway to the north/);
  });

  it("title-cases the book's capitals", () => {
    expect(titleCase("MASON’S WORKSHOP")).toBe("Mason’s Workshop");
    expect(titleCase("HALL OF THE DEAD")).toBe("Hall of the Dead");
    expect(softCaps("QUIET TIMES - Mist settles in the dips.")).toBe("Quiet Times - Mist settles in the dips.");
    expect(softCaps("POTION OF PHASING")).toBe("Potion of Phasing");
    expect(softCaps("A rat, nothing more")).toBe("A rat, nothing more");
  });
});

describe("other stories", () => {
  it("fight: foes, rounds, outcome, XP and loot", () => {
    const s = fightStory("f1", { outcome: "won", foes: ["Rat", "Rat", "Goblin"], rounds: 3, xp: 6, banked: 6, loot: ["A silver ring"] });
    expect(s.heading).toBe("Fight — 2 Rats and Goblin");
    expect(s.body).toMatch(/3 rounds/);
    expect(s.body).toMatch(/6 XP/);
    expect(s.body).toContain("A silver ring");
    expect(fightStory("f2", { outcome: "lost", foes: ["Ogre"], rounds: 1, xp: 0, loot: [] }).body).toMatch(/1 round\b/);
  });

  it("milestones and realm", () => {
    expect(milestoneStory("m", { kind: "descend", from: 1, to: 2 }).heading).toBe("Down to level 2");
    expect(milestoneStory("m", { kind: "levelup", level: 3, title: "Knight" }).body).toMatch(/level 3/);
    expect(milestoneStory("m", { kind: "rest", ration: true, hp: 4 }).body).toMatch(/4 HP/);
    const shaft = milestoneStory("m", { kind: "leave", level: 2 });
    expect(shaft.body).toMatch(/exit shaft is found on level 2/i);
    expect(shaft.body).not.toMatch(/out of|behind|left/i);
    const p = realmStory("r", { kind: "plot", year: 837, month: 3, tag: "4FO", land: "FOREST", type: "Area", size: 4, owner: "Lord Gaunt", claimed: false, encounter: "2D6: 7 A quiet glade" });
    expect(p.heading).toBe("Plot 4FO — Forest");
    expect(p.body).toContain("Lord Gaunt");
    expect(realmStory("r", { kind: "month", year: 837, month: 3, events: [], ended: true }).heading).toBe("Year 837, month 3 ends");
  });
});

describe("plainText", () => {
  it("keeps a realm encounter's words, without the dice header or the muted hint", () => {
    const html = `<strong>2D6: Red 6 + Ivory 6 = 12</strong><p style="margin:6px 0 0">You stand on the <em>banks</em> &amp; stare.</p><p class="muted" style="font-size:0.8rem">Read from the book's Lake entry.</p>`;
    expect(plainText(html)).toBe("You stand on the banks & stare.");
  });
});

describe("entryStory and export", () => {
  it("the player's edit replaces the story text", () => {
    const s = emptyJournal();
    const k = recordRoom(s, { phase: "start", level: 1, n: 2, kind: "regular", w: 3, h: 3 }, { at: 1, date: "d" })!;
    editEntryText(s, k, "<b>Mine</b>");
    expect(entryStory(s.entries[0]).body).toBe("<b>Mine</b>");
  });

  it("exports a standalone, escaped, printable page with chapters and pictures", () => {
    const s = emptyJournal();
    const k = recordRoom(s, { phase: "start", level: 1, n: 1, kind: "entrance", w: 3, h: 2 }, { at: Date.UTC(2026, 10, 11, 12), date: "Year 837 Month 3" })!;
    editEntryText(s, k, "<script>alert(1)</script> & co");
    setAddition(s, k, 'He said "hi"');
    recordFight(s, { phase: "end", outcome: "won", foes: ["<Rat>"], rounds: 2, xp: 1 }, { at: Date.UTC(2026, 10, 11, 13), date: "d" }, k);
    const html = exportJournalHtml(s, () => raw('<svg class="dmap"></svg>'));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Chapter 1");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("He said &quot;hi&quot;");
    expect(html).toContain("&lt;Rat&gt;");
    expect(html).toContain("page-break-before");
    expect(html).toMatch(/font-family:[^;]*serif/);
  });
});
