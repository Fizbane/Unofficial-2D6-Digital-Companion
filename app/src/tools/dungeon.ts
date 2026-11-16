// Dungeon turn helper: walks one room at a time through the book's flowcharts
// (core p59-60; see docs/spec-dungeon.md §1).
import type { ToolContext } from "../main";
import { rollDice } from "../dice3d";
import { entryCells, isLockedTable, isTableRef, tableByCode, tableFor, type TableRef, type TableRoll } from "../rolltable";
import { onContentChange, type Locked } from "../content";
import { lockedCard, lockedCards } from "../ui/locked";
import { bus, type JournalDoorEvent, type JournalRoomEvent } from "../shell/events";
import { makeArrangeable } from "../shell/arrange";
import { readState, writeState } from "../shell/state";
import { rollAndLog } from "../shell/panels/results";
import { button, card, chip, eyebrow } from "../ui/components";
import { icon } from "../ui/icon";
import { gated, load, overrideOf, playKey, resetEncounter, save, undoTurnWarning } from "./common";
import { creatureIndex, queueFoe } from "./combat";
import {
  boundarySquares, clearRoomDoors, creaturesIn, prisonersIn, doorNeed, retypeExit, doorOf, encounterActions, exploredPct, finishBlock, isLockedRoll, lockedOn, passable, stairsHp, waitHp,
  type DoorNote, type Doors, type DoorState, type SavedRoll,
} from "./dungeonflow";
import { mountDungeonMap, type DungeonMapView } from "./mapview";
import { loadChar, saveChar, stats } from "./sheet";
import { lootIn } from "./gear";
import { addLoot } from "./loot";
import { findRoll, revertAuto, rollId, type AutoLog } from "./autoapply";
import { charCard, portrait, wireCharCard } from "../shell/panels/charcard";
import { fatigueText } from "../shell/charmodel";
import { watchPortraits } from "../shell/portraitcard";
import * as sheetApi from "./sheet";
import {
  MAX_DUNGEON_GRID, addDungeonSecretDoor, addRoom, entrySideFor, exitLabel, mergePanelEdits, findPlacement, generatedFraction, isDoor, mapHint, minDungeonGrid, needsDungeonSecretDoor, newMap, nextExit, openExits, parseExitType, placeEntrance, placeEntranceExits, placeExits, reshapeRoom, sealedDungeonRooms, validDungeonGrid,
  type DungeonMap, type ExitType, type MapExit, type Side,
} from "./dmap";
import { familyFor } from "./dmapshape";
import { askNumber } from "../ui/ask";
import { openModal } from "../ui/modal";
import { html, type Raw, setHTML } from "../ui/html";
import { plainText } from "../shell/journalprose";

type Kind = "entrance" | "corridor" | "small" | "regular" | "large";
export type { DoorNote, SavedRoll } from "./dungeonflow";
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
  door?: DoorNote | string; // saved by an older version, when doors were checked inside the room; no longer shown
  encDone?: boolean; // the encounter is dealt with
  fought?: boolean; // a Fight button was pressed for this room
  byBook?: { type?: boolean; exits?: boolean }; // steps done from the printed book (their table is locked or absent)
  mapRoom?: number; // id of this room on the map
  entry?: Side | null; // wall the party came in by
  via?: number; // map exit used to get here
  auto?: AutoLog; // what this room's rolls put on the sheet by themselves (taken back on Undo turn or a re-roll)
}
/** A roll's or door's header line in a step result. */
const rcHead = (label: string, dice = "") => html`<header class="rc-head">${eyebrow(label)}${dice ? html`<span class="rc-dice">${dice}</span>` : ""}</header>`;
// saved state can come from an imported backup: read each field defensively
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

/** Columns whose text is what the player sees or what happens to them: shown as a narration bubble. */
export const isNarrativeColumn = (name: unknown): boolean => typeof name === "string" && /^(DESCRIPTION|DESCRIPTION AND EFFECT|EFFECT|RESULT)$/i.test(name.trim());

/** The bubble's label: what the player sees, or what happens to them. */
const narrator = (col: string): string => (/effect|result/i.test(col) ? "What happens" : "You see");

/** Narration already shown this visit: only a new one pops out (the page redraws on every action). */
const told = new Set<string>();
interface Narration { who: string; body: Raw }
let fresh: Narration[] = [];
/** A chat-bubble card that draws the eye to flavour text. `key` is the plain text (to tell new from already shown). */
export function narrate(who: string, body: Raw, key: string): Raw {
  if (!told.has(key)) { told.add(key); fresh.push({ who, body }); }
  return bubble(who, body);
}
const bubble = (who: string, body: Raw, cls = ""): Raw => html`<figure class="narrate${cls}"><figcaption class="narrate-who">${who}</figcaption><blockquote class="narrate-text">${body}</blockquote></figure>`;
/** The narrations first shown since the last call. */
export const takeNarrations = (): Narration[] => { const n = fresh; fresh = []; return n; };

/**
 * A saved roll as markup: its table row, with follow-on roll buttons (`followButtons`, from the row's text).
 * An old markup string is shown as its plain text; any other unexpected shape as nothing or text.
 */
export function rollHtml(x: SavedRoll | string, inline: (s: string) => Raw, followButtons: (text: string, roll?: SavedRoll) => Raw): Raw {
  if (typeof x === "string") return html`<div class="rc-text">${plainText(x)}</div>`;
  if (!x || typeof x !== "object") return html``;
  const title = str(x.title);
  if (!x.matched) return html`${rcHead(title)}<div class="rc-text muted">${title}: rolled ${num(x.value)}, no matching row.</div>`;
  const columns = strs(x.columns), cells = strs(x.cells);
  const leadStory = isNarrativeColumn(columns[1]) && !!cells[1];
  const rest = columns.slice(2);
  return html`${rcHead(title, str(x.dice))}
      ${leadStory ? narrate(narrator(columns[1]), inline(cells[1]), cells[1]) : cells[1] ? html`<div class="rc-title">${inline(cells[1])}</div>` : ""}
      <dl class="kv">${rest.map((c, i) => (cells[i + 2] && !isNarrativeColumn(c) ? html`<dt>${c}</dt><dd>${inline(cells[i + 2])}</dd>` : ""))}</dl>
      ${rest.map((c, i) => (cells[i + 2] && isNarrativeColumn(c) ? narrate(narrator(c), inline(cells[i + 2]), cells[i + 2]) : ""))}
      <div class="rc-actions">${followButtons(cells.join(" "), x)}</div>`;
}

