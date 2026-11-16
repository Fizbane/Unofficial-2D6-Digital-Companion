// The character creator's model, DOM-free: the choices a new adventurer makes (docs/spec-dungeon.md §2.2),
// the options for each read from the free Core Rules and Tables Codex tables, and the finished sheet.
import type { Section } from "../types";
import { blankCharacter, type CharClass, type Character, type Expansion } from "./sheet";

type ById = ReadonlyMap<string, Section>;

export const WEAPONS = ["Longsword", "Greataxe", "Heavy Mace"] as const;
/** Level-1 manoeuvres a new character picks. */
export const START_MANOEUVRES = 2;

export interface Manoeuvre { level: number; name: string; dice: string; damage: string }
export interface ArmourOption { name: string; dice: string; modifier: string }
export interface ScrollOption { name: string; summary: string; description: string; duration: string; orbit: string; dispel: string; fail: string; effect: string }

export interface Draft {
  name: string;
  cls: CharClass;
  weapon: string;
  manoeuvres: string[]; // names, at most START_MANOEUVRES, all level 1 of `weapon`
  armour: string;
  scroll: string;
  portrait: string; // gallery id, "" for none
  expansions: Partial<Record<Expansion, boolean>>;
}
export const blankDraft = (): Draft => ({ name: "", cls: "adventurer", weapon: "", manoeuvres: [], armour: "", scroll: "", portrait: "", expansions: {} });

const tableOf = (byId: ById, id: string) => {
  const b = byId.get(id)?.blocks.find((x) => x.type === "table");
  return b && b.type === "table" ? b.table : undefined;
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/** "[1][2] - DISGUISED SWOOP = D6 +2 damage" → its parts. */
export function parseManoeuvre(level: number, cell: string): Manoeuvre | undefined {
  const m = cell.match(/^(\[\d\]\[\d\])\s*-\s*(.+?)\s*=\s*(.+)$/);
  return m ? { level, dice: m[1], name: m[2].trim(), damage: m[3].trim() } : undefined;
}

/** Every manoeuvre of a weapon, from the Codex weapon table (empty when the table or weapon isn't there). */
export function weaponManoeuvres(byId: ById, weapon: string): Manoeuvre[] {
  const t = tableOf(byId, "codex/weapon-manoeuvres-table-1");
  if (!t || !weapon) return [];
  const col = t.columns.findIndex((c) => c.toUpperCase().includes(weapon.toUpperCase()));
  if (col < 0) return [];
  return t.rows.flatMap((r) => {
    const m = parseManoeuvre(+(r[0].match(/Level (\d)/)?.[1] ?? 0), r[col] ?? "");
    return m && m.level ? [m] : [];
  });
}

/** "D6 +2 damage" → its average (5.5), or null when it doesn't parse. */
export function averageDamage(damage: string): number | null {
  const m = damage.replace(/\s/g, "").match(/^(\d*)D6([+-]\d+)?/i);
  if (!m) return null;
  return (+(m[1] || 1)) * 3.5 + (m[2] ? +m[2] : 0);
}

const FALLBACK_ARMOUR: ArmourOption[] = [["Jerkin", "[4]"], ["Padded Tunic", "[5]"], ["Quilted Coat", "[3]"], ["Hide Doublet", "[2]"]].map(([name, dice]) => ({ name, dice, modifier: "-1 Damage" }));
export function armourOptions(byId: ById): ArmourOption[] {
  const t = tableOf(byId, "codex/starting-armour-table-1");
  const rows = t?.rows.filter((r) => r[0]?.trim()).map((r) => ({ name: titleCase(r[0].trim()), dice: r[1] ?? "", modifier: r[2] ?? "" })) ?? [];
  return rows.length ? rows : FALLBACK_ARMOUR;
}

const FALLBACK_SCROLLS = ["Balance", "Mental Whip", "Reflexes", "Melt Metal"];
export function scrollOptions(byId: ById): ScrollOption[] {
  const start = tableOf(byId, "codex/starting-scroll-table-1")?.rows.filter((r) => r[0]?.trim()) ?? [];
  const full = tableOf(byId, "codex/magic-scroll-table-1")?.rows ?? [];
  const names = start.length ? start.map((r) => [r[0].replace(/^SCROLL OF\s+/i, "").trim(), r[1] ?? ""]) : FALLBACK_SCROLLS.map((n) => [n, ""]);
  return names.map(([n, summary]) => {
    const r = full.find((x) => x[0]?.trim().toUpperCase() === n.toUpperCase());
    return { name: titleCase(n), summary, description: r?.[1] ?? "", duration: r?.[2] ?? "", orbit: r?.[3] ?? "", dispel: r?.[4] ?? "", fail: r?.[6] ?? "", effect: r?.[7] ?? summary };
  });
}

/** What is still missing or wrong, in the order the creator shows its steps; empty when the draft can be made. */
export function problems(d: Draft, byId: ById): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("Give your character a name");
  if (!(WEAPONS as readonly string[]).includes(d.weapon)) out.push("Choose a weapon");
  else {
    const l1 = weaponManoeuvres(byId, d.weapon).filter((m) => m.level === 1).map((m) => m.name);
    const ok = d.manoeuvres.filter((n) => l1.includes(n));
    // without the Codex table there is nothing to pick from: the sheet's own list fills them in later
    if (l1.length && ok.length !== START_MANOEUVRES) out.push(`Pick ${START_MANOEUVRES} manoeuvres (${ok.length} chosen)`);
  }
  if (!armourOptions(byId).some((a) => a.name === d.armour)) out.push("Choose a piece of armour");
  if (!scrollOptions(byId).some((s) => s.name === d.scroll)) out.push("Choose a scroll");
  return out;
}

