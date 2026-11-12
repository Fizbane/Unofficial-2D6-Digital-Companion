// 2D6 Void: the Hulk turn. Walks one Dark Hulk room at a time through docs/spec-void.md §2.15:
// size (D66, doubles), exits (D6, clockwise D3), the room table (Level N Rooms / small / large,
// SSRT1 on L9, the fixed chain on L10), the encounter in order, then the way on: lock checks,
// crowbars, hacking, limbs, barriers and waiting for a patrol. The rules live in hulkmodel.ts;
// this file rolls (3D dice, real tables from the Void library, logged to Results), keeps the map
// beside the steps and saves "vhulk".
//
// Hand-off to Combat: "⚔ Fight" saves `pending: { name, sectionId, from: "vhulk", level, room, special? }`
// into the "vcombat" state (other fields kept), emits "void:changed" { source: "vhulk" } and opens
// #/play/vcombat. `sectionId` is the alien card's library section; `special` is the patrol table's
// SPECIAL cell when the alien came from a patrol roll. Combat clears `pending` once it has read it.
//
// The survivor comes from the character sheet's model (sheetmodel.ts): Technical / Coding / HP for
// the checks, and its own rules for entering a room (Bloodied, Stunned, room effects), eating and
// resting at the ladder, the Camo Tent, damage and Bloodied from amputation. With no survivor saved
// the turn still runs: you type Technical / Coding in, and HP changes are left to you.
import type { ToolContext } from "../../main";
import { rollDice } from "../../dice3d";
import { roll as instantRoll } from "../../dice";
import { entryCells, isTableRef, tableByCode, tableFor, type TableRef, type TableRoll } from "../../rolltable";
import { bus, type JournalDoorEvent, type JournalRoomEvent } from "../../shell/events";
import { makeArrangeable } from "../../shell/arrange";
import { readState, writeState } from "../../shell/state";
import { rollAndLog } from "../../shell/panels/results";
import { button, card, chip, eyebrow } from "../../ui/components";
import { icon } from "../../ui/icon";
import { isCreatureTable, load, save } from "../common";
import { html, joinHtml, setHTML, type HtmlValue, type Raw } from "../../ui/html";
import { plainText } from "../../shell/journalprose";
import { addRoom, findPlacement, mapHint, mergePanelEdits, nextExit, openExits, type DungeonMap, type ExitType, type MapExit, type MapRoom, type Side } from "../dmap";
import { mountHulkMap, type HulkMapView } from "./mappage";
import { applyDamage, bloody, camoRest, eatBetweenLevels, enterRoom as charEnterRoom, hasVChar, loadVChar, restBetweenLevels as charRest, saveVChar, startHulkLevel, vstats, type VoidCharacter } from "./sheetmodel";
import {
  L10_CHAIN, L10_SPECIAL, LEVELS, LEVEL_TABLES, SLDT1, FAST1, VOET1, VOID_EXIT_NAME, addSecretDoor, aliensIn, alarmCheck, barrierDice, bestSingleExit, bioLimb, camoUses, classifyDrawn,
  exitCount, exitTypeFor, exploredPct, forceSliding, hackSecurity, hasAlarmChecks, identityTable, isLocked, isVoidDoor, ladderCell, needsSecondRoll, nextLevel, patrolTable, placeHulkExits,
  resolveDimensions, secretDoorAllowed, setupLevel, specialUniques, tableCodesIn, uniqueRule, uniqueVerdict, type HulkKind, type Pair, type Ration,
} from "./hulkmodel";

/**
 * A result as the saved state keeps it: data, never markup (a saved state can come from an imported backup).
 * Drawn by noteHtml. A `string` is a result saved as markup by an older version: shown as text only.
 */
interface SavedRoll { title: string; dice: string; value: number; matched: boolean; columns: string[]; cells: string[] }
type NotePart =
  | { k: "roll"; roll: SavedRoll; actions?: boolean } // a table row, with its follow-on and Fight buttons unless actions is false
  | { k: "head"; label: string; dice?: string }
  | { k: "title"; text: string; bad?: boolean }
  | { k: "text"; text: string }
  | { k: "book"; text: string } // book text, drawn with cross-links
  | { k: "open"; label: string }; // a "the door is open" button
type Note = NotePart[];
interface RoomRoll { title: string; sectionId: string; columns: string[]; cells: string[]; roll: Note | string; code: string }
interface Draft {
  n: number;
  dice: string; // the size roll, in words
  kind: HulkKind;
  w: number; // drawn size
  h: number;
  room?: RoomRoll;
  rerolls?: string[]; // re-rolled uniques / boss rooms
  ssrt?: Note | string; // L9: the SSRT1 result
  exits?: number;
  exitNote?: string;
  results: { label: string; note?: Note; html?: string }[]; // `html`: saved by an older version (text only)
  mapRoom?: number;
  entry?: Side | null;
  via?: number;
  chain?: number; // L10: index into L10_CHAIN
  trackers?: string;
}
interface DoneRoom { n: number; kind: HulkKind; w: number; h: number; type: string; unique: boolean; mapRoom?: number }
interface Door { checked?: boolean; locked?: boolean; open?: boolean; attempts?: number; lockedOut?: boolean; crossed?: boolean; pinned?: boolean; note?: Note; html?: string }
interface State {
  level: number;
  rooms: DoneRoom[];
  current: Draft | null;
  map?: DungeonMap;
  ladderIn: { x: number; y: number } | null;
  prevLadder: { x: number; y: number } | null; // the last level's down-ladder square
  voidChamber: number | null;
  portals: { n: number; room: number }[];
  chain: number; // L10: next chain room
  camo: number; // Camo Tent uses this level
  doors: Record<string, Door>; // by map exit id
  stats: { tech?: number; coding?: number }; // typed in when the sheet has none
  loose: { label: string; note?: Note; html?: string }[]; // rolls made between rooms (alarm, patrol while waiting)
  rest?: string; // what happened at the ladder
  setupNote?: string;
  victory?: boolean;
}

/** A step of the room: name, title, done, body. */
type Step = [string, string, boolean, Raw];

const blank = (): State => ({ level: 1, rooms: [], current: null, map: undefined, ladderIn: null, prevLadder: null, voidChamber: null, portals: [], chain: 0, camo: 0, doors: {}, stats: {}, loose: [] });
const KIND_LABEL: Record<HulkKind, string> = { entrance: "Entrance room", corridor: "Corridor", small: "Small room", regular: "Room", large: "Large room" };
const SIDE_LABEL: Record<Side, string> = { N: "north", E: "east", S: "south", W: "west" };
const MAP_UI_KEY = "2d6:shell:vhulkMap";
const isMapUi = (v: unknown): v is { collapsed: boolean } => typeof (v as { collapsed?: unknown })?.collapsed === "boolean";
/** A rollable table by section id or code (hulkmodel names a few by code), else undefined. */
const tableAt = (key: string): TableRef | undefined => {
  const r = tableFor(key);
  return r && isTableRef(r) ? r : undefined;
};
const ruleNote = (body: HtmlValue) => html`<p class="rule-note"><span class="rule-note-i" aria-hidden="true">ⓘ</span> <span><strong>Rule note:</strong> ${body}</span></p>`;
// saved state can come from an imported backup: read each field defensively
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

// ---------- the survivor (sheetmodel.ts), when one is saved ----------
function sheet() {
  if (!hasVChar()) return { has: false as const, name: "", hp: undefined, baseline: undefined, level: undefined, tech: undefined, coding: undefined, rations: undefined, bloodied: 0, stunned: 0, tents: 0 };
  const c = loadVChar();
  const v = vstats(c);
  return { has: true as const, name: c.name, hp: c.hp, baseline: v.baseline, level: v.level, tech: v.technical, coding: v.coding, rations: c.rations, bloodied: c.bloodied, stunned: c.stunned, tents: c.tentUses };
}
/** Change the saved survivor (if there is one) and tell the other tools. */
function withChar<T>(fn: (c: VoidCharacter) => T): T | undefined {
  if (!hasVChar()) return undefined;
  const c = loadVChar();
  const out = fn(c);
  saveVChar(c, "vhulk");
  return out;
}

/**
 * Lay the page out as the live map beside (wide) or above (narrow, collapsible) the steps, with
 * Dungeon turn's layout classes.
 */
