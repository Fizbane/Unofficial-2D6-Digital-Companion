// Achievements: lifetime goals across every character, stored in "2d6:achievements" (outside the
// play-data keys, so "Clear play data" keeps them and a backup carries them). Pure and DOM-free:
// shell/achievements.ts feeds bus events in through the on*() mappers and saves the result.
// One store holds both games: 2D6 Dungeon's counters are unprefixed, 2D6 Void's start "v:" (the
// recorder passes the prefix), and the dice counters are shared — every roll in either game counts.
import type { IconName } from "../ui/icon";
import type { JournalDoorEvent, JournalFightEvent, JournalMilestoneEvent, JournalRealmEvent, JournalRoomEvent } from "./events";

export const ACHIEVEMENTS_KEY = "2d6:achievements";

export type AchGroup = "dungeon" | "combat" | "dice" | "realm" | "character" | "legend" | "void-hulk" | "void-combat" | "void-survivor" | "void-legend";

/** Counter prefix for each game (Dungeon's are unprefixed so existing progress carries on). */
export type AchPrefix = "" | "v:";
export const VOID_PREFIX: AchPrefix = "v:";
export interface AchDef {
  id: string;
  title: string;
  blurb: string;
  icon: IconName;
  group: AchGroup;
  counter: string; // the counter it watches
  goal: number; // unlocked once the counter reaches this
  secret?: boolean; // title and blurb hidden until unlocked
}

/** Page order: 2D6 Dungeon's groups, the shared dice, then 2D6 Void's. `game` labels the heading. */
export const GROUPS: { id: AchGroup; title: string; game: "dungeon" | "void" | "both" }[] = [
  { id: "dungeon", title: "Dungeon", game: "dungeon" },
  { id: "combat", title: "Combat", game: "dungeon" },
  { id: "realm", title: "Realm", game: "dungeon" },
  { id: "character", title: "Character", game: "dungeon" },
  { id: "legend", title: "Legendary Rewards", game: "dungeon" },
  { id: "dice", title: "Dice", game: "both" },
  { id: "void-hulk", title: "The Dark Hulk", game: "void" },
  { id: "void-combat", title: "Combat", game: "void" },
  { id: "void-survivor", title: "Survivor", game: "void" },
  { id: "void-legend", title: "Hero of the Void", game: "void" },
];

/** The "Your Legendary Reward" table (Core Rules p.37), rolled in town after completing dungeon level 10. */
export const LEGENDARY_SECTION = "core/legendary-rewards";
export const LEGENDARY_REWARDS: readonly { roll: number; name: string; icon: IconName }[] = [
  { roll: 1, name: "The Crown of Verifica", icon: "crown" },
  { roll: 2, name: "The Spell Book of Detinere", icon: "book-open" },
  { roll: 3, name: "Puternic’s Spectral Armour", icon: "shield" },
  { roll: 4, name: "The Helm of Zebor", icon: "hard-hat" },
  { roll: 5, name: "Dumnezeu’s Golden Idol", icon: "gem" },
  { roll: 6, name: "The Wand of Dretas", icon: "wand-sparkles" },
];

const A = (group: AchGroup, id: string, title: string, blurb: string, icon: IconName, counter: string, goal: number, secret?: boolean): AchDef =>
  ({ id, title, blurb, icon, group, counter, goal, ...(secret ? { secret } : {}) });

