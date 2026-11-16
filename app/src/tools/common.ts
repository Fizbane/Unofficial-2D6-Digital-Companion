// Shared helpers for the play tools.
import { byGame, gk, isVoid } from "../games";
import { bookInfo } from "../content";
import type { Table } from "../types";
import { icon, type IconName } from "../ui/icon";
import { html, type Raw } from "../ui/html";
import { button } from "../ui/components";
import { ValidationError } from "../lock/validate";

/** The storage key of a tool's saved state ("2d6:play:<key>", in the game's and active character's slot). */
export const playKey = (key: string): string => gk("2d6:play:" + key);
/** The tool whose saved state holds the level being played (rooms, map, the room in progress): Dungeon turn, or 2D6 Void's Start Game. */
export const levelTool = (): "dungeon" | "vhulk" => (isVoid() ? "vhulk" : "dungeon");

/** Saved game state, per tool, in this browser. */
export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(playKey(key));
    return v ? { ...fallback, ...(JSON.parse(v) as T) } : fallback;
  } catch {
    return fallback;
  }
}
/** Is there a saved "2d6:play:<key>"? */
export function hasSaved(key: string): boolean {
  try {
    return localStorage.getItem(playKey(key)) !== null;
  } catch {
    return false;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(playKey(key), JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

/** Download the state as a JSON file (backup / move to another device). */
export function exportJSON(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A plain-text message for a failed import (shown with alert(), so never markup). */
export function importProblem(e: unknown): string {
  return e instanceof ValidationError ? `That file isn't a valid save (problem at "${e.path}").` : "That file isn't a valid save.";
}

/** Ask for a JSON file and return its parsed contents, checked by `validate` (which throws on anything unexpected). */
export function importJSON<T>(validate: (x: unknown) => T): Promise<T | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(validate(JSON.parse(await f.text())));
      } catch (e) {
        alert(importProblem(e));
        resolve(null);
      }
    };
    input.click();
  });
}

/** A number stepper: [-] value [+] */
export function stepper(name: string, value: number, opts: { min?: number; max?: number; label?: string; step?: number } = {}): Raw {
  return html`<label class="stepper"><span>${opts.label ?? name}</span>
    <span class="stepper-ctl">
      <button type="button" data-step="${name}" data-d="${-(opts.step ?? 1)}" aria-label="Decrease">${icon("minus", { size: 15 })}</button>
      <input type="number" name="${name}" value="${value}" ${opts.min !== undefined ? html`min="${opts.min}"` : ""} ${opts.max !== undefined ? html`max="${opts.max}"` : ""}>
      <button type="button" data-step="${name}" data-d="${opts.step ?? 1}" aria-label="Increase">${icon("plus", { size: 15 })}</button>
    </span></label>`;
}

/** Wire stepper buttons inside root to update their inputs and fire input events. */
export function wireSteppers(root: HTMLElement) {
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-step]");
    if (!b) return;
    const input = b.parentElement!.querySelector("input")!;
    let v = (parseFloat(input.value) || 0) + parseFloat(b.dataset.d!);
    if (input.min !== "") v = Math.max(+input.min, v);
    if (input.max !== "") v = Math.min(+input.max, v);
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** `requires` is the slug of an addon book: the tool is hidden until that book is unlocked on this device. */
export interface PlayTool { id: string; title: string; icon: IconName; blurb: string; requires?: string }

/** 2D6 Void's tools: their own modules and saved state, nothing shared with Dungeon's. */
export const VOID_TOOLS: PlayTool[] = [
  { id: "vhulk", title: "Start Game", icon: "door-closed", blurb: "Step through a Dark Hulk room: size, room table, exits, doors and encounters." },
  { id: "vcombat", title: "Combat", icon: "crosshair", blurb: "Fight an alien card: ranged shots and deflection, then close combat with shifting and armour." },
  { id: "vsheet", title: "Character sheet", icon: "user", blurb: "Your survivor: profession, stats, skills, marksmanship, gear, stims and credits." },
  { id: "vmap", title: "Hulk map", icon: "map", blurb: "The Dark Hulk level drawn large. Pick exits, read rooms, keep notes." },
];

export const DUNGEON_TOOLS: PlayTool[] = [
  { id: "dungeon", title: "Start Game", icon: "key", blurb: "Step through a room: size, room table, exits, locks and encounters." },
  { id: "combat", title: "Combat", icon: "swords", blurb: "Fight a creature card: attack rolls, shifting, interrupts, armour, fatigue, loot." },
  { id: "sheet", title: "Character sheet", icon: "scroll", blurb: "Your adventurer: stats, HP, gear, coins, favour. Saved on this device." },
  { id: "realm", title: "Realm", icon: "castle", blurb: "Explore plots, run the month and year, log lands and buildings.", requires: "realm" },
  { id: "lairs", title: "Lairs", icon: "skull", blurb: "Step through a lair: rooms, incidents, flooded rooms, retreats and which creature level to fight.", requires: "lairs" },
  { id: "haunted", title: "Haunted House", icon: "house", blurb: "A constable's night in the Haunted House: fear, haunted doors, the three floors, banes.", requires: "lairs" },
  { id: "map", title: "Map", icon: "map", blurb: "The dungeon level and your realm, drawn large. Pick exits, read rooms, keep notes." },
];

