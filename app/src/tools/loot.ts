// What a won fight leaves to do, and putting what you find on the character sheet. Shared by 2D6 Dungeon's and
// 2D6 Void's Combat (afterFight, noteFind); reading coins and potions is 2D6 Dungeon's (readFind, addFind). Plain
// functions: Combat rolls the dice and draws the steps. A treasure result is free text from a table, so it is
// read for what the sheet has a place for: coins (GC / SC / CC, as dice or a flat amount), potions by name, and
// anything else as a line under small items (valuables such as gems and pearls under treasure).
import { lootIn, lootLine, splitLoot } from "./gear";

export type Coin = "gc" | "sc" | "cc";
/** Coins a text gives: the dice to roll ("" for none), a flat part, and how the book writes it. */
export interface CoinFind { dice: string; flat: number; coin: Coin; label: string }
export interface Find { nothing: boolean; coins: CoinFind[]; potions: string[]; note: string; valuable: boolean }

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, "of");
const VALUABLE = /\b(pearls?|gems?|jewels?|jewell?ery|rub(?:y|ies)|emeralds?|sapphires?|diamonds?|necklaces?|LQ|MQ|HQ)\b/i;

/** What a treasure result (or a creature's own treasure line, with its table rolls taken out) gives. */
export function readFind(text: string): Find {
  const t = (text ?? "").replace(/\{[^}]*\}/g, "").trim(); // "{highlighted in red}" and the like are print notes
  const coins: CoinFind[] = [];
  for (const m of t.matchAll(/(?<![A-Za-z0-9])(\d*D\d+(?:\s*[+-]\s*\d+)?|\d+)\s*(GC|SC|CC)\b/gi)) {
    const amount = m[1].replace(/\s/g, "").toUpperCase();
    const d = /^(\d*D\d+)([+-]\d+)?$/.exec(amount);
    coins.push({ dice: d ? d[1] : "", flat: d ? (d[2] ? parseInt(d[2], 10) : 0) : parseInt(amount, 10), coin: m[2].toLowerCase() as Coin, label: `${amount} ${m[2].toUpperCase()}` });
  }
  const potions = [...t.matchAll(/\bpotion of ([A-Za-z]+(?: [A-Za-z]+){0,2}?)(?=\s*(?:[.,;]|$|\band\b))/gi)].map((m) => titleCase(`Potion of ${m[1]}`));
  const nothing = !coins.length && !potions.length && (!t || /^(nothing|none)\b/i.test(t));
  const note = nothing || coins.length || potions.length ? "" : t;
  return { nothing, coins, potions, note, valuable: !!note && VALUABLE.test(note) };
}

/** The part of a character sheet loot goes into. */
export interface Pack { gc: number; sc: number; cc: number; potions: string[][]; small: string; treasure: string }
const addLine = (text: unknown, line: string) => (typeof text === "string" && text.trim() ? `${text.replace(/\s+$/, "")}\n${line}` : line);

/**
 * Put a find on the sheet. `amounts`: the total for each of the find's coins, in order (dice already rolled,
 * flat part included). Returns a line for each thing added, to show the player.
 */
export function addFind(c: Pack, f: Find, amounts: number[]): string[] {
  const out: string[] = [];
  f.coins.forEach((k, i) => {
    const n = Math.max(0, Math.floor(Number(amounts[i]) || 0));
    c[k.coin] = (Number.isFinite(c[k.coin]) && typeof c[k.coin] === "number" ? c[k.coin] : 0) + n;
    out.push(`+${n} ${k.coin.toUpperCase()}`);
  });
  for (const p of f.potions) {
    const row = Array.isArray(c.potions) ? c.potions.find((r) => Array.isArray(r) && !String(r[0] ?? "").trim()) : undefined;
    if (row) {
      row[0] = p;
      row[1] = "";
      out.push(`${p}, with your potions`);
    } else {
      c.small = addLine(c.small, p);
      out.push(`${p}, under small items (no room: 5 potions is the most you can carry)`);
    }
  }
  if (f.note) {
    const items = f.valuable ? [] : findItems(f.note);
    if (items.length) out.push(...addLoot(c, items));
    else {
      if (f.valuable) c.treasure = addLine(c.treasure, f.note);
      else c.small = addLine(c.small, f.note);
      out.push(f.valuable ? "Noted under treasure" : "Noted under small items");
    }
  }
  return out;
}

