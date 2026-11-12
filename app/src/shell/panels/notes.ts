// The Notes tab: "This room" (the current dungeon room's notes, the same data as the Map panel's
// room notes), a "Capture a moment" box and the session log saved in "2d6:notes" (newest first,
// editable, deletable, exportable). Results' → Notes appends to the log through appendNote.
import type { DungeonMap } from "../../tools/dmap";
import { exportJSON, load, save } from "../../tools/common";
import { button } from "../../ui/components";
import { bus } from "../events";
import { addNote, deleteNote, editNote, emptyNotes, isNotesState, newestFirst, noteTime, NOTES_KEY, roomForNotes, type NotesState } from "../notesmodel";
import { badge } from "../rightpanel";
import { readState, writeState } from "../state";
import { html, setHTML } from "../../ui/html";

const SOURCE = "notes-panel";

interface Saved { level: number; current: { mapRoom?: number } | null; map?: DungeonMap }

interface View {
  pane: HTMLElement;
  room: HTMLElement;
  list: HTMLElement;
  input: HTMLTextAreaElement;
}
let view: View | null = null;
let editing: number | null = null; // index into entries being edited

const readNotes = (): NotesState => readState<NotesState>(NOTES_KEY, isNotesState, emptyNotes);
const writeNotes = (s: NotesState) => writeState(NOTES_KEY, s);
const loadDungeon = () => load<Saved>("dungeon", { level: 1, current: null, map: undefined });

/** Add a line to the session log (from Results' → Notes) and badge the tab. */
export function appendNote(text: string): void {
  const s = readNotes();
  if (!addNote(s, text)) return;
  writeNotes(s);
  drawList();
  badge("notes");
}

function drawRoom() {
  if (!view) return;
  const ta = view.room.querySelector("textarea");
  if (ta && document.activeElement === ta) return; // don't clobber what is being typed
  const st = loadDungeon();
  const r = roomForNotes(st.map, st.current);
  setHTML(view.room, html`<h3>This room</h3>${
    r
      ? html`<label class="field"><span><strong>#${r.n} ${r.label}</strong>${st.current?.mapRoom === r.id ? "" : " · last room"}</span>
          <textarea data-room-notes="${r.id}" placeholder="Loot left behind, a locked chest, who's still here…">${r.notes ?? ""}</textarea></label>`
      : html`<p class="muted">No dungeon room yet.</p>`
  }`);
}

function drawList() {
  if (!view) return;
  const items = newestFirst(readNotes());
  if (editing !== null && !items.some((x) => x.i === editing)) editing = null;
  setHTML(view.list, items.length
    ? html`${items
        .map(({ i, entry }) => {
          const time = html`<time datetime="${new Date(entry.at).toISOString()}">${noteTime(entry.at)}</time>`;
          if (i === editing)
            return html`<li class="note is-editing" data-i="${i}">${time}
              <textarea data-edit-note aria-label="Edit note">${entry.text}</textarea>
              <div class="note-actions">${button("Save", { variant: "primary", size: "sm", attrs: html`data-note-act="save"` })}${button("Cancel", { variant: "ghost", size: "sm", attrs: html`data-note-act="cancel"` })}</div></li>`;
          return html`<li class="note" data-i="${i}">${time}<div class="note-text">${entry.text}</div>
            <div class="note-actions">${button("", { icon: "pencil", variant: "ghost", size: "sm", attrs: html`data-note-act="edit" aria-label="Edit note"` })}${button("", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-note-act="delete" aria-label="Delete note"` })}</div></li>`;
        })}`
    : html`<li class="notes-empty muted">No notes yet. Capture a moment above, or send a result here with Notes.</li>`);
  const ed = view.list.querySelector<HTMLTextAreaElement>("[data-edit-note]");
  if (ed) {
    ed.focus();
    ed.setSelectionRange(ed.value.length, ed.value.length);
  }
}

function add() {
  if (!view) return;
  const s = readNotes();
  if (!addNote(s, view.input.value)) return;
  writeNotes(s);
  view.input.value = "";
  drawList();
}

function saveEdit(i: number) {
  if (!view) return;
  const ta = view.list.querySelector<HTMLTextAreaElement>("[data-edit-note]");
  const s = readNotes();
  if (ta) editNote(s, i, ta.value);
  writeNotes(s);
  editing = null;
  drawList();
}

/** Build the Notes tab into its panel pane. */
export function initNotes(pane: HTMLElement): void {
  setHTML(pane, html`<header class="results-head pane-head"><h2>Notes</h2>${button("Export", { icon: "download", variant: "ghost", size: "sm", attrs: html`data-notes-export aria-label="Export notes"` })}</header><div class="notes-body">
      <section class="notes-room"></section>
      <section class="notes-capture"><h3>Capture a moment</h3>
        <textarea data-new-note aria-label="New note" placeholder="What just happened? (Ctrl+Enter adds it)"></textarea>
        <div class="note-actions">${button("Add", { icon: "plus", variant: "primary", size: "sm", attrs: html`data-notes-add` })}</div>
      </section>
      <ol class="notes-list"></ol></div>`);
  view = {
    pane,
    room: pane.querySelector(".notes-room")!,
    list: pane.querySelector(".notes-list")!,
    input: pane.querySelector("[data-new-note]")!,
  };
  const v = view;
  pane.querySelector<HTMLElement>("[data-notes-export]")!.onclick = () => exportJSON("session-notes", readNotes());
  pane.querySelector<HTMLElement>("[data-notes-add]")!.onclick = add;
  v.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      add();
    }
  });
  v.list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-note-act]");
    const li = b?.closest<HTMLElement>("[data-i]");
    if (!b || !li) return;
    const i = +li.dataset.i!;
    const act = b.dataset.noteAct;
    if (act === "edit") editing = i;
    else if (act === "cancel") editing = null;
    else if (act === "save") return saveEdit(i);
    else if (act === "delete") {
      if (!confirm("Delete this note?")) return;
      const s = readNotes();
      deleteNote(s, i);
      writeNotes(s);
      if (editing !== null && editing > i) editing--;
    }
    drawList();
  });
  v.list.addEventListener("keydown", (e) => {
    const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>("[data-edit-note]");
    if (!ta || editing === null) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit(editing);
    } else if (e.key === "Escape") {
      e.preventDefault();
      editing = null;
      drawList();
    }
  });
  v.room.addEventListener("input", (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta.dataset.roomNotes) return;
    const st = loadDungeon();
    const r = st.map?.rooms.find((x) => x.id === +ta.dataset.roomNotes!);
    if (!r) return;
    r.notes = ta.value;
    save("dungeon", st);
    bus.emit("dungeon:changed", { source: SOURCE });
  });
  bus.on("dungeon:changed", ({ source }) => {
    if (source !== SOURCE) drawRoom();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === "2d6:play:dungeon") drawRoom();
    else if (e.key === NOTES_KEY) drawList();
  });
  drawRoom();
  drawList();
}
