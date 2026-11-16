// 2D6 Void combat rules (docs/spec-void.md §3, §5). DOM-free and dice-free: the UI (combat.ts) rolls
// and passes the faces in. Character data comes from sheetmodel.ts; nothing here is from 2D6 Dungeon.
//
// UNCLEAR readings used (spec §5):
//   U25 Surprised: no ranged phase and the alien makes the first melee attack. "Attacks first" (Alarm
//       Check, patrol SPECIAL, SLDT1 9): the alien makes the first melee attack; the ranged phase is normal.
//   U26 Burst uses a third of the weapon's capacity, rounded up, and needs that many rounds loaded.
//   U27 Ranged Deflection Roll: only one red-boxed interrupt applies, the one that reduces most.
//   U28 An alien's doubled Shot Roll has no doubles table.
//   U29 Only one armour piece deflects a ranged hit (the best one), by yellow dice in their position.
//   U30 Firing case 2: you → alien → you.
//   U31 Ranged weapons may fire several times per the firing cases (Halo Suppressor: once per combat).
//   U32 Several aliens: the case is set by the best armed alien's Marksmanship; every armed alien fires.
//   U33 The "a 6 on a damage die" floor applies after interrupts and armour; for D3 a die face of 6 counts.
//   U34 Ranged exchanges are not combat rounds (no Fatigue Die, no round count).
//   U35 Metal Pipe: no damage to non-biological aliens. Oil Bomb: no damage. Diffusion "unable to
//       defend": no interrupt against your first melee attack. Mag Grenade: banned in hull rooms
//       unless reinforced (*).
//   U37 Prime Attack adds your total Shift once (no Exact Strike bonus on top).
//   U38 Armour doesn't reduce damage from an alien's Prime (or Mishap) card text.
//   U39 Movement and item interrupts are tagged by name keywords (MOVEMENT_RE); others stay after round 6.
//   U40 Too Powerful: every alien manoeuvre's maximum damage (dice max + modifier, no 6-floor) is ≤ the
//       reduction of the best worn armour piece that deflects it. Mishap/Prime text is ignored.
//   U41 Turrets: you → turret exchanges until one side is down or you retreat (it gets one last shot).
import { parseDamage, parseDiceSet, type ArmourPiece } from "./sheetmodel";
import type { Section, Table } from "../../types";
import { isCreatureTable } from "../common";

export type Dice = { dice: number; sides: number; mod: number };
export type AlienType = "B" | "C" | "E" | "R" | "S" | "P" | "";
export const TYPE_NAMES: Record<string, string> = { B: "Biological", C: "Cyborg", E: "Energy", R: "Robotic", S: "Synthetic", P: "Pirate" }; // P: the Space Pirates crew cards (not in the core book's symbol list)

export interface AlienInterrupt {
  name: string;
  die: "P" | "S";
  values: number[];
  reduce: number; // damage reduction (positive)
  special: string;
  movement: boolean; // U39: stops counting from round 7
  text: string;
}
export interface AlienMan { p: number; s: number; name: string; dmg: Dice; special: string; text: string }
export interface AlienRanged { name: string; hullOk: boolean; marks: number; dmg: Dice; uses: number | null; text: string }
export interface RedBox { die: "P" | "S"; value: number }

export interface Alien {
  key: string;
  name: string;
  level: number;
  type: AlienType;
  hp: number;
  xp: number;
  sh: number;
  cache: string;
  interrupts: AlienInterrupt[];
  interruptText: string;
  deflection: RedBox[];
  deflectionText: string;
  man: AlienMan[];
  ranged: AlienRanged | null;
  rangedText: string;
  mishap: string;
  prime: string;
  desc: string;
  sectionId: string;
  turret?: boolean; // ranged only (§3.2.12)
}

const MINUS = /[−–]/g;
const norm = (s: string) => String(s ?? "").replace(MINUS, "-").replace(/\s+/g, " ").trim();

// ---------- parsing alien cards ----------
/** Interrupt names that are movement or moving an item (U39); armour-like names stay after round 6. */
export const MOVEMENT_RE =
  /\b(scamper|dodge|dip|levitat|swoop|swip|sweep|swing|spinning|movement|moves?|jump|parry|dart|strafing|scuttl|floating|flaying|writhing|thrashing|bucking|jabbing|grabbing|flailing|disappearing|shifting|erratic|quick|nimble|hover|arms?|limbs|cables|cords|drill|blades?|neck|head|robes?|boxing)\b/i;

/** A special attack line: its name, the primary dice it fires on, a damage modifier, then "special" and its effect. */
export function parseInterrupt(text: string): AlienInterrupt | null {
  const t = norm(text);
  const m = t.match(/^(.+?)\s+on\s+(Primary|Secondary)\s+(.+?)\s*-\s*(\d+)\s*damage\b\s*(?:\+\s*special\s*-?\s*(.*))?$/i);
  if (!m) return null;
  const values = [...new Set((m[3].match(/\d+(?=s\b)/g) ?? []).map(Number).filter((v) => v >= 1 && v <= 6))];
  if (!values.length) return null;
  const name = m[1].trim();
  return { name, die: m[2][0].toUpperCase() === "P" ? "P" : "S", values, reduce: +m[4], special: (m[5] ?? "").trim(), movement: MOVEMENT_RE.test(name), text: t };
}

/**
 * DEFLECTION: the red-boxed interrupt numbers. "6s", "4s, 6s" (the card's only / first interrupt's
 * die), "Primary 4s; Secondary 2s", "none".
 */