export const ACHIEVEMENTS: readonly AchDef[] = [
  A("dungeon", "first-steps", "First Steps", "Explore your first room.", "key", "rooms", 1),
  A("dungeon", "delver", "Delver", "Explore 50 rooms.", "key", "rooms", 50),
  A("dungeon", "cartographer", "Cartographer", "Explore 250 rooms.", "map", "rooms", 250),
  A("dungeon", "going-down", "Going Down", "Reach dungeon level 2.", "arrow-down", "depth", 2),
  A("dungeon", "deep-delver", "Deep Delver", "Reach dungeon level 5.", "arrow-down", "depth", 5),
  A("dungeon", "bottom", "Bottom of the World", "Reach dungeon level 10.", "compass", "depth", 10),
  A("dungeon", "lockpicker", "Lockpicker", "Pick 10 locks.", "key-round", "picks", 10),
  A("dungeon", "doorwarden", "Doorwarden", "Get through 25 doors, portcullises or slabs.", "door-closed", "doors", 25),
  A("dungeon", "lean-times", "Lean Times", "Rest without a ration.", "utensils", "hungry", 1),
  A("dungeon", "way-out", "Way Out", "Find 5 exit shafts.", "flag", "shafts", 5),

  A("combat", "blooded", "Blooded", "Win your first fight.", "swords", "wins", 1),
  A("combat", "veteran", "Veteran", "Win 25 fights.", "shield", "wins", 25),
  A("combat", "slayer", "Slayer", "Defeat 100 foes.", "skull", "foes", 100),
  A("combat", "quick-work", "Quick Work", "Win a fight in a single round.", "zap", "quick", 1),
  A("combat", "seasoned", "Seasoned", "Earn 1,000 XP in total.", "star", "xp", 1000),
  A("combat", "prime-time", "Prime Time", "Land 10 Prime Attacks.", "zap", "primes", 10),
  A("combat", "exacting", "Exacting", "Land 10 Exact Strikes.", "crosshair", "exacts", 10),
  A("combat", "fallen-hero", "Fallen Hero", "Lose a fight. It happens to everyone.", "heart", "losses", 1, true),

  A("dice", "boxcars", "Boxcars", "Roll a double six.", "dice", "sixes", 1),
  A("dice", "snake-eyes", "Snake Eyes", "Roll a double one.", "dice", "ones", 1),
  A("dice", "roller", "Roller", "Roll 500 dice.", "dice", "dice", 500),
  A("dice", "hot-hand", "Hot Hand", "Roll three double sixes in a row.", "sparkles", "sixStreakBest", 3, true),

  A("realm", "landholder", "Landholder", "Claim a plot.", "landmark", "claims", 1),
  A("realm", "baron", "Baron", "Claim 10 plots.", "crown", "claims", 10),
  A("realm", "builder", "Builder", "Start your first building.", "hammer", "buildings", 1),
  A("realm", "year-in-realm", "A Year in the Realm", "See 12 months end.", "calendar", "months", 12),

  A("character", "rising", "Rising", "Reach character level 2.", "trophy", "level", 2),
  A("character", "hero", "Hero", "Reach character level 5.", "trophy", "level", 5),
  A("character", "legend", "Legend", "Reach character level 10.", "crown", "level", 10),

  // ----- the second set -----
  A("dungeon", "getting-around", "Getting Around", "Explore 10 rooms.", "key", "rooms", 10),
  A("dungeon", "hundred-halls", "A Hundred Halls", "Explore 100 rooms.", "map", "rooms", 100),
  A("dungeon", "labyrinth-walker", "Labyrinth Walker", "Explore 500 rooms.", "compass", "rooms", 500),
  A("dungeon", "further-down", "Further Down", "Reach dungeon level 3.", "arrow-down", "depth", 3),
  A("dungeon", "abyss-gazer", "Abyss Gazer", "Reach dungeon level 7.", "arrow-down", "depth", 7),
  A("dungeon", "click", "Click", "Pick your first lock.", "key-round", "picks", 1),
  A("dungeon", "master-locksmith", "Master Locksmith", "Pick 50 locks.", "key-round", "picks", 50),
  A("dungeon", "no-door-holds", "No Door Can Hold Me", "Get through 100 doors, portcullises or slabs.", "door-closed", "doors", 100),
  A("dungeon", "under-the-gate", "Under the Gate", "Face 5 portcullises.", "castle", "portcullis", 5),
  A("dungeon", "slab-tipper", "Slab Tipper", "Tip over 5 stone slabs.", "hammer", "slabs", 5),
  A("dungeon", "patrol-bait", "Patrol Bait", "Run into 25 patrols or interruptions.", "triangle-alert", "encounters", 25),
  A("dungeon", "grand-halls", "Grand Halls", "Explore 25 large rooms.", "landmark", "largeRooms", 25),
  A("dungeon", "stair-sleeper", "Stair Sleeper", "Rest on the stairs 10 times.", "sun-moon", "rests", 10),
  A("dungeon", "well-fed", "Well Fed", "Eat 25 rations while resting.", "utensils", "rations", 25),
  A("dungeon", "daylight", "Daylight", "Find your first exit shaft.", "flag", "shafts", 1),
  A("dungeon", "starving-artist", "Starving Artist", "Rest without a ration 5 times.", "utensils", "hungry", 5, true),

  A("combat", "scrapper", "Scrapper", "Win 5 fights.", "swords", "wins", 5),
  A("combat", "brawler", "Brawler", "Win 10 fights.", "swords", "wins", 10),
  A("combat", "champion", "Champion", "Win 100 fights.", "crown", "wins", 100),
  A("combat", "monster-hunter", "Monster Hunter", "Defeat 25 foes.", "skull", "foes", 25),
  A("combat", "legendary-slayer", "Legendary Slayer", "Defeat 500 foes.", "skull", "foes", 500),
  A("combat", "prime-mover", "Prime Mover", "Land your first Prime Attack.", "zap", "primes", 1),
  A("combat", "bullseye", "Bullseye", "Land your first Exact Strike.", "crosshair", "exacts", 1),
  A("combat", "lightning-strikes", "Lightning Strikes Twice", "Land 50 Prime Attacks.", "zap", "primes", 50),
  A("combat", "surgeon", "Surgeon", "Land 50 Exact Strikes.", "crosshair", "exacts", 50),
  A("combat", "unstoppable", "Unstoppable", "Win 5 fights in a row.", "shield", "winStreakBest", 5),
  A("combat", "invincible", "Invincible", "Win 15 fights in a row.", "shield", "winStreakBest", 15, true),
  A("combat", "attrition", "War of Attrition", "See a fight through 10 rounds.", "heart", "longestFight", 10),
  A("combat", "outnumbered", "Outnumbered", "Win a fight against 3 or more foes.", "swords", "mostFoes", 3),
  A("combat", "treasure-hunter", "Treasure Hunter", "Find loot 25 times.", "coins", "loot", 25),
  A("combat", "learning-ropes", "Learning the Ropes", "Earn 100 XP in total.", "star", "xp", 100),
  A("combat", "battle-hardened", "Battle-Hardened", "Earn 5,000 XP in total.", "star-filled", "xp", 5000),
  A("combat", "swift-justice", "Swift Justice", "Win 10 fights in a single round.", "zap", "quick", 10),

  A("dice", "warm-up", "Warm Up", "Roll 100 dice.", "dice", "dice", 100),
  A("dice", "bone-thrower", "Bone Thrower", "Roll 1,000 dice.", "dice", "dice", 1000),
  A("dice", "dice-goblin", "Dice Goblin", "Roll 5,000 dice.", "dice", "dice", 5000),
  A("dice", "sixty-six", "Sixty-Six", "Roll D66 100 times.", "dice", "d66", 100),
  A("dice", "seeing-double", "Seeing Double", "Roll 50 doubles.", "dice", "doubles", 50),
  A("dice", "midnight", "Midnight", "Roll 10 double sixes.", "sparkles", "sixes", 10),
  A("dice", "cursed-dice", "Cursed Dice", "Roll 3 double ones.", "skull", "ones", 3, true),
  A("dice", "full-set", "Full Set", "Roll every double, from ones to sixes.", "layout-grid", "doubleKinds", 6),
  A("dice", "mirror-mirror", "Mirror, Mirror", "Roll three doubles in a row.", "sparkles", "doubleStreakBest", 3),

  A("realm", "lord-of-the-land", "Lord of the Land", "Claim 25 plots.", "crown", "claims", 25),
  A("realm", "architect", "Architect", "Start 5 buildings.", "hammer", "buildings", 5),
  A("realm", "city-planner", "City Planner", "Start 25 buildings.", "castle", "buildings", 25),
  A("realm", "steward", "Steward", "See 24 months end.", "calendar", "months", 24),
  A("realm", "dynasty", "Dynasty", "See 120 months end: ten years of rule.", "crown", "months", 120),
  A("realm", "surveyor", "Surveyor", "Explore 10 plots.", "compass", "plots", 10),
  A("realm", "eventful-times", "Eventful Times", "Roll 10 monthly or yearly events.", "scroll", "realmEvents", 10),

  A("character", "journeyman", "Journeyman", "Reach character level 3.", "trophy", "level", 3),

  // ----- the legendary rewards: beat dungeon level 10, then roll Your Legendary Reward (Core Rules p.37) -----
  ...LEGENDARY_REWARDS.map((r) => A("legend", `legend-${r.roll}`, r.name, `Reach dungeon level 10, then roll it on Your Legendary Reward (${r.roll}).`, r.icon, `legend${r.roll}`, 1)),

  // ----- 2D6 Void: counters start "v:"; the dice achievements above count both games' rolls -----
  A("void-hulk", "v-boarding-party", "Boarding Party", "Explore your first Dark Hulk room.", "door-closed", "v:rooms", 1),
  A("void-hulk", "v-deckhand", "Deckhand", "Explore 10 Dark Hulk rooms.", "door-closed", "v:rooms", 10),
  A("void-hulk", "v-corridor-crawler", "Corridor Crawler", "Explore 50 Dark Hulk rooms.", "map", "v:rooms", 50),
  A("void-hulk", "v-hulk-runner", "Hulk Runner", "Explore 100 Dark Hulk rooms.", "map", "v:rooms", 100),
  A("void-hulk", "v-ship-surveyor", "Ship Surveyor", "Explore 250 Dark Hulk rooms.", "compass", "v:rooms", 250),
  A("void-hulk", "v-cargo-bays", "Cargo Bays", "Explore 10 large rooms in the Dark Hulk.", "landmark", "v:largeRooms", 10),
  A("void-hulk", "v-lower-decks", "Lower Decks", "Reach Dark Hulk level 2.", "arrow-down", "v:depth", 2),
  A("void-hulk", "v-midships", "Midships", "Reach Dark Hulk level 5.", "arrow-down", "v:depth", 5),
  A("void-hulk", "v-null-void", "The Null Void", "Reach level 9, the Null Void.", "sparkles", "v:depth", 9),
  A("void-hulk", "v-ai-hive", "Into the Hive", "Reach level 10, the AI Hive.", "zap", "v:depth", 10),
  A("void-hulk", "v-airlock", "Through the Airlock", "Get through your first door in the Dark Hulk.", "door-closed", "v:doors", 1),
  A("void-hulk", "v-bulkhead-buster", "Bulkhead Buster", "Get through 25 doors in the Dark Hulk.", "door-closed", "v:doors", 25),
  A("void-hulk", "v-access-granted", "Access Granted", "Force, hack or bypass your first lock.", "key-round", "v:picks", 1),
  A("void-hulk", "v-code-breaker", "Code Breaker", "Force, hack or bypass 25 locks.", "key-round", "v:picks", 25),
  A("void-hulk", "v-hull-rat", "Hull Rat", "Rest between levels 5 times.", "sun-moon", "v:rests", 5),
  A("void-hulk", "v-ration-pack", "Ration Pack", "Eat 10 rations while resting.", "utensils", "v:rations", 10),
  A("void-hulk", "v-running-on-empty", "Running on Empty", "Rest without a ration.", "utensils", "v:hungry", 1, true),

  A("void-combat", "v-first-contact", "First Contact", "Win your first fight against an alien.", "crosshair", "v:wins", 1),
  A("void-combat", "v-xeno-hunter", "Xeno Hunter", "Win 10 fights in the Dark Hulk.", "crosshair", "v:wins", 10),
  A("void-combat", "v-exterminator", "Exterminator", "Win 50 fights in the Dark Hulk.", "skull", "v:wins", 50),
  A("void-combat", "v-purge-protocol", "Purge Protocol", "Defeat 100 aliens.", "skull", "v:foes", 100),
  A("void-combat", "v-clean-kill", "Clean Kill", "Win a fight in a single round.", "zap", "v:quick", 1),
  A("void-combat", "v-swarmed", "Swarmed", "Win a fight against 3 or more aliens.", "swords", "v:mostFoes", 3),
  A("void-combat", "v-unbroken", "Unbroken", "Win 5 fights in a row in the Dark Hulk.", "shield", "v:winStreakBest", 5),
  A("void-combat", "v-scavenger", "Scavenger", "Search 10 alien caches.", "coins", "v:loot", 10),
  A("void-combat", "v-spacer", "Spacer", "Earn 1,000 XP in the Dark Hulk.", "star", "v:xp", 1000),
  A("void-combat", "v-void-veteran", "Void Veteran", "Earn 5,000 XP in the Dark Hulk.", "star-filled", "v:xp", 5000),
  A("void-combat", "v-lost-in-the-void", "Lost in the Void", "Lose a fight against an alien.", "heart", "v:losses", 1, true),

  A("void-survivor", "v-promoted", "Promoted", "Reach survivor level 2.", "trophy", "v:level", 2),
  A("void-survivor", "v-seasoned-spacer", "Seasoned Spacer", "Reach survivor level 5.", "trophy", "v:level", 5),
  A("void-survivor", "v-master-of-the-void", "Master of the Void", "Reach survivor level 10.", "crown", "v:level", 10),

  A("void-legend", "v-escape-velocity", "Escape Velocity", "Launch the Escape Pod and leave the Dark Hulk.", "flag", "v:escape", 1),
];