/** Tools both games share: one Achievements page covering Dungeon, Realm and Void. */
export const SHARED_TOOLS: PlayTool[] = [
  { id: "characters", title: byGame({ dungeon: "Characters", void: "Survivors" }), icon: "user", blurb: byGame({ dungeon: "Every adventurer on this device. Each keeps their own sheet, progress and journal.", void: "Every survivor on this device. Each keeps their own sheet, hulk and journal." }) },
  { id: "notes", title: "Notes", icon: "notebook", blurb: "This room's notes, quick captures and the session log, on a full page. The same notes as the side panel." },
  { id: "journal", title: "Journal", icon: "book-open", blurb: "The story of your run, written as you play, on a full page: read it, add your own words, export it." },
  { id: "bestiary", title: "Bestiary", icon: "skull", blurb: byGame({ dungeon: "Every creature, NPC and monster card in your books, with its picture: search, filter and open the whole card.", void: "Every alien, drone and crew card in your books, with its picture: search, filter and open the whole card." }) },
  { id: "items", title: "Items", icon: "backpack", blurb: byGame({ dungeon: "Every weapon, armour, potion, scroll, magic item and piece of loot in your books: search, filter and open its details.", void: "Every weapon, armour, stim, artefact and piece of kit in your books: search, filter and open its details." }) },
  { id: "tables", title: "Tables", icon: "table", blurb: "Every table in your books: search, filter and sort, then roll one or read it whole." },
  { id: "achievements", title: "Achievements", icon: "trophy", blurb: "Lifetime goals in 2D6 Dungeon and 2D6 Void, with dice luck shared between them." },
  { id: "statistics", title: "Statistics", icon: "chart-column", blurb: "Foes defeated, rooms by type, dice rolls and doubles, and each finished adventure." },
];

/** The current game's play tools, then the shared ones. */
export const PLAY_TOOLS: PlayTool[] = [...byGame({ dungeon: DUNGEON_TOOLS, void: VOID_TOOLS }), ...SHARED_TOOLS];

/** The tool's addon book is unlocked here (or it needs none). Read at call time: unlocking changes it. */
export const toolAvailable = (t: PlayTool): boolean => !t.requires || bookInfo(t.requires).unlocked;
/** The tools to list (sidebar, "+" picker, Home, search); PLAY_TOOLS stays the full set for titles and icons. */
export const availableTools = (): PlayTool[] => PLAY_TOOLS.filter(toolAvailable);
/** "Import <book> to use <tool>." for a tool hidden without its book; "" for any other id. */
export const hiddenToolNote = (id: string): string => {
  const t = PLAY_TOOLS.find((x) => x.id === id);
  return t?.requires && !toolAvailable(t) ? `Unlock ${bookInfo(t.requires).name} in Settings → Books to use ${t.title}.` : "";
};
/** The tools an addon book enables (for the Books list). */
export const toolsOfBook = (slug: string): string[] => PLAY_TOOLS.filter((t) => t.requires === slug).map((t) => t.title);
/** True when `id` names a tool whose addon book is not unlocked. */
export const toolHidden = (id: string): boolean => {
  const t = PLAY_TOOLS.find((x) => x.id === id);
  return !!t && !toolAvailable(t);
};

/** A creature card: a "Field | Value" table with a NAME and a positive HP (the rule Combat's creature list uses). */
export function isCreatureTable(t: Table): boolean {
  if (t.columns.slice(0, 2).map((c) => c.trim().toLowerCase()).join("|") !== "field|value") return false;
  const get = (k: RegExp) => t.rows.find((r) => k.test(r[0].trim()))?.[1] ?? "";
  // The name cell may be unverified on a partly read book; the table title carries the same name.
  return !!(get(/^NAME$/i) || t.title) && parseInt(get(/^(HP|HEALTH POINTS)$/i), 10) > 0;
}

/**
 * A button for an action the rules can block. Not blocked (`reason` null): the button as given. Blocked: the
 * button disabled (and no longer the primary one), the reason beside it, and a "Do it anyway" control that
 * runs action `act` once (overrideOf).
 */
export function gated(label: string, o: Parameters<typeof button>[1] & {}, reason: string | null, act: string): Raw {
  if (reason === null) return button(label, o);
  const off = button(label, { ...o, variant: o.variant === "primary" ? undefined : o.variant, attrs: html`${o.attrs ?? ""} disabled` });
  return html`<span class="gated">${off}<span class="gated-why muted">${reason}</span><button type="button" class="gated-over" data-override="${act}">Do it anyway</button></span>`;
}

/** What "Undo turn" asks before it takes the room in progress back off the map. */
export const undoTurnWarning = (n: number): string =>
  `Undo this turn and take room ${n} back off the map?

This isn't in the rules: the books have no take-backs. It's here to fix a mistake, such as a mis-click or the wrong exit.

It removes the room and its rolls only. HP, rations, items and anything else you changed this turn stay as they are.`;

/** A room whose type is rolled again starts its encounter over: nothing dealt with, nothing fought, no rolls. */
export function resetEncounter(d: { encDone?: boolean; fought?: boolean; results: unknown[] }): void {
  delete d.encDone;
  delete d.fought;
  d.results = [];
}

/** The action a click on a "Do it anyway" control overrides, or null for any other click. */
export const overrideOf = (target: EventTarget | null): string | null =>
  (target as Element | null)?.closest?.(".gated-over")?.getAttribute("data-override") ?? null;

/** Creature card names that appear in CAPITALS in a text (longest first; a name inside a longer word or a longer name found doesn't count). */
export function namesIn(text: string, names: string[]): string[] {
  const out: string[] = [];
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const N = n.toUpperCase().trim();
    if (N.length < 3 || out.some((o) => o.includes(N))) continue;
    const re = new RegExp(`(^|[^A-Z])${N.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}S?($|[^A-Z])`);
    if (re.test(text)) out.push(N);
  }
  return out;
}
