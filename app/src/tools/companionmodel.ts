// The animal companion, DOM-free: filling the companion sheet from the Companions book's animal and
// temperament tables, and the arithmetic of its combat abilities. Rule wording stays in the imported book;
// this file holds one opaque section id and numbers.
import type { Section, Table } from "../types";

type ById = ReadonlyMap<string, Section>;
/** The companion sheet's fields by key (the character's `companion` record). */
export type Companion = Record<string, string>;

/** The section holding the animal table and the temperament table (Animal Companions p. 7). */
const ANIMAL_SECTION = "companions/p7-3";
const tables = (byId: ById): Table[] => (byId.get(ANIMAL_SECTION)?.blocks ?? []).flatMap((b) => (b.type === "table" ? [b.table] : []));
const col = (t: Table, re: RegExp) => t.columns.findIndex((c) => re.test(c.trim()));

export interface Animal { name: string; size: string; heft: number; stealth: number; hp: number; general: string[]; combat: string[] }
export interface Temperament { roll: number; name: string; modifier: string; effect: string }

const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter((x) => x && !/^(none|-|—)$/i.test(x));
const int = (s: string | undefined) => parseInt(s ?? "", 10) || 0;

/** The ready-made animals, read from the animal table (empty when the book or table isn't there). */
export function animals(byId: ById): Animal[] {
  const t = tables(byId).find((x) => col(x, /^type$/i) === 0 && col(x, /^heft$/i) > 0);
  if (!t) return [];
  const c = { size: col(t, /^size$/i), heft: col(t, /^heft$/i), st: col(t, /^stealth$/i), hp: col(t, /^hp$/i), gen: col(t, /general/i), com: col(t, /combat/i) };
  return t.rows.filter((r) => r[0]?.trim()).map((r) => ({
    name: r[0].trim(), size: r[c.size]?.trim() ?? "", heft: int(r[c.heft]), stealth: int(r[c.st]), hp: int(r[c.hp]), general: list(r[c.gen]), combat: list(r[c.com]),
  }));
}

export function temperaments(byId: ById): Temperament[] {
  const t = tables(byId).find((x) => col(x, /^temperament$/i) > 0);
  if (!t) return [];
  const c = { name: col(t, /^temperament$/i), mod: col(t, /^modifier$/i), eff: col(t, /^effect$/i) };
  return t.rows.map((r) => ({ roll: int(r[0]), name: r[c.name]?.trim() ?? "", modifier: r[c.mod]?.trim() ?? "", effect: r[c.eff]?.trim() ?? "" })).filter((x) => x.name);
}

/** "+2 HE -1 ST" → the change to each stat (HE heft, ST stealth, HP health). */
export function parseModifier(mod: string): { heft: number; stealth: number; hp: number } {
  const out = { heft: 0, stealth: 0, hp: 0 };
  for (const m of mod.matchAll(/([+-−]\s?\d+)\s*(HE|ST|HP)\b/gi)) {
    const v = parseInt(m[1].replace("−", "-").replace(/\s/g, ""), 10);
    const k = m[2].toUpperCase();
    if (k === "HE") out.heft += v;
    else if (k === "ST") out.stealth += v;
    else out.hp += v;
  }
  return out;
}

/**
 * The sheet for a chosen animal: its type, size, stats and abilities (general first, then combat, at level 1),
 * with the temperament's modifier applied when one is given. The name, XP, trait, fears and courage are kept.
 */
export function withAnimal(k: Companion, a: Animal, temp?: Temperament): Companion {
  const mod = parseModifier(temp?.modifier ?? "");
  const hp = Math.max(1, a.hp + mod.hp);
  const out: Companion = { ...k, kind: a.name, size: a.size, heft: String(a.heft + mod.heft), stealth: String(a.stealth + mod.stealth), hp: String(hp), baseHp: String(hp) };
  const abilities: [string, string][] = [...a.general.map((n): [string, string] => [n, "General"]), ...a.combat.map((n): [string, string] => [n, "Combat"])].slice(0, 3);
  for (let i = 1; i <= 3; i++) {
    const ab = abilities[i - 1];
    out[`a${i}name`] = ab?.[0] ?? "";
    out[`a${i}type`] = ab?.[1] ?? "";
    out[`a${i}level`] = ab ? "1" : "";
    if (k[`a${i}name`] !== out[`a${i}name`]) out[`a${i}desc`] = "";
  }
  if (temp) out.temperament = `${temp.name} (${temp.modifier}): ${temp.effect}`;
  return out;
}

export interface CombatAbility { slot: number; name: string; level: number }
/** The companion's combat abilities (the slots whose type says Combat). An ability's level is its uses per combat. */
export function combatAbilities(k: Companion | undefined): CombatAbility[] {
  const out: CombatAbility[] = [];
  for (let i = 1; i <= 3; i++) {
    const name = k?.[`a${i}name`]?.trim();
    if (name && /combat/i.test(k?.[`a${i}type`] ?? "")) out.push({ slot: i, name, level: Math.max(1, int(k?.[`a${i}level`])) });
  }
  return out;
}
/** Is there a living companion to act? */
export const companionReady = (k: Companion | undefined): boolean => !!k && !!(k.name?.trim() || k.kind?.trim()) && int(k.hp) > 0;

/** The attempt roll: the ability goes off when the D6 is higher than the round (rounds past 6 can't be beaten). */
export const attemptSucceeds = (d6: number, round: number): boolean => d6 > round;
/** The companion earns 1 XP for an attempt, whatever the result, against a foe at least the ability's level. */
export const attemptXp = (abilityLevel: number, foeLevel: number): number => (foeLevel >= abilityLevel ? 1 : 0);
/** XP from a foe: half (rounded down) when the companion landed the killing blow. */
export const foeXp = (xp: number, companionKill: boolean): number => (companionKill ? Math.floor(xp / 2) : xp);
