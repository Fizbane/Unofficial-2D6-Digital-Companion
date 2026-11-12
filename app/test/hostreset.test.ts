// A content change (an unlock or a Lock) must leave no book text in hidden tabs' DOM.
import { describe, expect, it, vi } from "vitest";
import { resetForContentChange, type HostLike } from "../src/shell/hostreset";

const host = (route: string | null) => {
  const el = { hidden: false, replaceChildren: vi.fn() };
  return { el, route, page: {}, token: 0 } as HostLike & { el: typeof el };
};
const isTool = (r: string) => r.startsWith("#/play/");

describe("resetForContentChange", () => {
  it("a Lock (content removed) empties every hidden tab, section and tool alike", () => {
    const shownSection = host("#/s/codex%2Fp1-1");
    const hiddenSection = host("#/s/codex%2Fp2-1");
    const hiddenTool = host("#/play/dungeon");
    const hiddenHome = host("#/");
    const hosts = new Map<string, HostLike>([["a", shownSection], ["b", hiddenSection], ["c", hiddenTool], ["d", hiddenHome]]);
    const dispose = vi.fn();
    resetForContentChange(hosts, "a", isTool, dispose, true);
    for (const h of [hiddenSection, hiddenTool, hiddenHome]) {
      expect(h.el.replaceChildren).toHaveBeenCalledTimes(1);
      expect(h.route).toBeNull();
      expect(h.page).toBeNull();
      expect(h.token).toBe(1);                                     // a mount still in flight is dropped
      expect(dispose).toHaveBeenCalledWith(h);
    }
    expect(shownSection.route).toBeNull();                         // re-mounted by sync()
    expect(shownSection.el.replaceChildren).not.toHaveBeenCalled();
  });

  it("leaves the shown tool to redraw itself", () => {
    const tool = host("#/play/realm");
    const dispose = vi.fn();
    resetForContentChange(new Map([["a", tool]]), "a", isTool, dispose, true);
    expect(tool.route).toBe("#/play/realm");
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("resetForContentChange on an unlock (nothing removed)", () => {
  it("keeps a hidden tool host (and its half-filled form) and only marks section hosts stale", () => {
    const tool = host("#/play/combat");
    const section = host("#/s/codex%2Fp2-1");
    const shown = host("#/");
    const dispose = vi.fn();
    resetForContentChange(new Map<string, HostLike>([["a", shown], ["b", tool], ["c", section]]), "a", isTool, dispose, false);
    expect(dispose).not.toHaveBeenCalled();
    expect(tool.route).toBe("#/play/combat");
    expect(tool.el.replaceChildren).not.toHaveBeenCalled();
    expect(section.route).toBeNull();                              // re-mounts when shown
    expect(section.el.replaceChildren).not.toHaveBeenCalled();
    expect(shown.route).toBeNull();
  });

  it("then a Lock does dispose that hidden tool host", () => {
    const tool = host("#/play/combat");
    const dispose = vi.fn();
    resetForContentChange(new Map<string, HostLike>([["a", host("#/")], ["b", tool]]), "a", isTool, dispose, true);
    expect(dispose).toHaveBeenCalledWith(tool);
    expect(tool.el.replaceChildren).toHaveBeenCalled();
  });
});
