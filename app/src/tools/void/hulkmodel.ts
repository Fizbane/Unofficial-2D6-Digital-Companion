// 2D6 Void: the Hulk turn's rules as pure functions (docs/spec-void.md §2). No DOM and no dice:
// the UI rolls and passes the numbers in, so everything here is unit-tested
// (test/void/hulkmodel.test.ts). The map itself is a DungeonMap (dmap.ts) sized 17×28.
import { addRoom, findPlacement, newMap, openExits, placeEntrance, DIR, type DungeonMap, type ExitType, type MapExit, type MapRoom, type RoomKind, type Side } from "../dmap";
import { namesIn } from "../common";

export const HULK_W = 17;
export const HULK_H = 28;
export const HULK_AREA = HULK_W * HULK_H; // 476 squares
export type HulkKind = RoomKind;
export type Pair = [number, number];

const OPP: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };
const CLOCKWISE: Side[] = ["N", "E", "S", "W"];

// ---------- levels (§2.12, §2.13) ----------
export interface LevelInfo {
  name: string;
  intro: string; // section id of the level intro page
  entrance: { w: number; h: number; exits: number; west?: boolean }; // U12: the first number is X
  effects: string; // what the intro gives you in the entrance room
  rules: string[]; // level rules worth showing on the turn
}

export const LEVELS: Record<number, LevelInfo> = {
  1: { name: "The Systems Deck", intro: "void/p92-2", entrance: { w: 4, h: 2, exits: 3 }, effects: "A flask of tea: drink it to heal 5 HP.", rules: ["You recognise reinforced rooms (marked *): ranged combat is allowed in them even against the hull."] },
  2: { name: "The Detention Level", intro: "void/p101-2", entrance: { w: 3, h: 3, exits: 3 }, effects: "A glass case: roll on GACT1.", rules: ["Shreev culture: SHVT1 and STHT1 are called by room text."] },
  3: { name: "The Containment Deck", intro: "void/p109-2", entrance: { w: 2, h: 3, exits: 3 }, effects: "Lose 1 HP; you find a Healing Patch (10 HP).", rules: ["Filter Mask: you can't wear head armour on this level."] },
  4: { name: "The Genesis Level", intro: "void/p120-2", entrance: { w: 3, h: 3, exits: 3 }, effects: "From a corpse here: one Medical stim and one dry ration.", rules: ["Parlax robots roam this level."] },
  5: { name: "Military Level", intro: "void/p127-2", entrance: { w: 2, h: 4, exits: 3 }, effects: "A locked box: a Gamma Code or hex slot key opens it for 3 Healing Patches (10 HP each). The face mask is ruined.", rules: [] },
  6: { name: "Mutation Sector", intro: "void/p136-2", entrance: { w: 3, h: 3, exits: 3 }, effects: "+500 XP. A red orb: touch it to roll on PMTT1 (once).", rules: [] },
  7: { name: "Archive Level", intro: "void/p145-2", entrance: { w: 3, h: 3, exits: 3 }, effects: "+800 XP. Choose a research designation (Biological, Geographical or Astronomical).", rules: ["From level 7 on, room text calls the Level Encounters Table (L7ET1); re-roll a repeated unique encounter."] },
  8: { name: "Mining Level", intro: "void/p155-2", entrance: { w: 2, h: 4, exits: 3 }, effects: "+1000 XP, 3 Healing Patches and a precious stone guide.", rules: ["Gem pairs can be bound into throwing weapons (see the level intro)."] },
  9: { name: "The Null Void", intro: "void/p163-1", entrance: { w: 3, h: 3, exits: 3 }, effects: "Nothing in the entrance room.", rules: ["No small rooms: a small-room roll uses SSRT1, then the normal Level Rooms table.", "No patrols and no Alarm Checks.", "The Void Chamber (3×3, no exits) sits in the middle of the map; Void Portals lead to it."] },
  10: { name: "AI Hive", intro: "void/p176-1", entrance: { w: 3, h: 2, exits: 1, west: true }, effects: "Roll on ADWT1.", rules: ["A fixed chain of rooms, each with one archway exit: small rooms (L10SR) alternate with the four AI Abominations, then the Escape Pod.", "Camo Tent usable twice. No Alarm Checks."] },
};

