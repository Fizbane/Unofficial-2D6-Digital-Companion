import { describe, it, expect } from "vitest";
import { addRoom, newMap, placeEntrance, placeEntranceExits, type DungeonMap } from "../src/tools/dmap";
import { renderSnap, roomExits, sliceMap, snapToMap } from "../src/shell/journalsnap";

/** Entrance (1) at the bottom centre, a room (2) north of it through its north archway, a far room (3) elsewhere. */
function sample(): DungeonMap & { ids: { ent: number; r2: number; far: number } } {
  const m = newMap(1);
  const p = placeEntrance(m, 3, 2)!;
  const ent = addRoom(m, { n: 1, ...p, kind: "entrance", label: "Entrance Room", sub: "" });
  placeEntranceExits(m, ent);
  const north = m.exits.find((e) => e.room === ent.id && e.side === "N")!;
  const r2 = addRoom(m, { n: 2, x: north.x - 1, y: north.y - 3, w: 3, h: 3, kind: "regular", label: "Abandoned Guard Post", sub: "L1 12", details: [["DESCRIPTION", "A long text that must not be copied into the snapshot"]], notes: "my notes" });
  north.to = r2.id;
  m.exits.push({ id: m.nextId++, room: r2.id, side: "E", x: r2.x + 3, y: r2.y + 1, type: "metal", locked: true });
  const far = addRoom(m, { n: 3, x: 0, y: 0, w: 2, h: 2, kind: "small", label: "Far away", sub: "" });
  return Object.assign(m, { ids: { ent: ent.id, r2: r2.id, far: far.id } });
}

describe("sliceMap", () => {
  it("keeps the room, its direct neighbours and its exits, and leaves far rooms out", () => {
    const m = sample();
    const s = sliceMap(m, m.ids.r2)!;
    const ids = s.rooms.map((r) => r.id).sort();
    expect(ids).toEqual([m.ids.ent, m.ids.r2].sort());
    expect(s.focus).toBe(m.ids.r2);
    expect(s.exits.some((e) => e.room === m.ids.r2 && e.side === "E" && e.type === "metal" && e.locked)).toBe(true);
    // the box covers both rooms and is inside the map
    const [bx, by, bw, bh] = s.box;
    expect(bx).toBeGreaterThanOrEqual(0);
    expect(by + bh).toBeLessThanOrEqual(m.h);
    for (const r of s.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(bx);
      expect(r.x + r.w).toBeLessThanOrEqual(bx + bw);
    }
    expect(bw).toBeLessThan(m.w);
  });

  it("is a frozen copy: later map changes don't reach it", () => {
    const m = sample();
    const s = sliceMap(m, m.ids.r2)!;
    m.rooms.find((r) => r.id === m.ids.r2)!.label = "Changed";
    expect(s.rooms.find((r) => r.id === m.ids.r2)!.label).toBe("Abandoned Guard Post");
  });

  it("drops notes, details and the room code, and serialises a typical slice well under 2 KB", () => {
    const m = sample();
    const s = sliceMap(m, m.ids.r2)!;
    const json = JSON.stringify(s);
    expect(json).not.toContain("my notes");
    expect(json).not.toContain("must not be copied");
    expect(json.length).toBeLessThan(2048);
  });

  it("returns null for a room that isn't on the map", () => {
    expect(sliceMap(sample(), 99)).toBeNull();
  });

  it("round-trips to a map the renderer draws, cropped to the box, with the room highlighted", () => {
    const src = sample();
    const s = sliceMap(src, src.ids.r2)!;
    const m = snapToMap(s);
    expect(m.rooms).toHaveLength(2);
    const svg = String(renderSnap(s, "j1"));
    const [bx, by] = s.box;
    expect(svg).toContain(`viewBox="${bx * 26 - 6} ${by * 26 - 6}`);
    expect(svg).toContain('stroke="#d0582c"'); // the current-room outline
    // every drawing gets its own id prefix, so two pictures on one page never share pattern/filter ids
    const ids = (x: string) => [...x.matchAll(/ id="(dm\d+)-/g)].map((m) => m[1]);
    const other = String(renderSnap(s, "j2"));
    expect(ids(svg).length).toBeGreaterThan(0);
    expect(new Set(ids(svg)).size).toBe(1);
    expect(ids(other)[0]).not.toBe(ids(svg)[0]);
    expect(svg).not.toContain('id="rock"');
  });
});

describe("roomExits", () => {
  it("reports the wall and doorway you came in by and the room's own exits", () => {
    const m = sample();
    const x = roomExits(m, m.ids.r2);
    expect(x.entry).toBe("S");
    expect(x.via).toBe("archway");
    expect(x.exits).toEqual([{ side: "E", type: "metal", locked: true }]);
  });

  it("the entrance room is entered from the south, through the dungeon entrance", () => {
    const m = sample();
    const x = roomExits(m, m.ids.ent);
    expect(x.entry).toBe("S");
    expect(x.via).toBe("entrance");
    expect(x.exits.map((e) => e.side).sort()).toEqual(["E", "N", "W"]);
  });
});
