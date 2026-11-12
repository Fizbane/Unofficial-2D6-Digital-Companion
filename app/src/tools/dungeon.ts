// Dungeon turn helper: walks one room at a time through the book's flowcharts
// (core p59-60; see docs/spec-dungeon.md §1).
import type { ToolContext } from "../main";
import { rollDice } from "../dice3d";
import { entryCells, followOns, isLockedTable, isTableRef, tableFor, type TableRef, type TableRoll } from "../rolltable";
import { onContentChange, type Locked } from "../content";
import { lockedCard, lockedCards } from "../ui/locked";
import { bus, type JournalDoorEvent, type JournalRoomEvent } from "../shell/events";
import { makeArrangeable } from "../shell/arrange";
import { readState, writeState } from "../shell/state";
import { rollAndLog } from "../shell/panels/results";
import { button, card, chip, eyebrow } from "../ui/components";
import { icon } from "../ui/icon";
import { load, save } from "./common";
import { mountDungeonMap, type DungeonMapView } from "./mapview";
import { loadChar, saveChar, stats } from "./sheet";
import {
  addRoom, doorCheckType, entrySideFor, mergePanelEdits, findPlacement, isDoor, mapHint, newMap, nextExit, openExits, parseExitType, placeEntrance, placeEntranceExits, placeExits,
  type DungeonMap, type ExitType, type MapExit, type Side,
} from "./dmap";
import { html, type Raw, setHTML } from "../ui/html";
import { plainText } from "../shell/journalprose";

type Kind = "entrance" | "corridor" | "small" | "regular" | "large";
/**
 * A table roll as the saved state keeps it: data, never markup (a saved state can come from an imported
 * backup). Drawn by rollHtml. A `string` is a roll saved as markup by an older version: shown as text only.
 */
export interface SavedRoll { title: string; dice: string; value: number; matched: boolean; columns: string[]; cells: string[] }
interface RoomRoll { title: string; sectionId: string; columns: string[]; cells: string[]; roll: SavedRoll | string; code?: string }
interface Draft {
  n: number;
  dice: string; // description of the size roll(s)
  x: number;
  y: number;
  kind: Kind;
  room?: RoomRoll;
  exits?: number;
  exitType?: string;
  results: { label: string; roll?: SavedRoll; html?: string }[]; // `html`: saved by an older version (text only)
  door?: DoorNote | string; // `string`: saved as markup by an older version (text only)
  mapRoom?: number; // id of this room on the map
  entry?: Side | null; // wall the party came in by
  via?: number; // map exit used to get here
}
/** The last door, lock, portcullis or slab roll, as data. */
export type DoorNote =
  | { k: "door"; kind: string; value: number; locked: boolean; marked: boolean }
  | { k: "pick"; q: number; mod: number; quality: number; a: number; prec: number; pick: number; total: number; ok: boolean }
  | { k: "roll"; roll: SavedRoll }
  | { k: "slab"; value: number; disc: number };
/** A roll's or door's header line in a step result. */
const rcHead = (label: string, dice = "") => html`<header class="rc-head">${eyebrow(label)}${dice ? html`<span class="rc-dice">${dice}</span>` : ""}</header>`;
// saved state can come from an imported backup: read each field defensively
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

/**
 * A saved roll as markup: its table row, with follow-on roll buttons (`followButtons`, from the row's text).
 * An old markup string is shown as its plain text; any other unexpected shape as nothing or text.
 */
export function rollHtml(x: SavedRoll | string, inline: (s: string) => Raw, followButtons: (text: string) => Raw): Raw {
  if (typeof x === "string") return html`<div class="rc-text">${plainText(x)}</div>`;
  if (!x || typeof x !== "object") return html``;
  const title = str(x.title);
  if (!x.matched) return html`${rcHead(title)}<div class="rc-text muted">${title}: rolled ${num(x.value)}, no matching row.</div>`;
  const columns = strs(x.columns), cells = strs(x.cells);
  return html`${rcHead(title, str(x.dice))}
      ${cells[1] ? html`<div class="rc-title">${inline(cells[1])}</div>` : ""}
      <dl class="kv">${columns
        .slice(2)
        .map((c, i) => (cells[i + 2] ? html`<dt>${c}</dt><dd>${inline(cells[i + 2])}</dd>` : ""))}</dl>
      <div class="rc-actions">${followButtons(cells.join(" "))}</div>`;
}