/** A saved door, lock, portcullis or slab result as markup. `patrol`: the patrol table to offer after a failed pick (null while locked). */
export function doorHtml(n: DoorNote | string, o: { inline: (s: string) => Raw; followButtons: (text: string, roll?: SavedRoll) => Raw; patrol: string | null }): Raw {
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
type Result = Draft["results"][number];
interface State {
  level: number; rooms: DoneRoom[]; current: Draft | null; map?: DungeonMap;
  doors?: Doors; // what is known about each exit's door, by exit id
  loose?: Result[]; // rolls made between rooms, at no door
  rest?: "ration" | "none"; // the choice made on the stairs
  shaftUsed?: boolean; // the level's one exit shaft search
}

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
export function roomTypeStep(level: number, kind: Kind, rolled: boolean, primary = !rolled): Raw | "" {
  const t = LEVEL_TABLES[level];
  const key = kind === "small" ? t.sr : kind === "large" ? t.lr : t.rooms;
  if (!key) return "";
  const l = lockOf(key);
  if (l) return lockedCard(l, true);
  return html`<div class="step-actions">${button(`${rolled ? "Re-roll" : "Roll"} on ${refOf(key)?.title ?? "room table"}`, { icon: "dice", size: "lg", variant: primary ? "primary" : undefined, attrs: html`data-act="type"` })}</div>`;
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

const EXIT_WORD: Partial<Record<ExitType, string>> = { archway: "Archway", curtain: "Curtain", wooden: "Wooden door", metal: "Metal door", reinforced: "Reinforced door", portcullis: "Portcullis", slab: "Stone slab" };
const SIDE_LABEL: Record<Side, string> = { N: "north", E: "east", S: "south", W: "west" };
const blankState = (): State => ({ level: 1, rooms: [], current: null, map: undefined });
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

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
    for (const k of ["encDone", "fought"] as const) if (d[k] !== true) delete d[k];
    if (!d.byBook || typeof d.byBook !== "object" || Array.isArray(d.byBook)) delete d.byBook;
  }
  const doors: Doors = {};
  if (s.doors && typeof s.doors === "object" && !Array.isArray(s.doors))
    for (const [k, v] of Object.entries(s.doors)) if (v && typeof v === "object" && !Array.isArray(v)) doors[+k] = { ...v };
  for (const v of Object.values(doors)) {
    if (Array.isArray(v.note)) v.note = v.note.filter((n) => !!n && typeof n === "object" && typeof (n as { k?: unknown }).k === "string");
    else delete v.note;
  }
  s.doors = doors;
  s.loose = Array.isArray(s.loose) ? s.loose.filter((x) => !!x && typeof x === "object") : [];
  if (s.rest !== "ration" && s.rest !== "none") delete s.rest;
  if (s.shaftUsed !== true) delete s.shaftUsed;
  return s;
}

const MAP_UI_KEY = "2d6:shell:dungeonMap"; // { collapsed } for the map above the steps on narrow widths
const isMapUi = (v: unknown): v is { collapsed: boolean } => typeof (v as { collapsed?: unknown })?.collapsed === "boolean";

/**
 * Lay the page out as the live map beside (wide) or above (narrow, collapsible) the step list and
 * return the step list's element, which draw() fills.
 */
