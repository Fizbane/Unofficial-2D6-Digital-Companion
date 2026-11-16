import { describe, it, expect } from "vitest";
import { SHEET_TABS, isSheetTab, statTiles, stepTab } from "../../src/tools/void/sheetlayout";
import { ICON_NAMES } from "../../src/ui/icon";

describe("void sheet layout", () => {
  it("lists each panel tab once, with an icon the sprite has", () => {
    const ids = SHEET_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["items", "story", "rest"]); // stims and task experience are on the columns now
    for (const t of SHEET_TABS) expect(ICON_NAMES as readonly string[]).toContain(t.icon);
  });

  it("accepts only its own tab ids (a saved tab from an older build falls back)", () => {
    expect(isSheetTab("items")).toBe(true);
    expect(isSheetTab("combat")).toBe(false);
    expect(isSheetTab("stims")).toBe(false);
    expect(isSheetTab(null)).toBe(false);
  });

  it("moves between tabs with the arrow, Home and End keys, wrapping round", () => {
    expect(stepTab("items", "ArrowRight")).toBe("story");
    expect(stepTab("rest", "ArrowRight")).toBe("items");
    expect(stepTab("items", "ArrowLeft")).toBe("rest");
    expect(stepTab("story", "Home")).toBe("items");
    expect(stepTab("story", "End")).toBe("rest");
    expect(stepTab("story", "Enter")).toBeNull();
  });

  it("draws stat tiles with an optional line under the value, escaping text", () => {
    expect(String(statTiles([["Shift", "+2"], ["Level", "3", "<Salvager>"]]))).toBe(
      '<dl class="vs-tiles"><div class="vs-tile"><dt>Shift</dt><dd>+2</dd></div>' +
        '<div class="vs-tile"><dt>Level</dt><dd>3</dd><dd class="vs-tile-sub">&lt;Salvager&gt;</dd></div></dl>',
    );
  });
});
