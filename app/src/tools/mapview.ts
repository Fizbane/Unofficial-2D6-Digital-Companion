// The live dungeon map with its room card, shared by the Map page and the Dungeon turn page.
// It reads the saved game state ("2d6:play:dungeon") fresh on every draw, so it works whether or
// not a Dungeon turn tab is open. Tapping an exit picks it for the next room; tapping a room shows
// its row, notes and the stairs toggle. Edits are saved and announced on the bus with this view's
// own source, so an open Dungeon tab merges them (mergePanelEdits) instead of overwriting them,
// and every other view (another tab, the map window) redraws.
import { downloadMapPng, legendHtml, mapHint, newMap, openExits, renderMap, type DungeonMap, type MapRoom } from "./dmap";
import { load, save } from "./common";
import { button, statBlock } from "../ui/components";
import { bus } from "../shell/events";
import { takeMapFocus } from "../shell/mapfocus";
import { html, setHTML, type Raw } from "../ui/html";

export const DUNGEON_KEY = "2d6:play:dungeon";
const KIND: Record<MapRoom["kind"], string> = { entrance: "Entrance room", corridor: "Corridor", small: "Small room", regular: "Room", large: "Large room" };

interface Saved { level: number; current: { mapRoom?: number } | null; map?: DungeonMap }
const loadDungeon = () => load<Saved>("dungeon", { level: 1, current: null, map: undefined });

let mapWin: Window | null = null;
/** Open (or focus) the live map in its own browser window. */
export function openMapWindow() {
  if (mapWin && !mapWin.closed) {
    mapWin.focus();
    return;
  }
  const url = `${location.pathname}#/play/mapwindow`;
  mapWin = window.open(url, "2d6-dungeon-map", "width=760,height=820");
  if (!mapWin) alert("Your browser blocked the pop-up window. Allow pop-ups for this page.");
}

export interface DungeonMapOpts {
  /** The "dungeon:changed" source this view saves under (each view has its own). */
  source: string;
  openTab(route: string, opts?: { newTab?: boolean }): void;
  toast(msg: string): void;
  onDispose(fn: () => void): void;
  /** Inside Dungeon turn: no "Open Dungeon turn" prompt, an "Open the Map page" action instead. */
  embedded?: boolean;
}

export interface DungeonMapView {
  refresh(): void;
  /** While Dungeon turn awaits dice: exits and rooms can't be tapped, and the hint says so. */
  setBusy(on: boolean): void;
}