export function parseDeflection(text: string, interrupts: AlienInterrupt[]): RedBox[] {
  const t = norm(text);
  if (!t || /^none$/i.test(t)) return [];
  const out: RedBox[] = [];
  for (const part of t.split(";")) {
    const lab = part.match(/\b(Primary|Secondary)\b/i);
    const nums = (part.match(/\d+(?=s\b)/g) ?? []).map(Number).filter((v) => v >= 1 && v <= 6);
    for (const v of nums) {
      let die: "P" | "S";
      if (lab) die = lab[1][0].toUpperCase() === "P" ? "P" : "S";
      else die = interrupts.find((x) => x.values.includes(v))?.die ?? interrupts[0]?.die ?? "P";
      if (!out.some((r) => r.die === die && r.value === v)) out.push({ die, value: v });
    }
  }
  return out;
}

const DICE_RE = String.raw`(\d*\s*D\s*\d+(?:\s*[+-]\s*\d+)?|\d+)`;

/** "[3][3] - ACID SPRAY = D6 -2 + special - text" */
export function parseAlienManoeuvre(text: string): AlienMan | null {
  const t = norm(text);
  const m = t.match(/\[(\d)\]\s*\[(\d)\]\s*-?\s*(.+?)\s*=\s*(.+)$/);
  if (!m) return null;
  const rest = m[4];
  const dm = rest.match(new RegExp("^" + DICE_RE, "i"));
  const dmg = dm ? parseDamage(dm[1]) : { dice: 0, sides: 6, mod: 0 };
  let special = dm ? rest.slice(dm[0].length).trim() : rest;
  special = special.replace(/^\+?\s*special\s*-?\s*/i, "").replace(/^\((.*)\)$/, "$1").trim();
  return { p: +m[1], s: +m[2], name: m[3].trim(), dmg, special, text: t };
}

/** "Acid Mist* 5, D6 -3", "Grapple* (1 use) 6, D3", "Lance 8, 2D6 (one use)", "None". */
export function parseAlienRanged(text: string): AlienRanged | null {
  const t = norm(text);
  if (!t || /^none$/i.test(t)) return null;
  const m = t.match(/^(.*?)\s+(\d+)\s*(\*)?\s*,\s*(.+)$/);
  if (!m) return null;
  const uses = /\((?:1|one) use\)/i.test(t) ? 1 : null;
  const name = m[1].replace(/\((?:1|one) use\)/i, "").trim();
  return { name: name.replace(/\*/g, "").trim(), hullOk: name.includes("*") || !!m[3], marks: +m[2], dmg: parseDamage(m[4].replace(/\((?:1|one) use\)/i, "")), uses, text: t };
}

