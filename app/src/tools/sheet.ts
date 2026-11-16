// Digital character sheet for 2D6 Dungeon (fields and rules from docs/spec-dungeon.md §2).
import type { ToolContext } from "../main";
import { rollDice } from "../dice3d";
import { tableBySection } from "../rolltable";
import { makeCardsArrangeable } from "../shell/arrangecards";
import { readState, writeState } from "../shell/state";
import { bus } from "../shell/events";
import { rollAndLog } from "../shell/panels/results";
import { exportJSON, importJSON, load, save, stepper, wireSteppers } from "./common";
import { button, card, eyebrow, tabsBar } from "../ui/components";
import { icon } from "../ui/icon";
import { applyXp, importedLastLevel, levelChangeText, setPortrait } from "../shell/charmodel";
import { playSfx } from "../audio/sound";
import { charHeader, portrait } from "../shell/panels/charcard";
import { dsheetTabs, isDSheetTab, stepIn, tiles, type DSheetTab } from "./sheetlayout";
import { addLine, armourPicks, fillFirstEmpty, pickFor, potionPicks, runePicks, scrollPicks, type RowPick } from "./sheetpicks";
import { openPicker } from "../ui/itempicker";
import { itemChoices, itemEntries, type ItemCat } from "./itemsmodel";
import { lib } from "../library";
import { wireHoverTips } from "../ui/hovertip";
import { equipToggle, lookupItem, packChips, wireItemCards } from "../ui/itemcard";
import { joinItems, modSources, modsText, normaliseEquipped, pruneEquipped, splitItems, sumMods, type Equipped } from "./gear";
import { portraitFromFile, portraitFromUrl } from "../ui/picture";
import { PORTRAITS, portraitUrl } from "../ui/portraits";
import { askNumber } from "../ui/ask";
import { html, type Raw, setHTML } from "../ui/html";
import { arr, bool, jsonValue, num, obj, oneOf, opt, rec, str } from "../lock/validate";
import { here } from "../shell/platform";
import { createCharacter } from "../roster";
import { switchCharacter } from "../games";
import { stageReloadToast } from "../shell/reloadtoast";
import { bookInfo, getContent, onContentChange } from "../content";
import { animals, temperaments, withAnimal } from "./companionmodel";

export const LEVELS = [
  { title: "Raw", man: 2, maxMan: 1, next: 100, shift: 2, disc: 1, prec: 0, hp: 10 },
  { title: "Novice", man: 2, maxMan: 1, next: 500, shift: 2, disc: 1, prec: 1, hp: 20 },
  { title: "Apprentice", man: 2, maxMan: 1, next: 1000, shift: 2, disc: 2, prec: 1, hp: 30 },
  { title: "Skilful", man: 2, maxMan: 2, next: 2000, shift: 2, disc: 2, prec: 2, hp: 40 },
  { title: "Experienced", man: 2, maxMan: 2, next: 3000, shift: 3, disc: 3, prec: 2, hp: 50 },
  { title: "Adept", man: 3, maxMan: 2, next: 5000, shift: 3, disc: 3, prec: 3, hp: 60 },
  { title: "Accomplished", man: 3, maxMan: 2, next: 10000, shift: 3, disc: 3, prec: 4, hp: 70 },
  { title: "Expert", man: 3, maxMan: 3, next: 15000, shift: 3, disc: 4, prec: 4, hp: 80 },
  { title: "Professional", man: 3, maxMan: 3, next: 25000, shift: 4, disc: 4, prec: 4, hp: 90 },
  { title: "Master", man: 3, maxMan: 3, next: Infinity, shift: 4, disc: 5, prec: 5, hp: 100 },
];
export const GODS = ["Grakada the Core", "Intuneric the Murk", "Maduva the Rot", "Murataynie the Pulp", "Nevazator the Blind", "Radacina the Radix"];
const WEAPONS = ["Longsword", "Greataxe", "Heavy Mace"];
const STARTING_ARMOUR = [
  ["Jerkin", "[4]", "-1 Damage"],
  ["Padded Tunic", "[5]", "-1 Damage"],
  ["Quilted Coat", "[3]", "-1 Damage"],
  ["Hide Doublet", "[2]", "-1 Damage"],
];
const STARTING_SCROLLS = ["BALANCE", "MENTAL WHIP", "REFLEXES", "MELT METAL"];

export interface Character {
  name: string;
  weapon: string;
  xp: number;
  hp: number;
  bonusHp: number; // permanent baseline bonuses (e.g. Kaladear gift +5)
  bonusShift: number;
  bonusDisc: number;
  bonusPrec: number;
  runes: string; // the old single-box runes text; moved into appliedRunes the first time the sheet opens
  appliedRunes: string[][]; // [rune, applied to, effect], up to 5 on the main weapon
  manoeuvres: string[][]; // [name, dice, modifier]
  armour: string[][]; // [piece, dice, modifier]
  scrolls: string[][]; // [scroll, orbit, dispel, effect]
  potions: string[][]; // [potion, effect]
  legend: boolean[];
  bloodied: number;
  soaked: number;
  gc: number;
  sc: number;
  cc: number;
  treasure: string;
  prisoners: number;
  quests: string;
  favour: number[];
  narrative: string;
  large: string[];
  notes: string;
  rations: number;
  small: string;
  lockup: string;
  lastLevel: number;
  portrait?: string; // a square JPEG data: URL (256×256), set from the sheet's Identity card
  class?: CharClass; // absent on older saves: an adventurer
  expansions?: Partial<Record<Expansion, boolean>>; // which addon books' rules this character plays with; absent = none
  companion?: Record<string, string>; // the animal companion's sheet, by field key; absent = none yet
  equipped?: Equipped[]; // pack items worn or wielded, with the bonuses each gives (gear.ts); absent = none
}

/** A character's class. The constable (Haunted House) has its own level ladder, read from the Lairs book. */
export type CharClass = "adventurer" | "constable";
/** The expansions a character can play with, each an addon book's slug. */
export const EXPANSIONS = ["realm", "lairs", "codex", "companions", "legendary"] as const;
export type Expansion = (typeof EXPANSIONS)[number];
export const EXPANSION_NAMES: Record<Expansion, string> = {
  realm: "Realm", lairs: "Lairs", codex: "Tables Codex", companions: "Animal Companions", legendary: "Legendary Dungeon",
};
export const classOf = (c: { class?: unknown }): CharClass => (c.class === "constable" ? "constable" : "adventurer");
/** Does this character play with the expansion? Never true unless its book is unlocked on this device. */
export const hasExpansion = (c: Pick<Character, "expansions">, e: Expansion): boolean => !!c.expansions?.[e] && bookInfo(e).unlocked;

