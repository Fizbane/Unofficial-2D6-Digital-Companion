import { describe, it, expect } from "vitest";
import tokensCss from "../src/styles/tokens.css?raw";
import { ALL_THEMES as THEMES, backdropCssUrl, backdropUrl, contrast, mixHex } from "../src/themes";

describe("themes", () => {
  it("every theme has panelAlpha 0.82 (dark) or 0.88 (light)", () => {
    for (const th of THEMES) expect(th.panelAlpha, th.id).toBe(th.dark ? 0.82 : 0.88);
  });

  it("ink is readable on panel and bg (WCAG AA 4.5)", () => {
    for (const th of THEMES) {
      expect(contrast(th.t.ink, th.t.panel), `${th.id} ink/panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(th.t.ink, th.t.bg), `${th.id} ink/bg`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("danger is readable as text on panel and bg (WCAG AA 4.5)", () => {
    for (const th of THEMES) {
      expect(contrast(th.t.danger, th.t.panel), `${th.id} danger/panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(th.t.danger, th.t.bg), `${th.id} danger/bg`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("backdropUrl maps a theme id to its webp", () => {
    expect(backdropUrl("forest")).toBe("backdrops/forest.webp");
  });

  it("backdropCssUrl is absolute against the page base", () => {
    expect(backdropCssUrl("forest", "http://localhost:5173/")).toBe('url("http://localhost:5173/backdrops/forest.webp")');
    expect(backdropCssUrl("dark", "https://example.test/app/index.html")).toBe('url("https://example.test/app/backdrops/dark.webp")');
  });
});

describe("search modal selected row", () => {
  // mirrors shell.css: row = color-mix(surface-solid, accent 14%), text = color-mix(muted 60%, ink)
  it("keeps muted text at 4.5:1 or better in every theme", () => {
    for (const th of THEMES) {
      const row = mixHex(th.t.panel, th.t.accent, 0.14);
      const text = mixHex(th.t.muted, th.t.ink, 0.4);
      expect(contrast(text, row), `${th.id} muted/selected row`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(th.t.ink, row), `${th.id} ink/selected row`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("mixes like CSS color-mix in srgb", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.3)).toBe("#102030");
  });
});

describe("keyboard focus ring", () => {
  // the ring is the solid accent (tokens.css --focus-ring); WCAG 2.4.11 wants 3:1 against what it sits on
  it("accent ring is at least 3:1 against panel and bg in every theme", () => {
    for (const th of THEMES) {
      expect(contrast(th.t.accent, th.t.panel), `${th.id} accent/panel`).toBeGreaterThanOrEqual(3);
      expect(contrast(th.t.accent, th.t.bg), `${th.id} accent/bg`).toBeGreaterThanOrEqual(3);
    }
  });

  it("--focus-ring uses the solid accent, not the translucent glow", () => {
    const ring = /--focus-ring:\s*([^;]+);/.exec(tokensCss)?.[1] ?? "";
    expect(ring).toMatch(/^0 0 0 2px var\(--accent\)/);
    expect(ring).not.toMatch(/^[^,]*--glow/);
  });
});
