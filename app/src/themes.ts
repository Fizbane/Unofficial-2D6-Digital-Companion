// Colour themes. Every component reads these CSS custom properties, so a theme is just a token set.
// "parchment" and "dungeon" mirror the defaults in style.css (used by "Match device").
import { byGame, isVoid } from "./games";

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  dark: boolean;
  /** Palette. `danger` marks destructive actions and bad outcomes; it is readable as text on `panel` (AA 4.5). */
  t: { bg: string; panel: string; ink: string; muted: string; line: string; accent: string; accentInk: string; hit: string; rowAlt: string; mark: string; danger: string };
  /** Opacity of frosted panels over the backdrop (~0.82 dark, ~0.88 light). */
  panelAlpha: number;
}

export const DUNGEON_THEMES: Theme[] = [
  { id: "light", name: "Parchment", blurb: "Warm paper, rust red", dark: false, panelAlpha: 0.88,
    t: { bg: "#f7f3ea", panel: "#efe8d9", ink: "#241f18", muted: "#6f6556", line: "#d9cfbb", accent: "#9a3b1f", accentInk: "#ffffff", hit: "#ffe28a", rowAlt: "#f1ead9", mark: "#ffe9a8", danger: "#b02a1e" } },
  { id: "dark", name: "Dungeon", blurb: "Torchlit stone", dark: true, panelAlpha: 0.82,
    t: { bg: "#17140f", panel: "#201c16", ink: "#ebe3d3", muted: "#a59a87", line: "#3a3328", accent: "#e0835f", accentInk: "#17140f", hit: "#5b4a12", rowAlt: "#1d1913", mark: "#6b5513", danger: "#f2766a" } },
  { id: "midnight", name: "Midnight", blurb: "Deep navy, moonlit blue", dark: true, panelAlpha: 0.82,
    t: { bg: "#0e1525", panel: "#162038", ink: "#e6ebf5", muted: "#9aa7c0", line: "#2a3756", accent: "#79acff", accentInk: "#0b1220", hit: "#27477a", rowAlt: "#121b30", mark: "#34518a", danger: "#ff8080" } },
  { id: "forest", name: "Forest", blurb: "Moss and pine", dark: true, panelAlpha: 0.82,
    t: { bg: "#111a13", panel: "#18241a", ink: "#e3eadf", muted: "#9eae99", line: "#2b3b2d", accent: "#8cc96f", accentInk: "#0e160f", hit: "#3a5a2a", rowAlt: "#142017", mark: "#4b6a2c", danger: "#f58a74" } },
  { id: "bloodmoon", name: "Blood moon", blurb: "Black iron, crimson", dark: true, panelAlpha: 0.82,
    t: { bg: "#170d0e", panel: "#221315", ink: "#f1e3e1", muted: "#b89d9a", line: "#3e2427", accent: "#f06a5f", accentInk: "#170d0e", hit: "#5e1f20", rowAlt: "#1c1011", mark: "#6e2a26", danger: "#ff8f87" } },
  { id: "arcane", name: "Arcane", blurb: "Violet spellglow", dark: true, panelAlpha: 0.82,
    t: { bg: "#140f1e", panel: "#1d172b", ink: "#ece6f7", muted: "#aa9dc4", line: "#342a4b", accent: "#bb95ff", accentInk: "#140f1e", hit: "#48307a", rowAlt: "#181325", mark: "#553a8c", danger: "#ff7f93" } },
  { id: "seaglass", name: "Sea glass", blurb: "Light teal shallows", dark: false, panelAlpha: 0.88,
    t: { bg: "#eef6f4", panel: "#dcece8", ink: "#11302d", muted: "#4b6b67", line: "#b6d2cc", accent: "#0b6e66", accentInk: "#ffffff", hit: "#ffe28a", rowAlt: "#e3f0ed", mark: "#ffe9a8", danger: "#a8261c" } },
  { id: "bone", name: "Bone", blurb: "Neutral grey, slate blue", dark: false, panelAlpha: 0.88,
    t: { bg: "#f3f3f0", panel: "#e6e6e1", ink: "#1e1f1d", muted: "#5f615b", line: "#cfcfc7", accent: "#335f80", accentInk: "#ffffff", hit: "#ffe28a", rowAlt: "#ecece8", mark: "#ffe9a8", danger: "#a8261c" } },
  { id: "contrast", name: "High contrast", blurb: "Black, white, bright yellow", dark: true, panelAlpha: 0.82,
    t: { bg: "#000000", panel: "#111111", ink: "#ffffff", muted: "#d0d0d0", line: "#5a5a5a", accent: "#ffd400", accentInk: "#000000", hit: "#6b5600", rowAlt: "#0b0b0b", mark: "#806a00", danger: "#ff6b6b" } },
];

