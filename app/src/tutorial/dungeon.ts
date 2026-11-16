// The 2D6 Dungeon gameplay tutorial: meet your adventurer, enter dungeon level 1 and play its first three rooms
// (the entrance, a room with a fight, and a small room through a door), on the real Sheet, Dungeon turn and
// Combat tools. Everything it needs is in the free books (Core Rules and the level 1 tables).
//
// The copy is our own words. Rules are linked by section id and tables by their codes, never by quoting the
// books: the dist check fails a build that carries book text. The dice are scripted (dice/rig.ts) so every run
// plays the same three rooms; only the faces are stored here. Picked against the level 1 tables: room 2 is a
// standard room with one weak creature, wooden doors and a small find afterwards; room 3 is a quiet small room.
//
// The Dungeon tools roll without tags, so entries are matched by the kind of roll alone. Each step arms only
// the rolls it can lead to, and the fight's attack entry reads whose turn it is from the saved fight.
import type { RigEntry } from "../dice/rig";
import type { CoachScript, CoachStep } from "../ui/coach";
import { load } from "../tools/common";

interface Draft { n: number; kind?: string; room?: unknown; exits?: number; results?: unknown[]; encDone?: boolean }
interface DungeonSave { rooms?: unknown[]; current?: Draft | null; map?: unknown; doors?: Record<string, { checked?: boolean }> }
interface CombatSave { phase?: string; foes?: unknown[]; xpBanked?: boolean }
interface SheetSave { manoeuvres?: string[][] }

const dungeon = (): DungeonSave => load<DungeonSave>("dungeon", {});
const fight = (): CombatSave => load<CombatSave>("combat", {});
const sheet = (): SheetSave => load<SheetSave>("character", {});
const roomsDone = () => dungeon().rooms?.length ?? 0;
const draft = () => dungeon().current ?? null;
const onRoom = (n: number) => draft()?.n === n;
/** Has a door been checked for a lock on this level? */
const doorChecked = () => Object.values(dungeon().doors ?? {}).some((d) => !!d?.checked);
const fightOver = () => fight().phase === "won" || fight().phase === "lost";
const fightBegun = () => !!fight().phase && fight().phase !== "setup";
/** Manoeuvres on the sheet that Combat can use: a name and a dice set. */
const learned = () => (sheet().manoeuvres ?? []).filter((r) => r?.[0] && /\[\d\]\[\d\]/.test(r[1] ?? ""));

// ---------- the scripted dice ----------
export const DUNGEON_DICE = {
  /** The entrance (D66, Primary across × Secondary down): 12 squares, so it is drawn as rolled. */
  entrance: [4, 3],
  /** 2D6 size, the room-table roll (D66 for a standard room, 2D6 for a small one), then the D6 number of exits. */
  room2: { size: [4, 3], type: [5, 1], exits: [4] },
  room3: { size: [2, 3], type: [4, 6], exits: [3] },
  /** The lock check on the wooden door out of room 2 (it only locks on a 6). */
  door: [2],
  /** The small table room 2 sends you to after the fight. */
  followOn: [3],
} as const;

const faces = (v: readonly number[]): number[] => [...v];

/** A sheet manoeuvre row as dice faces and a rough average damage. */
function parseRow(r: string[]): { p: number; s: number; avg: number } | null {
  const d = /\[(\d)\]\[(\d)\]/.exec(r[1] ?? "");
  if (!r[0] || !d) return null;
  const dmg = /(\d*)\s*D6\s*([+\-−]\s*\d+)?/i.exec(r[2] ?? "");
  const n = dmg ? +(dmg[1] || 1) : 1;
  const mod = dmg?.[2] ? parseInt(dmg[2].replace(/\s/g, "").replace("−", "-"), 10) : 0;
  return { p: +d[1], s: +d[2], avg: n * 3.5 + mod };
}

/**
 * The adventurer's strongest manoeuvre, so the tutorial's attack roll lands on it exactly. Secondary 1s and 6s
 * are left out when there is a choice: this creature's interrupts answer those.
 */
