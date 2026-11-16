// Typefaces. The app has three text roles, each one CSS variable (tokens.css): headings (--font-display),
// book/reading text (--font-read) and the interface (--font-ui). A "pack" picks a typeface for all three;
// the user can then override any role on its own. Choices are saved per game by settings.ts.
// Default typefaces are imported in main.ts; every other one is fetched the first time it is chosen.

import { byGame } from "./games";

export type Role = "display" | "read" | "ui";
export const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "display", label: "Headings", hint: "Page and card titles" },
  { id: "read", label: "Book text", hint: "Book pages, tables, descriptions" },
  { id: "ui", label: "Interface", hint: "Buttons, labels, inputs, tools" },
];

export interface Face { id: string; name: string; stack: string; load: () => Promise<unknown> }

const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
const all = (...p: Promise<unknown>[]) => Promise.all(p);

export const FACES: Face[] = [
  { id: "cinzel", name: "Cinzel", stack: `"Cinzel", ${SERIF}`, load: () => all(import("@fontsource/cinzel/500.css"), import("@fontsource/cinzel/600.css")) },
  { id: "alegreya", name: "Alegreya", stack: `"Alegreya", ${SERIF}`, load: () => all(import("@fontsource/alegreya/400.css"), import("@fontsource/alegreya/400-italic.css"), import("@fontsource/alegreya/600.css")) },
  { id: "orbitron", name: "Orbitron", stack: `"Orbitron", ${SANS}`, load: () => all(import("@fontsource/orbitron/500.css"), import("@fontsource/orbitron/600.css")) },
  { id: "exo2", name: "Exo 2", stack: `"Exo 2", ${SANS}`, load: () => all(import("@fontsource/exo-2/400.css"), import("@fontsource/exo-2/400-italic.css"), import("@fontsource/exo-2/600.css")) },
  { id: "inter", name: "Inter", stack: `"Inter", ${SANS}`, load: () => all(import("@fontsource/inter/400.css"), import("@fontsource/inter/500.css"), import("@fontsource/inter/600.css")) },
  { id: "cormorant", name: "Cormorant Garamond", stack: `"Cormorant Garamond", ${SERIF}`, load: () => all(import("@fontsource/cormorant-garamond/500.css"), import("@fontsource/cormorant-garamond/600.css")) },
  { id: "crimson", name: "Crimson Pro", stack: `"Crimson Pro", ${SERIF}`, load: () => all(import("@fontsource/crimson-pro/400.css"), import("@fontsource/crimson-pro/400-italic.css"), import("@fontsource/crimson-pro/600.css")) },
  { id: "lora", name: "Lora", stack: `"Lora", ${SERIF}`, load: () => all(import("@fontsource/lora/400.css"), import("@fontsource/lora/400-italic.css"), import("@fontsource/lora/600.css")) },
  { id: "sourcesans", name: "Source Sans 3", stack: `"Source Sans 3", ${SANS}`, load: () => all(import("@fontsource/source-sans-3/400.css"), import("@fontsource/source-sans-3/400-italic.css"), import("@fontsource/source-sans-3/600.css")) },
  { id: "plex", name: "IBM Plex Sans", stack: `"IBM Plex Sans", ${SANS}`, load: () => all(import("@fontsource/ibm-plex-sans/400.css"), import("@fontsource/ibm-plex-sans/400-italic.css"), import("@fontsource/ibm-plex-sans/500.css"), import("@fontsource/ibm-plex-sans/600.css")) },
  { id: "atkinson", name: "Atkinson Hyperlegible (dyslexia-friendly)", stack: `"Atkinson Hyperlegible", ${SANS}`, load: () => all(import("@fontsource/atkinson-hyperlegible/400.css"), import("@fontsource/atkinson-hyperlegible/400-italic.css"), import("@fontsource/atkinson-hyperlegible/700.css")) },
  { id: "opendyslexic", name: "OpenDyslexic (dyslexia-friendly)", stack: `"OpenDyslexic", ${SANS}`, load: () => all(import("@fontsource/opendyslexic/400.css"), import("@fontsource/opendyslexic/400-italic.css"), import("@fontsource/opendyslexic/700.css")) },
];
export const faceById = (id: string | undefined) => FACES.find((f) => f.id === id);