/** 2D6 Void's themes: ship interiors and sci-fi looks. Ids start "v-" so their backdrops never clash. */
export const VOID_THEMES: Theme[] = [
  { id: "v-deepspace", name: "Deep Space", blurb: "Black void, ice-blue readouts", dark: true, panelAlpha: 0.82,
    t: { bg: "#070a12", panel: "#0e1422", ink: "#e4ecf8", muted: "#93a3bd", line: "#24304a", accent: "#5cc8ff", accentInk: "#06111c", hit: "#16466a", rowAlt: "#0b111d", mark: "#1d5a86", danger: "#ff7a7a" } },
  { id: "v-hull", name: "Hull Steel", blurb: "Gunmetal plating, hazard orange", dark: true, panelAlpha: 0.82,
    t: { bg: "#121416", panel: "#1b1e21", ink: "#e6e8ea", muted: "#a0a6ac", line: "#33383e", accent: "#ff9a3d", accentInk: "#141108", hit: "#5c3a12", rowAlt: "#171a1d", mark: "#6e4a16", danger: "#ff7c70" } },
  { id: "v-neon", name: "Neon", blurb: "Cyberpunk magenta and cyan", dark: true, panelAlpha: 0.82,
    t: { bg: "#0d0716", panel: "#170e24", ink: "#f2e9ff", muted: "#b39fd0", line: "#34204f", accent: "#ff4fd8", accentInk: "#12051a", hit: "#5a1a5e", rowAlt: "#120a1d", mark: "#0e5f6e", danger: "#ff8a8a" } },
  { id: "v-reactor", name: "Reactor", blurb: "Amber warning light", dark: true, panelAlpha: 0.82,
    t: { bg: "#140f06", panel: "#1e170b", ink: "#f5ead2", muted: "#bba98a", line: "#3d311b", accent: "#ffb627", accentInk: "#150f02", hit: "#5e4410", rowAlt: "#191309", mark: "#6e5212", danger: "#ff7d6b" } },
  { id: "v-biohazard", name: "Biohazard", blurb: "Toxic green on black", dark: true, panelAlpha: 0.82,
    t: { bg: "#080f09", panel: "#0f1a11", ink: "#e0f2e2", muted: "#93b39a", line: "#223a27", accent: "#7dff6b", accentInk: "#061107", hit: "#24561d", rowAlt: "#0c150e", mark: "#2f6a22", danger: "#ff8a7a" } },
  { id: "v-brass", name: "Brass", blurb: "Steampunk copper and teak", dark: true, panelAlpha: 0.82,
    t: { bg: "#160f0a", panel: "#21170f", ink: "#f1e4d1", muted: "#bda58a", line: "#433020", accent: "#d9a35b", accentInk: "#160f0a", hit: "#5a3e1a", rowAlt: "#1b130c", mark: "#6c4b1e", danger: "#ff8676" } },
  { id: "v-lab", name: "Clean Lab", blurb: "White panels, med-bay teal", dark: false, panelAlpha: 0.88,
    t: { bg: "#f2f5f7", panel: "#e3e9ed", ink: "#14212b", muted: "#4f6170", line: "#c4d0d9", accent: "#00707a", accentInk: "#ffffff", hit: "#bfe8ec", rowAlt: "#e9eef1", mark: "#c9f0f2", danger: "#a8261c" } },
  { id: "v-contrast", name: "High contrast", blurb: "Black, white, bright cyan", dark: true, panelAlpha: 0.82,
    t: { bg: "#000000", panel: "#111111", ink: "#ffffff", muted: "#d0d0d0", line: "#5a5a5a", accent: "#00e5ff", accentInk: "#000000", hit: "#005a66", rowAlt: "#0b0b0b", mark: "#00707f", danger: "#ff6b6b" } },
];

/** Every theme of both games (tests check them all). */
export const ALL_THEMES: Theme[] = [...DUNGEON_THEMES, ...VOID_THEMES];

/** The current game's themes. */
export const THEMES: Theme[] = byGame({ dungeon: DUNGEON_THEMES, void: VOID_THEMES });

/** What "Match device" resolves to, per game: [light, dark]. */
export const AUTO_PAIR = byGame({ dungeon: ["light", "dark"], void: ["v-lab", "v-deepspace"] }) as [string, string];

export const themeById = (id: string) => THEMES.find((t) => t.id === id);