function layout(page: HTMLElement, ctx: ToolContext): { main: HTMLElement; map: HulkMapView } {
  page.classList.add("play-page", "page-wide", "dturn-page", "vhulk-page");
  let collapsed = readState(MAP_UI_KEY, isMapUi, () => ({ collapsed: matchMedia("(max-width: 899px)").matches })).collapsed;
  setHTML(page, html`<div class="dturn vhulk"><div class="dturn-grid">
    <aside class="dturn-map card" aria-label="Dark Hulk map">
      <button type="button" class="dturn-map-toggle" aria-controls="vhulk-map-body">${icon("map", { size: 16 })}<span>Map</span>${icon("chevron-down", { size: 16 })}</button>
      <div class="dturn-map-body" id="vhulk-map-body"></div>
    </aside>
    <div class="dturn-main"></div>
  </div></div>`);
  makeArrangeable(page.querySelector<HTMLElement>(".dturn-grid")!, "2d6:shell:vhulkPanes");
  const aside = page.querySelector<HTMLElement>(".dturn-map")!;
  const toggle = aside.querySelector<HTMLButtonElement>(".dturn-map-toggle")!;
  const paint = () => {
    aside.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    writeState(MAP_UI_KEY, { collapsed });
    paint();
  });
  paint();
  const map = mountHulkMap(aside.querySelector<HTMLElement>(".dturn-map-body")!, { source: "vhulk-map", embedded: true, openTab: ctx.openTab, toast: ctx.toast, onDispose: ctx.onDispose });
  return { main: page.querySelector<HTMLElement>(".dturn-main")!, map };
}