export interface LevelTables {
  rooms: string | null; // Level N Rooms (D66)
  sr: string | null; // small rooms (2D6), or SSRT1 on L9
  lr: string | null; // large rooms (2D6)
  patrol: string | null;
  encounters: string | null; // IAUT / Level Encounters (only rolled when room text says so)
}
// Sections are named by their locked-book id (void/p<page>-<n>, from pipeline/work/id-map-void.json), never by
// title: the dist check fails a build whose code carries a book title.
const LV: Record<number, string> = { 1: "void/p98-1", 2: "void/p106-1", 3: "void/p116-1", 4: "void/p124-1", 5: "void/p133-1", 6: "void/p142-1", 7: "void/p152-1", 8: "void/p160-1", 9: "void/p168-1" };
const SR: Record<number, string> = { 1: "void/p97-1", 2: "void/p105-1", 3: "void/p115-1", 4: "void/p123-1", 5: "void/p132-1", 6: "void/p141-1", 7: "void/p151-1", 8: "void/p159-1", 10: "void/p180-1" };
const LR: Record<number, string> = { 1: "void/p95-1", 2: "void/p103-1", 3: "void/p113-1", 4: "void/p121-1", 5: "void/p130-1", 6: "void/p139-1", 7: "void/p149-1", 8: "void/p157-1", 9: "void/p167-1" };
const PT: Record<number, string> = { 1: "void/p96-1", 2: "void/p104-1", 3: "void/p114-1", 4: "void/p122-1", 5: "void/p131-1", 6: "void/p140-1", 7: "void/p150-1", 8: "void/p158-1" };
const lv = (n: number) => LV[n] ?? "";
const sr = (n: number) => SR[n] ?? "";
const lr = (n: number) => LR[n] ?? "";
const pt = (n: number) => PT[n] ?? "";
// Tables whose names the Dungeon books share are named by code, not by a title-slug section id: the
// dist check (scripts/check-dist.mjs) fails a build whose code carries a locked Dungeon title.
const IAUT = ["IAUT1", "IAUT2", "IAUT3"];
export const SSRT1 = "void/p172-2";
export const L10SR = "L10SR"; // by code (see IAUT)
export const L10_SPECIAL = "void/p181-1";
export const SLDT1 = "void/p84-1";
export const FAST1 = "void/p67-2";
export const VOET1 = "void/p175-1";

export const LEVEL_TABLES: Record<number, LevelTables> = {
  1: { rooms: lv(1), sr: sr(1), lr: lr(1), patrol: pt(1), encounters: IAUT[0] },
  2: { rooms: lv(2), sr: sr(2), lr: lr(2), patrol: pt(2), encounters: IAUT[0] },
  3: { rooms: lv(3), sr: sr(3), lr: lr(3), patrol: pt(3), encounters: IAUT[1] },
  4: { rooms: lv(4), sr: sr(4), lr: lr(4), patrol: pt(4), encounters: IAUT[1] },
  5: { rooms: lv(5), sr: sr(5), lr: lr(5), patrol: pt(5), encounters: IAUT[2] },
  6: { rooms: lv(6), sr: sr(6), lr: lr(6), patrol: pt(6), encounters: null },
  7: { rooms: lv(7), sr: sr(7), lr: lr(7), patrol: pt(7), encounters: "void/p148-1" },
  8: { rooms: lv(8), sr: sr(8), lr: lr(8), patrol: pt(8), encounters: "void/p156-1" },
  9: { rooms: lv(9), sr: SSRT1, lr: lr(9), patrol: null, encounters: "void/p166-1" },
  10: { rooms: null, sr: L10SR, lr: null, patrol: null, encounters: null },
};

/** Which table identifies a room of this kind on this level (§2.6, §2.13). */
export function identityTable(level: number, kind: HulkKind): { sectionId: string | null; via?: "ssrt"; note?: string } {
  const t = LEVEL_TABLES[level];
  if (kind === "entrance" || kind === "corridor") return { sectionId: null, note: kind === "corridor" ? "Corridors have no room table and no encounter." : "The entrance room comes from the level intro." };
  if (level === 10) return { sectionId: null, note: "Level 10 is a fixed chain of rooms." };
  if (kind === "small") return level === 9 ? { sectionId: SSRT1, via: "ssrt", note: "Level 9 has no small rooms: roll SSRT1 (it resizes the space), then the normal Level 9 Rooms table." } : { sectionId: t.sr };
  if (kind === "large") return { sectionId: t.lr };
  return { sectionId: t.rooms };
}

