import { describe, it, expect } from "vitest";
import { doorSfx, SFX, trackFor } from "../src/audio/manifest";
import { currentTrack, playSfx, playSting, setMusic } from "../src/audio/sound";

describe("audio rules", () => {
  it("picks music by the fight, never by the screen", () => {
    expect(trackFor(null)).toBe("dungeon");
    expect(trackFor("setup")).toBe("dungeon");
    expect(trackFor("won")).toBe("dungeon");
    expect(trackFor("you")).toBe("combat");
    expect(trackFor("foes")).toBe("combat");
  });

  it("gives each dungeon check its sound", () => {
    expect(doorSfx({ check: "door", ok: true })).toBe("door-open");
    expect(doorSfx({ check: "door", ok: false })).toBe("door-locked");
    expect(doorSfx({ check: "pick", ok: true })).toBe("lockpick-ok");
    expect(doorSfx({ check: "pick", ok: false })).toBe("lockpick-fail");
    expect(doorSfx({ check: "portcullis", ok: true })).toBe("portcullis");
    expect(doorSfx({ check: "slab", ok: false })).toBe("slab");
  });

  it("has a file for every effect and track", () => {
    const files = new Set(Object.keys(import.meta.glob("../public/audio/**/*.mp3")).map((f) => f.replace("../public/", "")));
    for (const id of Object.keys(SFX)) expect(files.has(`audio/sfx/${id}.mp3`), id).toBe(true);
    for (const id of ["tavern", "dungeon", "combat", "realm", "sting-victory", "sting-defeat"]) expect(files.has(`audio/music/${id}.mp3`), id).toBe(true);
  });

  it("does nothing without Web Audio", () => {
    expect(() => {
      playSfx("hit");
      playSting("victory");
      setMusic("dungeon");
    }).not.toThrow();
    expect(currentTrack()).toBeNull();
  });
});

describe("2D6 Void sound pack", () => {
  it("has a file for every Void effect, track and sting", async () => {
    const { VOID_PACK } = await import("../src/audio/manifest");
    const files = new Set(Object.keys(import.meta.glob("../public/audio/void/**/*.mp3")).map((f) => f.replace("../public/", "")));
    for (const id of Object.keys(VOID_PACK.sfx)) expect(files.has(`audio/void/sfx/${id}.mp3`), id).toBe(true);
    for (const id of Object.keys(VOID_PACK.tracks)) expect(files.has(`audio/void/music/${id}.mp3`), id).toBe(true);
    for (const id of Object.keys(VOID_PACK.stings)) expect(files.has(`audio/void/music/sting-${id}.mp3`), id).toBe(true);
  });

  it("plays hulk music by level and fight music while a fight is on", async () => {
    const { voidTrackFor } = await import("../src/audio/manifest");
    expect(voidTrackFor(null, 1)).toBe("hulk");
    expect(voidTrackFor(null, 3)).toBe("hulk");
    expect(voidTrackFor(null, 9)).toBe("nullvoid");
    expect(voidTrackFor(null, 10)).toBe("hive");
    expect(voidTrackFor("you", 2)).toBe("fight");
    expect(voidTrackFor("foes", 2)).toBe("fight");
    expect(voidTrackFor("setup", 2)).toBe("hulk");
  });
});