/** Choosing a weapon drops manoeuvres that aren't its own. */
export function withWeapon(d: Draft, weapon: string, byId: ById): Draft {
  const l1 = weaponManoeuvres(byId, weapon).filter((m) => m.level === 1).map((m) => m.name);
  return { ...d, weapon, manoeuvres: d.weapon === weapon ? d.manoeuvres.filter((n) => l1.includes(n)) : [] };
}

/** Tick or untick a manoeuvre; a third pick replaces the oldest, so there are never more than two. */
export function toggleManoeuvre(d: Draft, name: string): Draft {
  const has = d.manoeuvres.includes(name);
  const next = has ? d.manoeuvres.filter((n) => n !== name) : [...d.manoeuvres, name].slice(-START_MANOEUVRES);
  return { ...d, manoeuvres: next };
}

/** The finished sheet: the draft's choices on top of a blank character's starting gear, potion and rations. */
export function buildCharacter(d: Draft, byId: ById): Character {
  const c = blankCharacter();
  c.name = d.name.trim().slice(0, 200);
  c.class = d.cls;
  c.expansions = { ...d.expansions };
  c.weapon = (WEAPONS as readonly string[]).includes(d.weapon) ? d.weapon : WEAPONS[0];
  const all = weaponManoeuvres(byId, c.weapon);
  d.manoeuvres.slice(0, START_MANOEUVRES).forEach((n, i) => {
    const m = all.find((x) => x.name === n && x.level === 1);
    if (m) c.manoeuvres[i] = [m.name, m.dice, m.damage];
  });
  const a = armourOptions(byId).find((x) => x.name === d.armour) ?? armourOptions(byId)[0];
  c.armour[0] = [a.name, a.dice, a.modifier];
  const s = scrollOptions(byId).find((x) => x.name === d.scroll) ?? scrollOptions(byId)[0];
  c.scrolls[0] = [`Scroll of ${s.name.toUpperCase()}`, s.orbit, s.dispel, s.effect];
  return c;
}

/** A complete random draft (the name and portrait are kept). */
export function randomDraft(d: Draft, byId: ById, rnd: () => number = Math.random): Draft {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const weapon = pick(WEAPONS);
  const l1 = weaponManoeuvres(byId, weapon).filter((m) => m.level === 1).map((m) => m.name);
  const first = l1.length ? pick(l1) : "";
  const rest = l1.filter((n) => n !== first);
  return {
    ...d, weapon,
    manoeuvres: [first, rest.length ? pick(rest) : ""].filter(Boolean),
    armour: pick(armourOptions(byId)).name,
    scroll: pick(scrollOptions(byId)).name,
  };
}
