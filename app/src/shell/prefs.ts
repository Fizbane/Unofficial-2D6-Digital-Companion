// Shell preferences, saved in "2d6:shell:prefs" and set on the Settings page: backdrop image on/off
// and reduce transparency (applied through applyTheme by settings.applyDisplay), plus sound: effects
// and music on/off with a volume each (applied by audio/sound). setPrefs announces "prefs:changed".
// Fields a newer or older version saved (the removed `hotbar`) are ignored; a save from before sound
// existed, or with a bad sound field, gets that field's default.
import { bus } from "./events";
import { readState, writeState, type KV } from "./state";

export const PREFS_KEY = "2d6:shell:prefs";

export interface Prefs {
  v: 1;
  backdrop: boolean;
  reduceTransparency: boolean;
  sound: boolean; // sound effects
  music: boolean;
  sfxVolume: number; // 0–1
  musicVolume: number; // 0–1
}

export const defaultPrefs = (): Prefs => ({ v: 1, backdrop: true, reduceTransparency: false, sound: true, music: true, sfxVolume: 0.7, musicVolume: 0.4 });

const FLAGS = ["backdrop", "reduceTransparency", "sound", "music"] as const;
const LEVELS = ["sfxVolume", "musicVolume"] as const;
type Patch = Partial<Record<(typeof FLAGS)[number] | (typeof LEVELS)[number], unknown>>;

/** A save worth reading: version 1 with the display flags. Sound fields are checked one by one. */
export function isPrefs(v: unknown): v is Prefs {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return p.v === 1 && typeof p.backdrop === "boolean" && typeof p.reduceTransparency === "boolean";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Apply a patch, keeping only booleans for flags and finite numbers (clamped to 0–1) for volumes. */
export function mergePrefs(cur: Prefs, patch: Patch): Prefs {
  const out: Prefs = { ...cur };
  for (const k of FLAGS) if (typeof patch[k] === "boolean") out[k] = patch[k] as boolean;
  for (const k of LEVELS) {
    const n = patch[k];
    if (typeof n === "number" && Number.isFinite(n)) out[k] = clamp01(n);
  }
  return out;
}

export function getPrefs(kv?: KV): Prefs {
  const p = readState(PREFS_KEY, isPrefs, defaultPrefs, kv);
  return mergePrefs(defaultPrefs(), p as unknown as Patch); // drops unknown fields, fills missing ones
}

/** Save a change and emit "prefs:changed" with the new prefs. */
export function setPrefs(patch: Partial<Omit<Prefs, "v">>, kv?: KV): Prefs {
  const next = mergePrefs(getPrefs(kv), patch);
  writeState(PREFS_KEY, next, kv);
  bus.emit("prefs:changed", next);
  return next;
}
