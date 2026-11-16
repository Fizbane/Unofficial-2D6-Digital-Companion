// The Notes tab: "This room" (the current dungeon room's notes, the same data as the Map panel's
// room notes), a "Capture a moment" box and the session log saved in "2d6:notes" (newest first,
// editable, deletable, exportable). Results' → Notes appends to the log through appendNote.
import type { DungeonMap } from "../../tools/dmap";
import { exportJSON, levelTool, load, playKey, save } from "../../tools/common";
import { button } from "../../ui/components";
import { bus } from "../events";
import { addNote, deleteNote, editNote, emptyNotes, isNotesState, newestFirst, noteTime, NOTES_KEY, roomForNotes, type NotesState } from "../notesmodel";
import { badge } from "../rightpanel";
import { readState, writeState } from "../state";
import { html, setHTML } from "../../ui/html";

interface Saved { level: number; current: { mapRoom?: number } | null; map?: DungeonMap }

const readNotes = (): NotesState => readState<NotesState>(NOTES_KEY, isNotesState, emptyNotes);
const loadDungeon = () => load<Saved>(levelTool(), { level: 1, current: null, map: undefined });

/** Every mounted Notes view (the panel tab, any Notes pages): redraw their lists after a change. */
const lists = new Set<() => void>();
const writeNotes = (s: NotesState) => {
  writeState(NOTES_KEY, s);
  lists.forEach((draw) => draw());
};

/** Add a line to the session log (from Results' → Notes) and badge the tab. */
export function appendNote(text: string): void {
  const s = readNotes();
  if (!addNote(s, text)) return;
  writeNotes(s);
  badge("notes");
}

let mounts = 0;

/**
 * Build a Notes view into `pane`: "This room", "Capture a moment" and the session log. Each keeps its own
 * editing state, so the panel tab and a full Notes page can be open at once. Returns a function that stops it.
 */
