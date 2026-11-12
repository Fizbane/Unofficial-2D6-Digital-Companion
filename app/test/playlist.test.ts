import { describe, expect, it } from "vitest";
import { MAX_SONGS, nextEntry, queueFor, refuseSong, sceneOf, songNameFromFile, type PlaylistState } from "../src/audio/playlist";

const ALL = ["tavern", "dungeon", "combat", "realm"];
const st = (o: Partial<PlaylistState> = {}): PlaylistState => ({ v: 1, off: [], songs: [], ...o });
const ids = (q: { id: string }[]) => q.map((e) => e.id);

describe("playlist queue", () => {
  it("leads with the game's own pick, then the rest of the scene", () => {
    expect(ids(queueFor("dungeon", ALL, st()))).toEqual(["dungeon", "tavern", "realm"]);
    expect(ids(queueFor("combat", ALL, st()))).toEqual(["combat"]);
  });

  it("never plays a song that is switched off", () => {
    expect(ids(queueFor("dungeon", ALL, st({ off: ["dungeon", "realm"] })))).toEqual(["tavern"]);
  });

  it("carries on with exploring songs when every fight song is off, and is silent when all are", () => {
    expect(ids(queueFor("combat", ALL, st({ off: ["combat"] })))).toEqual(["dungeon", "tavern", "realm"].sort((a, b) => ALL.indexOf(a) - ALL.indexOf(b)));
    expect(queueFor("combat", ALL, st({ off: ALL }))).toEqual([]);
    expect(queueFor(null, ALL, st())).toEqual([]);
  });

  it("adds the player's songs where they say, and only when switched on", () => {
    const songs = [
      { id: "u-all1", name: "A", scene: "any" as const, enabled: true },
      { id: "u-exp1", name: "B", scene: "explore" as const, enabled: true },
      { id: "u-cmb1", name: "C", scene: "combat" as const, enabled: true },
      { id: "u-off1", name: "D", scene: "any" as const, enabled: false },
    ];
    expect(ids(queueFor("dungeon", ALL, st({ songs })))).toEqual(["dungeon", "tavern", "realm", "u-all1", "u-exp1"]);
    expect(ids(queueFor("combat", ALL, st({ songs })))).toEqual(["combat", "u-all1", "u-cmb1"]);
  });

  it("moves to the next song and wraps", () => {
    const q = [{ id: "a", user: false }, { id: "b", user: true }];
    expect(nextEntry(q, "a")?.id).toBe("b");
    expect(nextEntry(q, "b")?.id).toBe("a");
    expect(nextEntry(q, "gone")?.id).toBe("a");
    expect(nextEntry([], "a")).toBeUndefined();
  });

  it("knows fight tracks from the rest", () => {
    expect(sceneOf("combat")).toBe("combat");
    expect(sceneOf("fight")).toBe("combat");
    expect(sceneOf("hulk")).toBe("explore");
  });
});

describe("adding songs", () => {
  it("names a song from its file and refuses what it cannot play", () => {
    expect(songNameFromFile("My_cool  song.final.mp3")).toBe("My cool song.final");
    expect(refuseSong({ name: "a.mp3", type: "audio/mpeg", size: 1000 }, 0)).toBeNull();
    expect(refuseSong({ name: "a.mp3", type: "audio/mpeg", size: 1000 }, MAX_SONGS)).toMatch(/up to/);
    expect(refuseSong({ name: "big.mp3", type: "audio/mpeg", size: 50 * 1024 * 1024 }, 0)).toMatch(/over/);
    expect(refuseSong({ name: "notes.txt", type: "text/plain", size: 10 }, 0)).toMatch(/isn't an audio file/);
  });
});