export function bestManoeuvreFaces(rows: string[][] = sheet().manoeuvres ?? []): number[] | null {
  const ms = rows.map(parseRow).filter((m): m is NonNullable<typeof m> => !!m && !(m.p === m.s && (m.p === 1 || m.p === 6)));
  const clear = ms.filter((m) => m.s !== 1 && m.s !== 6);
  const best = (clear.length ? clear : ms).sort((a, b) => b.avg - a.avg)[0];
  return best ? [best.p, best.s] : null;
}

/**
 * The fight: your attack lands exactly on your best manoeuvre for good damage, and the creature's attack roll
 * is one it can't use. Every entry stays armed for the whole fight.
 */
export const FIGHT_DICE: RigEntry[] = [
  { kind: "D66", dice: () => (fight().phase === "foes" ? [1, 2] : bestManoeuvreFaces()), keep: true },
  { kind: "D6", dice: [5], keep: true },
  { kind: "2D6", dice: [5, 5], keep: true },
  { kind: "3D6", dice: [5, 5, 5], keep: true },
];

const room = (n: 2 | 3): { size: RigEntry[]; type: RigEntry[]; exits: RigEntry[] } => {
  const d = n === 2 ? DUNGEON_DICE.room2 : DUNGEON_DICE.room3;
  return {
    size: [{ kind: "2D6", dice: faces(d.size) }],
    // room 2 is a standard room (a D66 room table), room 3 a small one (2D6)
    type: [{ kind: n === 2 ? "D66" : "2D6", dice: faces(d.type) }],
    exits: [{ kind: "D6", dice: faces(d.exits) }],
  };
};

// ---------- rule links (section ids; all in the free books) ----------
const R = {
  creating: { label: "Making an adventurer", section: "core/creating-an-adventurer" },
  sheet: { label: "The character sheet", section: "core/character-sheet" },
  hp: { label: "Health points", section: "core/health-points" },
  levelling: { label: "Levelling up", section: "core/levelling-up" },
  manoeuvres: { label: "Manoeuvres", section: "core/manoeuvres" },
  manTable: { label: "Weapon manoeuvres table", section: "codex/weapon-manoeuvres-table-1" },
  armourSets: { label: "Armour dice sets", section: "core/armour-dice-sets" },
  startArmour: { label: "Starting armour", section: "codex/starting-armour-table-1" },
  scrolls: { label: "Using scrolls", section: "core/using-magic-scrolls" },
  intoDungeon: { label: "Into the dungeon", section: "core/into-the-dungeon" },
  levelInfo: { label: "Level information", section: "core/level-information" },
  rooms: { label: "Making rooms", section: "core/generating-dungeon-rooms" },
  dice: { label: "Primary and Secondary dice", section: "core/primary-and-secondary-dice" },
  encounter: { label: "Entering a new room", section: "core/encounter-the-new-room" },
  contents: { label: "What's in a room", section: "core/identifying-the-room-and-its-contents" },
  uniques: { label: "Unique rooms", section: "core/special-unique-rooms" },
  level1Rooms: { label: "Level 1 rooms table", section: "codex/level-1-rooms-human-ancestry-the-entry-part-1" },
  level1Small: { label: "L1SR small rooms", section: "codex/l1sr-level-1-small-rooms-6-squares-or-smaller" },
  exitCount: { label: "Number of exits", section: "core/number-of-exits" },
  doors: { label: "Checking doors", section: "core/checking-doors" },
  locks: { label: "Locks and lock picks", section: "core/locks-and-lock-picks" },
  quickRef: { label: "Room quick reference", section: "core/room-creation-quick-reference" },
  combat: { label: "Combat", section: "core/combat" },
  creatureCards: { label: "Creature cards", section: "core/creature-cards" },
  thisCreature: { label: "This creature's card", section: "codex/artisan" },
  shift: { label: "Shift points", section: "core/shift-points" },
  sequence: { label: "Combat sequence", section: "core/combat-sequence" },
  shifting: { label: "Shifting the dice", section: "core/shifting-the-dice" },
  interrupts: { label: "Interrupts", section: "core/interrupt-stat" },
  armourDeflect: { label: "Armour deflection", section: "core/armour-deflection" },
  fatigue: { label: "The Fatigue die", section: "core/the-fatigue-die" },
  winning: { label: "Winning a fight", section: "core/winning-the-combat" },
  treasure: { label: "Treasure and experience", section: "core/treasure-and-experience" },
  herbs: { label: "Herbal remedies", section: "core/herbal-remedies" },
  hst: { label: "HST1", section: "codex/hst1-herbs-t1" },
  nextLevel: { label: "The next level", section: "core/the-next-level" },
} as const;