export function alienFromTable(t: Table, sectionId: string, sectionTitle = ""): Alien | null {
  if (!isCreatureTable(t)) return null;
  const all = (k: RegExp) => t.rows.filter((r) => k.test(r[0].trim())).map((r) => r[1] ?? "");
  const one = (k: RegExp) => all(k)[0] ?? "";
  const man = all(/^MANOEUVRES?$/i).map(parseAlienManoeuvre).filter((x): x is AlienMan => !!x);
  if (!man.length) return null; // character sheets and other Field/Value tables
  const name = norm(one(/^NAME$/i)) || norm(t.title ?? "");      // either may be unverified on a partly read book
  const lvl = one(/^LEVEL/i);
  const level = parseInt((lvl.match(/L\s*(\d+)/i) ?? sectionTitle.match(/\(L\s*(\d+)\)/i))?.[1] ?? "0", 10);
  const type = (lvl.match(/\{(?:circled\s+)?([BCERSP])\b/i)?.[1]?.toUpperCase() ?? "") as AlienType;
  const intrRows = all(/^INTERRUPTS?$/i).filter((x) => x.trim());
  const interrupts = intrRows.map(parseInterrupt).filter((x): x is AlienInterrupt => !!x);
  const deflectionText = one(/^DEFLECTION$/i);
  const rangedText = one(/^RANGED WEAPON$/i);
  return {
    key: `${name.toUpperCase()}|${level}`,
    name,
    level,
    type,
    hp: parseInt(one(/^(HP|HEALTH POINTS)$/i), 10) || 0,
    xp: parseInt(one(/^XP$/i), 10) || 0,
    sh: parseInt(norm(one(/^(SH|SHIFT)$/i)).replace("+", ""), 10) || 0,
    cache: norm(one(/^CACHE$/i)),
    interrupts,
    interruptText: intrRows.map(norm).join(" | "),
    deflection: parseDeflection(deflectionText, interrupts),
    deflectionText: norm(deflectionText),
    man,
    ranged: parseAlienRanged(rangedText),
    rangedText: norm(rangedText),
    mishap: norm(t.rows.find((r) => /MISHAP/i.test(r[0]))?.[1] ?? ""),
    prime: norm(t.rows.find((r) => /PRIME/i.test(r[0]))?.[1] ?? ""),
    desc: norm(one(/^DESCRIPTION$/i)),
    sectionId,
  };
}

/** Every alien card in the library, one per name and level, by level then name. */
export function alienIndex(sections: Section[]): Alien[] {
  const byKey = new Map<string, Alien>();
  for (const s of sections)
    for (const b of s.blocks) {
      if (b.type !== "table") continue;
      const a = alienFromTable(b.table, s.id, s.title);
      if (a && !byKey.has(a.key)) byKey.set(a.key, a);
    }
  return [...byKey.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** Search by name, or "L3" for level 3. */
export function searchAliens(all: Alien[], q: string): Alien[] {
  const s = q.trim().toLowerCase();
  if (!s) return all;
  const lv = s.match(/^l\s*(\d+)$/);
  if (lv) return all.filter((a) => a.level === +lv[1]);
  return all.filter((a) => a.name.toLowerCase().includes(s));
}

/** Find a card by the name the Hulk turn passes ("ACID DROOLER", "Acid Drooler (L1)"), or its section. */
export function findAlien(all: Alien[], name: string, sectionId?: string): Alien | undefined {
  if (sectionId) {
    const a = all.find((x) => x.sectionId === sectionId);
    if (a) return a;
  }
  const n = norm(name).replace(/\(L\d+\)/i, "").trim().toUpperCase();
  const lv = name.match(/\(L(\d+)\)/i)?.[1];
  return all.find((x) => x.name.toUpperCase() === n && (!lv || x.level === +lv)) ?? all.find((x) => x.name.toUpperCase() === n);
}

/** A turret or other ranged-only foe (IAUT tables: "Energy Blaster 7*, D6 -2", 5 HP). */
export function makeTurret(name: string, hp: number, weapon: string): Alien {
  const r = parseAlienRanged(weapon);
  return {
    key: `TURRET|${name}|${weapon}`, name, level: 0, type: "R", hp, xp: 0, sh: 0, cache: "", interrupts: [], interruptText: "", deflection: [], deflectionText: "none",
    man: [], ranged: r ? { ...r, hullOk: true } : null, rangedText: weapon, mishap: "", prime: "", desc: "Ranged combat only: you cannot get closer.", sectionId: "", turret: true,
  };
}
export const TURRET_PRESETS = [
  { name: "Automated Turret", hp: 5, weapon: "Energy Blaster 7*, D6 -2", from: "IAUT1 [4][2]" },
  { name: "Flamer Turret", hp: 4, weapon: "Flamethrower 6, D6 -1", from: "IAUT1 [6][1]" },
];

// ---------- dice and damage ----------
export const D66 = (p: number, s: number) => `[${p}][${s}]`;
export const fatigueBonus = (f: number) => (f >= 6 ? 3 : f === 5 ? 2 : f === 4 ? 1 : 0);
export const diceMax = (d: Dice) => d.dice * d.sides + d.mod;
export const diceAvg = (d: Dice) => d.dice * (d.sides + 1) / 2 + d.mod;
export function diceText(d: Dice): string {
  const base = d.dice ? `${d.dice > 1 ? d.dice : ""}D${d.sides}` : "";
  return `${base}${d.mod ? `${d.mod > 0 ? (base ? " +" : "") : " −"}${Math.abs(d.mod)}` : ""}`.trim() || "0";
}
export const addDice = (a: Dice, b: Dice): Dice => ({ dice: a.dice + b.dice, sides: a.dice ? a.sides : b.sides, mod: a.mod + b.mod });

/** Damage from raw d6 faces (D3: a face of 1–2 = 1, 3–4 = 2, 5–6 = 3). `six`: a die showed 6 (U33). */
export function damageFromFaces(d: Dice, faces: number[]): { total: number; six: boolean; text: string } {
  const vals = faces.slice(0, d.dice).map((f) => (d.sides === 3 ? Math.ceil(f / 2) : f));
  const sum = vals.reduce((t, x) => t + x, 0);
  const six = faces.slice(0, d.dice).includes(6);
  const text = `${vals.join(" + ")}${d.mod ? `${vals.length ? ` ${d.mod > 0 ? "+" : "−"} ` : d.mod < 0 ? "−" : ""}${Math.abs(d.mod)}` : ""}` || "0";
  return { total: sum + d.mod, six, text };
}
/** After reductions: never below 0, and at least 1 if a damage die showed a 6 (U33). */
export const finalDamage = (raw: number, reduce: number, six: boolean) => Math.max(six ? 1 : 0, raw - Math.max(0, reduce));

// ---------- close combat ----------
export interface Reach<M> { m: M; cost: number }
/** Manoeuvres reachable from (p, s) with up to `points` Shift (each point ±1 on one die, no wrap). */
export function reachable<M extends { p: number; s: number }>(p: number, s: number, mans: M[], points: number): Reach<M>[] {
  return mans
    .map((m) => ({ m, cost: Math.abs(m.p - p) + Math.abs(m.s - s) }))
    .filter((x) => x.cost <= Math.max(0, points))
    .sort((x, y) => x.cost - y.cost);
}
/** Aliens shift "as effectively as possible": the most powerful reachable manoeuvre (§3.2.3). */
export function alienChoice(p: number, s: number, mans: AlienMan[], points: number): Reach<AlienMan> | null {
  const r = reachable(p, s, mans, points).sort((x, y) => diceAvg(y.m.dmg) - diceAvg(x.m.dmg) || diceMax(y.m.dmg) - diceMax(x.m.dmg) || x.cost - y.cost);
  return r[0] ?? null;
}

export interface InterruptCtx { round: number; disabled: boolean } // disabled: Oil Bomb rounds 1–2, Diffusion first attack, Prime
/** The interrupt that applies to your manoeuvre's final dice: one per round, the alien picks the best (§3.2.1, §3.2.9). */
export function interruptFor(a: Pick<Alien, "interrupts">, p: number, s: number, ctx: InterruptCtx): AlienInterrupt | null {
  if (ctx.disabled) return null;
  const hits = a.interrupts.filter((x) => (ctx.round < 7 || !x.movement) && x.values.includes(x.die === "P" ? p : s));
  return hits.sort((x, y) => y.reduce - x.reduce)[0] ?? null;
}

export interface ArmourSet { index: number; name: string; reduce: number; prim: number[]; sec: number[]; yPrim: number[]; ySec: number[] }
/** A worn piece's dice by position: each group's first die is a Primary, its second a Secondary (U3). */
export function armourSets(armour: ArmourPiece[]): ArmourSet[] {
  return armour.map((a, index) => {
    const groups = parseDiceSet(a.dice);
    const out: ArmourSet = { index, name: a.name, reduce: Math.max(0, -a.mod), prim: [], sec: [], yPrim: [], ySec: [] };
    groups.forEach((g, gi) => {
      if (g[0]) {
        out.prim.push(g[0]);
        if (a.yellow?.[gi]?.[0]) out.yPrim.push(g[0]);
      }
      if (g[1]) {
        out.sec.push(g[1]);
        if (a.yellow?.[gi]?.[1]) out.ySec.push(g[1]);
      }
    });
    return out;
  });
}
/** Melee: the one piece that deflects most whose set matches the alien's final dice in position (§3.2.8). */
export function meleeDeflect(sets: ArmourSet[], p: number, s: number): ArmourSet | null {
  return sets.filter((a) => a.reduce > 0 && (a.prim.includes(p) || a.sec.includes(s))).sort((x, y) => y.reduce - x.reduce)[0] ?? null;
}
/** Ranged: the Deflection Roll D66 against yellow dice only, one piece (U29). */
export function rangedDeflect(sets: ArmourSet[], p: number, s: number): ArmourSet | null {
  return sets.filter((a) => a.reduce > 0 && (a.yPrim.includes(p) || a.ySec.includes(s))).sort((x, y) => y.reduce - x.reduce)[0] ?? null;
}
/** Your shot's Deflection Roll D66 against the alien's red-boxed numbers: the best one applies (U27). */
export function alienDeflect(a: Pick<Alien, "interrupts" | "deflection">, p: number, s: number): { box: RedBox; interrupt: AlienInterrupt | null; reduce: number } | null {
  const hits = a.deflection
    .filter((b) => b.value === (b.die === "P" ? p : s))
    .map((box) => {
      const interrupt = a.interrupts.find((x) => x.die === box.die && x.values.includes(box.value)) ?? a.interrupts.find((x) => x.die === box.die) ?? null;
      return { box, interrupt, reduce: interrupt?.reduce ?? 0 };
    })
    .sort((x, y) => y.reduce - x.reduce);
  return hits[0] ?? null;
}

const SPECIAL_ARMOUR = /layered assault suit|adaptive gel suit|void knight battlesuit/i;
/** Optional Armour Check after a deflection (§3.4): 5 damaged, 6 destroyed; the three big suits are damaged on a 6 only. */
export function armourCheck(name: string, d6: number): "ok" | "damaged" | "destroyed" {
  if (SPECIAL_ARMOUR.test(name)) return d6 === 6 ? "damaged" : "ok";
  return d6 === 6 ? "destroyed" : d6 === 5 ? "damaged" : "ok";
}

/** Too Powerful (§3.2.11, U40): your armour cancels every one of its manoeuvres. */
export function tooPowerful(a: Pick<Alien, "man" | "turret">, sets: ArmourSet[]): boolean {
  if (a.turret || !a.man.length || !sets.length) return false;
  return a.man.every((m) => {
    if (/armour cannot deflect/i.test(m.special)) return false;
    const d = meleeDeflect(sets, m.p, m.s);
    return !!d && diceMax(m.dmg) <= d.reduce;
  });
}

/** Outnumbered (optional, §3.2.10): every alien after the first gets +1 Shift. */
export const outnumberedBonus = (indexAmongLiving: number) => (indexAmongLiving > 0 ? 1 : 0);

// ---------- card text effects (Mishap, Prime, manoeuvre specials) ----------
export interface CardEffect {
  youDamage: Dice[];
  foeDamage: Dice[];
  foeHeal: Dice[];
  youSkip: boolean; // you miss the next round
  foeSkip: boolean; // it misses the next round
  foeDies: boolean;
  noXp: boolean;
  stun: number;
  bloodied: boolean;
  freeShot: boolean;
  youShiftNext: number;
  foeShiftNext: number;
  foeShift: number; // for the rest of the fight
  tables: boolean; // mentions a table to roll on (the UI offers follow-on buttons)
}
const DMG_AFTER = new RegExp(String.raw`\b(loses?|lost|lose|takes?|taking|caus(?:e|es|ing)|for|hit for)\s+(?:an?\s+extra\s+)?` + DICE_RE + String.raw`(\s*HP)?(\s*\+\s*\d+)?\s*(HP|damage|points?)?(?!\s*(?:Shift|Marksmanship|MA\b|ammo|large|random))`, "gi");

/**
 * What a card text does, read from its wording. `kind` is whose text it is: a Mishap's damage goes to
 * the alien unless "you" take it; a Prime's goes to you unless "it/they" lose it. Conditional parts
 * ("roll a D6. On a 1-2 …") are left to `conditional`.
 */
export function cardEffect(text: string, kind: "mishap" | "prime"): CardEffect {
  const e: CardEffect = { youDamage: [], foeDamage: [], foeHeal: [], youSkip: false, foeSkip: false, foeDies: false, noXp: false, stun: 0, bloodied: false, freeShot: false, youShiftNext: 0, foeShiftNext: 0, foeShift: 0, tables: /\broll on [A-Z]{2,}\d/i.test(text) };
  const t = norm(text).replace(/’/g, "'");
  if (/roll a d6/i.test(t)) return e; // conditional: resolve with `conditional`
  for (const sent of t.split(/(?<=[.!])\s+/)) {
    const s = sent.trim();
    if (!s) continue;
    const foeSubj = /\b(it|they|the \w+)\s+(loses?|lose|takes?|taking)\b/i.test(s) || /\bit lose\b/i.test(s) || (kind === "mishap" && /\byou (strike|hit|stab|lash)|\bstrike it|\bhit it|strike for|cause [^.]*damage|causing [^.]*damage/i.test(s));
    const youSubj = /^you (are|lose)\b|\byou lose\b|^lose\b|^take\b|\bstrikes? you\b|\bhits? you\b/i.test(s);
    if (/heals?\s/i.test(s)) {
      const h = s.match(new RegExp(String.raw`heals?\s+` + DICE_RE, "i"));
      if (h) e.foeHeal.push(parseDamage(h[1]));
    }
    DMG_AFTER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DMG_AFTER.exec(s))) {
      const after = s.slice(m.index + m[0].length);
      if (/^\s*next round/i.test(after)) continue; // delayed: the UI shows the text
      if (!m[3] && !m[5] && !m[4] && !/^\s*[.]?\s*$/.test(after) && !/^\s*(and|before|\.)/i.test(after)) continue;
      const d = parseDamage(m[2] + (m[4] ?? ""));
      if (!d.dice && !d.mod) continue;
      const verb = m[1].toLowerCase();
      const toFoe = /^(loses|takes|taking)$/.test(verb) ? true : youSubj && !/^(it|they)\b/i.test(s) && !/\bit loses|\bthey lose/i.test(s) ? false : foeSubj ? true : kind === "mishap";
      (toFoe ? e.foeDamage : e.youDamage).push(d);
    }
    if (/\bmisses\b[^.]*\b(next|this round)/i.test(s) || /\b(they|it)\s+(also\s+)?miss\b/i.test(s)) e.foeSkip = true;
    else if (/\bmiss the next (round|turn)/i.test(s)) e.youSkip = true;
    const st = s.match(/Stunned\s+(\d+)/i);
    if (st && /gain/i.test(s)) e.stun = Math.max(e.stun, +st[1]);
    if (/you are now bloodied|become bloodied|gain the bloodied/i.test(s)) e.bloodied = true;
    if (/\b(dies|is killed|curls up and dies)\b/i.test(s) && !/\bif\b/i.test(s)) e.foeDies = true;
    if (/do not gain the xp|gain no xp|no xp/i.test(s)) e.noXp = true;
    if (/free shot|fire once for free/i.test(s)) e.freeShot = true;
    const sh = s.match(/([+-]\d+)\s*Shift(?:\s+(?:for\s+)?(?:the\s+)?next round)?/i);
    if (sh) {
      const n = +sh[1];
      const next = /next round/i.test(s);
      const it = /\b(it|they)\s+(gains?|loses?)/i.test(s) || (kind === "mishap" && !/\byou\b/i.test(s));
      if (it) next ? (e.foeShiftNext += n) : (e.foeShift += n);
      else e.youShiftNext += n;
    } else if (/loses? (\d+) Shift next round/i.test(s)) e.foeShiftNext -= +s.match(/loses? (\d+) Shift/i)![1];
  }
  return e;
}

/** A "roll a D6, on X to Y …" clause → { lo: X, hi: Y, then: the rest } (e.g. lo 1, hi 3, then "take 1 more damage"). */
export function conditional(text: string): { lo: number; hi: number; then: string } | null {
  const t = norm(text);
  const m = t.match(/roll a d6[.,]?\s*(?:on a\s*)?(\d)(?:\s*(?:-|to|or)\s*(\d))?\s*(?:=|,)?\s*(.*)$/i);
  if (!m) return null;
  return { lo: +m[1], hi: m[2] ? +m[2] : +m[1], then: m[3].trim() };
}

// ---------- patrol SPECIAL (L1PT–L8PT) ----------
export interface PatrolSpecial {
  hp: number;
  shift: number; // whole fight
  earlyShift: number; // in the first `earlyRounds` rounds of close combat
  earlyRounds: number;
  skip: boolean; // misses the first round
  first: boolean; // attacks first
  roll: { lo: number; hi: number } | null; // the D6 this needs (none rolled, or the roll failed: nothing applies)
  manual: string; // what's left for the player (room-size Shift, free hit, "another appears")
  applied: string[];
}
/**
 * Read a patrol SPECIAL: a "Roll a D6. 4-6= …" roll that changes its HP, a missed first round, attacking
 * first, or a Shift penalty limited to the opening rounds. Room-size Shift ("in a small room")
 * and "after the combat" rolls are left to the player. Pass `d6` for a "Roll a D6" special.
 */
export function patrolSpecial(text: string, d6?: number): PatrolSpecial {
  const t = norm(text).replace(/’/g, "'");
  const out: PatrolSpecial = { hp: 0, shift: 0, earlyShift: 0, earlyRounds: 0, skip: false, first: false, roll: null, manual: "", applied: [] };
  if (!t) return out;
  let body = t;
  const c = t.match(/^roll a d6(?! after)[.,]?\s*(\d)(?:\s*-\s*(\d))?\s*=\s*(.*)$/i);
  if (c) {
    out.roll = { lo: +c[1], hi: c[2] ? +c[2] : +c[1] };
    if (d6 === undefined || d6 < out.roll.lo || d6 > out.roll.hi) return out;
    body = c[3];
  }
  if (/after the combat|re-roll|\bin a (small|normal|large) room|free hit/i.test(body)) {
    out.manual = body;
    return out;
  }
  const hp = body.match(/([+-]\d+)\s*HP/i);
  if (hp) (out.hp = +hp[1]), out.applied.push(`${hp[1]} HP`);
  const sh = body.match(/([+-]\d+)\s*Shift/i);
  if (sh) {
    if (/first (two|2) rounds/i.test(body)) (out.earlyShift = +sh[1]), (out.earlyRounds = 2);
    else if (/first round/i.test(body)) (out.earlyShift = +sh[1]), (out.earlyRounds = 1);
    else out.shift = +sh[1];
    out.applied.push(`${sh[1]} Shift${out.earlyRounds ? ` in round${out.earlyRounds > 1 ? "s 1–2" : " 1"}` : ""}`);
  }
  if (/misses the first round/i.test(body)) (out.skip = true), out.applied.push("misses round 1");
  if (/attacks first/i.test(body)) (out.first = true), out.applied.push("attacks first");
  return out;
}

// ---------- ranged combat ----------
export interface Setting { name: string; marks: number; dmg: number; burst: boolean }
/** "Single, Burst -2M +5d" → Single, Burst (−2 Marksmanship, +5 damage). */
export function parseSettings(s: string): Setting[] {
  const out: Setting[] = [{ name: "Single", marks: 0, dmg: 0, burst: false }];
  const m = norm(s).match(/Burst\s*([+-]?\d+)\s*M\s*\+?\s*(\d+)\s*d/i);
  if (m) out.push({ name: "Burst", marks: +m[1], dmg: +m[2], burst: true });
  return out;
}
/** U26: a third of the capacity, rounded up. */
export const burstAmmo = (capacity: number) => Math.max(1, Math.ceil(capacity / 3));
export const hullOkName = (name: string) => /\*/.test(name);

export interface RoomCtx { hull: boolean; reinforced: boolean }
/** May this weapon fire in this room (§3.1.1)? */
export const hullAllows = (ctx: RoomCtx, weaponHullOk: boolean) => !ctx.hull || ctx.reinforced || weaponHullOk;

/** Your Shot Roll (§3.1.2): hit when 2D6 + roll modifiers ≤ Marksmanship + Marksmanship modifiers. */
export function shotHits(dice: number[], rollMod: number, marks: number, marksMod: number) {
  const total = dice[0] + dice[1] + rollMod;
  const target = marks + marksMod;
  return { total, target, hit: total <= target, double: dice[0] === dice[1] };
}

/** Firing sequence case (§3.1.5, U32): 0 nobody, 1 alien can't, 2 its M < yours, 3 its M ≥ yours, 4 you can't. */
export function firingCase(youCan: boolean, alienBestMarks: number | null, youMarks: number): 0 | 1 | 2 | 3 | 4 {
  const alienCan = alienBestMarks !== null;
  if (!youCan && !alienCan) return 0;
  if (!alienCan) return 1;
  if (!youCan) return 4;
  return alienBestMarks < youMarks ? 2 : 3;
}
export const CASE_TEXT: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "Nobody can fire: straight to close combat.",
  1: "It has no ranged attack and charges: you get one shot at −1 to your Shot Roll, then close combat.",
  2: "Its Marksmanship is lower than yours: you both fire as it closes, then you fire once more, then close combat.",
  3: "Its Marksmanship is equal or higher: a shootout for as long as you choose. When you close, you take a shot and charge and it gets one last shot.",
  4: "It can fire and you can't: you charge and it gets one shot at −1 to its Shot Roll.",
};
/** The fixed shot order for a case (case 3 is open-ended: see the UI). U30: case 2 is you → alien → you. */
export function firingPlan(c: 0 | 1 | 2 | 3 | 4, stealth = false): ("you" | "alien")[] {
  if (stealth && c !== 0 && c !== 4) return ["you", "you"]; // Stealth Shield: two shots, no return fire
  return { 0: [], 1: ["you"], 2: ["you", "alien", "you"], 3: ["you", "alien"], 4: ["alien"] }[c] as ("you" | "alien")[];
}

