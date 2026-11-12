// 2D6 Realm play tool: turn tracker, plot explorer, land log, building register, ledger.
// Rules from docs/spec-realm.md (section ids cited there).
import type { ToolContext } from "../main";
import { rollDice } from "../dice3d";
import { entryCells, isLockedTable, isTableRef, tableFor, type TableRef, type TableRoll } from "../rolltable";
import { getContent, onContentChange, type Locked } from "../content";
import { lockedCard } from "../ui/locked";
import { makeCardsArrangeable } from "../shell/arrangecards";
import { bus } from "../shell/events";
import { rollAndLog } from "../shell/panels/results";
import { exportJSON, importJSON, load, save, stepper, wireSteppers } from "./common";
import { button, card as cardBox, eyebrow, statBlock, tabsBar } from "../ui/components";
import { icon, type IconName } from "../ui/icon";
import { loadChar, saveChar, stats } from "./sheet";
import { STRINGS, blocked, landColor, mapLegendHtml, placeArea, placeString, renderRealmMap, type Cell, type PlotLike } from "./rmap";
import { d6 } from "../dice";
import { plainText } from "../shell/journalprose";
import { html, joinHtml, type Raw, setHTML } from "../ui/html";
import { arr, bool, jsonValue, num as vnum, obj, opt, orNull, rec, str as vstr, tuple, type V } from "../lock/validate";

// ---------- building cards (through the content gateway) ----------
// The Realm's building cards are a locked book's content. They are read from its unlocked sections
// (one card per section: its "**HP:** … **Upgrade:** …" text) and are absent while it is locked;
// buildings can always be entered by hand.
export interface BCard { name: string; id: string; hp: number; size: number; cost: number; rank: number; workers: number; req: string; plot: string; benefit: string; up: string; income?: number[] }
/** The card sections, by opaque page id: four a page on pp. 137–142, two on p. 143. */
const BUILDING_IDS = [...[137, 138, 139, 140, 141, 142].flatMap((p) => [1, 2, 3, 4].map((n) => `realm/p${p}-${n}`)), "realm/p143-1", "realm/p143-2"];

