import { describe, expect, it } from "vitest";
import { VOID_UNLOCK_ROUTE, guardRoute } from "../src/shell/voidgate";
import { DRIVETHRU_URL, DR_GAMES_URL, voidIntroHtml, voidUnlockNotice } from "../src/ui/voidintro";

describe("Void gate", () => {
  it("lets everything through when not locked", () => {
    expect(guardRoute("#/", false)).toBeNull();
    expect(guardRoute("#/play/vhulk", false)).toBeNull();
  });
  it("sends every route but Settings to Settings while locked", () => {
    for (const r of ["#/", "#/play/vhulk", "#/play/vcombat", "#/play/vmap", "#/s/void/combat", "#/play/achievements"])
      expect(guardRoute(r, true)).toBe(VOID_UNLOCK_ROUTE);
    expect(guardRoute(VOID_UNLOCK_ROUTE, true)).toBeNull();
  });
});

describe("Void intro popup", () => {
  const popup = String(voidIntroHtml());
  it("says it is a paid game that needs the core rulebook", () => {
    expect(popup).toContain("paid game");
    expect(popup).toContain("core rulebook");
    expect(popup).toContain('role="dialog"');
    expect(popup).toContain('aria-modal="true"');
  });
  it("links to DR Games and DriveThruRPG in a new tab, safely", () => {
    expect(DR_GAMES_URL).toBe("https://drgames.co.uk/");
    expect(DRIVETHRU_URL).toBe("https://www.drivethrurpg.com/en/publisher/15325/dr-games");
    for (const url of [DR_GAMES_URL, DRIVETHRU_URL]) {
      const a = popup.match(new RegExp(`<a href="${url.replace(/[./]/g, "\$&")}"[^>]*>`));
      expect(a, url).not.toBeNull();
      expect(a![0]).toContain('target="_blank"');
      expect(a![0]).toContain('rel="noopener noreferrer"');
    }
  });
  it("has a close button and the Settings note links the same stores", () => {
    expect(popup).toContain("data-void-intro-close");
    const note = String(voidUnlockNotice());
    expect(note).toContain(DR_GAMES_URL);
    expect(note).toContain(DRIVETHRU_URL);
    expect(note).toContain("data-void-about");
  });
});