function layout(page: HTMLElement, ctx: ToolContext): { main: HTMLElement; status: HTMLElement; map: DungeonMapView } {
  page.classList.add("play-page", "page-wide", "dturn-page");
  // no saved choice yet: start collapsed in the narrow layout, so the steps aren't a screen below
  let collapsed = readState(MAP_UI_KEY, isMapUi, () => ({ collapsed: matchMedia("(max-width: 899px)").matches })).collapsed;
  setHTML(page, html`<div class="dturn"><div class="dturn-grid">
    <aside class="dturn-map card" aria-label="Dungeon map">
      <button type="button" class="dturn-map-toggle" aria-controls="dturn-map-body">${icon("map", { size: 16 })}<span>Map</span>${icon("chevron-down", { size: 16 })}</button>
      <div class="dturn-map-body" id="dturn-map-body"></div>
      <div class="dturn-status"></div>
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
  return { main: page.querySelector<HTMLElement>(".dturn-main")!, status: aside.querySelector<HTMLElement>(".dturn-status")!, map };
}

export function render(page: HTMLElement, ctx: ToolContext) {
  const st: State = cleanDungeonState(load<unknown>("dungeon", blankState()));
  const { main: root, status, map: mapView } = layout(page, ctx);
  // hover the portrait in the strip: the character card, as the name chip shows it
  watchPortraits({
    content: () => {
      const c = loadChar();
      return charCard(c, stats(c), fatigueText(load<{ phase?: string; fatigue?: number } | null>("combat", null)));
    },
    wire: (el) => wireCharCard(el, { source: "portrait", sheet: () => sheetApi, openSheet: () => ctx.openTab("#/play/sheet") }),
    onDispose: ctx.onDispose,
  });
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
  st.map.std ??= minDungeonGrid(st.level); // a map saved before std existed (possibly a bigger custom grid)
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
    // exits not yet used follow the room's exit type, locks included: a re-rolled room or EXT result must not
    // leave "locked" on what is now an archway, nor miss "(ALL LOCKED)" when only that part changed
    for (const e of M().exits) if (e.room === r.id && e.to === undefined && (e.type !== et.type || !!e.allLocked !== et.allLocked)) {
      e.type = et.type;
      e.allLocked = et.allLocked;
      delete st.doors?.[e.id];
      if (et.allLocked && isDoor(et.type)) e.locked = true;
      else delete e.locked;
    }
  };
  /** The exit the next room goes through: the one tapped on the map, else the newest room's first open exit. */
  const chosenExit = (): MapExit | undefined => nextExit(M());

  /** Tell the Journal about a check made at exit `ex` (it goes to the room that owns the exit). */
  const journalDoor = (ex: MapExit, check: JournalDoorEvent["check"], ok: boolean, detail?: string) => {
    bus.emit("journal:door", { level: st.level, room: ex.room, side: ex.side, type: ex.type, check, ok, ...(detail ? { detail } : {}) });
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
    if (e.key !== playKey("dungeon") || !e.newValue) return;
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

  /** The tables a text says to roll that are free or unlocked, and the locked cards of those that aren't. Creature lists (L1G, L1P) count: their codes don't end in a digit, so rolltable.followOns misses them. */
  const tablesIn = (text: string) => {
    const open: { code: string; modifier: number; label: string }[] = [];
    const locked: Locked[] = [];
    for (const c of encounterActions(text, [], (k) => !!tableByCode(k)).tables) {
      const x = tableByCode(c.code);
      if (isTableRef(x)) open.push({ ...c, label: `${c.code}${c.modifier ? (c.modifier > 0 ? ` +${c.modifier}` : ` ${c.modifier}`) : ""}` });
      else if (isLockedTable(x)) locked.push(x.locked);
    }
    return { open, locked };
  };
  /** A roll that frees prisoners gets a stable id, so its Liberate button finds it in the saved state after any redraw. */
  const liberateButton = (roll: SavedRoll, n: number) => {
    const who = `${n} prisoner${n === 1 ? "" : "s"}`;
    if (roll.liberated)
      return html`<span class="muted small">✓ ${who} tallied on your sheet · ${link("core/liberating-prisoners", "Liberating Prisoners table")}</span>`;
    roll.lid ??= rollId();
    return button(`Liberate ${who}`, {
      icon: "flag", size: "sm",
      attrs: html`data-liberate="${roll.lid}" title="Tally ${who} on your sheet. Roll the Liberating Prisoners table for each when you return to town."`,
    });
  };
  /** Take back what the room's rolls put on the sheet by themselves (Undo turn, or the room rolled again). */
  const undoAuto = (d: Draft | null | undefined) => {
    if (!d?.auto) return;
    const c = loadChar();
    const back = revertAuto(c, d.auto);
    delete d.auto;
    if (!back.length) return;
    saveChar(c, "dungeon");
    ctx.toast(`Taken back off your sheet: ${back.join("; ")}.`);
  };
  const followButtons = (text: string, roll?: SavedRoll) => {
    const freed = roll ? prisonersIn(text) : 0;
    return html`${creaturesIn(text, creatureNames()).map((n) => fightButton(n, { small: true }))}${tablesIn(text).open
      .map((f) => button(f.label, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-follow="${f.code}|${f.modifier}"` }))}${freed ? liberateButton(roll!, freed) : ""}`;
  };

  /** A roll's output inside a step: the result-card look (not a Results-store card; rollAndLog already logged it). */
  const stepResult = (body: Raw) => html`<article class="result-card step-result">${body}</article>`;

  const rollData = (r: TableRoll): SavedRoll => {
    const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
    const dice = `${r.roll.label} ${r.roll.text}${r.modifier ? ` ${r.modifier > 0 ? "+" : ""}${r.modifier} → ${r.value}` : ""}`;
    return { title: r.ref.title, dice, value: r.value, matched: r.rowIndex >= 0, columns, cells };
  };
  const rollView = (x: SavedRoll | string) => rollHtml(x, ctx.inline, followButtons);

  const roomField = (name: string) => {
    const r = st.current?.room;
    if (!r) return "";
    const i = roomColumns(r).findIndex((c) => c.toUpperCase().startsWith(name));
    return i >= 0 ? roomCell(r, i) : "";
  };

  let firstDraw = true;
  /** Bring the step to do next into view and put focus on its main action. */
  const toNextStep = () => {
    const step = root.querySelector<HTMLElement>('.steps > li.step[data-state="current"]');
    if (!step) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    step.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    step.querySelector<HTMLElement>("button.btn-primary:not([disabled]), button:not([disabled]), a[href]")?.focus({ preventScroll: true });
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
    const minGrid = minDungeonGrid(level);

    let steps: Raw | "" = "";
    const explored = exploredPct(M());
    if (d) {
      const area = d.x * d.y;
      const unique = roomField("UNIQUE");
      const exitsCol = roomField("EXITS");
      const pct = unique.match(/(\d+)%/);
      const dup = !!d.room && /YES/i.test(unique) && uniqueSeen(roomCell(d.room, 1));
      const pctShort = !!d.room && !!pct && explored < +pct[1];
      const tabled = d.kind !== "corridor" && d.kind !== "entrance";
      const exitsFixed = d.kind === "small" || d.kind === "corridor" || d.kind === "entrance";
      const exitCount = d.exits === undefined ? "" : d.exits === 0 ? "No new exits (dead end)" : `${d.exits} new exit${d.exits > 1 ? "s" : ""}`;
      const typeKey = d.kind === "small" ? t.sr : d.kind === "large" ? t.lr : t.rooms;
      const exitTypeKnown = exitsFixed || currentExitType(d).type !== "unknown";
      const typeDone = !tabled || !!d.byBook?.type || (!!d.room && !dup && !pctShort);
      const exitsDone = d.kind === "entrance" || (d.exits !== undefined && (d.exits === 0 || exitTypeKnown || !!d.byBook?.exits));
      const block = finishBlock({ kind: d.kind, hasRoom: !!d.room, duplicate: dup, pctShort, exits: d.exits, exitTypeKnown, encDone: d.encDone, byBook: d.byBook });
      // the one step to do next: its main action is the page's only primary button
      const cur = !typeDone ? "type" : !exitsDone ? "exits" : tabled && !d.encDone ? "enc" : "finish";
      const results = (list: Result[]) => html`${(Array.isArray(list) ? list : []).map((r) => stepResult(rollView(r?.roll ?? r?.html ?? "")))}`;
      const byBook = (what: "type" | "exits", label: string) => button(label, { icon: "book", variant: cur === what ? "primary" : undefined, attrs: html`data-act="by-book-${what}"` });
      // each step: [eyebrow name, title, done?, body]
      const list: [string, string, boolean, Raw][] = [];
      list.push([
        "Size",
        `${KIND_LABEL[d.kind]} ${d.x} × ${d.y}`,
        true,
        html`${stepResult(html`${rcHead("Size roll", `${area} squares`)}<div class="rc-text">${d.dice}</div>`)}
        ${d.kind === "entrance" ? "" : html`<details class="step-more"><summary>Doesn't fit as drawn?</summary><div class="step-actions step-kinds"><span class="muted">Squeezed by the map? Change it:</span>
        ${(["corridor", "small", "regular", "large"] as Kind[]).filter((k) => k !== d.kind).map((k) => button(KIND_LABEL[k], { size: "sm", attrs: html`data-kind="${k}"` }))}</div></details>`}`,
      ]);
      if (d.kind === "entrance")
        list.push(["Entrance", "Entrance room", true, html`<p>Always empty. Add <strong>3 archway exits</strong>, one on each side without an exit.</p>${results(d.results)}`]);
      else if (d.kind === "corridor")
        list.push(["Corridor", "Corridor", d.exits !== undefined, html`<p>No room table and no encounter. All exits are archways.</p>${results(d.results)}`]);
      else
        list.push([
          "Room type",
          "Room type",
          typeDone,
          html`${
            d.kind === "large" && level === 10
              ? html`<p>Level 10 has no large-rooms table: a large room starts or continues the level's special sequence of rooms. See ${link(t.intro, "Level 10 rules")}.</p>`
              : d.kind === "large" && level === 8
                ? html`<p>Level 8 has no large-rooms table: draw a mini-maze in the space, then roll on L8MO. ${link(t.intro, "Level 8 rules")}</p>`
                : ""
          }
          ${d.room ? stepResult(rollHtml(d.room.roll, ctx.inline, () => html``)) : ""}
          ${dup ? html`<p class="warn">This unique room already exists on this level: re-roll.</p>` : ""}
          ${pctShort ? html`<p class="warn">Special unique room: it only appears once at least ${pct![1]}% of the level is revealed (${explored}% now). Re-roll.</p>` : ""}
          ${d.byBook?.type ? html`<p class="ok">Rolled in your book.</p>` : roomTypeStep(level, d.kind, !!d.room, cur === "type")}
          ${!d.room && !d.byBook?.type && (!typeKey || lockOf(typeKey)) ? html`<div class="step-actions">${byBook("type", "Rolled it in my book")}</div>` : ""}`,
        ]);
      if (d.kind !== "entrance")
        list.push([
          "Exits",
          "Exits",
          exitsDone,
          html`${
            d.exits !== undefined
              ? stepResult(
                  html`${rcHead("Number of exits")}<div class="rc-title">${exitCount}</div>
                  <div class="rc-text">${exitsFixed ? html`<strong>Archways</strong>` : d.exitType ? html`<strong>${d.exitType}</strong>` : exitsCol ? html`Room says <strong>${exitsCol}</strong>` : d.byBook?.exits ? "Type rolled in your book: set it at each exit as you leave." : ""}</div>`,
                )
              : html`<p>Roll D6 for the number of exits.${exitsFixed ? html` All are <strong>archways</strong>.` : exitsCol ? html` Room says <strong>${exitsCol}</strong>.` : ""}</p>`
          }
          <div class="step-actions">
            ${button(`${d.exits !== undefined ? "Re-roll" : "Roll"} number of exits`, { icon: "dice", size: "lg", variant: cur === "exits" && d.exits === undefined ? "primary" : undefined, attrs: html`data-act="exits"` })}
            ${!exitsFixed && !lockOf(t.ext) && (/RANDOM/i.test(exitsCol) || (!exitsCol && (d.room || d.byBook?.type))) ? button(`Roll exit type (${refOf(t.ext)?.table.code ?? "EXT"})`, { icon: "dice", size: "lg", variant: cur === "exits" && d.exits !== undefined ? "primary" : undefined, attrs: html`data-act="ext"` }) : ""}
            ${!exitsFixed && lockOf(t.ext) && !exitTypeKnown && d.exits !== undefined && !d.byBook?.exits ? byBook("exits", "Rolled the exit type in my book") : ""}
          </div>
          ${!exitsFixed && lockOf(t.ext) && !exitTypeKnown ? lockedCard(lockOf(t.ext)!, true) : ""}
          <p class="muted step-note">Exits are drawn on the map: one per wall, max 3 new, not on the wall you came in by or the outer boundary, placed clockwise by D6 (1–2 first wall, 3–4 second, 5–6 third).</p>`,
        ]);
      if (tabled) {
        const enc = roomField("ENCOUNTER"), desc = roomField("DESCRIPTION");
        const text = `${desc} ${enc}`;
        const acts = encounterActions(text, creatureNames(), (c) => !!tableByCode(c));
        const tables = tablesIn(text);
        const nothing = !!d.room && !acts.creatures.length && !acts.tables.length;
        const rolled = Array.isArray(d.results) && d.results.length > 0;
        // next within the step: fight what the room names, else roll what it says, else you're done here
        const lead = cur !== "enc" ? "" : acts.creatures.length && !d.fought ? "fight" : tables.open.length && !rolled ? "table" : "done";
        const ready = !!d.room || !!d.byBook?.type;
        list.push([
          "Encounter",
          "Encounter",
          !!d.encDone,
          !ready
            ? html`<p class="muted">Roll the room type first.</p>`
            : html`${d.room ? (enc ? html`<div class="enc-text"><strong>Encounter:</strong> ${ctx.inline(enc)}</div>` : "") : html`<p>Follow the room's entry in your book.</p>`}
          ${nothing ? html`<p>Nothing to deal with here.</p>` : html`<p class="muted step-note">Creatures first, then the other tables in the order written.</p>`}
          <div class="step-actions">
            ${acts.creatures.map((n, i) => fightButton(n, { lead: lead === "fight" && i === 0 }))}
            ${tables.open.map((f, i) => button(f.label, { icon: "dice", variant: lead === "table" && i === 0 ? "primary" : undefined, attrs: html`data-follow="${f.code}|${f.modifier}"` }))}
            ${d.encDone ? "" : button(nothing ? "Nothing here" : "Encounter resolved", { icon: "check", variant: lead === "done" ? "primary" : undefined, attrs: html`data-act="enc-done"` })}
          </div>
          ${lockedCards(tables.locked, true)}
          ${d.encDone ? html`<p class="ok">Dealt with.</p>` : ""}
          ${results(d.results)}
          <details class="step-more"><summary>Other rolls</summary>
            <p class="muted">Only when something calls for them: a noisy search, cooking meat, or text the buttons above missed.</p>
            <div class="step-actions">
              ${lockOf(t.patrol) ? "" : button(`Patrol (${refOf(t.patrol)?.table.code ?? "LxP"})`, { icon: "dice", size: "sm", attrs: html`data-follow="${t.patrol}|0"` })}
              ${lockOf(t.iaut) ? "" : button(`Interruption (${refOf(t.iaut)?.table.code ?? "IAUT"})`, { icon: "dice", size: "sm", attrs: html`data-follow="${t.iaut}|0"` })}
              ${button("Open Combat", { icon: "swords", size: "sm", attrs: html`data-act="fight"` })}
            </div>
            ${lockedCards([lockOf(t.patrol), lockOf(t.iaut)].filter((l): l is Locked => !!l), true)}
          </details>`,
        ]);
      }
      const curIdx = list.findIndex(([, , done]) => !done);
      const mr = mapRoom(d);
      const isStairs = !!mr && M().stairs === mr.id;
      steps = html`<ol class="steps">${list
        .map(([name, title, done, body], i) => {
          const state = done ? "done" : i === curIdx ? "current" : "upcoming";
          return html`<li class="step card" data-state="${state}" data-coach="step-${name.toLowerCase().replace(/\s+/g, "-")}">
            <span class="step-marker" aria-hidden="true">${done ? icon("check", { size: 15 }) : i + 1}</span>
            <header class="card-head">${eyebrow(`Step ${i + 1} · ${name}`)}<h3 class="card-title">${title}</h3></header>
            <div class="card-body">${body}</div>
          </li>`;
        })}</ol>
      <div class="step-actions room-actions">
        ${gated(`Finish room ${d.n}`, { icon: "check", size: "lg", variant: cur === "finish" ? "primary" : undefined, attrs: html`data-act="finish"` }, block, "finish")}
        ${button("Undo turn", { icon: "rotate-ccw", variant: "ghost", attrs: html`data-act="discard" title="Take this room back off the map. Not in the rules: for fixing a mistake."` })}
      </div>
      ${d.kind !== "entrance" && level < 10 && (generatedFraction(M()) >= 0.5 || isStairs) ? html`<div class="step-actions">${button(isStairs ? "Remove the down stairs" : "Last room: put the down stairs here", { icon: "arrow-down", attrs: html`data-act="stairs"` })}
        <span class="muted">${explored}% of the level explored.</span></div>` : ""}`;
    }

    const pstat = (label: string, value: Raw, extra = "") => html`<span class="pstat${extra}">${eyebrow(label)}<span class="pstat-v">${value}</span></span>`;
    const hpPct = Math.max(0, Math.min(100, (c.hp / Math.max(1, cs.baseline)) * 100));
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow(`Level ${level}`)}<h1>${icon("key", { size: 26 })}<span>Start Game</span></h1></div>
        <div class="play-actions">
          <label class="level-pick"><span class="eyebrow">Level</span>
            <select data-level>${Array.from({ length: 10 }, (_, i) => html`<option ${i + 1 === level ? "selected" : ""}>${i + 1}</option>`)}</select></label>
          <a class="btn btn-ghost" href="#/s/${encodeURIComponent(t.intro)}">${icon("book", { size: 17 })}<span>Level ${level} rules</span></a>
        </div>
      </header>
      <section class="card play-status">
        ${portrait(c, "lg")}
        ${pstat("Character", html`<strong>${c.name || "Adventurer"}</strong><span class="muted">· level ${cs.level}</span>`)}
        ${pstat("HP", html`<strong>${c.hp}</strong><span class="muted">/ ${cs.baseline}</span><span class="hp-bar mini"><span style="width:${hpPct}%"></span></span>`)}
        ${pstat("Rations", html`<strong>${c.rations}</strong>`)}
        ${c.bloodied ? pstat("Bloodied", html`<strong>${c.bloodied}</strong>/8`, " is-warn") : ""}
        ${c.soaked ? pstat("Soaked", html`<strong>${c.soaked}</strong>/8`, " is-warn") : ""}
        ${pstat("Rooms this level", html`<strong>${st.rooms.length}</strong>`)}
        ${pstat("Explored", html`<strong>${explored}%</strong>`)}
        <a href="#/play/sheet" class="btn btn-sm btn-ghost pstat-link">${icon("user", { size: 15 })}<span>Open sheet</span></a>
      </section>
      ${
        d
          ? html`<div class="room-head">${eyebrow(`Level ${level} · in progress`)}<h2>Room ${d.n}${roomCell(d.room, 1) ? ` · ${roomCell(d.room, 1)}` : ""}</h2></div>${steps}`
          : isFirst
            ? card(
                html`<fieldset class="dungeon-grid-size">
                  <legend>Dungeon grid size</legend>
                  <div class="dungeon-grid-fields">
                    <label class="field">Width <input type="number" inputmode="numeric" min="${minGrid}" max="${MAX_DUNGEON_GRID}" step="1" value="${M().w}" data-grid-width></label>
                    <label class="field">Height <input type="number" inputmode="numeric" min="${minGrid}" max="${MAX_DUNGEON_GRID}" step="1" value="${M().h}" data-grid-height></label>
                  </div>
                  <p class="muted step-note">Choose ${minGrid} to ${MAX_DUNGEON_GRID.toLocaleString()} squares per side.${level === 10 ? " The Tables Codex sets a 25-square minimum for level 10." : ""}</p>
                </fieldset>
                <div class="step-actions">${button(`Roll the entrance room (D66)`, { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="size"` })}</div>
                <p class="muted step-note">First room of the level: Primary = width, Secondary = height. It has no encounter and 3 archway exits.</p>`,
                { eyebrow: `Level ${level} · room 1`, title: "The entrance", tone: "accent" },
              )
            : nextCard()
      }
      ${
        st.rooms.length
          ? card(
              html`<ol class="room-list">${st.rooms
                .map((r) => html`<li><span>${r.type || KIND_LABEL[r.kind]}</span> <span class="muted">${KIND_LABEL[r.kind]} ${r.x}×${r.y}${r.unique ? " · unique" : ""}</span></li>`)}</ol>`,
              { eyebrow: `${st.rooms.length} room${st.rooms.length === 1 ? "" : "s"}`, title: `Rooms on level ${level}` },
            )
          : ""
      }`);
    // the character strip lives under the map, not in the steps' column: move it there
    const strip = root.querySelector(":scope > .play-status");
    if (strip) status.replaceChildren(strip);
    // a panel or another tab redrew us while an action awaits its dice: keep the controls off
    if (busy)
      for (const el of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) {
        if (el.disabled) continue; // drawn disabled on purpose: the handler's finally must not enable it
        el.disabled = true;
        el.setAttribute("data-busy", "");
      }
    // new flavour text pops out over the page and takes focus (not on the first draw: that is only the page opening)
    const spoken = takeNarrations();
    if (!firstDraw && spoken.length && !document.querySelector(".narrate-modal")) {
      const m = openModal({
        labelledBy: "narrate-title", cls: "narrate-modal",
        onClose: () => toNextStep(), // back to play: the step the player has to do next
        body: html`<h2 id="narrate-title" class="visually-hidden">Room description</h2>${spoken.map((n) => bubble(n.who, n.body, " narrate-big"))}
          <div class="narrate-actions">${button("Continue", { icon: "check", variant: "primary", attrs: html`data-autofocus data-narrate-close` })}</div>`,
      });
      m.card.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-narrate-close]")) m.close(); });
    }
    firstDraw = false;
  }

  /** The creature cards by NAME (the level's own card first when several share a name). */
  let cardIndex: Map<string, string> | null = null;
  const cards = () => {
    if (cardIndex) return cardIndex;
    cardIndex = new Map();
    for (const c of [...creatureIndex(ctx.lib.sections)].sort((a, b) => Math.abs(a.level - st.level) - Math.abs(b.level - st.level))) {
      const n = c.name.toUpperCase().trim();
      if (n && !cardIndex.has(n)) cardIndex.set(n, c.sectionId);
    }
    return cardIndex;
  };
  const creatureNames = () => [...cards().keys()];
  /** Queue this creature into Combat and open it. */
  const fightButton = (name: string, o: { lead?: boolean; small?: boolean } = {}) =>
    button(`Fight ${title(name)}`, { icon: "swords", size: o.small ? "sm" : undefined, variant: o.lead ? "primary" : o.small ? "ghost" : undefined, attrs: html`data-fight="${cards().get(name) ?? ""}"` });

  const doors = () => (st.doors ??= {});
  /** The saved door state of exit e, created (from what the map shows) the first time something happens at it. */
  const doorAt = (e: MapExit): DoorState => (doors()[e.id] ??= { ...doorOf(doors(), e) });
  const note = (e: MapExit, n: DoorNote) => (doorAt(e).note ??= []).push(n);
  const openUp = (e: MapExit) => {
    doorAt(e).open = true;
    delete e.locked;
  };

  /** What it takes to get through exit e (§1.8). `lead`: its next action is the page's primary button. */
  function doorPanel(e: MapExit, lead: boolean): Raw {
    const ds = doorOf(doors(), e);
    const c = loadChar();
    const cs = stats(c);
    const need = doorNeed(e, ds);
    const v = lead ? ("primary" as const) : undefined;
    const other = button("Opened another way", { size: "sm", variant: "ghost", attrs: html`data-door="other" title="Potion of Phasing, Scroll of Melt Metal, a scroll hit of 20+ on a slab"` });
    const pr = refOf(T().patrol);
    let body: Raw;
    if (need === "pick-type")
      body = html`<p>What kind of exit is this? (Its type was rolled in your book.)</p>
        <div class="step-actions">${(["archway", "curtain", "wooden", "metal", "reinforced", "portcullis", ...(st.level >= 3 ? ["slab"] : [])] as ExitType[]).map((k) => button(EXIT_WORD[k] ?? k, { size: "sm", attrs: html`data-exit-type="${k}"` }))}</div>`;
    else if (need === "walk") body = html`<p>Nothing to open: walk through.</p>`;
    else if (need === "open") body = html`<p class="ok">Open.</p>`;
    else if (need === "check")
      body = html`<p>Not yet checked. First time through a door, roll D6 for the lock: locked on <strong>${lockedOn(e.type)}</strong>.</p>
        <div class="step-actions">${button("Check the lock (D6)", { icon: "dice", variant: v, attrs: html`data-door="check"` })}</div>`;
    else if (need === "locked")
      body = html`<p><strong>Locked.</strong> You get one try at picking it. If that fails, or you have no lock picks, wait for a patrol to come through.</p>
        <div class="step-actions">${button(`Pick the lock (2D6 + Precision ${cs.prec >= 0 ? "+" : ""}${cs.prec})`, { icon: "key-round", variant: v, attrs: html`data-door="pick"` })}
          ${button("Wait for a patrol", { size: "sm", attrs: html`data-door="wait"` })}${other}</div>`;
    else if (need === "wait") {
      const gain = waitHp(c.hp, cs.baseline, cs.level, true) - c.hp, loss = c.hp - waitHp(c.hp, cs.baseline, cs.level, false);
      body = !ds.waited
        ? html`<p><strong>Locked${ds.note?.some((n) => n.k === "pick") ? ", and the lock is damaged" : ""}.</strong> Wait for a patrol: first eat a ration while you wait, or go hungry.</p>
          <div class="step-actions">${button(`Eat a ration (+${gain} HP)`, { icon: "utensils", variant: c.rations > 0 ? v : undefined, attrs: html`data-door="wait-ration"${c.rations > 0 ? "" : html` disabled title="No rations left"`}` })}
            ${button(`No ration (−${loss} HP)`, { variant: c.rations > 0 ? undefined : v, attrs: html`data-door="wait-none"` })}${other}</div>`
        : !ds.patrolled
          ? html`<p>${ds.waited === "ration" ? "You ate while you waited." : "You waited without eating."} A patrol comes through the door: roll for it, then fight it.</p>
            ${pr ? html`<div class="step-actions">${button(`Roll the patrol (${pr.table.code ?? "patrol"})`, { icon: "dice", variant: v, attrs: html`data-door="wait-patrol"` })}</div>`
              : html`${lockOf(T().patrol) ? lockedCard(lockOf(T().patrol)!, true) : ""}<div class="step-actions">${button("Done in my book", { icon: "book", variant: v, attrs: html`data-door="wait-book"` })}</div>`}`
          : html`<p>Fight the patrol. When it's beaten, the door is open.</p>
            <div class="step-actions">${button("Won the fight: the door is open", { icon: "check", variant: v, attrs: html`data-door="wait-won"` })}</div>`;
    } else if (need === "lever") {
      const pulled = !!ds.note?.length;
      const polt = refOf(PORTCULLIS);
      body = html`<p>A portcullis is always down. Find the lever and pull it: one lever lifts every portcullis in the room.</p>
        ${polt ? "" : lockOf(PORTCULLIS) ? lockedCard(lockOf(PORTCULLIS)!, true) : ""}
        <div class="step-actions">${polt ? button(`${pulled ? "Pull again" : "Pull the lever"} (${polt.table.code ?? "POLT1"})`, { icon: "dice", variant: pulled ? undefined : v, attrs: html`data-door="lever"` }) : ""}
          ${button(polt ? "The portcullis is up" : "Done in my book: it's up", { icon: "check", variant: pulled || !polt ? v : undefined, attrs: html`data-door="lever-up"` })}</div>`;
    } else
      body = html`<p>A stone slab has no lock. Tip it over: D6 + Discipline (${cs.disc >= 0 ? "+" : ""}${cs.disc}) of 6 or more. You can't wait for a patrol here.</p>
        <div class="step-actions">${button("Tip it over (D6 + Discipline)", { icon: "dice", variant: v, attrs: html`data-door="slab"` })}${other}</div>`;
    const retype = e.oneWay || need === "pick-type" || ds.open ? "" : html`<details class="step-more"><summary>Not ${/^[aeiou]/.test(EXIT_WORD[e.type] ?? "") ? "an" : "a"} ${(EXIT_WORD[e.type] ?? "exit").toLowerCase()}?</summary>
      <p class="muted">Some rooms have one exit of another kind, such as a single stone slab among wooden doors.</p>
      <div class="step-actions">${button("Choose this exit's type", { size: "sm", attrs: html`data-door="retype"` })}</div></details>`;
    return html`<div class="door-panel" data-exit-type="${e.type}">${eyebrow(exitLabel(e))}${e.oneWay ? html`<p class="step-note">Once you pass through, this door cannot be used to go back.</p>` : ""}${body}${retype}
      ${(ds.note ?? []).map((n) => stepResult(doorHtml(n, { inline: ctx.inline, followButtons, patrol: null })))}</div>`;
  }

  /** Between rooms: pick the exit, get it open, roll the next room; with stairs placed, rest and go down. */
  function nextCard(): Raw {
    const m = M();
    const level = st.level;
    const next = nextExit(m);
    const can = !!next && passable(next, doorOf(doors(), next));
    const needsSecret = needsDungeonSecretDoor(m);
    const stairsRoom = !needsSecret && m.stairs !== null && !sealedDungeonRooms(m).has(m.stairs) && level < 10 ? m.rooms.find((r) => r.id === m.stairs) : undefined;
    const c = loadChar();
    const cs = stats(c);
    const last = st.rooms[st.rooms.length - 1];
    const lastMap = m.rooms.filter((r) => !r.draft).sort((a, b) => b.n - a.n)[0];
    const seq = lastMap?.details?.find(([col]) => /NEXT/i.test(col))?.[1].split("/")[1]?.trim();
    // the level's one exit shaft search, in the room you are standing in (as far as the app can tell)
    const here = (next && m.rooms.find((r) => r.id === next.room)) || lastMap;
    const edge = here ? boundarySquares(m, here) : 0;
    const gain = stairsHp(c.hp, cs.baseline, cs.level, true, false) - c.hp, loss = c.hp - stairsHp(c.hp, cs.baseline, cs.level, false, false);
    return html`${card(
      html`${exitPicker()}
      ${next ? doorPanel(next, !can && !stairsRoom) : ""}
      ${next ? html`<div class="step-actions">${gated(`Roll the next room (2D6)`, { icon: "dice", size: "lg", variant: stairsRoom ? undefined : "primary", attrs: html`data-act="size"` }, can ? null : "Open the way first", "size")}</div>
        <p class="muted step-note">Primary die = width (X), Secondary = height (Y). Doubles expand the room; a 1 makes a corridor.${level === 8 ? " Level 8: −2 to both dice." : level === 10 ? " Level 10: +2 to both dice (not 1s)." : ""}</p>`
        : needsSecret
          ? html`<p>There is no way forward and less than half the level is mapped. Add a one-way secret door. ${link("core/secret-doors", "Core Rules, p. 18")}</p>
            <div class="step-actions">${button("Add a secret door", { icon: "key-round", size: "lg", variant: "primary", attrs: html`data-act="secret-door"` })}</div>`
          : html`<p class="muted">No open exits are left on this level. ${stairsRoom ? "" : "Put the down stairs in the last room (tap it on the map)."}</p>`}
      ${seq && !/^FINAL$/i.test(seq) ? html`<p class="muted step-note">Room sequence: the next room forward from ${last?.type || "the last room"} is <strong>${seq}</strong> (see the level's rules).</p>` : ""}
      ${(st.loose ?? []).map((r) => stepResult(rollView(r?.roll ?? r?.html ?? "")))}`,
      { eyebrow: `Level ${level} · room ${st.rooms.length + 1}`, title: "The way on", tone: "accent" },
    )}
    ${stairsRoom ? card(
      html`<p>The down stairs are in <strong>#${stairsRoom.n} ${stairsRoom.label}</strong>. On the stairs you must eat a ration and rest, or lose half your HP.</p>
      ${st.rest ? html`<p class="ok">${st.rest === "ration" ? "You ate and rested on the stairs." : "You went down hungry."}</p>`
        : html`<div class="step-actions">
          ${button(`Eat a ration (+${gain} HP)`, { icon: "utensils", variant: c.rations > 0 ? "primary" : undefined, attrs: html`data-act="ration"${c.rations > 0 ? "" : html` disabled title="No rations left"`}` })}
          <label class="check-row"><input type="checkbox" data-cloth> with a cloth or bandage (+2 HP)</label>
          ${button(`No ration (−${loss} HP)`, { variant: c.rations > 0 ? undefined : "primary", attrs: html`data-act="noration"` })}</div>`}
      <div class="step-actions">${gated(`Go down to level ${level + 1}`, { icon: "arrow-down", size: "lg", variant: st.rest ? "primary" : undefined, attrs: html`data-act="nextlevel"` }, st.rest ? null : "Rest on the stairs first", "nextlevel")}</div>`,
      { eyebrow: "Stairs", title: "Going down" },
    ) : ""}
    <details class="step-more leave-dungeon"><summary>Leave the dungeon</summary>
      <p class="muted">An exit shaft can be searched for once per level, from a room against the outer boundary: D6 for each of its boundary squares, a 6 is a shaft.</p>
      <div class="step-actions">${here ? button(`Search #${here.n} ${here.label} (${edge} boundary square${edge === 1 ? "" : "s"})`, { icon: "search", size: "sm", attrs: html`data-act="shaft"${st.shaftUsed || !edge ? " disabled" : ""}` }) : ""}
        <span class="muted">${st.shaftUsed ? "Already searched on this level." : !edge ? "This room doesn't touch the boundary: pick an exit of one that does." : ""}</span></div>
    </details>`;
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

  async function rollSize(force = false) {
    const n = st.rooms.length + 1;
    const level = st.level;
    if (st.rooms.length === 0) {
      const w = root.querySelector<HTMLInputElement>("[data-grid-width]")?.valueAsNumber ?? M().w;
      const h = root.querySelector<HTMLInputElement>("[data-grid-height]")?.valueAsNumber ?? M().h;
      if (!validDungeonGrid(level, w, h))
        return ctx.toast(`Enter a whole number from ${minDungeonGrid(level)} to ${MAX_DUNGEON_GRID.toLocaleString()} for both dimensions.`);
      const m = newMap(level, w, h);
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
      const p = placeEntrance(m, x, y);
      if (!p) return ctx.toast("The entrance room doesn't fit on the map.");
      const room = addRoom(m, { n, x: p.x, y: p.y, w: p.w, h: p.h, kind: "entrance", label: "Entrance Room", sub: "", draft: true });
      placeEntranceExits(m, room);
      st.map = m;
      st.current = { n, dice: note, x, y, kind: "entrance", results: [], mapRoom: room.id, entry: "S", exits: 3 };
    } else {
      const exit = chosenExit();
      if (!exit) return ctx.toast(needsDungeonSecretDoor(M()) ? "Add a secret door to continue." : "There are no open exits left on this level.");
      if (!force && !passable(exit, doorOf(doors(), exit))) return ctx.toast("Open the way first.");
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
      if (exit.oneWay) {
        m.stairs = null;
        delete st.rest;
      }
      m.sel = null;
      st.current = { n, dice: note, x, y, kind, results: [], mapRoom: room.id, entry: entrySideFor(exit), via: exit.id };
      st.loose = [];
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
    undoAuto(d); // the old encounter's results go, and what they put on the sheet with them
    resetEncounter(d);
    // the room takes a shape that suits its name (same squares; the exits already placed still reach it)
    const mr = mapRoom(d);
    if (mr && d.kind !== "entrance" && d.kind !== "corridor") reshapeRoom(M(), mr, familyFor(roomCell(d.room, 1)), mr.id * 131 + st.level);
    syncMap(d);
    persist();
    journal("update", d);
    draw();
  }

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.level !== undefined) {
      if (busy) return draw(); // a roll in flight would land its room on the new level's empty map
      if ((st.rooms.length || st.current) && !confirm("Switch level? This starts a fresh room list and map.")) return draw();
      if (st.current) journal("discard", st.current);
      st.level = +el.value;
      st.rooms = [];
      st.current = null;
      st.map = newMap(st.level);
      resetLevel();
      cardIndex = null;
      persist();
      draw();
    }
  });

  // tap an open exit to choose where to go next (tapping the chosen one again clears the choice)
  root.addEventListener("click", (e) => {
    const p = (e.target as Element).closest?.("[data-pick-exit]");
    if (!p || busy) return;
    const id = +p.getAttribute("data-pick-exit")!;
    if (!openExits(M()).some((exit) => exit.id === id)) return draw();
    M().sel = M().sel === id ? null : id;
    persist();
    draw();
  });

  /** Start a level's doors, rests and loose rolls afresh. */
  const resetLevel = () => {
    st.doors = {};
    st.loose = [];
    delete st.rest;
    delete st.shaftUsed;
  };

  /** A press on a door panel button for exit `ex`. */
  async function doorAction(what: string, ex: MapExit) {
    const c = loadChar();
    const cs = stats(c);
    if (what === "check") {
      if (!isDoor(ex.type) || doorOf(doors(), ex).checked) return;
      const r = await rollDice("D6");
      const locked = isLockedRoll(ex.type, r.value);
      Object.assign(doorAt(ex), { checked: true, locked });
      if (locked) ex.locked = true;
      else delete ex.locked;
      note(ex, { k: "door", kind: title(ex.type), value: r.value, locked, marked: true });
      journalDoor(ex, "door", !locked);
    } else if (what === "pick") {
      if (doorOf(doors(), ex).picked) return; // one roll per lock
      const mod = await askNumber("Lock modifier printed in the room (e.g. -2), or 0:", 0);
      if (mod === null) return;
      const pick = await askNumber("Your lock pick bonus (e.g. 3 for 'Lock Pick +3'):", 0);
      if (pick === null) return;
      const q = await rollDice("2D6");
      const quality = q.value + mod;
      const a = await rollDice("2D6");
      const total = a.value + cs.prec + pick;
      const ok = total >= quality;
      doorAt(ex).picked = true;
      if (ok) openUp(ex);
      note(ex, { k: "pick", q: q.value, mod, quality, a: a.value, prec: cs.prec, pick, total, ok });
      journalDoor(ex, "pick", ok);
    } else if (what === "retype") retypeExit(doors(), ex);
    else if (what === "wait") doorAt(ex).picked = true; // no pick tried: straight to waiting
    else if (what === "other" || what === "wait-won") openUp(ex);
    else if (what === "wait-ration" || what === "wait-none") {
      const ration = what === "wait-ration";
      if (ration && c.rations < 1) return ctx.toast("No rations left!");
      const before = c.hp;
      if (ration) c.rations--;
      c.hp = waitHp(c.hp, cs.baseline, cs.level, ration);
      saveChar(c, "dungeon");
      doorAt(ex).waited = ration ? "ration" : "none";
      ctx.toast(ration ? `Ate a ration while waiting: +${c.hp - before} HP (${c.rations} left)` : `Waited hungry: −${before - c.hp} HP`);
    } else if (what === "wait-patrol") {
      const ref = refOf(T().patrol);
      if (!ref) return;
      const r = await rollAndLog(ref, 0, undefined, `Level ${st.level} · patrol at the door`);
      note(ex, { k: "roll", roll: rollData(r) });
      doorAt(ex).patrolled = true;
    } else if (what === "wait-book") doorAt(ex).patrolled = true;
    else if (what === "lever") {
      const ref = refOf(PORTCULLIS);
      if (!ref) return;
      const r = await rollAndLog(ref, 0, undefined, `Level ${st.level} · portcullis`);
      note(ex, { k: "roll", roll: rollData(r) });
      if (r.rowIndex >= 0) journalDoor(ex, "portcullis", true, r.cells[1] || String(r.value));
    } else if (what === "lever-up") {
      for (const e of M().exits) if (e.room === ex.room && e.type === "portcullis") openUp(e); // one lever lifts them all
    } else if (what === "slab") {
      const r = await rollDice("D6");
      const tips = r.value + cs.disc >= 6;
      if (tips) openUp(ex);
      note(ex, { k: "slab", value: r.value, disc: cs.disc });
      journalDoor(ex, "slab", tips);
    }
    persist();
    draw();
  }

  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || busy) return;
    const over = overrideOf(e.target); // "Do it anyway" on a blocked action
    b.disabled = true;
    busy = true;
    try {
      mapView.setBusy(true); // a pick made mid-roll would be merged, then cleared by the roll
      const d = st.current;
      const t = T();
      const act = over ?? b.dataset.act;
      const ex = d ? undefined : nextExit(M());
      if (act === "size") await rollSize(!!over);
      else if (act === "secret-door" && !d) {
        const secret = addDungeonSecretDoor(M());
        if (!secret) return ctx.toast("There is no room for a secret door and a passage beyond it.");
        delete st.rest;
        const from = M().rooms.find((r) => r.id === secret.room);
        persist();
        ctx.toast(`Secret door added to room ${from?.n ?? secret.room}.`);
        draw();
      } else if (act === "type") await rollType();
      else if (b.dataset.kind && d) {
        d.kind = b.dataset.kind as Kind;
        d.room = undefined;
        d.exitType = undefined;
        delete d.byBook;
        undoAuto(d);
        resetEncounter(d);
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
      } else if ((act === "by-book-type" || act === "by-book-exits") && d) {
        d.byBook = { ...d.byBook, [act === "by-book-type" ? "type" : "exits"]: true };
        persist();
        draw();
      } else if (act === "enc-done" && d) {
        d.encDone = true;
        persist();
        draw();
      } else if (b.dataset.fight !== undefined) {
        const msg = queueFoe(ctx.lib.sections.find((s) => s.id === b.dataset.fight), "#/play/dungeon");
        if (msg) ctx.toast(msg);
        if (d) {
          d.fought = true;
          persist();
          draw();
        }
        ctx.openTab("#/play/combat", { newTab: true });
      } else if (act === "fight") {
        ctx.openTab("#/play/combat", { newTab: true });
      } else if (act === "stairs") {
        const r = mapRoom(d) ?? [...M().rooms].pop();
        if (r) {
          M().stairs = M().stairs === r.id ? null : r.id;
          persist();
          draw();
        }
      } else if (b.dataset.liberate) {
        const roll = findRoll<SavedRoll>(st, b.dataset.liberate);
        const n = roll ? prisonersIn(roll.cells.join(" ")) : 0;
        if (!roll || roll.liberated || !n) return draw();
        const c = loadChar();
        c.prisoners = (Number.isFinite(c.prisoners) ? c.prisoners : 0) + n;
        saveChar(c, "dungeon"); // not "sheet": an open sheet must reload, or its next save would drop the tally
        roll.liberated = true;
        if (d?.results.some((x) => x.roll === roll)) (d.auto ??= {}).prisoners = (d.auto.prisoners ?? 0) + n;
        ctx.toast(`${n} prisoner${n === 1 ? "" : "s"} liberated: ${c.prisoners} on your sheet. Roll the Liberating Prisoners table for each when you return to town.`);
        persist();
        draw();
      } else if (b.dataset.follow) {
        const [id, mod] = b.dataset.follow.split("|");
        const ref = refOf(id);
        if (ref) {
          const r = await rollAndLog(ref, +mod || 0, undefined, d ? `Level ${st.level} · room ${d.n}` : undefined);
          const res = { label: ref.title, roll: rollData(r) };
          if (d) {
            d.results.push(res);
            if (r.rowIndex >= 0) journal("update", d, { encounter: r.cells[1] || ref.title });
          } else if (ex && b.closest(".door-panel")) note(ex, { k: "roll", roll: res.roll }); // a roll a door's result called for stays with the door
          else (st.loose ??= []).push(res);
          // things the result says you find outright go in your pack (finds that hang on a roll or a choice don't)
          const found = r.rowIndex >= 0 ? lootIn(r.cells.slice(1).join(" ")) : [];
          if (found.length) {
            const c = loadChar();
            addLoot(c, found);
            saveChar(c, "dungeon");
            if (d) ((d.auto ??= {}).loot ??= []).push(...found);
            ctx.toast(`Added to your pack: ${found.join(", ")}.`);
          }
          persist();
          draw();
        }
      } else if (b.dataset.exitType && ex) {
        ex.type = b.dataset.exitType as ExitType;
        delete ex.locked;
        delete doors()[ex.id];
        persist();
        draw();
      } else if (b.dataset.door && ex) {
        await doorAction(b.dataset.door, ex);
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
        if (d && !confirm(undoTurnWarning(d.n))) return;
        if (d) journal("discard", d);
        undoAuto(d);
        const mr = mapRoom(d);
        if (mr) {
          const m = M();
          clearRoomDoors(doors(), m, mr.id);
          m.rooms = m.rooms.filter((r) => r.id !== mr.id);
          m.exits = m.exits.filter((x) => x.room !== mr.id);
          for (const x of m.exits) if (x.to === mr.id) delete x.to;
          if (d?.kind === "entrance") m.entrance = null;
          if (m.stairs === mr.id) m.stairs = null;
        }
        st.current = null;
        persist();
        draw();
      } else if ((act === "ration" || act === "noration") && !d && !st.rest) {
        const c = loadChar();
        const cs = stats(c);
        const ration = act === "ration";
        if (ration && c.rations < 1) return ctx.toast("No rations left!");
        const cloth = ration && !!root.querySelector<HTMLInputElement>("[data-cloth]")?.checked;
        const before = c.hp;
        if (ration) c.rations--;
        c.hp = stairsHp(c.hp, cs.baseline, cs.level, ration, cloth);
        saveChar(c, "dungeon");
        st.rest = ration ? "ration" : "none";
        ctx.toast(ration ? `Ate a ration: +${c.hp - before} HP (${c.rations} left)` : `No ration: −${before - c.hp} HP`);
        bus.emit("journal:milestone", { kind: "rest", ration, hp: Math.abs(c.hp - before) });
        persist();
        draw();
      } else if (act === "shaft" && !d && !st.shaftUsed) {
        const m = M();
        const here = (ex && m.rooms.find((r) => r.id === ex.room)) || m.rooms.filter((r) => !r.draft).sort((a, b) => b.n - a.n)[0];
        const n = here ? boundarySquares(m, here) : 0;
        if (!n) return;
        const dice: number[] = [];
        for (let left = n; left > 0; left -= 12) dice.push(...(await rollDice(`${Math.min(left, 12)}D6`)).dice); // the dice tray holds 12 at a time
        const hit = dice.indexOf(6);
        st.shaftUsed = true;
        const freed = hit >= 0 ? loadChar().prisoners : 0;
        ctx.toast(hit >= 0
          ? `Exit shaft found at square ${hit + 1}! Mark it "E".${freed ? ` Back in town, use Return to town on your sheet to roll for your ${freed} liberated prisoner${freed === 1 ? "" : "s"}.` : ""}`
          : `No exit shaft (${dice.join(", ")}).`);
        if (hit >= 0) bus.emit("journal:milestone", { kind: "leave", level: st.level });
        persist();
        draw();
      } else if (act === "nextlevel" && !d) {
        if (st.level >= 10) return ctx.toast("Level 10 is the last level.");
        if (needsDungeonSecretDoor(M())) return ctx.toast("Add a secret door to continue.");
        const stairs = M().stairs;
        if (stairs === null || sealedDungeonRooms(M()).has(stairs)) return ctx.toast("Place the stairs in an accessible room first.");
        if (!over && !st.rest) return ctx.toast("Rest on the stairs first.");
        if (!confirm(`Finish level ${st.level} and go down to level ${st.level + 1}?`)) return;
        const c = loadChar();
        c.legend[st.level - 1] = true;
        saveChar(c, "dungeon");
        st.level++;
        st.rooms = [];
        st.current = null;
        st.map = newMap(st.level);
        resetLevel();
        cardIndex = null;
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
  ctx.onDispose(onContentChange(() => {
    cardIndex = null;
    draw();
  }));
  draw();
}