export function render(page: HTMLElement, ctx: ToolContext) {
  const st: State = { ...blank(), ...load<Partial<State>>("vhulk", {}) } as State;
  st.doors ??= {};
  st.portals ??= [];
  st.stats ??= {};
  st.loose ??= [];
  const { main: root, map: mapView } = layout(page, ctx);
  let live = true;
  ctx.onDispose(() => (live = false));
  const persist = () => {
    if (!live) return;
    save("vhulk", st);
    bus.emit("void:changed", { source: "vhulk" });
  };
  const M = () => st.map!;
  const mapRoom = (d: Draft | null | undefined) => (d?.mapRoom ? st.map?.rooms.find((r) => r.id === d.mapRoom) : undefined);
  const chamber = () => (st.voidChamber ? [st.voidChamber] : []);
  const tents = () => (hasVChar() ? Math.max(loadVChar().tentUses, 0) : st.camo);
  const explored = () => (st.map ? exploredPct(st.map, chamber()) : 0);

  // ---------- alien cards (name → section) for the Fight buttons ----------
  const cards = new Map<string, string>();
  for (const s of ctx.lib.sections)
    for (const b of s.blocks)
      if (b.type === "table" && isCreatureTable(b.table)) {
        const name = b.table.rows.find((r) => /^NAME$/i.test(r[0].trim()))?.[1]?.trim().toUpperCase();
        if (name && !cards.has(name)) cards.set(name, s.id);
      }
  const cardNames = [...cards.keys()];

  const patrolRef = () => {
    const id = patrolTable(st.level);
    return id ? tableAt(id) : undefined;
  };
  const findRef = (key: string): TableRef | undefined => {
    const r = tableByCode(key);
    return r && isTableRef(r) ? r : tableAt(key);
  };
  const tableLabel = (ref: TableRef) => ref.table.code ?? ref.title.replace(/\s*-\s*THE DARK HULK.*$/i, "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  /** Buttons for the tables a text says to roll, and Fight buttons for the aliens it names (but not `skip`). */
  const textActions = (text: string, special = "", skip: string[] = []) => {
    const codes = tableCodesIn(text, (c) => !!tableByCode(c), patrolRef()?.table.code ?? null);
    const tables = codes.map((c) => button(`${c.code}${c.modifier ? (c.modifier > 0 ? ` +${c.modifier}` : ` ${c.modifier}`) : ""}`, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-follow="${c.code}|${c.modifier}"` }));
    const fights = aliensIn(text, cardNames).filter((n) => !skip.includes(n)).map((n) => fightButton(n, special));
    return html`${fights}${tables}`;
  };
  const fightButton = (name: string, special = "") =>
    button(`⚔ Fight ${name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`, { size: "sm", variant: "primary", attrs: html`data-fight="${cards.get(name) ?? ""}" data-fight-name="${name}" data-fight-special="${special}"` });

  const stepResult = (body: Raw) => html`<article class="result-card step-result">${body}</article>`;
  const rcHead = (label: string, dice = "") => html`<header class="rc-head">${eyebrow(label)}${dice ? html`<span class="rc-dice">${dice}</span>` : ""}</header>`;
  /** A table roll as saved-state data. */
  const rollData = (r: TableRoll): SavedRoll => {
    const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
    const dice = `${r.roll.label} ${r.roll.text}${r.modifier ? ` ${r.modifier > 0 ? "+" : ""}${r.modifier} → ${r.value}` : ""}`;
    return { title: r.ref.title, dice, value: r.value, matched: r.rowIndex >= 0, columns, cells };
  };
  const rollPart = (r: TableRoll, actions = true): NotePart => ({ k: "roll", roll: rollData(r), ...(actions ? {} : { actions: false }) });
  /** A saved roll as markup: its row, then Fight buttons (a patrol's alien) and buttons for the tables it names. */
  const showRoll = (x: SavedRoll, actions = true): Raw => {
    if (!x || typeof x !== "object") return html``;
    const title = str(x.title);
    if (!x.matched) return html`${rcHead(title)}<div class="rc-text muted">Rolled ${str(x.value)}: no matching row.</div>`;
    const columns = strs(x.columns), cells = strs(x.cells);
    const dice = str(x.dice);
    const isPatrol = /PATROL/i.test(title);
    const alienCol = columns.findIndex((c) => /ALIEN/i.test(c));
    const specialCol = columns.findIndex((c) => /SPECIAL/i.test(c));
    const special = specialCol >= 0 ? cells[specialCol] ?? "" : "";
    const alien = alienCol >= 0 ? (cells[alienCol] ?? "").toUpperCase().trim() : "";
    const fight = isPatrol && alien && cards.has(alien) ? fightButton(alien, special) : "";
    const textCells = cells.slice(1).join(" ");
    return html`${rcHead(title, dice)}
      ${cells[1] ? html`<div class="rc-title">${ctx.inline(cells[1])}</div>` : ""}
      <dl class="kv">${columns.slice(2).map((c, i) => (cells[i + 2] ? html`<dt>${c}</dt><dd>${ctx.inline(cells[i + 2])}</dd>` : ""))}</dl>
      ${actions ? html`<div class="rc-actions">${fight}${textActions(textCells, special, fight ? [alien] : [])}</div>` : ""}`;
  };
  /** A saved result (or an older version's markup, as text) as markup. */
  const noteHtml = (n: unknown): Raw => {
    if (typeof n === "string") return html`<div class="rc-text">${plainText(n)}</div>`;
    if (!Array.isArray(n)) return html``;
    return html`${(n as NotePart[]).map((p) => {
      if (!p || typeof p !== "object") return "";
      if (p.k === "roll") return showRoll(p.roll, p.actions !== false);
      if (p.k === "head") return rcHead(str(p.label), str(p.dice));
      if (p.k === "title") return html`<div class="rc-title${p.bad ? " is-bad" : ""}">${str(p.text)}</div>`;
      if (p.k === "text") return html`<div class="rc-text">${str(p.text)}</div>`;
      if (p.k === "book") return html`<div class="rc-text">${ctx.inline(str(p.text))}</div>`;
      if (p.k === "open") return html`<div class="step-actions">${button(str(p.label), { size: "sm", attrs: html`data-door="open"` })}</div>`;
      return "";
    })}`;
  };
  const resultsHtml = (list: unknown): Raw =>
    html`${(Array.isArray(list) ? list : []).map((r: { note?: Note; html?: string } | null) => stepResult(noteHtml(r?.note ?? r?.html)))}`;
  const col = (d: Draft | null | undefined, name: string) => {
    const r = d?.room;
    if (!r) return "";
    const i = r.columns.findIndex((c) => c.toUpperCase().startsWith(name));
    return i >= 0 ? r.cells[i] ?? "" : "";
  };

  /** Keep the map in step with the draft: label, kind, the row, exit types. */
  const syncMap = (d: Draft) => {
    const r = mapRoom(d);
    if (!r) return;
    r.kind = d.kind;
    r.label = d.kind === "entrance" ? "Entrance Room" : d.room?.cells[1] || (d.chain !== undefined ? L10_CHAIN[d.chain].label ?? KIND_LABEL[d.kind] : KIND_LABEL[d.kind]);
    if (d.room && st.level === 10 && d.chain !== undefined && L10_CHAIN[d.chain].label) r.label = L10_CHAIN[d.chain].label!;
    r.sub = d.room?.code ?? "";
    r.details = d.room ? d.room.columns.map((c, i) => [c, d.room!.cells[i] ?? ""] as [string, string]).filter(([c, v]) => v && !/^ROLL$/i.test(c)) : undefined;
    const type = exitTypeFor(st.level, d.kind, col(d, "EXITS"));
    for (const e of M().exits) if (e.room === r.id && e.to === undefined && e.type !== "secret") e.type = type;
  };

  const journal = (phase: JournalRoomEvent["phase"], d: Draft, extra: { encounter?: string } = {}) =>
    bus.emit("journal:room", {
      phase, level: st.level, n: d.n, kind: d.kind, w: d.w, h: d.h, title: d.room?.cells[1] ?? "", description: col(d, "DESCRIPTION") || col(d, "ROOM DESCRIPTION"),
      exitsKnown: d.exits !== undefined, map: M(), mapRoom: d.mapRoom, ...extra,
    });
  const journalDoor = (ex: MapExit, check: JournalDoorEvent["check"], ok: boolean, detail?: string) =>
    bus.emit("journal:door", { level: st.level, room: ex.room, side: ex.side, type: ex.type, check, ok, ...(detail ? { detail } : {}) });

  /** Entering a room (new or backtracked): Bloodied / Stunned on the sheet. */
  function enterRoom(): string {
    const msgs = withChar((c) => {
      const b = c.bloodied;
      const m = charEnterRoom(c);
      if (b > 0 && b < 8) m.unshift(`Bloodied: box ${c.bloodied} of 8 ticked.`);
      return m;
    });
    return msgs?.join(" ") ?? "";
  }

  const uniqueSeen = () => st.rooms.filter((r) => r.unique).map((r) => r.type);
  const bosses = () => {
    const ref = LEVEL_TABLES[st.level].rooms ? tableAt(LEVEL_TABLES[st.level].rooms!) : undefined;
    if (!ref) return [];
    return specialUniques(ref.table.columns, ref.table.rows).filter((b) => !st.rooms.some((r) => r.type && r.type.replace(/\*/g, "").trim() === b.name.replace(/\*/g, "").trim()));
  };

  const doorOf = (e: MapExit): Door => (st.doors[e.id] ??= {});
  /** Can you go through this exit to roll the next room? */
  const passable = (e: MapExit) => {
    const d = st.doors[e.id] ?? {};
    if (isVoidDoor(e.type)) return !!d.open || (!!d.checked && !d.locked);
    if (e.type === "barrier") return !!d.crossed;
    return true;
  };

  let busy = false;

  // ---------- drawing ----------
  function draw() {
    const d = st.current;
    const s = sheet();
    const level = st.level;
    const info = LEVELS[level];
    const pstat = (label: string, value: Raw, extra = "") => html`<span class="pstat${extra}">${eyebrow(label)}<span class="pstat-v">${value}</span></span>`;
    const pct = explored();
    const statusBar = html`<section class="card play-status">
        ${pstat("Survivor", html`<strong>${s.name || "Survivor"}</strong>${s.level ? html`<span class="muted">· level ${s.level}</span>` : ""}`)}
        ${s.hp !== undefined ? pstat("HP", html`<strong>${s.hp}</strong>${s.baseline ? html`<span class="muted">/ ${s.baseline}</span>` : ""}`) : ""}
        ${s.rations !== undefined ? pstat("Rations", html`<strong>${s.rations}</strong>`) : ""}
        ${s.bloodied ? pstat("Bloodied", html`<strong>${s.bloodied}</strong>/8`, " is-warn") : ""}
        ${s.stunned ? pstat("Stunned", html`<strong>${s.stunned}</strong>`, " is-warn") : ""}
        ${pstat("Rooms", html`<strong>${st.rooms.length}</strong>`)}
        ${pstat("Explored", html`<strong>${pct}%</strong>`)}
        <a href="#/play/vsheet" class="btn btn-sm btn-ghost pstat-link">${icon("user", { size: 15 })}<span>Sheet</span></a>
      </section>`;
    const head = html`<header class="play-head">
        <div class="play-title">${eyebrow(`Play · Level ${level} · ${info.name}`)}<h1>${icon("door-closed", { size: 26 })}<span>Hulk turn</span></h1></div>
        <div class="play-actions">
          <label class="level-pick"><span class="eyebrow">Level</span>
            <select data-level>${Array.from({ length: 10 }, (_, i) => html`<option ${i + 1 === level ? "selected" : ""}>${i + 1}</option>`)}</select></label>
          <a class="btn btn-ghost" href="#/s/${encodeURIComponent(info.intro)}">${icon("book", { size: 17 })}<span>Level ${level} intro</span></a>
        </div>
      </header>`;

    let body: Raw;
    if (st.victory) body = card(html`<p>You launched the Escape Pod and left the Dark Hulk. <strong>Hero status!</strong></p><div class="step-actions">${button("Start a new expedition", { icon: "rotate-ccw", attrs: html`data-act="restart-all"` })}</div>`, { eyebrow: "Level 10", title: "Escaped", tone: "accent" });
    else if (!st.map) body = startCard();
    else if (d) body = html`<div class="room-head">${eyebrow(`Level ${level} · in progress`)}<h2>Room ${d.n}${d.room?.cells[1] ? ` · ${d.room.cells[1]}` : ""}</h2></div>${steps(d)}`;
    else body = nextCard();

    setHTML(root, html`${head}${statusBar}${body}
      ${st.map && !st.victory ? levelCards() : ""}
      ${st.rooms.length ? card(html`<ol class="room-list">${st.rooms.map((r) => html`<li><span>${r.type || KIND_LABEL[r.kind]}</span> <span class="muted">${r.type ? `${KIND_LABEL[r.kind]} ` : ""}${r.w}×${r.h}${r.unique ? " · unique" : ""}</span></li>`)}</ol>`, { eyebrow: `${st.rooms.length} room${st.rooms.length === 1 ? "" : "s"}`, title: `Rooms on level ${level}` }) : ""}`);
    if (busy)
      for (const el of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("button, select, input")) {
        el.disabled = true;
        el.setAttribute("data-busy", "");
      }
  }

  function startCard(): Raw {
    const info = LEVELS[st.level];
    const lad = st.level > 1 && st.level < 10 ? (st.prevLadder ? "The up-ladder goes directly below the last level's down-ladder." : "No down-ladder from the level above is known, so you come in mid-south.") : st.level === 10 ? "Level 10's entrance is in the middle of the south wall." : "You climb in at the base of the hull.";
    return card(
      html`<p>${info.effects}</p>
      ${info.rules.length ? html`<ul class="vhulk-rules">${info.rules.map((r) => html`<li>${r}</li>`)}</ul>` : ""}
      <p class="muted step-note">The hull is 17 × 28 squares. ${lad} The entrance room is ${info.entrance.w} × ${info.entrance.h} with ${info.entrance.west ? "one exit in the west wall" : "three archway exits if they fit"}, and no aliens.</p>
      ${ruleNote(`sizes like "${info.entrance.w}x${info.entrance.h}" are read X (across) then Y (down), as for D66 rolls (U12).${st.level === 1 ? " Level 1's entrance exits are taken to be archways, like every later level's (U13)." : st.level === 6 ? " Level 6's intro doesn't give an exit count: three, like the others (U13)." : ""}`)}
      <div class="step-actions">${button(`Enter level ${st.level}`, { icon: "arrow-down", size: "lg", variant: "primary", attrs: html`data-act="start"` })}</div>`,
      { eyebrow: `Level ${st.level}`, title: info.name, tone: "accent" },
    );
  }

  function steps(d: Draft): Raw {
    const level = st.level;
    const list: Step[] = [];
    const chainRoom = d.chain !== undefined ? L10_CHAIN[d.chain] : undefined;
    if (d.kind === "entrance") {
      const info = LEVELS[level];
      list.push(["Entrance", "Entrance room", true, html`${stepResult(html`${rcHead("Level intro", `${d.w} × ${d.h}`)}<div class="rc-text">${info.effects}</div><div class="rc-actions">${textActions(info.effects)}</div>`)}
        <p class="muted step-note">No aliens here; the exits are archways.${st.setupNote ? ` ${st.setupNote}` : ""}</p>`]);
    } else {
      list.push(["Size", `${KIND_LABEL[d.kind]} ${d.w} × ${d.h}`, true, html`${stepResult(html`${rcHead(chainRoom ? "Level 10 chain" : "Size roll (D66)", `${d.w * d.h} squares`)}<div class="rc-text">${d.dice}</div>${d.trackers ? html`<div class="rc-text muted">${d.trackers}</div>` : ""}`)}
        ${chainRoom ? "" : html`<div class="step-actions step-kinds"><span class="muted">Squeezed by the map? Change it:</span>
          ${(["corridor", "small", "regular", "large"] as HulkKind[]).filter((k) => k !== d.kind).map((k) => button(KIND_LABEL[k], { size: "sm", attrs: html`data-kind="${k}"` }))}</div>
          ${ruleNote("small and large use the drawn size: squeezed to one square wide is a corridor, 6 squares or fewer a small room, and a large room squeezed under 32 squares a standard room (U14).")}`}`]);
      if (d.kind === "corridor") list.push(["Corridor", "Corridor", d.exits !== undefined, html`<p>No room table and no encounter. All exits are archways; the open end can be closed off or used as an exit.</p>`]);
      else typeStep(d, list);
      if (!chainRoom) exitsStep(d, list);
      else if (d.chain! < L10_CHAIN.length - 1) list.push(["Exit", "One archway", true, html`<p>${openExits(M()).some((e) => e.room === d.mapRoom) ? "The one archway exit is on the wall with the most room for the next room of the chain." : "No wall has room for the next room: pick a wall yourself (add a note) or discard and re-place."}</p>`]);
      if (d.kind !== "corridor") encounterStep(d, list);
    }
    const mr = mapRoom(d);
    const isLadder = !!mr && st.map?.stairs === mr.id;
    list.push(["Leave", "The way on", false, html`<p class="muted step-note">Finish the room, then pick an exit on the map. Doors are checked for locks the first time you go through them.</p>
      <div class="step-actions">${d.kind !== "entrance" ? button(isLadder ? "Remove the down-ladder" : "Last room: put the down-ladder here", { icon: "arrow-down", attrs: html`data-act="ladder"` }) : ""}</div>
      ${ruleNote(html`the last room going forward gets the down-ladder, usually near the top with about 75% of the level covered. Explored is measured as drawn floor (rooms, exit squares) out of the 476 squares (U19): now <strong>${explored()}%</strong>.`)}`]);
    const cur = list.findIndex(([, , done]) => !done);
    return html`<ol class="steps">${list
      .map(([name, title, done, body], i) => html`<li class="step card" data-state="${done ? "done" : i === cur ? "current" : "upcoming"}">
          <span class="step-marker" aria-hidden="true">${done ? icon("check", { size: 15 }) : i + 1}</span>
          <header class="card-head">${eyebrow(`Step ${i + 1} · ${name}`)}<h3 class="card-title">${title}</h3></header>
          <div class="card-body">${body}</div></li>`)
      }</ol>
      <div class="step-actions room-actions">
        ${button(`Finish room ${d.n}`, { icon: "check", size: "lg", variant: "primary", attrs: html`data-act="finish"` })}
        ${d.kind !== "entrance" ? button("Discard", { icon: "trash", variant: "ghost", attrs: html`data-act="discard"` }) : ""}
      </div>`;
  }

  function typeStep(d: Draft, list: Step[]) {
    const level = st.level;
    const chainRoom = d.chain !== undefined ? L10_CHAIN[d.chain] : undefined;
    if (chainRoom?.table === "special") {
      list.push(["Room", chainRoom.label ?? "Special room", !!d.room, html`${d.room ? stepResult(noteHtml(d.room.roll)) : ""}
        <p class="muted step-note">The Level 10 rooms are met in sequence, not rolled.</p>
        ${d.room ? "" : html`<div class="step-actions">${button(`Read ${chainRoom.label}`, { icon: "book", size: "lg", variant: "primary", attrs: html`data-act="special"` })}</div>`}`]);
      return;
    }
    const idt = chainRoom ? { sectionId: LEVEL_TABLES[10].sr, via: undefined, note: "" } : identityTable(level, d.kind);
    const ssrtPending = idt.via === "ssrt" && !d.ssrt;
    const tableId = ssrtPending ? idt.sectionId : idt.via === "ssrt" ? LEVEL_TABLES[9].rooms : idt.sectionId;
    const ref = tableId ? tableAt(tableId) : undefined;
    const pct = uniqueRule(col(d, "UNIQUE")).pct;
    const boss = d.kind === "regular" || d.kind === "large" ? bosses() : [];
    list.push(["Room type", "Room type", !!d.room, html`
      ${idt.via === "ssrt" ? html`<p>${idt.note ?? ""}</p>` : ""}${d.ssrt ? stepResult(noteHtml(d.ssrt)) : ""}
      ${d.room ? stepResult(noteHtml(d.room.roll)) : ""}
      ${d.rerolls?.length ? html`<p class="muted step-note">Re-rolled: ${strs(d.rerolls).join(" · ")}</p>` : ""}
      ${pct ? html`<p class="warn">Special unique room: it only appears once about ${pct}% of the level is explored.</p>` : ""}
      ${ref ? html`<div class="step-actions">${button(`${d.room ? "Re-roll" : "Roll"} on ${tableLabel(ref)}`, { icon: "dice", size: "lg", variant: d.room ? undefined : "primary", attrs: html`data-act="${ssrtPending ? "ssrt" : "type"}"` })}</div>` : ""}
      ${boss.length && !d.room ? html`<div class="step-actions vhulk-boss"><span class="muted">Boss room not met yet? It becomes the last room:</span>${boss.map((b) => button(`Make this the ${b.name.replace(/\*/g, "")}`, { size: "sm", attrs: html`data-boss="${b.row}"` }))}</div>` : ""}
      <p class="muted step-note">"YES" uniques re-roll if already met on this level; "NN% YES" rooms re-roll until about NN% is explored (${explored()}% now).</p>`]);
  }

  function exitsStep(d: Draft, list: Step[]) {
    const exitsCol = col(d, "EXITS");
    const fixed = d.kind === "small" || d.kind === "corridor";
    const count = d.exits === undefined ? "" : d.exits === 0 ? "No new exits (dead end)" : `${d.exits} new exit${d.exits > 1 ? "s" : ""}`;
    const type = exitTypeFor(st.level, d.kind, exitsCol);
    list.push(["Exits", "Exits", d.exits !== undefined, html`
      ${d.exits !== undefined ? stepResult(html`${rcHead("Number of exits")}<div class="rc-title">${count}</div><div class="rc-text">${fixed ? html`<strong>Archways</strong>` : exitsCol ? html`Room says <strong>${exitsCol}</strong>` : "Type set by the room table."}${d.exitNote ? ` ${d.exitNote}` : ""}</div>`) : html`<p>Roll D6: 1 none (dead end), 2–3 one, 4–5 two, 6 three.${fixed ? html` All are <strong>archways</strong>.` : ""}</p>`}
      <div class="step-actions">${button(`${d.exits !== undefined ? "Re-roll" : "Roll"} number of exits`, { icon: "dice", size: "lg", variant: d.exits !== undefined ? undefined : "primary", attrs: html`data-act="exits"` })}</div>
      <p class="muted step-note">One per wall, at most 3 new; never the wall you came in by or the hull. A D3 picks the first wall clockwise from your entrance${type !== "unknown" ? `; they're ${VOID_EXIT_NAME[type] ?? type.toLowerCase()}s` : ""}.</p>
      ${ruleNote("the 2nd and 3rd exits carry on clockwise (U17); an exit is only placed where the square past its exit square is free too (U16). EXITS/NEXT is read as the exit type (U18).")}`]);
  }

  function encounterStep(d: Draft, list: Step[]) {
    const enc = col(d, "ENCOUNTER");
    const desc = col(d, "DESCRIPTION") || col(d, "ROOM DESCRIPTION");
    const chainRoom = d.chain !== undefined ? L10_CHAIN[d.chain] : undefined;
    const alienBtn = chainRoom?.alien && cards.has(chainRoom.alien) ? fightButton(chainRoom.alien) : "";
    const pr = patrolRef();
    list.push(["Encounter", "Encounter", false, html`
      ${!d.room ? html`<p class="muted">Roll the room type first.</p>` : html`
        ${enc ? html`<div class="vhulk-enc"><strong>Encounter:</strong> ${ctx.inline(enc)}</div>` : desc ? html`<div class="vhulk-enc">${ctx.inline(desc)}</div>` : ""}
        <p class="muted step-note">Follow it in order. Creatures are always dealt with first, then the other tables, loot and events.</p>
        <div class="step-actions">${alienBtn}${textActions(`${desc} ${enc}`, "", alienBtn && chainRoom?.alien ? [chainRoom.alien] : [])}</div>`}
      ${pr ? html`<div class="step-actions">${button(`Patrol (${pr.table.code})`, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-follow="${pr.sectionId}|0"` })}${hasAlarmChecks(st.level) ? button("Alarm Check (2D6 + Technical ≥ 8)", { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-act="alarm"` }) : ""}</div>` : ""}
      ${st.level === 9 ? html`<div class="step-actions">${button("A Void Portal is here", { icon: "sparkles", size: "sm", variant: "ghost", attrs: html`data-act="portal"` })}</div>` : ""}
      ${resultsHtml(d.results)}`]);
  }

  /** Between rooms: pick the exit, get the door open, roll the next room. */
  function nextCard(): Raw {
    const m = M();
    const open = openExits(m);
    const next = nextExit(m);
    const chips = open
      .map((e) => {
        const r = m.rooms.find((x) => x.id === e.room);
        const kind = `${VOID_EXIT_NAME[e.type] ?? e.type}${e.locked ? ", locked" : ""}`;
        return chip(`#${r?.n ?? "?"} ${SIDE_LABEL[e.side]}`, { value: kind, active: e.id === next?.id, attrs: html`data-pick-exit="${e.id}"` });
      })
      ;
    const can = !!next && passable(next);
    const isL10 = st.level === 10;
    const done10 = isL10 && st.chain >= L10_CHAIN.length;
    const secret = !next && !isL10 && secretDoorAllowed(m, explored());
    return card(
      html`${open.length ? html`<div class="exit-pick"><span class="muted">Next room through:</span>${chips}</div><p class="muted exit-pick-hint">${mapHint(m, false)}</p>` : html`<p class="muted">No open exits left on this level.</p>`}
      ${next ? doorPanel(next) : ""}
      <div class="step-actions">
        ${next && !done10 ? button(isL10 ? `Go on to the next room of the chain` : `Roll the next room (D66)`, { icon: "dice", size: "lg", variant: can ? "primary" : undefined, attrs: html`data-act="size"${can ? "" : html` disabled title="Open the way first"`}` }) : ""}
        ${secret ? button("Add a secret panel (one-way)", { icon: "search", size: "lg", variant: "primary", attrs: html`data-act="secret"` }) : ""}
      </div>
      ${!next && !secret && !isL10 ? html`<p class="muted step-note">Stuck with ${explored()}% explored: put the down-ladder in the last room going forward (a secret panel is only added under 50%).</p>` : ""}
      ${isL10 ? ruleNote("Level 10 rooms aren't rolled: small rooms (2×3, read X then Y; U12) alternate with the AI rooms, then the Escape Pod. Each has one archway exit.") : html`<p class="muted step-note">Each new room: D66 size (Primary = across, Secondary = down). Doubles roll again and add (not double 6); a 1 makes a corridor.</p>`}
      <div class="step-actions">
        ${button("Backtrack a room", { icon: "arrow-left-right", size: "sm", variant: "ghost", attrs: html`data-act="backtrack" title="Through explored rooms: no new aliens, but Bloodied and Stunned tick"` })}
        ${button(`Camo Tent (${tents()}/${camoUses(st.level)} used)`, { icon: "shield", size: "sm", variant: "ghost", attrs: html`data-act="camo"${tents() >= camoUses(st.level) ? " disabled" : ""}` })}
        ${hasAlarmChecks(st.level) ? button("Alarm Check", { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-act="alarm"` }) : ""}
      </div>
      ${resultsHtml(st.loose)}`,
      { eyebrow: `Level ${st.level} · room ${st.rooms.length + 1}`, title: isL10 && done10 ? "The end of the chain" : "The way on", tone: "accent" },
    );
  }

  const statInput = (k: "tech" | "coding", v: number | undefined) =>
    html`<label class="vhulk-stat"><span>${k === "tech" ? "Technical" : "Coding"}</span><input type="number" min="0" max="12" data-stat="${k}" value="${v ?? ""}" placeholder="?"></label>`;

  /** What it takes to get through exit e (§2.8). */
  function doorPanel(e: MapExit): Raw {
    const s = sheet();
    const tech = s.tech ?? st.stats.tech;
    const coding = s.coding ?? st.stats.coding;
    const dr = st.doors[e.id] ?? {};
    const name = VOID_EXIT_NAME[e.type] ?? "Exit";
    const pr = patrolRef();
    const wait = pr ? button(`Wait for a patrol (${pr.table.code})`, { icon: "dice", size: "sm", attrs: html`data-door="wait"` }) : "";
    const noPatrol = pr ? "" : ruleNote(`level ${st.level} has no patrol table, so waiting at a door (and SLDT1 / FAST1 2–3 patrols) can't happen here: use another way on (U22).`);
    const res = dr.note || dr.html ? stepResult(noteHtml(dr.note ?? dr.html)) : "";
    const breaker = button("Lock Breaker", { size: "sm", variant: "ghost", attrs: html`data-door="breaker" title="Freighter Captain craft: opens any door"` });
    let body: Raw | "" = "";
    if (e.type === "archway" || e.type === "unknown") body = html`<p>${name}: walk through.</p>`;
    else if (e.type === "secret") body = html`<p>Secret panel: one-way, you can't come back through it.</p>`;
    else if (e.type === "barrier") {
      body = dr.crossed ? html`<p class="ok">You're through the barrier.</p>` : html`<p>An archway filled with energy. Passing costs <strong>${barrierDice(st.level)}</strong> damage (D6 per Hulk level).</p>
        <div class="step-actions">${button(`Pass through (${barrierDice(st.level)})`, { icon: "zap", size: "sm", variant: "primary", attrs: html`data-door="barrier"` })}
          ${button("Electric Discharge Stim", { size: "sm", variant: "ghost", attrs: html`data-door="stim"` })}${button("Diffusion Grenade (takes it down)", { size: "sm", variant: "ghost", attrs: html`data-door="diffuse"` })}</div>
        ${ruleNote("crossing an electrical barrier again (backtracking) costs the damage again unless it was taken down (U23).")}`;
    } else if (!dr.checked) {
      body = html`<p>${name}, not yet checked. First time through: roll D6 for the lock (locked on ${e.type === "sliding" ? "6" : e.type === "security" ? "5–6" : "4–6"}).</p>
        <div class="step-actions">${button("Check the lock (D6)", { icon: "dice", size: "sm", variant: "primary", attrs: html`data-door="check"` })}</div>`;
    } else if (!dr.locked || dr.open) body = html`<p class="ok">${name}: open.</p>`;
    else if (e.type === "sliding") {
      body = html`<p><strong>Locked sliding door.</strong> No lock to hack: force it with the crowbar (2D6 ≤ Technical). If you roll over, it still opens but roll SLDT1.</p>
        <div class="step-actions vhulk-statrow">${s.tech === undefined ? statInput("tech", st.stats.tech) : html`<span class="muted">Technical ${tech}</span>`}
          ${button("Crowbar (2D6)", { icon: "dice", size: "sm", variant: "primary", attrs: html`data-door="crowbar"${tech === undefined ? " disabled" : ""}` })}
          ${button("Mag Grenade (used up)", { size: "sm", variant: "ghost", attrs: html`data-door="open"` })}${breaker}${wait}</div>
        ${dr.pinned ? html`<p class="warn">Pinned: the door only opens when a patrol comes through. Fight it (SLDT1 2: +1), then it's open.</p><div class="step-actions">${button("Won the fight: the door is open", { size: "sm", attrs: html`data-door="open"` })}</div>` : ""}`;
    } else if (e.type === "security") {
      const n = (dr.attempts ?? 0) + 1;
      body = dr.lockedOut
        ? html`<p><strong>Locked out.</strong> Only the code FAST1 named (or a Lock Breaker) opens it now.</p><div class="step-actions">${button("Use the access code", { size: "sm", attrs: html`data-door="open"` })}${breaker}${wait}</div>`
        : html`<p><strong>Locked security door.</strong> Hack the pad: 2D6 ≤ Coding. Every failure rolls FAST1.</p>
        <div class="step-actions vhulk-statrow">${s.coding === undefined ? statInput("coding", st.stats.coding) : html`<span class="muted">Coding ${coding}</span>`}
          ${button(`Hack, attempt ${n} (2D6${n > 1 ? ` −${2 * (n - 1)}` : ""})`, { icon: "dice", size: "sm", variant: "primary", attrs: html`data-door="hack"${coding === undefined ? " disabled" : ""}` })}${breaker}${wait}</div>
        ${ruleNote('"−2 for each attempt" is read as −2 on the roll for each earlier attempt, cumulative (a minus makes a roll-under check easier); you may retry after FAST1 11–12 (U21).')}`;
    } else if (e.type === "biocoded") {
      body = html`<p><strong>Locked bio-coded door.</strong> It can't be forced or hacked: the scanner wants a limb from a <em>sentient, biological</em> alien. You need a blade, and amputating makes you Bloodied.</p>
        <div class="step-actions vhulk-statrow"><label class="vhulk-check"><input type="checkbox" data-bio-more> Met more than one of that alien here (+1)</label>
          ${button("Try a limb (D6, 4–6 opens)", { icon: "dice", size: "sm", variant: "primary", attrs: html`data-door="limb"` })}${breaker}${wait}</div>
        ${ruleNote("each alien corpse allows one try, and you may fetch a limb by backtracking (U20). Amputating ticks the first Bloodied box at once (U36).")}`;
    }
    const lockedNow = isVoidDoor(e.type) && dr.locked && !dr.open;
    return html`<div class="vhulk-door" data-exit-type="${e.type}">${eyebrow(`${name} · ${SIDE_LABEL[e.side]} wall`)}${body}${lockedNow ? noPatrol : ""}${res}</div>`;
  }

  /** Level-wide cards: Void Portals (L9), the ladder down. */
  function levelCards(): Raw {
    const out: Raw[] = [];
    if (st.level === 9 && st.portals.length)
      out.push(card(
        html`<p>Portals met: ${joinHtml(st.portals.map((p) => html`<strong>${p.n}</strong> (room ${M().rooms.find((r) => r.id === p.room)?.n ?? "?"})`), ", ")}.</p>
        <div class="step-actions">${button("Step through: Void Chamber (VOET1)", { icon: "sparkles", size: "sm", attrs: html`data-act="voet"` })}${button(`Leave the chamber: random portal (1D${st.portals.length})`, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-act="portal-out"` })}</div>
        ${ruleNote("the Void Chamber blocks rooms but doesn't count toward % explored; the return portal is a 1D(number of portals met) roll (U24).")}`,
        { eyebrow: "Level 9", title: "Void Portals" },
      ));
    const m = M();
    const ladderRoom = m.stairs !== null ? m.rooms.find((r) => r.id === m.stairs) : undefined;
    const s = sheet();
    const boss = bosses();
    const charLevel = s.level ?? 1;
    out.push(card(
      html`${ladderRoom ? html`<p>The down-ladder is in <strong>#${ladderRoom.n} ${ladderRoom.label}</strong>.</p>` : html`<p class="muted">Put the down-ladder in the last room going forward (its room card on the map, or the Leave step).</p>`}
      ${boss.length ? html`<p class="warn">Boss room not met yet: ${boss.map((b) => b.name).join(" or ")}. If it was never rolled it becomes the last room.</p>` : ""}
      <p class="muted step-note">At the ladder: eat a ration and rest (+${2 * charLevel} HP, +${charLevel} more with a cloth or bandage, up to baseline), or lose half your HP (max 20).</p>
      <div class="step-actions">
        <label class="vhulk-check"><input type="checkbox" data-cloth> Use a cloth or bandage</label>
        ${button("Eat a ration and rest", { icon: "utensils", size: "sm", attrs: html`data-rest="full"` })}
        ${button("Two ration parts", { size: "sm", variant: "ghost", attrs: html`data-rest="parts"` })}
        ${button("No ration", { size: "sm", variant: "ghost", attrs: html`data-rest="none"` })}
      </div>
      ${st.rest ? html`<p class="ok">${st.rest}</p>` : ""}
      ${ruleNote("half and quarter HP losses round down, and the 20 HP cap applies to both (U8).")}
      <div class="step-actions">${st.level < 10
        ? button(`Go down to level ${nextLevel(st.level)}`, { icon: "arrow-down", variant: "primary", attrs: html`data-act="descend"` })
        : button("Launch the Escape Pod", { icon: "sparkles", variant: "primary", attrs: html`data-act="escape"${st.chain >= L10_CHAIN.length ? "" : html` disabled title="Reach the Escape Pod Room first"`}` })}
        ${button("Restart this level", { icon: "rotate-ccw", variant: "ghost", attrs: html`data-act="restart"` })}</div>`,
      { eyebrow: "Going down", title: st.level < 10 ? "The ladder" : "Escape" },
    ));
    return html`${out}`;
  }

  // ---------- actions ----------
  function startLevel() {
    const s = setupLevel(st.level, st.prevLadder);
    st.map = s.map;
    st.ladderIn = s.ladderIn;
    st.voidChamber = s.voidChamber;
    st.portals = [];
    st.chain = 0;
    st.camo = 0;
    st.doors = {};
    st.loose = [];
    st.rest = undefined;
    st.rooms = [];
    st.setupNote = s.note;
    st.current = { n: 1, dice: "From the level intro.", kind: "entrance", w: s.entrance.w, h: s.entrance.h, results: [], mapRoom: s.entrance.id, entry: null, exits: openExits(s.map).length };
    persist();
    journal("start", st.current);
  }

  async function rollSize() {
    const m = M();
    const exit = nextExit(m);
    if (!exit) return ctx.toast("No open exits left.");
    if (!passable(exit)) return ctx.toast("Get through that exit first.");
    const n = st.rooms.length + 1;
    let x: number, y: number, kind: HulkKind, note: string, chain: number | undefined;
    if (st.level === 10) {
      if (st.chain >= L10_CHAIN.length) return ctx.toast("That was the last room of the chain.");
      chain = st.chain;
      const c = L10_CHAIN[chain];
      [x, y, kind] = [c.w, c.h, c.kind];
      note = `Level 10 chain, room ${chain + 2}: ${c.w} × ${c.h}${c.label ? `, the ${c.label}` : c.table === "sr" ? ", a small room (L10SR)" : ""}.`;
    } else {
      const r1 = await rollDice("D66");
      const first: Pair = [r1.dice[0], r1.dice[1]];
      let second: Pair | undefined;
      if (needsSecondRoll(first)) {
        const r2 = await rollDice("D66");
        second = [r2.dice[0], r2.dice[1]];
      }
      const dim = resolveDimensions(first, second);
      [x, y, kind] = [dim.x, dim.y, dim.kind];
      note = `Rolled ${first[0]}${first[1]}. ${dim.note}`;
    }
    const pl = findPlacement(m, exit, x, y);
    if (!pl) {
      exit.blocked = true;
      m.sel = null;
      persist();
      draw();
      return ctx.toast("Nothing fits beyond that exit (other rooms or the hull). It's marked blocked: pick another.");
    }
    if (pl.w !== x || pl.h !== y) {
      note += ` Only ${pl.w} × ${pl.h} fits, so it's drawn that size.`;
      if (chain === undefined) kind = classifyDrawn(kind, pl.w, pl.h);
    }
    const room = addRoom(m, { n, ...pl, kind, label: KIND_LABEL[kind], sub: "", draft: true });
    exit.to = room.id;
    m.sel = null;
    const entry: Side = ({ N: "S", S: "N", E: "W", W: "E" } as const)[exit.side];
    const d: Draft = { n, dice: note, kind, w: pl.w, h: pl.h, results: [], mapRoom: room.id, entry, via: exit.id, chain };
    d.trackers = enterRoom() || undefined;
    if (chain !== undefined) {
      st.chain = chain + 1;
      const nextRoom = L10_CHAIN[chain + 1];
      if (nextRoom) bestSingleExit(m, room, entry, nextRoom);
      d.exits = nextRoom ? 1 : 0;
    }
    st.current = d;
    syncMap(d);
    persist();
    journal("start", d);
    draw();
  }

  /** Roll the room table, re-rolling uniques already met and boss rooms rolled too early. */
  async function rollType() {
    const d = st.current!;
    const idt = d.chain !== undefined ? { sectionId: LEVEL_TABLES[10].sr } : identityTable(st.level, d.kind);
    const id = (idt as { via?: string }).via === "ssrt" ? LEVEL_TABLES[9].rooms : idt.sectionId;
    const ref = id ? tableAt(id) : undefined;
    if (!ref) return ctx.toast("Couldn't find that table.");
    d.rerolls = [];
    for (let i = 0; i < 12; i++) {
      const r = await rollAndLog(ref, 0, undefined, `Hulk L${st.level} · room ${d.n}`);
      const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
      const ui = columns.findIndex((c) => /UNIQUE/i.test(c));
      const verdict = r.rowIndex < 0 ? "ok" : uniqueVerdict(cells[1] ?? "", cells[ui], uniqueSeen(), explored());
      if (verdict !== "ok") {
        d.rerolls.push(`${cells[1]} (${verdict === "duplicate" ? "unique, already met" : "too early"})`);
        continue;
      }
      d.room = { title: ref.title, sectionId: ref.sectionId, columns, cells, roll: [rollPart(r, false)], code: `${ref.table.code ?? `L${st.level}`} ${r.roll.text.split(" ")[0]}` };
      break;
    }
    syncMap(d);
    persist();
    journal("update", d);
    draw();
  }

  /** Level 9: a small room's space reforms (SSRT1) before the normal Level Rooms roll. */
  async function rollSsrt() {
    const d = st.current!;
    const ref = tableAt(LEVEL_TABLES[9].sr!);
    if (!ref) return;
    const r = await rollAndLog(ref, 0, undefined, `Hulk L9 · room ${d.n}`);
    d.ssrt = [rollPart(r)];
    const size = (r.cells.join(" ").match(/(\d)\s*x\s*(\d)/i) ?? []).slice(1).map(Number);
    const mr = mapRoom(d);
    if (mr && size.length === 2) {
      // redraw it at the new size through the same exit, if it fits
      const via = M().exits.find((e) => e.id === d.via);
      const keep = { x: mr.x, y: mr.y, w: mr.w, h: mr.h };
      // the room's own unused exits go too: re-roll them for the new shape
      M().exits = M().exits.filter((e) => e.room !== mr.id || e.to !== undefined);
      d.exits = undefined;
      d.exitNote = undefined;
      M().rooms = M().rooms.filter((x) => x.id !== mr.id);
      const pl = via ? findPlacement(M(), via, size[0], size[1]) : null;
      M().rooms.push(mr);
      Object.assign(mr, pl ?? keep);
      d.w = mr.w;
      d.h = mr.h;
    }
    d.kind = "regular"; // "Roll on the normal Level Rooms table"
    syncMap(d);
    persist();
    draw();
  }

  function readSpecial() {
    const d = st.current!;
    const c = L10_CHAIN[d.chain!];
    // not a rollable table (no dice), so it isn't in the roll index: read it from its section
    const block = ctx.byId.get(L10_SPECIAL)?.blocks.find((b) => b.type === "table");
    const table = block?.type === "table" ? block.table : undefined;
    const row = table?.rows[c.row ?? 0];
    if (!table || !row) return ctx.toast("Couldn't find the Level 10 room.");
    const text = row[0] ?? "";
    const title = table.title ?? "Level 10 room";
    d.room = { title, sectionId: L10_SPECIAL, columns: ["ROOM TYPE", "DESCRIPTION"], cells: [c.label ?? "", text], code: "L10 Special", roll: [{ k: "head", label: title }, { k: "title", text: c.label ?? "" }, { k: "book", text }] };
    syncMap(d);
    persist();
    journal("update", d);
    draw();
  }

  async function rollExits() {
    const d = st.current!;
    const r = await rollDice("D6");
    d.exits = exitCount(r.value);
    let note = `Rolled ${r.value}.`;
    const mr = mapRoom(d);
    if (mr) {
      let d3 = 1;
      if (d.exits > 0) {
        const p = await rollDice("D3");
        d3 = p.value;
        note += ` Placement D3: ${d3}.`;
      }
      const placed = placeHulkExits(M(), mr, d.entry ?? null, d.exits, exitTypeFor(st.level, d.kind, col(d, "EXITS")), d3);
      if (placed.length < d.exits) note += ` Only ${placed.length} fit${placed.length === 1 ? "s" : ""} (hull or other rooms); the rest are ignored.`;
    }
    d.exitNote = note;
    syncMap(d);
    persist();
    journal("update", d);
    draw();
  }

  function finishRoom() {
    const d = st.current!;
    const type = d.room?.cells[1] ?? "";
    const ui = d.room?.columns.findIndex((c) => /UNIQUE/i.test(c)) ?? -1;
    st.rooms.push({ n: d.n, kind: d.kind, w: d.w, h: d.h, type, unique: ui >= 0 && uniqueRule(d.room!.cells[ui]).unique, mapRoom: d.mapRoom });
    syncMap(d);
    const mr = mapRoom(d);
    if (mr) delete mr.draft;
    journal("finish", d);
    st.current = null;
    st.loose = [];
    persist();
  }

  function discardRoom() {
    const d = st.current;
    if (!d) return;
    journal("discard", d);
    const mr = mapRoom(d);
    if (mr) {
      const m = M();
      m.rooms = m.rooms.filter((r) => r.id !== mr.id);
      m.exits = m.exits.filter((x) => x.room !== mr.id);
      for (const x of m.exits) if (x.to === mr.id) delete x.to;
      if (m.stairs === mr.id) m.stairs = null;
    }
    if (d.chain !== undefined) st.chain = d.chain;
    st.current = null;
    persist();
  }

  function fight(sectionId: string, name: string, special: string) {
    const cs = load<Record<string, unknown>>("vcombat", {});
    save("vcombat", { ...cs, pending: { name, sectionId, from: "vhulk", level: st.level, room: st.current?.n ?? null, ...(special ? { special } : {}) } });
    bus.emit("void:changed", { source: "vhulk" });
    ctx.openTab("#/play/vcombat", { newTab: true });
  }

  /** Door actions on the chosen exit (§2.8). */
  async function doorAction(act: string) {
    const m = M();
    const e = nextExit(m);
    if (!e) return;
    const dr = doorOf(e);
    const s = sheet();
    const tech = s.tech ?? st.stats.tech;
    const coding = s.coding ?? st.stats.coding;
    const ctxLabel = `Hulk L${st.level} · ${VOID_EXIT_NAME[e.type] ?? "exit"}`;
    if (act === "check") {
      const r = await rollDice("D6");
      dr.checked = true;
      dr.locked = isLocked(e.type, r.value);
      e.locked = dr.locked || undefined;
      dr.note = [{ k: "head", label: "Lock check", dice: `D6 ${r.value}` }, { k: "title", text: dr.locked ? "Locked! Marked L on the map." : "Not locked.", bad: !!dr.locked }];
      journalDoor(e, "door", !dr.locked);
    } else if (act === "crowbar" && tech !== undefined) {
      const r = await rollDice("2D6");
      const ok = forceSliding(r.value, tech);
      const note: Note = [{ k: "head", label: "Crowbar", dice: `2D6 ${r.value} vs Technical ${tech}` }, { k: "title", text: ok ? "It slides open cleanly." : "It opens, but something goes wrong:", bad: !ok }];
      dr.note = note;
      if (ok) dr.open = true;
      else {
        const ref = tableAt(SLDT1);
        if (ref) {
          const t = await rollAndLog(ref, 0, undefined, ctxLabel);
          note.push(rollPart(t));
          if (t.value <= 3) dr.pinned = true;
          else dr.open = true;
        } else dr.open = true;
      }
      journalDoor(e, "pick", ok);
    } else if (act === "hack" && coding !== undefined) {
      const r = await rollDice("2D6");
      const attempt = (dr.attempts ?? 0) + 1;
      dr.attempts = attempt;
      const h = hackSecurity(r.value, coding, attempt);
      const note: Note = [{ k: "head", label: `Hack, attempt ${attempt}`, dice: `2D6 ${r.value}${h.modifier ? ` ${h.modifier}` : ""} = ${h.total} vs Coding ${coding}` }, { k: "title", text: h.ok ? "The pad accepts it: the door opens." : "Failed: roll on FAST1.", bad: !h.ok }];
      dr.note = note;
      if (h.ok) dr.open = true;
      else {
        const ref = tableAt(FAST1);
        if (ref) {
          const t = await rollAndLog(ref, 0, undefined, ctxLabel);
          note.push(rollPart(t));
          if (t.value >= 4 && t.value <= 6) dr.open = true; // damage, then the door opens
          else if (t.value >= 7 && t.value <= 9) dr.lockedOut = true;
          else if (t.value <= 3) note.push({ k: "open", label: "Won the fight: the door is open" });
          else if (t.value === 10) note.push({ k: "open", label: "Used Electrical Parts: the door is open" });
        }
      }
      journalDoor(e, "pick", h.ok);
    } else if (act === "limb") {
      const more = !!root.querySelector<HTMLInputElement>("[data-bio-more]")?.checked;
      const r = await rollDice("D6");
      const ok = bioLimb(r.value, more);
      if (ok) dr.open = true;
      dr.note = [{ k: "head", label: "Alien limb", dice: `D6 ${r.value}${more ? " +1" : ""}` }, { k: "title", text: ok ? "The scanner accepts it: the door opens." : "Wrong alien. You can try another limb.", bad: !ok }, { k: "text", text: "You're Bloodied: tick the first box." }];
      withChar(bloody);
      journalDoor(e, "pick", ok);
    } else if (act === "barrier") {
      const r = await rollDice(barrierDice(st.level));
      dr.crossed = true;
      const applied = withChar((c) => applyDamage(c, r.value)) !== undefined;
      dr.note = [{ k: "head", label: "Electrical barrier", dice: `${r.label} ${r.text}` }, { k: "title", text: `−${r.value} HP${applied ? " (taken off your sheet)" : ""}`, bad: true }];
    } else if (act === "stim") {
      dr.crossed = true;
      dr.note = [{ k: "head", label: "Electrical barrier" }, { k: "title", text: "The Electric Discharge Stim carries you through unharmed (it's used up)." }];
    } else if (act === "diffuse") {
      e.type = "archway";
      dr.crossed = true;
      dr.note = [{ k: "head", label: "Electrical barrier" }, { k: "title", text: "The Diffusion Grenade takes the barrier down: it's an archway now." }];
    } else if (act === "breaker" || act === "open") {
      dr.open = true;
      dr.pinned = false;
      if (act === "breaker") dr.note = [{ k: "head", label: "Lock Breaker" }, { k: "title", text: "The door opens." }];
    } else if (act === "wait") {
      const ref = patrolRef();
      if (ref) {
        const t = await rollAndLog(ref, 0, undefined, `${ctxLabel} · waiting`);
        dr.note = [rollPart(t), { k: "open", label: "Won the fight: the door is open" }];
      }
    }
    if (dr.note) delete dr.html; // an older version's markup is replaced by the new result
    if (dr.open) e.locked = undefined;
    persist();
    draw();
  }

  async function alarm() {
    const s = sheet();
    const tech = s.tech ?? st.stats.tech ?? 0;
    const r = await rollDice("2D6");
    const ok = alarmCheck(r.value, tech);
    const note: Note = [{ k: "head", label: "Alarm Check", dice: `2D6 ${r.value} + Technical ${tech} = ${r.value + tech}` }, { k: "title", text: ok ? "Undetected." : "Heard! A patrol comes, and it attacks first.", bad: !ok }];
    if (!ok) {
      const ref = patrolRef();
      if (ref) note.push(rollPart(await rollAndLog(ref, 0, undefined, `Hulk L${st.level} · alarm`)));
    }
    (st.current ? st.current.results : st.loose).push({ label: "Alarm Check", note });
    persist();
    draw();
  }

  async function follow(key: string, mod: number) {
    const ref = findRef(key);
    if (!ref) return ctx.toast(`No table ${key} in the library.`);
    const r = await rollAndLog(ref, mod, undefined, st.current ? `Hulk L${st.level} · room ${st.current.n}` : `Hulk L${st.level}`);
    (st.current ? st.current.results : st.loose).push({ label: ref.title, note: [rollPart(r)] });
    persist();
    if (st.current && r.rowIndex >= 0) journal("update", st.current, { encounter: r.cells[1] || ref.title });
    draw();
  }

  function rest(kind: Ration) {
    const s = sheet();
    const cloth = !!root.querySelector<HTMLInputElement>("[data-cloth]")?.checked;
    if (!s.has) {
      st.rest = kind === "full" ? "Ate a ration: +2 HP per level (+1 more per level with a cloth), up to baseline. Update your sheet." : `Lose ${kind === "parts" ? "a quarter" : "half"} your HP (max 20). Update your sheet.`;
      bus.emit("journal:milestone", { kind: "rest", ration: kind === "full", hp: 0 });
    } else {
      if (kind === "full" && (s.rations ?? 0) < 1) return ctx.toast("No rations left.");
      const res = withChar((c) => {
        const loss = eatBetweenLevels(c, kind === "full" ? "ration" : kind);
        const gain = kind === "full" ? charRest(c, cloth) : 0;
        return { loss, gain, hp: c.hp };
      })!;
      st.rest = kind === "full" ? `Ate a ration and rested: +${res.gain} HP (now ${res.hp}).` : `No full ration: −${res.loss} HP (now ${res.hp}). No rest.`;
      bus.emit("journal:milestone", { kind: "rest", ration: kind === "full", hp: kind === "full" ? res.gain : res.loss });
    }
    persist();
    draw();
  }

  function descend() {
    const m = M();
    const ladder = m.stairs !== null ? m.rooms.find((r) => r.id === m.stairs) : undefined;
    if (!ladder && !confirm("No down-ladder is placed. Go down anyway (you'll enter the next level mid-south)?")) return;
    if (!st.rest && !confirm("You haven't eaten or rested at the ladder. Go down anyway?")) return;
    const from = st.level;
    withChar((c) => {
      c.hero[from - 1] = true;
      startHulkLevel(c);
    });
    st.prevLadder = ladder ? ladderCell(ladder) : null;
    st.level = nextLevel(st.level);
    st.map = undefined;
    st.current = null;
    st.rooms = [];
    st.rest = undefined;
    persist();
    bus.emit("journal:milestone", { kind: "descend", from, to: st.level });
    ctx.toast(hasVChar() ? `Level ${from} ticked on your hero tracker.` : `Tick level ${from} on your hero tracker.`);
  }

  // ---------- events ----------
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    if (el.dataset.level !== undefined) {
      if (st.map && !confirm("Switch level? This starts a fresh map for that level.")) return draw();
      st.level = +el.value;
      st.map = undefined;
      st.current = null;
      st.rooms = [];
      st.prevLadder = null;
      st.victory = false;
      persist();
      draw();
    } else if (el.dataset.stat) {
      const v = parseInt(el.value, 10);
      st.stats[el.dataset.stat as "tech" | "coding"] = Number.isFinite(v) ? v : undefined;
      persist();
      draw();
    }
  });
  root.addEventListener("click", (e) => {
    const p = (e.target as Element).closest?.("[data-pick-exit]");
    if (!p || busy) return;
    const id = +p.getAttribute("data-pick-exit")!;
    M().sel = M().sel === id ? null : id;
    persist();
    draw();
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || busy || b.dataset.pickExit) return;
    b.disabled = true;
    busy = true;
    try {
      mapView.setBusy(true);
      const d = st.current;
      const act = b.dataset.act;
      if (act === "start") startLevel();
      else if (act === "size") await rollSize();
      else if (act === "type" && d) await rollType();
      else if (act === "ssrt" && d) await rollSsrt();
      else if (act === "special" && d) readSpecial();
      else if (act === "exits" && d) await rollExits();
      else if (act === "finish" && d) finishRoom();
      else if (act === "discard" && d) discardRoom();
      else if (b.dataset.kind && d) {
        d.kind = b.dataset.kind as HulkKind;
        d.room = undefined;
        syncMap(d);
        persist();
        journal("update", d);
      } else if (b.dataset.boss && d) {
        const ref = tableAt(LEVEL_TABLES[st.level].rooms!);
        const row = ref?.table.rows[+b.dataset.boss];
        if (ref && row) {
          d.room = { title: ref.title, sectionId: ref.sectionId, columns: ref.table.columns, cells: row, code: `${ref.table.code ?? `L${st.level}`} ${row[0]}`, roll: [{ k: "roll", roll: { title: ref.title, dice: "chosen: the boss room", value: +b.dataset.boss, matched: true, columns: ref.table.columns, cells: row }, actions: false }] };
          M().stairs = d.mapRoom ?? M().stairs;
          syncMap(d);
          persist();
          journal("update", d);
        }
      } else if (act === "ladder" && d) {
        const mr = mapRoom(d);
        if (mr) M().stairs = M().stairs === mr.id ? null : mr.id;
        persist();
      } else if (act === "alarm") await alarm();
      else if (act === "portal" && d?.mapRoom) {
        if (!st.portals.some((p) => p.room === d.mapRoom)) st.portals.push({ n: st.portals.length + 1, room: d.mapRoom });
        persist();
      } else if (act === "voet") await follow(VOET1, 0);
      else if (act === "portal-out" && st.portals.length) {
        const r = instantRoll(`1D${st.portals.length}`);
        const p = st.portals[r.value - 1];
        const rm = M().rooms.find((x) => x.id === p.room);
        st.loose.push({ label: "Void Portal", note: [{ k: "head", label: "Return portal", dice: `1D${st.portals.length} ${r.value}` }, { k: "title", text: `You come out of Void Portal ${p.n}${rm ? `, in #${rm.n} ${rm.label}` : ""}.` }] });
        persist();
      } else if (act === "secret") {
        const ex = addSecretDoor(M(), chamber());
        ctx.toast(ex ? "A secret panel ('s') added on the room with the most space around it. It's one-way." : "No wall has room for a secret panel.");
        persist();
      } else if (act === "backtrack") {
        const t = enterRoom();
        ctx.toast(t || "You move back through an explored room: no new aliens.");
      } else if (act === "camo") {
        const gained = withChar(camoRest);
        st.camo++;
        ctx.toast(gained !== undefined ? `Camo Tent: +${gained} HP, Stunned cleared.` : "Camo Tent pitched: with a ration HP to baseline, without +half baseline (cap baseline); Stunned clears.");
        persist();
      } else if (act === "descend") descend();
      else if (act === "escape") {
        st.victory = true;
        persist();
        bus.emit("journal:milestone", { kind: "leave", level: 10 });
      } else if (act === "restart") {
        if (confirm(`Start level ${st.level} again with a fresh map?`)) {
          st.map = undefined;
          st.current = null;
          st.rooms = [];
          persist();
        }
      } else if (act === "restart-all") {
        Object.assign(st, blank());
        persist();
      } else if (b.dataset.rest) rest(b.dataset.rest as Ration);
      else if (b.dataset.door) await doorAction(b.dataset.door);
      else if (b.dataset.follow) {
        const [key, mod] = b.dataset.follow.split("|");
        await follow(key, +mod || 0);
      } else if (b.dataset.fightName) {
        if (!b.dataset.fight) ctx.toast(`No alien card for ${b.dataset.fightName} in the library.`);
        else fight(b.dataset.fight, b.dataset.fightName, b.dataset.fightSpecial ?? "");
      }
      draw();
    } finally {
      b.disabled = false;
      busy = false;
      mapView.setBusy(false);
      for (const el of root.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("[data-busy]")) {
        el.disabled = false;
        el.removeAttribute("data-busy");
      }
    }
  });

  // the maps (this page's, the Hulk map page) edit notes, the ladder and the chosen exit: merge them
  ctx.onDispose(
    bus.on("void:changed", ({ source }) => {
      if (source === "vhulk") return;
      const saved = load<Partial<State>>("vhulk", {}).map;
      if (saved && st.map && saved !== st.map) mergePanelEdits(M(), saved);
      if (!busy) draw();
    }),
  );
  const onStorage = (e: StorageEvent) => {
    if (!e.key?.endsWith(":play:vhulk") || !e.newValue) return;
    try {
      const saved = (JSON.parse(e.newValue) as Partial<State> | null)?.map;
      if (st.map && saved && Array.isArray(saved.rooms)) {
        mergePanelEdits(M(), saved);
        if (!busy) draw();
      }
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);
  ctx.onDispose(() => window.removeEventListener("storage", onStorage));
  draw();
}

// re-exported for tests and other Void tools
export type { State as HulkState, Draft as HulkDraft, MapRoom, ExitType };
