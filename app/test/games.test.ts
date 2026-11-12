import { afterEach, describe, expect, it } from "vitest";
import { GAMES, GAME_IDS, _setGameForTest, byGame, gk, isAppKey, isGameId, keyFor } from "../src/games";

afterEach(() => _setGameForTest("dungeon"));

describe("games registry", () => {
  it("knows both games, each with its own library file and logo", () => {
    expect(GAME_IDS).toEqual(["dungeon", "void"]);
    expect(GAMES.dungeon.libraryUrl).not.toBe(GAMES.void.libraryUrl);
    expect(GAMES.dungeon.logo).not.toBe(GAMES.void.logo);
  });

  it("validates game ids", () => {
    expect(isGameId("void")).toBe(true);
    expect(isGameId("realm")).toBe(false);
    expect(isGameId(null)).toBe(false);
  });

  it("picks values by the current game", () => {
    expect(byGame({ dungeon: 1, void: 2 })).toBe(1);
    _setGameForTest("void");
    expect(byGame({ dungeon: 1, void: 2 })).toBe(2);
  });
});

describe("saved-state keys", () => {
  it("leaves Dungeon keys as they were, so old saves load", () => {
    expect(keyFor("2d6:play:sheet", "dungeon")).toBe("2d6:play:sheet");
    expect(gk("2d6:bookmarks")).toBe("2d6:bookmarks");
  });

  it("gives Void its own keys", () => {
    expect(keyFor("2d6:play:vsheet", "void")).toBe("2d6v:play:vsheet");
    expect(keyFor("2d6:theme", "void")).toBe("2d6v:theme");
    _setGameForTest("void");
    expect(gk("2d6:journal")).toBe("2d6v:journal");
  });

  it("shares only the game choice, shell prefs and panel layout", () => {
    for (const k of ["2d6:game", "2d6:shell:prefs", "2d6:shell:layout"]) expect(keyFor(k, "void")).toBe(k);
    expect(keyFor("other", "void")).toBe("other");
  });

  it("counts both games' keys as app data for backups", () => {
    expect(isAppKey("2d6:play:sheet")).toBe(true);
    expect(isAppKey("2d6v:play:vsheet")).toBe(true);
    expect(isAppKey("dice-box")).toBe(false);
  });
});