/** A saved door, lock, portcullis or slab result as markup. `patrol`: the patrol table to offer after a failed pick (null while locked). */
export function doorHtml(n: DoorNote | string, o: { inline: (s: string) => Raw; followButtons: (text: string) => Raw; patrol: string | null }): Raw {
  if (typeof n === "string") return html`<div class="rc-text">${plainText(n)}</div>`;
  if (!n || typeof n !== "object") return html``;
  if (n.k === "roll") return rollHtml(n.roll, o.inline, o.followButtons);
  if (n.k === "door") {
    const value = num(n.value);
    return html`${rcHead(`${str(n.kind)} door`, `D6 ${value}`)}<div class="rc-title${n.locked ? " is-bad" : ""}">${n.locked ? "Locked!" : "Not locked."}</div>${
      n.locked ? html`<div class="rc-text">Rolled ${value}. ${n.marked ? "Marked L on the map." : 'Mark it "L".'} Pick it, use a Potion of Phasing or Scroll of Melt Metal, or wait for a patrol.</div>` : html`<div class="rc-text">Rolled ${value}.</div>`
    }`;
  }
  if (n.k === "pick") {
    const [q, mod, quality, a, prec, pick, total] = [n.q, n.mod, n.quality, n.a, n.prec, n.pick, n.total].map(num);
    return html`${rcHead("Pick a lock", `${quality} vs ${total}`)}<div class="rc-title${n.ok ? "" : " is-bad"}">${n.ok ? "Unlocked!" : "Failed, the lock is damaged."}</div>
          <div class="rc-text"><strong>Lock quality</strong> ${q}${mod ? ` ${mod > 0 ? "+" : ""}${mod}` : ""} = ${quality}. <strong>Your attempt</strong> ${a} + Precision ${prec}${pick ? ` + pick ${pick}` : ""} = ${total}.${
            n.ok ? "" : " Wait: eat a ration (+2 HP per level, or −2 HP per level without), then fight a patrol to get through."
          }</div>${n.ok || !o.patrol ? "" : html`<div class="rc-actions">${button("Patrol", { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-follow="${o.patrol}|0"` })}</div>`}`;
  }
  if (n.k === "slab") {
    const value = num(n.value), disc = num(n.disc);
    const tips = value + disc >= 6;
    return html`${rcHead("Stone slab", `D6 ${value} + Discipline ${disc} = ${value + disc}`)}<div class="rc-title${tips ? "" : " is-bad"}">${tips ? "It tips over!" : "It doesn't budge."}</div>${
      tips ? "" : html`<div class="rc-text">No waiting for a patrol at a slab.</div>`
    }`;
  }
  return html``;
}

interface DoneRoom { n: number; kind: Kind; x: number; y: number; type: string; unique: boolean }
interface State { level: number; rooms: DoneRoom[]; current: Draft | null; map?: DungeonMap }

/**
 * Each level's tables, by section id or table code (rolltable.tableFor). Level 1 is in the free Codex;
 * the rest are locked until the owner unlocks the Codex, so they are named by code or by their opaque
 * page id, never by a title.
 */
const LEVEL_TABLES: Record<number, { rooms: string; sr: string; lr: string | null; ext: string; iaut: string; patrol: string; intro: string }> = {
  1: { rooms: "codex/level-1-rooms-human-ancestry-the-entry-part-1", sr: "codex/l1sr-level-1-small-rooms-6-squares-or-smaller", lr: "codex/l1lr-level-1-large-rooms-32-squares-or-larger", ext: "codex/ext1-exit-type-table-1", iaut: "codex/iaut1-interruptions-and-the-unexpected-table-1-part-1", patrol: "codex/l1p-level-1-patrols", intro: "codex/level-1-2-tables" },
  2: { rooms: "codex/p44-1", sr: "L2SR", lr: "L2LR", ext: "EXT2", iaut: "codex/iaut1-interruptions-and-the-unexpected-table-1-part-1", patrol: "L2P", intro: "codex/level-1-2-tables" },
  3: { rooms: "codex/p55-1", sr: "L3SR", lr: "L3LR", ext: "EXT3", iaut: "IAUT2", patrol: "L3P", intro: "codex/p48-1" },
  4: { rooms: "codex/p57-1", sr: "L4SR", lr: "L4LR", ext: "EXT4", iaut: "IAUT2", patrol: "L4P", intro: "codex/p48-1" },
  5: { rooms: "codex/p69-1", sr: "L5SR", lr: "L5LR", ext: "EXT5", iaut: "IAUT3", patrol: "L5P", intro: "codex/p61-1" },
  6: { rooms: "codex/p71-1", sr: "L6SR", lr: "L6LR", ext: "EXT6", iaut: "IAUT3", patrol: "L6P", intro: "codex/p62-1" },
  7: { rooms: "codex/p84-1", sr: "L7SR", lr: "L7LR", ext: "EXT7", iaut: "IAUT4", patrol: "L7P", intro: "codex/p75-1" },
  8: { rooms: "codex/p86-1", sr: "L8SR", lr: "L8MO", ext: "EXT8", iaut: "IAUT4", patrol: "L8P", intro: "codex/p76-1" },
  9: { rooms: "codex/p95-1", sr: "L9SR", lr: "L9LR", ext: "EXT9", iaut: "IAUT4", patrol: "L9P", intro: "codex/p90-1" },
  10: { rooms: "codex/p97-1", sr: "L10SR", lr: null, ext: "EXT10", iaut: "IAUT4", patrol: "L10P", intro: "codex/p91-1" },
};
const PORTCULLIS = "codex/polt1-portcullis-lever-table-1";

/** Every table key the tool looks up, for the test that they all resolve. */
export const dungeonTableKeys = (): string[] => [
  PORTCULLIS,
  ...Object.values(LEVEL_TABLES).flatMap((t) => [t.rooms, t.sr, t.lr, t.ext, t.iaut, t.patrol, t.intro].filter((k): k is string => !!k)),
];

/** The rollable table for a key, if it is free or unlocked. */
const refOf = (key: string | null | undefined): TableRef | undefined => {
  const x = key ? tableFor(key) : undefined;
  return isTableRef(x) ? x : undefined;
};
/** The locked placeholder for a key whose book is still locked. */
const lockOf = (key: string | null | undefined): Locked | undefined => {
  const x = key ? tableFor(key) : undefined;
  return isLockedTable(x) ? x.locked : undefined;
};

/** The Room type step's action: the roll button, or the locked card while that level's table is locked. */
export function roomTypeStep(level: number, kind: Kind, rolled: boolean): Raw | "" {
  const t = LEVEL_TABLES[level];
  const key = kind === "small" ? t.sr : kind === "large" ? t.lr : t.rooms;
  if (!key) return "";
  const l = lockOf(key);
  if (l) return lockedCard(l);
  return html`<div class="step-actions">${button(`${rolled ? "Re-roll" : "Roll"} on ${refOf(key)?.title ?? "room table"}`, { icon: "dice", size: "lg", variant: rolled ? undefined : "primary", attrs: html`data-act="type"` })}</div>`;
}

const KIND_LABEL: Record<Kind, string> = { entrance: "Entrance room", corridor: "Corridor", small: "Small room", regular: "Room", large: "Large room" };

function classify(x: number, y: number): Kind {
  const area = x * y;
  if (area <= 6) return "small"; // text: "6 squares or smaller" (flowchart says < 6)
  if (area >= 32) return "large"; // text: "32 squares or larger"
  return "regular";
}

/** Level 8: -2 to both dice (min 1). Level 10: +2 to both dice except 1s (capped at 6 – book doesn't say). */
function levelMod(level: number, d: number) {
  if (level === 8) return Math.max(1, d - 2);
  if (level === 10) return d === 1 ? 1 : Math.min(6, d + 2);
  return d;
}

const SIDE_LABEL: Record<Side, string> = { N: "north", E: "east", S: "south", W: "west" };
const blankState = (): State => ({ level: 1, rooms: [], current: null, map: undefined });

// Saved state can come from an imported backup, so a room's lists may not be lists. These read them safely.
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => (typeof v === "string" ? v : "")) : []);
/** A room's column names (never throws; non-text entries become ""). */
export const roomColumns = (room: unknown): string[] => strings((room as { columns?: unknown } | null | undefined)?.columns);
/** A room's i-th cell, or "". */
export const roomCell = (room: unknown, i: number): string => strings((room as { cells?: unknown } | null | undefined)?.cells)[i] ?? "";
/** Has a unique room of this type already been rolled? */
export const uniqueSeenIn = (rooms: unknown, type: string): boolean =>
  Array.isArray(rooms) && rooms.some((r) => !!r && typeof r === "object" && (r as DoneRoom).unique === true && typeof (r as DoneRoom).type === "string" && (r as DoneRoom).type.toUpperCase() === type.toUpperCase());

/** The saved dungeon state with its shape repaired: lists are lists, the level is a known one, the current room's tables are lists. */
export function cleanDungeonState(raw: unknown): State {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = { ...blankState(), ...r } as State;
  s.level = typeof s.level === "number" && LEVEL_TABLES[s.level] ? s.level : 1;
  s.rooms = Array.isArray(s.rooms) ? s.rooms.filter((x) => !!x && typeof x === "object" && typeof x.type === "string") : [];
  const cur = s.current as unknown;
  if (!cur || typeof cur !== "object" || Array.isArray(cur)) s.current = null;
  else {
    const d = cur as Draft;
    if (d.room && typeof d.room === "object") d.room = { ...d.room, columns: strings(d.room.columns), cells: strings(d.room.cells) };
    else delete d.room;
    if (!Array.isArray(d.results)) d.results = [];
  }
  return s;
}

const MAP_UI_KEY = "2d6:shell:dungeonMap"; // { collapsed } for the map above the steps on narrow widths
const isMapUi = (v: unknown): v is { collapsed: boolean } => typeof (v as { collapsed?: unknown })?.collapsed === "boolean";

/**
 * Lay the page out as the live map beside (wide) or above (narrow, collapsible) the step list and
 * return the step list's element, which draw() fills.
 */
function layout(page: HTMLElement, ctx: ToolContext): { main: HTMLElement; map: DungeonMapView } {
  page.classList.add("play-page", "page-wide", "dturn-page");
  // no saved choice yet: start collapsed in the narrow layout, so the steps aren't a screen below
  let collapsed = readState(MAP_UI_KEY, isMapUi, () => ({ collapsed: matchMedia("(max-width: 899px)").matches })).collapsed;
  setHTML(page, html`<div class="dturn"><div class="dturn-grid">
    <aside class="dturn-map card" aria-label="Dungeon map">
      <button type="button" class="dturn-map-toggle" aria-controls="dturn-map-body">${icon("map", { size: 16 })}<span>Map</span>${icon("chevron-down", { size: 16 })}</button>
      <div class="dturn-map-body" id="dturn-map-body"></div>
    </aside>
    <div class="dturn-main"></div>
  </div></div>`);
  makeArrangeable(page.querySelector<HTMLElement>(".dturn-grid")!, "2d6:shell:dungeonPanes");
  const aside = page.querySelector<HTMLElement>(".dturn-map")!;
  const toggle = aside.querySelector<HTMLButtonElement>(".dturn-map-toggle")!;
  const paint = () => {
    aside.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = collapsed ? "Show the map" : "Hide the map";
  };
  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    writeState(MAP_UI_KEY, { collapsed });
    paint();
  });
  paint();
  const map = mountDungeonMap(aside.querySelector<HTMLElement>(".dturn-map-body")!, {
    source: "map-dungeon", embedded: true, openTab: ctx.openTab, toast: ctx.toast, onDispose: ctx.onDispose,
  });
  return { main: page.querySelector<HTMLElement>(".dturn-main")!, map };
}

export function render(page: HTMLElement, ctx: ToolContext) {
  const st: State = cleanDungeonState(load<unknown>("dungeon", blankState()));
  const { main: root, map: mapView } = layout(page, ctx);
  // the maps (here, the Map page, the map window) and the Notes panel read the saved state; tell them it changed
  // a closed tab whose roll was still awaiting dice must not write over the newer saved state
  let live = true;
  ctx.onDispose(() => (live = false));
  const persist = () => {
    if (!live) return;
    save("dungeon", st);
    bus.emit("dungeon:changed", { source: "dungeon" });
  };
  const T = () => LEVEL_TABLES[st.level];
  if (!st.map) st.map = newMap(st.level);
  const M = () => st.map!;
  const mapRoom = (d: Draft | null) => (d?.mapRoom ? M().rooms.find((r) => r.id === d.mapRoom) : undefined);

  /** Exit type for the current room: small rooms/corridors/entrance = archways, else the room table or the EXT roll. */
  const currentExitType = (d: Draft) => {
    if (d.kind === "small" || d.kind === "corridor" || d.kind === "entrance") return parseExitType("ARCHWAYS");
    if (d.exitType) return parseExitType(d.exitType);
    const col = roomField("EXITS");
    return /RANDOM/i.test(col) || !col ? { type: "unknown" as const, allLocked: false } : parseExitType(col);
  };
  /** Keep the map in step with the draft: label, kind, exit types. */
  const syncMap = (d: Draft) => {
    const r = mapRoom(d);
    if (!r) return;
    r.kind = d.kind;
    r.label = d.kind === "entrance" ? "Entrance Room" : roomCell(d.room, 1) || (d.kind === "corridor" ? "Corridor" : KIND_LABEL[d.kind]);
    r.sub = d.room?.code ?? "";
    r.details = d.room ? roomColumns(d.room).slice(1).map((c, i) => [c, roomCell(d.room, i + 1)] as [string, string]).filter(([, v]) => v) : undefined;
    const et = currentExitType(d);
    for (const e of M().exits) if (e.room === r.id && e.to === undefined && e.type !== et.type) {
      e.type = et.type;
      e.allLocked = et.allLocked;
      if (et.allLocked && isDoor(et.type)) e.locked = true;
    }
  };
  /** The exit the next room goes through: the one tapped on the map, else the newest room's first open exit. */
  const chosenExit = (): MapExit | undefined => nextExit(M());

  /**
   * Tell the Journal about a Leave-step check. It describes the exit picked on the map, so it goes to
   * the room that owns that exit, with the exit's door type (or, when the map exit isn't a door, the
   * kind that was checked; doorCheckType). No exit picked: nothing to tell.
   */
  const journalDoor = (check: JournalDoorEvent["check"], ok: boolean, o: { kind?: ExitType; detail?: string } = {}) => {
    const ex = M().exits.find((x) => x.id === M().sel);
    if (!ex) return;
    const type = doorCheckType(ex.type, o.kind);
    bus.emit("journal:door", { level: st.level, room: ex.room, side: ex.side, type, check, ok, ...(o.detail ? { detail: o.detail } : {}) });
  };

  /** Tell the Journal what is now known about room `d` (it writes the story; nothing here depends on it). */
  const journal = (phase: JournalRoomEvent["phase"], d: Draft, extra: { encounter?: string } = {}) => {
    const col = (name: string) => {
      const i = d.room ? roomColumns(d.room).findIndex((c) => c.toUpperCase().startsWith(name)) : -1;
      return i >= 0 ? roomCell(d.room, i) : "";
    };
    bus.emit("journal:room", {
      phase, level: st.level, n: d.n, kind: d.kind, w: d.x, h: d.y, title: roomCell(d.room, 1), description: col("DESCRIPTION"),
      exitsKnown: d.exits !== undefined, map: M(), mapRoom: d.mapRoom, ...extra,
    });
  };

  // another window (the map window, or the maps / Notes panel of a second app window) can choose an
  // exit, edit room notes or place stairs: merge those fields from the shared saved state
  const onStorage = (e: StorageEvent) => {
    if (e.key !== "2d6:play:dungeon" || !e.newValue) return;
    try {
      const saved = (JSON.parse(e.newValue) as Partial<State> | null)?.map;
      if (st.map && saved && Array.isArray(saved.rooms)) {
        mergePanelEdits(M(), saved);
        draw();
      }
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);
  ctx.onDispose(() => window.removeEventListener("storage", onStorage));
  const link = (id: string, label: string) => html`<a href="#/s/${encodeURIComponent(id)}">${label}</a>`;

  const followButtons = (text: string) =>
    html`${followOns(text)
      .map((f) => button(f.label, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-follow="${f.ref.sectionId}|${f.modifier}"` }))}`;

  /** A roll's output inside a step: the result-card look (not a Results-store card; rollAndLog already logged it). */
  const stepResult = (body: Raw) => html`<article class="result-card step-result">${body}</article>`;

  const rollData = (r: TableRoll): SavedRoll => {
    const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
    const dice = `${r.roll.label} ${r.roll.text}${r.modifier ? ` ${r.modifier > 0 ? "+" : ""}${r.modifier} → ${r.value}` : ""}`;
    return { title: r.ref.title, dice, value: r.value, matched: r.rowIndex >= 0, columns, cells };
  };
  const rollView = (x: SavedRoll | string) => rollHtml(x, ctx.inline, followButtons);
  const doorView = (n: DoorNote | string) => doorHtml(n, { inline: ctx.inline, followButtons, patrol: lockOf(T().patrol) ? null : T().patrol });

  const roomField = (name: string) => {
    const r = st.current?.room;
    if (!r) return "";
    const i = roomColumns(r).findIndex((c) => c.toUpperCase().startsWith(name));
    return i >= 0 ? roomCell(r, i) : "";
  };

  let busy = false; // an action button is awaiting dice or a table roll

  const uniqueSeen = (type: string) => uniqueSeenIn(st.rooms, type);

  function draw() {
    const d = st.current;
    const c = loadChar();
    const cs = stats(c);
    const t = T();
    const level = st.level;
    const isFirst = st.rooms.length === 0;

    let steps: Raw | "" = "";
    if (d) {
      const area = d.x * d.y;
      const unique = roomField("UNIQUE");
      const exitsCol = roomField("EXITS");
      const pct = unique.match(/(\d+)%/);
      const dup = d.room && /YES/i.test(unique) && uniqueSeen(roomCell(d.room, 1));
      const needsType = d.kind !== "corridor" && d.kind !== "entrance";
      const exitsFixed = d.kind === "small" || d.kind === "corridor" || d.kind === "entrance";
      const exitCount = d.exits === undefined ? "" : d.exits === 0 ? "No new exits (dead end)" : `${d.exits} new exit${d.exits > 1 ? "s" : ""}`;
      // each step: [eyebrow name, title, done?, body]; the first step not done is the current one
      const list: [string, string, boolean, Raw][] = [];
      list.push([
        "Size",
        `${KIND_LABEL[d.kind]} ${d.x} × ${d.y}`,
        true,
        html`${stepResult(html`${rcHead("Size roll", `${area} squares`)}<div class="rc-text">${d.dice}</div>`)}
        ${d.kind === "entrance" ? "" : html`<div class="step-actions step-kinds"><span class="muted">Squeezed by the map? Change it:</span>
        ${(["corridor", "small", "regular", "large"] as Kind[]).filter((k) => k !== d.kind).map((k) => button(KIND_LABEL[k], { size: "sm", attrs: html`data-kind="${k}"` }))}</div>`}`,
      ]);
      if (d.kind === "entrance")
        list.push(["Entrance", "Entrance room", true, html`<p>Always empty. Add <strong>3 archway exits</strong>, one on each side without an exit.</p>`]);
      else if (d.kind === "corridor")
        list.push(["Corridor", "Corridor", d.exits !== undefined, html`<p>No room table and no encounter. All exits are archways.</p>`]);
      else
        list.push([
          "Room type",
          "Room type",
          !!d.room,
          html`${
            d.kind === "large" && level === 10
              ? html`<p>Level 10 has no large-rooms table: a large room starts or continues the level's special sequence of rooms. See ${link(t.intro, "Level 10 rules")}.</p>`
              : d.kind === "large" && level === 8
                ? html`<p>Level 8 has no large-rooms table: draw a mini-maze in the space, then roll on L8MO. ${link(t.intro, "Level 8 rules")}</p>`
                : ""
          }
          ${d.room ? stepResult(rollView(d.room.roll)) : ""}
          ${dup ? html`<p class="warn">This unique room already exists on this level: re-roll.</p>` : ""}
          ${pct ? html`<p class="warn">Special unique room: only use it if at least ${pct[1]}% of the level is revealed, otherwise re-roll.</p>` : ""}
          ${roomTypeStep(level, d.kind, !!d.room)}`,
        ]);
      if (d.kind !== "entrance")
        list.push([
          "Exits",
          "Exits",
          d.exits !== undefined && (exitsFixed || !!d.exitType),
          html`${
            d.exits !== undefined
              ? stepResult(
                  html`${rcHead("Number of exits")}<div class="rc-title">${exitCount}</div>
                  <div class="rc-text">${exitsFixed ? html`<strong>Archways</strong>` : d.exitType ? html`<strong>${d.exitType}</strong>` : exitsCol ? html`Room says <strong>${exitsCol}</strong>` : ""}</div>`,
                )
              : html`<p>Roll D6 for the number of exits.${exitsFixed ? html` All are <strong>archways</strong>.` : exitsCol ? html` Room says <strong>${exitsCol}</strong>.` : ""}</p>`
          }
          <div class="step-actions">
            ${button(`${d.exits !== undefined ? "Re-roll" : "Roll"} number of exits`, { icon: "dice", size: "lg", variant: d.exits !== undefined ? undefined : "primary", attrs: html`data-act="exits"` })}
            ${!exitsFixed && !lockOf(t.ext) && (/RANDOM/i.test(exitsCol) || (!exitsCol && d.room)) ? button(`Roll exit type (${refOf(t.ext)?.table.code ?? "EXT"})`, { icon: "dice", size: "lg", variant: d.exits !== undefined && !d.exitType ? "primary" : undefined, attrs: html`data-act="ext"` }) : ""}
          </div>
          ${!exitsFixed && lockOf(t.ext) ? lockedCard(lockOf(t.ext)!) : ""}
          <p class="muted step-note">Exits are drawn on the map: one per wall, max 3 new, not on the wall you came in by or the outer boundary, placed clockwise by D6 (1–2 first wall, 3–4 second, 5–6 third).</p>`,
        ]);
      if (needsType)
        list.push([
          "Encounter",
          "Encounter",
          false,
          html`<p>Deal with any creature first, then the rest of the room.</p>
          <div class="step-actions">
            ${button("Fight", { icon: "swords", size: "lg", attrs: html`data-act="fight"` })}
            ${lockOf(t.patrol) ? "" : button(`Patrol (${refOf(t.patrol)?.table.code ?? "LxP"})`, { icon: "dice", size: "lg", attrs: html`data-follow="${t.patrol}|0"` })}
            ${lockOf(t.iaut) ? "" : button(`Interruption (${refOf(t.iaut)?.table.code ?? "IAUT"})`, { icon: "dice", size: "lg", attrs: html`data-follow="${t.iaut}|0"` })}
          </div>
          ${lockedCards([lockOf(t.patrol), lockOf(t.iaut)].filter((l): l is Locked => !!l))}
          ${(Array.isArray(d.results) ? d.results : []).map((r) => stepResult(rollView(r?.roll ?? r?.html ?? "")))}`,
        ]);
      list.push([
        "Leave",
        "Leave the room",
        false,
        html`<p class="muted step-note">First time through a door? Check if it's locked:</p>
        <div class="step-actions">
          ${["Wooden", "Metal", "Reinforced"].map((k) => button(`${k} door`, { icon: "door-closed", attrs: html`data-door="${k}"` }))}
          ${lockOf(PORTCULLIS) ? "" : button("Portcullis (POLT1)", { icon: "dice", attrs: html`data-act="portcullis"` })}
          ${button("Stone slab", { attrs: html`data-act="slab"` })}
        </div>
        <div class="step-actions">
          ${button(`Pick a lock (2D6 + Precision ${cs.prec >= 0 ? "+" : ""}${cs.prec})`, { icon: "key-round", attrs: html`data-act="pick"` })}
        </div>
        ${d.door ? stepResult(doorView(d.door)) : ""}
        ${lockOf(PORTCULLIS) ? lockedCard(lockOf(PORTCULLIS)!) : ""}`,
      ]);
      const cur = list.findIndex(([, , done]) => !done);
      steps = html`<ol class="steps">${list
        .map(([name, title, done, body], i) => {
          const state = done ? "done" : i === cur ? "current" : "upcoming";
          return html`<li class="step card" data-state="${state}">
            <span class="step-marker" aria-hidden="true">${done ? icon("check", { size: 15 }) : i + 1}</span>
            <header class="card-head">${eyebrow(`Step ${i + 1} · ${name}`)}<h3 class="card-title">${title}</h3></header>
            <div class="card-body">${body}</div>
          </li>`;
        })}</ol>
      <div class="step-actions room-actions">
        ${button(`Finish room ${d.n}`, { icon: "check", size: "lg", variant: "primary", attrs: html`data-act="finish"` })}
        ${button("Discard", { icon: "trash", variant: "ghost", attrs: html`data-act="discard"` })}
      </div>`;
    }

    const pstat = (label: string, value: Raw, extra = "") => html`<span class="pstat${extra}">${eyebrow(label)}<span class="pstat-v">${value}</span></span>`;
    const hpPct = Math.max(0, Math.min(100, (c.hp / Math.max(1, cs.baseline)) * 100));
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow(`Play · Level ${level}`)}<h1>${icon("key", { size: 26 })}<span>Dungeon turn</span></h1></div>
        <div class="play-actions">
          <label class="level-pick"><span class="eyebrow">Level</span>
            <select data-level>${Array.from({ length: 10 }, (_, i) => html`<option ${i + 1 === level ? "selected" : ""}>${i + 1}</option>`)}</select></label>
          <a class="btn btn-ghost" href="#/s/${encodeURIComponent(t.intro)}">${icon("book", { size: 17 })}<span>Level ${level} rules</span></a>
        </div>
      </header>
      <section class="card play-status">
        ${pstat("Character", html`<strong>${c.name || "Adventurer"}</strong><span class="muted">· level ${cs.level}</span>`)}
        ${pstat("HP", html`<strong>${c.hp}</strong><span class="muted">/ ${cs.baseline}</span><span class="hp-bar mini"><span style="width:${hpPct}%"></span></span>`)}
        ${pstat("Rations", html`<strong>${c.rations}</strong>`)}
        ${c.bloodied ? pstat("Bloodied", html`<strong>${c.bloodied}</strong>/8`, " is-warn") : ""}
        ${c.soaked ? pstat("Soaked", html`<strong>${c.soaked}</strong>/8`, " is-warn") : ""}
        ${pstat("Rooms this level", html`<strong>${st.rooms.length}</strong>`)}
        <a href="#/play/sheet" class="btn btn-sm btn-ghost pstat-link">${icon("user", { size: 15 })}<span>Open sheet</span></a>
      </section>
      ${
        d
          ? html`<div class="room-head">${eyebrow(`Level ${level} · in progress`)}<h2>Room ${d.n}</h2></div>${steps}`
          : card(
              html`<div class="step-actions">${button(isFirst ? `Roll the entrance room (D66)` : `Roll the next room (2D6)`, { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="size"` })}</div>
              <p class="muted step-note">${isFirst ? "First room of the level: Primary = width, Secondary = height. It has no encounter and 3 archway exits." : `Primary die = width (X), Secondary = height (Y). Doubles expand the room; a 1 makes a corridor.${level === 8 ? " Level 8: −2 to both dice." : level === 10 ? " Level 10: +2 to both dice (not 1s)." : ""}`}</p>
              ${exitPicker()}`,
              { eyebrow: `Level ${level} · room ${st.rooms.length + 1}`, title: isFirst ? "The entrance" : "Next room", tone: "accent" },
            )
      }
      ${card(
        html`<div class="step-actions">
          ${button(`Eat a ration on the stairs (+${2 * cs.level} HP)`, { icon: "utensils", attrs: html`data-act="ration"` })}
          ${button("No ration (lose half HP, max 20)", { attrs: html`data-act="noration"` })}
          ${button("Search for an exit shaft", { icon: "search", attrs: html`data-act="shaft"` })}
          ${button(`Go down to level ${Math.min(10, level + 1)}`, { icon: "arrow-down", variant: "primary", attrs: html`data-act="nextlevel"` })}
        </div>
        <p class="muted step-note">Place the down stairs in the last room that fits (about 75% explored; at least 50%). Exit shafts: roll D6 per square touching the boundary, a 6 is a shaft. Once per level.</p>`,
        { eyebrow: "Stairs", title: "Between levels & leaving" },
      )}
      ${
        st.rooms.length
          ? card(
              html`<ol class="room-list">${st.rooms
                .map((r) => html`<li><span>${r.type || KIND_LABEL[r.kind]}</span> <span class="muted">${KIND_LABEL[r.kind]} ${r.x}×${r.y}${r.unique ? " · unique" : ""}</span></li>`)}</ol>`,
              { eyebrow: `${st.rooms.length} room${st.rooms.length === 1 ? "" : "s"}`, title: `Rooms on level ${level}` },
            )
          : ""
      }`);
    // a panel or another tab redrew us while an action awaits its dice: keep the controls off
    if (busy)
      for (const el of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) {
        el.disabled = true;
        el.setAttribute("data-busy", "");
      }
  }

  /** Choose the exit the next room goes through (tapping it on a map does the same). */
  function exitPicker() {
    const m = M();
    if (!m.rooms.length) return "";
    const open = openExits(m);
    const next = nextExit(m);
    const chips = html`${open
      .map((e) => {
        const r = m.rooms.find((x) => x.id === e.room);
        const kind = `${e.type === "unknown" ? "exit" : e.type}${e.locked ? ", locked" : ""}`;
        return chip(`#${r?.n ?? "?"} ${SIDE_LABEL[e.side]}`, { value: kind, active: e.id === next?.id, attrs: html`data-pick-exit="${e.id}"` });
      })}`;
    return html`${open.length ? html`<div class="exit-pick"><span class="muted">Next room through:</span>${chips}</div>` : ""}
      <p class="muted exit-pick-hint">${mapHint(m, false)}</p>`;
  }

  async function rollSize() {
    const n = st.rooms.length + 1;
    const level = st.level;
    if (st.rooms.length === 0) {
      const r = await rollDice("D66");
      let [x, y] = r.dice;
      let note = `Rolled ${x} and ${y}.`;
      if (x * y > 12) {
        x = Math.ceil(x / 2);
        y = Math.ceil(y / 2);
        note += ` Over 12 squares, so both halved (rounded up) to ${x} × ${y}.`;
      }
      if (x * y < 6) {
        [x, y] = x >= y ? [3, 2] : [2, 3];
        note += ` Under 6 squares, so it becomes 6: ${x} × ${y} (reshape it to fit if you like).`;
      }
      const m = M();
      const p = placeEntrance(m, x, y);
      if (!p) return ctx.toast("The entrance room doesn't fit on the map.");
      const room = addRoom(m, { n, x: p.x, y: p.y, w: p.w, h: p.h, kind: "entrance", label: "Entrance Room", sub: "", draft: true });
      placeEntranceExits(m, room);
      st.current = { n, dice: note, x, y, kind: "entrance", results: [], mapRoom: room.id, entry: "S", exits: 3 };
    } else {
      const exit = chosenExit();
      if (!exit) return ctx.toast("There are no open exits left on this level. Put the stairs in the last room, or add a secret door (see the rules).");
      const r = await rollDice("2D6");
      const [p0, s0] = r.dice;
      const p = levelMod(level, p0), s = levelMod(level, s0);
      let note = `Primary ${p0}, Secondary ${s0}.`;
      if (p !== p0 || s !== s0) note += ` Level ${level} changes them to ${p} and ${s}.`;
      let x = p, y = s, kind: Kind;
      if (p === s) {
        if (p === 6) {
          note += " Double 6: a 6 × 6 room.";
          kind = "large";
        } else {
          const r2 = await rollDice("2D6");
          x = p + r2.dice[0];
          y = s + r2.dice[1];
          note += ` Doubles! Rolled again: ${r2.dice[0]} and ${r2.dice[1]}, added to make ${x} × ${y}.`;
          kind = classify(x, y);
        }
      } else if (p === 1 || s === 1) {
        kind = "corridor";
        note += " A 1 means a corridor.";
      } else kind = classify(x, y);
      // place it on the map beyond the chosen exit; squeeze it if it doesn't fit
      const m = M();
      const pl = findPlacement(m, exit, x, y);
      if (!pl) {
        exit.blocked = true;
        m.sel = null;
        persist();
        draw();
        return ctx.toast("Nothing fits beyond that exit (it runs into other rooms or the boundary). It's marked as blocked: pick another exit.");
      }
      if (pl.w !== x || pl.h !== y) {
        note += ` The map only has room for ${pl.w} × ${pl.h}, so it's squeezed to that.`;
        x = pl.w;
        y = pl.h;
        kind = x === 1 || y === 1 ? "corridor" : classify(x, y);
      }
      const room = addRoom(m, { n, x: pl.x, y: pl.y, w: pl.w, h: pl.h, kind, label: KIND_LABEL[kind], sub: "", draft: true });
      exit.to = room.id;
      m.sel = null;
      st.current = { n, dice: note, x, y, kind, results: [], mapRoom: room.id, entry: entrySideFor(exit), via: exit.id };
      syncMap(st.current);
    }
    persist();
    journal("start", st.current);
    draw();
  }

  /** Put this room's exits on the map (after the number of exits is known). */
  function mapExits(d: Draft) {
    const r = mapRoom(d);
    if (!r || d.exits === undefined || d.kind === "entrance") return "";
    const et = currentExitType(d);
    const rolls = Array.from({ length: d.exits }, () => 1 + Math.floor(Math.random() * 6));
    const placed = placeExits(M(), r, d.entry ?? null, d.exits, et.type, et.allLocked, rolls);
    return placed < d.exits ? ` Only ${placed} fit${placed === 1 ? "s" : ""} on the map (walls on the boundary or blocked); the rest are ignored.` : "";
  }

  async function rollType() {
    const d = st.current!;
    const t = T();
    const id = d.kind === "small" ? t.sr : d.kind === "large" ? t.lr : t.rooms;
    const ref = refOf(id); // a locked table shows its card at the step instead of this button
    if (!ref) return ctx.toast("Couldn't find that table.");
    const r = await rollAndLog(ref, 0, undefined, `Level ${st.level} · room ${d.n}`);
    const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
    d.room = { title: ref.title, sectionId: ref.sectionId, columns, cells, roll: rollData(r), code: `${ref.table.code ?? `L${st.level}`} ${r.value}` };
    d.exitType = undefined;
    syncMap(d);
    persist();
    journal("update", d);
    draw();
  }

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.level !== undefined) {
      if (st.rooms.length && !confirm("Switch level? This starts a fresh room list and map.")) return draw();
      st.level = +el.value;
      st.rooms = [];
      st.current = null;
      st.map = newMap(st.level);
      persist();
      draw();
    }
  });

  // tap an open exit to choose where to go next (tapping the chosen one again clears the choice)
  root.addEventListener("click", (e) => {
    const p = (e.target as Element).closest?.("[data-pick-exit]");
    if (!p) return;
    const id = +p.getAttribute("data-pick-exit")!;
    M().sel = M().sel === id ? null : id;
    persist();
    draw();
  });

  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || busy) return;
    b.disabled = true;
    busy = true;
    try {
      mapView.setBusy(true); // a pick made mid-roll would be merged, then cleared by the roll
      const d = st.current;
      const t = T();
      const act = b.dataset.act;
      if (act === "size") await rollSize();
      else if (act === "type") await rollType();
      else if (b.dataset.kind && d) {
        d.kind = b.dataset.kind as Kind;
        d.room = undefined;
        d.exitType = undefined;
        syncMap(d);
        persist();
        journal("update", d);
        draw();
      } else if (act === "exits" && d) {
        const r = await rollDice("D6");
        d.exits = r.value === 1 ? 0 : r.value <= 3 ? 1 : r.value <= 5 ? 2 : 3;
        const extra = mapExits(d);
        ctx.toast(`Number of exits: rolled ${r.value} → ${d.exits}.${extra}`);
        persist();
        journal("update", d);
        draw();
      } else if (act === "ext" && d) {
        const ref = refOf(t.ext);
        if (ref) {
          const r = await rollAndLog(ref, 0, undefined, `Level ${st.level} · room ${d.n} exits`);
          d.exitType = r.cells[1] ?? "";
          syncMap(d);
          persist();
          journal("update", d);
          draw();
        }
      } else if (act === "fight") {
        ctx.openTab("#/play/combat", { newTab: true });
      } else if (act === "stairs") {
        const r = mapRoom(d) ?? [...M().rooms].pop();
        if (r) {
          M().stairs = M().stairs === r.id ? null : r.id;
          persist();
          draw();
        }
      } else if (b.dataset.follow) {
        const [id, mod] = b.dataset.follow.split("|");
        const ref = refOf(id);
        if (ref) {
          const r = await rollAndLog(ref, +mod || 0, undefined, d ? `Level ${st.level} · room ${d.n}` : undefined);
          if (d) {
            d.results.push({ label: ref.title, roll: rollData(r) });
            persist();
            if (r.rowIndex >= 0) journal("update", d, { encounter: r.cells[1] || ref.title });
            draw();
          }
        }
      } else if (b.dataset.door && d) {
        const r = await rollDice("D6");
        const kind = b.dataset.door;
        const locked = kind === "Wooden" ? r.value === 6 : kind === "Reinforced" ? r.value >= 5 : r.value >= 4;
        const ex = M().exits.find((x) => x.id === M().sel);
        if (ex) ex.locked = locked || undefined;
        d.door = { k: "door", kind, value: r.value, locked, marked: !!ex };
        persist();
        journalDoor("door", !locked, { kind: kind.toLowerCase() as ExitType });
        draw();
      } else if (act === "pick" && d) {
        const mod = parseInt(prompt("Lock modifier printed in the room (e.g. -2), or 0:", "0") || "0", 10) || 0;
        const pick = parseInt(prompt("Your lock pick bonus (e.g. 3 for 'Lock Pick +3'):", "0") || "0", 10) || 0;
        const q = await rollDice("2D6");
        const quality = q.value + mod;
        const a = await rollDice("2D6");
        const cs = stats(loadChar());
        const total = a.value + cs.prec + pick;
        const ok = total >= quality;
        const ex = M().exits.find((x) => x.id === M().sel);
        if (ex && ok) ex.locked = undefined;
        d.door = { k: "pick", q: q.value, mod, quality, a: a.value, prec: cs.prec, pick, total, ok };
        persist();
        journalDoor("pick", ok);
        draw();
      } else if (act === "portcullis") {
        const ref = refOf(PORTCULLIS);
        if (ref) {
          const r = await rollAndLog(ref, 0, undefined, d ? `Room ${d.n} portcullis` : undefined);
          if (d) {
            d.door = { k: "roll", roll: rollData(r) };
            persist();
            if (r.rowIndex >= 0) journalDoor("portcullis", true, { kind: "portcullis", detail: r.cells[1] || String(r.value) });
            draw();
          }
        }
      } else if (act === "slab" && d) {
        const r = await rollDice("D6");
        const disc = stats(loadChar()).disc;
        d.door = { k: "slab", value: r.value, disc };
        persist();
        journalDoor("slab", r.value + disc >= 6, { kind: "slab" });
        draw();
      } else if (act === "finish" && d) {
        const type = roomCell(d.room, 1);
        const unique = /YES/i.test(roomField("UNIQUE"));
        st.rooms.push({ n: d.n, kind: d.kind, x: d.x, y: d.y, type, unique });
        syncMap(d);
        const mr = mapRoom(d);
        if (mr) delete mr.draft;
        journal("finish", d);
        st.current = null;
        // Bloodied/Soaked: tick a box per room; past 8 lose 1 HP per room
        const c = loadChar();
        const msgs: string[] = [];
        for (const k of ["bloodied", "soaked"] as const) {
          if (c[k] > 0) {
            if (c[k] >= 8) {
              c.hp = Math.max(0, c.hp - 1);
              msgs.push(`${k === "bloodied" ? "Fever" : "Pneumonia"}: −1 HP`);
            } else c[k]++;
          }
        }
        saveChar(c, "dungeon");
        if (msgs.length) ctx.toast(msgs.join(" · "));
        persist();
        draw();
      } else if (act === "discard") {
        if (d) journal("discard", d);
        const mr = mapRoom(d);
        if (mr) {
          const m = M();
          m.rooms = m.rooms.filter((r) => r.id !== mr.id);
          m.exits = m.exits.filter((x) => x.room !== mr.id);
          for (const x of m.exits) if (x.to === mr.id) delete x.to;
          if (d?.kind === "entrance") m.entrance = null;
          if (m.stairs === mr.id) m.stairs = null;
        }
        st.current = null;
        persist();
        draw();
      } else if (act === "ration" || act === "noration") {
        const c = loadChar();
        const cs = stats(c);
        if (act === "ration") {
          if (c.rations < 1) return ctx.toast("No rations left!");
          c.rations--;
          const bandage = confirm("Do you have a cloth or bandage? (+2 more HP)");
          const before = c.hp;
          c.hp = Math.max(c.hp, Math.min(cs.baseline, c.hp + 2 * cs.level + (bandage ? 2 : 0)));
          ctx.toast(`Ate a ration: +${c.hp - before} HP (${c.rations} left)`);
          bus.emit("journal:milestone", { kind: "rest", ration: true, hp: c.hp - before });
        } else {
          const loss = Math.min(20, Math.floor(c.hp / 2));
          c.hp -= loss;
          ctx.toast(`No ration: −${loss} HP`);
          bus.emit("journal:milestone", { kind: "rest", ration: false, hp: loss });
        }
        saveChar(c, "dungeon");
        draw();
      } else if (act === "shaft") {
        const n = parseInt(prompt("How many squares of explored rooms touch the outer boundary?", "1") || "0", 10);
        if (n > 0) {
          const r = await rollDice(`${Math.min(n, 12)}D6`);
          const hit = r.dice.indexOf(6);
          ctx.toast(hit >= 0 ? `Exit shaft found at square ${hit + 1}! Mark it "E".` : `No exit shaft (${r.dice.join(", ")}).`);
          if (hit >= 0) bus.emit("journal:milestone", { kind: "leave", level: st.level });
        }
      } else if (act === "nextlevel") {
        if (st.level >= 10) return ctx.toast("Level 10 is the last level.");
        if (!confirm(`Finish level ${st.level} and go down to level ${st.level + 1}? Remember to eat a ration on the stairs.`)) return;
        const c = loadChar();
        c.legend[st.level - 1] = true;
        saveChar(c, "dungeon");
        st.level++;
        st.rooms = [];
        st.current = null;
        st.map = newMap(st.level);
        persist();
        bus.emit("journal:milestone", { kind: "descend", from: st.level - 1, to: st.level });
        draw();
        ctx.toast(`Level ${st.level - 1} ticked on your Legend tracker.`);
      }
    } finally {
      b.disabled = false;
      busy = false;
      mapView.setBusy(false);
      // buttons a redraw disabled while we were waiting
      for (const el of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("[data-busy]")) {
        el.disabled = false;
        el.removeAttribute("data-busy");
      }
    }
  });

  // The maps (this page's, the Map page's) and the Notes panel edit the same saved state (room notes, stairs, the chosen exit):
  // merge just those fields into our map, in place, so our next persist() keeps them and a roll
  // that is awaiting dice still writes into the live objects.
  ctx.onDispose(
    bus.on("dungeon:changed", ({ source }) => {
      if (source === "dungeon") return;
      const saved = load<State>("dungeon", blankState()).map;
      if (saved && saved !== st.map) mergePanelEdits(M(), saved);
      draw();
    }),
  );
  // HP and rations shown in the header strip
  ctx.onDispose(
    bus.on("character:changed", ({ source }) => {
      if (source !== "dungeon") draw();
    }),
  );
  // a book was unlocked or locked again: the steps show the tables, or the locked card
  ctx.onDispose(onContentChange(() => draw()));
  draw();
}
