// The achievements recorder: started once at shell boot, it listens for the play events the tools
// emit and keeps lifetime progress in "2d6:achievements". The tools never import this module; the
// Achievements page reads achState() and redraws on "achievements:changed".
import { bus } from "./events";
import { readState, writeState } from "./state";
import {
  ACHIEVEMENTS_KEY, VOID_PREFIX, achDef, emptyAch, isAchState, normalizeAch, onBuilding, onCombatHit, onDice, onDoor, onFight, onLevel, onMilestone, onRealm, onRoom, onTableRoll,
  type AchDef, type AchState,
} from "./achievementsmodel";
import { levelUpCheck } from "./journalmodel";
import { isVoid } from "../games";

const SOURCE = "achievements";
let state: AchState = emptyAch();

/** The live progress (the page reads it; change it only through the bus events). */
export const achState = (): AchState => state;

const loadAch = () => normalizeAch(readState(ACHIEVEMENTS_KEY, isAchState, emptyAch));

/** Start recording. `onUnlock` runs for each achievement as it unlocks (the shell shows a toast). */
export function initAchievements(onUnlock: (d: AchDef) => void): void {
  state = loadAch();

  const run = (fn: (s: AchState, at: number) => string[]) => {
    const ids = fn(state, Date.now());
    writeState(ACHIEVEMENTS_KEY, state); // a failure toasts once (onWriteFail) and we keep going in memory
    bus.emit("achievements:changed", { source: SOURCE });
    for (const id of ids) {
      const d = achDef(id);
      if (!d) continue;
      bus.emit("achievement:unlocked", { id, title: d.title, icon: d.icon });
      onUnlock(d);
    }
  };

  // the Void tools send the same journal events; their progress goes to the Void ("v:") counters.
  // Dice rolls are shared: onDice counts every roll in either game.
  const p = isVoid() ? VOID_PREFIX : "";
  bus.on("journal:room", (ev) => run((s, at) => onRoom(s, ev, at, p)));
  bus.on("journal:door", (ev) => run((s, at) => onDoor(s, ev, at, p)));
  bus.on("journal:fight", (ev) => run((s, at) => onFight(s, ev, at, p)));
  bus.on("journal:milestone", (ev) => run((s, at) => onMilestone(s, ev, at, p)));
  bus.on("journal:realm", (ev) => run((s, at) => onRealm(s, ev, at)));
  bus.on("dice:rolled", (ev) => run((s, at) => onDice(s, ev.dice, at, ev.kind)));
  bus.on("combat:hit", (ev) => run((s, at) => onCombatHit(s, ev.kind, at)));
  bus.on("realm:building", () => run((s, at) => onBuilding(s, at)));
  bus.on("roll", (card) => {
    if (card.sectionId) run((s, at) => onTableRoll(s, card, at));
  });

  // character levels reached by play (not an import or a new character; see levelUpCheck)
  if (isVoid()) {
    void import("../tools/void/sheetmodel").then(({ hasVChar, loadVChar, vstats }) => {
      const level = () => (hasVChar() ? vstats(loadVChar()).level : 1);
      const seen = { seen: level() };
      bus.on("void:changed", ({ source }) => {
        const l = level();
        if (levelUpCheck(seen, l, source)) run((s, at) => onLevel(s, l, at, VOID_PREFIX));
      });
    });
  } else {
    void import("../tools/sheet").then(({ loadChar, stats }) => {
      const seen = { seen: stats(loadChar()).level };
      bus.on("character:changed", ({ source }) => {
        const level = stats(loadChar()).level;
        if (levelUpCheck(seen, level, source)) run((s, at) => onLevel(s, level, at));
      });
    });
  }

  // another window of the app wrote the achievements
  window.addEventListener("storage", (e) => {
    if (e.key !== ACHIEVEMENTS_KEY) return;
    state = loadAch();
    bus.emit("achievements:changed", { source: "storage" });
  });
}

/** Wipe all progress (Settings). The caller reloads the app afterwards. */
export function resetAchievements(): void {
  state = emptyAch();
  writeState(ACHIEVEMENTS_KEY, state);
  bus.emit("achievements:changed", { source: SOURCE });
}