const text = str(20000);
const n = num({ min: -1e9, max: 1e9 });
const rows = (cols: number) => arr(arr(text, cols), 100);
/** A character from untrusted JSON. Every field is optional (an older export lacks newer ones; the sheet fills them in), every present one is checked. */
const characterShape = obj<Partial<Character>>(
  {
    name: opt(str(200)), weapon: opt(str(200)), xp: opt(n), hp: opt(n), bonusHp: opt(n), bonusShift: opt(n), bonusDisc: opt(n), bonusPrec: opt(n),
    runes: opt(text), appliedRunes: opt(rows(3)), manoeuvres: opt(rows(6)), armour: opt(rows(6)), scrolls: opt(rows(6)), potions: opt(rows(6)),
    legend: opt(arr(bool, 100)), bloodied: opt(n), soaked: opt(n), gc: opt(n), sc: opt(n), cc: opt(n), treasure: opt(text), prisoners: opt(n),
    quests: opt(text), favour: opt(arr(n, 100)), narrative: opt(text), large: opt(arr(text, 100)), notes: opt(text), rations: opt(n),
    small: opt(text), lockup: opt(text), lastLevel: opt(n),
    class: opt(oneOf("adventurer", "constable")),
    companion: opt(rec(/^[a-zA-Z][a-zA-Z0-9]{0,20}$/, str(2000), 40)),
    expansions: opt(obj<Partial<Record<Expansion, boolean>>>({ realm: opt(bool), lairs: opt(bool), codex: opt(bool), companions: opt(bool), legendary: opt(bool) })),
    portrait: opt(str(400000, /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]*$/)),
    equipped: opt(arr(jsonValue(3), 50)) as never, // cleaned by normaliseEquipped when the sheet draws
  },
  { extra: true, rest: jsonValue(6) },
);
export const validateCharacter = (x: unknown): Partial<Character> => characterShape(x, "character");

export function blankCharacter(): Character {
  return {
    name: "",
    weapon: "Longsword",
    xp: 0,
    hp: 10,
    bonusHp: 0,
    bonusShift: 0,
    bonusDisc: 0,
    bonusPrec: 0,
    runes: "",
    appliedRunes: Array.from({ length: 5 }, () => ["", "", ""]),
    manoeuvres: [["", "", ""], ["", "", ""], ["", "", ""]],
    armour: [["", "", ""], ["", "", ""], ["", "", ""]],
    scrolls: [["", "", "", ""], ["", "", "", ""], ["", "", "", ""]],
    potions: [["Potion of Healing", "Heals up to 10 HP (not above baseline)"], ["", ""], ["", ""], ["", ""], ["", ""]],
    legend: Array(10).fill(false),
    bloodied: 0,
    soaked: 0,
    gc: 0,
    sc: 0,
    cc: 0,
    treasure: "",
    prisoners: 0,
    quests: "",
    favour: Array(6).fill(0),
    narrative: "",
    large: Array(10).fill(""),
    notes: "",
    rations: 3,
    small: "Flint and steel, lantern, pouch, wax sealing kit, large backpack",
    lockup: "",
    lastLevel: 1,
    class: "adventurer",
    expansions: {},
  };
}

export const loadChar = () => load<Character>("character", blankCharacter());
/** Save the character and tell the panels and tools; `source` names who changed it. */
export const saveChar = (c: Character, source?: string) => {
  save("character", c);
  bus.emit("character:changed", { source: source ?? "sheet" });
};

type Level = (typeof LEVELS)[number];
let constable: Level[] | null | undefined; // undefined = not read yet; null = Lairs locked or its table unreadable
onContentChange(() => (constable = undefined));
/**
 * The constable's level ladder, read from the Lairs book's table (titles and numbers are the book's, so
 * they are never in this code). Null while Lairs is locked or the table does not parse.
 */
function constableLevels(): Level[] | null {
  if (constable !== undefined) return constable;
  constable = null;
  const c = getContent("lairs/p79-1");
  const t = c?.ok ? c.section.blocks.find((b) => b.type === "table" && /level/i.test(b.table.columns[0] ?? "")) : undefined;
  if (!t || t.type !== "table") return constable;
  const out: Level[] = [];
  for (const r of t.table.rows) {
    const man = r[2]?.match(/(\d+)\D+(\d+)/);
    const v = [r[4], r[5], r[6], r[7]].map((x) => parseInt(x, 10));
    if (!man || !r[1]?.trim() || v.some((x) => !Number.isFinite(x))) return constable;
    const next = parseInt(r[3], 10);
    out.push({ title: r[1].trim(), man: +man[1], maxMan: +man[2], next: Number.isFinite(next) ? next : Infinity, shift: v[0], disc: v[1], prec: v[2], hp: v[3] });
  }
  return (constable = out.length >= 2 && out[out.length - 1].next === Infinity ? out : null);
}
/** The level ladder for a class; a constable without a readable table falls back to the adventurer's. */
export const levelsFor = (cls?: CharClass): readonly Level[] => (cls === "constable" ? constableLevels() : null) ?? LEVELS;

export function levelOf(xp: number, cls?: CharClass) {
  const lv = levelsFor(cls);
  let lvl = 1;
  for (let i = 0; i < lv.length - 1; i++) if (xp >= lv[i].next) lvl = i + 2;
  return lvl;
}
/** `levelOf` bound to a character's class, for the XP helpers that take a `(xp) => level` callback. */
export const levelFn = (c: { class?: unknown }) => {
  const k = classOf(c);
  return (xp: number) => levelOf(xp, k);
};
/** Baseline HP at a level in the character's class (what a level-up adds is the difference between two levels). */
export const baseHpFn = (c: { class?: unknown }) => {
  const lv = levelsFor(classOf(c));
  return (lvl: number): number => (lv[lvl - 1] ?? lv[lv.length - 1]).hp;
};
/** A level's title in the character's class. */
export const levelTitle = (c: { class?: unknown }, lvl: number): string => {
  const lv = levelsFor(classOf(c));
  return (lv[lvl - 1] ?? lv[lv.length - 1]).title;
};
export function stats(c: Character) {
  const lvl = levelOf(c.xp, classOf(c));
  const L = levelsFor(classOf(c))[lvl - 1];
  const eq = sumMods(c.equipped);
  return {
    level: lvl,
    title: L.title,
    shift: L.shift + c.bonusShift + eq.shift,
    disc: L.disc + c.bonusDisc + eq.disc,
    prec: L.prec + c.bonusPrec + eq.prec,
    baseline: L.hp + c.bonusHp,
    manoeuvres: L.man,
    maxManLevel: L.maxMan,
    nextXp: L.next,
  };
}
const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));
const TAB_KEY = "2d6:shell:sheet-tab"; // per-viewer: the open tab of the sheet panel
/** A rule note on the sheet: closed until asked for, so the rules text does not make the sheet long. */
const rule = (text: string) => html`<details class="ds-rule"><summary>${icon("book-open", { size: 13 })}<span>Rule</span></summary><p>${text}</p></details>`;

/** Weapon manoeuvres from the Codex table: [{level, dice, text}] for the weapon. */
function weaponManoeuvres(ctx: ToolContext, weapon: string) {
  const s = ctx.byId.get("codex/weapon-manoeuvres-table-1");
  const t = s?.blocks.find((b) => b.type === "table");
  if (!t || t.type !== "table") return [];
  const col = t.table.columns.findIndex((c) => c.toUpperCase().includes(weapon.toUpperCase()));
  if (col < 0) return [];
  return t.table.rows
    .map((r) => ({ level: +(r[0].match(/Level (\d)/)?.[1] ?? 0), dice: r[1], text: r[col] }))
    .filter((m) => m.level && m.text);
}

/** Prisoner tallies in groups of five, as marks on a slate. */
const tallyMarks = (n: number): Raw =>
  html`${Array.from({ length: Math.ceil(n / 5) }, (_, g) => html`<span class="tally-group">${Array.from({ length: Math.min(5, n - g * 5) }, () => html`<i class="tally-mark"></i>`)}</span>`)}`;

