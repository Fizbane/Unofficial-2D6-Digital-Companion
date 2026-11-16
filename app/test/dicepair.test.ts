// Dice looks: Die 1 and Die 2 throw every D6 and 2D6 and may look the same; a D66 throws the tens die (its own
// setting) beside Die 1, and the tens die never looks like Die 1, in either game.
import { afterEach, describe, expect, it, vi } from "vitest";

async function forGame(g: "dungeon" | "void", stored?: Record<string, unknown>) {
  vi.resetModules();
  const d: Record<string, string> = stored ? { [g === "void" ? "2d6v:dice-settings" : "2d6:dice-settings"]: JSON.stringify({ enabled: false, ...stored }) } : {};
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => d[k] ?? null, setItem: (k: string, v: string) => void (d[k] = v), removeItem: (k: string) => void delete d[k],
    key: () => null, length: 0, clear: () => {},
  };
  const games = await import("../src/games");
  games._setGameForTest(g);
  return import("../src/dice3d"); // its looks and settings key are picked for the game at load
}
afterEach(() => void delete (globalThis as { localStorage?: unknown }).localStorage);

const neon = { look: "neon", color: "", name: "" };

describe("distinctPair", () => {
  it("keeps a pair that already differs", async () => {
    const { distinctPair, DEFAULT_SETTINGS } = await forGame("dungeon");
    const [a, b] = DEFAULT_SETTINGS.dice;
    expect(distinctPair(a, b)).toEqual([a, b]);
  });

  it("Dungeon: the same tintable look and nearly the same colour gives a contrasting colour", async () => {
    const { distinctPair } = await forGame("dungeon");
    const red = { look: "classic", color: "#b8432a", name: "Red" };
    expect(distinctPair(red, { ...red })[1].color).not.toBe(red.color);
    expect(distinctPair(red, { look: "classic", color: "#b9442b", name: "Red too" })[1].color).not.toBe("#b9442b");
  });

  it("a skin that can't be recoloured gets its partner", async () => {
    expect((await forGame("dungeon")).distinctPair({ look: "gold", color: "", name: "" }, { look: "gold", color: "", name: "" })[1].look).toBe("silver");
    expect((await forGame("void")).distinctPair({ look: "hologram", color: "", name: "" }, { look: "hologram", color: "", name: "" })[1].look).toBe("plasma");
  });
});

describe("rolls", () => {
  it("D66 throws the tens die first and Die 1 as the units", async () => {
    const d = await forGame("dungeon", { dice: [{ look: "classic", color: "#b8432a", name: "Red" }, { look: "classic", color: "#e9dfc7", name: "Ivory" }], tensDie: { look: "gold", color: "", name: "Gold" } });
    const r = await d.rollDice("D66");
    expect(r.text).toMatch(/Gold \d tens, Red \d units/);
  });

  it("D66: a tens die set like Die 1 is thrown looking different", async () => {
    const d = await forGame("void", { dice: [neon, neon], tensDie: neon });
    const r = await d.rollDice("D66");
    expect(r.text).toMatch(/Hyperspace \d tens, Neon grid \d units/);
  });

  it("2D6 may throw two dice that look the same", async () => {
    const d = await forGame("void", { dice: [neon, neon], tensDie: { look: "saberRed", color: "", name: "" } });
    const r = await d.rollDice("2D6");
    expect(r.text).toMatch(/^Neon grid \d \+ Neon grid \d = \d+$/);
  });

  it("settings from before the tens die keep the old tens die as the Primary die", async () => {
    const d = await forGame("dungeon", { dice: [{ look: "classic", color: "#b8432a", name: "Red" }, { look: "classic", color: "#e9dfc7", name: "Ivory" }], tens: 1 });
    const s = d.getSettings();
    expect(s.dice[0].name).toBe("Ivory");
    expect(s.tens).toBe(0);
    expect(s.tensDie.look).toBe("gold");
  });

  it("a malformed tens die falls back to the game's default", async () => {
    const d = await forGame("void", { tensDie: { look: "no-such-look" } });
    expect(d.getSettings().tensDie.look).toBe("saberRed");
  });
});