const BY_ID = new Map(ACHIEVEMENTS.map((d) => [d.id, d]));
export const achDef = (id: string): AchDef | undefined => BY_ID.get(id);

export interface AchState {
  v: 1;
  counters: Record<string, number>;
  unlocked: Record<string, number>; // id → when (ms)
}

export const emptyAch = (): AchState => ({ v: 1, counters: {}, unlocked: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isAchState(v: unknown): v is AchState {
  return isObj(v) && v.v === 1 && isObj(v.counters) && isObj(v.unlocked);
}

/** Keep only numeric counters and unlocks of achievements that exist (a hand-edited backup can't break the page). */
export function normalizeAch(s: AchState): AchState {
  const counters: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.counters)) if (num(v) && v >= 0) counters[k] = v;
  const unlocked: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.unlocked)) if (BY_ID.has(k) && num(v)) unlocked[k] = v;
  return { v: 1, counters, unlocked };
}

// ---------- reducers: each returns the ids newly unlocked ----------
export function checkUnlocks(s: AchState, at: number): string[] {
  const out: string[] = [];
  for (const d of ACHIEVEMENTS) {
    if (s.unlocked[d.id] !== undefined) continue;
    if ((s.counters[d.counter] ?? 0) >= d.goal) {
      s.unlocked[d.id] = at;
      out.push(d.id);
    }
  }
  return out;
}

