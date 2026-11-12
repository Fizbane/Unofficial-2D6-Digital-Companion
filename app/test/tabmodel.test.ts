import { describe, it, expect } from "vitest";
import { TabModel, isTabsState, routeKey, type TabsState } from "../src/shell/tabmodel";

const ids = (m: TabModel): string[] => m.state.tabs.map((t) => t.id);
const cur = (m: TabModel): string | null => (m.active ? m.current(m.active) : null);

describe("routeKey", () => {
  it("strips the ?find= part", () => {
    expect(routeKey("#/s/dungeon/enat1?find=orc")).toBe("#/s/dungeon/enat1");
    expect(routeKey("#/s/dungeon/enat1")).toBe("#/s/dungeon/enat1");
  });
});

describe("TabModel.open", () => {
  it("opens into an empty model by creating a tab", () => {
    const m = new TabModel();
    const t = m.open("#/");
    expect(m.state.tabs).toHaveLength(1);
    expect(m.active).toBe(t);
    expect(t.history).toEqual(["#/"]);
    expect(t.index).toBe(0);
    expect(m.state.active).toBe(t.id);
  });

  it("pushes onto the active tab's history", () => {
    const m = new TabModel();
    m.open("#/");
    const t = m.open("#/play/combat");
    expect(m.state.tabs).toHaveLength(1);
    expect(t.history).toEqual(["#/", "#/play/combat"]);
    expect(t.index).toBe(1);
  });

  it("activates the tab where the route is already open, without a new tab", () => {
    const m = new TabModel();
    const a = m.open("#/s/dungeon/enat1");
    const b = m.open("#/play/combat", { newTab: true });
    expect(m.active).toBe(b);
    const r = m.open("#/s/dungeon/enat1");
    expect(r).toBe(a);
    expect(m.active).toBe(a);
    expect(m.state.tabs).toHaveLength(2);
    expect(b.history).toEqual(["#/play/combat"]);
  });

  it("newTab on a route another tab shows focuses that tab (tree and search clicks)", () => {
    const m = new TabModel();
    const a = m.open("#/");
    const b = m.open("#/play/map", { newTab: true });
    m.activate(a.id);
    expect(m.open("#/play/map", { newTab: true })).toBe(b);
    expect(m.active).toBe(b);
    expect(m.state.tabs).toHaveLength(2);
    expect(b.history).toEqual(["#/play/map"]);
  });

  it("replaces the existing tab's current entry when only ?find differs", () => {
    const m = new TabModel();
    const a = m.open("#/s/dungeon/enat1");
    m.open("#/play/combat", { newTab: true });
    m.open("#/s/dungeon/enat1?find=orc");
    expect(m.active).toBe(a);
    expect(a.history).toEqual(["#/s/dungeon/enat1?find=orc"]);
    expect(a.index).toBe(0);
  });

  it("is a no-op when the route is the active tab's current route", () => {
    const m = new TabModel();
    const t = m.open("#/");
    m.open("#/");
    expect(m.state.tabs).toHaveLength(1);
    expect(t.history).toEqual(["#/"]);
  });

  it("inserts a newTab right of the active tab", () => {
    const m = new TabModel(undefined, (() => { let n = 0; return () => `x${++n}`; })());
    m.open("#/a");
    m.open("#/b", { newTab: true });
    m.activate("x1");
    m.open("#/c", { newTab: true });
    expect(ids(m)).toEqual(["x1", "x3", "x2"]);
    expect(m.state.active).toBe("x3");
  });

  it("truncates forward history when opening after back", () => {
    const m = new TabModel();
    const t = m.open("#/a");
    m.open("#/b");
    m.open("#/c");
    m.back();
    m.back();
    m.open("#/d");
    expect(t.history).toEqual(["#/a", "#/d"]);
    expect(t.index).toBe(1);
  });
});

describe("TabModel.back/forward", () => {
  it("moves the index and returns false at the ends", () => {
    const m = new TabModel();
    expect(m.back()).toBe(false);
    expect(m.forward()).toBe(false);
    m.open("#/a");
    m.open("#/b");
    expect(m.forward()).toBe(false);
    expect(m.back()).toBe(true);
    expect(cur(m)).toBe("#/a");
    expect(m.back()).toBe(false);
    expect(m.forward()).toBe(true);
    expect(cur(m)).toBe("#/b");
    expect(m.forward()).toBe(false);
  });
});

describe("TabModel.close", () => {
  function three(): TabModel {
    const m = new TabModel();
    m.open("#/a");
    m.open("#/b", { newTab: true });
    m.open("#/c", { newTab: true });
    return m; // t1, t2, t3; active t3
  }

  it("activates the right neighbour when closing the active tab", () => {
    const m = three();
    m.activate("t2");
    m.close("t2");
    expect(ids(m)).toEqual(["t1", "t3"]);
    expect(m.state.active).toBe("t3");
  });

  it("activates the left neighbour when closing the rightmost active tab", () => {
    const m = three();
    m.close("t3");
    expect(ids(m)).toEqual(["t1", "t2"]);
    expect(m.state.active).toBe("t2");
  });

  it("leaves active null when closing the only tab", () => {
    const m = new TabModel();
    const t = m.open("#/");
    m.close(t.id);
    expect(m.state.tabs).toEqual([]);
    expect(m.active).toBeNull();
    expect(m.state.active).toBeNull();
  });

  it("keeps the active tab when closing another one", () => {
    const m = three();
    m.close("t1");
    expect(m.state.active).toBe("t3");
  });
});

