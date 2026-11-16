// The Items page's data: every named item in the open books (weapons, armour, potions, scrolls, magic items,
// gems, stims, ammo, artefacts, gear, upgrades) as one flat list. DOM-free so it can be tested.
// Nothing here is book text: the rules only know the SHAPES of the books' tables (their column headings and
// titles). Names, costs and effects are read from the tables at run time, so a locked book adds nothing.
import type { Section, Table } from "../types";
import type { IconName } from "../ui/icon";
import type { PickChoice } from "../ui/pickmodel";

export type ItemCat = "weapon" | "armour" | "potion" | "scroll" | "magic" | "gem" | "stim" | "ammo" | "artefact" | "gear" | "upgrade";
export const CATS: { id: ItemCat; label: string; icon: IconName }[] = [
  { id: "weapon", label: "Weapons", icon: "swords" },
  { id: "armour", label: "Armour", icon: "shield" },
  { id: "potion", label: "Potions", icon: "droplet" },
  { id: "scroll", label: "Scrolls", icon: "scroll" },
  { id: "magic", label: "Magic items", icon: "wand-sparkles" },
  { id: "stim", label: "Stims", icon: "zap" },
  { id: "ammo", label: "Ammo", icon: "crosshair" },
  { id: "gem", label: "Gems", icon: "gem" },
  { id: "artefact", label: "Artefacts", icon: "sparkles" },
  { id: "gear", label: "Gear and loot", icon: "backpack" },
  { id: "upgrade", label: "Upgrades", icon: "hammer" },
];
export const catOf = (id: ItemCat) => CATS.find((c) => c.id === id)!;