/** The level's patrol table, or null where there is none (L9, L10: U22). */
export const patrolTable = (level: number): string | null => LEVEL_TABLES[level]?.patrol ?? null;

/** Camo Tent uses per level (§1.12): once, twice on L10. */
export const camoUses = (level: number) => (level === 10 ? 2 : 1);
/** Alarm Checks happen on every level but 9 and 10 (§2.10). */
export const hasAlarmChecks = (level: number) => level !== 9 && level !== 10;
/** Alarm Check: 2D6 + Technical ≥ 8 = undetected (roll-high, §2.10). */
export const alarmCheck = (roll2d6: number, tech: number) => roll2d6 + tech >= 8;

// ---------- room size (§2.3) ----------
export const isDouble = (d: Pair) => d[0] === d[1];
/** Doubles 1–5 roll again and add; double 6 is a 6×6 room with no re-roll. */
export const needsSecondRoll = (d: Pair) => isDouble(d) && d[0] !== 6;

export interface Dimensions { x: number; y: number; kind: HulkKind; note: string }

/**
 * Resolve a D66 size roll (P = X across, S = Y down). `second` is the extra D66 after doubles 1–5;
 * a second double does not trigger another re-roll.
 */
export function resolveDimensions(first: Pair, second?: Pair): Dimensions {
  const [p, s] = first;
  if (isDouble(first)) {
    if (p === 6) return { x: 6, y: 6, kind: "large", note: "Double 6: a 6 × 6 room (no re-roll), which is large." };
    if (!second) throw new Error("Doubles 1–5 need a second D66 roll");
    const x = p + second[0], y = s + second[1];
    const kind = classifyRolled(x, y, true);
    return { x, y, kind, note: `Doubles: rolled again ${second[0]}${second[1]} and added, ${x} × ${y}${kind === "large" ? " (32 squares or more: large)" : ""}.${isDouble(second) ? " A second double doesn't re-roll again." : ""}` };
  }
  const kind = classifyRolled(p, s, false);
  const why = kind === "corridor" ? " A 1 makes a corridor." : kind === "small" ? " A 2–3 roll makes a small room (6 squares)." : "";
  return { x: p, y: s, kind, note: `${p} × ${s}.${why}` };
}

/** The kind a rolled size gives (§2.3): a 1 (not doubled) is a corridor, 2-3 / 3-2 small, doubles ≥ 32 large. */
export function classifyRolled(x: number, y: number, fromDoubles: boolean): HulkKind {
  if (!fromDoubles && (x === 1 || y === 1)) return "corridor";
  if (!fromDoubles && x * y === 6 && (x === 2 || x === 3)) return "small";
  if (fromDoubles && x * y >= 32) return "large";
  if (x * y <= 6) return "small";
  return "regular";
}

/**
 * The kind once drawn on the map (squeezed by other rooms or the hull). U14 reading: both thresholds
 * use the drawn area. 1 square wide = corridor; ≤ 6 squares = small; a large room squeezed under
 * 32 squares becomes a standard room.
 */
export function classifyDrawn(rolled: HulkKind, w: number, h: number): HulkKind {
  if (rolled === "entrance") return "entrance";
  if (w === 1 || h === 1 || rolled === "corridor") return "corridor";
  if (w * h <= 6) return "small";
  if (rolled === "large" && w * h >= 32) return "large";
  return "regular";
}

// ---------- exits (§2.4, §2.5) ----------
/** D6 → number of exits added: 1 = 0 (dead end), 2–3 = 1, 4–5 = 2, 6 = 3. */
export const exitCount = (d6: number) => (d6 <= 1 ? 0 : d6 <= 3 ? 1 : d6 <= 5 ? 2 : 3);

/** The three walls clockwise from the wall you came in by (the entry wall is never used). */
export function clockwiseWalls(entry: Side | null): Side[] {
  const start = CLOCKWISE.indexOf(entry ?? "S");
  return [1, 2, 3].map((k) => CLOCKWISE[(start + k) % 4]);
}

