// Shared helpers for the play tools.
import { byGame, gk } from "../games";
import type { Table } from "../types";
import { icon, type IconName } from "../ui/icon";
import { html, type Raw } from "../ui/html";
import { ValidationError } from "../lock/validate";

/** Saved game state, per tool, in this browser. */
export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(gk("2d6:play:" + key));
    return v ? { ...fallback, ...(JSON.parse(v) as T) } : fallback;
  } catch {
    return fallback;
  }
}
/** Is there a saved "2d6:play:<key>"? */
export function hasSaved(key: string): boolean {
  try {
    return localStorage.getItem(gk("2d6:play:" + key)) !== null;
  } catch {
    return false;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(gk("2d6:play:" + key), JSON.stringify(value));
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

export interface PlayTool { id: string; title: string; icon: IconName; blurb: string }

/** 2D6 Void's tools: their own modules and saved state, nothing shared with Dungeon's. */
export const VOID_TOOLS: PlayTool[] = [
  { id: "vhulk", title: "Hulk turn", icon: "door-closed", blurb: "Step through a Dark Hulk room: size, room table, exits, doors and encounters." },
  { id: "vcombat", title: "Combat", icon: "crosshair", blurb: "Fight an alien card: ranged shots and deflection, then close combat with shifting and armour." },
  { id: "vsheet", title: "Character sheet", icon: "user", blurb: "Your survivor: profession, stats, skills, marksmanship, gear, stims and credits." },
  { id: "vmap", title: "Hulk map", icon: "map", blurb: "The Dark Hulk level drawn large. Pick exits, read rooms, keep notes." },
];

export const DUNGEON_TOOLS: PlayTool[] = [
  { id: "dungeon", title: "Dungeon turn", icon: "key", blurb: "Step through a room: size, room table, exits, locks and encounters." },
  { id: "combat", title: "Combat", icon: "swords", blurb: "Fight a creature card: attack rolls, shifting, interrupts, armour, fatigue, loot." },
  { id: "sheet", title: "Character sheet", icon: "scroll", blurb: "Your adventurer: stats, HP, gear, coins, favour. Saved on this device." },
  { id: "realm", title: "Realm", icon: "castle", blurb: "Explore plots, run the month and year, log lands and buildings." },
  { id: "map", title: "Map", icon: "map", blurb: "The dungeon level and your realm, drawn large. Pick exits, read rooms, keep notes." },
];

/** Tools both games share: one Achievements page covering Dungeon, Realm and Void. */
export const SHARED_TOOLS: PlayTool[] = [
  { id: "achievements", title: "Achievements", icon: "trophy", blurb: "Lifetime goals in 2D6 Dungeon and 2D6 Void, with dice luck shared between them." },
];

/** The current game's play tools, then the shared ones. */
export const PLAY_TOOLS: PlayTool[] = [...byGame({ dungeon: DUNGEON_TOOLS, void: VOID_TOOLS }), ...SHARED_TOOLS];

/** A creature card: a "Field | Value" table with a NAME and a positive HP (the rule Combat's creature list uses). */
export function isCreatureTable(t: Table): boolean {
  if (t.columns.slice(0, 2).map((c) => c.trim().toLowerCase()).join("|") !== "field|value") return false;
  const get = (k: RegExp) => t.rows.find((r) => k.test(r[0].trim()))?.[1] ?? "";
  // The name cell may be unverified on a partly read book; the table title carries the same name.
  return !!(get(/^NAME$/i) || t.title) && parseInt(get(/^(HP|HEALTH POINTS)$/i), 10) > 0;
}