/** Shot roll modifiers from your active stim effects (Focused Vision −1, Magnified Senses −2). */
export function stimShotMod(effects: { name: string }[]): number {
  const has = (n: string) => effects.some((e) => e.name.toLowerCase() === n);
  return has("magnified senses") ? -2 : has("focused vision") ? -1 : 0; // spec U9: stims don't stack
}
/** Damage stims active this combat (Electric Discharge, Energy Surge, Muscle Boost, Toughen Skin, Momentum). */
export function stimCombat(effects: { name: string }[], level: number) {
  const has = (n: string) => effects.some((e) => e.name.toLowerCase() === n);
  return {
    firstHit: (has("electric discharge") ? 2 * level : 0) + (has("energy surge") ? 10 : 0),
    perHit: has("muscle boost") ? level : 0,
    toughen: has("toughen skin") ? level : 0,
    momentum: has("momentum"),
    insight: has("insight"),
  };
}

// ---------- weapon doubles table and specials ----------
export interface DoublesRow { lo: number; hi: number; text: string }
/** "1 - text\n2-4 - text\n3-6 - text" */
export function parseDoubles(s: string): DoublesRow[] {
  return norm(String(s ?? "").replace(/\n/g, " ¶ "))
    .split("¶")
    .map((l) => l.trim().match(/^(\d)(?:\s*-\s*(\d))?\s*-\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ lo: +m[1], hi: m[2] ? +m[2] : +m[1], text: m[3].trim() }));
}
/** The row for a D6; a gap in the table (Halo Suppressor 2 and 5) reads as "nothing happens". */
export const doublesRow = (rows: DoublesRow[], d6: number): DoublesRow =>
  rows.find((r) => d6 >= r.lo && d6 <= r.hi) ?? { lo: d6, hi: d6, text: "Nothing happens." };

