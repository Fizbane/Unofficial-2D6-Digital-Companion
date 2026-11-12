import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS, achView, bump, LEGENDARY_REWARDS, LEGENDARY_SECTION, onTableRoll, emptyAch, isAchState, normalizeAch, onCombatHit, onDice, onDoor, onFight, onLevel, onMilestone, onRealm, onRoom, raise, streak,
} from "../src/shell/achievementsmodel";
import type { JournalRoomEvent } from "../src/shell/events";
import { ICON_NAMES } from "../src/ui/icon";

const room = (phase: JournalRoomEvent["phase"], level = 1): JournalRoomEvent => ({ phase, level, n: 1, kind: "regular", w: 3, h: 3 });

describe("achievement definitions", () => {
  it("have unique ids, positive goals and known icons", () => {
    expect(new Set(ACHIEVEMENTS.map((d) => d.id)).size).toBe(ACHIEVEMENTS.length);
    for (const d of ACHIEVEMENTS) {
      expect(d.goal).toBeGreaterThan(0);
      expect(ICON_NAMES).toContain(d.icon);
    }
  });
});

describe("reducers", () => {
  it("bump unlocks once when the goal is reached", () => {
    const s = emptyAch();
    expect(bump(s, "rooms", 1)).toEqual(["first-steps"]);
    expect(bump(s, "rooms", 2)).toEqual([]);
    expect(s.unlocked["first-steps"]).toBe(1);
    expect(bump(s, "rooms", 3, 0)).toEqual([]);
  });
  it("raise keeps the highest value", () => {
    const s = emptyAch();
    expect(raise(s, "depth", 5, 1)).toEqual(["going-down", "deep-delver", "further-down"]);
    raise(s, "depth", 3, 2);
    expect(s.counters.depth).toBe(5);
  });
  it("streak resets on a miss and keeps the best run", () => {
    const s = emptyAch();
    streak(s, "run", "best", true, 1);
    streak(s, "run", "best", true, 1);
    streak(s, "run", "best", false, 1);
    streak(s, "run", "best", true, 1);
    expect(s.counters).toMatchObject({ run: 1, best: 2 });
  });
});

describe("event mappers", () => {
  it("counts a room when it is finished, not when it starts or updates", () => {
    const s = emptyAch();
    expect(onRoom(s, room("start"), 1)).toEqual([]);
    expect(onRoom(s, room("update"), 1)).toEqual([]);
    expect(onRoom(s, room("discard"), 1)).toEqual([]);
    expect(onRoom(s, room("finish"), 1)).toEqual(["first-steps"]);
  });
  it("tracks depth from rooms and the stairs", () => {
    const s = emptyAch();
    expect(onMilestone(s, { kind: "descend", from: 1, to: 2 }, 1)).toEqual(["going-down"]);
    expect(onRoom(s, room("start", 5), 1)).toEqual(["deep-delver", "further-down"]);
  });
  it("counts successful door checks and picks", () => {
    const s = emptyAch();
    onDoor(s, { level: 1, room: 1, side: "n", type: "door", check: "pick", ok: true } as never, 1);
    onDoor(s, { level: 1, room: 1, side: "n", type: "door", check: "door", ok: false } as never, 1);
    expect(s.counters).toEqual({ doors: 1, picks: 1 });
  });
  it("rests without a ration unlock Lean Times; exit shafts count", () => {
    const s = emptyAch();
    expect(onMilestone(s, { kind: "rest", ration: true, hp: 3 }, 1)).toEqual([]);
    expect(onMilestone(s, { kind: "rest", ration: false, hp: -1 }, 1)).toEqual(["lean-times"]);
    onMilestone(s, { kind: "leave", level: 1 }, 1);
    expect(s.counters.shafts).toBe(1);
  });
  it("fights: wins, foes, quick wins, losses and XP", () => {
    const s = emptyAch();
    expect(onFight(s, { phase: "end", outcome: "won", foes: ["Rat", "Rat"], rounds: 1, xp: 2 }, 1)).toEqual(["blooded", "quick-work"]);
    expect(s.counters).toMatchObject({ wins: 1, foes: 2, quick: 1 });
    expect(onFight(s, { phase: "end", outcome: "lost", foes: ["Ogre"], rounds: 4, xp: 0 }, 1)).toEqual(["fallen-hero"]);
    expect(onFight(s, { phase: "xp", xp: 1000 }, 1)).toEqual(["seasoned", "learning-ropes"]);
    expect(onFight(s, { phase: "loot", text: "gold" }, 1)).toEqual([]);
  });
  it("dice: doubles and the Hot Hand streak", () => {
    const s = emptyAch();
    expect(onDice(s, [1, 1], 1)).toEqual(["snake-eyes"]);
    expect(onDice(s, [6, 6], 1)).toEqual(["boxcars"]);
    onDice(s, [6, 6], 1);
    onDice(s, [3], 1); // a single die doesn't break the run
    expect(onDice(s, [6, 6], 1)).toEqual(["hot-hand"]);
    onDice(s, [6, 5], 1);
    expect(s.counters.sixStreak).toBe(0);
    expect(s.counters.dice).toBe(11);
  });
  it("realm plots, months, combat hits and levels", () => {
    const s = emptyAch();
    expect(onRealm(s, { kind: "plot", year: 1, month: 1, tag: "1", land: "Wood", size: 1, owner: "", claimed: true }, 1)).toEqual(["landholder"]);
    onRealm(s, { kind: "plot", year: 1, month: 1, tag: "2", land: "Wood", size: 1, owner: "X", claimed: false }, 1);
    onRealm(s, { kind: "month", year: 1, month: 1 }, 1);
    onCombatHit(s, "prime", 1);
    onCombatHit(s, "exact", 1);
    expect(onLevel(s, 2, 1)).toEqual(["rising"]);
    expect(s.counters).toMatchObject({ claims: 1, months: 1, primes: 1, exacts: 1, level: 2 });
  });
});

