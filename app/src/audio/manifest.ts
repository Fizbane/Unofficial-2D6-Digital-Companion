// The app's sounds: files under public/audio (made with PixelLab), each with a base volume, and
// the pure rules for which music suits a page and which effect a dungeon check makes.
import type { JournalDoorEvent } from "../shell/events";
import { byGame } from "../games";
import { load } from "../tools/common";

export type SfxId =
  | "dice-throw" | "dice-land"
  | "hit" | "hit-crit" | "miss" | "hurt" | "armour-block" | "foe-down" | "fumble"
  | "door-open" | "door-locked" | "lockpick-ok" | "lockpick-fail" | "portcullis" | "slab"
  | "room-new" | "descend" | "eat"
  | "click" | "page-turn" | "level-up" | "scroll-cast" | "scroll-fail" | "favour"
  // 2D6 Void only
  | "shot" | "grenade" | "stim" | "reload";

export type TrackId = "tavern" | "dungeon" | "combat" | "realm" | VoidTrackId;
/** 2D6 Void's music: the ship-bay dashboard (no longer picked by screen), the hulk, a fight, and the two last levels. */
export type VoidTrackId = "bay" | "hulk" | "fight" | "nullvoid" | "hive";
export type StingId = "victory" | "defeat";

/** Base volume of each effect (before the Settings volume), evened out by ear and by peak level. */
const DUNGEON_SFX: Partial<Record<SfxId, number>> = {
  "dice-throw": 0.55, "dice-land": 0.6,
  hit: 0.8, "hit-crit": 0.9, miss: 0.6, hurt: 0.8, "armour-block": 0.7, "foe-down": 0.8, fumble: 0.7,
  "door-open": 0.8, "door-locked": 0.8, "lockpick-ok": 0.8, "lockpick-fail": 0.8, portcullis: 0.8, slab: 0.8,
  "room-new": 0.6, descend: 0.8, eat: 0.7,
  click: 0.25, "page-turn": 0.4, "level-up": 0.8, "scroll-cast": 0.8, "scroll-fail": 0.8, favour: 0.8,
};

/**
 * A music loop: the intro plays once, then loopStart to the end of the file repeats (seconds). The
 * files are cut at PixelLab's loop end, so the end of the file joins loopStart without a seam.
 */
export interface Track { loopStart: number; volume: number }
const DUNGEON_TRACKS: Partial<Record<TrackId, Track>> = {
  tavern: { loopStart: 38.545, volume: 0.8 },
  dungeon: { loopStart: 44.211, volume: 0.9 },
  combat: { loopStart: 42.144, volume: 0.7 },
  realm: { loopStart: 42.632, volume: 0.8 },
};
export const STINGS: Record<StingId, number> = { victory: 0.8, defeat: 0.8 };

/**
 * 2D6 Void's effects: the same action ids where the action is the same (a door, a hit, a ration),
 * sci-fi sounds in the files. The doors map: door-open = sliding door, door-locked = locked door,
 * lockpick-ok/-fail = hacking a lock, portcullis = security door, slab = electrical barrier,
 * page-turn = a data chirp, eat = a ration pack, descend = the ladder down.
 */
const VOID_SFX: Partial<Record<SfxId, number>> = {
  "dice-throw": 0.55, "dice-land": 0.6,
  hit: 0.8, "hit-crit": 0.9, miss: 0.6, hurt: 0.8, "armour-block": 0.7, "foe-down": 0.8, fumble: 0.7,
  "door-open": 0.8, "door-locked": 0.8, "lockpick-ok": 0.8, "lockpick-fail": 0.8, portcullis: 0.8, slab: 0.8,
  "room-new": 0.6, descend: 0.8, eat: 0.7,
  click: 0.25, "page-turn": 0.35, "level-up": 0.8,
  shot: 0.75, grenade: 0.85, stim: 0.7, reload: 0.6,
};
const VOID_TRACKS: Partial<Record<TrackId, Track>> = {
  bay: { loopStart: 83.615, volume: 0.75 },
  hulk: { loopStart: 70.658, volume: 0.85 },
  fight: { loopStart: 70.101, volume: 0.7 },
  nullvoid: { loopStart: 84.381, volume: 0.85 },
  hive: { loopStart: 93.994, volume: 0.85 },
};

/** A game's sounds: where its files live, which effects and tracks it has, and its music rule. */
export interface SoundPack {
  base: string;
  sfx: Partial<Record<SfxId, number>>;
  tracks: Partial<Record<TrackId, Track>>;
  stings: Record<StingId, number>;
  /** The saved-fight key whose phase drives fight music. */
  combatKey: string;
  trackFor(combat: CombatPhase | null): TrackId;
}

export const DUNGEON_PACK: SoundPack = { base: "audio", sfx: DUNGEON_SFX, tracks: DUNGEON_TRACKS, stings: STINGS, combatKey: "combat", trackFor };
export const VOID_PACK: SoundPack = { base: "audio/void", sfx: VOID_SFX, tracks: VOID_TRACKS, stings: STINGS, combatKey: "vcombat", trackFor: (c) => voidTrackFor(c, hulkLevel()) };

/** The current game's sound pack. */
export const PACK: SoundPack = byGame({ dungeon: DUNGEON_PACK, void: VOID_PACK });
export const SFX = PACK.sfx;
export const TRACKS = PACK.tracks;

/** Paths relative to the page, so they work under any base path (as dice3d's assets do). */
export const sfxUrl = (id: SfxId, pack = PACK) => `${pack.base}/sfx/${id}.mp3`;
export const trackUrl = (id: TrackId, pack = PACK) => `${pack.base}/music/${id}.mp3`;
export const stingUrl = (id: StingId, pack = PACK) => `${pack.base}/music/sting-${id}.mp3`;

/** The Dark Hulk level of the saved expedition (L9 and L10 have their own music). */
function hulkLevel(): number {
  return load<{ level: number }>("vhulk", { level: 1 }).level;
}

/**
 * 2D6 Void's music: it follows the fight and how deep the hulk is, never the screen you are on, so
 * moving between tools doesn't change the track.
 */
export function voidTrackFor(combat: CombatPhase | null, level: number): TrackId {
  if (combat === "you" || combat === "foes") return "fight";
  return level >= 10 ? "hive" : level === 9 ? "nullvoid" : "hulk";
}

export type CombatPhase = "setup" | "you" | "foes" | "won" | "lost";

/** The music: fight music while a fight is on, the dungeon loop otherwise. It never depends on the screen. */
export function trackFor(combat: CombatPhase | null): TrackId {
  return combat === "you" || combat === "foes" ? "combat" : "dungeon";
}

/** The effect for a Leave-step check on an exit. */
export function doorSfx(ev: Pick<JournalDoorEvent, "check" | "ok">): SfxId {
  switch (ev.check) {
    case "door":
      return ev.ok ? "door-open" : "door-locked";
    case "pick":
      return ev.ok ? "lockpick-ok" : "lockpick-fail";
    case "portcullis":
      return "portcullis";
    case "slab":
      return "slab";
  }
}