describe("TabModel.restore", () => {
  it("drops invalid entries and tabs left empty, fixing index and active", () => {
    const state: TabsState = {
      v: 1,
      tabs: [
        { id: "t1", history: ["#/", "#/s/gone", "#/play/combat"], index: 1 },
        { id: "t2", history: ["#/s/gone"], index: 0 },
        { id: "t5", history: ["#/s/gone", "#/a"], index: 0 },
      ],
      active: "t2",
    };
    const m = new TabModel(state);
    m.restore((r) => r !== "#/s/gone");
    expect(m.state.tabs).toEqual([
      { id: "t1", history: ["#/", "#/play/combat"], index: 0 },
      { id: "t5", history: ["#/a"], index: 0 },
    ]);
    expect(m.state.active).toBe("t1");
  });

  it("fixes an active id that points at a missing tab", () => {
    const m = new TabModel({ v: 1, tabs: [{ id: "t1", history: ["#/"], index: 0 }], active: "nope" });
    m.restore(() => true);
    expect(m.state.active).toBe("t1");
  });

  it("sets active to null when every tab is dropped", () => {
    const m = new TabModel({ v: 1, tabs: [{ id: "t1", history: ["#/s/gone"], index: 0 }], active: "t1" });
    m.restore(() => false);
    expect(m.state.tabs).toEqual([]);
    expect(m.state.active).toBeNull();
  });
});

describe("TabModel ids and state", () => {
  it("seeds default ids past the highest restored id", () => {
    const m = new TabModel({ v: 1, tabs: [{ id: "t7", history: ["#/a"], index: 0 }], active: "t7" });
    const t = m.open("#/b", { newTab: true });
    expect(t.id).toBe("t8");
  });

  it("keeps state JSON-serialisable and valid", () => {
    const m = new TabModel();
    m.open("#/a");
    m.open("#/b", { newTab: true });
    const round: unknown = JSON.parse(JSON.stringify(m.state));
    expect(round).toEqual(m.state);
    expect(isTabsState(round)).toBe(true);
  });
});

describe("isTabsState", () => {
  it("accepts a valid state", () => {
    expect(isTabsState({ v: 1, tabs: [], active: null })).toBe(true);
    expect(isTabsState({ v: 1, tabs: [{ id: "t1", history: ["#/"], index: 0 }], active: "t1" })).toBe(true);
  });

  it("rejects malformed states", () => {
    expect(isTabsState({ v: 1, tabs: "x" })).toBe(false);
    expect(isTabsState({ v: 2, tabs: [], active: null })).toBe(false);
    expect(isTabsState(null)).toBe(false);
    expect(isTabsState({ v: 1, tabs: [], active: 3 })).toBe(false);
    expect(isTabsState({ v: 1, tabs: [{ id: "t1", history: [], index: 0 }], active: null })).toBe(false);
    expect(isTabsState({ v: 1, tabs: [{ id: "t1", history: ["#/"], index: 1 }], active: null })).toBe(false);
    expect(isTabsState({ v: 1, tabs: [{ id: "t1", history: ["#/"], index: 0.5 }], active: null })).toBe(false);
    expect(isTabsState({ v: 1, tabs: [{ id: 1, history: ["#/"], index: 0 }], active: null })).toBe(false);
    expect(isTabsState({ v: 1, tabs: [{ id: "t1", history: [1], index: 0 }], active: null })).toBe(false);
  });
});

describe("TabModel one live copy of each tool", () => {
  it("back onto a tool another tab already shows activates that tab and leaves this tab's index", () => {
    const m = new TabModel();
    m.open("#/play/dungeon");
    m.open("#/s/rules");
    m.open("#/", { newTab: true });
    m.open("#/play/dungeon"); // t1 now shows #/s/rules, so this opens in t2
    expect(ids(m)).toEqual(["t1", "t2"]);
    expect(cur(m)).toBe("#/play/dungeon");
    m.activate("t1");
    expect(m.back()).toBe(true);
    expect(m.state.active).toBe("t2");
    const t1 = m.state.tabs[0];
    expect(t1.index).toBe(1);
    expect(m.current(t1)).toBe("#/s/rules");
  });

  it("forward onto a tool another tab already shows activates that tab", () => {
    const m = new TabModel();
    m.open("#/s/a");
    m.open("#/play/sheet");
    m.back();
    m.open("#/", { newTab: true });
    m.open("#/play/sheet"); // not current anywhere: opens in t2
    expect(m.state.active).toBe("t2");
    m.activate("t1");
    expect(m.forward()).toBe(true);
    expect(m.state.active).toBe("t2");
    expect(m.state.tabs[0].index).toBe(0);
  });

  it("book sections may still be current in two tabs via back", () => {
    const m = new TabModel();
    m.open("#/s/a");
    m.open("#/s/b");
    m.open("#/", { newTab: true });
    m.open("#/s/a");
    m.activate("t1");
    m.back();
    expect(m.state.active).toBe("t1");
    expect(cur(m)).toBe("#/s/a");
  });
});

describe("TabModel history cap", () => {
  it("keeps at most 50 entries per tab, dropping the oldest", () => {
    const m = new TabModel();
    for (let i = 0; i < 60; i++) m.open(`#/s/p${i}`);
    const t = m.active!;
    expect(t.history).toHaveLength(50);
    expect(t.history[0]).toBe("#/s/p10");
    expect(t.index).toBe(49);
    expect(m.current(t)).toBe("#/s/p59");
    m.back();
    expect(cur(m)).toBe("#/s/p58");
  });
});