describe("validation and view", () => {
  it("rejects bad shapes and drops unknown ids and bad counters", () => {
    expect(isAchState(null)).toBe(false);
    expect(isAchState({ v: 2, counters: {}, unlocked: {} })).toBe(false);
    expect(isAchState(emptyAch())).toBe(true);
    const n = normalizeAch({ v: 1, counters: { rooms: 3, bad: "x" as never, neg: -1 }, unlocked: { "first-steps": 5, nope: 1 } });
    expect(n).toEqual({ v: 1, counters: { rooms: 3 }, unlocked: { "first-steps": 5 } });
  });
  it("hides locked secrets and reports progress", () => {
    const s = emptyAch();
    bump(s, "rooms", 1, 25);
    const v = achView(s);
    const cards = v.sections.flatMap((x) => x.cards);
    expect(cards.find((c) => c.def.id === "delver")).toMatchObject({ value: 25, pct: 50 });
    expect(cards.find((c) => c.def.id === "fallen-hero")).toMatchObject({ title: "???", hidden: true });
    expect(v).toMatchObject({ done: 2, total: ACHIEVEMENTS.length });
  });
});

describe("the second set", () => {
  it("has 85 Dungeon achievements and 32 Void ones", () => {
    expect(ACHIEVEMENTS.filter((d) => !d.group.startsWith("void-"))).toHaveLength(85);
    expect(ACHIEVEMENTS.filter((d) => d.group.startsWith("void-"))).toHaveLength(32);
  });
  it("counts large rooms, encounters, portcullises and slabs", () => {
    const s = emptyAch();
    onRoom(s, { ...room("finish"), kind: "large" }, 1);
    onRoom(s, { ...room("update"), encounter: "Patrol: Rat" }, 1);
    onDoor(s, { level: 1, room: 1, side: "n", type: "door", check: "portcullis", ok: true } as never, 1);
    onDoor(s, { level: 1, room: 1, side: "n", type: "door", check: "slab", ok: true } as never, 1);
    expect(s.counters).toMatchObject({ rooms: 1, largeRooms: 1, encounters: 1, portcullis: 1, slabs: 1, doors: 2 });
  });
  it("rests, rations and realm plots and events", () => {
    const s = emptyAch();
    onMilestone(s, { kind: "rest", ration: true, hp: 3 }, 1);
    onMilestone(s, { kind: "rest", ration: false, hp: -1 }, 1);
    onRealm(s, { kind: "plot", year: 1, month: 1, tag: "1", land: "Wood", size: 1, owner: "X", claimed: false }, 1);
    onRealm(s, { kind: "event", year: 1, month: 1, title: "Monthly event", text: "Rain" }, 1);
    expect(s.counters).toMatchObject({ rests: 2, rations: 1, hungry: 1, plots: 1, realmEvents: 1 });
  });
  it("win streaks, long fights, outnumbered wins and loot", () => {
    const s = emptyAch();
    const win = (foes = 1, rounds = 3) => onFight(s, { phase: "end", outcome: "won", foes: Array(foes).fill("Rat"), rounds, xp: 1 }, 1);
    for (let i = 0; i < 4; i++) win();
    expect(win(3)).toEqual(expect.arrayContaining(["unstoppable", "outnumbered", "scrapper"]));
    onFight(s, { phase: "end", outcome: "lost", foes: ["Ogre"], rounds: 12, xp: 0 }, 1);
    expect(s.counters).toMatchObject({ winStreak: 0, winStreakBest: 5, longestFight: 12, mostFoes: 3 });
    expect(s.unlocked.attrition).toBeDefined();
    onFight(s, { phase: "loot", text: "gold" }, 1);
    expect(s.counters.loot).toBe(1);
  });
  it("D66 rolls, doubles, the full set and runs of doubles", () => {
    const s = emptyAch();
    onDice(s, [3, 4], 1, "D66");
    expect(s.counters.d66).toBe(1);
    expect(onDice(s, [2, 2], 1)).toEqual([]);
    onDice(s, [3, 3], 1);
    expect(onDice(s, [4, 4], 1)).toEqual(["mirror-mirror"]);
    onDice(s, [1, 1], 1);
    onDice(s, [5, 5], 1);
    expect(onDice(s, [6, 6], 1)).toEqual(expect.arrayContaining(["full-set", "boxcars"]));
    expect(s.counters.doubles).toBe(6);
  });
  it("lists each group as ladders, smallest goal first", () => {
    const dungeon = achView(emptyAch()).sections.find((x) => x.id === "dungeon")!.cards.map((c) => c.def.id);
    expect(dungeon.slice(0, 5)).toEqual(["first-steps", "getting-around", "delver", "hundred-halls", "cartographer"]);
  });
});