function occupied(m: DungeonMap): Set<string> {
  const o = new Set<string>();
  for (const r of m.rooms) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) o.add(`${x},${y}`);
  for (const e of m.exits) o.add(`${e.x},${e.y}`);
  if (m.entrance) o.add(`${m.entrance.x},${m.entrance.y}`);
  return o;
}
const inside = (m: DungeonMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;

/**
 * Where an exit square can go on a wall, centre first. It must be inside the hull and free, and
 * (U16 reading) the square past it too, so the exit doesn't open straight onto another room or the hull.
 */
export function exitSpots(m: DungeonMap, r: MapRoom, side: Side, occ = occupied(m)): [number, number][] {
  const out: [number, number][] = [];
  const [dx, dy] = DIR[side];
  const along = side === "N" || side === "S";
  const len = along ? r.w : r.h;
  const mid = Math.floor((len - 1) / 2);
  for (let k = 0; k < len; k++)
    for (const s of k === 0 ? [0] : [k, -k]) {
      const i = mid + s;
      if (i < 0 || i >= len) continue;
      const x = along ? r.x + i : side === "W" ? r.x - 1 : r.x + r.w;
      const y = along ? (side === "N" ? r.y - 1 : r.y + r.h) : r.y + i;
      if (!inside(m, x, y) || occ.has(`${x},${y}`)) continue;
      if (!inside(m, x + dx, y + dy) || occ.has(`${x + dx},${y + dy}`)) continue;
      out.push([x, y]);
    }
  return out;
}

/**
 * Place up to `count` new exits on room r (§2.4): never on the entry wall or the hull, one per wall,
 * at most 3. `d3` picks the first wall clockwise from the entrance (1/2/3); the next exits carry on
 * clockwise (U17), skipping walls that can't take one. Exits that don't fit are ignored.
 */
export function placeHulkExits(m: DungeonMap, r: MapRoom, entry: Side | null, count: number, type: ExitType, d3 = 1): MapExit[] {
  m.exits = m.exits.filter((e) => e.room !== r.id || e.to !== undefined); // a re-roll replaces unused exits
  const used = new Set(m.exits.filter((e) => e.room === r.id && e.to !== undefined).map((e) => e.side));
  if (entry) used.add(entry);
  const walls = clockwiseWalls(entry);
  const first = Math.max(0, Math.min(2, d3 - 1));
  const out: MapExit[] = [];
  let k = first;
  for (let tries = 0; tries < 3 && out.length < Math.min(3, count); tries++, k = (k + 1) % 3) {
    const side = walls[k];
    if (used.has(side)) continue;
    const spot = exitSpots(m, r, side)[0];
    if (!spot) continue;
    const e: MapExit = { id: m.nextId++, room: r.id, side, x: spot[0], y: spot[1], type };
    m.exits.push(e);
    out.push(e);
    used.add(side);
  }
  return out;
}

/** The book's EXITS / EXITS/NEXT cell as a map exit type (U18: treat EXITS/NEXT as EXITS). */
export function parseVoidExit(cell: string | undefined): ExitType {
  const t = (cell ?? "").toUpperCase();
  if (/ARCH/.test(t)) return "archway";
  if (/SLIDING/.test(t)) return "sliding";
  if (/SECURITY/.test(t)) return "security";
  if (/BIO/.test(t)) return "biocoded";
  if (/ELECTRIC|BARRIER/.test(t)) return "barrier";
  return "unknown";
}

/** Exit type for a room (§2.5): small rooms, corridors, entrances and all of L10 are archways; else the table cell. */
export function exitTypeFor(level: number, kind: HulkKind, cell?: string): ExitType {
  if (kind === "small" || kind === "corridor" || kind === "entrance" || level === 10) return "archway";
  return parseVoidExit(cell);
}

export const isVoidDoor = (t: ExitType) => t === "sliding" || t === "security" || t === "biocoded";
export const VOID_EXIT_NAME: Partial<Record<ExitType, string>> = {
  archway: "Archway", sliding: "Sliding door", security: "Security door", biocoded: "Bio-coded door", barrier: "Electrical barrier", secret: "Secret panel", unknown: "Exit",
};

// ---------- doors, locks and barriers (§2.8) ----------
/** Lowest D6 that means locked: sliding 6, security 5–6, bio-coded 4–6. */
export const lockThreshold = (t: ExitType): number | null => (t === "sliding" ? 6 : t === "security" ? 5 : t === "biocoded" ? 4 : null);
export const isLocked = (t: ExitType, d6: number) => {
  const th = lockThreshold(t);
  return th !== null && d6 >= th;
};
/** Crowbar a locked sliding door: 2D6 ≤ Technical opens it cleanly, otherwise it opens with an SLDT1 hitch. */
export const forceSliding = (roll2d6: number, tech: number) => roll2d6 <= tech;
/**
 * Hack a security pad: 2D6 over Coding fails (FAST1). U21 reading: "−2 for each attempt" is a −2
 * roll modifier per earlier attempt, cumulative (a negative modifier makes a roll-under check easier).
 */
export function hackSecurity(roll2d6: number, coding: number, attempt: number): { total: number; ok: boolean; modifier: number } {
  const modifier = -2 * Math.max(0, attempt - 1);
  const total = roll2d6 + modifier;
  return { total, ok: total <= coding, modifier };
}
/** A bio-coded scanner: D6 (+1 if you've met more than one of that alien on this level), 4–6 opens. */
export const bioLimb = (d6: number, metMore: boolean) => d6 + (metMore ? 1 : 0) >= 4;
/** An electrical barrier costs D6 per Hulk level to pass (L4 = 4D6). */
export const barrierDice = (level: number) => `${Math.max(1, level)}D6`;

// ---------- uniques, % explored, boss rooms (§2.6, §2.9) ----------
/** "YES" = one per level; "NN% YES" = also only after about NN% of the level is explored. */
export function uniqueRule(cell: string | undefined): { unique: boolean; pct: number | null } {
  const t = (cell ?? "").toUpperCase();
  const m = t.match(/(\d+)\s*%/);
  return { unique: /YES/.test(t) || !!m, pct: m ? +m[1] : null };
}
export const sameRoom = (a: string, b: string) => a.replace(/\*/g, "").trim().toUpperCase() === b.replace(/\*/g, "").trim().toUpperCase();

/** Should a room-table result stand, or be re-rolled (a unique already met, or a boss room too early)? */
export function uniqueVerdict(name: string, uniqueCell: string | undefined, seen: string[], explored: number): "ok" | "duplicate" | "too-early" {
  const u = uniqueRule(uniqueCell);
  if (u.unique && seen.some((s) => sameRoom(s, name))) return "duplicate";
  if (u.pct !== null && explored < u.pct) return "too-early";
  return "ok";
}

/** Special Unique (boss) rooms of a room table: rows whose UNIQUE cell is "NN% YES". */
export function specialUniques(columns: string[], rows: string[][]): { name: string; pct: number; row: number }[] {
  const ui = columns.findIndex((c) => /UNIQUE/i.test(c));
  const ni = columns.findIndex((c) => /ROOM TYPE/i.test(c));
  if (ui < 0 || ni < 0) return [];
  return rows.flatMap((r, row) => {
    const u = uniqueRule(r[ui]);
    return u.pct !== null ? [{ name: r[ni], pct: u.pct, row }] : [];
  });
}

/**
 * How much of the level is explored, in % of the 17×28 hull (U19 reading: drawn floor area — rooms,
 * exit squares and the entrance square — out of 476). Rooms in `exclude` (the L9 Void Chamber,
 * which is pre-drawn) don't count (U24).
 */
export function exploredPct(m: DungeonMap, exclude: number[] = []): number {
  const occ = new Set<string>();
  for (const r of m.rooms) if (!exclude.includes(r.id)) for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) occ.add(`${x},${y}`);
  for (const e of m.exits) if (!exclude.includes(e.room)) occ.add(`${e.x},${e.y}`);
  if (m.entrance) occ.add(`${m.entrance.x},${m.entrance.y}`);
  return Math.round((occ.size / (m.w * m.h)) * 100);
}