export function mountNotes(pane: HTMLElement): () => void {
  const source = `notes-${mounts++}`;
  let editing: number | null = null; // index into entries being edited
  // which note that is: another view (the Notes page, another window) can delete notes above it, and the
  // index alone would then point at a different note, which Save would overwrite
  let editKey: { at: number; text: string } | null = null;
  /** Where the note being edited is now (and `editing` follows it), or null when it is gone. */
  function resolveEditing(): number | null {
    if (editing === null || !editKey) return (editing = null);
    const all = readNotes().entries;
    const same = (e: { at: number; text: string } | undefined) => !!e && e.at === editKey!.at && e.text === editKey!.text;
    if (!same(all[editing])) {
      const j = all.findIndex(same);
      editing = j >= 0 ? j : null;
    }
    if (editing === null) editKey = null;
    return editing;
  }
  setHTML(pane, html`<header class="results-head pane-head"><h2>Notes</h2>${button("Export", { icon: "download", variant: "ghost", size: "sm", attrs: html`data-notes-export aria-label="Export notes"` })}</header><div class="notes-body">
      <section class="notes-room"></section>
      <section class="notes-capture"><h3>Capture a moment</h3>
        <textarea data-new-note aria-label="New note" placeholder="What just happened? (Ctrl+Enter adds it)"></textarea>
        <div class="note-actions">${button("Add", { icon: "plus", variant: "primary", size: "sm", attrs: html`data-notes-add` })}</div>
      </section>
      <ol class="notes-list"></ol></div>`);
  const room = pane.querySelector<HTMLElement>(".notes-room")!;
  const list = pane.querySelector<HTMLElement>(".notes-list")!;
  const input = pane.querySelector<HTMLTextAreaElement>("[data-new-note]")!;

  function drawRoom() {
    const ta = room.querySelector("textarea");
    if (ta && document.activeElement === ta) return; // don't clobber what is being typed
    const st = loadDungeon();
    const r = roomForNotes(st.map, st.current);
    setHTML(room, html`<h3>This room</h3>${
      r
        ? html`<label class="field"><span><strong>#${r.n} ${r.label}</strong>${st.current?.mapRoom === r.id ? "" : " · last room"}</span>
            <textarea data-room-notes="${r.id}" placeholder="Loot left behind, a locked chest, who's still here…">${r.notes ?? ""}</textarea></label>`
        : html`<p class="muted">No room yet.</p>`
    }`);
  }

  function drawList() {
    const items = newestFirst(readNotes());
    // another view's change must not throw away an edit in progress here (nor move it onto another note)
    const open = list.querySelector<HTMLTextAreaElement>("[data-edit-note]");
    const typed = open && resolveEditing() !== null ? open.value : null;
    resolveEditing();
    setHTML(list, items.length
      ? html`${items
          .map(({ i, entry }) => {
            const time = html`<time datetime="${new Date(entry.at).toISOString()}">${noteTime(entry.at)}</time>`;
            if (i === editing)
              return html`<li class="note is-editing" data-i="${i}">${time}
                <textarea data-edit-note aria-label="Edit note">${typed ?? entry.text}</textarea>
                <div class="note-actions">${button("Save", { variant: "primary", size: "sm", attrs: html`data-note-act="save"` })}${button("Cancel", { variant: "ghost", size: "sm", attrs: html`data-note-act="cancel"` })}</div></li>`;
            return html`<li class="note" data-i="${i}">${time}<div class="note-text">${entry.text}</div>
              <div class="note-actions">${button("", { icon: "pencil", variant: "ghost", size: "sm", attrs: html`data-note-act="edit" aria-label="Edit note"` })}${button("", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-note-act="delete" aria-label="Delete note"` })}</div></li>`;
          })}`
      : html`<li class="notes-empty muted">No notes yet. Capture a moment above, or send a result here with Notes.</li>`);
    const ed = list.querySelector<HTMLTextAreaElement>("[data-edit-note]");
    if (ed && typed === null) {
      ed.focus();
      ed.setSelectionRange(ed.value.length, ed.value.length);
    }
  }

  function add() {
    const s = readNotes();
    if (!addNote(s, input.value)) return;
    input.value = "";
    writeNotes(s);
  }

  function saveEdit() {
    const ta = list.querySelector<HTMLTextAreaElement>("[data-edit-note]");
    const s = readNotes();
    const i = resolveEditing();
    if (ta && i !== null) editNote(s, i, ta.value);
    editing = null;
    editKey = null;
    list.querySelector("[data-edit-note]")?.remove(); // so the redraw doesn't keep the old text
    writeNotes(s);
  }

  pane.querySelector<HTMLElement>("[data-notes-export]")!.onclick = () => exportJSON("session-notes", readNotes());
  pane.querySelector<HTMLElement>("[data-notes-add]")!.onclick = add;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      add();
    }
  });
  list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-note-act]");
    const li = b?.closest<HTMLElement>("[data-i]");
    if (!b || !li) return;
    const i = +li.dataset.i!;
    const act = b.dataset.noteAct;
    if (act === "save") return saveEdit();
    list.querySelector("[data-edit-note]")?.remove(); // edit / cancel / delete start from the stored text
    if (act === "edit") {
      editing = i;
      const e = readNotes().entries[i];
      editKey = e ? { at: e.at, text: e.text } : null;
    } else if (act === "cancel") editing = editKey = null;
    else if (act === "delete") {
      if (!confirm("Delete this note?")) return drawList();
      const s = readNotes();
      deleteNote(s, i);
      if (editing !== null && editing > i) editing--;
      return writeNotes(s);
    }
    drawList();
  });
  list.addEventListener("keydown", (e) => {
    const ta = (e.target as HTMLElement).closest<HTMLTextAreaElement>("[data-edit-note]");
    if (!ta || editing === null) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      editing = null;
      ta.remove();
      drawList();
    }
  });
  room.addEventListener("input", (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta.dataset.roomNotes) return;
    const st = loadDungeon();
    const r = st.map?.rooms.find((x) => x.id === +ta.dataset.roomNotes!);
    if (!r) return;
    r.notes = ta.value;
    const tool = levelTool();
    save(tool, st);
    // each game's tools merge the edit into their own copy on their own event
    bus.emit(tool === "vhulk" ? "void:changed" : "dungeon:changed", { source });
  });
  const offDungeon = bus.on("dungeon:changed", (p) => {
    if (p.source !== source) drawRoom();
  });
  const offVoid = bus.on("void:changed", (p) => {
    if (p.source !== source) drawRoom();
  });
  const off = () => (offDungeon(), offVoid());
  const onStorage = (e: StorageEvent) => {
    if (e.key === playKey(levelTool())) drawRoom();
    else if (e.key === NOTES_KEY) drawList();
  };
  window.addEventListener("storage", onStorage);
  lists.add(drawList);
  drawRoom();
  drawList();
  return () => {
    off();
    window.removeEventListener("storage", onStorage);
    lists.delete(drawList);
  };
}

/** Build the Notes tab into its panel pane. */
export function initNotes(pane: HTMLElement): void {
  mountNotes(pane);
}