const SHEET = "#/play/sheet";
const TURN = "#/play/dungeon";
const COMBAT = "#/play/combat";
const here = () => (location.hash || "#/").replace(/\?.*$/, "");

const steps: CoachStep[] = [
  {
    id: "welcome", title: "Your first delve",
    body: [
      "This tutorial walks you through one short game: meeting your adventurer, going down into the dungeon and playing its first three rooms, including a fight.",
      "It plays as a new tutorial adventurer, so your own characters aren't touched, and when you finish you go straight back to them. The dice are set up for the lesson, so every run plays the same rooms.",
      "Each step links the rules it teaches. They open in a new tab, so you can read them and come back. Drag this card by its top edge if it's in the way, or fold it down with the arrow.",
    ],
  },
  // ---------- the adventurer ----------
  {
    id: "sheet", title: "Your adventurer", route: SHEET, target: '[data-coach="ds-hp"]',
    body: [
      "Every adventurer starts at level 1 with 10 HP and a weapon. This one carries a longsword, a piece of starting armour, a scroll and a healing potion, the same kit a new character of your own chooses from.",
      "HP is your life. XP from fights raises your level, and each level brings 10 more HP. The bar along the top of the screen keeps both in view everywhere.",
    ],
    rules: [R.creating, R.sheet, R.hp, R.levelling],
  },
  {
    id: "manoeuvres", title: "Learn two manoeuvres", route: SHEET, target: "details.sheet-more:has([data-learn])", done: () => learned().length >= 2,
    body: [
      "Your weapon decides which manoeuvres you can learn. Each one is a pair of dice faces and a damage roll. In a fight you roll two dice and try to land on, or shift onto, one of your manoeuvres.",
      "Open the list of manoeuvres you can learn and press Add on two level 1 ones. A spread of different faces gives you more chances to hit.",
    ],
    rules: [R.manoeuvres, R.manTable],
  },
  {
    id: "armour", title: "Armour and your scroll", route: SHEET, target: 'section.card:has([data-arr="armour"])',
    body: [
      "Armour has dice faces too. When a creature's attack dice match a piece's set, that piece takes some of the damage off.",
      "A scroll is cast with a dice roll of its own, at the start of a fight or outside one. You won't need it in this lesson, but it's there when you play on.",
    ],
    rules: [R.armourSets, R.startArmour, R.scrolls],
  },
  // ---------- room 1: the entrance ----------
  {
    id: "enter", title: "Into the dungeon", route: TURN, target: '[data-act="size"]', done: () => !!draft() || roomsDone() >= 1,
    rig: () => [{ kind: "D66", dice: faces(DUNGEON_DICE.entrance) }],
    body: [
      "The Start Game page runs exploration. The dungeon has ten levels, each with its own room tables and creatures.",
      "A level starts with its entrance room. Its size is a D66 roll: the Primary die is how many squares across, the Secondary die how many down. Press Roll the entrance room.",
    ],
    rules: [R.intoDungeon, R.levelInfo, R.rooms, R.dice],
  },
  {
    id: "entrance", title: "Room 1: the entrance", route: TURN, target: "ol.steps > li.step:nth-child(2)",
    body: [
      "The entrance room is always empty, and it gets three archways, one on each wall you didn't come in by. Archways can always be walked through.",
      "The map beside the steps draws each room on the level's grid as you roll it.",
    ],
    rules: [R.rooms],
  },
  {
    id: "finish1", title: "Finish the room", route: TURN, target: '[data-act="finish"]', done: () => roomsDone() >= 1,
    body: ["Every room ends the same way: you deal with what's in it, then finish it so it's written into the journal and onto the map. Press Finish room 1."],
    rules: [R.quickRef],
  },
  // ---------- room 2: a fight ----------
  {
    // "Roll the next room" is already live here: its dice are scripted on this step too, so rolling before Next plays the same room
    id: "way2", title: "Choose a way on", route: TURN, target: ".exit-pick", rig: () => room(2).size,
    body: [
      "Pick one of the entrance room's archways to go through, here or by tapping it on the map. The highlighted one is where the next room will be built.",
      "Doors get checked for a lock before you use them. Archways don't, so you can go straight on.",
    ],
    rules: [R.doors],
  },
  {
    id: "size2", title: "Room 2: size", route: TURN, target: '[data-act="size"]', done: () => onRoom(2) || roomsDone() >= 2, rig: () => room(2).size,
    body: [
      "After the entrance, a room's size is a 2D6 roll, read the same way: Primary across, Secondary down. A 1 on either die makes a corridor, and a double rolls again and adds on.",
      "Press Roll the next room.",
    ],
    rules: [R.rooms, R.dice],
  },
  {
    id: "type2", title: "Room 2: what is it?", route: TURN, target: 'li.step:has([data-act="type"])', done: () => !!draft()?.room || roomsDone() >= 2, rig: () => room(2).type,
    body: [
      "A standard room is identified on the level's room table (small and large rooms have their own). The row you roll gives its name, what you see, the encounter and the kind of exits it has.",
      "Unique rooms only happen once a level; the page warns you when one needs re-rolling. Roll on the room table.",
    ],
    rules: [R.encounter, R.level1Rooms, R.uniques],
  },
  {
    id: "exits2", title: "Room 2: exits", route: TURN, target: 'li.step:has([data-act="exits"])', done: () => draft()?.exits !== undefined || roomsDone() >= 2, rig: () => room(2).exits,
    body: [
      "A D6 says how many new exits the room has. They go on the walls in turn, never back through the way you came in or out through the edge of the map.",
      "This room's table row says they are wooden doors. Roll the number of exits.",
    ],
    rules: [R.exitCount, R.doors],
  },
  {
    id: "encounter2", title: "Room 2: the encounter", route: TURN, target: "[data-fight]",
    done: () => here() === COMBAT || (fight().foes?.length ?? 0) > 0 || fightBegun() || roomsDone() >= 2,
    body: [
      "Always deal with the encounter in order, creatures first. The Encounter step shows the room's own text and a button for each thing it asks of you: a Fight button for a creature it names, a dice button for a table it sends you to.",
      "Press the Fight button. It puts that creature's card into Combat and opens it.",
    ],
    rules: [R.contents, R.creatureCards, R.thisCreature],
  },
  {
    id: "fight-start", title: "Start the fight", route: COMBAT, target: '[data-act="start"]', done: () => fightBegun(), rig: () => FIGHT_DICE,
    body: [
      "Combat has read the creature's card for you: its HP, Shift, interrupts and manoeuvres. You attack first unless a room says otherwise. Press Start the fight. For this lesson the dice favour you, so you'll win.",
    ],
    rules: [R.combat, R.sequence],
  },
  {
    id: "fight-melee", title: "Trading blows", route: COMBAT, target: '[data-act="attack"], [data-hit], [data-act="foe-attack"], [data-act="miss"]',
    done: () => fightOver(), rig: () => FIGHT_DICE,
    body: [
      "Press Roll your attack for a D66. If the faces match one of your manoeuvres exactly, it's an Exact Strike and your Shift is added to the damage. If they're close, Shift points move the dice onto one. Then press the manoeuvre to hit with it.",
      "The creature can answer with an interrupt, and then it attacks the same way from its card, where your armour can take some of the blow. Each round the Fatigue die gives both sides more Shift. Keep going until one side drops.",
    ],
    rules: [R.manoeuvres, R.shift, R.shifting, R.interrupts, R.armourDeflect, R.fatigue],
  },
  {
    id: "fight-won", title: "Victory", route: COMBAT, target: '[data-act="bank-xp"]', done: () => !!fight().xpBanked,
    body: [
      "Add the fight's XP to your sheet. A creature's card also says what treasure it carries, which you can roll for here.",
    ],
    rules: [R.winning, R.treasure],
  },
  {
    id: "followon2", title: "Back in room 2", route: TURN, target: '[data-follow^="HST1"]',
    done: () => (draft()?.results?.length ?? 0) > 0 || roomsDone() >= 2, rig: () => [{ kind: "D6", dice: faces(DUNGEON_DICE.followOn) }],
    body: [
      "With the creature dealt with, finish what the room's text says. Here it sends you to another table, and the button with its code rolls on it.",
      "Roll it and read the result. Anything you gain or lose goes on your sheet, or on the bar at the top.",
    ],
    rules: [R.hst, R.herbs, R.contents],
  },
  {
    id: "resolve2", title: "The encounter is done", route: TURN, target: '[data-act="enc-done"]', done: () => !!draft()?.encDone || roomsDone() >= 2,
    body: [
      "The page can't see how a fight went or whether you've done everything the text says, so you tell it. Press Encounter resolved.",
      "Rolls a room only sometimes needs, like a patrol or an interruption, are folded away under Other rolls.",
    ],
    rules: [R.contents],
  },
  {
    id: "finish2", title: "Finish room 2", route: TURN, target: '[data-act="finish"]', done: () => roomsDone() >= 2, rig: () => [{ kind: "D6", dice: faces(DUNGEON_DICE.door) }],
    body: ["Every step is ticked, so the room can be finished. Press Finish room 2."],
    rules: [R.quickRef],
  },
  // ---------- room 3: a small room through a door ----------
  {
    id: "door2", title: "Check the door", route: TURN, target: '[data-door="check"]',
    done: () => doorChecked() || onRoom(3) || roomsDone() >= 3, rig: () => [{ kind: "D6", dice: faces(DUNGEON_DICE.door) }],
    body: [
      "Room 2's new exits are wooden doors. The first time you go through a door you check it for a lock with a D6, and each kind of door locks on different rolls. A locked one can be picked, or you wait for a patrol to open it.",
      "The way on shows what the exit you've chosen needs, and the next room can't be rolled until the way is open. Press Check the lock.",
    ],
    rules: [R.doors, R.locks],
  },
  {
    id: "size3", title: "Room 3: size", route: TURN, target: '[data-act="size"]', done: () => onRoom(3) || roomsDone() >= 3, rig: () => room(3).size,
    body: ["The door is open. Roll the next room. A 2 by 3 roll is six squares, which makes it a small room: its own table, and archways for exits."],
    rules: [R.rooms],
  },
  {
    id: "type3", title: "Room 3: a small room", route: TURN, target: 'li.step:has([data-act="type"])', done: () => !!draft()?.room || roomsDone() >= 3, rig: () => room(3).type,
    body: ["Small rooms are rolled with 2D6 on the level's small-room table, and their whole entry is one description. Roll it."],
    rules: [R.level1Small, R.contents],
  },
  {
    id: "exits3", title: "Room 3: exits", route: TURN, target: 'li.step:has([data-act="exits"])', done: () => draft()?.exits !== undefined || roomsDone() >= 3, rig: () => room(3).exits,
    body: ["Roll its exits the same way as before. A small room's exits are always archways."],
    rules: [R.exitCount],
  },
  {
    id: "encounter3", title: "Room 3: what happens", route: TURN, target: 'li.step:has([data-act="enc-done"])', done: () => !!draft()?.encDone || roomsDone() >= 3,
    body: [
      "Not every room is a fight. Read this one and do only what it says applies to you, then press the button that ends the step.",
    ],
    rules: [R.contents],
  },
  {
    id: "finish3", title: "Finish room 3", route: TURN, target: '[data-act="finish"]', done: () => roomsDone() >= 3,
    body: ["Press Finish room 3."],
    rules: [R.quickRef],
  },
  {
    id: "done", title: "That's the loop", route: TURN,
    body: [
      "That's everything a level asks of you, repeated: roll a room, see what it is, place its exits, face what's inside, finish it, then open the way on. When enough of the level is explored you find the stairs down. The quick reference sums it up on one page.",
      "Finish to go back to your own character (the tutorial adventurer is deleted), or keep this adventurer and carry on playing from room 4. From here on the dice are your own.",
    ],
    rules: [R.quickRef, R.nextLevel],
  },
];

/** The tutorial adventurer's sheet: a longsword and the first starting armour and scroll (what "New character" asks for). */
async function seed(): Promise<Record<string, unknown>> {
  const [{ makeAdventurer }, { byId }] = await Promise.all([import("../tools/sheet"), import("../library")]);
  return { "play:character": makeAdventurer(byId, "Longsword", 0, 0) };
}

export const DUNGEON_TUTORIAL: CoachScript = { id: "dungeon", name: "Dungeon tutorial", who: "adventurer", steps, seed };