/** The separate items a find names: "a coil of wire and two spanners" → ["Coil of wire", "Spanners ×2"]; [] when it's a description, not a list. */
function findItems(t: string): string[] {
  const said = lootIn(t);
  if (said.length) return said;
  if (t.length > 80 || /[.!?;:]\s/.test(t)) return []; // a sentence or more: keep it whole
  return splitLoot(t).map(lootLine);
}

/** Put found items under small items, one line each. Returns what to tell the player. */
export function addLoot(c: { small: string }, items: readonly string[]): string[] {
  for (const it of items) c.small = addLine(c.small, it);
  return items.length ? [`Added to small items: ${items.join(", ")}`] : [];
}

/** Write a find under small items (2D6 Void's caches are things, not coins): one line per item when the text lists
 *  them, else the text as one line. Returns what to tell the player. */
export function noteFind(c: { small: string }, text: string): string[] {
  const t = (text ?? "").replace(/\{[^}]*\}/g, "").trim();
  if (!t || /^(nothing|none)\b/i.test(t)) return [];
  const items = findItems(t);
  if (items.length) return addLoot(c, items);
  c.small = addLine(c.small, t);
  return ["Noted under small items"];
}

/** A table a text says to roll: its code, any modifier, and whether its book is still locked. */
export interface TableRef { code: string; modifier: number; locked?: boolean }
/** What was rolled or added for a finished step. */
export interface Done { text: string; added: string[] }
export interface AfterStep {
  key: string;
  kind: "xp" | "table" | "coins" | "item";
  foe?: string;
  label: string;
  code?: string;
  modifier?: number;
  locked?: boolean;
  /** For "coins" and "item": the creature's treasure text with its table rolls taken out. */
  text?: string;
  done: boolean;
  result?: Done;
}

/**
 * What is left to do after a won fight, in order: the XP, then each foe's treasure (its table rolls, any extra
 * coins its card gives, or the thing itself when the card names one). `tablesIn` finds the tables a text names.
 */
export function afterFight(foes: { id: number; name: string; treasure: string }[], tablesIn: (text: string) => TableRef[], xpBanked: boolean, done: Record<string, Done>): AfterStep[] {
  const steps: AfterStep[] = [{ key: "xp", kind: "xp", label: "Add the XP to your sheet", done: xpBanked }];
  for (const f of foes) {
    const t = (f.treasure ?? "").trim();
    if (!t || /^none\.?$/i.test(t)) continue;
    const tables = tablesIn(t);
    for (const r of tables) {
      const key = `${f.id}:t:${r.code}`;
      if (steps.some((s) => s.key === key)) continue;
      steps.push({ key, kind: "table", foe: f.name, label: `Roll ${r.code}${r.modifier ? (r.modifier > 0 ? ` +${r.modifier}` : ` ${r.modifier}`) : ""}`, code: r.code, modifier: r.modifier, locked: r.locked, done: !!done[key], result: done[key] });
    }
    // what the card gives besides its tables: "…and an extra D6 GC", "+ 2D6 SC", or a thing ("D3 Geist Mushrooms.")
    let rest = t.replace(/\{[^}]*\}/g, "");
    for (const r of tables) rest = rest.replace(new RegExp(`\\b${r.code}\\b(\\s*[+-]\\s?\\d+(?!\\s*(?:GC|SC|CC)))?`, "g"), " ");
    const find = readFind(rest);
    if (find.coins.length) {
      const key = `${f.id}:c`;
      steps.push({ key, kind: "coins", foe: f.name, label: `${find.coins.some((k) => k.dice) ? "Roll" : "Add"} ${find.coins.map((k) => k.label).join(" and ")}`, text: rest, done: !!done[key], result: done[key] });
    } else {
      // a thing: the whole line when there is no table ("D3 Geist Mushrooms."), or what is named beside one ("…and some Electrical Parts")
      const thing = tables.length ? rest.replace(/\broll on\b|\band\b|\ban extra\b/gi, " ").replace(/\s+/g, " ").replace(/^[\s.,;:+-]+|[\s.,;:+-]+$/g, "") : t;
      if (thing && /[A-Za-z]/.test(thing) && !readFind(thing).nothing) {
        const key = `${f.id}:i`;
        steps.push({ key, kind: "item", foe: f.name, label: "Add it to your sheet", text: thing, done: !!done[key], result: done[key] });
      }
    }
  }
  return steps;
}
