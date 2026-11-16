// 2D6 Void character model (rules: docs/spec-void.md §1, §4, §5). DOM-free; the sheet UI is sheet.ts.
//
// API for the other Void tools (Combat, Hulk turn):
//   loadVChar() / saveVChar(c, source)   read / write "vsheet" (emits "void:changed")
//   hasVChar()                           a survivor has been created
//   vstats(c)                            level, title, nextXp, manoeuvres / maxManLevel, shift (with Stunned
//                                        and stim effects), baseShift, technical / coding (now and permanent),
//                                        techMod / codingMod, baseline, marksmanship (effective), checks
//   getHp(c) / setHp(c, n)               current HP (setHp never below 0, not capped)
//   applyDamage(c, n)                    lose HP (never below 0); returns { hp, down } (down = 0 HP)
//   heal(c, n, { exceed })               gain HP; capped at baseline unless exceed (stims, level-up)
//   addXp(c, n) / setXp(c, xp)           XP; level-ups add the baseline difference to HP (returns LevelChange)
//   wornArmour(c)                        [{ name, dice: number[][], yellow: number[][], mod }] for deflection
//   meleeManoeuvres(c)                   [{ name, primary, secondary, damage: { dice, sides, mod }, level }]
//                                        (mod includes c.meleeBonus, e.g. Tendon Amp)
//   rangedWeapons(c)                     c.ranged (ammo, capacity, size, damage, settings, special, spares)
//   useAmmo(c, i, n) / reload(c, i)      spend loaded rounds; reload from c.ranged[i].reserve
//   marksmanship(c)                      effective Marksmanship (permanent + level / room effects, 0–10)
//   addRangedHit(c)                      tick Ranged Hits (once per different enemy); a full bar gives +1
//                                        Marksmanship and 100 XP per level; returns { filled, level }
//   shiftPoints(c)                       Shift for a combat round (profession table + bonus − Stunned + stims)
//   useStim(c, i, choice?)               use stim slot i (HP, Stunned, timed effects); slot becomes an empty injector
//   endCombat(c) / enterRoom(c) / startHulkLevel(c)   expire timed effects; enterRoom also ticks Bloodied /
//                                        Stunned / Regenerative and returns messages
//   stun(c, n) / bloody(c)               conditions (Bounty Hunter Fast Recovery applied)
import { load, save, hasSaved } from "../common";
import { byId } from "../../library";
import { bus } from "../../shell/events";
import type { Table } from "../../types";
import { arr as varr, bool, jsonValue, num as vnumber, obj, oneOf, opt, rec, str, type V } from "../../lock/validate";
import { normaliseEquipped, sumMods, type Equipped } from "../gear";

// ---------- professions ----------
export const PROFESSIONS = ["Freighter Captain", "Space Police Officer", "Bounty Hunter"] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const isProfession = (p: unknown): p is Profession => PROFESSIONS.includes(p as Profession);

export const SPECIAL_SKILLS: Record<Profession, { name: string; effect: string }> = {
  "Freighter Captain": { name: "Improvisation", effect: "−1 from the roll on a Technical check that involves improvising a device." },
  "Space Police Officer": { name: "Security Expert", effect: "−1 from the roll on a Coding check that involves extracting data." },
  "Bounty Hunter": { name: "Fast Recovery", effect: "Each Stun you take is one less (a Stun of 5 counts as 4)." },
};

const LEVELS_SECTION: Record<Profession, string> = {
  "Freighter Captain": "void/p10-3",
  "Space Police Officer": "void/p11-3",
  "Bounty Hunter": "void/p12-3",
};

export interface LevelRow {
  level: number;
  title: string;
  man: number; // manoeuvre slots
  maxMan: number; // max manoeuvre level
  next: number; // XP to reach the next level (Infinity at 10)
  shift: number; // absolute Shift total
  tech: number; // Tech Mod gained on reaching this level
  coding: number;
  hp: number; // HP baseline
}

