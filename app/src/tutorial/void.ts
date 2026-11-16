// The 2D6 Void gameplay tutorial: make a survivor, enter Hulk level 1 and play the first three rooms (the
// entrance, a room with a fight, and a small room), on the real Sheet, Hulk turn and Combat tools.
//
// The copy is our own words. Rules are linked only by their locked-book section id (void/p<page>-<n>, see
// tools/void/hulkmodel.ts) and table codes, never by a book heading: the dist check fails a build that carries
// book text. The dice are scripted (dice/rig.ts) so every run plays the same three rooms; only the faces are
// stored here. Picked against the level 1 tables: room 2 is a regular room whose encounter is a weak robot, and
// room 3 is a quiet small room.
import type { RigEntry } from "../dice/rig";
import type { CoachScript, CoachStep } from "../ui/coach";
import { load } from "../tools/common";
import { hasVChar, loadVChar, meleeManoeuvres } from "../tools/void/sheetmodel";

interface HulkDraft { n: number; room?: unknown; exits?: number; results?: unknown[]; encDone?: boolean }
interface HulkSave { map?: unknown; rooms?: unknown[]; current?: HulkDraft | null; doors?: Record<string, { checked?: boolean }> }
interface CombatSave { phase?: string; stage?: string; foes?: unknown[]; pending?: unknown; xpBanked?: boolean }

const hulk = (): HulkSave => load<HulkSave>("vhulk", {});
const fight = (): CombatSave => load<CombatSave>("vcombat", {});
const roomsDone = () => hulk().rooms?.length ?? 0;
const draft = () => hulk().current ?? null;
const onRoom = (n: number) => draft()?.n === n;
const fightOver = () => fight().phase === "won" || fight().phase === "lost";

// ---------- the scripted dice ----------
/** Room sizes (D66, Primary across × Secondary down), the room-table roll, then exits (D6 count, D3 first wall). */
export const VOID_DICE = {
  room2: { size: [4, 3], type: [2, 3], exits: [4], wall: [3] },
  room3: { size: [2, 3], type: [3, 4], exits: [3], wall: [1] },
  /** The lock check on the door into room 3 (anything under the lowest locked roll opens it). */
  door: [2],
  /** The table room 2 calls after the fight. */
  followOn: [6, 5],
} as const;

const faces = (v: readonly number[]): number[] => [...v];

/** The survivor's strongest level 1 manoeuvre, so the tutorial's attack roll lands on it exactly. */
export function bestManoeuvreFaces(): number[] | null {
  if (!hasVChar()) return null;
  const ms = meleeManoeuvres(loadVChar()).filter((m) => m.primary >= 1 && m.primary <= 6 && m.secondary >= 1 && m.secondary <= 6 && !(m.primary === m.secondary && (m.primary === 1 || m.primary === 6)));
  const avg = (m: (typeof ms)[number]) => m.damage.dice * 3.5 + m.damage.mod;
  const best = ms.sort((a, b) => avg(b) - avg(a))[0];
  return best ? [best.primary, best.secondary] : null;
}

/**
 * The fight: your shots land for little, its shots and attacks miss, and your first close-combat attack hits
 * your best manoeuvre for good damage. Every entry stays armed for the whole fight, whatever order you take.
 */
export const FIGHT_DICE: RigEntry[] = [
  { kind: "2D6", tag: "you:shot", dice: [2, 3], keep: true },
  { kind: "*", tag: "you:shot-damage", dice: (n) => Array(n).fill(1), keep: true },
  { kind: "D66", tag: "you:shot-deflect", dice: [1, 2], keep: true },
  { kind: "2D6", tag: "foe:shot", dice: [6, 5], keep: true },
  { kind: "D66", tag: "you:attack", dice: () => bestManoeuvreFaces(), keep: true },
  { kind: "*", tag: "you:damage", dice: (n) => Array(n).fill(5), keep: true },
  { kind: "D66", tag: "foe:attack", dice: [1, 2], keep: true },
];

const room = (n: 2 | 3): { size: RigEntry[]; type: RigEntry[]; exits: RigEntry[] } => {
  const d = n === 2 ? VOID_DICE.room2 : VOID_DICE.room3;
  return {
    size: [{ kind: "D66", dice: faces(d.size) }],
    // room 2 is a standard room (a D66 room table), room 3 a small one (2D6)
    type: [{ kind: n === 2 ? "D66" : "2D6", dice: faces(d.type) }],
    exits: [{ kind: "D6", dice: faces(d.exits) }, { kind: "D3", dice: faces(d.wall) }],
  };
};

