// 2D6 Void: the Hulk map. `mountHulkMap` is the live map with its room card, shared by the Hulk map
// page (#/play/vmap, render below) and the Hulk turn page. Like Dungeon's mapview.ts it reads the
// saved state ("vhulk") fresh on every draw; tapping an exit picks it for the next room, tapping a
// room shows its table row, notes and the down-ladder toggle. Edits are saved and announced as
// "void:changed" with this view's own source, so an open Hulk turn merges them (mergePanelEdits).
import type { ToolContext } from "../../main";
import { CELL, downloadMapPng, mapHint, openExits, renderMap, type DungeonMap, type MapRoom } from "../dmap";
import { getMapView } from "../dmaptiles";
import { fitMapToSpace } from "../mapfit";
import { load, playKey, save } from "../common";
import { html, setHTML, type Raw } from "../../ui/html";
import { button, eyebrow, statBlock } from "../../ui/components";
import { icon } from "../../ui/icon";
import { bus } from "../../shell/events";
import { exploredPct, hulkMap, ladderCell } from "./hulkmodel";

export const HULK_KEY = "vhulk";
const KIND: Record<MapRoom["kind"], string> = { entrance: "Entrance room", corridor: "Corridor", small: "Small room", regular: "Room", large: "Large room" };

/** The parts of the saved Hulk turn state the map needs. */
export interface HulkMapSaved {
  level: number;
  rooms: unknown[];
  current: { mapRoom?: number } | null;
  map?: DungeonMap;
  ladderIn?: { x: number; y: number } | null;
  portals?: { n: number; room: number }[];
  voidChamber?: number | null;
}
const loadHulk = () => load<HulkMapSaved>(HULK_KEY, { level: 1, rooms: [], current: null });

const C = CELL;
const f1 = (n: number) => n.toFixed(1);
const swirl = (cx: number, cy: number, r: number, n?: number): Raw =>
  html`<g transform="translate(${cx} ${cy})"><circle r="${r + 3}" fill="#7a3ad0" opacity=".25"/><circle r="${r}" fill="#1d0a33" stroke="#b07ae0" stroke-width="1.6"/><path d="M0 0 m${-r * 0.55} 0 a${r * 0.55} ${r * 0.55} 0 1 1 ${r * 0.55} ${r * 0.55} a${r * 0.32} ${r * 0.32} 0 1 1 ${-r * 0.32} ${-r * 0.32}" fill="none" stroke="#d0a8ff" stroke-width="1.2"/>${
    n !== undefined ? html`<circle cx="${r * 0.8}" cy="${-r * 0.8}" r="5.5" fill="#fff" stroke="#7a3ad0" stroke-width="1.2"/><text x="${r * 0.8}" y="${-r * 0.8 + 2.6}" font-size="7.5" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#3a1a6a">${n}</text>` : ""
  }</g>`;
const ladderIcon = (x: number, y: number, up: boolean): Raw => {
  const x0 = x * C, y0 = y * C, cx = x0 + C / 2;
  const arrow = up ? `M${cx - 5} ${y0 + 9} L${cx} ${y0 + 4} L${cx + 5} ${y0 + 9}` : `M${cx - 5} ${y0 + C - 9} L${cx} ${y0 + C - 4} L${cx + 5} ${y0 + C - 9}`;
  return html`<g pointer-events="none"><title>${up ? "Up-ladder (from the level above)" : "Down-ladder"}</title>${
    up ? html`<rect x="${x0 + 5}" y="${y0 + 5}" width="${C - 10}" height="${C - 10}" rx="2" fill="#2b3138" stroke="#c9d3dc" stroke-width="1"/><path d="M${x0 + 9} ${y0 + 7} V${y0 + C - 7} M${x0 + C - 9} ${y0 + 7} V${y0 + C - 7} M${x0 + 9} ${y0 + 12} H${x0 + C - 9} M${x0 + 9} ${y0 + 17} H${x0 + C - 9}" stroke="#c9d3dc" stroke-width="1.2"/>` : ""
  }<path d="${arrow}" fill="none" stroke="${up ? "#6bff8a" : "#ffb627"}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>`;
};