/** A new adventurer's sheet with the chosen weapon and the `armour`-th / `scroll`-th starting armour and scroll (0-based; out of range is the first). */
export function makeAdventurer(byId: ToolContext["byId"], weapon: string, armour: number, scroll: number): Character {
  const c = blankCharacter();
  c.weapon = WEAPONS.find((w) => w.toLowerCase() === weapon.trim().toLowerCase()) ?? "Longsword";
  c.armour[0] = [...(STARTING_ARMOUR[armour] ?? STARTING_ARMOUR[0])];
  const scrollName = STARTING_SCROLLS[scroll] ?? STARTING_SCROLLS[0];
  const st = byId.get("codex/magic-scroll-table-1")?.blocks.find((x) => x.type === "table");
  const row = st && st.type === "table" ? st.table.rows.find((r) => r[0].toUpperCase() === scrollName) : null;
  c.scrolls[0] = row ? [`Scroll of ${row[0]}`, row[3], row[4], row[7]] : [`Scroll of ${scrollName}`, "", "", ""];
  return c;
}

// ---------- the animal companion (a character option, shown when the character plays with Companions) ----------
const whole = (s: string | undefined): number => {
  const v = parseInt(s ?? "", 10);
  return Number.isFinite(v) ? v : 0;
};
/** Damage taken outside combat: up to half can go to the companion, never enough to kill it (HP stays at 1 or more). */
export function shareDamage(damage: number, companionHp: number): { you: number; companion: number } {
  const d = Math.max(0, Math.floor(damage));
  const t = Math.max(0, Math.min(Math.floor(d / 2), companionHp - 1));
  return { you: d - t, companion: t };
}
function companionCard(c: Character, byId: ToolContext["byId"]): Raw {
  const k = c.companion ?? {};
  const zoo = animals(byId), temps = temperaments(byId);
  const pickers = zoo.length ? html`<div class="cs-pick">
      <label class="field">Fill in from the book's animals<select data-comp-animal><option value="">Choose an animal…</option>${zoo.map((a) => html`<option value="${a.name}"${a.name === k.kind ? html` selected` : ""}>${a.name} · ${a.size} · ${a.hp} HP</option>`)}</select></label>
      ${temps.length ? html`<label class="field">Temperament<select data-comp-temp><option value="">Choose, or roll…</option>${temps.map((t) => html`<option value="${t.name}"${(k.temperament ?? "").startsWith(t.name) ? html` selected` : ""}>${t.roll}. ${t.name} (${t.modifier})</option>`)}</select></label>
      ${button("Roll temperament", { icon: "dice", size: "sm", attrs: html`data-act="comp-temp"` })}` : ""}
    </div><p class="muted sheet-hint">Choosing an animal sets its size, stats and abilities; a temperament adjusts the stats. Ability descriptions and the trait are yours to fill in from the book.</p>` : "";
  // a field: its label chip beside (or, stacked, above) its input, laid out like the printed companion sheet
  const f = (key: string, label: string, o: { wide?: boolean; stack?: boolean; num?: boolean } = {}) =>
    html`<label class="cs-f${o.wide ? " cs-wide" : ""}${o.stack ? " cs-stack" : ""}"><span class="cs-lab">${label}</span><input data-comp="${key}" value="${k[key] ?? ""}"${o.num ? html` inputmode="numeric"` : ""}></label>`;
  const box = (key: string, label: string) =>
    html`<label class="cs-f cs-stack"><span class="cs-lab">${label}</span><textarea data-comp="${key}" rows="3">${k[key] ?? ""}</textarea></label>`;
  const abil = [1, 2, 3].map((i) => html`<div class="cs-abil">
    <div class="cs-row">${f(`a${i}name`, "Ability", { wide: true })}${f(`a${i}type`, "Type")}${f(`a${i}level`, "Level", { num: true })}</div>
    <textarea data-comp="a${i}desc" rows="3" aria-label="Ability ${i} description">${k[`a${i}desc`] ?? ""}</textarea>
  </div>`);
  return card(
    html`${pickers}<div class="comp-sheet">
        <div class="cs-row">${f("name", "Name", { wide: true })}</div>
        <div class="cs-row">${f("kind", "Animal type", { wide: true })}${f("size", "Size")}</div>
        <div class="cs-row">${f("hp", "Health points", { wide: true, num: true })}${f("baseHp", "Base HP", { num: true })}</div>
        <div class="cs-row">${f("xp", "XP", { wide: true, num: true })}${f("trait", "Trait", { wide: true })}</div>
        <div class="cs-row">${f("heft", "Heft", { stack: true })}${f("stealth", "Stealth", { stack: true })}${f("temperament", "Temperament", { stack: true, wide: true })}</div>
        <div class="cs-abils">${abil}</div>
        <div class="cs-row cs-two">${box("fears", "Fears")}${box("courage", "Courage")}</div>
      </div>
      <div class="step-actions">${button("Share damage with companion", { icon: "heart", size: "sm", attrs: html`data-act="share"` })}</div>`,
    { eyebrow: "Animal companion", title: k.name?.trim() || "Companion" },
  );
}

/** The Identity card's Expansions checklist: only books unlocked on this device can be ticked. */
function expansionsHtml(c: Character): Raw {
  const open = EXPANSIONS.filter((e) => bookInfo(e).unlocked);
  if (!open.length) return html``;
  return html`<details class="sheet-more"><summary>Expansions this character plays with</summary><div class="grid">
    ${open.map((e) => html`<label class="field"><span><input type="checkbox" data-exp="${e}"${c.expansions?.[e] ? " checked" : ""}> ${EXPANSION_NAMES[e]}</span></label>`)}
  </div></details>`;
}

