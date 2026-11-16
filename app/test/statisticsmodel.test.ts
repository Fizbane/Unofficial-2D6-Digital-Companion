import { describe, expect, it } from "vitest";
import { emptyStats, isRfutDeath, normalizeStats, onStatDeath, onStatDice, onStatEscape, onStatFight, onStatRoom, onStatSaved, statsView, type StatsState } from "../src/shell/statisticsmodel";
import type { JournalFightEvent, JournalRoomEvent } from "../src/shell/events";

const room = (over: Partial<JournalRoomEvent> = {}): JournalRoomEvent =>
  ({ phase: "finish", level: 1, n: 1, kind: "regular", w: 3, h: 3, ...over }) as JournalRoomEvent;
const won = (foes: string[], rounds = 2): JournalFightEvent => ({ phase: "end", outcome: "won", foes, rounds, xp: 10 });
const lost = (foes: string[], rounds = 2): JournalFightEvent => ({ phase: "end", outcome: "lost", foes, rounds, xp: 0 });

describe("statistics model", () => {
  it("a finished room bumps rooms and its kind; a title is counted only when set", () => {
    const s = emptyStats();
    onStatRoom(s, room({ kind: "large", title: "Ancient Hall" }), 1);
    onStatRoom(s, room({ kind: "corridor" }), 2);
    expect(s.totals.rooms).toBe(2);
    expect(s.totals["roomsKind:large"]).toBe(1);
    expect(s.totals["roomsKind:corridor"]).toBe(1);
    expect(s.roomTypes).toEqual({ "Ancient Hall": 1 });
  });

  it("a won fight adds one defeat per foe, by name", () => {
    const s = emptyStats();
    onStatFight(s, won(["Goblin", "Goblin"]), 1);
    expect(s.totals.foesDefeated).toBe(2);
    expect(s.totals.fightsWon).toBe(1);
    expect(s.foes).toEqual({ Goblin: 2 });
  });

  it("a fight with zero foes adds nothing to the foes list", () => {
    const s = emptyStats();
    onStatFight(s, won([]), 1);
    expect(s.foes).toEqual({});
    expect(s.totals.foesDefeated ?? 0).toBe(0);
  });

  it("longestFight keeps the most rounds seen", () => {
    const s = emptyStats();
    onStatFight(s, won(["A"], 5), 1);
    onStatFight(s, won(["A"], 2), 2);
    expect(s.totals.longestFight).toBe(5);
  });

  it("dice [3,4] add two dice and no double", () => {
    const s = emptyStats();
    onStatDice(s, [3, 4], 1);
    expect(s.totals.dice).toBe(2);
    expect(s.totals.doubles ?? 0).toBe(0);
  });

  it("dice [5,5] add two dice and one double", () => {
    const s = emptyStats();
    onStatDice(s, [5, 5], 1);
    expect(s.totals.dice).toBe(2);
    expect(s.totals.doubles).toBe(1);
  });

  it("one die and three dice count their dice, never a double", () => {
    const s = emptyStats();
    onStatDice(s, [6], 1);
    onStatDice(s, [2, 2, 2], 2);
    expect(s.totals.dice).toBe(4);
    expect(s.totals.doubles ?? 0).toBe(0);
  });

  it("a room opens an adventure, and a death ends it into past", () => {
    const s = emptyStats();
    onStatRoom(s, room({ level: 2 }), 10);
    expect(s.current).not.toBeNull();
    expect(s.current!.rooms).toBe(1);
    expect(s.current!.deepest).toBe(2);
    onStatDeath(s, 20);
    expect(s.current).toBeNull();
    expect(s.past).toHaveLength(1);
    expect(s.past[0]).toMatchObject({ rooms: 1, deepest: 2, startedAt: 10, endedAt: 20, how: "death" });
    expect(s.totals.adventures).toBe(1);
  });

  it("the Escape Pod ends the adventure as an escape, not a death", () => {
    const s = emptyStats();
    onStatRoom(s, room(), 10);
    onStatEscape(s, 20);
    expect(s.current).toBeNull();
    expect(s.past[0]).toMatchObject({ endedAt: 20, how: "escape" });
    expect(s.totals.adventures).toBe(1);
  });

  it("the Escape Pod with no open adventure records nothing", () => {
    const s = emptyStats();
    onStatEscape(s, 5);
    expect(s.past).toEqual([]);
    expect(s.totals.adventures ?? 0).toBe(0);
  });

  it("a death with no open adventure records nothing", () => {
    const s = emptyStats();
    onStatDeath(s, 1);
    expect(s.past).toEqual([]);
    expect(s.totals.adventures ?? 0).toBe(0);
  });

  it("a lost fight ends the adventure as a death", () => {
    const s = emptyStats();
    onStatRoom(s, room(), 10);
    onStatFight(s, lost(["Orc"]), 20);
    expect(s.current).toBeNull();
    expect(s.past[0]).toMatchObject({ endedAt: 20, fights: 1 });
    expect(s.totals.fightsLost).toBe(1);
    expect(s.totals.adventures).toBe(1);
    expect(s.foes).toEqual({});
  });

  it("a companion save reopens the adventure that the lost fight ended", () => {
    const s = emptyStats();
    onStatRoom(s, room(), 10);
    onStatFight(s, lost(["Orc"]), 20);
    onStatSaved(s);
    expect(s.past).toEqual([]);
    expect(s.current).toMatchObject({ startedAt: 10, endedAt: 0, rooms: 1, fights: 1 });
    expect(s.totals.adventures).toBe(0);
    expect(s.totals.fightsLost).toBe(1);
  });

  it("a companion save with no pending death does nothing", () => {
    const s = emptyStats();
    onStatRoom(s, room(), 10);
    onStatSaved(s);
    expect(s.current).not.toBeNull();
    expect(s.past).toEqual([]);
  });

  it("an RFUT1 result ends the adventure, and cannot be saved", () => {
    const s = emptyStats();
    onStatRoom(s, room(), 10);
    onStatDeath(s, 30);
    onStatSaved(s);
    expect(s.past).toHaveLength(1);
    expect(s.current).toBeNull();
  });

  it("isRfutDeath matches an RFUT1 result that says the adventure is over", () => {
    expect(isRfutDeath({ eyebrow: "RFUT1 · Recovery from unconsciousness", title: "Blackness...your adventure is over.", text: "" })).toBe(true);
    expect(isRfutDeath({ eyebrow: "RFUT1 · Recovery from unconsciousness", title: "You have 2 HP.", text: "" })).toBe(false);
    expect(isRfutDeath({ eyebrow: "POLT1 · Lever", title: "Your adventure is over.", text: "" })).toBe(false);
  });

  it("past keeps only the last 20 adventures, newest first", () => {
    const s = emptyStats();
    for (let i = 0; i < 25; i++) {
      onStatRoom(s, room({ n: i + 1 }), i * 10);
      onStatDeath(s, i * 10 + 5);
    }
    expect(s.past).toHaveLength(20);
    expect(s.past[0].rooms).toBe(1);
    expect(s.past[0].id).toBeGreaterThan(s.past[19].id);
  });

  it("normalizeStats drops non-numeric totals and keeps the rest", () => {
    const raw = { v: 1, totals: { rooms: 4, bad: "x" }, roomTypes: { Hall: -3 }, foes: { Imp: 2 }, current: null, past: [], nextId: 1 } as unknown as StatsState;
    const s = normalizeStats(raw);
    expect(s.totals).toEqual({ rooms: 4 });
    expect(s.roomTypes).toEqual({});
    expect(s.foes).toEqual({ Imp: 2 });
  });

  it("normalizeStats drops an adventure with a date the page cannot show", () => {
    const bad = { id: 1, startedAt: 0, endedAt: 1e17, rooms: 0, fights: 0, foesDefeated: 0, deepest: 0 };
    const s = normalizeStats({ ...emptyStats(), past: [bad] });
    expect(s.past).toEqual([]);
  });

  it("statsView sorts room types and foes highest first", () => {
    const s = emptyStats();
    s.roomTypes = { Hall: 1, Cave: 5 };
    s.foes = { Imp: 2, Orc: 9 };
    const v = statsView(s);
    expect(v.roomTypes[0]).toEqual(["Cave", 5]);
    expect(v.foes[0]).toEqual(["Orc", 9]);
  });
});
