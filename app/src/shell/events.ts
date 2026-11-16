// Tiny typed event bus shared by the shell and the tools.
import type { Prefs } from "./prefs";
import type { ResultCard } from "./types";
import type { DungeonMap, ExitType, Side } from "../tools/dmap";
import type { IconName } from "../ui/icon";

/**
 * Story beats for the Journal (shell/journal.ts records them; the tools only emit). A room is keyed
 * by its number on the current level's map; `map` is the live map (the journal copies a slice).
 */
export interface JournalRoomEvent {
  phase: "start" | "update" | "finish" | "discard";
  level: number;
  n: number;
  kind: "entrance" | "corridor" | "small" | "regular" | "large";
  w: number;
  h: number;
  title?: string; // the room table's ROOM TYPE cell
  description?: string; // its DESCRIPTION cell
  encounter?: string; // a patrol / interruption roll just made here (for example "Patrol: <creature name>")
  exitsKnown?: boolean; // the number of exits has been rolled (none then means a dead end)
  map?: DungeonMap;
  mapRoom?: number; // this room's id on `map`
}
/** A Leave-step check on the exit picked on the map: it belongs to the room that owns that exit. */
export interface JournalDoorEvent {
  level: number;
  room: number; // map id of the room the exit belongs to
  side: Side; // that room's wall
  type: ExitType; // the exit's own type
  check: "door" | "pick" | "portcullis" | "slab";
  ok: boolean; // door: not locked · pick: unlocked · slab: tipped over · portcullis: rolled
  detail?: string; // the portcullis table's result
}
export type JournalFightEvent =
  | { phase: "end"; outcome: "won" | "lost"; foes: string[]; rounds: number; xp: number }
  | { phase: "xp"; xp: number }
  | { phase: "loot"; text: string };
export type JournalMilestoneEvent =
  | { kind: "descend"; from: number; to: number }
  | { kind: "rest"; ration: boolean; hp: number }
  | { kind: "leave"; level: number };
export type JournalRealmEvent =
  | { kind: "plot"; year: number; month: number; tag: string; land: string; type?: string; size: number; owner: string; claimed: boolean; encounter?: string }
  | { kind: "event"; year: number; month: number; title: string; text: string }
  | { kind: "month"; year: number; month: number }; // `month` of `year` has ended

export interface Events {
  roll: ResultCard;
  "results:cleared": { source: string }; // Results' Clear emptied "2d6:shell:results"
  "character:changed": { source: string };
  "dungeon:changed": { source: string };
  "realm:changed": { source: string };
  "void:changed": { source: string }; // a 2D6 Void tool saved its state (hulk, sheet, combat)
  "combat:changed": { source: string }; // "2d6:play:combat" was written (round, fatigue, phase)
  "tabs:changed": { active: string | null }; // active route
  "bookmarks:changed": { source: string }; // "2d6:bookmarks" was written
  "prefs:changed": Prefs; // "2d6:shell:prefs" was written
  "journal:room": JournalRoomEvent;
  "journal:door": JournalDoorEvent;
  "journal:fight": JournalFightEvent;
  "journal:milestone": JournalMilestoneEvent;
  "journal:realm": JournalRealmEvent;
  "journal:changed": { source: string }; // "2d6:journal" was written
  "map:focus": { room: number }; // show this room on the Map page
  "dice:rolled": { kind: string; dice: number[] }; // any rollDice() result (table, quick dice, combat)
  "combat:hit": { kind: "prime" | "exact" }; // you landed a Prime Attack or an Exact Strike
  "realm:building": { type: string }; // a building was started
  "achievement:unlocked": { id: string; title: string; icon: IconName };
  "achievements:changed": { source: string }; // "2d6:achievements" was written
  "statistics:changed": { source: string }; // this game's statistics store was written
  "combat:saved": { by: string }; // a companion took the killing blow and you live (by: its name)
}

export class EventBus<E> {
  private listeners = new Map<keyof E, Set<(p: never) => void>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let set = this.listeners.get(k);
    if (!set) this.listeners.set(k, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => {
      set.delete(fn as (p: never) => void);
    };
  }

  /** Deliver to every listener; a throwing listener is logged and the rest still run. */
  emit<K extends keyof E>(k: K, p: E[K]): void {
    const set = this.listeners.get(k);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (p: E[K]) => void)(p);
      } catch (e) {
        console.error(`EventBus listener for "${String(k)}" failed`, e);
      }
    }
  }
}

export const bus = new EventBus<Events>();