/**
 * The part of the 17 × 28 hull worth showing: everything drawn so far (rooms, exits, the up-ladder)
 * plus a margin for what comes next, never smaller than 10 × 10 squares and kept inside the hull.
 * Cropping to it lets the map fill its space instead of leaving most of the hull blank.
 */
export function hulkViewBox(m: DungeonMap, st: Pick<HulkMapSaved, "ladderIn">): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, w: number, h: number) => {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  };
  for (const r of m.rooms) add(r.x, r.y, r.w, r.h);
  for (const e of m.exits) add(e.x, e.y, 1, 1);
  if (st.ladderIn) add(st.ladderIn.x, st.ladderIn.y, 1, 1);
  if (x0 === Infinity) return { x: 0, y: 0, w: m.w, h: m.h };
  const MARGIN = 2, MIN = 10;
  const fit = (lo: number, hi: number, max: number): [number, number] => {
    lo = Math.max(0, lo - MARGIN); hi = Math.min(max, hi + MARGIN);
    const extra = MIN - (hi - lo);
    if (extra > 0) {
      lo = Math.max(0, lo - Math.ceil(extra / 2));
      hi = Math.min(max, lo + MIN);
      lo = Math.max(0, hi - MIN);
    }
    return [lo, hi];
  };
  const [cx0, cx1] = fit(x0, x1, m.w), [cy0, cy1] = fit(y0, y1, m.h);
  return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
}

/** The Hulk map: dmap's drawing in the chosen style, plus ladders, the Void Chamber and Void Portals (top-down view). */
export function renderHulkMap(st: HulkMapSaved, focus: number | null = null, current: number | null = st.current?.mapRoom ?? null): Raw {
  const m = st.map ?? hulkMap();
  const label = `Dark Hulk level ${st.level} map`;
  // the isometric view draws its own stairs; the extras are top-down only
  if (getMapView() === "iso") return renderMap(m, current, focus, undefined, undefined, { label });
  const crop = hulkViewBox(m, st);
  const over: Raw[] = [];
  if (st.ladderIn) over.push(ladderIcon(st.ladderIn.x, st.ladderIn.y, true));
  const down = m.stairs !== null ? m.rooms.find((r) => r.id === m.stairs) : undefined;
  if (down) {
    const c = ladderCell(down);
    over.push(ladderIcon(c.x, c.y, false));
  }
  const vc = st.voidChamber ? m.rooms.find((r) => r.id === st.voidChamber) : undefined;
  if (vc) {
    const cx = (vc.x + vc.w / 2) * C, cy = (vc.y + vc.h / 2) * C;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * C * 1.05, py = cy + Math.sin(a) * C * 1.05;
      over.push(html`<g pointer-events="none"><circle cx="${f1(px)}" cy="${f1(py)}" r="5" fill="#4a535c" stroke="#bfe9ff" stroke-width="1"/><text x="${f1(px)}" y="${f1(py + 2.4)}" font-size="6.5" font-family="sans-serif" text-anchor="middle" fill="#fff">${i + 1}</text></g>`);
    }
    over.push(html`<g pointer-events="none">${swirl(cx, cy, 9)}</g>`);
  }
  for (const p of st.portals ?? []) {
    const r = m.rooms.find((x) => x.id === p.room);
    if (r) over.push(html`<g pointer-events="none"><title>Void Portal ${p.n}</title>${swirl((r.x + 0.5) * C, (r.y + 0.5) * C + (r.h > 1 ? C / 2 : 0), 7, p.n)}</g>`);
  }
  return renderMap(m, current, focus, undefined, undefined, { label, crop, overlay: over.length ? html`${over}` : undefined });
}