describe("legendary rewards", () => {
  const roll = (title: string, sectionId = LEGENDARY_SECTION) => ({ sectionId, title });
  it("need dungeon level 10 first", () => {
    const s = emptyAch();
    expect(onTableRoll(s, roll("The Wand of Dretas"), 1)).toEqual([]);
    raise(s, "depth", 10, 1);
    expect(onTableRoll(s, roll("The Wand of Dretas"), 2)).toEqual(["legend-6"]);
    expect(onTableRoll(s, roll("The Wand of Dretas"), 3)).toEqual([]); // once only
  });
  it("match each reward, whatever the apostrophe, and ignore other tables", () => {
    const s = emptyAch();
    raise(s, "depth", 10, 1);
    for (const r of LEGENDARY_REWARDS) expect(onTableRoll(s, roll(r.name.replace("’", "'")), 1)).toEqual([`legend-${r.roll}`]);
    expect(onTableRoll(emptyAch(), roll("The Crown of Verifica", "core/other"), 1)).toEqual([]);
    expect(onTableRoll(s, roll("No match"), 1)).toEqual([]);
  });
  it("have their own group on the page", () => {
    const g = achView(emptyAch()).sections.find((x) => x.id === "legend")!;
    expect(g.title).toBe("Legendary Rewards");
    expect(g.cards.map((c) => c.title)).toEqual(LEGENDARY_REWARDS.map((r) => r.name));
  });
});

describe("2D6 Void achievements", () => {
  const V = "v:" as const;

  it("count Void rooms, doors and depth only toward the Void achievements", () => {
    const s = emptyAch();
    const ids = [...onRoom(s, room("finish", 2), 1, V), ...onDoor(s, { level: 2, room: 1, side: "N", type: "sliding", check: "pick", ok: true }, 1, V)];
    expect(ids).toEqual(expect.arrayContaining(["v-boarding-party", "v-lower-decks", "v-airlock", "v-access-granted"]));
    expect(ids.some((id) => !id.startsWith("v-"))).toBe(false);
    expect(s.counters.rooms).toBeUndefined(); // the Dungeon's counters are untouched
    expect(s.counters["v:rooms"]).toBe(1);
  });

  it("keep Dungeon rooms out of the Void achievements", () => {
    const s = emptyAch();
    onRoom(s, room("finish"), 1);
    expect(s.counters["v:rooms"]).toBeUndefined();
    expect(s.unlocked["v-boarding-party"]).toBeUndefined();
  });

  it("share the dice: a double six in either game unlocks Boxcars once", () => {
    const s = emptyAch();
    expect(onDice(s, [6, 6], 1)).toContain("boxcars");
    expect(onDice(s, [6, 6], 2)).not.toContain("boxcars");
    expect(s.counters.sixes).toBe(2);
  });

  it("treat leaving the Dark Hulk as the Escape Pod, not an exit shaft", () => {
    const s = emptyAch();
    expect(onMilestone(s, { kind: "leave", level: 10 } as never, 1, V)).toContain("v-escape-velocity");
    expect(s.counters.shafts).toBeUndefined();
  });

  it("track Void fights and survivor levels apart from the Dungeon's", () => {
    const s = emptyAch();
    const ids = onFight(s, { phase: "end", outcome: "won", foes: ["ACID DROOLER"], rounds: 1, xp: 14 } as never, 1, V);
    expect(ids).toEqual(expect.arrayContaining(["v-first-contact", "v-clean-kill"]));
    expect(onLevel(s, 2, 1, V)).toContain("v-promoted");
    expect(s.counters.wins).toBeUndefined();
    expect(s.counters.level).toBeUndefined();
  });

  it("show every game in one view: Dungeon groups, the shared dice, then Void", () => {
    const games = achView(emptyAch()).sections.map((x) => x.game);
    expect(games.indexOf("both")).toBeGreaterThan(games.lastIndexOf("dungeon"));
    expect(games.indexOf("void")).toBeGreaterThan(games.indexOf("both"));
  });
});
