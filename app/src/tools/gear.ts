// Items a character carries, DOM-free and shared by both sheets.
//   findItem(all, name)      the book entry a sheet line names (exact, then the longest entry name inside it)
//   splitItems(text)         a free-text pack list (lines or commas) → item names
//   parseMods(text)          lasting stat bonuses an item's text states ("+1 Shift"), not temporary or conditional ones
//   itemMods(entry)          parseMods over an entry's description and details
//   canEquip(entry?)         kinds that are worn or wielded (not potions, scrolls, stims, ammo or gems)
//   equipped list helpers    isEquipped / toggleEquip / sumMods; the list keeps each item's bonuses, so stats
//                            never need the books
//   splitLoot(text)          "a coil of wire and two spanners" → [{ name: "Coil of wire", qty: 1 }, { name: "Spanners", qty: 2 }]
import type { ItemCat, ItemEntry } from "./itemsmodel";

export type ModStat = "shift" | "disc" | "prec" | "tech" | "coding" | "marks";
export type Mods = Partial<Record<ModStat, number>>;
export interface Equipped { name: string; mods: Mods }

export const MOD_LABEL: Record<ModStat, string> = { shift: "Shift", disc: "Discipline", prec: "Precision", tech: "Technical", coding: "Coding", marks: "Marksmanship" };