/** Add `by` to a counter. */
export function bump(s: AchState, counter: string, at: number, by = 1): string[] {
  if (by <= 0) return [];
  s.counters[counter] = (s.counters[counter] ?? 0) + by;
  return checkUnlocks(s, at);
}

/** Keep the highest value seen (deepest level, highest character level). */
export function raise(s: AchState, counter: string, value: number, at: number): string[] {
  if (!(value > (s.counters[counter] ?? 0))) return [];
  s.counters[counter] = value;
  return checkUnlocks(s, at);
}

/** A run of hits: `counter` counts the current run (reset on a miss), `best` keeps the longest. */
export function streak(s: AchState, counter: string, best: string, hit: boolean, at: number): string[] {
  s.counters[counter] = hit ? (s.counters[counter] ?? 0) + 1 : 0;
  return raise(s, best, s.counters[counter], at);
}

// ---------- event mappers ----------
export function onRoom(s: AchState, ev: JournalRoomEvent, at: number, p: AchPrefix = ""): string[] {
  const out = raise(s, p + "depth", ev.level, at);
  if (ev.phase === "finish") {
    out.push(...bump(s, p + "rooms", at));
    if (ev.kind === "large") out.push(...bump(s, p + "largeRooms", at));
  }
  if (ev.encounter) out.push(...bump(s, p + "encounters", at)); // sent once per patrol / interruption roll
  return out;
}

