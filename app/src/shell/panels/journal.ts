// The Journal tab: the story of the run, written automatically (shell/journal.ts records it).
// Chapters oldest first, entries oldest first, so it reads like a book; it scrolls to the newest
// entry when it comes on screen. Each entry: kind icon, heading, time, the room picture (a frozen
// map slice, re-drawn with the live renderer; tapping it opens the Map page on that room), the
// story (editable), the player's own words (Write…), and Delete. Export makes a printable page.
import { load } from "../../tools/common";
import type { DungeonMap } from "../../tools/dmap";
import { button } from "../../ui/components";
import { icon, type IconName } from "../../ui/icon";
import { bus } from "../events";
import { journalAddition, journalDelete, journalEdit, journalState } from "../journal";
import { chapterTitle, entryDate, exportJournalHtml } from "../journalexport";
import { journalView, type JournalEntry } from "../journalmodel";
import { entryStory } from "../journalprose";
import { renderSnap } from "../journalsnap";
import { requestMapFocus } from "../mapfocus";
import { noteTime } from "../notesmodel";
import { onPanelShow, panelVisible } from "../rightpanel";
import { html, joinHtml, type Raw, setHTML } from "../../ui/html";

interface Opts { openTab(route: string): void; toast(msg: string): void }

let list: HTMLElement | null = null;
let pane: HTMLElement | null = null;
let editing: { id: string; mode: "text" | "add" } | null = null;
let dirty = false; // the journal changed while the tab was hidden: rebuild when it comes on screen
let frame = 0; // a rebuild is booked for the next animation frame

function kindIcon(e: JournalEntry): IconName {
  if (e.kind === "room") return "door-closed";
  if (e.kind === "fight") return "swords";
  if (e.kind === "milestone") return ({ descend: "arrow-down", levelup: "trophy", achievement: "sparkles", rest: "utensils", leave: "flag" } as const)[e.data.kind];
  return e.data.kind === "plot" ? "compass" : "calendar";
}

const paras = (t: string) => html`${t.split(/\n{2,}/).map((p) => html`<p>${joinHtml(p.split("\n"), html`<br>`)}</p>`)}`;

