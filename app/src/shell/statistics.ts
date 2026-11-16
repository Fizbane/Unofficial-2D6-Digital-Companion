// The statistics recorder: started once at shell boot, it listens for the play events and keeps this
// game's numbers in gk("2d6:stats"). The tools never import it; the Statistics page reads statsState()
// and redraws on "statistics:changed". The model (statisticsmodel.ts) does the counting.
import { gk, isVoid } from "../games";
import { bus } from "./events";
import { readState, writeState } from "./state";
import { STATS_KEY, emptyStats, isRfutDeath, isStatsState, normalizeStats, onStatDeath, onStatDice, onStatEscape, onStatFight, onStatRoom, onStatSaved, type StatsState } from "./statisticsmodel";

const SOURCE = "statistics";
let state: StatsState = emptyStats();

/** The live numbers (the page reads them; change them only through the bus events). */
export const statsState = (): StatsState => state;

const key = (): string => gk(STATS_KEY);
const load = (): StatsState => normalizeStats(readState(key(), isStatsState, emptyStats));

/** Start recording. Each event saves the store and tells the page to redraw. */
export function initStatistics(): void {
  state = load();

  const run = (fn: (s: StatsState, at: number) => void) => {
    fn(state, Date.now());
    writeState(key(), state); // a failed write just leaves the numbers in memory for this session
    bus.emit("statistics:changed", { source: SOURCE });
  };

  bus.on("journal:room", (ev) => {
    if (ev.phase === "finish") run((s, at) => onStatRoom(s, ev, at));
  });
  bus.on("journal:fight", (ev) => {
    if (ev.phase === "end") run((s, at) => onStatFight(s, ev, at));
  });
  bus.on("combat:saved", () => run((s) => onStatSaved(s)));
  // Void's Escape Pod ends an adventure; the Dungeon's exit shaft keeps its progress, so it is ignored there
  bus.on("journal:milestone", (ev) => {
    if (ev.kind === "leave" && isVoid()) run((s, at) => onStatEscape(s, at));
  });
  bus.on("roll", (card) => {
    if (isRfutDeath(card)) run((s, at) => onStatDeath(s, at));
  });
  bus.on("dice:rolled", (ev) => run((s, at) => onStatDice(s, ev.dice, at)));

  // another window of the app wrote the statistics
  window.addEventListener("storage", (e) => {
    if (e.key !== key()) return;
    state = load();
    bus.emit("statistics:changed", { source: "storage" });
  });
}
