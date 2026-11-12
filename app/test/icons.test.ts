import { describe, it, expect } from "vitest";
import sprite from "../public/icons.svg?raw";
import { ICON_NAMES, icon } from "../src/ui/icon";

describe("icons", () => {
  it("the committed sprite has a symbol for every IconName", () => {
    for (const n of ICON_NAMES) expect(sprite, n).toContain(`<symbol id="i-${n}"`);
  });

  it("icon() is decorative by default, labelled when asked", () => {
    expect(String(icon("dice"))).toBe('<svg class="icon" width="18" height="18" aria-hidden="true"><use href="#i-dice"></use></svg>');
    expect(String(icon("x", { size: 14, label: 'Close "tab"' }))).toBe(
      '<svg class="icon" width="14" height="14" role="img" aria-label="Close &quot;tab&quot;"><use href="#i-x"></use></svg>',
    );
  });
});
