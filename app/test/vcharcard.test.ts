import { describe, expect, it } from "vitest";
import { normaliseVChar, vstats } from "../src/tools/void/sheetmodel";
import { voidCharCard } from "../src/shell/vcharbar";

describe("Void survivor flyout card", () => {
  const c = normaliseVChar({ name: "Rook <b>", profession: "Bounty Hunter", hp: 7, xp: 0 });
  const card = String(voidCharCard(c, vstats(c)));
  it("shows the survivor's name (escaped), level, HP and the sheet button", () => {
    expect(card).toContain("Rook &lt;b&gt;");
    expect(card).toContain("Bounty Hunter");
    expect(card).toContain('data-vhp="-1"');
    expect(card).toContain('data-vhp="1"');
    expect(card).toContain("data-open-sheet");
    expect(card).toContain("Marksmanship");
  });
});