/** No way on and under 50% generated: add a secret panel instead of the ladder (§2.9). */
export const secretDoorAllowed = (m: DungeonMap, explored: number) => openExits(m).length === 0 && explored < 50;

/**
 * A spot for a one-way Secret Panel: the wall (of any room but `exclude`) with the most empty space
 * past it ("the room with the most empty space around it").
 */
export function secretDoorSpot(m: DungeonMap, exclude: number[] = []): { room: number; side: Side; x: number; y: number } | null {
  const occ = occupied(m);
  let best: { room: number; side: Side; x: number; y: number; score: number } | null = null;
  for (const r of m.rooms) {
    if (exclude.includes(r.id) || r.draft) continue;
    for (const side of CLOCKWISE) {
      const spot = exitSpots(m, r, side, occ)[0];
      if (!spot) continue;
      const [dx, dy] = DIR[side];
      let score = 0;
      for (let a = 1; a <= 6; a++)
        for (let b = -3; b <= 3; b++) {
          const x = spot[0] + dx * a + (dx === 0 ? b : 0), y = spot[1] + dy * a + (dy === 0 ? b : 0);
          if (inside(m, x, y) && !occ.has(`${x},${y}`)) score++;
        }
      if (!best || score > best.score) best = { room: r.id, side, x: spot[0], y: spot[1], score };
    }
  }
  return best && { room: best.room, side: best.side, x: best.x, y: best.y };
}
export function addSecretDoor(m: DungeonMap, exclude: number[] = []): MapExit | null {
  const s = secretDoorSpot(m, exclude);
  if (!s) return null;
  const e: MapExit = { id: m.nextId++, room: s.room, side: s.side, x: s.x, y: s.y, type: "secret" };
  m.exits.push(e);
  return e;
}