export const normItem = (s: string): string =>
  s.toLowerCase().replace(/['‘’]/g, "").replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^(\d+\s*x?|x\s*\d+|a|an|the|some|one|two|three|four|five|six|pair of|a pair of)\s+/, "")
    .replace(/\s+x?\s*\d+$/, "")
    .replace(/s$/, "");

/** Each item list's entries by normalised name, built once per list (the list is rebuilt when the library changes). */
const indexes = new WeakMap<readonly ItemEntry[], Map<string, ItemEntry>>();
function nameIndex(all: readonly ItemEntry[]): Map<string, ItemEntry> {
  let ix = indexes.get(all);
  if (!ix) {
    ix = new Map();
    for (const e of all) {
      const k = normItem(e.name);
      if (k && !ix.has(k)) ix.set(k, e);
    }
    indexes.set(all, ix);
  }
  return ix;
}

/** The entry a sheet line names: the same name (ignoring "a", quantities and plurals), else the longest entry name inside it. */
export function findItem(all: readonly ItemEntry[], name: string): ItemEntry | undefined {
  const n = normItem(name);
  if (n.length < 3) return undefined;
  const ix = nameIndex(all);
  const exact = ix.get(n);
  if (exact) return exact;
  // the longest run of whole words in the line that is an item's name ("broken gauntlets of power" → gauntlets of power)
  const words = n.split(" ");
  for (let len = words.length - 1; len >= 1; len--)
    for (let i = 0; i + len <= words.length; i++) {
      const k = words.slice(i, i + len).join(" ");
      if (k.length >= 4 && ix.has(k)) return ix.get(k);
    }
  return undefined;
}

/** A free-text pack list as item names: one per line, or comma-separated. */
export const splitItems = (text: string): string[] =>
  String(text ?? "").split(/\n|,(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);

/** Join item names back into the free-text list (one per line). */
export const joinItems = (items: readonly string[]): string => items.map((s) => s.trim()).filter(Boolean).join("\n");

const STAT_WORDS: [RegExp, ModStat][] = [
  [/^shift/i, "shift"], [/^discipline/i, "disc"], [/^precision/i, "prec"],
  [/^technical/i, "tech"], [/^coding/i, "coding"], [/^marksmanship/i, "marks"],
];
/** Words that make a bonus temporary or conditional, so it isn't a lasting bonus from wearing the item. */
const PASSING = /\b(for (the |one |1 |\d+ |a )|next|round|turn|combat|level|when|whenever|while|if|against|on (a )?fail|until|once|per|each time|enemy|opponent|foe|target)\b/i;

/** Lasting stat bonuses a text states outright: "+1 Shift", "+1 to Discipline", "Precision +2". */
export function parseMods(text: string): Mods {
  const out: Mods = {};
  // a comma ends a clause too: "+1 Discipline, +1 if you retry" keeps the Discipline and drops the rest
  for (const clause of String(text ?? "").replace(/−/g, "-").split(/[.;,(]|\s[-–—]\s|\)/)) {
    if (PASSING.test(clause)) continue;
    const re = /([+-]\d+)\s*(?:to\s+(?:your\s+)?)?([A-Za-z]+)|([A-Za-z]+)\s*([+-]\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clause))) {
      const word = m[2] ?? m[3];
      const n = +(m[1] ?? m[4]);
      const stat = STAT_WORDS.find(([w]) => w.test(word))?.[1];
      if (stat && n) out[stat] = (out[stat] ?? 0) + n;
    }
  }
  return out;
}

/**
 * An item's lasting bonuses. Its description, name and detail lines often state the same bonus (a roll table's
 * "Gauntlets of Power (+1 Shift)" merged with the catalog's "+1 Shift"), so each stat takes the largest stated
 * value, not the sum.
 */
export const itemMods = (e: ItemEntry): Mods => {
  const fromText = parseMods(e.text);
  const fromName = parseMods(e.name);
  const fromLines = e.lines.filter(([k]) => !/cost|price|damage|dice/i.test(k)).map(([, v]) => parseMods(v));
  return [fromText, fromName, ...fromLines].reduce<Mods>((a, m) => {
    for (const [k, v] of Object.entries(m) as [ModStat, number][]) a[k] = a[k] === undefined || Math.abs(v) > Math.abs(a[k]!) ? v : a[k];
    return a;
  }, {});
};

const EQUIP_CATS: ItemCat[] = ["weapon", "armour", "magic", "artefact", "gear", "upgrade"];
/** Things you wear or wield. An unknown item (typed in, not in the books) can still be marked equipped. */
export const canEquip = (e: ItemEntry | undefined): boolean => !e || EQUIP_CATS.includes(e.cat);

export const isEquipped = (list: readonly Equipped[] | undefined, name: string): boolean =>
  !!list?.some((x) => normItem(x.name) === normItem(name));

/** Equip or unequip `name`; returns the new list. */
export function toggleEquip(list: readonly Equipped[] | undefined, name: string, mods: Mods): Equipped[] {
  const cur = [...(list ?? [])];
  const i = cur.findIndex((x) => normItem(x.name) === normItem(name));
  if (i >= 0) cur.splice(i, 1);
  else cur.push({ name: name.trim(), mods: { ...mods } });
  return cur;
}

/** Drop equipped entries whose item is no longer carried. */
export const pruneEquipped = (list: readonly Equipped[] | undefined, carried: readonly string[]): Equipped[] =>
  (list ?? []).filter((x) => carried.some((n) => normItem(n) === normItem(x.name)));

export function sumMods(list: readonly Equipped[] | undefined): Required<Mods> {
  const s: Required<Mods> = { shift: 0, disc: 0, prec: 0, tech: 0, coding: 0, marks: 0 };
  for (const x of list ?? []) for (const [k, v] of Object.entries(x.mods ?? {}) as [ModStat, number][]) if (k in s && Number.isFinite(v)) s[k] += v;
  return s;
}

/** "+1 Shift, +1 Discipline" for an item's bonuses, "" when none. */
export const modsText = (m: Mods): string =>
  (Object.entries(m) as [ModStat, number][]).filter(([, v]) => v).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${MOD_LABEL[k]}`).join(", ");

/** Where each equipped bonus to `stat` comes from, for a stat's hover card. */
export const modSources = (list: readonly Equipped[] | undefined, stat: ModStat): string[] =>
  (list ?? []).filter((x) => x.mods?.[stat]).map((x) => `${x.mods[stat]! > 0 ? "+" : ""}${x.mods[stat]} from ${x.name}`);

/** Equipped entries as validated from storage or an import. */
export function normaliseEquipped(x: unknown): Equipped[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((e) => {
    if (!e || typeof e !== "object" || typeof (e as Equipped).name !== "string") return [];
    const mods: Mods = {};
    for (const k of Object.keys(MOD_LABEL) as ModStat[]) {
      const v = (e as Equipped).mods?.[k];
      if (typeof v === "number" && Number.isFinite(v)) mods[k] = Math.max(-10, Math.min(10, Math.trunc(v)));
    }
    return [{ name: (e as Equipped).name.slice(0, 200), mods }];
  }).slice(0, 50);
}

// ---------- loot ----------
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, some: 1, several: 2 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A found-items phrase as separate items with quantities: "a coil of wire and two spanners". */
export function splitLoot(text: string): { name: string; qty: number }[] {
  const body = String(text ?? "")
    .replace(/^\s*(you (find|discover|pick up|take|loot|get|gain|receive)|inside (is|are|you find)|there (is|are))\s+/i, "")
    .replace(/[.!]\s*$/, "")
    .replace(/\s+(?:inside|here|within|as well)$/i, "");
  return body
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+(?=(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|some|several|\d+)\b)/i)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => {
      const m = /^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|some|several)\s+(.+)$/i.exec(p);
      const qty = m ? (/^\d+$/.test(m[1]) ? +m[1] : NUMBER_WORDS[m[1].toLowerCase()]) : 1;
      const name = (m ? m[2] : p).trim();
      return name.length > 1 && name.length < 60 ? [{ name: cap(name), qty }] : [];
    });
}

/** One loot item as a pack line: "Dirty rags ×2". */
export const lootLine = (x: { name: string; qty: number }): string => (x.qty > 1 ? `${x.name} ×${x.qty}` : x.name);

/** Words that make a find depend on a roll or a choice (then it isn't added for you). */
const MAYBE = /\b(if|unless|you (?:may|can|could|might)|roll|on (a )?\d|or lower|or higher|instead|choose|either)\b/i; // "a can of" is an item, not a choice
/**
 * The things a room or table result says you find outright: "You find a coil of wire and two spanners."
 * Each as a pack line ("Dirty rags ×2"); [] when the text finds nothing, or only maybe.
 */
export function lootIn(text: string): string[] {
  const out: string[] = [];
  for (const s of String(text ?? "").split(/(?<=[.!?])\s+/)) {
    // only things you are said to take or find, not what a room has in it ("There are hot vents above")
    const m = /\b(?:you (?:find|discover|pick up|take|grab|salvage|recover|loot)|inside (?:is|are|you find))\s+(.+?)[.!]?$/i.exec(s.trim());
    if (!m || MAYBE.test(s)) continue;
    if (/\byou take (?:a (?:deep )?(?:breath|look|moment|step|rest|chance)|cover|aim|\d|damage|hold of (?:it|them))/i.test(s)) continue; // a turn of phrase, not loot
    if (/\b(nothing|no one|empty|enemy|alien|creature|body|bodies|corpse|door|doors|exit|room|corridor|hatch|wall|walls|terminal|console|desk|vats?|air)\b/i.test(m[1])) continue;
    const what = m[1]
      .replace(/\s+(?:that|which|who|containing)\b.*$/i, "") // "…that are dusty but usable"
      .replace(/\s+(?:inside|here|in (?:it|there)|within|as well)$/i, ""); // "…inside"
    for (const x of splitLoot(what)) {
      const name = x.name.replace(/^also\s+(?:an?\s+|some\s+)?/i, "");
      if (/\b(HP|XP|damage|Shift)\b|\b(is|are|it|here|above|upon|on one side)\b|\b[A-Z]{3,}\s+[A-Z]{3,}\b/.test(name) || name.length < 3) continue;
      if (/^(worth|each|enough|of|its?|it[’']s|objects?|things?|items?|something)\b/i.test(name)) continue; // the tail of a sentence, not an item
      out.push(lootLine({ name: name.charAt(0).toUpperCase() + name.slice(1), qty: x.qty }));
    }
  }
  return out;
}