export interface ItemEntry {
  /** Unique and stable: category and normalised name. */
  key: string;
  name: string;
  cat: ItemCat;
  /** Where it is described in full (the first book that has it). */
  book: string;
  sectionId: string;
  page: number;
  /** Price, "" when none is printed. */
  cost: string;
  /** Labelled details, one per column of its table. */
  lines: [string, string][];
  /** Free text (a description from a roll table). */
  text: string;
  /** Table codes whose rolls can turn it up. */
  foundOn: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const titleCase = (s: string) => clean(s).toLowerCase().replace(/(^|[\s(/"-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\bOf\b/g, "of").replace(/\bThe\b(?!$)/g, "the").replace(/\bAnd\b/g, "and");
const norm = (s: string) => s.toLowerCase().replace(/['‘’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(a|an|the|some) /, "");
const lc = (s: string) => clean(s).toLowerCase();

/** One item being collected. */
type Draft = Omit<ItemEntry, "key">;

function put(map: Map<string, ItemEntry>, d: Draft): void {
  const name = clean(d.name);
  if (!name) return;
  const key = `${d.cat}|${norm(name)}`;
  const have = map.get(key);
  if (!have) { map.set(key, { ...d, name, key, foundOn: [...new Set(d.foundOn)] }); return; }
  for (const c of d.foundOn) if (!have.foundOn.includes(c)) have.foundOn.push(c);
  if (!have.cost && d.cost) have.cost = d.cost;
  if (!have.lines.length && d.lines.length) { have.lines = d.lines; have.book = d.book; have.sectionId = d.sectionId; have.page = d.page; }
  if (!have.text && d.text) have.text = d.text;
}

/** Details from a table row: every column but the name (and the price) as a labelled line. */
function lines(t: Table, r: string[], skip: number[]): [string, string][] {
  const out: [string, string][] = [];
  t.columns.forEach((c, i) => {
    if (skip.includes(i)) return;
    const v = clean(r[i] ?? "");
    if (v && c.trim()) out.push([titleCase(c), v]);
  });
  return out;
}

const costCol = (h: string[]) => h.findIndex((c) => /^(cost|price)\b|cost to buy/.test(c));

/** The category a roll table's title points at, or "" when its rows are not items. */
function rollCat(title: string): ItemCat | "loot" | "" {
  const t = title.toLowerCase();
  if (/potion|stim\b/.test(t)) return /stim/.test(t) ? "stim" : "potion";
  if (/scroll/.test(t)) return "scroll";
  if (/armou?r/.test(t)) return "armour";
  if (/\bgems?\b/.test(t)) return "gem";
  if (/amulet|\bring|wand|magic(al)? item|magic object|low magic item/.test(t)) return "magic";
  if (/ammo/.test(t)) return "ammo";
  if (/artefact|artifact|relic/.test(t)) return "artefact";
  if (/weapon|grenade|impact/.test(t)) return "weapon";
  if (/\bitems?\b|equipment|worship|utility|wrecked|shiney|shiny/.test(t)) return "gear";
  if (/loot|treasure|stash|hoard|sack|urn|sarcophagus|\bbag|chest|search|cargo/.test(t)) return "loot";
  return "";
}

const NOT_AN_ITEM = /^(nothing|roll\b|there\b|you\b|it\b|the\b|this\b|some of|an? (small|large) (box|bag)|see\b)/i;

/** A roll table's row as an item: "Name - description" or a short bare name; null for a narrative find. */
function rollRow(text: string): { name: string; text: string; cost: string } | null {
  const s = clean(text);
  if (!s) return null;
  const dash = s.match(/^(.{2,60}?)\s+[-–—]\s+(.+)$/);
  if (dash && !/\b(you|there)\b/i.test(dash[1]) && dash[1].split(" ").length <= 7) return { name: dash[1], text: dash[2], cost: "" };
  if (NOT_AN_ITEM.test(s) || /[.!?]/.test(s) || s.split(" ").length > 7) return null;
  const worth = s.match(/^(.+?)\s+worth\s+(.+)$/i);
  return worth ? { name: worth[1], text: "", cost: worth[2] } : { name: s, text: "", cost: "" };
}

/**
 * Is this table an item catalog: one the Items page reads its entries from (a price list, a ranged weapon card, a
 * weapon's manoeuvre column)? The Tables page leaves these out, as the Items page already shows them. Roll tables
 * that only name items ("ART1 - ARMOUR - RANDOM") are not catalogs: they are rolled, so they stay on Tables.
 * Keep in step with the catalog branches of itemEntries (test/tablesmodel.test.ts checks they agree).
 */
export function isItemCatalogTable(t: Table): boolean {
  if (!t.rows.length || /character sheet/i.test(t.title ?? "")) return false;
  const h = t.columns.map(lc);
  if (h.join("|") === "field|value" && t.rows.some((r) => lc(r[0] ?? "") === "round damage")) return true;
  if (t.columns.some((c) => /^weapon:?\s+(.+)$/i.test(c))) return true;
  const c0 = h[0] ?? "";
  if (/enhancement|extra impact|legendary manoeuvre|mythical/i.test(t.title ?? "") && ["enhancement", "legendary manoeuvre", "extra impact", "potion", "potion bomb"].includes(c0)) return true;
  return (
    (h.includes("dice set") && (c0 === "armour" || c0 === "armour type")) ||
    c0 === "magic item" || c0 === "potion of" || c0 === "medicine" ||
    c0 === "scroll of" || c0 === "scroll type" || (c0 === "scroll" && h.length > 1) ||
    (c0 === "stim type" && h.length > 2) ||
    c0 === "gem type" || (c0 === "gem" && h.length > 1) ||
    c0 === "ranged weapon" ||
    (c0 === "type" && h.includes("ingredients")) ||
    (c0 === "item" && h.includes("effect")) ||
    (c0 === "item" && h.some((c) => /^(cost|price)/.test(c)))
  );
}

/** Every item in these sections. Catalog tables come first (they carry prices and effects), then roll tables add names and where they turn up. */
export function itemEntries(sections: readonly Section[]): ItemEntry[] {
  const map = new Map<string, ItemEntry>();
  const tables: { s: Section; t: Table; page: number }[] = [];
  for (const s of sections) for (const b of s.blocks) if (b.type === "table") tables.push({ s, t: b.table, page: b.page });

  // ---- catalogs
  for (const { s, t, page } of tables) {
    const h = t.columns.map(lc);
    const title = t.title ?? "";
    if (/character sheet/i.test(title)) continue;
    const base = { book: s.book, sectionId: s.id, page, text: "", foundOn: [] as string[] };
    const add = (cat: ItemCat, name: string, r: string[], skip: number[], cost = "", prefix = "") => {
      const n = clean(name);
      if (!n) return;
      const full = prefix && !new RegExp(`^${prefix}\\b`, "i").test(n) ? `${prefix} ${n}` : n;
      put(map, { ...base, name: titleCase(full), cat, cost: clean(cost), lines: lines(t, r, skip) });
    };

    if (h.join("|") === "field|value" && t.rows.some((r) => lc(r[0] ?? "") === "round damage")) { // a ranged weapon's card
      const get = (k: string) => t.rows.find((r) => lc(r[0] ?? "") === k)?.[1] ?? "";
      const name = get("type") || t.title || "";
      put(map, {
        ...base, name: titleCase(name), cat: "weapon", cost: "", text: clean(get("description")),
        lines: t.rows.filter((r) => !/^(type|description)$/i.test(clean(r[0] ?? "")) && clean(r[1] ?? "")).map((r): [string, string] => [titleCase(r[0]), clean(r[1])]),
      });
      continue;
    }
    // a weapon's column in a manoeuvres table: "WEAPON: LONGSWORD"
    const wcols = t.columns.map((c, i) => ({ i, m: c.match(/^weapon:?\s+(.+)$/i) })).filter((x) => x.m);
    if (wcols.length) {
      for (const { i, m } of wcols) {
        const cells = t.rows.map((r) => clean(r[i] ?? "")).filter(Boolean);
        put(map, { ...base, name: titleCase(m![1]), cat: "weapon", cost: "", lines: cells.map((c): [string, string] => ["Manoeuvre", c]) });
      }
      continue;
    }
    if (!t.rows.length) continue;
    const c0 = h[0] ?? "";
    const cc = costCol(h);
    const cost = (r: string[]) => (cc >= 0 ? clean(r[cc] ?? "") : "");
    const each = (fn: (r: string[]) => void) => t.rows.forEach((r) => { if (clean(r[0] ?? "")) fn(r); });

    if (/enhancement|extra impact|legendary manoeuvre|mythical/i.test(title) && ["enhancement", "legendary manoeuvre", "extra impact", "potion", "potion bomb"].includes(c0)) {
      each((r) => add("upgrade", r[0], r, [0], cost(r)));
      continue;
    }
    if (h.includes("dice set") && (c0 === "armour" || c0 === "armour type")) each((r) => add("armour", r[0], r, [0, cc], cost(r)));
    else if (c0 === "magic item") each((r) => add("magic", r[0], r, [0, cc], cost(r)));
    else if (c0 === "potion of") each((r) => add("potion", r[0], r, [0, cc], cost(r), "Potion of"));
    else if (c0 === "medicine") each((r) => add("potion", r[0], r, [0]));
    else if (c0 === "scroll of" || c0 === "scroll type" || (c0 === "scroll" && h.length > 1)) each((r) => add("scroll", r[0], r, [0, cc], cost(r), "Scroll of"));
    else if (c0 === "stim type" && h.length > 2) each((r) => add("stim", r[0], r, [0, cc], cost(r)));
    else if (c0 === "gem type" || (c0 === "gem" && h.length > 1)) each((r) => add("gem", r[0], r, [0, cc]));
    else if (c0 === "ranged weapon") each((r) => add("weapon", r[0], r, [0, cc], cost(r)));
    else if (c0 === "type" && h.includes("ingredients")) each((r) => add(/potion/i.test(title) ? "potion" : "weapon", r[0], r, [0]));
    else if (c0 === "item" && h.includes("effect")) each((r) => add("magic", r[0], r, [0]));
    else if (c0 === "item" && h.some((c) => /^(cost|price)/.test(c))) { // ITEM | COST, possibly side by side twice
      for (let i = 0; i + 1 < h.length; i += 2) {
        if (h[i] !== "item") continue;
        for (const r of t.rows) if (clean(r[i] ?? "")) put(map, { ...base, name: titleCase(r[i]), cat: "gear", cost: clean(r[i + 1] ?? ""), lines: [] });
      }
    }
  }

  // ---- roll tables: names, short descriptions, and which table turns each one up
  for (const { s, t, page } of tables) {
    const h = t.columns.map(lc);
    if (t.columns.length !== 2 || !/^roll/.test(h[0] ?? "") || t.rows.length < 4) continue;
    const code = (t.code ?? "").trim();
    const cat = rollCat(`${t.title ?? ""}`);
    if (!cat) continue;
    for (const r of t.rows) {
      const it = rollRow(r[1] ?? "");
      if (!it) continue;
      if (cat === "loot" && !it.text) continue; // a bare line in a loot table is a find, not an item
      const c = cat === "loot" ? "gear" : cat;
      const name = c === "potion" && !/^potion\b/i.test(it.name) && /potions?\b/i.test(t.title ?? "") && !it.text ? `Potion of ${it.name}` : it.name;
      put(map, { book: s.book, sectionId: s.id, page, name: titleCase(name), cat: c, cost: it.cost, lines: [], text: it.text, foundOn: code ? [code] : [] });
    }
  }
  return [...map.values()];
}

export interface ItemFilter { text: string; cat: ItemCat | ""; book: string }
export const noItemFilter = (): ItemFilter => ({ text: "", cat: "", book: "" });
const catIndex = (c: ItemCat) => CATS.findIndex((x) => x.id === c);

/** The entries that pass the filter, by category then name. */
export function filterItems(all: readonly ItemEntry[], f: ItemFilter): ItemEntry[] {
  const q = f.text.trim().toLowerCase();
  return all
    .filter((e) => (!q || e.name.toLowerCase().includes(q) || e.text.toLowerCase().includes(q)) && (!f.cat || e.cat === f.cat) && (!f.book || e.book === f.book))
    .sort((a, b) => catIndex(a.cat) - catIndex(b.cat) || a.name.localeCompare(b.name));
}
export const itemCats = (all: readonly ItemEntry[]): ItemCat[] => CATS.map((c) => c.id).filter((id) => all.some((e) => e.cat === id));
export const itemBooks = (all: readonly ItemEntry[]): string[] => [...new Set(all.map((e) => e.book))];

/** One line about an entry for a list: its description, else its longest detail. */
const gist = (e: ItemEntry): string => e.text || e.lines.map(([, v]) => v).find((v) => v.length > 12) || e.lines.slice(0, 2).map(([k, v]) => `${k} ${v}`).join(" · ");

/**
 * The entries of these kinds as choices for a sheet's "find and add" picker: grouped by kind (in the Items page's
 * order), priced, with a line on what each is. The picker's group chips appear when more than one kind is asked for.
 */
export function itemChoices(all: readonly ItemEntry[], cats: readonly ItemCat[]): PickChoice[] {
  return filterItems(all, noItemFilter())
    .filter((e) => cats.includes(e.cat))
    .map((e) => ({ id: e.key, name: e.name, meta: e.cost, detail: gist(e), group: catOf(e.cat).label }));
}