/** Open the character creator; add what it makes to the roster and switch to it, on its sheet. False if storage is full; cancelling makes nothing (and is not a failure). */
export async function startNewAdventurer(byId: ToolContext["byId"]): Promise<boolean> {
  const { openCreator } = await import("../ui/charcreator"); // the creator imports this module: loaded on demand
  const c = await openCreator(byId);
  if (!c) return true;
  return createCharacter({ "play:character": c }, undefined, (id) => {
    stageReloadToast(`${c.name || "Your character"} is ready.`);
    switchCharacter(id, "#/play/sheet");
  });
}

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "sheet-page", "dsheet-page", "page-wide");
  let c = loadChar();
  let gallery = false; // the built-in portrait gallery is open
  let tab: DSheetTab = readState(TAB_KEY, isDSheetTab, () => "items");
  let editOpen = false; // the "Edit character" fold, kept open across redraws

  const draw = () => {
    // runes: an older sheet's single box becomes the first rune on the list (once); the list always has 5 rows
    if (!Array.isArray(c.appliedRunes)) c.appliedRunes = [];
    if (c.runes?.trim()) {
      c.appliedRunes = [[c.runes.trim(), "", ""], ...c.appliedRunes];
      c.runes = "";
      saveChar(c);
    }
    c.appliedRunes = [...c.appliedRunes.slice(0, 5), ...Array.from({ length: Math.max(0, 5 - c.appliedRunes.length) }, () => ["", "", ""])];
    const st = stats(c);
    const hpPct = Math.max(0, Math.min(100, (c.hp / st.baseline) * 100));
    // the book's entries: for the "add from the book" lists, and for the details shown when a row is hovered
    const armourP = armourPicks(ctx.byId), scrollP = scrollPicks(ctx.byId), potionP = potionPicks(ctx.byId), runeP = runePicks(ctx.byId);
    const tipAttrs = (p: RowPick | undefined) => (p ? html` data-tip-title="${p.row[0]}" data-tip="${p.tip}"` : "");
    /** A button that opens the item's card, when the books know the item a row names (an empty cell keeps the grid). */
    const cardBtn = (name: string | undefined) => {
      const e = name?.trim() ? lookupItem(name) : undefined;
      return e
        ? html`<button type="button" class="row-card-btn" data-item-card="${name}" aria-label="${e.name}: show its card" title="Show its card">${icon("file-text", { size: 14 })}</button>`
        : html`<span class="row-card-btn" aria-hidden="true"></span>`;
    };
    const rows = (key: keyof Character, cols: string[], n: number, picks: RowPick[] = [], cards = false) =>
      html`<div class="rows${cards ? " has-cards" : ""}">${(c[key] as string[][])
        .slice(0, n)
        .map(
          (r, i) => html`<div class="row"${tipAttrs(pickFor(picks, r[0]))}>${cols
            .map((h, j) => html`<input data-arr="${key}" data-i="${i}" data-j="${j}" placeholder="${h}" value="${r[j] ?? ""}">`)}${cards ? cardBtn(r[0]) : ""}</div>`,
        )}</div>`;
    // pack lists as item chips: hover for details, click for the card, Equip on what can be worn or wielded
    c.equipped = pruneEquipped(normaliseEquipped(c.equipped), [...c.large, ...splitItems(c.small), ...splitItems(c.treasure)]);
    const packList = (list: "large" | "small" | "treasure") => packChips(
      list === "large" ? c.large.map((v, i) => ({ v, i })).filter((x) => x.v.trim()) : splitItems(c[list]).map((v, i) => ({ v, i })),
      { list, equipped: c.equipped, equipable: () => list !== "treasure" },
    );
    const bonusNote = [
      c.bonusShift ? `${sign(c.bonusShift)} Shift` : "",
      c.bonusDisc ? `${sign(c.bonusDisc)} Discipline` : "",
      c.bonusPrec ? `${sign(c.bonusPrec)} Precision` : "",
    ].filter(Boolean);
    const count = (text: string) => html`<span class="sheet-count">${text}</span>`;
    // opens the searchable picker of the book's own entries; a pick fills the next empty row. The count shows
    // how many rows are taken, and the button is disabled when they all are.
    // a column heading over a list's inputs, so filled-in fields still say what they are
    const colHead = (cols: string[], cls = "") => html`<div class="col-head ${cls}" aria-hidden="true">${cols.map((h) => html`<span>${h}</span>`)}</div>`;
    const adder = (kind: "armour" | "scrolls" | "potions" | "appliedRunes", label: string, rowsN: number) => {
      const used = (c[kind] as string[][]).slice(0, rowsN).filter((r) => r[0]?.trim()).length;
      return html`<div class="ds-add">${button(label, { icon: "plus", size: "sm", attrs: html`data-act="add-row" data-kind="${kind}" ${used >= rowsN ? "disabled" : ""}` })}<span class="sheet-count">${used} / ${rowsN} used</span></div>`;
    };
    const cls = classOf(c) === "constable" ? "Constable" : "Adventurer";
    const tabs = dsheetTabs(hasExpansion(c, "companions"));
    const cur: DSheetTab = tabs.some((t) => t.id === tab) ? tab : "items"; // the Companion tab goes when the expansion is unticked

    // ----- the band: who you are and your hit points, in one frame -----
    const band = html`<section class="ds-frame ds-band">
        <div class="ds-id"><header class="char-head"><button type="button" class="portrait-btn" data-act="portrait" aria-label="${c.portrait ? "Change picture" : "Choose a picture"}" title="${c.portrait ? "Change picture" : "Choose a picture"}">${portrait(c, "lg")}</button>
          <div class="char-head-text"><h2 class="char-name">${c.name || "Adventurer"}</h2><span class="char-level">${cls} · Level ${st.level} ${st.title}</span>
            <div class="ds-id-xp">${stepper("xp", c.xp, { label: "XP", min: 0, step: 10 })}<span class="ds-xp-next">${st.nextXp === Infinity ? "Max level" : `${st.nextXp - c.xp} XP to level ${st.level + 1}`}</span>
              <div class="ds-legend" data-coach="ds-legend"><span class="ds-legend-lab" title="One box per dungeon level you have finished (the Legendary Dungeon)">Legendary levels</span>
                <div class="boxes legend-boxes">${c.legend.map((v, i) => html`<label title="Legendary level ${i + 1}"><input type="checkbox" data-legend="${i}" ${v ? "checked" : ""} aria-label="Legendary level ${i + 1}"><span>${i + 1}</span></label>`)}</div></div></div></div></header></div>
        <div class="ds-hp" data-coach="ds-hp">
          <div class="ds-hp-top"><h3 class="ds-frame-title">${icon("heart", { size: 16 })}<span>Hit points</span></h3>
            <div class="ds-hp-read"><strong>${c.hp}</strong><span>/ ${st.baseline}</span></div>
            <div class="hp-bar"><div style="width:${hpPct}%"></div></div></div>
          <div class="ds-hp-ctl">
            ${stepper("hp", c.hp, { label: "Set HP", min: 0 })}
            ${button("Heal to baseline", { icon: "heart", size: "sm", attrs: html`data-heal="baseline"` })}
            ${button("Potion +10", { icon: "droplet", size: "sm", attrs: html`data-heal="10" title="Potion of Healing: +10 HP, not above the baseline"` })}
          </div>
        </div>
        <div class="ds-band-more">
          <details class="sheet-more ds-edit"${editOpen || gallery ? html` open` : ""}><summary>Edit character</summary>
            <div class="portrait-actions">
              ${button(gallery ? "Hide portraits" : "Choose a portrait", { icon: "user", variant: "ghost", size: "sm", attrs: html`data-act="gallery" aria-expanded="${String(gallery)}" aria-controls="portrait-gallery"` })}
              ${button("Upload picture", { icon: "image", variant: "ghost", size: "sm", attrs: html`data-act="portrait"` })}
              ${c.portrait ? button("Remove picture", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-act="no-portrait"` }) : ""}
              <input type="file" accept="image/*" data-portrait-file hidden>
            </div>
            ${gallery ? html`<div class="portrait-gallery" id="portrait-gallery" role="group" aria-label="Portraits">${PORTRAITS.map((p) => html`<button type="button" class="portrait-pick" data-pick="${p.id}" title="${p.name}" aria-label="${p.name}"><img src="${portraitUrl(p.id)}" alt="" loading="lazy" width="64" height="64"></button>`)}</div>` : ""}
            <div class="grid">
              <label class="field">Name<input data-k="name" value="${c.name}"></label>
              <label class="field">Weapon<select data-k="weapon">${WEAPONS.map((w) => html`<option ${w === c.weapon ? "selected" : ""}>${w}</option>`)}</select></label>
            </div>
            ${expansionsHtml(c)}
          </details>
          <details class="sheet-more"><summary>Permanent HP bonus${c.bonusHp ? ` (${sign(c.bonusHp)})` : ""}</summary>${stepper("bonusHp", c.bonusHp, { label: "Added to the baseline" })}</details>
        </div>
      </section>`;

    // where a stat's number comes from, for its hover card
    const fromLevel = (total: number, bonus: number, stat?: "shift" | "disc" | "prec") => {
      const gear = stat ? sumMods(c.equipped)[stat] : 0;
      const src = stat ? modSources(c.equipped, stat) : [];
      return `${sign(total - bonus - gear)} from level ${st.level} (${st.title}).${bonus ? `\n${sign(bonus)} permanent bonus.` : ""}${src.length ? `\n${src.join("\n")} (equipped).` : ""}`;
    };

    // ----- the stat shields -----
    const statRow = html`<section class="ds-stats" data-coach="ds-stats">
        ${tiles("ds", [
          ["Level", String(st.level), st.title, `Level ${st.level}, ${st.title}.\n${c.xp} XP${st.nextXp === Infinity ? ": the top level." : `; level ${st.level + 1} at ${st.nextXp} XP.`}\nBaseline HP ${st.baseline}.`],
          ["Shift", sign(st.shift), c.bonusShift ? `${sign(c.bonusShift)} bonus` : undefined, fromLevel(st.shift, c.bonusShift, "shift")],
          ["Discipline", sign(st.disc), c.bonusDisc ? `${sign(c.bonusDisc)} bonus` : undefined, fromLevel(st.disc, c.bonusDisc, "disc")],
          ["Precision", sign(st.prec), c.bonusPrec ? `${sign(c.bonusPrec)} bonus` : undefined, fromLevel(st.prec, c.bonusPrec, "prec")],
          ["Manoeuvres", String(st.manoeuvres), `up to level ${st.maxManLevel}`, `${st.manoeuvres} manoeuvre slots at level ${st.level}.\nYou can learn ${c.weapon} manoeuvres up to manoeuvre level ${st.maxManLevel}.`],
          ["Gold", String(c.gc), `${c.sc} SC · ${c.cc} CC`, `${c.gc} gold, ${c.sc} silver, ${c.cc} copper.\n10 copper make 1 silver; 10 silver make 1 gold.`],
        ])}
        <details class="sheet-more ds-stats-more"><summary>Permanent stat bonuses${bonusNote.length ? `: ${bonusNote.join(", ")}` : ""}</summary><div class="grid">
          ${stepper("bonusShift", c.bonusShift, { label: "Shift bonus" })}
          ${stepper("bonusDisc", c.bonusDisc, { label: "Discipline bonus" })}
          ${stepper("bonusPrec", c.bonusPrec, { label: "Precision bonus" })}
        </div></details>
      </section>`;

    // ----- the two combat columns: conditions, armour and favour; weapon and scrolls -----
    const conditions = card(
      html`${(["bloodied", "soaked"] as const).map(
        (k) => html`<div class="condition">
          <div class="condition-head"><strong>${k === "bloodied" ? "Bloodied" : "Soaked"}</strong></div>
          <div class="boxes cond-boxes">${Array.from({ length: 8 }, (_, i) => html`<label><input type="checkbox" data-box="${k}" data-n="${i + 1}" ${c[k] > i ? "checked" : ""} aria-label="${k === "bloodied" ? "Bloodied" : "Soaked"} ${i + 1}"></label>`)}
          ${button("Clear", { variant: "ghost", size: "sm", attrs: html`data-clear="${k}"` })}</div>
          ${rule(`Tick 1 per room. After 8: ${k === "bloodied" ? "FEVER" : "PNEUMONIA"} −1 HP per room.`)}</div>`,
      )}`,
      { eyebrow: "Health", title: "Conditions", titleIcon: "droplet" },
    );

    const armour = card(
      html`${rows("armour", ["Armour piece", "Dice set", "Modifier"], 3, armourP, true)}
        ${adder("armour", "Find and add armour", 3)}`,
      { eyebrow: "Max 3, one per body part", title: "Armour", titleIcon: "shield" },
    );

    const scrolls = card(
      html`<div class="rows scroll-rows">${c.scrolls
          .map(
            (r, i) => html`<div class="row scroll-card${r[0] ? "" : " is-empty"}"${tipAttrs(pickFor(scrollP, r[0]))}>${(["Scroll", "Orbit", "Dispel doubles", "Effect"] as const)
              .map((h, j) => html`<label class="scroll-f scroll-f-${j}"><span>${h}</span><input data-arr="scrolls" data-i="${i}" data-j="${j}" placeholder="${["Scroll name", "e.g. 3", "e.g. 1-1, 6-6", "What it does"][j]}" value="${r[j] ?? ""}"></label>`)}<span class="scroll-btns">${cardBtn(r[0])}${button("Cast", { icon: "wand-sparkles", size: "sm", attrs: html`data-cast="${i}" ${r[0] ? "" : "disabled"} title="Cast: roll D66, a double succeeds"` })}</span></div>`,
          )}</div>
        ${adder("scrolls", "Find and add a scroll", 3)}
        ${rule("Cast at the start of combat or outside it. A double succeeds unless it's a dispel double; Discipline can shift the dice. 5 XP per level per attempt.")}`,
      { eyebrow: "Magic · max 3", title: "Scrolls", titleIcon: "wand-sparkles" },
    );

    const weapon = card(
      html`${rows("manoeuvres", ["Manoeuvre", "Dice set", "Damage"], 3)}
        <p class="muted sheet-hint">${st.manoeuvres} slots, up to level ${st.maxManLevel}.</p>
        <details class="sheet-more"><summary>${c.weapon} manoeuvres you can learn</summary>
          <ul class="learn-list">${weaponManoeuvres(ctx, c.weapon)
            .filter((m) => m.level <= st.maxManLevel)
            .map((m) => html`<li><span class="learn-lvl">L${m.level}</span><span class="learn-text">${ctx.inline(m.text)}</span>${button("Add", { icon: "plus", size: "sm", attrs: html`data-learn="${m.text}"` })}</li>`)}</ul></details>