function entryHtml(e: JournalEntry, fights: JournalEntry[] = []): Raw {
  const st = entryStory(e);
  const ed = editing?.id === e.id ? editing.mode : null;
  const time = html`<time datetime="${new Date(e.at).toISOString()}" title="${entryDate(e.at)}">${noteTime(e.at)}</time>`;
  const pic =
    e.kind === "room" && e.snap
      ? html`<button type="button" class="jentry-pic" data-jact="map" title="Open the Map page at this room" aria-label="Open the Map page at room ${e.data.n}">${renderSnap(e.snap, `j${e.id.replace(/\W/g, "")}`)}</button>`
      : "";
  const story =
    ed === "text"
      ? html`<textarea class="jentry-edit" data-jedit="text" aria-label="Edit the story">${st.body}</textarea>
        <p class="muted jentry-hint">Clear it to go back to the written story.</p>
        <div class="note-actions">${button("Save", { variant: "primary", size: "sm", attrs: html`data-jact="save"` })}${button("Cancel", { variant: "ghost", size: "sm", attrs: html`data-jact="cancel"` })}</div>`
      : html`<div class="jentry-text">${paras(st.body)}</div>`;
  const own =
    ed === "add"
      ? html`<textarea class="jentry-edit" data-jedit="add" aria-label="Your own words" placeholder="In your own words…">${e.addition ?? ""}</textarea>
        <div class="note-actions">${button("Save", { variant: "primary", size: "sm", attrs: html`data-jact="save"` })}${button("Cancel", { variant: "ghost", size: "sm", attrs: html`data-jact="cancel"` })}</div>`
      : e.addition
        ? html`<div class="jentry-own">${paras(e.addition)}</div>`
        : "";
  const actions = ed
    ? ""
    : html`<div class="jentry-actions">
        ${button(e.addition ? "Edit your words" : "Write…", { icon: "pencil", variant: "ghost", size: "sm", attrs: html`data-jact="add"` })}
        ${button("", { icon: "file-text", variant: "ghost", size: "sm", attrs: html`data-jact="edit" aria-label="Edit the story" title="Edit the story"` })}
        ${button("", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-jact="delete" aria-label="Delete entry" title="Delete entry"` })}
      </div>`;
  return html`<article class="jentry jentry-${e.kind}${e.edited ? " is-edited" : ""}" data-jid="${e.id}">
    <header class="jentry-head"><span class="jentry-icon">${icon(kindIcon(e), { size: 16 })}</span><h4>${st.heading}</h4>${time}</header>
    ${pic}${story}${own}${actions}
    ${fights.length ? html`<div class="jentry-fights">${fights.map((f) => entryHtml(f))}</div>` : ""}
  </article>`;
}

function draw() {
  if (!list || !pane) return;
  // keep what is being typed when a new event redraws the list
  const ta = list.querySelector<HTMLTextAreaElement>("textarea[data-jedit]");
  const typing = ta ? { value: ta.value, focused: document.activeElement === ta, start: ta.selectionStart, end: ta.selectionEnd } : null;
  const s = journalState();
  if (editing && !s.entries.some((e) => e.id === editing!.id)) editing = null;
  const view = journalView(s);
  const count = pane.querySelector(".journal-count");
  if (count) count.textContent = s.entries.length ? `${s.entries.length} entr${s.entries.length === 1 ? "y" : "ies"}` : "";
  setHTML(list, view.length
    ? html`${view
        .map(
          (c) => html`<section class="jchapter"><h3 class="jchapter-title">${chapterTitle(c.chapter)}</h3>
          ${c.entries.map((v) => entryHtml(v.entry, v.fights))}</section>`,
        )}`
    : html`<p class="muted journal-empty">${icon("book-open", { size: 18 })} The journal writes itself as you play: rooms as you roll them, fights, new levels, the realm. Start a dungeon in Dungeon turn.</p>`);
  const nta = list.querySelector<HTMLTextAreaElement>("textarea[data-jedit]");
  if (nta && typing) {
    nta.value = typing.value;
    if (typing.focused) {
      nta.focus();
      nta.setSelectionRange(typing.start, typing.end);
    }
  }
}

const nearBottom = () => !!pane && pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120;
const toBottom = () => {
  if (pane) pane.scrollTop = pane.scrollHeight;
};

function save(id: string) {
  const ta = list?.querySelector<HTMLTextAreaElement>("textarea[data-jedit]");
  const mode = editing?.mode;
  editing = null;
  if (ta && mode === "text") journalEdit(id, ta.value);
  else if (ta && mode === "add") journalAddition(id, ta.value);
  else draw();
}

function startEdit(id: string, mode: "text" | "add") {
  editing = { id, mode };
  draw();
  const ta = list?.querySelector<HTMLTextAreaElement>("textarea[data-jedit]");
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

/** Open the Map page, on this room when it is on the current level's map. */
function openMap(e: JournalEntry, o: Opts) {
  if (e.kind === "room" && e.snap) {
    const st = load<{ level: number; map?: DungeonMap }>("dungeon", { level: 1 });
    const run = +e.id.split(":")[1];
    const r = st.map?.rooms.find((x) => x.id === e.snap!.focus);
    if (run === journalState().run && st.level === e.data.level && r && r.n === e.data.n) requestMapFocus(r.id);
  }
  o.openTab("#/play/map");
}

function exportHtml(o: Opts) {
  const s = journalState();
  if (!s.entries.length) return o.toast("The journal is empty.");
  const blob = new Blob([exportJournalHtml(s)], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `journal-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Build the Journal tab into its panel pane. */
export function initJournalPanel(host: HTMLElement, o: Opts): void {
  pane = host;
  setHTML(host, html`<header class="results-head pane-head"><h2>Journal</h2><span class="muted journal-count"></span>${button("Export", { icon: "download", variant: "ghost", size: "sm", attrs: html`data-journal-export aria-label="Export journal" title="Export the journal as a printable page"` })}</header><div class="journal-body"></div>`);
  list = host.querySelector(".journal-body");
  host.querySelector<HTMLElement>("[data-journal-export]")!.onclick = () => exportHtml(o);

  list!.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-jact]");
    const art = b?.closest<HTMLElement>("[data-jid]");
    if (!b || !art) return;
    const id = art.dataset.jid!;
    const e = journalState().entries.find((x) => x.id === id);
    if (!e) return;
    const act = b.dataset.jact;
    if (act === "map") openMap(e, o);
    else if (act === "edit") startEdit(id, "text");
    else if (act === "add") startEdit(id, "add");
    else if (act === "cancel") {
      editing = null;
      draw();
    } else if (act === "save") save(id);
    else if (act === "delete") {
      if (!confirm(`Delete "${entryStory(e).heading}" from the journal?`)) return;
      journalDelete(id);
    }
  });
  list!.addEventListener("keydown", (ev) => {
    const ta = (ev.target as Element).closest?.("textarea[data-jedit]");
    const id = ta?.closest<HTMLElement>("[data-jid]")?.dataset.jid;
    if (!ta || !id) return;
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      save(id);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      editing = null;
      draw();
    }
  });

  // every room picture is a renderMap call: don't rebuild while hidden, and at most once a frame
  bus.on("journal:changed", () => {
    if (!panelVisible("journal")) {
      dirty = true;
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const stick = nearBottom();
      draw();
      if (stick && !editing) toBottom();
    });
  });
  onPanelShow((id) => {
    if (id !== "journal") return;
    if (dirty) {
      dirty = false;
      draw();
    }
    requestAnimationFrame(toBottom);
  });
  draw();
  requestAnimationFrame(toBottom);
}