export function onDoor(s: AchState, ev: JournalDoorEvent, at: number, p: AchPrefix = ""): string[] {
  if (!ev.ok) return [];
  const extra = ({ pick: "picks", portcullis: "portcullis", slab: "slabs" } as Partial<Record<JournalDoorEvent["check"], string>>)[ev.check];
  return [...bump(s, p + "doors", at), ...(extra ? bump(s, p + extra, at) : [])];
}

export function onFight(s: AchState, ev: JournalFightEvent, at: number, p: AchPrefix = ""): string[] {
  if (ev.phase === "xp") return bump(s, p + "xp", at, ev.xp);
  if (ev.phase === "loot") return bump(s, p + "loot", at);
  const won = ev.outcome === "won";
  const out = [...raise(s, p + "longestFight", ev.rounds, at), ...streak(s, p + "winStreak", p + "winStreakBest", won, at)];
  if (!won) return [...out, ...bump(s, p + "losses", at)];
  return [
    ...out, ...bump(s, p + "wins", at), ...bump(s, p + "foes", at, ev.foes.length), ...raise(s, p + "mostFoes", ev.foes.length, at),
    ...(ev.rounds <= 1 ? bump(s, p + "quick", at) : []),
  ];
}

/** Rest, descend, or leave: in the Dungeon leaving is an exit shaft; in the Dark Hulk it is the Escape Pod from level 10. */
export function onMilestone(s: AchState, ev: JournalMilestoneEvent, at: number, p: AchPrefix = ""): string[] {
  if (ev.kind === "descend") return raise(s, p + "depth", ev.to, at);
  if (ev.kind === "rest") return [...bump(s, p + "rests", at), ...bump(s, p + (ev.ration ? "rations" : "hungry"), at)];
  return bump(s, p === VOID_PREFIX ? "v:escape" : "shafts", at);
}