const VARS: [keyof Theme["t"], string][] = [
  ["bg", "--bg"], ["panel", "--panel"], ["ink", "--ink"], ["muted", "--muted"], ["line", "--line"],
  ["accent", "--accent"], ["accentInk", "--accent-ink"], ["hit", "--hit"], ["rowAlt", "--row-alt"], ["mark", "--mark"], ["danger", "--danger"],
];

/** Backdrop image path for a theme id (served from public/backdrops/). */
export const backdropUrl = (id: string) => `backdrops/${id}.webp`;

/**
 * CSS url() for a backdrop, absolute against the page base. A relative url() arriving via var()
 * resolves against the consuming stylesheet (assets/*.css in production), so it must be absolute.
 */
export const backdropCssUrl = (id: string, baseURI: string) => `url("${new URL(backdropUrl(id), baseURI).href}")`;

export interface BackdropPrefs { backdrop: boolean; reduceTransparency: boolean }

/** "#rrggbb" -> "r g b" (for rgb(var(--x) / a)). */
const rgbTriplet = (hex: string) =>
  (hex.replace("#", "").match(/.{2}/g) ?? ["0", "0", "0"]).map((x) => parseInt(x, 16)).join(" ");

/**
 * Apply a theme id: "auto" follows the device (CSS media query), "light"/"dark" use the
 * stylesheet defaults for the palette, any other id sets the palette inline. Every theme also
 * sets the frosted-panel/backdrop vars (--panel-rgb, --panel-alpha, --blur, --backdrop,
 * --backdrop-fallback, --glow) from its resolved palette and the display prefs.
 */
export function applyTheme(id: string, prefs: BackdropPrefs = { backdrop: true, reduceTransparency: false }) {
  const root = document.documentElement;
  for (const [, v] of VARS) root.style.removeProperty(v);
  root.style.removeProperty("color-scheme");
  if (id === "auto") delete root.dataset.theme;
  else root.dataset.theme = id;
  const th = id === "auto" ? themeById(AUTO_PAIR[matchMedia("(prefers-color-scheme: dark)").matches ? 1 : 0])! : themeById(id) ?? themeById(AUTO_PAIR[0])!;
  // light or dark palette, for styles that depend on it rather than on one theme (e.g. the logo)
  root.dataset.scheme = th.dark ? "dark" : "light";
  // Dungeon's Parchment/Dungeon palettes are the stylesheet defaults; every other palette (all of Void's) goes inline
  if (isVoid() || (id !== "auto" && id !== "light" && id !== "dark")) {
    for (const [k, v] of VARS) root.style.setProperty(v, th.t[k]);
    root.style.setProperty("color-scheme", th.dark ? "dark" : "light");
  }
  const { bg, panel, accent } = th.t;
  const accentRgb = rgbTriplet(accent);
  root.style.setProperty("--panel-rgb", rgbTriplet(panel));
  root.style.setProperty("--panel-alpha", String(prefs.reduceTransparency ? 1 : th.panelAlpha));
  // solid panels need no blur; otherwise leave --blur to the stylesheet (which also honours
  // prefers-reduced-transparency: reduce, forcing solid panels whatever the pref says)
  if (prefs.reduceTransparency) root.style.setProperty("--blur", "0px");
  else root.style.removeProperty("--blur");
  root.style.setProperty("--backdrop", prefs.backdrop ? backdropCssUrl(th.id, document.baseURI) : "none");
  root.style.setProperty(
    "--backdrop-fallback",
    `radial-gradient(ellipse at 50% 0%, rgb(${accentRgb} / 0.18), transparent 60%), linear-gradient(180deg, ${bg}, ${panel})`,
  );
  root.style.setProperty("--glow", `rgb(${accentRgb} / 0.25)`);
  // browser/OS bar colour on phones
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = th.t.panel;
}

/** Mix two "#rrggbb" colours in sRGB like CSS color-mix(in srgb, a, b p): `p` is b's share (0–1). */
export function mixHex(a: string, b: string, p: number): string {
  const ch = (hex: string) => (hex.replace("#", "").match(/.{2}/g) ?? ["0", "0", "0"]).map((x) => parseInt(x, 16));
  const [x, y] = [ch(a), ch(b)];
  return "#" + x.map((v, i) => Math.round(v * (1 - p) + y[i] * p).toString(16).padStart(2, "0")).join("");
}

/** WCAG contrast ratio between two hex colours (used to check the palettes). */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = (hex.replace("#", "").match(/.{2}/g) ?? ["0", "0", "0"]).map((x) => {
      const c = parseInt(x, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