/** The square holding the down-ladder of a room (where the map draws it): its bottom-right square. */
export const ladderCell = (r: MapRoom): { x: number; y: number } => ({ x: r.x + r.w - 1, y: r.y + r.h - 1 });

// ---------- level setup (§2.1, §2.2, §2.12) ----------
export const hulkMap = (): DungeonMap => ({ ...newMap(1), w: HULK_W, h: HULK_H });

export interface LevelSetup {
  map: DungeonMap;
  entrance: MapRoom;
  ladderIn: { x: number; y: number } | null; // the up-ladder exit square (levels 2–9)
  voidChamber: number | null; // L9: the Void Chamber's room id
  note: string;
}

/**
 * Start a level: the 17×28 hull, the entrance room from the intro with its archway exits
 * (three if they fit; L10: one in the west wall), and on L9 the Void Chamber in the middle.
 * L1 and L10 enter mid-south; later levels put the up-ladder directly below the last level's
 * down-ladder (`prevLadder`), in an exit square facing into the hull.
 */
export function setupLevel(level: number, prevLadder: { x: number; y: number } | null): LevelSetup {
  const m = hulkMap();
  const info = LEVELS[level];
  const { w, h } = info.entrance;
  let voidChamber: number | null = null;
  const notes: string[] = [];
  if (level === 9) {
    // the middle of the map, nudged if the ladder lands in or next to it
    const cx = Math.floor((HULK_W - 3) / 2), cy = Math.floor((HULK_H - 3) / 2);
    const clear = (x: number, y: number) => !prevLadder || prevLadder.x < x - 1 || prevLadder.x > x + 3 || prevLadder.y < y - 1 || prevLadder.y > y + 3;
    const spots: [number, number][] = [[cx, cy], [cx, cy - 4], [cx, cy + 4], [cx - 4, cy], [cx + 4, cy]];
    const [vx, vy] = spots.find(([x, y]) => clear(x, y)) ?? spots[0];
    voidChamber = addRoom(m, { n: 0, x: vx, y: vy, w: 3, h: 3, kind: "regular", label: "Void Chamber", sub: "Void Portal" }).id;
  }
  let entrance: MapRoom | null = null;
  let ladderIn: { x: number; y: number } | null = null;
  if (level !== 1 && level !== 10 && prevLadder && inside(m, prevLadder.x, prevLadder.y)) {
    // the room goes on whichever side of the ladder square fits it best (into the Hulk, not the hull)
    let best: { side: Side; p: { x: number; y: number; w: number; h: number } } | null = null;
    for (const side of ["N", "E", "W", "S"] as Side[]) {
      const p = findPlacement(m, { id: -1, room: 0, side, x: prevLadder.x, y: prevLadder.y, type: "archway" }, w, h);
      if (p && (!best || p.w * p.h > best.p.w * best.p.h)) best = { side, p };
    }
    if (best) {
      entrance = addRoom(m, { n: 1, ...best.p, kind: "entrance", label: "Entrance Room", sub: "" });
      ladderIn = { ...prevLadder };
      m.exits.push({ id: m.nextId++, room: entrance.id, side: OPP[best.side], x: prevLadder.x, y: prevLadder.y, type: "archway", to: -1 });
      if (best.p.w !== w || best.p.h !== h) notes.push(`Only ${best.p.w} × ${best.p.h} fits by the ladder.`);
    }
  }
  if (!entrance) {
    const p = placeEntrance(m, w, h); // the entrance square mid-south, the room above it
    if (!p) throw new Error("The entrance room doesn't fit");
    entrance = addRoom(m, { n: 1, ...p, kind: "entrance", label: "Entrance Room", sub: "" });
  }
  const entry: Side = ladderIn ? m.exits.find((e) => e.to === -1)!.side : "S";
  if (info.entrance.west) {
    const spot = exitSpots(m, entrance, "W")[0];
    if (spot) m.exits.push({ id: m.nextId++, room: entrance.id, side: "W", x: spot[0], y: spot[1], type: "archway" });
  } else {
    const placed = placeHulkExits(m, entrance, entry, info.entrance.exits, "archway", 1);
    if (placed.length < info.entrance.exits) notes.push(`Only ${placed.length} exit${placed.length === 1 ? "" : "s"} fit${placed.length === 1 ? "s" : ""}.`);
  }
  return { map: m, entrance, ladderIn, voidChamber, note: notes.join(" ") };
}

