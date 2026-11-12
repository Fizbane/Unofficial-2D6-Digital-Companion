import { describe, it, expect } from "vitest";
import { breakpointOf, clampWidth, defaultLayout, gridColumns, isLayoutState, lastContext, MAX_W, MIN_W, railMode } from "../src/shell/layout";

describe("isLayoutState", () => {
  it("accepts the default and keeps unknown extra fields valid", () => {
    expect(isLayoutState(defaultLayout())).toBe(true);
    expect(isLayoutState({ ...defaultLayout(), rail: "play" })).toBe(true);
  });
  it("rejects garbage and other versions", () => {
    for (const v of [null, "garbage", 3, [], { v: 2, tree: 1, panel: 1, treeCollapsed: false, panelCollapsed: false }])
      expect(isLayoutState(v)).toBe(false);
    expect(isLayoutState({ ...defaultLayout(), tree: "wide" })).toBe(false);
    expect(isLayoutState({ ...defaultLayout(), panel: NaN })).toBe(false);
    expect(isLayoutState({ ...defaultLayout(), treeCollapsed: 1 })).toBe(false);
  });
});

describe("clampWidth", () => {
  it("keeps widths between 200 and 480", () => {
    expect(clampWidth(10)).toBe(MIN_W);
    expect(clampWidth(9999)).toBe(MAX_W);
    expect(clampWidth(300.4)).toBe(300);
  });
});

describe("gridColumns", () => {
  it("sizes rail, tree, centre and panel; collapsed panes take 0", () => {
    expect(gridColumns(defaultLayout())).toBe("var(--rail-w) 280px minmax(0, 1fr) 340px");
    expect(gridColumns({ ...defaultLayout(), treeCollapsed: true, panel: 900 })).toBe("var(--rail-w) 0px minmax(0, 1fr) 480px");
    expect(gridColumns({ ...defaultLayout(), panelCollapsed: true })).toBe("var(--rail-w) 280px minmax(0, 1fr) 0px");
  });
});

describe("railMode", () => {
  it("reads the saved rail mode and treats old or bad layouts as Library", () => {
    expect(railMode({ ...defaultLayout(), rail: "play" })).toBe("play");
    expect(railMode({ ...defaultLayout(), rail: "library" })).toBe("library");
    expect(railMode(defaultLayout())).toBe("library"); // saved before the rail existed
    expect(railMode({ ...defaultLayout(), rail: 7 })).toBe("library");
    // an old saved layout still validates
    expect(isLayoutState({ v: 1, tree: 300, panel: 340, treeCollapsed: true, panelCollapsed: false })).toBe(true);
  });
});

describe("gridColumns by breakpoint", () => {
  it("mid keeps the tree and gives the panel a slim strip; narrow leaves only the centre", () => {
    expect(gridColumns(defaultLayout(), "mid")).toBe("var(--rail-w) 280px minmax(0, 1fr) var(--strip-w)");
    expect(gridColumns({ ...defaultLayout(), treeCollapsed: true }, "mid")).toBe("var(--rail-w) 0px minmax(0, 1fr) var(--strip-w)");
    expect(gridColumns(defaultLayout(), "narrow")).toBe("0px 0px minmax(0, 1fr) 0px");
  });
});

describe("breakpointOf", () => {
  it("splits at 900 and 1280", () => {
    expect(breakpointOf(1440)).toBe("wide");
    expect(breakpointOf(1280)).toBe("wide");
    expect(breakpointOf(1279)).toBe("mid");
    expect(breakpointOf(900)).toBe("mid");
    expect(breakpointOf(899)).toBe("narrow");
    expect(breakpointOf(390)).toBe("narrow");
  });
});

describe("lastContext", () => {
  it("read the saved fields and ignore old or bad values", () => {
    expect(lastContext(defaultLayout())).toBeNull();
    expect(lastContext({ ...defaultLayout(), lastContext: "realm" })).toBe("realm");
    expect(lastContext({ ...defaultLayout(), lastContext: "combat" })).toBeNull();
    // a layout saved with the removed Hide UI flag still loads (the flag is ignored)
    expect(isLayoutState({ ...defaultLayout(), hideUI: true, lastContext: "dungeon" })).toBe(true);
  });
});