/** Fill `host` with the live dungeon map. Listeners are removed through `onDispose`. */
export function mountDungeonMap(host: HTMLElement, o: DungeonMapOpts): DungeonMapView {
  let focus: number | null = null; // room tapped on the map
  let busy = false;
  host.classList.add("dmapview");

  const commit = (st: Saved) => {
    save("dungeon", st);
    bus.emit("dungeon:changed", { source: o.source });
  };

  function roomCard(m: DungeonMap): Raw {
    const r = m.rooms.find((x) => x.id === focus);
    if (!r) return html`<p class="muted map-hint dmv-tip">Tap a room for its details and notes.</p>`;
    const stairs = m.stairs === r.id;
    return html`<div class="room-card">
      <div class="room-card-head"><strong>#${r.n} ${r.label}</strong>
        <span class="muted">${KIND[r.kind]} · ${r.w} × ${r.h}${r.sub ? ` · ${r.sub}` : ""}${stairs ? " · stairs down" : ""}</span>
        ${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-map-act="close" aria-label="Close room details"` })}</div>
      ${r.details?.length ? html`<div class="room-details">${statBlock(r.details)}</div>` : ""}
      <label class="field">Your notes<textarea data-room-notes="${r.id}" placeholder="Loot left behind, a locked chest, who's still here…">${r.notes ?? ""}</textarea></label>
      <div class="step-actions">${button(stairs ? "Remove the stairs" : "Put the stairs down here", { variant: "ghost", size: "sm", attrs: html`data-map-act="stairs" data-room-id="${r.id}"` })}</div>
    </div>`;
  }

  function view(): Raw {
    const st = loadDungeon();
    const m = st.map ?? newMap(st.level);
    if (!m.rooms.length)
      return o.embedded
        ? html`<div class="map-empty"><p class="muted">The map draws itself as you roll rooms. Start with the entrance room.</p></div>`
        : html`<div class="map-empty"><p class="muted">No rooms yet — start in Dungeon turn.</p>
          ${button("Open Dungeon turn", { icon: "key", variant: "ghost", size: "sm", attrs: html`data-map-act="open-dungeon"` })}</div>`;
    const open = openExits(m).length;
    // the room card sits beside the map on the Map page when a room is picked; the key and the
    // actions always go under the map, so the map itself gets the width
    const side = !o.embedded && m.rooms.some((x) => x.id === focus);
    const actions = html`<div class="map-actions">
          ${button("Save image", { icon: "image", variant: "ghost", size: "sm", attrs: html`data-map-act="png" title="Save the map as a picture"` })}
          ${button("New window", { icon: "external-link", variant: "ghost", size: "sm", attrs: html`data-map-act="window" title="Open the map in its own browser window"` })}
          ${o.embedded ? button("Map page", { icon: "map", variant: "ghost", size: "sm", attrs: html`data-map-act="open-map" title="Open the large map in its own tab"` }) : ""}
        </div>`;
    return html`<div class="dmv-grid${side ? " has-side" : ""}">
      <div class="dmv-map">
        <div class="map-head"><h2>Level ${st.level} map</h2>
          <span class="muted map-count">${open ? `${open} unexplored exit${open > 1 ? "s" : ""}` : "No open exits"}</span></div>
        <div class="map-wrap">${renderMap(m, st.current?.mapRoom ?? null, focus)}</div>
        ${busy ? html`<p class="muted map-hint dmv-busy">Rolling… the map is locked until the roll is done.</p>` : o.embedded ? "" : html`<p class="muted map-hint">${mapHint(m, !!st.current)}</p>`}
        ${side ? "" : roomCard(m)}
        ${actions}
        ${legendHtml()}
      </div>
      ${side ? html`<div class="dmv-side">${roomCard(m)}</div>` : ""}
    </div>`;
  }

  const draw = () => setHTML(host, view());

  /** Redraw, but while the room notes are being typed in, only refresh the map picture. */
  function refresh() {
    const typing = document.activeElement instanceof HTMLTextAreaElement && host.contains(document.activeElement);
    if (!typing) return draw();
    const st = loadDungeon();
    const wrap = host.querySelector(".map-wrap");
    if (wrap && st.map) setHTML(wrap, renderMap(st.map, st.current?.mapRoom ?? null, focus));
  }

  async function onClick(e: MouseEvent) {
    const t = e.target as Element;
    const act = t.closest<HTMLElement>("[data-map-act]")?.dataset.mapAct;
    if (act) {
      if (act === "close") focus = null;
      else if (act === "open-dungeon") return o.openTab("#/play/dungeon", { newTab: true });
      else if (act === "open-map") return o.openTab("#/play/map", { newTab: true });
      else if (act === "window") return openMapWindow();
      else if (act === "png") {
        const st = loadDungeon();
        if (!st.map) return;
        try {
          await downloadMapPng(String(renderMap(st.map, null)), `dungeon-level-${st.level}-map.png`);
        } catch (err) {
          o.toast(String((err as Error).message ?? err));
        }
        return;
      } else if (act === "stairs") {
        const st = loadDungeon();
        if (!st.map) return;
        const id = +t.closest<HTMLElement>("[data-room-id]")!.dataset.roomId!;
        st.map.stairs = st.map.stairs === id ? null : id;
        commit(st);
      }
      return draw();
    }
    if (busy && t.closest?.("[data-exit], [data-room]")) return;
    const ex = t.closest?.("[data-exit]");
    if (ex) {
      const st = loadDungeon();
      if (!st.map) return;
      const id = +ex.getAttribute("data-exit")!;
      st.map.sel = st.map.sel === id ? null : id;
      commit(st);
      return draw();
    }
    const rm = t.closest?.("[data-room]");
    if (rm) {
      const id = +rm.getAttribute("data-room")!;
      focus = focus === id ? null : id;
      draw();
      if (focus !== null) revealCard(id);
    }
  }

  /**
   * When the card is stacked under the map, scroll so it shows, but never so far that the tapped
   * room leaves the screen.
   */
  function revealCard(roomId: number) {
    const card = host.querySelector<HTMLElement>(".room-card");
    const map = host.querySelector<HTMLElement>(".dmv-map");
    const room = host.querySelector(`[data-room="${roomId}"]`);
    const scroller = host.closest<HTMLElement>(".tab-page");
    if (!card || !map || !room || !scroller) return;
    const c = card.getBoundingClientRect();
    if (c.left >= map.getBoundingClientRect().right - 1) return; // beside the map: nothing to do
    const view = scroller.getBoundingClientRect();
    const need = c.bottom + 8 - view.bottom;
    if (need <= 0) return;
    const head = 48; // the sticky page header
    const roomRoom = Math.max(0, room.getBoundingClientRect().top - (view.top + head + 8));
    scroller.scrollBy({ top: Math.min(need, roomRoom) });
  }

  function onInput(e: Event) {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta.dataset.roomNotes) return;
    const st = loadDungeon();
    const r = st.map?.rooms.find((x) => x.id === +ta.dataset.roomNotes!);
    if (!r) return;
    r.notes = ta.value;
    commit(st);
    refresh(); // the room's notes mark on the map
  }

  host.addEventListener("click", (e) => void onClick(e));
  host.addEventListener("input", onInput);
  o.onDispose(
    bus.on("dungeon:changed", ({ source }) => {
      if (source !== o.source) refresh();
    }),
  );
  // the separate map window (or another browser tab) saved the dungeon
  const onStorage = (e: StorageEvent) => {
    if (e.key === DUNGEON_KEY) refresh();
  };
  window.addEventListener("storage", onStorage);
  o.onDispose(() => window.removeEventListener("storage", onStorage));
  // the Journal asked to see a room (its picture was tapped): the Map page shows that room's card
  if (!o.embedded) {
    const wanted = takeMapFocus();
    if (wanted !== null) focus = wanted;
    o.onDispose(
      bus.on("map:focus", ({ room }) => {
        takeMapFocus();
        focus = room;
        draw();
        revealCard(room);
      }),
    );
  }
  draw();
  if (focus !== null) requestAnimationFrame(() => revealCard(focus!));
  return {
    refresh,
    setBusy(on) {
      if (busy === on) return;
      busy = on;
      host.toggleAttribute("data-busy", on);
      refresh();
    },
  };
}