// ---------- level 10 chain (§2.12) ----------
export interface ChainRoom { w: number; h: number; kind: HulkKind; table: "sr" | "special"; row?: number; alien?: string; label?: string }
const AI = ["AI TENTACLES", "AI GENOFRAME", "AI SPINE", "AI BRAIN"];
/** Rooms 2–10 of level 10 (after the entrance): small (2×3, U12 reading) and 6×6 AI rooms in turn, then the 4×4 Escape Pod. */
export const L10_CHAIN: ChainRoom[] = [
  ...[0, 1, 2, 3].flatMap((i): ChainRoom[] => [
    { w: 2, h: 3, kind: "small", table: "sr" },
    { w: 6, h: 6, kind: "large", table: "special", row: i, alien: AI[i], label: ["AI Tentacles Domain", "AI Genoframe Station", "AI Spine Pit", "AI Brain Chamber"][i] },
  ]),
  { w: 4, h: 4, kind: "regular", table: "special", row: 4, label: "Escape Pod Room" },
];

/** L10: the one archway exit goes on the wall with the most room for the next room of the chain. */
export function bestSingleExit(m: DungeonMap, r: MapRoom, entry: Side | null, next: { w: number; h: number } | null): MapExit | null {
  if (!next) return null;
  m.exits = m.exits.filter((e) => e.room !== r.id || e.to !== undefined);
  const occ = occupied(m);
  let best: { side: Side; spot: [number, number]; area: number } | null = null;
  for (const side of clockwiseWalls(entry)) {
    for (const spot of exitSpots(m, r, side, occ).slice(0, 3)) {
      const p = findPlacement(m, { id: -1, room: r.id, side, x: spot[0], y: spot[1], type: "archway" }, next.w, next.h);
      const area = p ? p.w * p.h : 0;
      if (!best || area > best.area) best = { side, spot, area };
    }
  }
  if (!best) return null;
  const e: MapExit = { id: m.nextId++, room: r.id, side: best.side, x: best.spot[0], y: best.spot[1], type: "archway" };
  m.exits.push(e);
  return e;
}

// ---------- per-room trackers (§3.4) ----------
export interface Trackers { bloodied: number; stunned: number }
/**
 * Entering a room (new or backtracked): Bloodied ticks a box (of 8), and past 8 it's fever, −1 HP
 * per room; Stunned counts down one room.
 */
export function tickTrackers(t: Trackers): Trackers & { hpLoss: number; notes: string[] } {
  const notes: string[] = [];
  let { bloodied, stunned } = t;
  let hpLoss = 0;
  if (bloodied > 0) {
    if (bloodied < 8) {
      bloodied++;
      notes.push(`Bloodied: box ${bloodied} of 8 ticked.`);
    } else {
      hpLoss = 1;
      notes.push("Fever: −1 HP (wash to clear Bloodied).");
    }
  }
  if (stunned > 0) {
    stunned--;
    notes.push(stunned ? `Stunned: ${stunned} room${stunned === 1 ? "" : "s"} left.` : "Stunned wears off.");
  }
  return { bloodied, stunned, hpLoss, notes };
}