const LEGEND: [string, string][] = [["#b89a6a", "Archway"], ["#8fa3b5", "Sliding door"], ["#d9a521", "Security door"], ["#3f9a5a", "Bio-coded door"], ["#38c6ff", "Electrical barrier"], ["#6b6f75", "Secret panel"]];
export const hulkLegendHtml = (): Raw =>
  html`<div class="map-legend">${LEGEND.map(([c, l]) => html`<span><i style="background:${c}"></i>${l}</span>`)}<span><i style="background:#c62828;border-radius:50%"></i>Locked</span><span><i style="background:#e0a33a;border-radius:50%"></i>Unexplored exit</span><span><i style="background:#ffb627"></i>Down-ladder</span></div>`;

export interface HulkMapOpts {
  /** The "void:changed" source this view saves under (each view has its own). */
  source: string;
  openTab(route: string, opts?: { newTab?: boolean }): void;
  toast(msg: string): void;
  onDispose(fn: () => void): void;
  /** Inside Hulk turn: no "Open Hulk turn" prompt, an "Open the map page" action instead. */
  embedded?: boolean;
}
export interface HulkMapView {
  refresh(): void;
  /** While Hulk turn awaits dice: exits and rooms can't be tapped. */
  setBusy(on: boolean): void;
}

/** Fill `host` with the live Hulk map. Listeners are removed through `onDispose`. */
export function mountHulkMap(host: HTMLElement, o: HulkMapOpts): HulkMapView {
  let focus: number | null = null;
  let busy = false;
  host.classList.add("dmapview", "vmapview");

  const commit = (st: HulkMapSaved) => {
    save(HULK_KEY, st);
    bus.emit("void:changed", { source: o.source });
  };

  function roomCard(st: HulkMapSaved, m: DungeonMap): Raw {
    const r = m.rooms.find((x) => x.id === focus);
    if (!r) return html`<p class="muted map-hint dmv-tip">Tap a room for its table row and your notes.</p>`;
    const ladder = m.stairs === r.id;
    const isChamber = st.voidChamber === r.id;
    const portal = (st.portals ?? []).find((p) => p.room === r.id);
    return html`<div class="room-card">
      <div class="room-card-head"><strong>#${r.n} ${r.label}</strong>
        <span class="muted">${isChamber ? "Void Chamber · no exits" : `${KIND[r.kind]} · ${r.w} × ${r.h}`}${r.sub ? ` · ${r.sub}` : ""}${ladder ? " · down-ladder" : ""}${portal ? ` · Void Portal ${portal.n}` : ""}</span>
        ${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-map-act="close" aria-label="Close room details"` })}</div>
      ${r.details?.length ? html`<div class="room-details">${statBlock(r.details)}</div>` : ""}
      <label class="field">Your notes<textarea data-room-notes="${r.id}" placeholder="Loot left behind, a locked locker, a body by the door…">${r.notes ?? ""}</textarea></label>
      ${isChamber || r.draft ? "" : html`<div class="step-actions">${button(ladder ? "Remove the down-ladder" : "Put the down-ladder here", { variant: "ghost", size: "sm", attrs: html`data-map-act="ladder" data-room-id="${r.id}"` })}</div>`}
    </div>`;
  }

  function view(): Raw {
    const st = loadHulk();
    const m = st.map;
    if (!m || !m.rooms.length)
      return o.embedded
        ? html`<div class="map-empty"><p class="muted">The map draws itself as you go. Start the level to draw the entrance room.</p></div>`
        : html`<div class="map-empty"><p class="muted">No rooms yet: begin in Start Game.</p>
          ${button("Open Start Game", { icon: "door-closed", variant: "ghost", size: "sm", attrs: html`data-map-act="open-hulk"` })}</div>`;
    const open = openExits(m).length;
    const pct = exploredPct(m, st.voidChamber ? [st.voidChamber] : []);
    const side = !o.embedded && m.rooms.some((x) => x.id === focus);
    const actions = html`<div class="map-actions">
        ${button("Save image", { icon: "image", variant: "ghost", size: "sm", attrs: html`data-map-act="png" title="Save the map as a picture"` })}
        ${o.embedded ? button("Map page", { icon: "map", variant: "ghost", size: "sm", attrs: html`data-map-act="open-map" title="Open the large map in its own tab"` }) : ""}
      </div>`;
    return html`<div class="dmv-grid${side ? " has-side" : ""}">
      <div class="dmv-map">
        <div class="map-head"><h2>Level ${st.level} map</h2>
          <span class="muted map-count">${open ? `${open} unexplored exit${open > 1 ? "s" : ""}` : "No open exits"} · ${pct}% explored</span></div>
        <div class="map-wrap vmap-wrap">${renderHulkMap(st, focus)}</div>
        ${busy ? html`<p class="muted map-hint dmv-busy">Rolling… the map is locked until the roll is done.</p>` : o.embedded ? "" : html`<p class="muted map-hint">${mapHint(m, !!st.current)}</p>`}
        ${side ? "" : roomCard(st, m)}
        ${actions}
        ${hulkLegendHtml()}
      </div>
      ${side ? html`<div class="dmv-side">${roomCard(st, m)}</div>` : ""}
    </div>`;
  }

  const draw = () => setHTML(host, view());
  function refresh() {
    const typing = document.activeElement instanceof HTMLTextAreaElement && host.contains(document.activeElement);
    if (!typing) return draw();
    const wrap = host.querySelector(".map-wrap");
    if (wrap) setHTML(wrap, renderHulkMap(loadHulk(), focus));
  }

  async function onClick(e: MouseEvent) {
    const t = e.target as Element;
    const act = t.closest<HTMLElement>("[data-map-act]")?.dataset.mapAct;
    if (act) {
      if (act === "close") focus = null;
      else if (act === "open-hulk") return o.openTab("#/play/vhulk", { newTab: true });
      else if (act === "open-map") return o.openTab("#/play/vmap", { newTab: true });
      else if (act === "png") {
        const st = loadHulk();
        if (!st.map) return;
        try {
          await downloadMapPng(String(renderHulkMap(st, null, null)), `dark-hulk-level-${st.level}-map.png`);
        } catch (err) {
          o.toast(String((err as Error).message ?? err));
        }
        return;
      } else if (act === "ladder") {
        const st = loadHulk();
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
      const st = loadHulk();
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
    }
  }
  function onInput(e: Event) {
    const ta = e.target as HTMLTextAreaElement;
    if (!ta.dataset.roomNotes) return;
    const st = loadHulk();
    const r = st.map?.rooms.find((x) => x.id === +ta.dataset.roomNotes!);
    if (!r) return;
    r.notes = ta.value;
    commit(st);
    refresh();
  }

  host.addEventListener("click", (e) => void onClick(e));
  host.addEventListener("input", onInput);
  o.onDispose(
    bus.on("void:changed", ({ source }) => {
      if (source !== o.source) refresh();
    }),
  );
  const onStorage = (e: StorageEvent) => {
    if (e.key === playKey(HULK_KEY)) refresh();
  };
  window.addEventListener("storage", onStorage);
  o.onDispose(() => window.removeEventListener("storage", onStorage));
  draw();
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

/** The Hulk map page (#/play/vmap): the current level drawn large. */
export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "map-page", "vmap-page");
  const st = loadHulk();
  setHTML(root, html`
    <header class="play-head">
      <div class="play-title">${eyebrow(`Level ${st.level}`)}<h1>${icon("map", { size: 26 })}<span>Hulk map</span></h1></div>
      <div class="play-actions"><a class="btn btn-ghost" href="#/play/vhulk">${icon("door-closed", { size: 17 })}<span>Start Game</span></a></div>
    </header>
    <section class="card map-card"><div class="map-body"></div></section>`);
  const body = root.querySelector<HTMLElement>(".map-body")!;
  mountHulkMap(body, { source: "vmap-page", openTab: ctx.openTab, toast: ctx.toast, onDispose: ctx.onDispose });
  fitMapToSpace(body, ctx.onDispose);
}