export interface DoublesEffect {
  noFire: boolean; // this shot doesn't happen
  lock: boolean; // can't fire again this combat
  broken: boolean; // needs repair
  bonus: Dice | null; // extra damage if it hits (can be negative)
  doubleDmg: boolean;
  selfDamage: Dice | null;
  extraAmmo: number; // more rounds lost (Infinity: all of them; −1: none spent)
  shotMod: number;
  foeSkip: boolean;
  text: string;
}
export function doublesEffect(text: string): DoublesEffect {
  const t = norm(text);
  const fires = /\byou fire but\b|fires as normal|resolve hit or miss|two bolts fire|all 4 lashes fire/i.test(t);
  const noFire = !fires && /cannot be fired|does not fire|doesn'?t fire|refuses to fire|fails to fire|not fire this round|\bjams\b|misfires|fizzles|falls short|short of the target|before reaching the target|explodes|it does no damage|no damage or|trigger breaks|backfires|surge of power/i.test(t);
  const broken = /repair|destroyed|rendered useless|trigger breaks|cannot be fired\. you will need/i.test(t);
  const lock = broken || /cannot (?:be fired|fire|use it|attack with)[^.]*?(again|this combat)|not fire again|will not fire again|cannot be fired this combat|until the following combat|cannot be used again this combat|cannot be fired again/i.test(t);
  let bonus: Dice | null = null;
  const b =
    t.match(new RegExp(String.raw`(?:extra|additional)\s+` + DICE_RE + String.raw`\s*(?:HP\s*)?(?:points of\s*)?damage`, "i")) ??
    t.match(new RegExp(String.raw`(?:causes|adds)\s+\+?` + DICE_RE + String.raw`\s*(?:HP\s*)?damage`, "i")) ??
    t.match(/\+\s*(\d+)\s*(?:HP\s*)?damage/i);
  if (b) bonus = parseDamage(b[1]);
  const neg = t.match(/does\s+-\s*(\d+)\s*damage/i);
  if (neg) bonus = { dice: 0, sides: 6, mod: -+neg[1] };
  const self =
    t.match(new RegExp(String.raw`\b(?:lose|take)\s+` + DICE_RE + String.raw`\s*(?:HP|damage)`, "i")) ??
    t.match(new RegExp(String.raw`causing you\s+` + DICE_RE + String.raw`\s*damage`, "i")) ??
    t.match(new RegExp(String.raw`causes\s+` + DICE_RE + String.raw`\s*damage to you`, "i")) ??
    t.match(new RegExp(String.raw`your (?:arm|hand)s?[^.]*?causing\s+` + DICE_RE + String.raw`\s*damage`, "i"));
  let extraAmmo = 0;
  if (/all the ammo is wasted/i.test(t)) extraAmmo = Infinity;
  else if (/no ammo is spent/i.test(t)) extraAmmo = -1;
  else if (/the ammo is spent/i.test(t)) extraAmmo = 1; // spent although it didn't fire
  else {
    const a = t.match(/lose (\d+) (?:extra )?ammo/i) ?? t.match(/-\s*(\d+) ammo/i);
    if (a) extraAmmo = /bolts fire/i.test(t) ? +a[1] - 1 : +a[1];
  }
  const sm = t.match(/([+-]\d+) to your shot roll/i);
  return {
    noFire, lock, broken, bonus, doubleDmg: /double damage/i.test(t), selfDamage: self ? parseDamage(self[1]) : null, extraAmmo,
    shotMod: sm ? +sm[1] : 0, foeSkip: /miss the next round/i.test(t) || (/cannot (?:fire or )?attack/i.test(t) && /\bin the first\b/i.test(t)), text: t,
  };
}

