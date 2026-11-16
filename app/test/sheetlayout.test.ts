import { describe, it, expect } from "vitest";
import { DSHEET_TABS, dsheetTabs, isDSheetTab, stepIn, tiles } from "../src/tools/sheetlayout";
import { ICON_NAMES } from "../src/ui/icon";

describe("dungeon sheet layout", () => {
  it("lists each panel tab once, with an icon the sprite has", () => {
    const ids = DSHEET_TABS.map((t) => t.id);
    expect(ids).toEqual(["items", "story", "companion"]);
    for (const t of DSHEET_TABS) expect(ICON_NAMES as readonly string[]).toContain(t.icon);
  });

  it("shows the Companion tab only to a character who plays with Animal Companions", () => {
    expect(dsheetTabs(false).map((t) => t.id)).toEqual(["items", "story"]);
    expect(dsheetTabs(true).map((t) => t.id)).toEqual(["items", "story", "companion"]);
  });

  it("accepts only its own tab ids", () => {
    expect(isDSheetTab("story")).toBe(true);
    expect(isDSheetTab("stims")).toBe(false);
    expect(isDSheetTab(undefined)).toBe(false);
  });

  it("steps through a tab list with the arrow, Home and End keys, wrapping round", () => {
    const ids = ["items", "story"] as const;
    expect(stepIn(ids, "items", "ArrowRight")).toBe("story");
    expect(stepIn(ids, "story", "ArrowRight")).toBe("items");
    expect(stepIn(ids, "items", "ArrowLeft")).toBe("story");
    expect(stepIn(ids, "story", "Home")).toBe("items");
    expect(stepIn(ids, "items", "End")).toBe("story");
    expect(stepIn(ids, "items", "a")).toBeNull();
    expect(stepIn([], "items", "ArrowRight")).toBeNull();
  });

  it("draws stat tiles under the given class prefix, escaping text", () => {
    expect(String(tiles("ds", [["Shift", "+2"], ["Level", "3", "<Adept>"]]))).toBe(
      '<dl class="ds-tiles"><div class="ds-tile"><dt>Shift</dt><dd>+2</dd></div>' +
        '<div class="ds-tile"><dt>Level</dt><dd>3</dd><dd class="ds-tile-sub">&lt;Adept&gt;</dd></div></dl>',
    );
  });
});