/** One card from its section's title and text; undefined when the text doesn't parse. */
export function parseBuildingCard(id: string, name: string, text: string): BCard | undefined {
  // a field runs to the next "**Label:**" (or the end), so an asterisk inside it is kept
  const field = (k: string) => text.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*([\\s\\S]*?)\\s*(?=\\*\\*[^*:]+:\\*\\*|$)`))?.[1]?.trim() ?? "";
  const int = (k: string) => parseInt(field(k).replace("+", ""), 10);
  const hp = int("HP"), size = int("Size"), cost = int("Cost");
  if (!name || !(hp > 0) || !(size >= 0) || !(cost >= 0)) return undefined;
  const req = field("Requires").replace(/\.$/, "") || "—";
  const workers = /^(nothing|no workers)/i.test(req) ? 0 : parseInt(req.match(/(\d+)\s+workers?/i)?.[1] ?? "0", 10);
  const benefit = field("Benefit"), up = field("Upgrade");
  // GC a turn at each level: the benefit for L1, then each "Ln for … GC." upgrade
  const gc = (t: string) => parseInt(t.match(/(\d+)\s*GC\s+(?:per turn|income)/i)?.[1] ?? "0", 10);
  const levels = [gc(benefit)];
  for (const seg of up.split(/(?=\bL\d+ for\b)/)) {
    const m = seg.match(/^L(\d+) for \d+(?:\s*GC)?\.?([\s\S]*)$/);
    if (m && +m[1] >= 2 && +m[1] <= 9) levels[+m[1] - 1] = gc(m[2]);
  }
  const income = Array.from(levels, (x) => x ?? 0);
  return {
    name, id, hp, size, cost, rank: int("Plot Rank Modifier") || 0, workers, req,
    plot: field("Plot Requirements").replace(/\.$/, "") || "None", benefit, up, ...(income.some((x) => x > 0) ? { income } : {}),
  };
}

let cardCache: BCard[] | null = null;
onContentChange(() => (cardCache = null));
/** The building cards of the unlocked Realm (none while it is locked). */
export function buildingCards(): BCard[] {
  if (!cardCache) {
    cardCache = [];
    for (const id of BUILDING_IDS) {
      const c = getContent(id);
      if (!c?.ok) continue;
      const text = c.section.blocks.map((b) => (b.type === "para" || b.type === "heading" ? b.text : "")).join(" ");
      const bc = parseBuildingCard(id, c.section.title.trim(), text);
      if (bc) cardCache.push(bc);
    }
  }
  return cardCache;
}
const card = (name: string | undefined) => (name ? buildingCards().find((b) => b.name.toLowerCase() === name.toLowerCase()) : undefined);
/** Is this building of the named kind (the rules' House, Manor, Tavern…)? */
const isType = (b: { type?: string }, kind: string) => (b.type ?? "").trim().toLowerCase() === kind.toLowerCase();
/**
 * HP and workers a building needs: its card's (Realm unlocked), else what was saved with it (started
 * from a card, or entered by hand). `hp` is null for a building saved without its size while the
 * Realm is locked: it is neither complete nor counted until the card fills it in.
 */
function specOf(b: Bldg): { hp: number | null; workers: number } {
  const c = card(b.type);
  if (c) return c;
  return { hp: b.maxHp ?? null, workers: b.needWorkers ?? 0 };
}
// The land-type encounter entries (by opaque page id: the Realm is a locked book).
const ENCOUNTER_SECTION: Record<string, string> = {};
for (const t of ["AD", "AO", "AR", "AB", "BA", "BR", "BU", "BW", "CA", "DH", "DE", "FI", "FM"]) ENCOUNTER_SECTION[t] = "realm/p68-1";
for (const t of ["GR", "HE", "HI", "LA"]) ENCOUNTER_SECTION[t] = "realm/p86-1";
for (const t of ["LC", "MA", "ME", "MO", "OQ", "OW", "OC", "RI", "RK", "RO", "RU"]) ENCOUNTER_SECTION[t] = "realm/p92-1";
for (const t of ["SH", "SC", "SP", "SW", "WO"]) ENCOUNTER_SECTION[t] = "realm/p109-1";
// The tables the tool rolls on, by code (rolltable.tableFor).
const TBL = { lands: "TLAT1", inquiry: "LIQT1", tavern: "LOGOT1", owner: "LAIT1", event: "RMEVT1", year: "YEEVT1", five: "FIVEPT1", scroll1: "SCT1", scroll2: "SCT2" } as const;
/** Every table and section key the tool looks up, for the test that they all resolve. */
export const realmTableKeys = (): string[] => [...Object.values(TBL), ...new Set(Object.values(ENCOUNTER_SECTION)), ...BUILDING_IDS];
const LANDOWNER_COUNT = 11; // the eleven rows of LAIT1 (2D6 2–12)

/** The rollable table for a key, if it is free or unlocked. */
const refOf = (key: string): TableRef | undefined => {
  const x = tableFor(key);
  return isTableRef(x) ? x : undefined;
};
/** The locked placeholder for a table or section whose book is still locked. */
const lockOf = (key: string | undefined): Locked | undefined => {
  if (!key) return undefined;
  const x = tableFor(key);
  if (isLockedTable(x)) return x.locked;
  const c = getContent(key);
  return c && !c.ok ? c.locked : undefined;
};
const lockedAt = (key: string | undefined) => {
  const l = lockOf(key);
  return l ? lockedCard(l) : "";
};

/** The landowners' names, read from LAIT1 once the Realm is unlocked; generic labels until then. */
function landowners(): string[] {
  const rows = refOf(TBL.owner)?.table.rows ?? [];
  return Array.from({ length: LANDOWNER_COUNT }, (_, i) => {
    const name = (rows[i]?.[1] ?? "").match(/^(?:\S+\s+){2}\S+/)?.[0];
    return name ?? `Landowner ${i + 1}`;
  });
}

const iconBtn = (ic: IconName, label: string, attrs: Raw) =>
  html`<button type="button" class="btn btn-sm btn-ghost btn-icon" ${attrs} aria-label="${label}" title="${label}">${icon(ic, { size: 15 })}</button>`;
const stepperMini = (k: string, id: number, v: number) =>
  html`<span class="stepper-ctl mini"><button type="button" data-mini="${k}" data-id="${id}" data-d="-1" aria-label="Decrease">${icon("minus", { size: 14 })}</button><input value="${v}" readonly><button type="button" data-mini="${k}" data-id="${id}" data-d="1" aria-label="Increase">${icon("plus", { size: 14 })}</button></span>`;

/** The plot options for a new building: claimed plots, then the homestead. */
const plotOptions = (s: State) => html`${s.lands.filter((l) => l.claimed).map((l) => html`<option>${l.tag}</option>`)}<option>Homestead</option>`;

/** The Buildings tab: the register, starting a building from its card (once the Realm is unlocked), or by hand. */
export function buildingsHtml(s: State): Raw {
  const wk = workersAvailable(s);
  const cards = buildingCards();
  const locked = lockOf(BUILDING_IDS.find((id) => getContent(id)?.ok === false));
  const unparsed = BUILDING_IDS.filter((id) => getContent(id)?.ok && !cards.some((c) => c.id === id));
  const bRow = (b: Bldg) => {
    const c = card(b.type);
    const sp = specOf(b);
    const full = builtUp(b);
    const isHome = isType(b, "House") || isType(b, "Manor");
    const name = b.type || "Building";
    const known = sp.hp !== null;
    const unrestBoxes = isHome && sp.hp !== null ? 12 - (sp.hp + 1) : 0;
    return html`<tr>
        <td class="bname">${c ? html`<a href="#/s/${encodeURIComponent(c.id)}">${name}</a>` : html`<span>${name}</span>`}<span class="muted">${b.plot}${b.note ? ` · ${b.note}` : ""}</span></td>
        <td>${stepperMini("lvl", b.id, b.level)}</td>
        <td>${sp.hp !== null
          ? html`<div class="boxes">${Array.from({ length: sp.hp }, (_, i) => html`<label><input type="checkbox" data-hp="${b.id}" data-n="${i + 1}" ${b.hp > i ? "checked" : ""}></label>`)}</div>
          <span class="muted bstate">${full ? "complete" : `building ${b.hp}/${sp.hp}`}</span>`
          : html`<span class="bstate">HP ${b.hp} so far</span> <span class="muted">(its size filled in after you unlock the Realm)</span>`}</td>
        <td>${sp.workers ? html`${stepperMini("wk", b.id, b.workers)} <span class="muted">/ ${sp.workers}</span>` : "—"}</td>
        <td>${isHome && !known ? `Unrest ${b.unrest}` : isHome ? html`<div class="boxes unrest-boxes" title="Unrest">${Array.from({ length: unrestBoxes }, (_, i) => html`<label><input type="checkbox" data-unrest="${b.id}" data-n="${i + 1}" ${b.unrest > i ? "checked" : ""}></label>`)}</div>` : ""}</td>
        <td>${(() => { const i = incomeOf(s, b); return i.gc ? `${i.gc} GC` : i.sc ? `${i.sc} SC` : ""; })()}</td>
        <td class="row-acts">${iconBtn("trash", "Remove this building", html`data-delb="${b.id}"`)}</td></tr>`;
  };
  return html`${cardBox(
    html`<p class="muted realm-hint">Workers ${wk.used}/${wk.total} assigned.</p>
      <div class="scroll"><table class="edit-table data-table register"><thead><tr><th>Building <span class="muted">· plot</span></th><th>Level</th><th>HP <span class="muted">(1 tick per round)</span></th><th>Workers</th><th>Unrest</th><th>Income</th><th></th></tr></thead>
      <tbody>${s.buildings.length ? s.buildings.map(bRow) : html`<tr><td colspan="7" class="muted">No buildings yet.</td></tr>`}</tbody></table></div>`,
    { eyebrow: "Your buildings", title: "Building register" },
  )}
    ${cards.length ? cardBox(
      html`<div class="grid">
        <label class="field">Building<select id="nb-type">${cards.map((b) => html`<option>${b.name}</option>`)}</select></label>
        <label class="field">Plot<select id="nb-plot">${plotOptions(s)}</select></label>
      </div>
      <div class="result-box" id="nb-info"></div>
      <div class="step-actions">${button("Pay and start building", { icon: "hammer", variant: "primary", attrs: html`data-act="build"` })}</div>
      <p class="muted realm-hint">Workers must be free before you pay (except Houses, Manors and Shrines). Box 1 is ticked when you start; one more each round. More than 2 damage = not working until repaired.</p>`,
      { eyebrow: "Action 2", title: "Start a building" },
    ) : ""}
    ${locked ? lockedCard(locked) : ""}
    ${cardBox(
      html`<div class="grid">
        <label class="field">Building<input id="bh-name" placeholder="name from your card"></label>
        <label class="field">HP<input id="bh-hp" type="number" min="1" value="6"></label>
        <label class="field">Workers needed<input id="bh-workers" type="number" min="0" value="0"></label>
        <label class="field">Plot<select id="bh-plot">${plotOptions(s)}</select></label>
      </div>
      <label class="field">Notes<input id="bh-note" placeholder="cost, benefit, upgrades…"></label>
      <div class="step-actions">${button("Start this building", { icon: "hammer", attrs: html`data-act="build-hand"` })}</div>
      <p class="muted realm-hint">Pay its cost from the Ledger. Box 1 is ticked when you start; one more each round with its workers.</p>`,
      { eyebrow: cards.length ? "Or" : "Action 2", title: "Add a building by hand" },
    )}
    ${cards.length || unparsed.length ? html`<details class="card bcards"><summary><span class="eyebrow">Reference</span><span class="card-title">Building cards</span></summary><div class="bcard-grid">${cards.map(
      (b) => html`<section class="card bcard-card">
          <header class="card-head"><h3 class="card-title">${b.name}</h3></header>
          ${statBlock([["HP", String(b.hp)], ["Size", String(b.size)], ["Cost", `${b.cost} GC`], ["Rank", `+${b.rank}`], ["Workers", b.workers ? String(b.workers) : "none"]])}
          ${b.req !== "—" ? html`<p><span class="muted">Needs:</span> ${b.req}</p>` : ""}${b.plot !== "None" && b.plot !== "—" ? html`<p><span class="muted">Plot:</span> ${b.plot}</p>` : ""}
          <p>${b.benefit}</p><p class="muted">${b.up}</p></section>`,
    )}${unparsed.map((id) => {
      const c = getContent(id);
      return c?.ok ? html`<p><a href="#/s/${encodeURIComponent(id)}">${c.section.title || "Building card"}</a></p>` : "";
    })}</div></details>` : ""}`;
}

/** Pay for and start a building from its card. Its HP and workers are saved with it, for when the Realm is locked. */
export function startBuilding(s: State, c: BCard, plot: string, cost: number): Bldg {
  const needs = ["House", "Manor", "Shrine", "Well"].some((k) => isType({ type: c.name }, k)) ? 0 : c.workers;
  const free = workersAvailable(s).free;
  s.gc -= cost;
  const land = s.lands.find((l) => l.tag === plot);
  if (land) {
    land.bp -= c.size;
    land.rankMod += c.rank;
  }
  const b: Bldg = { id: s.nextId++, plot, type: c.name, level: 1, hp: 1, workers: Math.min(needs, Math.max(0, free)), unrest: 0, note: "", maxHp: c.hp, needWorkers: needs };
  s.buildings.push(b);
  return b;
}

/** Add a building entered by hand. Returns what's wrong, or null once it is added. */
export function addBuildingByHand(s: State, f: { name: string; hp: string; workers: string; plot: string; note: string }): string | null {
  const name = f.name.trim();
  const hp = parseInt(f.hp, 10);
  if (!name) return "Give the building a name.";
  if (!(hp >= 1)) return "Its HP must be 1 or more.";
  const need = Math.max(0, parseInt(f.workers, 10) || 0);
  const free = workersAvailable(s).free;
  s.buildings.push({ id: s.nextId++, plot: f.plot || "Homestead", type: name, level: 1, hp: 1, workers: Math.min(need, Math.max(0, free)), unrest: 0, note: f.note.trim(), maxHp: hp, needWorkers: need });
  return null;
}

/** The Owner step's locked card for LAIT1: only once a roll of 1–2 says the land is already owned. */
export function ownerLockedHtml(e: { owner?: string; claim?: boolean }): Raw | "" {
  return e.owner && e.claim === false ? lockedAt(TBL.owner) : "";
}

// ---------- state ----------
export interface Land { id: number; tag: string; land: string; base: string; size: number; rank: number; rankMod: number; details: string; bp: number; claimed: boolean; owner: string; cells?: Cell[] }
/** A building in the register. `maxHp` and `needWorkers` are set for one entered by hand (no card). */
export interface Bldg { id: number; plot: string; type: string; level: number; hp: number; workers: number; unrest: number; note: string; maxHp?: number; needWorkers?: number }
/**
 * A table roll as it is kept in the saved state: data, never markup (a saved state can come from an
 * imported backup). Drawn by rollNoteHtml. `rows` is null when no row matched.
 */
export interface RollNote { title: string; dice: string; mod: number; value: number; rows: [string, string][] | null }
/** The Encounter step's result: the 2D6 roll, the land entry's row text, and any rolls made from it. */
export interface EncounterNote { dice: string; value: number; land: string; text: string; rolls: RollNote[]; legacy?: string }
/** The Owner step's result. */
export interface OwnerNote { value: number; owned: boolean; roll?: RollNote }
// `string`: a note saved as markup by an older version, shown as plain text only
interface Explore { tag?: string; land?: string; code?: string; type?: string; rank?: number; size?: number; sizeNote?: string; owner?: string; ownerNote?: OwnerNote | string; encounter?: EncounterNote | string; claim?: boolean; cells?: Cell[]; placeNote?: string }

/** The encounter with one more roll appended (a saved note whose `rolls` isn't a list starts a new one). */
export const addEncounterRoll = (enc: EncounterNote, rn: RollNote): EncounterNote => ({ ...enc, rolls: [...(Array.isArray(enc.rolls) ? enc.rolls : []), rn] });

/** A roll's data for the saved state. */
export function rollNote(r: TableRoll): RollNote {
  const base = { title: r.ref.title, dice: `${r.roll.label} ${r.roll.text}`, mod: r.modifier, value: r.value };
  if (r.rowIndex < 0) return { ...base, rows: null };
  const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
  return { ...base, rows: columns.slice(1).flatMap((c, i): [string, string][] => (cells[i + 1] ? [[c, cells[i + 1]]] : [])) };
}

// saved state can come from an imported backup: read each field defensively
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A saved roll as markup; `inline` renders book text. Anything unexpected is drawn as text or dropped. */
export function rollNoteHtml(n: RollNote, inline: (s: string) => Raw): Raw {
  if (!n || typeof n !== "object") return html``;
  const title = str(n.title), value = num(n.value), mod = num(n.mod);
  if (!Array.isArray(n.rows)) return html`<span class="muted">${title}: ${value}, no matching row.</span>`;
  const rows = (n.rows as unknown[]).filter((r): r is unknown[] => Array.isArray(r)).map(([c, v]) => [str(c), str(v)] as const);
  return html`<strong>${title}</strong> <span class="log-roll">${str(n.dice)}${mod ? ` ${mod > 0 ? "+" : ""}${mod} → ${value}` : ""}</span>
      <dl class="kv" style="margin-top:4px">${rows.map(([c, v]) => html`<dt>${c}</dt><dd>${inline(v)}</dd>`)}</dl>`;
}

/** The Encounter step's result as markup (an old saved one as its plain text). */
export function encounterHtml(n: EncounterNote | string, inline: (s: string) => Raw): Raw {
  if (typeof n === "string") return html`${plainText(n)}`;
  if (!n || typeof n !== "object") return html``;
  const dice = str(n.dice), text = str(n.text), land = str(n.land);
  const rolls = Array.isArray(n.rolls) ? n.rolls : [];
  // `dice` is empty for rolls made before the encounter roll; `legacy` is an older saved note's text
  return html`${str(n.legacy)}${dice ? html`<strong>2D6: ${dice}</strong>${text ? html`<p style="margin:6px 0 0">${inline(text)}</p><p class="muted" style="font-size:0.8rem">Read from the book's ${land} entry. Check the "Plot" line there for the base land and size.</p>` : html`<p class="muted">Find roll ${num(n.value)} in the ${land} entry (button above).</p>`}` : ""}${rolls.map((r) => html`<div style="margin-top:8px">${rollNoteHtml(r, inline)}</div>`)}`;
}

/** The Owner step's result as markup (an old saved one as its plain text). */
export function ownerNoteHtml(n: OwnerNote | string, inline: (s: string) => Raw): Raw {
  if (typeof n === "string") return html`${plainText(n)}`;
  if (!n || typeof n !== "object") return html``;
  const value = num(n.value);
  return n.owned
    ? html`Rolled ${value}: <strong>already owned</strong>.<br>${n.roll ? rollNoteHtml(n.roll, inline) : ""}`
    : html`Rolled ${value}: <strong>nobody owns it</strong>. Claim it now, or it goes straight to another landowner.`;
}
export interface State {
  year: number; month: number; round: number; usedDungeon: boolean; usedTown: boolean; ended: string[];
  nextTag: number; nextId: number;
  gc: number; sc: number; cc: number; gems: string; plotIncome: string;
  lands: Land[]; buildings: Bldg[];
  positives: string; negatives: string; temp: { text: string; value: number; turns: number }[];
  kaladear: number; corruption: number; gifts: number[]; threats: number[]; actuary: string;
  explore: Explore | null; tab: string; log: string[]; pick?: Cell | null;
}
const KEEP = { extra: true, rest: jsonValue(6) };
const rn = vnum({ min: -1e9, max: 1e9 });
const rtext = vstr(20000);
const landShape = obj<Land>({
  id: rn, tag: vstr(200), land: vstr(200), base: vstr(200), size: rn, rank: rn, rankMod: rn, details: rtext, bp: rn, claimed: bool, owner: vstr(200),
  cells: opt(arr(tuple<Cell>(rn, rn), 2000)),
}, KEEP);
const bldgShape = obj<Bldg>({
  id: rn, plot: vstr(200), type: vstr(200), level: rn, hp: rn, workers: rn, unrest: rn, note: rtext, maxHp: opt(rn), needWorkers: opt(rn),
}, KEEP);
const realmShape = obj<Partial<State>>(
  {
    year: opt(rn), month: opt(rn), round: opt(rn), usedDungeon: opt(bool), usedTown: opt(bool), ended: opt(arr(vstr(200), 1000)),
    nextTag: opt(rn), nextId: opt(rn), gc: opt(rn), sc: opt(rn), cc: opt(rn), gems: opt(rtext), plotIncome: opt(rtext),
    lands: opt(arr(landShape, 2000)), buildings: opt(arr(bldgShape, 5000)),
    positives: opt(rtext), negatives: opt(rtext),
    temp: opt(arr(obj<{ text: string; value: number; turns: number }>({ text: rtext, value: rn, turns: rn }, KEEP), 1000)),
    kaladear: opt(rn), corruption: opt(rn), gifts: opt(arr(rn, 200)), threats: opt(arr(rn, 200)), actuary: opt(rtext),
    explore: opt(orNull(rec(/^.{1,64}$/, jsonValue(5), 100) as V<Explore>)), tab: opt(vstr(64)), log: opt(arr(rtext, 2000)), pick: opt(orNull(tuple<Cell>(rn, rn))),
  },
  KEEP,
);
/** A realm from untrusted JSON; every field optional (the Realm fills in the rest), every present one checked. */
export const validateRealm = (x: unknown): Partial<State> => realmShape(x, "realm");

const fresh = (): State => ({
  year: 837, month: 1, round: 1, usedDungeon: false, usedTown: false, ended: [],
  nextTag: 1, nextId: 1, gc: 0, sc: 0, cc: 0, gems: "", plotIncome: "",
  lands: [], buildings: [], positives: "", negatives: "", temp: [],
  kaladear: 0, corruption: 0, gifts: Array(LANDOWNER_COUNT).fill(0), threats: Array(LANDOWNER_COUNT).fill(0), actuary: "",
  explore: null, tab: "turn", log: [],
});

/** The lands placed on the map, as realm-map plots (code from the tag, building count per plot). */
export function plotsForMap(lands: Land[], buildings: Bldg[]): (PlotLike & { id: number; buildings: number })[] {
  return lands.filter((l) => l.cells?.length).map((l) => ({
    id: l.id, code: l.tag.replace(/^\d+/, "").toUpperCase(), cells: l.cells!, claimed: l.claimed, tag: l.tag,
    buildings: buildings.filter((b) => b.plot === l.tag).length,
  }));
}

/** A new, empty realm. */
export const freshRealm = (): State => fresh();

// ---------- derived values ----------
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const taxOf = (l: Land) => l.size * l.rank + l.rankMod;

/** "rank 2", "rank 2 +1", "rank 2 −1". */
export const rankText = (rank: number, mod: number) => `rank ${rank}${mod > 0 ? ` +${mod}` : mod < 0 ? ` −${-mod}` : ""}`;

/** A plot's details card (Realm's Map tab and the Map page); `close` is the close button, `extra` goes at the end. */
export function plotCardHtml(l: Land, buildings: readonly Bldg[], close: Raw, extra: Raw | "" = ""): Raw {
  const owner = l.claimed ? "Yours" : `Unclaimed${l.owner ? ` · ${l.owner}` : ""}`;
  return html`<div class="room-card plot-card"><div class="room-card-head"><strong>${l.tag} ${l.land}</strong>
      <span class="muted">${owner} · ${l.size} square${l.size === 1 ? "" : "s"} · ${rankText(l.rank, l.rankMod)}${l.claimed ? ` · tax ${taxOf(l)} SC` : ""}</span>
      ${close}</div>
    ${l.base ? html`<p>${l.base}</p>` : ""}${l.details ? html`<p class="muted">${l.details}</p>` : ""}
    ${joinHtml(buildings.filter((b) => b.plot === l.tag).map((b) => html`<span class="badge">${b.type} L${b.level}</span>`), " ")}${extra}</div>`;
}
const builtUp = (b: Bldg) => {
  const hp = specOf(b).hp;
  return hp !== null && b.hp >= hp;
};
/** Workers the finished houses and manors give, and how many are assigned. */
export function workersAvailable(s: State) {
  let total = 0;
  for (const b of s.buildings) {
    if (!builtUp(b)) continue;
    if (isType(b, "House")) total += b.level >= 2 ? 3 : 2;
    if (isType(b, "Manor")) total += b.level >= 3 ? 4 : 3;
  }
  const used = s.buildings.reduce((n, b) => n + b.workers, 0);
  return { total, used, free: total - used };
}
function incomeOf(s: State, b: Bldg): { gc: number; sc: number } {
  const c = card(b.type);
  if (!c || !builtUp(b) || b.workers < c.workers) return { gc: 0, sc: 0 };
  if (isType(b, "Manor")) return { gc: 0, sc: b.level >= 2 ? 5 : 0 };
  if (isType(b, "Fishery")) {
    const lake = s.lands.find((l) => l.tag === b.plot);
    return { gc: (lake?.size ?? 1) * (b.level >= 2 ? 2 : 1), sc: 0 };
  }
  return { gc: c.income?.[b.level - 1] ?? 0, sc: 0 };
}
function plotIncomeGC(s: State) {
  return lines(s.plotIncome).reduce((n, l) => n + (parseInt(l.match(/(-?\d+)\s*gc/i)?.[1] ?? l.match(/(-?\d+)\s*$/)?.[1] ?? "0", 10) || 0), 0);
}
function wellness(s: State) {
  const base = lines(s.positives).length - lines(s.negatives).length;
  const temp = s.temp.reduce((n, t) => n + t.value, 0);
  return { base, temp, total: base + temp };
}
function title(s: State) {
  const n = s.lands.filter((l) => l.claimed).length;
  return n >= 121 ? "Lord / Lady / Lordain" : n >= 41 ? "Dignitary" : "Governor";
}
const fpMax = (s: State) => Math.max(0, 6 - s.corruption);

// ---------- render ----------
export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "realm-page");
  let s: State = load<State>("realm", fresh());
  // a closed tab whose roll was still awaiting dice must not write over the newer saved state
  let live = true;
  ctx.onDispose(() => (live = false));
  let lockedNote: Raw | "" = ""; // the locked card for a table a turn action just needed (not saved)
  const persist = () => {
    if (!live) return;
    save("realm", s);
    bus.emit("realm:changed", { source: "realm" });
  };
  const inline = (t: string) => ctx.inline(t);
  const showRoll = (r: TableRoll) => rollNoteHtml(rollNote(r), inline);
  const note = (msg: string) => {
    s.log.unshift(`Y${s.year} M${s.month} R${s.round}: ${msg}`);
    s.log = s.log.slice(0, 40);
  };

  const tabs: { id: string; label: string; icon: IconName }[] = [
    { id: "turn", label: "Turn", icon: "calendar" },
    { id: "explore", label: "Explore", icon: "compass" },
    { id: "map", label: "Map", icon: "map" },
    { id: "lands", label: "Lands", icon: "flag" },
    { id: "buildings", label: "Buildings", icon: "hammer" },
    { id: "ledger", label: "Ledger", icon: "coins" },
  ];
  /** Step states for a step list: done steps, then the first open one is current, the rest upcoming. */
  const stepStates = () => {
    let cur = false;
    return (isDone: boolean) => (isDone ? "done" : cur ? "upcoming" : ((cur = true), "current"));
  };
  const marker = (state: string, n: number) => html`<span class="step-marker" aria-hidden="true">${state === "done" ? icon("check", { size: 15 }) : n}</span>`;
  const step = (state: string, n: number, name: string, title: Raw | string, body: Raw | string) =>
    html`<li class="step card" data-state="${state}">${marker(state, n)}
      <header class="card-head">${eyebrow(`Step ${n} · ${name}`)}<h3 class="card-title">${title}</h3></header>
      <div class="step-body">${body}</div></li>`;
  const sub = (text: string) => html`<span class="realm-sub">${text}</span>`;

  function draw() {
    const w = wellness(s);
    const wk = workersAvailable(s);
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow(`Play · Year ${s.year} · Month ${s.month}`)}<h1>${icon("castle", { size: 26 })}<span>Realm</span></h1></div>
        <div class="play-actions">
          ${button("Export", { icon: "download", variant: "ghost", attrs: html`data-act="export"` })}
          ${button("Import", { icon: "upload", variant: "ghost", attrs: html`data-act="import"` })}
          ${button("New realm", { icon: "plus", variant: "ghost", attrs: html`data-act="reset"` })}
        </div>
      </header>
      <section class="card realm-summary">${statBlock([
        ["Year", String(s.year)],
        ["Month", String(s.month)],
        ["Round", `${Math.min(s.round, 6)}/6`],
        ["Treasury", `${s.gc} GC ${s.sc} SC ${s.cc} CC`],
        ["Wellness", `${w.total >= 0 ? "+" : ""}${w.total}`],
        ["Workers", `${wk.free}/${wk.total} free`],
        ["Title", title(s)],
      ])}</section>
      ${tabsBar(tabs, s.tab, html`aria-label="Realm"`)}
      <div id="realm-tab" class="realm-tab" role="tabpanel">${{ turn: turnTab, explore: exploreTab, map: mapTab, lands: landsTab, buildings: buildingsTab, ledger: ledgerTab }[s.tab as "turn"]?.() ?? ""}</div>`);
  }

  // ----- Turn -----
  function turnTab() {
    const end = s.round > 6;
    const inc = s.buildings.map((b) => ({ b, i: incomeOf(s, b) })).filter((x) => x.i.gc || x.i.sc);
    const incGC = inc.reduce((n, x) => n + x.i.gc, 0) + plotIncomeGC(s);
    const incSC = inc.reduce((n, x) => n + x.i.sc, 0);
    const tax = s.lands.filter((l) => l.claimed).reduce((n, l) => n + taxOf(l), 0);
    const w = wellness(s);
    const has = (t: string, lvl = 1) => s.buildings.some((b) => isType(b, t) && b.level >= lvl && builtUp(b));
    const done = (k: string) => s.ended.includes(k);
    const building = s.buildings.filter((b) => !builtUp(b));
    const action = (k: string, ic: IconName, title: string, hint: string, disabled = false) =>
      html`<button type="button" class="realm-action" data-action="${k}" ${disabled ? "disabled" : ""}>${icon(ic, { size: 22 })}
        <span class="ra-text"><strong>${title}</strong><span class="muted">${hint}</span></span></button>`;
    if (!end)
      return html`${cardBox(
        html`<div class="realm-actions">
          ${action("explore", "compass", "1. Explore a plot", "TLAT1, owner, encounter")}
          ${action("build", "hammer", "2. Build or upgrade", "Start a building or upgrade one level")}
          ${action("site", "map", "3. Explore a site / return to an encounter", "Places to Explore, unfinished fights, quests")}
          ${action("actuary", "landmark", "4. The High Actuary", "Land inquiry (LIQT1), 10 GC fee")}
          ${action("dungeon", "key", "5. Explore the dungeon", s.usedDungeon ? "Already done this turn" : "Once per turn", s.usedDungeon)}
          ${action("town", "castle", "6. Visit the town", s.usedTown ? "Already done this turn" : "Once per turn", s.usedTown)}
        </div>
        ${lockedNote}
        ${building.length ? html`<p class="muted realm-hint">Under construction or repair (+1 HP each round with workers): ${building.map((b) => `${b.type || "Building"} ${b.hp}/${specOf(b).hp ?? "?"}`).join(", ")}</p>` : ""}
        <div class="step-actions">${button(`End round ${s.round}`, { icon: "chevron-right", variant: "primary", attrs: html`data-act="round"` })}</div>`,
        { eyebrow: `Month ${s.month} · Round ${s.round} of 6`, title: `Round ${s.round} of 6: choose one action` },
      )}
      ${s.log.length ? cardBox(html`<ul class="realm-diary">${s.log.slice(0, 12).map((l) => html`<li>${l}</li>`)}</ul>`, { eyebrow: "Latest first", title: "Realm diary" }) : ""}`;

    const st = stepStates();
    let n = 0;
    return html`<header class="realm-step-head">${eyebrow(`Year ${s.year} · Month ${s.month}`)}<h2>End of month ${s.month}</h2></header>
      <ol class="steps">
        ${step(st(done("income")), ++n, "Income", `Collect income: ${incGC} GC${incSC ? ` ${incSC} SC` : ""}`,
          html`${inc.map((x) => `${x.b.type} L${x.b.level}: ${x.i.gc ? `${x.i.gc} GC` : `${x.i.sc} SC`}`).join(" · ") || "No working income buildings."}${plotIncomeGC(s) ? ` · Plot income ${plotIncomeGC(s)} GC` : ""}
          <div class="step-actions">${button("Collect", { icon: "coins", variant: "primary", attrs: html`data-end="income" ${done("income") ? "disabled" : ""}` })}</div>`)}
        ${step(st(done("tax")), ++n, "Taxes", `Pay taxes: ${tax} SC`,
          html`Size × Rank + Rank Mod for every claimed plot. Can't pay? Next turn you owe both months plus 1 GC.
          <div class="step-actions">${button(`Pay ${tax} SC`, { icon: "coins", variant: "primary", attrs: html`data-end="tax" ${done("tax") ? "disabled" : ""}` })}</div>`)}
        ${step(st(done("health")), ++n, "Health", "Restore health",
          html`Your adventurer returns to full HP (if you forget, you can't do it later).
          <div class="step-actions">${button("Restore HP on the sheet", { icon: "heart", variant: "primary", attrs: html`data-end="health" ${done("health") ? "disabled" : ""}` })}</div>`)}
        ${step(st(done("wellness")), ++n, "Wellness", `Wellness ${w.total >= 0 ? "+" : ""}${w.total}`,
          html`${w.total <= -4 ? html`<span class="warn">${icon("triangle-alert", { size: 15 })} Wellness −4 or lower: +1 unrest on one house or manor.</span>` : w.total >= 4 ? "Wellness +4 or higher: one house or manor loses 1 unrest." : "No unrest change."}
          <div class="step-actions">${button("Done", { icon: "check", attrs: html`data-end="wellness"` })}</div>`)}
        ${step(st(done("event")), ++n, "Event", "Monthly event",
          html`A messenger arrives.
          ${lockOf(TBL.event) ? html`${lockedAt(TBL.event)}<div class="step-actions">${button("Done", { icon: "check", attrs: html`data-end="event" ${done("event") ? "disabled" : ""}` })}</div>`
            : html`<div class="step-actions">${button("Roll RMEVT1", { icon: "dice", variant: "primary", attrs: html`data-roll="${TBL.event}" data-end="event"` })}</div>`}
          <div class="result-box" id="ev-event"></div>`)}
        ${has("Tavern") || has("Scriptorium", 2) || has("Engraver's Workshop", 2) ? step(st(false), ++n, "Buildings", "Building rolls",
          html`<div class="step-actions">
          ${has("Tavern") ? button(`Tavern (D6${has("Tavern", 2) ? "+1" : ""}: 6 = LOGOT1)`, { icon: "dice", attrs: html`data-bldroll="tavern"` }) : ""}
          ${has("Scriptorium", 2) ? button("Scriptorium (D6)", { icon: "dice", attrs: html`data-bldroll="scriptorium"` }) : ""}
          ${has("Engraver's Workshop", 2) ? button("Engraver (D6: 5–6 = panel)", { icon: "dice", attrs: html`data-bldroll="engraver"` }) : ""}
          </div><div class="result-box" id="ev-bld"></div>`) : ""}
        ${s.month === 12 ? step(st(done("year")), ++n, "Year end", `End of year ${s.year}`,
          html`${title(s) !== "Governor" ? `Title retainer: ${title(s) === "Dignitary" ? 100 : 150} GC. ` : ""}Roll the yearly event.
          ${lockOf(TBL.year) ? html`${lockedAt(TBL.year)}<div class="step-actions">${button("Done", { icon: "check", attrs: html`data-end="year" ${done("year") ? "disabled" : ""}` })}</div>`
            : html`<div class="step-actions">${button("Roll YEEVT1", { icon: "dice", variant: "primary", attrs: html`data-roll="${TBL.year}" data-end="year"` })}</div>`}
          <div class="result-box" id="ev-year"></div>`) : ""}
      </ol>
      <div class="step-actions realm-next">${button(`Start month ${s.month === 12 ? 1 : s.month + 1}${s.month === 12 ? ` of ${s.year + 1}` : ""}`, { icon: "chevron-right", variant: "primary", size: "lg", attrs: html`data-act="nextmonth"` })}</div>`;
  }

  // ----- Explore -----
  function exploreTab() {
    const e = s.explore;
    if (!e)
      return cardBox(
        html`<p class="realm-hint">Tap an empty square on the map where you want to explore${s.pick ? html` (chosen: <strong>${s.pick[0] + 1}, ${s.pick[1] + 1}</strong>)` : ""}, then roll TLAT1 for the land. The next tag number is <strong>${s.nextTag}</strong>.</p>
        <div class="map-wrap">${mapSvg(true)}</div>
        ${lockOf(TBL.lands) ? lockedAt(TBL.lands) : html`<div class="step-actions">${button(`Roll TLAT1 (D66)${s.pick ? "" : " without placing it"}`, { icon: "dice", variant: "primary", size: "lg", attrs: html`data-act="tlat"` })}</div>`}`,
        { eyebrow: "Action 1", title: "Explore a plot" },
      );
    const sec = e.code ? ENCOUNTER_SECTION[e.code] : undefined;
    const st = stepStates();
    return html`${e.cells ? cardBox(html`<div class="map-wrap">${mapSvg(false)}</div>
        ${e.placeNote ? html`<p class="muted realm-hint">${e.placeNote}</p>` : ""}
        ${e.type !== "Unique" && e.size !== undefined ? html`<div class="step-actions">${button("Re-roll the placement", { icon: "rotate-ccw", attrs: html`data-act="replace"` })}</div>` : ""}`, { eyebrow: "Placement", title: `${e.tag ?? ""} on the map` }) : ""}
      <ol class="steps">
      ${step(st(true), 1, "Land", html`${e.land} ${sub(`${e.tag} · ${e.type} · Rank ${e.rank ?? "base"}`)}`,
        html`${e.sizeNote ? e.sizeNote : ""}
        ${e.type !== "Unique" && e.size === undefined ? html`<div class="step-actions">${button(`Roll ${e.type === "Area" ? "D6 extra squares" : "D6+2 string length"}`, { icon: "dice", variant: "primary", attrs: html`data-act="size"` })}</div>` : ""}
        ${(e.size ?? 0) >= 5 ? html`<p class="realm-note">${icon("dice", { size: 15 })} 5 or more squares: roll FIVEPT1 after the encounter.</p>` : ""}`)}
      ${step(st(!!e.owner), 2, "Owner", "Who owns it?",
        html`D6: 3–6 the land is free, 1–2 someone owns it (roll LAIT1${(e.rank ?? 0) >= 3 ? ", −2 because rank is 3+" : ""}).
        <div class="step-actions">${button("Roll D6", { icon: "dice", variant: "primary", attrs: html`data-act="owner"` })}</div>
        ${e.ownerNote ? html`<div class="result-box">${ownerNoteHtml(e.ownerNote, inline)}</div>` : ""}
        ${ownerLockedHtml(e)}
        ${e.owner ? html`<p>Land value: <strong>${(e.size ?? 1) * (e.rank ?? 0) * 3} GC</strong> (squares × rank × 3).</p>` : ""}`)}
      ${step(st(false), 3, "Encounter", "Encounter the land",
        html`Roll 2D6 once for the whole plot or string and read the ${e.land} entry. If it changes the land type, don't re-roll.
        <div class="step-actions">
          ${button("Roll 2D6", { icon: "dice", variant: "primary", attrs: html`data-act="encounter"` })}
          ${sec ? html`<a class="btn btn-ghost" href="#/s/${encodeURIComponent(sec)}?find=${encodeURIComponent(e.land ?? "")}">${icon("book", { size: 17 })}<span>Open the ${e.land} entry</span></a>` : ""}
          ${(e.size ?? 0) >= 5 && !lockOf(TBL.five) ? button("FIVEPT1", { icon: "dice", attrs: html`data-roll="${TBL.five}"` }) : ""}
        </div>
        ${e.encounter ? html`<div class="result-box">${encounterHtml(e.encounter, inline)}</div>` : ""}
        ${lockedAt(sec)}${(e.size ?? 0) >= 5 && lockOf(TBL.five) && lockOf(TBL.five)!.page !== lockOf(sec)?.page ? lockedAt(TBL.five) : ""}`)}
      ${step(st(false), 4, "Record", "Record it",
        html`<div class="grid">
          <label class="field">Base land / notes<input id="ex-base" placeholder="e.g. Shrubland, size 50"></label>
          <label class="field">Rank${e.rank === undefined ? " (base land rank)" : ""}<input id="ex-rank" type="number" value="${e.rank ?? ""}"></label>
          <label class="field">Rank mod <span class="muted">(Uniques: + base land rank)</span><input id="ex-mod" type="number" value="0"></label>
          <label class="field">Owner<input id="ex-owner" value="${e.claim ? "You" : e.owner && e.owner !== "Unclaimed" ? e.owner : ""}"></label>
        </div>
        <div class="step-actions">
          ${button("Add to my Land Log", { icon: "flag", variant: "primary", attrs: html`data-act="record-claim"` })}
          ${button("Add to Unclaimed Land Log", { icon: "plus", attrs: html`data-act="record-unclaimed"` })}
          ${button("Discard", { icon: "x", variant: "ghost", attrs: html`data-act="explore-cancel"` })}
        </div>`)}
    </ol>`;
  }

  // ----- Map -----
  let focus: number | null = null;
  const mapPlots = () => plotsForMap(s.lands, s.buildings);
  function mapSvg(pickable: boolean) {
    const e = s.explore;
    const draft = e?.cells?.length ? { code: (e.code ?? "").toUpperCase(), cells: e.cells, claimed: true, tag: e.tag ?? "" } : null;
    return renderRealmMap({ plots: mapPlots(), draft, pick: pickable ? s.pick ?? null : null, focus, pickable });
  }
  function mapTab() {
    const l = s.lands.find((x) => x.id === focus);
    const placed = s.lands.filter((x) => x.cells?.length).length;
    const kinds = [...new Set(mapPlots().map((p) => p.code))];
    return cardBox(
      html`<p class="muted realm-hint">${placed} of ${s.lands.length} plots on the map · gold border = yours, hatched with a cross = unclaimed</p>
      <div class="map-wrap">${mapSvg(false)}</div>
      ${l ? plotCardHtml(l, s.buildings, iconBtn("x", "Close", html`data-act="map-unfocus"`)) : html`<p class="muted realm-hint">Tap a plot to see it. Plots explored before the map existed aren't drawn; new ones are placed when you explore.</p>`}
      ${mapLegendHtml(kinds)}`,
      { eyebrow: "Your lands", title: "Realm map" },
    );
  }

  // ----- Lands -----
  function landsTab() {
    const row = (l: Land) => html`<tr>
      <td><input data-land="${l.id}" data-f="tag" value="${l.tag}" style="width:5em"></td>
      <td><input data-land="${l.id}" data-f="land" value="${l.land}"> <input data-land="${l.id}" data-f="base" value="${l.base}" placeholder="base"></td>
      <td><input type="number" data-land="${l.id}" data-f="size" value="${l.size}" style="width:4em"></td>
      <td><input type="number" data-land="${l.id}" data-f="rank" value="${l.rank}" style="width:4em"></td>
      <td><input type="number" data-land="${l.id}" data-f="rankMod" value="${l.rankMod}" style="width:4em"></td>
      ${l.claimed ? html`<td><strong>${taxOf(l)}</strong></td><td><input type="number" data-land="${l.id}" data-f="bp" value="${l.bp}" style="width:5em"></td>` : html`<td><input data-land="${l.id}" data-f="owner" value="${l.owner}"></td>`}
      <td><input data-land="${l.id}" data-f="details" value="${l.details}"></td>
      <td class="row-acts">${iconBtn(l.claimed ? "arrow-down" : "arrow-up", l.claimed ? "Move to unclaimed" : "It's mine now", html`data-move="${l.id}"`)}${iconBtn("trash", "Remove this row", html`data-delland="${l.id}"`)}</td></tr>`;
    const claimed = s.lands.filter((l) => l.claimed);
    const unclaimed = s.lands.filter((l) => !l.claimed);
    return html`${cardBox(
      html`<p class="muted realm-hint">${claimed.length} plots/areas · taxes <strong>${claimed.reduce((n, l) => n + taxOf(l), 0)} SC</strong> per month · ${title(s)}</p>
      <div class="scroll"><table class="edit-table data-table"><thead><tr><th>Tag</th><th>Land / base</th><th>Size</th><th>× Rank</th><th>+ Mod</th><th>= Tax SC</th><th>BP</th><th>Details</th><th></th></tr></thead>
      <tbody>${claimed.length ? claimed.map(row) : html`<tr><td colspan="9" class="muted">No land yet. Explore a plot to add one.</td></tr>`}</tbody></table></div>
      <div class="step-actions">${button("Add a row", { icon: "plus", attrs: html`data-act="addland"` })}</div>`,
      { eyebrow: "Claimed", title: "Land Log" },
    )}
      ${cardBox(
        html`<div class="scroll"><table class="edit-table data-table"><thead><tr><th>Tag</th><th>Land / base</th><th>Size</th><th>Rank</th><th>Mod</th><th>Owner</th><th>Details</th><th></th></tr></thead>
      <tbody>${unclaimed.length ? unclaimed.map(row) : html`<tr><td colspan="8" class="muted">None.</td></tr>`}</tbody></table></div>`,
        { eyebrow: "Owned by others or left", title: "Unclaimed Land Log" },
      )}
      <p class="muted realm-foot">Titles: Governor 1–40 plot areas, Dignitary 41–120, Lord/Lady 121+. Tax = Size × Rank + Rank Mod (building rank modifiers go in Mod for that plot).</p>`;
  }

  // ----- Buildings -----
  const buildingsTab = () => buildingsHtml(s);

  // ----- Ledger -----
  function ledgerTab() {
    const w = wellness(s);
    return html`<div class="realm-grid">
      ${cardBox(
        html`<div class="grid">
        ${stepper("gc", s.gc, { label: "Gold (GC)" })}${stepper("sc", s.sc, { label: "Silver (SC)" })}${stepper("cc", s.cc, { label: "Copper (CC)" })}
      </div>
      <label class="field">Gems<input data-k="gems" value="${s.gems}"></label>
      <label class="field">Plot income (one per line, e.g. "3AB Trapper 5 GC")<textarea data-k="plotIncome">${s.plotIncome}</textarea></label>
      <div class="step-actions">${button("Move coins from the character sheet", { icon: "user", attrs: html`data-act="from-char"` })}</div>`,
        { eyebrow: "Ledger", title: "Treasury" },
      )}
      ${cardBox(
        html`<p class="muted realm-hint">${w.base} + temporary ${w.temp}</p>
      <div class="grid wellness-grid">
        <label class="field">Positive: décor &amp; improvements (+1 each, one per line)<textarea data-k="positives">${s.positives}</textarea></label>
        <label class="field">Negative: eyesores &amp; atrophy (−1 each, one per line)<textarea data-k="negatives">${s.negatives}</textarea></label>
      </div>
      <h4 class="realm-subhead">Temporary wellness</h4>
      <div class="rows">${s.temp.map((t, i) => html`<div class="row"><input data-temp="${i}" data-f="text" value="${t.text}"><input type="number" data-temp="${i}" data-f="value" value="${t.value}" style="max-width:5em"><input type="number" data-temp="${i}" data-f="turns" value="${t.turns}" style="max-width:5em" title="turns left">${iconBtn("trash", "Remove this modifier", html`data-deltemp="${i}"`)}</div>`)}</div>
      <div class="step-actions">${button("Temporary modifier", { icon: "plus", attrs: html`data-act="addtemp"` })}</div>`,
        { eyebrow: "Your people", title: `Wellness ${w.total >= 0 ? "+" : ""}${w.total}` },
      )}
      ${cardBox(
        html`<div class="boxes">${Array.from({ length: 6 }, (_, i) => html`<label title="${i >= fpMax(s) ? "crossed out by corruption" : ""}"><input type="checkbox" data-kfp="${i + 1}" ${s.kaladear > i ? "checked" : ""} ${i >= fpMax(s) ? "disabled" : ""} aria-label="Kaladear favour ${i + 1}"></label>`)}</div>
        <div class="grid">${stepper("corruption", s.corruption, { label: "Corruption", min: 0, max: 10 })}</div>
        <div class="step-actions">${button("Ask Kaladear for favour (D6 ≤ FP)", { icon: "sparkles", variant: "primary", attrs: html`data-act="kcall" ${s.kaladear ? "" : "disabled"}` })}</div>
        ${s.corruption >= 6 ? html`<p class="warn">${icon("triangle-alert", { size: 15 })} Corruption ${s.corruption}: you can't call on Kaladear and temples crumble.</p>` : ""}`,
        { eyebrow: "Favour", title: "Kaladear" },
      )}
      ${cardBox(
        html`<p class="muted realm-hint">Each gift is −1 and each threat +1 on a Land Inquiry against that landowner (cross off once used).</p>
        <div class="owner-list">${landowners().map((o, i) => html`<div class="owner-row"><span class="owner-name">${o}</span>
          <span class="owner-ctl"><span class="muted">Gifts</span> ${stepperMini("gift", i, s.gifts[i])} <span class="muted">Threats</span> ${stepperMini("threat", i, s.threats[i])}</span></div>`)}</div>
        <label class="field">Modifiers and notes for land inquiries<textarea data-k="actuary">${s.actuary}</textarea></label>`,
        { eyebrow: "Landowners", title: "Gifts & threats" },
      )}
    </div>`;
  }

  // ---------- actions ----------
  /** Put the draft plot on the map from the picked square (areas grow, strings walk by D6). */
  function placeDraft() {
    const e = s.explore;
    if (!e || !s.pick || e.size === undefined) return;
    const others = mapPlots();
    if (e.type === "Area") {
      e.cells = placeArea(s.pick, e.size, blocked(others));
      e.placeNote = e.cells.length < e.size ? `Only ${e.cells.length} of ${e.size} squares fit around it.` : `${e.size} squares placed touching each other.`;
    } else if (e.type === "String") {
      const r = placeString(s.pick, Math.max(0, e.size - 2), d6);
      e.cells = r.cells;
      e.placeNote = r.rolls.join(" · ");
    }
  }

  async function rollTLAT() {
    if (lockOf(TBL.lands)) return draw(); // the Explore tab shows the locked card
    const ref = refOf(TBL.lands);
    if (!ref) return ctx.toast("TLAT1 not found");
    const r = await rollAndLog(ref, 0, undefined, "Explore a plot");
    const { columns, cells } = entryCells(r.ref.table, r.rowIndex, r.half);
    const get = (n: string) => cells[columns.findIndex((c) => c.toUpperCase().startsWith(n))] ?? "";
    const code = get("TAG").trim().toUpperCase();
    const type = get("TYPE").trim();
    const rankTxt = get("RANK").trim();
    const rank = /^\d+$/.test(rankTxt) ? +rankTxt : undefined;
    const land = get("LAND").trim();
    const T = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    s.explore = { tag: `${s.nextTag}${code}`, land, code, type: T, rank, size: T === "Unique" ? 1 : undefined, sizeNote: T === "Unique" ? "A single square. No more than two Unique plots may touch." : "" };
    if (s.pick && T === "Unique") s.explore.cells = [s.pick];
    persist();
    draw();
  }

  async function encounterRoll() {
    const e = s.explore!;
    const r = await rollDice("2D6");
    const sec = e.code ? ENCOUNTER_SECTION[e.code] : undefined;
    // find the encounter row text for this land in its section (rows are split across extracted tables)
    let text = "";
    if (sec) {
      const c = getContent(sec);
      const sect = c?.ok ? c.section : undefined;
      const blocks = sect?.blocks ?? [];
      let inLand = false;
      outer: for (const b of blocks) {
        if (b.type !== "table") continue;
        const head = [...b.table.columns, ...(b.table.rows[0] ?? [])].join(" ");
        if (new RegExp(`\\b${(e.land ?? "").replace(/[^A-Za-z ]/g, "")}\\b`, "i").test(head) && /Tag Abbreviation|2D6/i.test(head)) inLand = true;
        else if (inLand && /Tag Abbreviation/i.test(head)) break;
        if (!inLand) continue;
        for (const row of [b.table.columns, ...b.table.rows]) {
          const c0 = (row[0] ?? "").replace(/[–—]/g, "-").trim();
          const m = c0.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
          if (m && r.value >= +m[1] && r.value <= +(m[2] ?? m[1])) {
            text = row.slice(1).join(" ").trim();
            break outer;
          }
        }
      }
    }
    e.encounter = { dice: r.text, value: r.value, land: e.land ?? "", text, rolls: [] };
    note(`Encountered ${e.tag} ${e.land}: rolled ${r.value}`);
    persist();
    draw();
  }

  root.addEventListener("input", (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.k) (s as any)[el.dataset.k] = el.value;
    else if (el.dataset.land) {
      const l = s.lands.find((x) => x.id === +el.dataset.land!)!;
      const f = el.dataset.f as keyof Land;
      (l as any)[f] = el.type === "number" ? parseInt(el.value, 10) || 0 : el.value;
      persist();
      if (el.type === "number") {
        const td = el.closest("tr")?.querySelector("td:nth-child(6) strong");
        if (td) td.textContent = String(taxOf(l));
      }
      return;
    } else if (el.dataset.temp) {
      const t = s.temp[+el.dataset.temp];
      (t as any)[el.dataset.f!] = el.type === "number" ? parseInt(el.value, 10) || 0 : el.value;
    } else if (el.name && el.type === "number") (s as any)[el.name] = parseInt(el.value, 10) || 0;
    else if (el.id === "nb-type") return showNewBuilding();
    persist();
  });
  root.addEventListener("change", (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.id === "nb-type" || el.id === "nb-plot") return showNewBuilding();
    if (el.type !== "checkbox") return;
    const n = +el.dataset.n!;
    if (el.dataset.hp) {
      const b = s.buildings.find((x) => x.id === +el.dataset.hp!)!;
      b.hp = el.checked ? n : n - 1;
    } else if (el.dataset.unrest) {
      const b = s.buildings.find((x) => x.id === +el.dataset.unrest!)!;
      b.unrest = el.checked ? n : n - 1;
      const c = specOf(b);
      if (c.hp !== null && b.unrest >= 12 - (c.hp + 1)) ctx.toast(`${b.type} on ${b.plot}: all unrest boxes filled. It's destroyed and its workers leave.`);
    } else if (el.dataset.kfp) s.kaladear = el.checked ? +el.dataset.kfp : +el.dataset.kfp - 1;
    persist();
    draw();
  });

  function showNewBuilding() {
    const info = root.querySelector<HTMLElement>("#nb-info");
    const sel = root.querySelector<HTMLSelectElement>("#nb-type");
    const plotSel = root.querySelector<HTMLSelectElement>("#nb-plot");
    if (!info || !sel) return;
    const c = card(sel.value);
    if (!c) return void (info.replaceChildren());
    const plot = s.lands.find((l) => l.tag === plotSel?.value);
    const wk = workersAvailable(s);
    const titleNeed = /Dignitary/.test(c.req) ? "Dignitary" : /Lord/.test(c.req) ? "Lord" : "";
    const t = title(s);
    const titleOk = !titleNeed || (titleNeed === "Dignitary" ? t !== "Governor" : t.startsWith("Lord"));
    setHTML(info, html`<strong>${c.name}</strong>: ${c.cost} GC, size ${c.size} BP, ${c.hp} rounds to build, rank +${c.rank}.
      ${c.workers ? `Needs ${c.workers} worker${c.workers > 1 ? "s" : ""} (${wk.free} free).` : "No workers needed."}
      ${c.req !== "—" ? `Requires ${c.req}.` : ""} ${c.plot !== "None" && c.plot !== "—" ? `Plot: ${c.plot}.` : ""}
      ${plot ? html`<br>Plot ${plot.tag} (${plot.land}${plot.base ? " / " + plot.base : ""}) has ${plot.bp} BP left.` : ""}
      ${!titleOk ? html`<br><span class="warn">Needs the ${titleNeed} title.</span>` : ""}
      ${c.workers > wk.free ? html`<br><span class="warn">Not enough free workers.</span>` : ""}
      ${plot && plot.bp < c.size ? html`<br><span class="warn">Not enough building points on that plot.</span>` : ""}
      <br><span class="muted">Base land changes cost: Fields/Meadow −20%, Grassland −10%, Woodland −5 GC, Shrubland +20%, Barren +10 GC.</span>`);
  }

  // map taps: an empty square picks where to explore; a plot shows its details
  root.addEventListener("click", (ev) => {
    const t = ev.target as Element;
    const cell = t.closest?.("[data-cell]");
    if (cell) {
      const [x, y] = cell.getAttribute("data-cell")!.split(",").map(Number);
      s.pick = s.pick && s.pick[0] === x && s.pick[1] === y ? null : [x, y];
      persist();
      draw();
      return;
    }
    const plot = t.closest?.("[data-plot]");
    if (plot && s.tab === "map") {
      focus = +plot.getAttribute("data-plot")!;
      draw();
    }
  });

  root.addEventListener("click", async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    b.disabled = true;
    lockedNote = "";
    try {
      const act = b.dataset.act;
      if (b.dataset.tab) {
        s.tab = b.dataset.tab;
        persist();
        draw();
        if (s.tab === "buildings") showNewBuilding();
      } else if (b.dataset.action) {
        const a = b.dataset.action;
        if (a === "explore") {
          s.tab = "explore";
          if (!s.explore) await rollTLAT();
        } else if (a === "build") s.tab = "buildings";
        else if (a === "actuary") {
          if (lockOf(TBL.inquiry)) {
            lockedNote = lockedAt(TBL.inquiry);
            return draw();
          }
          const ref = refOf(TBL.inquiry);
          const mod = parseInt(prompt("Land inquiry modifiers (bribes +1 per 20 GC up to +3, titles, gifts −1, threats +1, repeat −1). Total:", "0") || "0", 10) || 0;
          s.gc -= 10;
          note("Visited the High Actuary (10 GC fee)");
          if (ref) await rollAndLog(ref, mod, undefined, "High Actuary");
        } else if (a === "dungeon") {
          s.usedDungeon = true;
          note("Explored the dungeon");
          persist();
          location.hash = "#/play/dungeon";
          return;
        } else if (a === "town") {
          s.usedTown = true;
          note("Visited the town");
        } else if (a === "site") note("Explored a site / returned to an encounter");
        persist();
        draw();
        if (s.tab === "buildings") showNewBuilding();
      } else if (act === "round") {
        // construction and repair progress: +1 HP per round when the building has its workers
        for (const bd of s.buildings) {
          const c = specOf(bd);
          const needs = ["House", "Manor", "Shrine", "Well"].some((k) => isType(bd, k)) ? 0 : c.workers;
          if (c.hp !== null && bd.hp > 0 && bd.hp < c.hp && bd.workers >= needs) {
            bd.hp++;
            if (bd.hp === c.hp) note(`${bd.type} on ${bd.plot} is complete`);
          }
        }
        s.round++;
        if (s.round > 6) s.ended = [];
        persist();
        draw();
      } else if (b.dataset.end || b.dataset.roll) {
        if (b.dataset.roll) {
          const ref = refOf(b.dataset.roll);
          if (ref) {
            const r = await rollAndLog(ref, 0, undefined, `Y${s.year} M${s.month}`);
            note(`${ref.title}: ${r.cells[1] ?? r.value}`);
            const target = b.dataset.end === "year" ? "#ev-year" : b.dataset.end === "event" ? "#ev-event" : null;
            if (b.dataset.end) s.ended.push(b.dataset.end);
            persist();
            if ((b.dataset.end === "event" || b.dataset.end === "year") && r.rowIndex >= 0)
              bus.emit("journal:realm", { kind: "event", year: s.year, month: s.month, title: b.dataset.end === "year" ? "Yearly event" : "Monthly event", text: r.cells[1] ?? String(r.value) });
            if (target) {
              draw();
              setHTML(root.querySelector(target)!, showRoll(r));
            } else if (s.explore) {
              const enc = s.explore.encounter;
              const rn = rollNote(r);
              s.explore.encounter = enc && typeof enc !== "string"
                ? addEncounterRoll(enc, rn)
                : { dice: "", value: 0, land: s.explore.land ?? "", text: "", rolls: [rn], ...(enc ? { legacy: plainText(enc) } : {}) };
              persist();
              draw();
            }
            return;
          }
        }
        const k = b.dataset.end!;
        if (k === "income") {
          let gc = plotIncomeGC(s), sc = 0;
          for (const bd of s.buildings) { const i = incomeOf(s, bd); gc += i.gc; sc += i.sc; }
          s.gc += gc;
          s.sc += sc;
          note(`Collected income ${gc} GC ${sc ? sc + " SC" : ""}`);
        } else if (k === "tax") {
          const tax = s.lands.filter((l) => l.claimed).reduce((n, l) => n + taxOf(l), 0);
          // pay in SC, breaking gold if needed
          let need = tax;
          const fromSc = Math.min(s.sc, need);
          s.sc -= fromSc;
          need -= fromSc;
          if (need > 0) {
            const gold = Math.ceil(need / 10);
            s.gc -= gold;
            s.sc += gold * 10 - need;
          }
          note(`Paid ${tax} SC tax`);
        } else if (k === "health") {
          const c = loadChar();
          c.hp = Math.max(c.hp, stats(c).baseline);
          saveChar(c, "realm");
          note("Adventurer restored to full health");
        }
        s.ended.push(k);
        persist();
        draw();
      } else if (b.dataset.bldroll) {
        const kind = b.dataset.bldroll;
        const out = root.querySelector<HTMLElement>("#ev-bld");
        if (kind === "tavern") {
          const r = await rollDice("D6");
          const lvl2 = s.buildings.some((x) => isType(x, "Tavern") && x.level >= 2);
          const v = r.value + (lvl2 ? 1 : 0);
          if (v >= 6) {
            const ref = refOf(TBL.tavern);
            const rr = ref ? await rollAndLog(ref, 0, undefined, "Tavern") : null;
            if (out && rr) setHTML(out, html`Tavern ${v}: something happens!<br>${showRoll(rr)}`);
            else if (out) setHTML(out, html`Tavern ${v}: something happens! ${lockedAt(TBL.tavern)}`);
          } else if (out) setHTML(out, html`Tavern: ${v}, a quiet month.`);
        } else if (kind === "scriptorium") {
          const r = await rollDice("D6");
          const l3 = s.buildings.some((x) => isType(x, "Scriptorium") && x.level >= 3);
          const id = l3 && r.value >= 5 ? TBL.scroll2 : r.value === 6 ? TBL.scroll1 : null;
          const ref = id ? refOf(id) : undefined;
          const rr = ref ? await rollAndLog(ref, 0, undefined, "Scriptorium") : null;
          if (out) setHTML(out, html`Scriptorium: ${r.value}. ${rr ? showRoll(rr) : id && lockOf(id) ? lockedAt(id) : "No scroll this month."}`);
        } else if (kind === "engraver") {
          const r = await rollDice("D6");
          if (r.value >= 5) {
            const v = await rollDice("2D6");
            if (out) setHTML(out, html`Engraver: ${r.value}. A stone panel worth <strong>${v.value} GC</strong>.`);
          } else if (out) setHTML(out, html`Engraver: ${r.value}, no panel this month.`);
        }
      } else if (act === "nextmonth") {
        bus.emit("journal:realm", { kind: "month", year: s.year, month: s.month });
        s.temp = s.temp.map((t) => ({ ...t, turns: t.turns - 1 })).filter((t) => t.turns > 0);
        if (s.month === 12) {
          const t = title(s);
          if (t !== "Governor") s.gc += t === "Dignitary" ? 100 : 150;
          s.month = 1;
          s.year++;
        } else s.month++;
        s.round = 1;
        s.usedDungeon = s.usedTown = false;
        s.ended = [];
        note(`Month ${s.month} begins`);
        persist();
        draw();
      } else if (act === "replace") {
        placeDraft();
        persist();
        draw();
      } else if (act === "map-unfocus") {
        focus = null;
        draw();
      } else if (act === "tlat") await rollTLAT();
      else if (act === "size" && s.explore) {
        const e = s.explore;
        const r = await rollDice("D6");
        if (e.type === "Area") {
          e.size = 1 + r.value;
          e.sizeNote = `Area: first square plus ${r.value} more = ${e.size} squares. Place them touching the first where you can.`;
        } else {
          e.size = 2 + r.value + 2;
          e.sizeNote = `String: you pick the 2nd square, then D6+2 = ${r.value + 2} more, ${e.size} squares in all. Each step: number the free sides 1–2, 3–4, 5–6 and roll D6.`;
        }
        placeDraft();
        persist();
        draw();
      } else if (act === "owner" && s.explore) {
        const e = s.explore;
        const r = await rollDice("D6");
        if (r.value >= 3) {
          e.owner = "Unclaimed";
          e.claim = true;
          e.ownerNote = { value: r.value, owned: false };
        } else {
          const ref = refOf(TBL.owner);
          const mod = (e.rank ?? 0) >= 3 ? -2 : 0;
          const rr = ref ? await rollAndLog(ref, mod, undefined, `Owner of ${e.tag}`) : null;
          e.owner = rr?.cells[1] ?? "Owned";
          e.claim = false;
          e.ownerNote = { value: r.value, owned: true, ...(rr ? { roll: rollNote(rr) } : {}) };
        }
        persist();
        draw();
      } else if (act === "encounter") await encounterRoll();
      else if ((act === "record-claim" || act === "record-unclaimed") && s.explore) {
        const e = s.explore;
        const base = (root.querySelector<HTMLInputElement>("#ex-base")?.value ?? "").trim();
        const owner = (root.querySelector<HTMLInputElement>("#ex-owner")?.value ?? "").trim();
        const claimed = act === "record-claim";
        const rank = parseInt(root.querySelector<HTMLInputElement>("#ex-rank")?.value ?? "", 10) || e.rank || 0;
        const rankMod = parseInt(root.querySelector<HTMLInputElement>("#ex-mod")?.value ?? "", 10) || 0;
        s.lands.push({ id: s.nextId++, tag: e.tag ?? `${s.nextTag}`, land: e.land ?? "", base, size: e.size ?? 1, rank, rankMod, details: "", bp: (e.size ?? 1) * (e.code === "RK" ? 50 : 100), claimed, owner: claimed ? "" : owner, cells: e.cells });
        s.pick = null;
        note(`${claimed ? "Claimed" : "Logged (unclaimed)"} ${e.tag} ${e.land}`);
        bus.emit("journal:realm", {
          kind: "plot", year: s.year, month: s.month, tag: e.tag ?? `${s.nextTag}`, land: e.land ?? "", type: e.type, size: e.size ?? 1,
          owner: claimed ? "" : owner || (e.owner && e.owner !== "Unclaimed" ? e.owner : ""), claimed,
          encounter: e.encounter ? plainText(String(encounterHtml(e.encounter, inline))) : undefined,
        });
        s.nextTag++;
        s.explore = null;
        s.tab = "lands";
        persist();
        draw();
      } else if (act === "explore-cancel") {
        s.explore = null;
        persist();
        draw();
      } else if (act === "addland") {
        s.lands.push({ id: s.nextId++, tag: `${s.nextTag++}`, land: "", base: "", size: 1, rank: 1, rankMod: 0, details: "", bp: 100, claimed: true, owner: "" });
        persist();
        draw();
      } else if (b.dataset.move) {
        const l = s.lands.find((x) => x.id === +b.dataset.move!)!;
        l.claimed = !l.claimed;
        persist();
        draw();
      } else if (b.dataset.delland) {
        if (confirm("Remove this row?")) {
          s.lands = s.lands.filter((x) => x.id !== +b.dataset.delland!);
          persist();
          draw();
        }
      } else if (act === "build-hand") {
        const v = (id: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? "";
        const err = addBuildingByHand(s, { name: v("bh-name"), hp: v("bh-hp"), workers: v("bh-workers"), plot: v("bh-plot"), note: v("bh-note") });
        if (err) return ctx.toast(err);
        const nb = s.buildings[s.buildings.length - 1];
        note(`Started a ${nb.type} on ${nb.plot}`);
        persist();
        draw();
      } else if (act === "build") {
        const type = root.querySelector<HTMLSelectElement>("#nb-type")?.value ?? "";
        const plot = root.querySelector<HTMLSelectElement>("#nb-plot")?.value ?? "Homestead";
        const c = card(type);
        if (!c) return ctx.toast("Pick a building card.");
        const wk = workersAvailable(s);
        const needs = ["House", "Manor", "Shrine", "Well"].some((k) => isType({ type }, k)) ? 0 : c.workers;
        if (needs > wk.free && !confirm(`Only ${wk.free} free workers but ${type} needs ${needs}. Start anyway?`)) return;
        const cost = parseInt(prompt(`Cost in GC (card: ${c.cost}; adjust for base land and discounts):`, String(c.cost)) || String(c.cost), 10) || c.cost;
        startBuilding(s, c, plot, cost);
        note(`Started a ${type} on ${plot} (${cost} GC)`);
        bus.emit("realm:building", { type });
        persist();
        draw();
        showNewBuilding();
      } else if (b.dataset.delb) {
        if (confirm("Remove this building?")) {
          s.buildings = s.buildings.filter((x) => x.id !== +b.dataset.delb!);
          persist();
          draw();
          showNewBuilding();
        }
      } else if (b.dataset.mini) {
        const id = +b.dataset.id!, d = +b.dataset.d!;
        const k = b.dataset.mini;
        if (k === "gift") s.gifts[id] = Math.max(0, s.gifts[id] + d);
        else if (k === "threat") s.threats[id] = Math.max(0, s.threats[id] + d);
        else {
          const bd = s.buildings.find((x) => x.id === id)!;
          if (k === "lvl") {
            bd.level = Math.max(1, bd.level + d);
            if (d > 0) note(`Upgraded ${bd.type} to L${bd.level} (takes 1 round)`);
          }
          if (k === "wk") bd.workers = Math.max(0, bd.workers + d);
        }
        persist();
        draw();
        if (s.tab === "buildings") showNewBuilding();
      } else if (act === "addtemp") {
        s.temp.push({ text: "", value: 1, turns: 1 });
        persist();
        draw();
      } else if (b.dataset.deltemp) {
        s.temp.splice(+b.dataset.deltemp, 1);
        persist();
        draw();
      } else if (act === "kcall") {
        const r = await rollDice("D6");
        const ok = r.value <= s.kaladear;
        ctx.toast(`Kaladear: rolled ${r.value} against ${s.kaladear} FP. ${ok ? "Favour granted!" : "No answer."}`);
        note(`Called on Kaladear: ${ok ? "granted" : "no answer"}`);
        persist();
      } else if (act === "from-char") {
        const c = loadChar();
        s.gc += c.gc;
        s.sc += c.sc;
        s.cc += c.cc;
        c.gc = c.sc = c.cc = 0;
        saveChar(c, "realm");
        note("Moved the adventurer's coins into the treasury");
        persist();
        draw();
      } else if (act === "export") exportJSON("realm", s);
      else if (act === "import") {
        const d = await importJSON(validateRealm);
        if (d) {
          s = { ...fresh(), ...d };
          persist();
          draw();
        }
      } else if (act === "reset") {
        if (confirm("Start a new realm? This clears the current one (export first to keep it).")) {
          s = fresh();
          persist();
          draw();
        }
      }
    } finally {
      b.disabled = false;
    }
  });

  wireSteppers(root);
  // a book was unlocked or locked again: tables, entries and landowners change
  ctx.onDispose(onContentChange(() => draw()));
  draw();
  makeCardsArrangeable(root, "2d6:shell:panes:realm", ctx.onDispose);
  if (s.tab === "buildings") showNewBuilding();
}