export interface WeaponSpecial {
  bioBonus: number; // extra damage vs Biological aliens
  bioOnly: boolean;
  oncePerCombat: boolean;
  robotKiller: boolean; // a weapon made for robots
  onHit: { lo: number; hi: number; then: string; bonus: number; foeSkip: boolean; noReturnFire: boolean } | null;
  firstMeleeShift: number; // e.g. a sonic weapon: −1 Shift to the target in the first melee round
  splash: "same" | "d6" | null; // Ore Cannon: other enemies take the same; Starburn: a second enemy takes D6
}
export function weaponSpecial(special: string): WeaponSpecial {
  const t = norm(special);
  const bio = t.match(/(?:extra|\+)\s*(\d+)\s*damage (?:when used )?against biological/i);
  const cond = t.match(/roll a d6[^.]*\.\s*(?:on a\s*)?(\d)(?:\s*-\s*(\d))?\s*=?\s*([^]*)$/i) ?? t.match(/(?:if you hit|on a hit|successful hit)[^.]*?on a (\d)(?:\s*-\s*(\d))?\s*([^]*)$/i);
  let onHit: WeaponSpecial["onHit"] = null;
  if (cond && /hit/i.test(t) && !/burst/i.test(t)) {
    const then = cond[3].trim();
    const b = then.match(/(?:extra|\+)\s*(\d+)\s*damage/i);
    onHit = { lo: +cond[1], hi: cond[2] ? +cond[2] : +cond[1], then, bonus: b ? +b[1] : 0, foeSkip: /cannot (?:fire or )?attack/i.test(then), noReturnFire: /cannot return fire|cannot fire/i.test(then) };
  }
  const fm = /\bof melee\b/i.test(t) ? t.match(/(-\d+) Shift for the first round/i) : null; // "… for the first round of melee"
  return {
    bioBonus: bio ? +bio[1] : 0,
    bioOnly: /only be used against biological/i.test(t),
    oncePerCombat: /only be fired once per combat/i.test(t),
    robotKiller: /destroys one robot/i.test(t),
    onHit,
    firstMeleeShift: fm ? +fm[1] : 0,
    splash: /additional enem\w*[^.]*same damage/i.test(t) ? "same" : /second enemy[^.]*take d6/i.test(t) ? "d6" : null,
  };
}