`,
      { eyebrow: c.weapon, title: "Weapon & manoeuvres", titleIcon: "swords" },
    );

    const runes = card(
      html`${colHead(["Rune", "Applied to", "Effect"])}
        ${rows("appliedRunes", ["Rune", "Applied to", "Effect"], 5, runeP, true)}
        ${adder("appliedRunes", "Find and add a rune", 5)}`,
      { eyebrow: "Max 5 on your main weapon", title: "Applied runes", titleIcon: "sparkles" },
    );

    const prisoners = card(
      html`<div class="ds-prisoners">
          ${stepper("prisoners", c.prisoners, { label: "Liberated", min: 0 })}
          <div class="tally" role="img" aria-label="${c.prisoners} liberated prisoner tallies">${tallyMarks(c.prisoners)}</div>
        </div>
        <div class="step-actions">${button("Return to town", { icon: "flag", size: "sm", attrs: html`data-act="return-town" ${c.prisoners ? "" : "disabled"} title="Roll the Liberating Prisoners table for each liberated prisoner, then erase the tallies"` })}</div>
        ${rule("Tally each prisoner who escapes to freedom (an L1PR or L2PR result). Back in town, roll on the Liberating Prisoners table for each, then erase the tally.")}`,
      { eyebrow: `${c.prisoners} ${c.prisoners === 1 ? "tally" : "tallies"}`, title: "Prisoners", titleIcon: "flag" },
    );

    const favour = card(
      html`<div class="favour-list">${GODS.map(
          (g, gi) => html`<div class="favour-row"><span class="favour-god" title="${g}">${g}</span>
            <span class="boxes">${Array.from({ length: 6 }, (_, i) => html`<label><input type="checkbox" data-fp="${gi}" data-n="${i + 1}" ${c.favour[gi] > i ? "checked" : ""} aria-label="${g} favour ${i + 1}"></label>`)}</span>
            ${button("Call", { icon: "sparkles", size: "sm", attrs: html`data-call="${gi}" ${c.favour[gi] ? "" : "disabled"}` })}</div>`,
        )}</div>
        ${rule("Calling: roll D6, success if ≤ your FP (success clears that god's FP). Once per level. Below 1 (with modifiers) also brings the god's gift.")}`,
      { eyebrow: "The gods", title: "Favour", titleIcon: "sparkles" },
    );

    // ----- the tabbed panel: only the open tab is drawn -----
    const tabBody: Record<DSheetTab, () => Raw> = {
      items: () => html`${card(
        html`<div class="grid">
          ${stepper("gc", c.gc, { label: "Gold (GC)", min: 0 })}
          ${stepper("sc", c.sc, { label: "Silver (SC)", min: 0 })}
          ${stepper("cc", c.cc, { label: "Copper (CC)", min: 0 })}
          ${stepper("rations", c.rations, { label: "Rations", min: 0 })}
        </div>
        <div class="step-actions">${button("Change up coins", { icon: "coins", size: "sm", attrs: html`data-act="coins" title="10 CC = 1 SC, 10 SC = 1 GC"` })}</div>
        <h4 class="sheet-sub">Magic potions ${count("max 5")}</h4>
        ${rows("potions", ["Potion", "Effect"], 5, potionP, true)}
        ${adder("potions", "Find and add a potion", 5)}`,
        { eyebrow: "Purse", title: "Coins & supplies", titleIcon: "coins" },
      )}
      ${card(
        html`<h4 class="sheet-sub">Large &amp; heavy items ${count("max 10")}</h4>
        ${packList("large")}
        <div class="ds-add">${button("Find and add a large item", { icon: "plus", size: "sm", attrs: html`data-act="pack-add" data-list="large" ${c.large.every((v) => v.trim()) ? "disabled" : ""}` })}<span class="sheet-count">${c.large.filter((v) => v.trim()).length} / ${c.large.length} used</span></div>
        <details class="sheet-more pack-edit"><summary>Edit the slots as text</summary>
          <div class="rows large-rows">${c.large.map((v, i) => html`<div class="row"><input data-large="${i}" placeholder="${i + 1}." value="${v}"></div>`)}</div></details>
        <h4 class="sheet-sub">Small items ${count("unlimited; lock picks go here")}</h4>
        ${packList("small")}
        <div class="ds-add">${button("Find and add a small item", { icon: "plus", size: "sm", attrs: html`data-act="pack-add" data-list="small"` })}</div>
        <details class="sheet-more pack-edit"><summary>Edit as text</summary><label class="field">One per line<textarea data-k="small">${c.small}</textarea></label></details>
        <h4 class="sheet-sub">Treasure ${count("gems etc.")}</h4>
        ${packList("treasure")}
        <div class="ds-add">${button("Find and add treasure", { icon: "plus", size: "sm", attrs: html`data-act="pack-add" data-list="treasure"` })}</div>
        <details class="sheet-more pack-edit"><summary>Edit as text</summary><label class="field">One per line<textarea data-k="treasure">${c.treasure}</textarea></label></details>
        ${c.equipped?.length ? html`<p class="muted sheet-hint">Equipped: ${c.equipped.map((x) => `${x.name}${modsText(x.mods) ? ` (${modsText(x.mods)})` : ""}`).join(", ")}.</p>` : ""}`,
        { eyebrow: "Carried", title: "Pack", titleIcon: "backpack" },
      )}`,

      story: () => html`${card(
        html`<div class="notes-grid">
          <label class="field">Side quests<textarea data-k="quests">${c.quests}</textarea></label>
          <label class="field">Narrative moments<textarea data-k="narrative">${c.narrative}</textarea></label>
        </div>`,
        { eyebrow: "Story", title: "Quests & story", titleIcon: "flag" },
      )}
      ${card(
        html`<div class="notes-grid">
          <label class="field">Additional notes<textarea data-k="notes">${c.notes}</textarea></label>
          <label class="field">Loot lockup (town storage)<textarea data-k="lockup">${c.lockup}</textarea></label>
        </div>`,
        { eyebrow: "Story", title: "Notes & lockup", titleIcon: "notebook" },
      )}`,

      companion: () => companionCard(c, ctx.byId),
    };

    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow(`Level ${st.level} ${st.title}`)}<h1>${icon("user", { size: 26 })}<span>Character sheet</span></h1></div>
        <div class="play-actions">
          ${button("New character", { icon: "plus", variant: "ghost", attrs: html`data-act="new"` })}
          ${button("Export", { icon: "download", variant: "ghost", attrs: html`data-act="export"` })}
          ${button("Import", { icon: "upload", variant: "ghost", attrs: html`data-act="import"` })}
        </div>
      </header>

      <div class="ds-sheet">
        ${band}
        ${statRow}
        <div class="ds-console">
          <div class="ds-col">${conditions}${prisoners}${armour}${favour}</div>
          <div class="ds-col">${weapon}${runes}${scrolls}</div>
          <div class="ds-panel">
            ${tabsBar([...tabs], cur, html`aria-label="More of the sheet"`)}
            <div class="ds-tab-${cur} ds-tabbody" role="tabpanel" aria-label="${tabs.find((t) => t.id === cur)!.label}">${tabBody[cur]()}</div>
          </div>
        </div>
        <p class="muted sheet-note ds-foot">Saved automatically on this device. Use Export to back it up or move it to your tablet.</p>
      </div>`);
  };

  // a closed tab whose cast was still awaiting dice must not write over the newer saved sheet
  let live = true;
  ctx.onDispose(() => (live = false));
  const commit = (redraw = false) => {
    if (!live) return;
    // Level up: +10 HP now (may exceed baseline); a correction below a threshold takes it back.
    const ch = applyXp(c, c.xp, levelFn(c), baseHpFn(c));
    if (ch.to !== ch.from) {
      if (ch.to > ch.from) playSfx("level-up");
      ctx.toast(levelChangeText(ch, levelTitle(c, ch.to))!);
      redraw = true;
    }
    saveChar(c);
    if (redraw) draw();
  };

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    // an "add from the book" list only holds a choice for its Add button: choosing changes nothing yet
    // (falling through would redraw the sheet and put the list back on its prompt)
    if (el.dataset.add !== undefined) return;
    if (el.dataset.k) {
      (c as any)[el.dataset.k] = el.value;
      if (el.dataset.k === "name") {
        // the header shows the name and its initial: refresh them without redrawing the inputs
        const head = root.querySelector(".char-head");
        const fresh = document.createElement("div");
        setHTML(fresh, charHeader(c, stats(c).level));
        head?.querySelector(".char-name")?.replaceWith(fresh.querySelector(".char-name")!);
        if (!c.portrait) head?.querySelector(".portrait")?.replaceWith(fresh.querySelector(".portrait")!);
      }
    }
    else if (el.dataset.comp) (c.companion ??= {})[el.dataset.comp] = el.value;
    else if (el.dataset.arr) (c as any)[el.dataset.arr][+el.dataset.i!][+el.dataset.j!] = el.value;
    else if (el.dataset.large) c.large[+el.dataset.large] = el.value;
    else if (el.name && el.type === "number") {
      // a typed number waits for "change" (blur or Enter): each keystroke is a half-typed value, and XP 2600
      // typed over 2500 passes through XP 2, which would drop to level 1 and take the HP away. The ± buttons
      // (wireSteppers) send an untrusted "input" with the finished value, so they apply at once.
      if (!e.isTrusted) numberField(el);
      return;
    }
    commit(el.tagName === "SELECT");
  });
  /** Apply a finished number field: clamped to its min/max; XP and the stats that show elsewhere redraw. */
  const numberField = (el: HTMLInputElement) => {
    let v = parseInt(el.value, 10) || 0;
    if (el.min !== "") v = Math.max(+el.min, v);
    if (el.max !== "") v = Math.min(+el.max, v);
    (c as any)[el.name] = v;
    commit(["xp", "hp", "bonusHp", "bonusShift", "bonusDisc", "bonusPrec", "prisoners"].includes(el.name));
  };
  root.addEventListener("change", async (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.compAnimal !== undefined || el.dataset.compTemp !== undefined) {
      const k = c.companion ?? {};
      const pick = (sel: string) => root.querySelector<HTMLSelectElement>(sel)?.value ?? "";
      const a = animals(ctx.byId).find((x) => x.name === (pick("[data-comp-animal]") || k.kind));
      const t = temperaments(ctx.byId).find((x) => x.name === pick("[data-comp-temp]"));
      if (a) c.companion = withAnimal(k, a, t);
      else if (t) c.companion = { ...k, temperament: `${t.name} (${t.modifier}): ${t.effect}` };
      return commit(true);
    }
    const exp = el.dataset.exp as Expansion | undefined;
    if (exp && (EXPANSIONS as readonly string[]).includes(exp)) {
      c.expansions = { ...c.expansions, [exp]: el.checked };
      return commit();
    }
    if (el.name && el.type === "number") return numberField(el);
    if (el.dataset.portraitFile != null) {
      const f = el.files?.[0];
      el.value = "";
      if (!f) return;
      let pic: string;
      try {
        pic = await portraitFromFile(f);
      } catch {
        return ctx.toast(`That file isn't a picture ${here()} can open.`);
      }
      if (!live) return;
      // a failed save puts the old picture back, so later saves don't keep carrying the new one
      if (!setPortrait(c, pic, (x) => saveChar(x), () => loadChar().portrait))
        ctx.toast("Couldn't save the picture on this device (storage is full). Try a smaller image.");
      draw();
      return;
    }
    if (el.type !== "checkbox") return;
    const n = +el.dataset.n!;
    if (el.dataset.box) {
      const k = el.dataset.box as "bloodied" | "soaked";
      c[k] = el.checked ? n : n - 1;
    } else if (el.dataset.fp) {
      const g = +el.dataset.fp;
      c.favour[g] = el.checked ? n : n - 1;
    } else if (el.dataset.legend) c.legend[+el.dataset.legend] = el.checked;
    commit(true);
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.tab && isDSheetTab(b.dataset.tab)) return showTab(b.dataset.tab);
    if (b.dataset.pick) {
      let pic: string;
      try {
        pic = await portraitFromUrl(portraitUrl(b.dataset.pick));
      } catch {
        return ctx.toast("Couldn't load that portrait.");
      }
      if (!live) return;
      if (!setPortrait(c, pic, (x) => saveChar(x), () => loadChar().portrait))
        ctx.toast("Couldn't save the picture on this device (storage is full).");
      gallery = false;
      draw();
      root.querySelector<HTMLElement>('[data-act="gallery"]')?.focus();
      return;
    }
    if (b.dataset.act === "gallery") {
      gallery = !gallery;
      draw();
      root.querySelector<HTMLElement>('[data-act="gallery"]')?.focus();
    } else if (b.dataset.act === "portrait") root.querySelector<HTMLInputElement>("[data-portrait-file]")?.click();
    else if (b.dataset.act === "no-portrait") {
      delete c.portrait;
      saveChar(c);
      draw();
      root.querySelector<HTMLElement>('[data-act="portrait"]')?.focus();
    } else if (b.dataset.act === "new") {
      // a new roster entry: this character stays as it is, in the Characters list
      if (!(await startNewAdventurer(ctx.byId))) ctx.toast("Couldn't make a new character: this device's storage is full.");
    } else if (b.dataset.act === "export") exportJSON(`character-${c.name || "adventurer"}`, c);
    else if (b.dataset.act === "import") {
      const d = await importJSON(validateCharacter);
      if (d && live) {
        c = { ...blankCharacter(), ...d };
        c.lastLevel = importedLastLevel({ xp: c.xp, lastLevel: d.lastLevel }, levelFn(c)); // a file without it mustn't grant level-up HP
        saveChar(c, "sheet-import");
        draw();
      }
    } else if (b.dataset.act === "comp-temp") {
      const temps = temperaments(ctx.byId);
      const r = await rollDice("D6");
      if (!live) return;
      const t = temps.find((x) => x.roll === r.value);
      if (!t) return;
      const k = c.companion ?? {};
      const a = animals(ctx.byId).find((x) => x.name === k.kind);
      c.companion = a ? withAnimal(k, a, t) : { ...k, temperament: `${t.name} (${t.modifier}): ${t.effect}` };
      ctx.toast(`Temperament: rolled ${r.value}, ${t.name}.${a ? "" : " Choose an animal to apply its modifier."}`);
      commit(true);
    } else if (b.dataset.act === "share") {
      const comp = c.companion ?? (c.companion = {});
      const d = await askNumber("Damage you took outside combat? Up to half can go to your companion.", 0);
      if (d === null || d <= 0) return;
      const r = shareDamage(d, whole(comp.hp));
      c.hp = Math.max(0, c.hp - r.you);
      comp.hp = String(whole(comp.hp) - r.companion);
      ctx.toast(`You take ${r.you}, your companion takes ${r.companion}.`);
      commit(true);
    } else if (b.dataset.act === "add-row") {
      const kind = b.dataset.kind as "armour" | "scrolls" | "potions" | "appliedRunes";
      const picks = kind === "armour" ? armourPicks(ctx.byId) : kind === "scrolls" ? scrollPicks(ctx.byId) : kind === "appliedRunes" ? runePicks(ctx.byId) : potionPicks(ctx.byId);
      const noun = kind === "armour" ? "armour" : kind === "scrolls" ? "scroll" : kind === "appliedRunes" ? "rune" : "potion";
      const rowsN = kind === "potions" || kind === "appliedRunes" ? 5 : 3;
      openPicker({
        title: kind === "armour" ? "Add armour" : kind === "scrolls" ? "Add a scroll" : kind === "appliedRunes" ? "Add a rune" : "Add a potion",
        noun: kind === "armour" ? "armour" : `${noun}s`,
        choices: picks.map((p, i) => ({ id: String(i), name: p.row[0], meta: p.label.split(" · ").slice(1).join(" · "), detail: kind === "scrolls" ? p.row[3] ?? "" : kind === "potions" ? p.row[1] ?? "" : kind === "appliedRunes" ? p.row[2] ?? "" : "" })), // the effect; armour's dice, modifier and cost are already its meta
        emptyNote: "This list is read from the book's table. Unlock the book in Settings → Books, or type into the rows.",
        onPick: (ch) => {
          const rowsOf = c[kind] as string[][];
          if (rowsOf.slice(0, rowsN).every((r) => r[0]?.trim())) return `Every ${noun} row is full (${rowsN} / ${rowsN}). Clear one first.`;
          fillFirstEmpty(rowsOf, picks[+ch.id].row);
          commit(true);
          return null;
        },
      });
    } else if (b.dataset.equip) {
      const r = equipToggle(c.equipped, b.dataset.equip);
      if (!r) return;
      c.equipped = r.list;
      ctx.toast(r.msg);
      commit(true);
    } else if (b.dataset.packDel) {
      const [list, i] = b.dataset.packDel.split("|") as ["large" | "small" | "treasure", string];
      if (list === "large") c.large[+i] = "";
      else c[list] = joinItems(splitItems(c[list]).filter((_v, j) => j !== +i));
      commit(true);
    } else if (b.dataset.act === "pack-add") {
      const list = b.dataset.list as "large" | "small" | "treasure";
      const kinds: Record<typeof list, ItemCat[]> = { large: ["weapon", "armour", "gear", "magic"], small: ["gear", "magic", "potion", "scroll", "ammo"], treasure: ["gem", "magic", "gear"] };
      const put = (name: string): string | null => {
        if (list === "large") {
          const i = c.large.findIndex((v) => !v.trim());
          if (i < 0) return `All ${c.large.length} large item slots are full. Drop something first.`;
          c.large[i] = name;
        } else c[list] = addLine(c[list], name);
        commit(true);
        return null;
      };
      openPicker({
        title: list === "large" ? "Add a large item" : list === "small" ? "Add a small item" : "Add treasure",
        noun: list === "treasure" ? "treasure" : "items",
        choices: itemChoices(itemEntries(lib.sections), kinds[list]),
        emptyNote: "Items are read from the books you have open. Unlock a book in Settings → Books, or type the item in.",
        onPick: (ch) => put(ch.name),
        custom: put,
      });
    } else if (b.dataset.act === "return-town") {
      // back in town: roll the Liberating Prisoners table once per tally, then erase the tallies
      const n = c.prisoners;
      if (!n) return;
      const ref = tableBySection("core/liberating-prisoners");
      if (!ref) return ctx.toast("The Liberating Prisoners table isn't in your books. Unlock the book in Settings → Books, then try again. The tallies stay.");
      for (let i = 0; i < n; i++) {
        if (!live) return;
        await rollAndLog(ref, 0, undefined, `Liberated prisoner ${i + 1} of ${n}, back in town`);
      }
      c.prisoners = 0;
      ctx.toast(`${n} prisoner${n === 1 ? "" : "s"} back in town: rolled for each, and the tallies are erased.`);
      commit(true);
    } else if (b.dataset.act === "coins") {
      c.sc += Math.floor(c.cc / 10);
      c.cc %= 10;
      c.gc += Math.floor(c.sc / 10);
      c.sc %= 10;
      commit(true);
    } else if (b.dataset.heal) {
      const base = stats(c).baseline;
      c.hp = b.dataset.heal === "baseline" ? Math.max(c.hp, base) : Math.max(c.hp, Math.min(base, c.hp + 10));
      commit(true);
    } else if (b.dataset.clear) {
      c[b.dataset.clear as "bloodied" | "soaked"] = 0;
      commit(true);
    } else if (b.dataset.learn) {
      const m = b.dataset.learn.match(/^(\[\d\]\[\d\])\s*-\s*(.+?)\s*=\s*(.+)$/);
      if (m && c.manoeuvres.some((r) => r[0] === m[2])) return ctx.toast(`You already know ${m[2]}.`);
      const slot = c.manoeuvres.findIndex((r) => !r[0]);
      if (slot < 0) return ctx.toast("All 3 manoeuvre slots are full. Clear one first.");
      c.manoeuvres[slot] = m ? [m[2], m[1], m[3]] : [b.dataset.learn, "", ""];
      commit(true);
    } else if (b.dataset.call) {
      const g = +b.dataset.call;
      const mod = await askNumber("Any modifier to the favour roll? (e.g. -2 at a mural)", 0);
      if (mod === null || !live) return;
      const r = await rollDice("D6");
      const total = r.value + mod;
      const ok = total <= c.favour[g];
      if (ok) playSfx("favour");
      ctx.toast(`${GODS[g]}: rolled ${r.value}${mod ? ` ${sign(mod)} = ${total}` : ""}. ${ok ? (total < 1 ? "Success, and the god appears with a gift!" : "Favour granted!") : "No answer (FP kept)."}`);
      if (ok) c.favour[g] = 0;
      commit(true);
    } else if (b.dataset.cast) {
      const s = c.scrolls[+b.dataset.cast];
      const r = await rollDice("D66");
      const [p, q] = r.dice;
      const dispel = (s[2] || "").match(/\[(\d)\]\[(\d)\]|\b(\d)s?\b/g)?.map((x) => x.replace(/\D/g, "")[0]) ?? [];
      const isDouble = p === q;
      const dispelled = isDouble && dispel.includes(String(p));
      c.xp += 5 * stats(c).level;
      playSfx(isDouble && !dispelled ? "scroll-cast" : "scroll-fail");
      ctx.toast(`${s[0]}: rolled ${p} and ${q}. ${isDouble && !dispelled ? (p === 6 ? "Cast! Double 6: double damage." : p === 1 ? "Cast, but double 1: half damage." : "Cast succeeds!") : dispelled ? "Dispel double: it fails." : "Not a double. Shift with Discipline, or it fails."}`);
      if (!isDouble || dispelled) {
        const ref = tableBySection("codex/ftcct1-failed-to-cast-correctly-table-1");
        if (ref && confirm("Did the cast fail? Roll on FTCCT1 (Failed To Cast Correctly)?")) await rollAndLog(ref, 0, undefined, `Failed cast: ${s[0]}`);
      }
      // the scroll is used up either way
      if (confirm(`Remove ${s[0]} from your sheet? (scrolls are used up even if the cast fails)`)) c.scrolls[+b.dataset.cast] = ["", "", "", ""];
      commit(true);
    }
  });
  const showTab = (t: DSheetTab) => {
    tab = t;
    writeState(TAB_KEY, tab);
    draw();
    root.querySelector<HTMLElement>(`.ds-panel [data-tab="${tab}"]`)?.focus();
  };
  root.addEventListener("keydown", (e) => {
    const on = (e.target as HTMLElement).closest<HTMLElement>(".ds-panel .tab");
    const next = on && isDSheetTab(on.dataset.tab) ? stepIn(dsheetTabs(hasExpansion(c, "companions")).map((t) => t.id), on.dataset.tab, e.key) : null;
    if (!next) return;
    e.preventDefault();
    showTab(next);
  });
  // "toggle" does not bubble, so it is caught on the way down
  root.addEventListener(
    "toggle",
    (e) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLDetailsElement && el.classList.contains("ds-edit")) editOpen = el.open;
    },
    true,
  );

  wireSteppers(root);
  wireHoverTips(root, ctx.onDispose);
  wireItemCards(root, ctx);
  // another tool or panel changed the character: show it (our own saves are already on screen)
  ctx.onDispose(
    bus.on("character:changed", ({ source }) => {
      if (source === "sheet") return;
      c = loadChar();
      draw();
    }),
  );
  draw();
  makeCardsArrangeable(root, "2d6:shell:panes:sheet", ctx.onDispose);
}