// ---------- rule links (section ids) ----------
const R = {
  creating: { label: "Making a survivor", section: "void/p9-1" },
  sheet: { label: "The character sheet", section: "void/p9-2" },
  professions: { label: "Professions", section: "void/p9-3" },
  specialSkills: { label: "Special skills", section: "void/p9-4" },
  skills: { label: "Skills", section: "void/p9-6" },
  skillMods: { label: "Skill modifiers", section: "void/p13-1" },
  skillChecks: { label: "Skill checks", section: "void/p13-2" },
  marksmanship: { label: "Marksmanship", section: "void/p13-3" },
  manoeuvres: { label: "Manoeuvres", section: "void/p13-4" },
  manTable: { label: "Weapon manoeuvres table", section: "void/p69-1" },
  armour: { label: "Armour", section: "void/p13-5" },
  armourTable: { label: "Armour table", section: "void/p58-1" },
  armourSets: { label: "Armour dice sets", section: "void/p35-1" },
  equipment: { label: "Starting equipment", section: "void/p14-1" },
  pistol: { label: "Your pistol", section: "void/p39-7" },
  levelling: { label: "Levelling up", section: "void/p14-2" },
  hp: { label: "Health points", section: "void/p15-3" },
  intoHulk: { label: "Exploring the Hulk", section: "void/p15-1" },
  levelInfo: { label: "Level information", section: "void/p15-5" },
  level1: { label: "Level 1 intro", section: "void/p92-2" },
  rooms: { label: "Making rooms", section: "void/p16-1" },
  dice: { label: "Primary and Secondary dice", section: "void/p8-4" },
  exits: { label: "Placing exits", section: "void/p18-1" },
  encounter: { label: "Entering a new room", section: "void/p20-1" },
  contents: { label: "What's in a room", section: "void/p20-2" },
  uniques: { label: "Unique rooms", section: "void/p21-1" },
  level1Rooms: { label: "Level 1 rooms table", section: "void/p98-1" },
  level1Small: { label: "L1SR small rooms", section: "void/p97-1" },
  doors: { label: "Checking doors", section: "void/p21-2" },
  sliding: { label: "Locked sliding doors", section: "void/p22-1" },
  security: { label: "Locked security doors", section: "void/p23-1" },
  quickRef: { label: "Room quick reference", section: "void/p24-3" },
  crib: { label: "Exploration crib sheet", section: "void/p50-3" },
  goingDown: { label: "Going down a level", section: "void/p23-6" },
  combat: { label: "Combat", section: "void/p28-1" },
  alienCards: { label: "Alien cards", section: "void/p38-2" },
  thisAlien: { label: "This alien's card", section: "void/p192-1" },
  throwing: { label: "Throwing weapons", section: "void/p35-4" },
  ranged: { label: "Ranged combat", section: "void/p28-2" },
  shooting: { label: "Shooting", section: "void/p28-5" },
  deflection: { label: "Deflection roll", section: "void/p29-1" },
  firing: { label: "Firing sequence", section: "void/p30-1" },
  closeIn: { label: "Closing in", section: "void/p31-3" },
  closeMan: { label: "Manoeuvres in a fight", section: "void/p31-5" },
  shift: { label: "Shift points", section: "void/p31-6" },
  sequence: { label: "Close combat sequence", section: "void/p32-2" },
  exact: { label: "Exact strikes", section: "void/p32-3" },
  shifting: { label: "Shifting the dice", section: "void/p33-1" },
  armourDeflect: { label: "Armour deflection", section: "void/p34-2" },
  winning: { label: "Winning a fight", section: "void/p38-1" },
  corpses: { label: "Enemy corpses", section: "void/p25-1" },
  iaut: { label: "IAUT1", section: "void/p93-1" },
} as const;

const SHEET = "#/play/vsheet";
const HULK = "#/play/vhulk";
const COMBAT = "#/play/vcombat";
const COMBAT_RULES = [R.combat, R.alienCards, R.thisAlien];