// ---------- throwing weapons (§3.2.6) ----------
export type ThrowKind = "pipe" | "spiked" | "mag" | "oil" | "diffusion";
export const THROWS: Record<ThrowKind, { name: string; text: string }> = {
  pipe: { name: "Metal Pipe", text: "5 damage to Biological aliens." },
  spiked: { name: "Spiked Metal Pipe", text: "10 damage to Biological aliens." },
  mag: { name: "Mag Grenade", text: "30 damage to metal or metal-armoured aliens. Not in rooms touching the hull." },
  oil: { name: "Oil Bomb", text: "On a hit it can't use interrupts in the first 2 rounds. Deflected by either interrupt, it doesn't work." },
  diffusion: { name: "Diffusion Grenade", text: "EMP: robots, cyborgs and mechanical aliens miss their pre-combat fire and can't defend against your first melee attack. Not affected by interrupts." },
};
export const isMetal = (a: Pick<Alien, "type" | "interrupts">) =>
  a.type === "R" || a.type === "C" || a.interrupts.some((x) => /metal|plat(e|ing)|armou?r|chrome|alloy|mech/i.test(x.name));
/** Why this throw can't be used here, or null. */
export function throwProblem(kind: ThrowKind, ctx: RoomCtx): string | null {
  if (kind === "mag" && ctx.hull && !ctx.reinforced) return "Mag Grenades can't be used in rooms touching the hull (U35: allowed if reinforced).";
  return null;
}
/**
 * Resolve a throw against `a` with a D66 (§3.2.6): it always hits; a Primary matching a Primary
 * interrupt or a Secondary matching a Secondary interrupt subtracts that interrupt (both: both).
 */
