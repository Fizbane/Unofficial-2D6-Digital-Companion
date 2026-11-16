// Runs the gameplay tutorial: starts it (a new tutorial survivor, then a reload), and at boot puts the coach
// back up at the saved step. Scripts are per game.
import { gameId, type GameId } from "../games";
import { startCoach, type CoachScript } from "../ui/coach";
import { finishTutorial, keepTutorialSurvivor, onTutorialSurvivor, readTutorial, saveTutorial, startTutorial } from "./session";
import { DUNGEON_TUTORIAL } from "./dungeon";
import { VOID_TUTORIAL } from "./void";

const SCRIPTS: Partial<Record<GameId, CoachScript>> = { dungeon: DUNGEON_TUTORIAL, void: VOID_TUTORIAL };

/** The current game's tutorial, if it has one. */
export const tutorialFor = (g: GameId = gameId()): CoachScript | null => SCRIPTS[g] ?? null;

/** Is a tutorial running in this game? */
export const tutorialRunning = (): boolean => !!readTutorial();

/** Start the current game's tutorial (reloads into the new tutorial character). False when it couldn't start (storage full or blocked). */
export async function beginTutorial(): Promise<boolean> {
  const s = tutorialFor();
  if (!s) return false;
  try {
    return startTutorial(s.id, undefined, undefined, (await s.seed?.()) ?? {});
  } catch {
    return false;
  }
}

/** At boot: bring the coach back if a tutorial is running. */
export function resumeTutorial(o: { openTab(route: string, opts?: { newTab?: boolean }): void; toast(msg: string): void }): void {
  const t = readTutorial();
  if (!t) return;
  const script = tutorialFor();
  if (!script || script.id !== t.script) return;
  if (!onTutorialSurvivor(t)) {
    // another character was picked mid-tutorial: end it, and leave its survivor in the roster
    keepTutorialSurvivor();
    o.toast(`The tutorial ended because you switched character. Its ${script.who ?? "survivor"} is still in your roster.`);
    return;
  }
  startCoach(script, t.step, {
    openTab: o.openTab,
    onStep: (i) => {
      const now = readTutorial();
      if (now) saveTutorial({ ...now, step: i });
    },
    onFinish: (keep) => {
      if (keep) {
        keepTutorialSurvivor();
        o.toast(`Tutorial finished. This ${script.who ?? "survivor"} is yours to keep playing.`);
      } else finishTutorial();
    },
    onQuit: () => finishTutorial(),
  });
}
