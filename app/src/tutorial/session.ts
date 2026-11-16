// The gameplay tutorial's sandbox: it plays as a new survivor of its own in the game's roster, so the player's
// characters (sheet, hulk, fights, journal, tabs) are never touched. Starting saves which character was active
// and the game's achievements; finishing goes back to that character, deletes the tutorial survivor and puts
// the achievements back. "Keep" ends the tutorial and leaves the survivor in the roster as an ordinary character.
// The state is saved, so a reload mid-tutorial carries on where it was.
import { charId, gk, switchCharacter } from "../games";
import { createCharacter, dropCharacterFor } from "../roster";
import type { KeyStore } from "../rostermodel";
import { ACHIEVEMENTS_KEY } from "../shell/achievementsmodel";
import { readState, writeState, type KV } from "../shell/state";

export interface TutorialState {
  /** Which script ("void"). */
  script: string;
  /** The step reached (index into the script). */
  step: number;
  /** The character that was active before; null when it isn't known. */
  prev: string | null;
  /** The tutorial survivor's roster id. */
  char: string;
  /** The game's achievements before the tutorial (raw saved value), put back when it ends. */
  ach: string | null;
}

export const stateKey = (): string => gk("2d6:shell:coach");
// one store holds both games' achievements (achievementsmodel.ts): the key is not game-prefixed
const achKey = (): string => ACHIEVEMENTS_KEY;

export const isTutorialState = (v: unknown): v is TutorialState => {
  const o = v as Partial<TutorialState> | null;
  return !!o && typeof o.script === "string" && typeof o.step === "number" && Number.isInteger(o.step) && o.step >= 0
    && typeof o.char === "string" && (o.prev === null || typeof o.prev === "string") && (o.ach === null || typeof o.ach === "string");
};

/** The running tutorial, or null. */
export const readTutorial = (kv?: KV): TutorialState | null => readState(stateKey(), (v): v is TutorialState | null => v === null || isTutorialState(v), () => null, kv);

export const saveTutorial = (t: TutorialState, kv?: KV): boolean => writeState(stateKey(), t, kv);

function clearTutorial(s: KeyStore): void {
  s.removeItem(stateKey());
}

const store = (): KeyStore => localStorage;

/**
 * Start `script` as a new tutorial survivor: remember who was active, add the survivor to the roster (with
 * `initial` as its saved state, when the script seeds one) and switch to it (which reloads; the coach picks up
 * from the saved state). Returns false if storage is full.
 */
export function startTutorial(script: string, s: KeyStore = store(), go: (id: string) => void = switchCharacter, initial: Record<string, unknown> = {}): boolean {
  const prev = charId();
  const ach = s.getItem(achKey());
  return createCharacter(initial, s, (id) => {
    if (!saveTutorial({ script, step: 0, prev, char: id, ach }, s)) return;
    go(id);
  });
}

/** End the tutorial and go back: the previous character becomes active again, and the tutorial survivor is deleted. */
export function finishTutorial(s: KeyStore = store(), reload: () => void = reloadHome): void {
  const t = readTutorial(s);
  clearTutorial(s);
  if (!t) return reload();
  if (t.ach === null) s.removeItem(achKey());
  else s.setItem(achKey(), t.ach);
  if (t.prev) dropCharacterFor(t.char, t.prev, s);
  reload();
}

/** End the tutorial and keep its survivor as an ordinary character (the previous one stays in the roster). */
export function keepTutorialSurvivor(s: KeyStore = store()): void {
  clearTutorial(s);
}

/** Is the active character the running tutorial's survivor? */
export const onTutorialSurvivor = (t: TutorialState | null): boolean => !!t && charId() === t.char;

function reloadHome(): void {
  history.replaceState(null, "", location.pathname + location.search + "#/");
  location.reload();
}