export function resolveThrow(kind: ThrowKind, a: Pick<Alien, "type" | "interrupts">, p: number, s: number, mod = 0) {
  const matched = a.interrupts.filter((x) => x.values.includes(x.die === "P" ? p : s));
  const firstP = matched.find((x) => x.die === "P");
  const firstS = matched.find((x) => x.die === "S");
  const hits = [firstP, firstS].filter((x): x is AlienInterrupt => !!x);
  const reduce = hits.reduce((t, x) => t + x.reduce, 0);
  let base = 0;
  let note = "";
  if (kind === "pipe" || kind === "spiked") {
    if (a.type === "B") base = (kind === "spiked" ? 10 : 5) + mod;
    else note = "Not Biological: no damage (U35).";
  } else if (kind === "mag") {
    if (isMetal(a)) base = 30 + mod;
    else note = "Not metal: no damage.";
  }
  const deflected = kind !== "diffusion" && hits.length > 0;
  const damage = kind === "diffusion" ? 0 : Math.max(0, base - reduce);
  const works = kind === "oil" ? !deflected : kind === "diffusion" ? a.type === "R" || a.type === "C" : true;
  return { hits, reduce: kind === "diffusion" ? 0 : reduce, damage, deflected, works, note };
}
/** A metal pipe after the fight: deflected = lost; otherwise D6 1–3 lost, 4–6 recovered. */
export const pipeRecovered = (d6: number) => d6 >= 4;

// ---------- winning ----------
export type KillBy = "melee" | "ranged" | "throw" | "other";
/** XP for a won fight (§3.5): card XP for aliens killed in close combat; ranged-only kills give none. */
export function fightXp(foes: { xp: number; killedBy: KillBy | null; noXp?: boolean }[]): number {
  return foes.reduce((n, f) => n + (f.killedBy === "melee" && !f.noXp ? f.xp : 0), 0);
}
/** The Insight stim adds 1 to every die of a Cache roll. */
export function insightMod(dice: string | null | undefined): number {
  const d = String(dice ?? "").toUpperCase();
  if (d === "D66") return 11;
  const m = d.match(/^(\d*)D6$/);
  return m ? +(m[1] || 1) : 0;
}