// ---------- going down a level (§2.11, §1.10) ----------
export type Ration = "full" | "parts" | "none";
/**
 * At the ladder: eat a ration and rest (+2 HP per character level, +1 more per level with a cloth or
 * bandage, never above baseline), or don't eat: lose half your HP (two ration parts: a quarter).
 * U8 reading: losses round down and the 20 HP cap applies to both.
 */
export function restBetweenLevels(o: { hp: number; baseline: number; charLevel: number; ration: Ration; cloth: boolean }): { hp: number; delta: number; note: string } {
  const { hp, baseline, charLevel, ration, cloth } = o;
  if (ration === "full") {
    const gain = 2 * charLevel + (cloth ? charLevel : 0);
    const next = Math.max(hp, Math.min(baseline, hp + gain));
    return { hp: next, delta: next - hp, note: `Ate a ration and rested: +${next - hp} HP${next - hp < gain ? " (capped at baseline)" : ""}.` };
  }
  const loss = Math.min(20, Math.floor(hp / (ration === "parts" ? 4 : 2)));
  return { hp: hp - loss, delta: -loss, note: `${ration === "parts" ? "Two ration parts: lose a quarter" : "No ration: lose half"} your HP, −${loss} HP. No rest.` };
}
export const nextLevel = (level: number) => Math.min(10, level + 1);

// ---------- finishing a room ----------
/** What voidFinishBlock needs to know about the room in progress. `chain`: a Level 10 chain room (its one exit is placed for it). */
export interface VoidFlowDraft { kind: HulkKind; chain: boolean; hasRoom: boolean; exits?: number; encDone?: boolean; byBook?: { type?: boolean } }
/**
 * The step to do next in a room, in the book's order: exits, room type, encounter, then finish. `ssrtPending`: a
 * level 9 small room that hasn't rolled SSRT1 yet; that roll resizes the room, so it comes before the exits.
 */
export function voidCurStep(d: VoidFlowDraft & { ssrtPending?: boolean }): "exits" | "type" | "enc" | "finish" {
  if (d.kind === "entrance") return "finish";
  if (d.ssrtPending) return "type";
  if (!d.chain && d.exits === undefined) return "exits";
  if (d.kind === "corridor") return "finish";
  if (!d.hasRoom && !d.byBook?.type) return "type";
  return d.encDone ? "finish" : "enc";
}

/** Why the room can't be finished yet (its first unfinished step, in the book's order: exits, room type, encounter), or null when it can. */
export function voidFinishBlock(d: VoidFlowDraft): string | null {
  if (d.kind === "entrance") return null;
  if (!d.chain && d.exits === undefined) return "Roll the exits first";
  if (d.kind === "corridor") return null;
  if (!d.hasRoom && !d.byBook?.type) return "Roll the room type first";
  if (!d.encDone) return "Deal with the encounter first";
  return null;
}

// ---------- reading room text ----------
/** Alien card names that appear in CAPITALS in a room's text (they're fought there). */
export const aliensIn = namesIn;

/**
 * Table codes a text tells you to roll ("roll on L1PT", "UTIT1 and GACT1", "Level Patrol Table +1"),
 * in order, with any +/- modifier written right after. `has` says whether a code is a known table.
 */
export function tableCodesIn(text: string, has: (code: string) => boolean, patrol: string | null = null): { code: string; modifier: number }[] {
  const found: { code: string; modifier: number; at: number }[] = [];
  const num = (s: string | undefined) => (s ? parseInt(s.replace(/\s/g, "").replace("−", "-"), 10) : 0);
  const re = /\b([A-Z][A-Z0-9]{2,6})\b(?:\s*([+\-−]\s?\d+)(?!\d|\s*(?:HP|XP|c\b|damage|Shift)))?/g; // (?!\d): "+10 XP" must not backtrack to a "+1" modifier
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (/\d/.test(m[1]) && has(m[1])) found.push({ code: m[1], modifier: num(m[2]), at: m.index });
  if (patrol) {
    const pr = /level patrol table(?:\s*([+\-−]\s?\d+))?/gi;
    while ((m = pr.exec(text))) found.push({ code: patrol, modifier: num(m[1]), at: m.index });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((f) => !seen.has(`${f.code}:${f.modifier}`) && !!seen.add(`${f.code}:${f.modifier}`))
    .map(({ code, modifier }) => ({ code, modifier }));
}