export function onRealm(s: AchState, ev: JournalRealmEvent, at: number): string[] {
  if (ev.kind === "plot") return [...bump(s, "plots", at), ...(ev.claimed ? bump(s, "claims", at) : [])];
  if (ev.kind === "month") return bump(s, "months", at);
  return bump(s, "realmEvents", at);
}

/**
 * Any roll of the dice. Two matching dice are a double; runs of doubles (and of double sixes) build
 * streaks. A roll of one die, or of three or more, doesn't break a run.
 */
export function onDice(s: AchState, dice: readonly number[], at: number, kind = ""): string[] {
  const out = bump(s, "dice", at, dice.length);
  if (kind.toUpperCase() === "D66") out.push(...bump(s, "d66", at));
  if (dice.length !== 2) return out;
  const double = dice[0] === dice[1];
  const six = double && dice[0] === 6;
  if (double) {
    out.push(...bump(s, "doubles", at));
    s.counters[`dbl${dice[0]}`] = 1; // which faces have come up as a double (Full Set)
    out.push(...raise(s, "doubleKinds", [1, 2, 3, 4, 5, 6].filter((f) => s.counters[`dbl${f}`]).length, at));
  }
  if (six) out.push(...bump(s, "sixes", at));
  if (double && dice[0] === 1) out.push(...bump(s, "ones", at));
  out.push(...streak(s, "doubleStreak", "doubleStreakBest", double, at));
  out.push(...streak(s, "sixStreak", "sixStreakBest", six, at));
  return out;
}

export function onCombatHit(s: AchState, kind: "prime" | "exact", at: number): string[] {
  return bump(s, kind === "prime" ? "primes" : "exacts", at);
}

/** Compare reward names whatever the apostrophes, case or spacing (a hand-fixed table may differ). */
const plain = (t: string) => t.toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, " ").trim();

/**
 * A table roll from the Results panel: a roll on Your Legendary Reward wins that reward, once the
 * adventurer has made it to dungeon level 10 (the app can't see level 10 completed; reaching it is
 * the closest thing it records). Earlier rolls, like reading ahead in the book, don't count.
 */
export function onTableRoll(s: AchState, card: { sectionId?: string; title: string }, at: number): string[] {
  if (card.sectionId !== LEGENDARY_SECTION || (s.counters.depth ?? 0) < 10) return [];
  const r = LEGENDARY_REWARDS.find((x) => plain(x.name) === plain(card.title));
  return r ? bump(s, `legend${r.roll}`, at) : [];
}

export const onBuilding =(s: AchState, at: number): string[] => bump(s, "buildings", at);
export const onLevel = (s: AchState, level: number, at: number, p: AchPrefix = ""): string[] => raise(s, p + "level", level, at);

// ---------- the page's view ----------
export interface AchCard { def: AchDef; title: string; blurb: string; value: number; pct: number; unlocked?: number; hidden: boolean }
export interface AchSection { id: AchGroup; title: string; game: "dungeon" | "void" | "both"; cards: AchCard[] }

/** Achievements on the same counter sit together, smallest goal first, in the order their counter first appears. */
const COUNTER_ORDER = new Map<string, number>();
ACHIEVEMENTS.forEach((d, i) => { if (!COUNTER_ORDER.has(d.counter)) COUNTER_ORDER.set(d.counter, i); });
const byLadder = (a: AchDef, b: AchDef) => COUNTER_ORDER.get(a.counter)! - COUNTER_ORDER.get(b.counter)! || a.goal - b.goal;

export function achView(s: AchState): { sections: AchSection[]; done: number; total: number } {
  const sections = GROUPS.map((g) => ({
    ...g,
    cards: ACHIEVEMENTS.filter((d) => d.group === g.id).sort(byLadder).map((def): AchCard => {
      const unlocked = s.unlocked[def.id];
      const value = Math.min(def.goal, s.counters[def.counter] ?? 0);
      const hidden = !!def.secret && unlocked === undefined;
      return {
        def,
        title: hidden ? "???" : def.title,
        blurb: hidden ? "A secret achievement." : def.blurb,
        value: unlocked !== undefined ? def.goal : value,
        pct: unlocked !== undefined ? 100 : Math.floor((value / def.goal) * 100),
        ...(unlocked !== undefined ? { unlocked } : {}),
        hidden,
      };
    }),
  }));
  return { sections, done: Object.keys(s.unlocked).length, total: ACHIEVEMENTS.length };
}
