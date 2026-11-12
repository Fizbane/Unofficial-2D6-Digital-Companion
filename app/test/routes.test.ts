import { describe, it, expect } from "vitest";
import { applyHash, isValidRouteWith, normalizeRoute, parseRoute } from "../src/shell/routes";
import { TabModel } from "../src/shell/tabmodel";

describe("parseRoute", () => {
  it("parses sections with and without ?find=", () => {
    expect(parseRoute("#/s/dungeon%2Fenat1")).toEqual({ kind: "section", id: "dungeon/enat1", find: null });
    expect(parseRoute("#/s/enat1?find=orc%20king")).toEqual({ kind: "section", id: "enat1", find: "orc king" });
  });
  it("parses tools and falls back to home", () => {
    expect(parseRoute("#/play/combat")).toEqual({ kind: "tool", id: "combat" });
    expect(parseRoute("#/")).toEqual({ kind: "home" });
    expect(parseRoute("")).toEqual({ kind: "home" });
    expect(parseRoute("#/nope")).toEqual({ kind: "home" });
  });
  it("survives malformed escapes", () => {
    expect(parseRoute("#/s/%E0%A4%A")).toEqual({ kind: "section", id: "%E0%A4%A", find: null });
  });
});

describe("normalizeRoute", () => {
  it("maps empty hashes to home", () => {
    expect(normalizeRoute("")).toBe("#/");
    expect(normalizeRoute("#")).toBe("#/");
    expect(normalizeRoute("#/play/sheet")).toBe("#/play/sheet");
  });
});

describe("isValidRouteWith", () => {
  const has = (id: string) => id === "a" || id === "b/c";
  const tools = ["dungeon", "settings"];
  it("accepts home, existing sections and known tools", () => {
    expect(isValidRouteWith("#/", has, tools)).toBe(true);
    expect(isValidRouteWith("#/s/a", has, tools)).toBe(true);
    expect(isValidRouteWith("#/s/b%2Fc?find=x", has, tools)).toBe(true);
    expect(isValidRouteWith("#/play/settings", has, tools)).toBe(true);
  });
  it("rejects missing sections, unknown tools and junk", () => {
    expect(isValidRouteWith("#/s/zzz", has, tools)).toBe(false);
    expect(isValidRouteWith("#/play/mapwindow", has, tools)).toBe(false);
    expect(isValidRouteWith("#/play/dungeon-x", has, tools)).toBe(false);
    expect(isValidRouteWith("", has, tools)).toBe(false);
    expect(isValidRouteWith("garbage", has, tools)).toBe(false);
  });
});

describe("applyHash", () => {
  it("steps back and forward within the active tab", () => {
    const m = new TabModel();
    m.open("#/s/a");
    m.open("#/s/b");
    expect(applyHash(m, "#/s/a")).toBe(true);
    expect(m.state.tabs).toHaveLength(1);
    expect(m.active!.index).toBe(0);
    expect(applyHash(m, "#/s/b")).toBe(true);
    expect(m.active!.index).toBe(1);
  });
  it("ignores the hash the active tab already shows", () => {
    const m = new TabModel();
    m.open("#/");
    expect(applyHash(m, "")).toBe(false);
    expect(applyHash(m, "#/")).toBe(false);
  });
  it("focuses a tab already showing the route, else opens in the current tab", () => {
    const m = new TabModel();
    m.open("#/s/a");
    m.open("#/play/combat", { newTab: true });
    applyHash(m, "#/s/a");
    expect(m.state.tabs).toHaveLength(2);
    expect(m.current(m.active!)).toBe("#/s/a");
    applyHash(m, "#/s/x");
    expect(m.state.tabs).toHaveLength(2);
    expect(m.active!.history).toEqual(["#/s/a", "#/s/x"]);
  });
});

describe("applyHash validation", () => {
  const valid = (r: string) => isValidRouteWith(r, (id) => id === "a", ["dungeon"]);
  it("opens Home for an invalid typed route", () => {
    const m = new TabModel();
    m.open("#/s/a");
    expect(applyHash(m, "#/play/mapwindow", valid)).toBe(true);
    expect(m.current(m.active!)).toBe("#/");
    expect(m.state.tabs).toHaveLength(1);
  });
  it("opens a valid route as before", () => {
    const m = new TabModel();
    m.open("#/");
    applyHash(m, "#/play/dungeon", valid);
    expect(m.current(m.active!)).toBe("#/play/dungeon");
  });
  it("browser back onto a tool live in another tab activates that tab", () => {
    const m = new TabModel();
    m.open("#/play/dungeon");
    m.open("#/s/a");
    m.open("#/", { newTab: true });
    m.open("#/play/dungeon");
    m.activate("t1");
    expect(applyHash(m, "#/play/dungeon", valid)).toBe(true);
    expect(m.state.active).toBe("t2");
    expect(m.state.tabs[0].index).toBe(1);
  });
});