export interface Pack { id: string; name: string; blurb: string; fonts: Record<Role, string> }
export const PACKS: Pack[] = [
  { id: "dungeon", name: "Dungeon", blurb: "Cinzel headings, Alegreya text", fonts: { display: "cinzel", read: "alegreya", ui: "inter" } },
  { id: "scifi", name: "Sci-fi", blurb: "Orbitron headings, Exo 2 text", fonts: { display: "orbitron", read: "exo2", ui: "exo2" } },
  { id: "classic", name: "Classic", blurb: "Cormorant headings, Crimson text", fonts: { display: "cormorant", read: "crimson", ui: "inter" } },
  { id: "modern", name: "Modern", blurb: "Inter throughout", fonts: { display: "inter", read: "inter", ui: "inter" } },
  { id: "literary", name: "Literary", blurb: "Lora headings and text", fonts: { display: "lora", read: "lora", ui: "inter" } },
  { id: "humanist", name: "Humanist", blurb: "Source Sans 3 throughout", fonts: { display: "sourcesans", read: "sourcesans", ui: "sourcesans" } },
  { id: "plex", name: "Plex", blurb: "IBM Plex Sans throughout", fonts: { display: "plex", read: "plex", ui: "plex" } },
  { id: "atkinson", name: "Atkinson Hyperlegible", blurb: "Dyslexia-friendly, made for legibility", fonts: { display: "atkinson", read: "atkinson", ui: "atkinson" } },
  { id: "opendyslexic", name: "OpenDyslexic", blurb: "Dyslexia-friendly, weighted letter bottoms", fonts: { display: "opendyslexic", read: "opendyslexic", ui: "opendyslexic" } },
];
/** Dungeon reads as stone and parchment, Void as a space station. */
export const defaultPack = (): string => byGame({ dungeon: "dungeon", void: "scifi" });
export const packById = (id: string | undefined) => PACKS.find((p) => p.id === id) ?? PACKS.find((p) => p.id === defaultPack())!;

export type Overrides = Partial<Record<Role, string>>;
export interface FontChoice { pack: string; overrides: Overrides }

/** Tidy saved data: a known pack, and only overrides naming a known typeface for a known role. */
export function cleanChoice(pack: unknown, overrides: unknown): FontChoice {
  const o: Overrides = {};
  if (overrides && typeof overrides === "object") {
    for (const r of ROLES) {
      const v = (overrides as Record<string, unknown>)[r.id];
      if (typeof v === "string" && faceById(v)) o[r.id] = v;
    }
  }
  return { pack: packById(typeof pack === "string" ? pack : undefined).id, overrides: o };
}

/** The typeface id for each role: the override if there is one, else the pack's. */
export function resolveFonts(c: FontChoice): Record<Role, string> {
  const base = packById(c.pack).fonts;
  return { display: c.overrides.display ?? base.display, read: c.overrides.read ?? base.read, ui: c.overrides.ui ?? base.ui };
}

const loaded = new Set<string>();
function ensureLoaded(id: string) {
  const f = faceById(id);
  if (!f || loaded.has(id)) return;
  loaded.add(id);
  f.load().catch(() => loaded.delete(id)); // offline: the fallback stack shows; retried on the next change
}

/** Point the three font variables at the chosen typefaces, fetching any that are not loaded yet. */
export function applyFonts(c: FontChoice, root: HTMLElement = document.documentElement) {
  const r = resolveFonts(c);
  for (const role of ROLES) {
    const face = faceById(r[role.id])!;
    ensureLoaded(face.id);
    root.style.setProperty(`--font-${role.id}`, face.stack);
  }
}