const steps: CoachStep[] = [
  {
    id: "welcome", title: "Your first expedition",
    body: [
      "This tutorial walks you through one short game: making a survivor, climbing into the Dark Hulk and playing its first three rooms, including a fight.",
      "It plays as a new tutorial survivor, so your own characters aren't touched, and when you finish you go straight back to them. The dice are set up for the lesson, so every run plays the same rooms.",
      "Each step links the rules it teaches. They open in a new tab, so you can read them and come back. Fold this card down with the arrow at the top whenever it's in the way.",
    ],
  },
  // ---------- the survivor ----------
  {
    id: "identity", title: "Name and profession", route: SHEET, target: '[data-coach="vs-identity"]',
    body: [
      "Every survivor starts at level 1 with the same base numbers. What sets them apart is the profession.",
      "Each profession has a special skill that bends one rule in your favour, and its own ladder of level titles and HP as you gain XP. Give your survivor a name and pick a profession.",
    ],
    rules: [R.creating, R.professions, R.specialSkills, R.skills],
  },
  {
    id: "weapon", title: "Melee weapon and two manoeuvres", route: SHEET, target: '[data-coach="vs-weapon"]',
    body: [
      "Your melee weapon stays with you for the whole adventure, and it decides which close-combat manoeuvres you can learn.",
      "Each manoeuvre is a pair of dice faces and a damage roll. In a fight you roll two dice and try to land on (or shift onto) one of your manoeuvres. Tick two level 1 manoeuvres. A spread of different faces gives you more chances to hit.",
    ],
    rules: [R.manoeuvres, R.manTable],
  },
  {
    id: "armour", title: "Starting armour", route: SHEET, target: '[data-coach="vs-armour"]',
    body: [
      "Armour works the other way round: it has dice faces too, and when an attack's dice match a set, the armour soaks some of the damage.",
      "All the starting pieces have a yellow die, which means they also help against ranged attacks. Pick one.",
    ],
    rules: [R.armour, R.armourTable, R.armourSets],
  },
  {
    id: "create", title: "Starting kit, then create", route: SHEET, target: '[data-act="create"]', done: () => hasVChar(),
    body: [
      "Everyone climbs in with the same kit: a pistol with one block of ammo, a medical stim, two rations and your profession's item.",
      "Press Create survivor. (It stays greyed out until two manoeuvres are ticked.)",
    ],
    rules: [R.equipment, R.pistol],
  },
  {
    id: "sheet", title: "Reading your sheet", route: SHEET, target: '[data-coach="vs-stats"]',
    body: [
      "Your skills are Technical, Coding and Marksmanship. A skill check is a 2D6 roll that has to come in at or under the skill, after modifiers. Marksmanship works the same way for shooting.",
      "HP is your life. Gaining XP raises your level, which brings more HP and better numbers. The bar along the bottom of the screen keeps your HP in view everywhere.",
    ],
    rules: [R.sheet, R.skillMods, R.skillChecks, R.marksmanship, R.hp, R.levelling],
  },
  // ---------- room 1: the entrance ----------
  {
    id: "enter", title: "Into the Dark Hulk", route: HULK, target: '[data-act="start"]', done: () => !!hulk().map,
    body: [
      "The Start Game page runs exploration. It has ten levels, and each one has its own intro, room tables and patrol table.",
      "This card shows level 1's entrance room and anything special about the level. Press Enter level 1.",
    ],
    rules: [R.intoHulk, R.levelInfo, R.level1],
  },
  {
    id: "entrance", title: "Room 1: the entrance", route: HULK, target: '[data-coach="step-entrance"]',
    body: [
      "You don't roll for the entrance room. The level intro sets its size, and there are no aliens in it. Its exits are archways, which you can always walk through.",
      "Open the Map tab any time to see the rooms drawn on the hull's grid.",
    ],
    rules: [R.level1, R.rooms],
  },
  {
    id: "finish1", title: "Finish the room", route: HULK, target: '[data-act="finish"]', done: () => roomsDone() >= 1,
    body: [
      "Every room ends the same way: you deal with what's in it, then finish it so it's written into the journal and onto the map. Press Finish room 1.",
    ],
    rules: [R.quickRef],
  },
  // ---------- room 2: a fight ----------
  {
    // "Roll the next room" is already live here: its dice are scripted on this step too, so rolling before Next plays the same room
    id: "way2", title: "Choose a way on", route: HULK, target: ".exit-pick", rig: () => room(2).size,
    body: [
      "Pick one of the entrance room's archways to go through. The highlighted chip is the exit the next room will be built beyond.",
      "Doors get checked for a lock the first time you use them. Archways don't, so you can go straight on.",
    ],
    rules: [R.exits, R.doors],
  },
  {
    id: "size2", title: "Room 2: size", route: HULK, target: '[data-act="size"]', done: () => onRoom(2) || roomsDone() >= 2, rig: () => room(2).size,
    body: [
      "A new room starts with a D66 roll for its size: the Primary die gives its width across and the Secondary die its depth. Doubles roll again and add, and a 1 makes a corridor.",
      "Press Roll the next room.",
    ],
    rules: [R.rooms, R.dice],
  },
  {
    id: "exits2", title: "Room 2: exits", route: HULK, target: '[data-coach="step-exits"]', done: () => draft()?.exits !== undefined || roomsDone() >= 2, rig: () => room(2).exits,
    body: [
      "A D6 says how many new exits the room has, and a D3 picks the first wall, going clockwise from the way you came in. Exits never go on the hull or back through your own entrance.",
      "The exits come first. What kind they are is set by the room table, which you roll next. Roll the number of exits.",
    ],
    rules: [R.exits],
  },
  {
    id: "type2", title: "Room 2: what is it?", route: HULK, target: '[data-coach="step-room-type"]', done: () => !!draft()?.room || roomsDone() >= 2, rig: () => room(2).type,
    body: [
      "A standard room is identified on the level's room table (small and large rooms have their own tables). The row you roll gives its name, what you find, the encounter and the kind of exits you just placed.",
      "Unique rooms only happen once a level. The tool re-rolls them for you when needed. Roll on the room table.",
    ],
    rules: [R.encounter, R.level1Rooms, R.uniques],
  },
  {
    id: "encounter2", title: "Room 2: the encounter", route: HULK, target: "[data-fight]",
    done: () => !!fight().pending || (fight().foes?.length ?? 0) > 0 || roomsDone() >= 2,
    body: [
      "Always deal with the encounter in order, creatures first. This room has an alien in it, and the Fight button hands its card to the Combat page with the room's conditions.",
      "Press the Fight button.",
    ],
    rules: [R.contents, R.alienCards],
  },
  {
    id: "fight-setup", title: "The fight is set up", route: COMBAT, target: '[data-act="take-pending"], [data-act="start"]',
    done: () => !!fight().phase && fight().phase !== "setup", rig: () => FIGHT_DICE,
    body: [
      "Combat reads the alien's card for you: its HP, Shift, interrupt, deflection, manoeuvres and any ranged weapon. Room conditions such as being surprised are already set.",
      "Load the alien from the Hulk if asked, then press Start fight. For this lesson the dice favour you, so you'll win.",
    ],
    rules: COMBAT_RULES,
  },
  {
    id: "fight-pre", title: "Before anyone moves", route: COMBAT, target: '[data-act="to-ranged"]',
    done: () => (!!fight().stage && fight().stage !== "pre") || fightOver(), rig: () => FIGHT_DICE,
    body: [
      "A fight can open with a thrown weapon, such as a grenade or a metal pipe, if you have one. You don't yet, so move on to the ranged phase.",
    ],
    rules: [R.throwing],
  },
  {
    id: "fight-ranged", title: "Ranged phase", route: COMBAT, target: '[data-act="shoot"], [data-act="alien-shoot"], [data-act="skip-shot"], [data-act="shoot-close"]',
    done: () => fight().stage === "melee" || fightOver(), rig: () => FIGHT_DICE,
    body: [
      "Who shoots first depends on Marksmanship: the firing sequence compares yours with the alien's weapon. A shot is 2D6 at or under your Marksmanship. A hit rolls damage, then the alien's Deflection Roll can cut it.",
      "Follow the buttons for each shot. When the shooting is done, the fight closes in to melee.",
    ],
    rules: [R.ranged, R.shooting, R.firing, R.deflection],
  },
  {
    id: "fight-melee", title: "Close combat", route: COMBAT, target: '[data-act="attack"], [data-hit], [data-act="foe-attack"]',
    done: () => fightOver(), rig: () => FIGHT_DICE,
    body: [
      "Press Attack to roll D66. If the faces match one of your manoeuvres exactly, it's an Exact Strike. If they're close, spend Shift points to move the dice onto one. Then press the manoeuvre to hit with it.",
      "The alien then attacks the same way using its card, and your armour sets can soak the blow. Keep going until one side drops.",
    ],
    rules: [R.closeIn, R.closeMan, R.shift, R.sequence, R.exact, R.shifting, R.armourDeflect],
  },
  {
    id: "fight-won", title: "Victory", route: COMBAT, target: '[data-act="bank-xp"]', done: () => !!fight().xpBanked,
    body: [
      "Add the fight's XP to your sheet. The alien's card may also have a cache to roll for. Defeated aliens leave corpses, which can matter later.",
    ],
    rules: [R.winning, R.corpses],
  },
  {
    id: "followon2", title: "Back in room 2", route: HULK, target: '[data-follow^="IAUT1"]',
    done: () => (draft()?.results?.length ?? 0) > 0 || roomsDone() >= 2, rig: () => [{ kind: "D66", dice: faces(VOID_DICE.followOn) }],
    body: [
      "With the alien dealt with, finish what the room's text says. Here it sends you to another table, and its code button rolls on it.",
      "Roll it and read the result. Apply anything it gives or costs you on your sheet, or with the character bar at the bottom.",
    ],
    rules: [R.iaut, R.contents],
  },
  {
    id: "resolve2", title: "The encounter is done", route: HULK, target: '[data-act="enc-done"]', done: () => !!draft()?.encDone || roomsDone() >= 2,
    body: [
      "The page can't see how a fight went or whether you've done everything the text says, so you tell it. Press Encounter resolved.",
      "Rolls a room only sometimes needs, like a patrol or an Alarm Check, are folded away under Other rolls.",
    ],
    rules: [R.contents],
  },
  {
    id: "finish2", title: "Finish room 2", route: HULK, target: '[data-act="finish"]', done: () => roomsDone() >= 2,
    body: ["Every step is ticked, so the room can be finished. Press Finish room 2."],
    rules: [R.quickRef],
  },
  // ---------- room 3: a small room through a door ----------
  {
    // the lock check and the next room can both be rolled from here: script them as the later steps do
    id: "way3", title: "Through a door", route: HULK, target: ".exit-pick", rig: () => [{ kind: "D6", dice: faces(VOID_DICE.door) }, ...room(3).size],
    body: [
      "This time, pick one of room 2's new exits. They're doors, so the first time through you check the lock.",
      "Each kind of door locks on different rolls, and gets past a lock in its own way: forcing, hacking, or something stranger.",
    ],
    rules: [R.doors, R.sliding, R.security],
  },
  {
    id: "door3", title: "Check the lock", route: HULK, target: '[data-door="check"]',
    done: () => Object.values(hulk().doors ?? {}).some((d) => d?.checked) || onRoom(3) || roomsDone() >= 3, rig: () => [{ kind: "D6", dice: faces(VOID_DICE.door) }, ...room(3).size],
    body: ["Press Check the lock (D6). If you picked an archway instead, skip ahead."],
    rules: [R.doors],
  },
  {
    id: "size3", title: "Room 3: size", route: HULK, target: '[data-act="size"]', done: () => onRoom(3) || roomsDone() >= 3, rig: () => room(3).size,
    body: ["The way is open. Roll the next room. A 2 by 3 roll makes a small room, which has its own table and archway exits."],
    rules: [R.rooms],
  },
  {
    id: "exits3", title: "Room 3: exits", route: HULK, target: '[data-coach="step-exits"]', done: () => draft()?.exits !== undefined || roomsDone() >= 3, rig: () => room(3).exits,
    body: ["Roll its exits first, the same way as before. A small room's exits are always archways."],
    rules: [R.exits],
  },
  {
    id: "type3", title: "Room 3: a small room", route: HULK, target: '[data-coach="step-room-type"]', done: () => !!draft()?.room || roomsDone() >= 3, rig: () => room(3).type,
    body: ["Small rooms are rolled with 2D6 on the level's small-room table, and their whole entry is in one description. Roll it."],
    rules: [R.level1Small, R.contents],
  },
  {
    id: "encounter3", title: "Room 3: what happens", route: HULK, target: '[data-coach="step-encounter"]', done: () => !!draft()?.encDone || roomsDone() >= 3,
    body: [
      "Not every room is a fight. Read this one and apply what it says. HP you gain or lose goes on your sheet or the character bar, and it can't go over your baseline unless the rule says so.",
      "When you've done what it says, press the button that ends the step.",
    ],
    rules: [R.hp, R.contents],
  },
  {
    id: "finish3", title: "Finish room 3", route: HULK, target: '[data-act="finish"]', done: () => roomsDone() >= 3,
    body: ["Press Finish room 3."],
    rules: [R.quickRef],
  },
  {
    id: "done", title: "That's the loop", route: HULK,
    body: [
      "That's everything a level asks of you, repeated: roll a room, place its exits, see what it is, face what's inside, then open the way on. Around three-quarters of the way through a level you place the ladder down. The crib sheet sums it all up on one page.",
      "Finish to go back to your own character (the tutorial survivor is deleted), or keep this survivor and carry on playing it from room 4. From here on the dice are your own.",
    ],
    rules: [R.crib, R.goingDown],
  },
];

export const VOID_TUTORIAL: CoachScript = { id: "void", name: "Void tutorial", steps };