const FALLBACK_ROW: LevelRow = { level: 1, title: "", man: 2, maxMan: 1, next: Infinity, shift: 2, tech: 0, coding: 0, hp: 10 };
const num = (s: string | undefined) => {
  const n = parseInt(String(s ?? "").replace(/[−–]/g, "-").replace(/[^\d+-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

export const firstTable = (id: string): Table | undefined => {
  const b = byId.get(id)?.blocks.find((x) => x.type === "table");
  return b && b.type === "table" ? b.table : undefined;
};

/** A profession's Levels table rows, read from the library ("2 - Level 1" → 2 slots, max level 1). */
export function parseLevelsTable(t: Table): LevelRow[] {
  return t.rows
    .filter((r) => /^\d+$/.test(r[0]?.trim() ?? ""))
    .map((r) => {
      const m = r[2]?.match(/(\d+)\s*[-–]\s*Level\s*(\d+)/i);
      const next = parseInt(r[3]?.replace(/,/g, "") ?? "", 10);
      return {
        level: +r[0],
        title: r[1]?.trim() ?? "",
        man: m ? +m[1] : 2,
        maxMan: m ? +m[2] : 1,
        next: Number.isFinite(next) ? next : Infinity,
        shift: num(r[4]),
        tech: num(r[5]),
        coding: num(r[6]),
        hp: num(r[7]) || 10,
      };
    });
}

const levelCache = new Map<Profession, LevelRow[]>();
/** The Levels table for a profession (cached once the library has it). */
export function levelTable(p: Profession): LevelRow[] {
  const hit = levelCache.get(p);
  if (hit) return hit;
  const t = firstTable(LEVELS_SECTION[p]);
  const rows = t ? parseLevelsTable(t) : [];
  if (!rows.length) return [FALLBACK_ROW];
  levelCache.set(p, rows);
  return rows;
}
/** For tests: forget the parsed tables. */
export const _clearLevelCache = () => levelCache.clear();

/** Level for an XP total. Spec U1: thresholds are cumulative XP (level = 1 + thresholds reached). */
export function levelOf(p: Profession, xp: number): number {
  const rows = levelTable(p);
  let lvl = 1;
  for (const r of rows) if (Number.isFinite(r.next) && xp >= r.next) lvl = Math.min(rows.length, r.level + 1);
  return lvl;
}
const row = (p: Profession, level: number) => levelTable(p)[Math.max(0, Math.min(levelTable(p).length - 1, level - 1))];

// ---------- melee ----------
export const MELEE_WEAPONS = ["Ion Baton", "Electro Hammer", "Plasma Katar"] as const;
export type MeleeWeapon = (typeof MELEE_WEAPONS)[number];

export interface Manoeuvre {
  name: string;
  dice: string; // "[1][2]"
  damage: string; // "D6 +2"
  level: number; // manoeuvre level (not character level)
}

/** A weapon's manoeuvres, from the high-tech manoeuvres table. */
export function weaponManoeuvres(weapon: string): Manoeuvre[] {
  const t = firstTable("void/p69-1");
  if (!t) return [];
  const col = t.columns.findIndex((c) => c.toUpperCase().includes(weapon.toUpperCase()));
  if (col < 0) return [];
  const out: Manoeuvre[] = [];
  let level = 0;
  for (const r of t.rows) {
    const lv = r[col]?.match(/Level (\d) Manoeuvres/i);
    if (lv) {
      level = +lv[1];
      continue;
    }
    const m = r[col]?.match(/^\s*(.+?)\s*=\s*(.+?)\s*(?:dama?g?e?)?\s*$/i);
    if (!m || !level) continue;
    out.push({ name: titleCase(m[1]), dice: r[0].trim(), damage: m[2].replace(/\s*damage$/i, "").replace(/\s+/g, " ").trim(), level });
  }
  return out;
}

export const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s(/'‘-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());

/** "[4][3]+[1]" → [[4,3],[1]]; "[4]" → [[4]]. */
export function parseDiceSet(s: string): number[][] {
  return String(s ?? "")
    .split("+")
    .map((g) => (g.match(/\[(\d)\]/g) ?? []).map((x) => +x[1]))
    .filter((g) => g.length);
}

/** "2D6 +9" → { dice: 2, sides: 6, mod: 9 }; "D6 -1" → { 1, 6, -1 }; "D6" → { 1, 6, 0 }. */
export function parseDamage(s: string): { dice: number; sides: number; mod: number } {
  const m = String(s ?? "").replace(/[−–]/g, "-").match(/(\d*)\s*D\s*(\d+)\s*(?:([+-])\s*(\d+))?/i);
  if (!m) return { dice: 0, sides: 6, mod: num(s) };
  return { dice: m[1] ? +m[1] : 1, sides: +m[2], mod: m[3] ? (m[3] === "-" ? -1 : 1) * +m[4] : 0 };
}

// ---------- armour ----------
export interface ArmourPiece {
  name: string;
  dice: string; // "[5][4]+[2]"
  mod: number; // damage modifier, e.g. -2
  /** Yellow (ranged-blocking) dice by position: yellow[g][k] for group g, die k. */
  yellow: boolean[][];
  damaged?: boolean; // optional Armour Checks: modifier moved 1 toward zero
}

export interface ArmourRow { name: string; dice: string; mod: number; cost: number; start: boolean }
/** ARMOUR TABLE 1 (the first four rows are the starting armour). */
export function armourTable(): ArmourRow[] {
  const t = firstTable("void/p58-1");
  if (!t) return [];
  return t.rows.map((r, i) => ({ name: titleCase(r[0]), dice: r[1].trim(), mod: num(r[2]), cost: num(r[3]), start: i < 4 }));
}

/**
 * Default yellow dice. Starting armour: its single die [void p14]. Others: the first die of each
 * pair, plus the [3] after the + on the Void Knight Battlesuit (transcription note, p58; spec U3).
 * The sheet lets you toggle them to match your book.
 */
export function defaultYellow(name: string, dice: string): boolean[][] {
  const groups = parseDiceSet(dice);
  return groups.map((g, gi) => g.map((_d, k) => k === 0 && (gi === 0 || /void knight/i.test(name))));
}

export function armourPiece(r: Pick<ArmourRow, "name" | "dice" | "mod">): ArmourPiece {
  return { name: r.name, dice: r.dice, mod: r.mod, yellow: defaultYellow(r.name, r.dice) };
}

// Body-part words: two pieces with the same word (gloves, helmet, jacket, overalls, suit, plate) go on the same body part [void p13].
const PART_WORDS: [RegExp, string][] = [
  [/\b(gloves?|gauntlets?)\b/i, "hands"],
  [/\b(helmet|helm)\b/i, "head"],
  [/\bjacket\b/i, "jacket"],
  [/\b(overall|coverall)s?\b/i, "overall"],
  [/(suit)\b/i, "suit"],
  [/\bplates?\b/i, "plate"],
  [/\bvest\b/i, "vest"],
  [/\bgreaves?\b/i, "greaves"],
  [/\bbracers?\b/i, "bracers"],
  [/\bguards?\b/i, "guards"],
];
const parts = (name: string) => PART_WORDS.filter(([re]) => re.test(name)).map(([, p]) => p);

/** Why `name` can't be worn with the current armour (max 3, no duplicates, one per body part), or null. */
export function wearProblem(c: VoidCharacter, name: string, ignore = -1): string | null {
  const worn = c.armour.filter((_a, i) => i !== ignore && _a.name);
  if (worn.length >= 3) return "You can wear at most 3 pieces of armour.";
  if (worn.some((a) => a.name.toLowerCase() === name.toLowerCase())) return `You already wear ${name}.`;
  const p = parts(name);
  const clash = worn.find((a) => parts(a.name).some((x) => p.includes(x)));
  return clash ? `${name} covers the same body part as ${clash.name}.` : null;
}

// ---------- ranged weapons ----------
export interface RangedWeapon {
  name: string;
  size: "small" | "large";
  damage: string;
  settings: string;
  ammo: number; // loaded rounds
  capacity: number;
  ammoType: string;
  reserve: number; // spare rounds carried (no sheet field, §4)
  special: string;
  spares: number; // Weapon Spares from a stripped duplicate (§3.1.6)
  doubles: string; // the card's rule for a double on the Shot roll
  starting?: boolean; // starting equipment: can't be lost
  card?: string; // library section id
}

/** Ranged weapon cards in the library: Field | Value tables with a ROUND DAMAGE row. */
export function weaponCards(): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const [id, s] of byId) {
    const b = s.blocks.find((x) => x.type === "table");
    if (!b || b.type !== "table") continue;
    const t = b.table;
    if (t.columns.join("|") !== "Field|Value" || !t.rows.some((r) => r[0] === "ROUND DAMAGE")) continue;
    const name = titleCase(t.rows.find((r) => r[0] === "TYPE")?.[1] ?? t.title ?? s.title);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ id, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A ranged weapon from its card, fully loaded. */
export function weaponFromCard(id: string): RangedWeapon | null {
  const t = firstTable(id);
  if (!t) return null;
  const f = (k: string) => t.rows.find((r) => r[0].toUpperCase().startsWith(k))?.[1]?.trim() ?? "";
  const cap = num(f("CAPACITY"));
  return {
    name: titleCase(f("TYPE") || t.title || id),
    size: /large/i.test(f("SIZE")) ? "large" : "small",
    damage: f("ROUND DAMAGE"),
    settings: f("SETTINGS"),
    ammo: cap,
    capacity: cap,
    ammoType: f("AMMO TYPE"),
    reserve: 0,
    special: /^none$/i.test(f("SPECIAL")) ? "" : f("SPECIAL"),
    spares: 0,
    doubles: f("ROLL A D6"),
    card: id,
  };
}

/** The starting C-12 Pistol, loaded with a single 12-round caseless block [void p39]. */
export function startingPistol(): RangedWeapon {
  const w = weaponFromCard("void/p39-7") ?? {
    name: "C-12 Pistol", size: "small", damage: "D6", settings: "Single", ammo: 12, capacity: 12, ammoType: "Caseless block",
    reserve: 0, special: "", spares: 0, doubles: "1 - The trigger breaks.\n2 - Jams, lose 2 ammo.\n3-6 - Nothing happens.",
  } satisfies RangedWeapon;
  return { ...w, starting: true };
}

/** Why a weapon of `size` won't fit (max 3: 2 small + 1 large), or null. */
export function rangedProblem(c: VoidCharacter, size: "small" | "large"): string | null {
  const n = c.ranged.filter((w) => w.size === size).length;
  if (c.ranged.length >= 3) return "You can carry at most 3 ranged weapons.";
  if (size === "small" && n >= 2) return "You can carry only 2 small ranged weapons.";
  if (size === "large" && n >= 1) return "You can carry only 1 large ranged weapon.";
  return null;
}

// ---------- stims and gases ----------
export const GASES = ["Ca", "Co", "F", "I", "S", "T"] as const;
export type Gas = (typeof GASES)[number];
export const GAS_NAMES: Record<Gas, string> = { Ca: "Callanian", Co: "Condensing", F: "Flacarian", I: "Intemious", S: "Salvatious", T: "Tremulous" };

export interface StimRow { type: string; effect: string; ingredients: string; duration: string; cost: number }
export function stimTable(): StimRow[] {
  const t = firstTable("void/p87-1");
  if (!t) return [{ type: "Medical", effect: "+10 HP (can exceed baseline)", ingredients: "Co & S", duration: "INSTANT", cost: 20 }];
  return t.rows.map((r) => ({ type: titleCase(r[0]), effect: r[1], ingredients: r[2], duration: r[3], cost: num(r[4]) }));
}
export const stimInfo = (type: string) => stimTable().find((s) => s.type.toLowerCase() === type.toLowerCase());

/**
 * Gases a stim needs: "T x2 & Co" → { T: 2, Co: 1 }; "All Gases" → one of each. Spec U10, as printed:
 * Heightened Awareness "I, Ca, S & Ca x2" needs Ca ×3; "Sa" (Toughen Skin) is read as S.
 */
export function stimRecipe(ingredients: string): Partial<Record<Gas, number>> {
  if (/all gases/i.test(ingredients)) return Object.fromEntries(GASES.map((g) => [g, 1]));
  const out: Partial<Record<Gas, number>> = {};
  for (const part of ingredients.split(/[,&]/)) {
    const m = part.trim().match(/^([A-Za-z]+)\s*(?:x\s*(\d+))?$/);
    if (!m) continue;
    const code = (m[1] === "Sa" ? "S" : m[1]) as Gas;
    if (!GASES.includes(code)) continue;
    out[code] = (out[code] ?? 0) + (m[2] ? +m[2] : 1);
  }
  return out;
}

/** A stim slot: an injector, filled with `type` or empty (""). Max 5 slots, empty injectors included (U6). */
export interface StimSlot { type: string }
export const MAX_STIMS = 5;

/** A timed effect from a stim (or a rule like RFUT1 10). Scope says when it ends. */
export interface Effect {
  name: string;
  text: string;
  scope: "room" | "combat" | "level" | "rooms";
  rooms?: number; // scope "rooms": rooms left
  tech?: number;
  coding?: number;
  shift?: number;
  marks?: number;
  hpPerRoom?: number;
}

// ---------- STE ----------
export const STE_TASKS = [
  { id: "fixMachine", name: "Fix Machine", skill: "technical", def: "A physical intervention that makes a machine work again." },
  { id: "recogniseFunction", name: "Recognise Function", skill: "technical", def: "Work out what a physical thing does, and use that to get past a problem." },
  { id: "improviseDevice", name: "Improvise Device", skill: "technical", def: "Build something with your hands that does a job you then use (thrown weapons included)." },
  { id: "crackCode", name: "Crack Code", skill: "coding", def: "Codes on devices, not security door codes." },
  { id: "reprogramme", name: "Reprogramme", skill: "coding", def: "Change something's function through coding." },
  { id: "extractData", name: "Extract Data", skill: "coding", def: "Successfully retrieve useful data from a computer." },
] as const;
export type SteTask = (typeof STE_TASKS)[number]["id"];

export const SKILL_CAP = 10;
export const MARKS_MAX = 10;

// ---------- the character ----------
export interface SideQuest { text: string; done: boolean }

export interface VoidCharacter {
  v: 1;
  name: string;
  profession: Profession;
  weapon: MeleeWeapon;
  xp: number;
  /** The level last applied (level-ups add HP when XP passes a threshold). Read by status.ts. */
  level: number;
  hp: number;
  // permanent adjustments on top of the profession table
  techBonus: number; // STE gains and other permanent +Technical
  codingBonus: number;
  shiftBonus: number;
  baselineBonus: number;
  meleeBonus: number; // +damage to all manoeuvres (e.g. Tendon Amp)
  marksmanship: number; // permanent value: start 6, max 10
  marksTemp: number; // this Hulk level only (e.g. RFUT1 10: −2)
  rangedHits: number; // 0–9 ticks on the Ranged Hits bar (the 10th tick pays out and clears it)
  manoeuvres: Manoeuvre[];
  armour: ArmourPiece[]; // worn, max 3
  ranged: RangedWeapon[]; // max 3: 2 small + 1 large
  stims: StimSlot[]; // max 5 injectors
  gas: Record<Gas, number>;
  effects: Effect[];
  rations: number;
  rationParts: number; // food parts towards a ration (3 types = 1 ration)
  credits: number;
  artefacts: string;
  ste: Record<SteTask, number>; // 0–3 ticks
  bloodied: number; // 0–8 boxes (8 + further rooms = fever, −1 HP per room)
  stunned: number; // 0–8 rooms left
  hero: boolean[]; // the hero-status track, 10 boxes
  bio: string[]; // bio enhancements (benefit notes); a 7th fails the mission
  access: { alpha: number; beta: number; gamma: number };
  large: string[]; // 10 large / heavy item slots
  equipped?: Equipped[]; // pack items worn or wielded, with the bonuses each gives (gear.ts); absent = none
  small: string;
  equipment: string; // starting equipment (can't be lost)
  quests: SideQuest[];
  narrative: string;
  notes: string;
  tentUses: number; // Camo Tent uses this Hulk level
  portrait?: string; // square JPEG data: URL
}

export const STARTING_EQUIPMENT =
  "Backpack, camo tent, crowbar, Flashlight, Hacking Console (HC-5), plastic pockets ×2, portable 3D printer, Sample Scanner, Stim Dock, wrench"; // the starting kit, A–Z

export function newVoidCharacter(profession: Profession = "Freighter Captain"): VoidCharacter {
  return {
    v: 1,
    name: "",
    profession,
    weapon: "Ion Baton",
    xp: 0,
    level: 1,
    hp: 10,
    techBonus: 0,
    codingBonus: 0,
    shiftBonus: 0,
    baselineBonus: 0,
    meleeBonus: 0,
    marksmanship: 6,
    marksTemp: 0,
    rangedHits: 0,
    manoeuvres: [],
    armour: [],
    ranged: [startingPistol()],
    stims: [{ type: "Medical" }],
    gas: { Ca: 0, Co: 0, F: 0, I: 0, S: 0, T: 0 },
    effects: [],
    rations: 2,
    rationParts: 0,
    credits: 0, // spec U4: no starting credits are stated
    artefacts: "",
    ste: { fixMachine: 0, recogniseFunction: 0, improviseDevice: 0, crackCode: 0, reprogramme: 0, extractData: 0 },
    bloodied: 0,
    stunned: 0,
    hero: Array(10).fill(false),
    bio: [],
    access: { alpha: 0, beta: 0, gamma: 0 },
    large: Array(10).fill(""),
    small: "",
    equipment: STARTING_EQUIPMENT,
    quests: [],
    narrative: "",
    notes: "",
    tentUses: 0,
  };
}

const n0 = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const arr = <T>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Fill gaps in a saved or imported character so every field the sheet reads exists. */
export function normaliseVChar(d: Partial<VoidCharacter> | null | undefined): VoidCharacter {
  const base = newVoidCharacter(isProfession(d?.profession) ? d!.profession : "Freighter Captain");
  if (!d || typeof d !== "object") return base;
  const c: VoidCharacter = { ...base, ...d, v: 1 } as VoidCharacter;
  c.profession = base.profession;
  if (!MELEE_WEAPONS.includes(c.weapon)) c.weapon = "Ion Baton";
  c.name = String(c.name ?? "");
  for (const k of ["xp", "hp", "techBonus", "codingBonus", "shiftBonus", "baselineBonus", "meleeBonus", "marksTemp", "rangedHits", "rations", "rationParts", "credits", "bloodied", "stunned", "tentUses"] as const)
    c[k] = n0(c[k], base[k]);
  c.xp = Math.max(0, Math.floor(c.xp));
  c.marksmanship = clamp(n0(c.marksmanship, 6), 0, MARKS_MAX);
  c.equipped = normaliseEquipped(c.equipped);
  c.rangedHits = clamp(Math.floor(c.rangedHits), 0, RANGED_HITS_BAR - 1);
  c.level = Number.isInteger(d.level) && d.level! > 0 ? d.level! : levelOf(c.profession, c.xp);
  c.manoeuvres = arr<Manoeuvre>(c.manoeuvres, []).filter((m) => m && m.name).slice(0, 3);
  c.armour = arr<ArmourPiece>(c.armour, [])
    .filter((a) => a && a.name)
    .map((a) => ({ ...a, mod: n0(a.mod, -1), yellow: Array.isArray(a.yellow) ? a.yellow : defaultYellow(a.name, a.dice) }))
    .slice(0, 3);
  c.ranged = arr<RangedWeapon>(c.ranged, base.ranged).filter((w) => w && w.name).slice(0, 3)
    .map((w) => ({ ...w, ammo: n0(w.ammo), capacity: n0(w.capacity), reserve: n0(w.reserve), spares: n0(w.spares), size: w.size === "large" ? "large" : "small" }));
  c.stims = arr<StimSlot>(c.stims, []).filter((s) => s && typeof s.type === "string").slice(0, MAX_STIMS);
  c.gas = { ...base.gas, ...(c.gas ?? {}) };
  c.effects = arr<Effect>(c.effects, []);
  c.ste = { ...base.ste, ...(c.ste ?? {}) };
  c.hero = Array.from({ length: 10 }, (_v, i) => !!arr<boolean>(c.hero, [])[i]);
  c.bio = arr<string>(c.bio, []).map(String).slice(0, 7);
  c.access = { ...base.access, ...(c.access ?? {}) };
  c.large = Array.from({ length: 10 }, (_v, i) => String(arr<string>(c.large, [])[i] ?? ""));
  c.quests = arr<SideQuest>(c.quests, []).filter((q) => q && typeof q.text === "string");
  return c;
}

// ---------- import check ----------
const vnum = vnumber({ min: -1_000_000, max: 1_000_000 });
const vstr = (max = 2000) => str(max);
const manShape = obj<Manoeuvre>({ name: vstr(200), dice: vstr(200), damage: vstr(200), level: vnum });
const armourShape = obj<ArmourPiece>({ name: vstr(200), dice: vstr(200), mod: vnum, yellow: varr(varr(bool, 8), 8), damaged: opt(bool) });
const rangedShape = obj<RangedWeapon>(
  { name: vstr(200), size: oneOf("small", "large"), damage: vstr(), settings: vstr(), ammo: vnum, capacity: vnum, ammoType: vstr(), reserve: vnum,
    special: vstr(), spares: vnum, doubles: vstr(), starting: opt(bool), card: opt(vstr(200)) },
  { extra: true },
);
const effectShape = obj<Effect>({
  name: vstr(200), text: vstr(), scope: oneOf("room", "combat", "level", "rooms"), rooms: opt(vnum),
  tech: opt(vnum), coding: opt(vnum), shift: opt(vnum), marks: opt(vnum), hpPerRoom: opt(vnum),
});
const counts = rec(/^[A-Za-z][A-Za-z0-9]{0,31}$/, vnum, 32);
/** A survivor from an imported file: every field optional (normaliseVChar fills the gaps), each one checked. Throws a ValidationError. */
export const validateVChar: (x: unknown) => Partial<VoidCharacter> = (x) =>
  obj<Partial<VoidCharacter>>(
    {
      v: opt(oneOf(1)), name: opt(vstr(200)), profession: opt(oneOf(...PROFESSIONS)), weapon: opt(oneOf(...MELEE_WEAPONS)),
      xp: opt(vnum), level: opt(vnum), hp: opt(vnum), techBonus: opt(vnum), codingBonus: opt(vnum), shiftBonus: opt(vnum),
      baselineBonus: opt(vnum), meleeBonus: opt(vnum), marksmanship: opt(vnum), marksTemp: opt(vnum), rangedHits: opt(vnum),
      manoeuvres: opt(varr(manShape, 10)), armour: opt(varr(armourShape, 10)), ranged: opt(varr(rangedShape, 10)),
      stims: opt(varr(obj<StimSlot>({ type: vstr(200) }), MAX_STIMS)), gas: opt(counts as V<Record<Gas, number>>),
      effects: opt(varr(effectShape, 50)), rations: opt(vnum), rationParts: opt(vnum), credits: opt(vnum), artefacts: opt(vstr(20000)),
      ste: opt(counts as V<Record<SteTask, number>>), bloodied: opt(vnum), stunned: opt(vnum), hero: opt(varr(bool, 10)),
      bio: opt(varr(vstr(), 10)), access: opt(obj({ alpha: vnum, beta: vnum, gamma: vnum })), large: opt(varr(vstr(), 10)),
      small: opt(vstr(20000)), equipment: opt(vstr(5000)), quests: opt(varr(obj<SideQuest>({ text: vstr(), done: bool }), 100)),
      narrative: opt(vstr(50000)), notes: opt(vstr(50000)), tentUses: opt(vnum),
      equipped: opt(varr(jsonValue(3), 50)) as never, // cleaned by normaliseEquipped
      portrait: opt(str(400000, /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]*$/)),
    },
    { extra: true },
  )(x, "survivor");

const KEY = "vsheet";
export const hasVChar = () => hasSaved(KEY);
export const loadVChar = (): VoidCharacter => normaliseVChar(load<Partial<VoidCharacter> | null>(KEY, null));
/** Save and tell the shell and the other tools; `source` names who changed it ("vsheet", "vcombat"…). */
export function saveVChar(c: VoidCharacter, source = "vsheet") {
  save(KEY, c);
  bus.emit("void:changed", { source });
}

// ---------- derived stats ----------
/** Sum of the active effects' modifiers, plus the bonuses of equipped items. */
export function effectMods(c: VoidCharacter) {
  const eq = sumMods(c.equipped);
  const m = { tech: eq.tech, coding: eq.coding, shift: eq.shift, marks: eq.marks };
  for (const e of c.effects) {
    m.tech += e.tech ?? 0;
    m.coding += e.coding ?? 0;
    m.shift += e.shift ?? 0;
    m.marks += e.marks ?? 0;
  }
  return m;
}

export function vstats(c: VoidCharacter) {
  const level = levelOf(c.profession, c.xp);
  const rows = levelTable(c.profession);
  const L = row(c.profession, level);
  const upTo = rows.filter((r) => r.level <= level);
  const techMods = upTo.reduce((s, r) => s + r.tech, 0);
  const codingMods = upTo.reduce((s, r) => s + r.coding, 0);
  const fx = effectMods(c);
  const techPerm = clamp(3 + techMods + c.techBonus, 0, SKILL_CAP);
  const codingPerm = clamp(3 + codingMods + c.codingBonus, 0, SKILL_CAP);
  const baseShift = L.shift + c.shiftBonus;
  const stunnedPenalty = c.stunned > 0 ? 1 : 0; // −1 Shift while Stunned (doesn't stack)
  return {
    level,
    title: L.title,
    nextXp: L.next,
    manoeuvres: Math.min(3, L.man),
    maxManLevel: L.maxMan,
    baseShift,
    shift: Math.max(0, baseShift - stunnedPenalty + fx.shift),
    techMod: L.tech, // this level's row
    codingMod: L.coding,
    techMods,
    codingMods,
    technicalPerm: techPerm,
    codingPerm,
    technical: clamp(techPerm + fx.tech, 0, SKILL_CAP),
    coding: clamp(codingPerm + fx.coding, 0, SKILL_CAP),
    baseline: L.hp + c.baselineBonus,
    marksmanship: marksmanship(c),
    special: SPECIAL_SKILLS[c.profession],
    lastLevel: level >= rows.length,
  };
}
export type VStats = ReturnType<typeof vstats>;

/** Effective Marksmanship: permanent + this-level and room effects, 0–10. */
export const marksmanship = (c: VoidCharacter) => clamp(c.marksmanship + c.marksTemp + effectMods(c).marks, 0, MARKS_MAX);
export const shiftPoints = (c: VoidCharacter) => vstats(c).shift;

/**
 * A skill check "−3(2) Coding check": roll 2D6 + modifier, pass if ≤ the skill. Special Skills give
 * −1 in their case. Returns the roll-total target (pass when 2D6 ≤ target).
 */
export function skillTarget(c: VoidCharacter, skill: "technical" | "coding", modifier = 0, special = false): number {
  const s = vstats(c);
  return (skill === "technical" ? s.technical : s.coding) - modifier + (special ? 1 : 0);
}
/** Does the profession's Special Skill apply to this check? */
export function specialApplies(c: VoidCharacter, skill: "technical" | "coding", task: SteTask | "other"): boolean {
  return (c.profession === "Freighter Captain" && skill === "technical" && task === "improviseDevice") ||
    (c.profession === "Space Police Officer" && skill === "coding" && task === "extractData");
}
/** Resolve a skill check roll. */
export function skillCheck(c: VoidCharacter, skill: "technical" | "coding", roll: number, modifier = 0, special = false) {
  const total = roll + modifier - (special ? 1 : 0);
  const target = skill === "technical" ? vstats(c).technical : vstats(c).coding;
  return { total, target, pass: total <= target };
}

/** Parse "−3(2)" → { modifier: −3, attempts: 2 }. */
export function parseCheck(s: string): { modifier: number; attempts: number } {
  const m = String(s).replace(/[−–]/g, "-").match(/([+-]?\d+)\s*\((\d+)\)/);
  return m ? { modifier: +m[1], attempts: +m[2] } : { modifier: num(s), attempts: 1 };
}

// ---------- XP and levels ----------
export interface LevelChange { from: number; to: number; hpDelta: number }

/**
 * Set XP. On a level change the baseline difference is added to current HP, even above the
 * baseline [void p15]; a correction downward takes it back (never below 0). Mutates `c`.
 */
export function setXp(c: VoidCharacter, xp: number): LevelChange {
  const from = c.level;
  c.xp = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  const to = levelOf(c.profession, c.xp);
  const hpDelta = row(c.profession, to).hp - row(c.profession, from).hp;
  if (to !== from) c.hp = Math.max(0, c.hp + hpDelta);
  c.level = to;
  return { from, to, hpDelta: to === from ? 0 : hpDelta };
}
export const addXp = (c: VoidCharacter, n: number) => setXp(c, c.xp + n);

/** The level-up toast, or null when the level held. */
export function levelChangeText(c: VoidCharacter, ch: LevelChange): string | null {
  if (ch.to === ch.from) return null;
  const L = row(c.profession, ch.to);
  if (ch.to < ch.from) return `Back to ${L.title} (level ${ch.to}). ${ch.hpDelta} HP.`;
  const prev = row(c.profession, ch.from);
  const gains = [`+${ch.hpDelta} HP (baseline ${L.hp})`];
  if (L.shift !== prev.shift) gains.push(`Shift +${L.shift}`);
  const t = levelTable(c.profession).filter((r) => r.level > ch.from && r.level <= ch.to);
  const tech = t.reduce((s, r) => s + r.tech, 0);
  const cod = t.reduce((s, r) => s + r.coding, 0);
  if (tech) gains.push(`Technical +${tech}`);
  if (cod) gains.push(`Coding +${cod}`);
  if (L.man !== prev.man) gains.push(`a manoeuvre slot (${L.man})`);
  if (L.maxMan !== prev.maxMan) gains.push(`level ${L.maxMan} manoeuvres`);
  return `Level up! ${L.title} (level ${ch.to}): ${gains.join(", ")}. You may swap one manoeuvre.`;
}

// ---------- HP ----------
export const getHp = (c: VoidCharacter) => c.hp;
export const setHp = (c: VoidCharacter, hp: number) => (c.hp = Math.max(0, Math.floor(n0(hp))));
/** Lose `n` HP (never below 0). `down`: 0 HP, unconscious (§1.9). */
export function applyDamage(c: VoidCharacter, n: number): { hp: number; down: boolean } {
  c.hp = Math.max(0, c.hp - Math.max(0, Math.floor(n)));
  return { hp: c.hp, down: c.hp === 0 };
}
/**
 * Gain `n` HP. Spec U7: only stims and level-ups may exceed the baseline, so by default healing
 * stops at the baseline (and never lowers HP already above it). Returns the HP gained.
 */
export function heal(c: VoidCharacter, n: number, o: { exceed?: boolean } = {}): number {
  const before = c.hp;
  const target = c.hp + Math.max(0, Math.floor(n));
  c.hp = o.exceed ? target : Math.max(c.hp, Math.min(vstats(c).baseline, target));
  return c.hp - before;
}

// ---------- melee / armour / ranged for Combat ----------
export function meleeManoeuvres(c: VoidCharacter) {
  return c.manoeuvres.map((m) => {
    const [g] = parseDiceSet(m.dice);
    const d = parseDamage(m.damage);
    return { name: m.name, primary: g?.[0] ?? 0, secondary: g?.[1] ?? 0, damage: { ...d, mod: d.mod + c.meleeBonus }, level: m.level };
  });
}
export function wornArmour(c: VoidCharacter) {
  return c.armour.map((a) => {
    const dice = parseDiceSet(a.dice);
    return { name: a.name, dice, yellow: dice.map((g, gi) => g.filter((_d, k) => a.yellow[gi]?.[k])), mod: a.mod, damaged: !!a.damaged };
  });
}
/** Optional Armour Checks: a damaged piece's modifier moves 1 toward zero (spec U43: it can reach 0). */
export function damageArmour(c: VoidCharacter, i: number) {
  const a = c.armour[i];
  if (!a) return;
  a.mod = Math.min(0, a.mod + 1);
  a.damaged = true;
}
export const rangedWeapons = (c: VoidCharacter) => c.ranged;
export function useAmmo(c: VoidCharacter, i: number, n = 1): boolean {
  const w = c.ranged[i];
  if (!w || w.ammo < n) return false;
  w.ammo -= n;
  return true;
}
export function reload(c: VoidCharacter, i: number): number {
  const w = c.ranged[i];
  if (!w) return 0;
  const add = Math.min(w.reserve, w.capacity - w.ammo);
  w.ammo += add;
  w.reserve -= add;
  return add;
}

// ---------- marksmanship ----------
export const RANGED_HITS_BAR = 10;
export type RangedHitResult = { filled: boolean; capped: boolean; xp: number; level: LevelChange };
/** Tick the Ranged Hits bar (once per different enemy). Full: +1 Marksmanship (max 10), clear, +100 XP per level. */
export function addRangedHit(c: VoidCharacter): RangedHitResult {
  return setRangedHits(c, c.rangedHits + 1);
}
/** Set the bar to n ticks (a box ticked by hand). Reaching the end pays out exactly as a hit does. */
export function setRangedHits(c: VoidCharacter, n: number): RangedHitResult {
  c.rangedHits = clamp(Math.floor(n), 0, RANGED_HITS_BAR);
  if (c.rangedHits < RANGED_HITS_BAR) return { filled: false, capped: false, xp: 0, level: { from: c.level, to: c.level, hpDelta: 0 } };
  c.rangedHits = 0;
  const capped = c.marksmanship >= MARKS_MAX;
  c.marksmanship = Math.min(MARKS_MAX, c.marksmanship + 1);
  const xp = 100 * vstats(c).level;
  return { filled: true, capped, xp, level: addXp(c, xp) };
}
/** Toast text for a filled bar. */
export function rangedBarText(c: VoidCharacter, r: RangedHitResult): string {
  return r.capped
    ? `Ranged hits bar full: Marksmanship is already at its max of ${MARKS_MAX}, +${r.xp} XP.`
    : `Ranged hits bar full: Marksmanship ${c.marksmanship}, +${r.xp} XP.`;
}

// ---------- capacity ----------
export const MAX_LARGE = 10;
export const largeCount = (c: VoidCharacter) => c.large.filter((s) => s.trim()).length;
export const canAddLarge = (c: VoidCharacter) => largeCount(c) < MAX_LARGE;
export const canAddStim = (c: VoidCharacter) => c.stims.length < MAX_STIMS;
/** Put an item in the first free large slot; false when all 10 are full. */
export function addLarge(c: VoidCharacter, item: string): boolean {
  const i = c.large.findIndex((s) => !s.trim());
  if (i < 0) return false;
  c.large[i] = item;
  return true;
}

// ---------- conditions ----------
/** Stunned N. Bounty Hunter Fast Recovery: N − 1. Spec U42: a new Stun keeps the larger count. */
export function stun(c: VoidCharacter, n: number) {
  const v = clamp(n - (c.profession === "Bounty Hunter" ? 1 : 0), 0, 8);
  c.stunned = Math.max(c.stunned, v);
}
/** Become Bloodied: spec U36, tick the first box at once [void p25]. */
export function bloody(c: VoidCharacter) {
  if (c.bloodied === 0) c.bloodied = 1;
}
export const fever = (c: VoidCharacter) => c.bloodied >= 8;

// ---------- stims ----------
/**
 * Use the stim in slot `i`: HP and Stunned now, timed effects into c.effects (a stim already active
 * is refreshed, not stacked: spec U9). The slot stays as an empty injector. `choice` picks the
 * skill for the "Technical or Coding" stims.
 */
export function useStim(c: VoidCharacter, i: number, choice: "technical" | "coding" = "technical"): { type: string; text: string } | null {
  const slot = c.stims[i];
  if (!slot || !slot.type) return null;
  const type = slot.type;
  const info = stimInfo(type);
  slot.type = "";
  const out: string[] = [];
  const fx = (e: Omit<Effect, "name" | "text">) => {
    c.effects = c.effects.filter((x) => x.name !== type);
    c.effects.push({ name: type, text: info?.effect ?? type, ...e });
  };
  const skill = (n: number) => (choice === "coding" ? { coding: n } : { tech: n });
  const unstun = () => {
    if (c.stunned) out.push("Stunned removed");
    c.stunned = 0;
  };
  switch (type.toLowerCase()) {
    case "medical": out.push(`+${heal(c, 10, { exceed: true })} HP`); break;
    case "enhanced medical": out.push(`+${heal(c, 25, { exceed: true })} HP`); unstun(); break;
    case "potent medical": out.push(`+${heal(c, 50, { exceed: true })} HP`); unstun(); break;
    case "regenerative": unstun(); fx({ scope: "rooms", rooms: 3, hpPerRoom: 5 }); out.push("+5 HP per room for 3 rooms"); break;
    case "acuity enhancement": fx({ scope: "room", ...skill(2) }); break;
    case "cerebral boost": fx({ scope: "room", ...skill(1) }); break;
    case "augment": fx({ scope: "level", ...skill(1) }); break;
    case "amplified joints": fx({ scope: "combat", shift: 1 }); break;
    case "heightened awareness": fx({ scope: "level", marks: 1 }); break;
    case "focused vision": case "magnified senses": case "insight": fx({ scope: "room" }); break;
    default: fx({ scope: "combat" }); // damage and Momentum stims: last one combat
  }
  return { type, text: out.length ? out.join(" · ") : info?.effect ?? type };
}

/** Fill the empty injector in slot `i` with `type` from your gases (Stim Dock): 10 XP per level. */
export function fillStim(c: VoidCharacter, i: number, type: string): { ok: boolean; reason?: string; level?: LevelChange } {
  const slot = c.stims[i];
  if (!slot || slot.type) return { ok: false, reason: "Pick an empty injector." };
  const info = stimInfo(type);
  if (!info) return { ok: false, reason: `Unknown stim ${type}.` };
  const need = stimRecipe(info.ingredients);
  const short = (Object.keys(need) as Gas[]).filter((g) => c.gas[g] < need[g]!);
  if (short.length) return { ok: false, reason: `Not enough gas: ${short.map((g) => `${GAS_NAMES[g]} (${g}) ${c.gas[g]}/${need[g]}`).join(", ")}.` };
  for (const g of Object.keys(need) as Gas[]) c.gas[g] -= need[g]!;
  slot.type = info.type;
  return { ok: true, level: addXp(c, 10 * vstats(c).level) };
}

// ---------- time passing ----------
/** End of a combat: combat effects expire. */
export function endCombat(c: VoidCharacter) {
  c.effects = c.effects.filter((e) => e.scope !== "combat");
}
/** Entering a room (backtracking too): Bloodied tick or fever, Stunned −1, Regenerative heal, room effects end. */
export function enterRoom(c: VoidCharacter): string[] {
  const msgs: string[] = [];
  if (c.bloodied > 0) {
    if (c.bloodied < 8) c.bloodied++;
    else {
      applyDamage(c, 1);
      msgs.push("Fever: −1 HP (wash to clear Bloodied).");
    }
  }
  if (c.stunned > 0) {
    c.stunned--;
    if (!c.stunned) msgs.push("No longer Stunned.");
  }
  c.effects = c.effects
    .map((e) => {
      if (e.scope !== "rooms") return e;
      if (e.hpPerRoom) msgs.push(`${e.name}: +${heal(c, e.hpPerRoom, { exceed: true })} HP.`);
      return { ...e, rooms: (e.rooms ?? 1) - 1 };
    })
    .filter((e) => e.scope !== "room" && !(e.scope === "rooms" && (e.rooms ?? 0) <= 0));
  return msgs;
}
/** A new Hulk level: level effects and this-level Marksmanship changes end; the Camo Tent is available again. */
export function startHulkLevel(c: VoidCharacter) {
  c.effects = c.effects.filter((e) => e.scope !== "level");
  c.marksTemp = 0;
  c.tentUses = 0;
}

// ---------- rations, rest, Camo Tent ----------
/**
 * Between levels: eat a ration, two parts, or nothing. Spec U8: losses round down; the 20 HP cap
 * applies to both the half and the quarter. Returns the HP lost.
 */
export function eatBetweenLevels(c: VoidCharacter, food: "ration" | "parts" | "none"): number {
  if (food === "ration" && c.rations > 0) {
    c.rations--;
    return 0;
  }
  if (food === "parts" && c.rationParts >= 2) {
    c.rationParts -= 2;
    const loss = Math.min(20, Math.floor(c.hp / 4));
    c.hp -= loss;
    return loss;
  }
  const loss = Math.min(20, Math.floor(c.hp / 2));
  c.hp -= loss;
  return loss;
}
/** Rest between levels (only after eating): +2 HP per level, +1 more per level with a cloth or bandage; not above baseline. */
export const restBetweenLevels = (c: VoidCharacter, cloth: boolean) => heal(c, (cloth ? 3 : 2) * vstats(c).level);

/** Camo Tent uses allowed on this Hulk level (L10 allows two). */
export const tentAllowed = (hulkLevel: number) => (hulkLevel >= 10 ? 2 : 1);
/**
 * Camo Tent rest: with a ration, HP to baseline; without, + half the baseline. Spec U11: the ration
 * is eaten, and the half-baseline gain stops at the baseline. Leaving removes Stunned.
 */
export function camoRest(c: VoidCharacter): number {
  const base = vstats(c).baseline;
  let gained: number;
  if (c.rations > 0) {
    c.rations--;
    gained = heal(c, base);
  } else gained = heal(c, Math.floor(base / 2));
  c.stunned = 0;
  c.tentUses++;
  return gained;
}

// ---------- STE ----------
/** Tick a Specific Task Experience box. The 4th tick: +1 to that skill (up to the cap) and the row clears. */
export function tickSte(c: VoidCharacter, task: SteTask): { gained: "technical" | "coding" | null } {
  const t = STE_TASKS.find((x) => x.id === task)!;
  c.ste[task] = (c.ste[task] ?? 0) + 1;
  if (c.ste[task] < 4) return { gained: null };
  c.ste[task] = 0;
  const s = vstats(c);
  if (t.skill === "technical") {
    if (s.technicalPerm >= SKILL_CAP) return { gained: null };
    c.techBonus++;
  } else {
    if (s.codingPerm >= SKILL_CAP) return { gained: null };
    c.codingBonus++;
  }
  return { gained: t.skill };
}

// ---------- crafting ----------
export interface CraftItem { name: string; effect: string; ingredients: string }
/** This profession's three crafting items, from its crafting table. */
export function craftingItems(p: Profession): CraftItem[] {
  const t = firstTable("void/p80-1");
  if (!t) return [];
  const out: CraftItem[] = [];
  let mine = false;
  for (const r of t.rows) {
    if (!r[1] && !r[2]) {
      mine = r[0].trim().toLowerCase() === p.toLowerCase();
      continue;
    }
    if (mine) out.push({ name: titleCase(r[0]), effect: r[1], ingredients: r[2] });
  }
  return out;
}

// ---------- XP sources (§1.14) ----------
export const XP_SOURCES = [
  { id: "quest", label: "Side quest done", per: 50 },
  { id: "stim", label: "Made / refilled a stim", per: 10 },
  { id: "repair", label: "Repaired an item", per: 20 },
  { id: "throw", label: "Made a throwing weapon (Hulk L2+)", per: 100 },
] as const;
