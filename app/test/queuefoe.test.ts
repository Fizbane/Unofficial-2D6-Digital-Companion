import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { queueFoe } from "../src/tools/combat";
import { load, save } from "../src/tools/common";
import type { Section } from "../src/types";

const card = (name: string): Section =>
  ({ id: `codex/${name.toLowerCase()}`, title: name, blocks: [{ type: "table", table: { title: name, dice: null, columns: ["FIELD", "VALUE"], rows: [["NAME", name], ["HP", "6"], ["LEVEL / TYPE", "L1"], ["XP", "3"], ["MANOEUVRE", "[1] [2] - Slash = D6+1"]] } }] }) as unknown as Section;
const foe = { key: "RAT|1", name: "RAT", level: 1, type: "", hp: 2, xp: 1, id: 1, hpNow: 0 };
const fight = (phase: string) => ({ foes: [foe], round: 3, fatigue: 1, phase, target: null, attack: null, foeTurn: 0, acted: [], foesFirst: false, killedRound1: false, log: ["x"], nextId: 2, xpBanked: false });
type Saved = { phase: string; foes: { name: string }[]; round: number };
const saved = () => load<Saved>("combat", { phase: "", foes: [], round: 0 });

describe("queueFoe", () => {
  const g = globalThis as { localStorage?: unknown };
  beforeEach(() => {
    const data: Record<string, string> = {};
    g.localStorage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), removeItem: (k: string) => void delete data[k] };
  });
  afterEach(() => delete g.localStorage);

  it("adds the creature to a fight being set up", () => {
    expect(queueFoe(card("GUARD"))).toBeNull();
    expect(saved().foes.map((f) => f.name)).toEqual(["GUARD"]);
  });

  it.each(["won", "lost"])("starts a new fight when the last one is over (%s)", (phase) => {
    save("combat", fight(phase));
    expect(queueFoe(card("GUARD"))).toBeNull();
    const s = saved();
    expect(s.phase).toBe("setup");
    expect(s.round).toBe(1);
    expect(s.foes.map((f) => f.name)).toEqual(["GUARD"]);
  });

  it.each(["you", "foes"])("leaves a fight that is under way alone (%s)", (phase) => {
    save("combat", fight(phase));
    expect(queueFoe(card("GUARD"))).toMatch(/already under way/);
    const s = saved();
    expect(s.phase).toBe(phase);
    expect(s.foes.map((f) => f.name)).toEqual(["RAT"]);
  });
});
