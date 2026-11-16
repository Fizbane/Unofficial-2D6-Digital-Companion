// The Journal recorder: started once at shell boot, it listens for the play events the tools emit
// (journal:room / door / fight / milestone / realm) and for level-ups and the stairs, and writes the story
// into "2d6:journal" whether or not the Journal tab, or the tool that emitted, is on screen. The
// tools never import this module. The panel (panels/journal.ts) reads the same state through
// journalState() and redraws on "journal:changed".
import { bus } from "./events";
import { readState, writeState } from "./state";
import {
  capJournal, deleteEntry, editEntryText, emptyJournal, isJournalState, JOURNAL_KEY, levelUpCheck, normalizeJournal, recordDoor, recordFight, recordLevelUp, recordMilestone,
  recordRealm, recordRoom, recordAchievement, roomKey, setAddition, setStairs, type At, type JournalState,
} from "./journalmodel";
import { entryStory } from "./journalprose";
import { hasSaved, levelTool, load } from "../tools/common";
import { isVoid } from "../games";
import type { DungeonMap } from "../tools/dmap";

const SOURCE = "journal";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let state: JournalState = emptyJournal();
let onNew: (() => void) | null = null;

/** The live journal (the panel reads it; change it only through the functions below). */
export const journalState = (): JournalState => state;

function commit(isNew: boolean) {
  capJournal(state);
  writeState(JOURNAL_KEY, state); // a failure toasts once (onWriteFail) and we keep going in memory
  bus.emit("journal:changed", { source: SOURCE });
  if (isNew) onNew?.();
}

/** The realm date when there is a realm, else today's date: used in a new chapter's title. */
function when(): At {
  const now = Date.now();
  if (hasSaved("realm")) {
    const r = load<{ year: number; month: number }>("realm", { year: 837, month: 1 });
    return { at: now, date: `Year ${r.year} Month ${r.month}` };
  }
  const d = new Date(now);
  return { at: now, date: `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
}

interface SavedDungeon { level: number; current: { n: number; mapRoom?: number } | null; map?: DungeonMap }
// the level being played: the Dungeon turn's save, or 2D6 Void's Start Game (same fields)
const loadDungeon = () => load<SavedDungeon>(levelTool(), { level: 1, current: null, map: undefined });

/** The saved journal, with any malformed chapter or entry (a hand-edited backup) dropped. */
const loadJournal = () => normalizeJournal(readState(JOURNAL_KEY, isJournalState, emptyJournal));

/** Edit / add to / delete an entry from the panel. */
export function journalEdit(id: string, text: string) {
  // saved unchanged, it is still the written story: keep it growing with the room, don't freeze it as an edit
  const e = state.entries.find((x) => x.id === id);
  if (e && !e.edited && text.trim() === entryStory(e).generated.trim()) text = "";
  editEntryText(state, id, text);
  commit(false);
}
export function journalAddition(id: string, text: string) {
  setAddition(state, id, text);
  commit(false);
}
export function journalDelete(id: string) {
  deleteEntry(state, id);
  commit(false);
}

/** Start recording. `onNewEntry` runs when a new entry is written (the panel badges its tab). */
export function initJournal(onNewEntry: () => void): void {
  onNew = onNewEntry;
  state = loadJournal();
  const count = () => state.entries.length;

  bus.on("journal:room", (ev) => {
    const before = count();
    recordRoom(state, ev, when());
    commit(count() > before);
  });
  bus.on("journal:door", (ev) => {
    if (recordDoor(state, ev)) commit(false);
  });
  bus.on("journal:fight", (ev) => {
    const before = count();
    let room: string | undefined;
    if (ev.phase === "end") {
      const cur = loadDungeon().current; // the room in progress, when the fight began in one
      if (cur) room = roomKey(state.run, cur.n);
    }
    recordFight(state, ev, when(), room);
    commit(count() > before);
  });
  bus.on("journal:milestone", (ev) => {
    recordMilestone(state, ev, when());
    commit(true);
  });
  bus.on("journal:realm", (ev) => {
    const before = count();
    recordRealm(state, ev, when()); // a plot's encounter arrives as plain text
    commit(count() > before);
  });

  // the stairs are placed from the maps (mapview.ts): mark the room that holds them
  let stairs = loadDungeon().map?.stairs ?? null;
  bus.on("dungeon:changed", () => {
    const st = loadDungeon();
    const now = st.map?.stairs ?? null;
    if (now === stairs) return;
    stairs = now;
    const n = now === null ? null : (st.map?.rooms.find((r) => r.id === now)?.n ?? null);
    setStairs(state, n);
    commit(false);
  });

  // level-ups: a one-level rise saved by play (not an import or a new character; see levelUpCheck)
  if (isVoid()) {
    // 2D6 Void's sheet, combat and Start Game save the survivor with "void:changed"
    void import("../tools/void/sheetmodel").then(({ hasVChar, loadVChar, vstats }) => {
      const now = () => (hasVChar() ? vstats(loadVChar()) : { level: 1, title: "" });
      const seen = { seen: now().level };
      bus.on("void:changed", ({ source }) => {
        const st = now();
        if (levelUpCheck(seen, st.level, source)) {
          recordLevelUp(state, st.level, st.title, when());
          commit(true);
        }
      });
    });
  } else {
    void import("../tools/sheet").then(({ loadChar, stats }) => {
      const seen = { seen: stats(loadChar()).level };
      bus.on("character:changed", ({ source }) => {
        const st = stats(loadChar());
        if (levelUpCheck(seen, st.level, source)) {
          recordLevelUp(state, st.level, st.title, when());
          commit(true);
        }
      });
    });
  }

  // achievements (shell/achievements.ts) unlocked by play
  bus.on("achievement:unlocked", ({ id, title }) => {
    recordAchievement(state, id, title, when());
    commit(true);
  });

  // another window of the app wrote the journal
  window.addEventListener("storage", (e) => {
    if (e.key !== JOURNAL_KEY) return;
    state = loadJournal();
    bus.emit("journal:changed", { source: "storage" });
  });
}
