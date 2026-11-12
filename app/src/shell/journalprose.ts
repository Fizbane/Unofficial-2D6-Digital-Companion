// Journal story text: short prose built from each entry's facts with varied phrasing. The phrase
// picked for each slot is seeded by the entry id, so an entry reads the same on every redraw (and
// only changes where its facts do). Plain text out; callers escape it. DOM-free.
import type { ExitType, Side } from "../tools/dmap";
import type { DoorFact, FightData, JournalEntry, MilestoneData, RealmData, RoomData } from "./journalmodel";

export interface Story { heading: string; body: string }

/** The text of a tool's result HTML, without its muted how-to hints. */
export function plainText(html: string): string {
  return html
    .replace(/^\s*<strong>2D6:[^<]*<\/strong>/, "") // Realm's dice header on an encounter
    .replace(/<p class="muted"[^>]*>[\s\S]*?<\/p>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a: a small stable hash of the entry id and slot name. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const pick = <T>(id: string, slot: string, opts: readonly T[]): T => opts[hash(`${id}|${slot}`) % opts.length];
const fill = (t: string, v: Record<string, unknown>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string) => {
  const t = s.trim();
  return !t ? "" : /[.!?…"”’)]$/.test(t) ? cap(t) : `${cap(t)}.`;
};
const article = (s: string) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const NUM = ["no", "one", "two", "three", "four", "five", "six"];

const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
/** "HALL OF THE DEAD" -> "Hall of the Dead"; text that already has lower case is left alone. */
export function titleCase(s: string): string {
  const t = s.trim();
  if (/\p{Ll}/u.test(t)) return t;
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Book text with a shouted label: "QUIET TIMES - Mist settles…" -> "Quiet Times - Mist settles…"; all capitals -> title case. */
export function softCaps(s: string): string {
  const t = s.trim();
  if (!/\p{Ll}/u.test(t)) return titleCase(t);
  return t.replace(/^([^\p{Ll}]{3,}?)(\s+[-–—:]\s+)/u, (_, label: string, sep: string) => titleCase(label) + sep);
}

const SIDE: Record<Side, string> = { N: "north", E: "east", S: "south", W: "west" };
const EXIT_NOUN: Record<ExitType, string> = {
  archway: "archway", wooden: "wooden door", metal: "metal door", reinforced: "reinforced door", portcullis: "portcullis", curtain: "curtained doorway", slab: "stone slab", unknown: "doorway",
  sliding: "sliding door", security: "security door", biocoded: "bio-coded door", barrier: "electrical barrier", secret: "secret panel",
};
const KIND_NOUN: Record<RoomData["kind"], string> = { entrance: "entrance chamber", corridor: "corridor", small: "small chamber", regular: "room", large: "great hall" };

function roomName(d: RoomData): string {
  if (d.title) {
    const t = titleCase(d.title);
    return /^(the|a|an)\s/i.test(t) ? t : `The ${t}`;
  }
  return { entrance: "The Entrance", corridor: "A Corridor", small: "A Small Room", regular: "A Room", large: "A Large Room" }[d.kind];
}

/** "a cramped guard room": size word plus what the room is. */
function roomDesc(id: string, d: RoomData): string {
  const noun = d.title ? titleCase(d.title).toLowerCase().replace(/^(the|a|an)\s+/, "") : KIND_NOUN[d.kind];
  const area = d.w * d.h;
  const adj =
    d.kind === "corridor" ? pick(id, "adj", ["narrow", "long", "draughty"])
      : d.kind === "small" || area <= 6 ? pick(id, "adj", ["cramped", "tight", "low"])
        : d.kind === "large" || area >= 32 ? pick(id, "adj", ["vast", "cavernous", "echoing"])
          : pick(id, "adj", ["dim", "quiet", "musty", "shadowy"]);
  return article(`${adj} ${noun}`);
}

function entrySentence(id: string, d: RoomData): string {
  const desc = roomDesc(id, d);
  const side = d.entry ? SIDE[d.entry] : "";
  if (d.via === "entrance" || d.kind === "entrance") {
    return d.level > 1
      ? fill(pick(id, "in", ["At the foot of the stairs from level {prev}, {desc} opens out.", "The stairs from level {prev} end in {desc}.", "Down the stairs from level {prev} lies {desc}."]), { prev: d.level - 1, desc })
      : fill(pick(id, "in", ["Stone steps lead down from the daylight into {desc}.", "The dungeon begins here: the way in opens onto {desc}.", "Leaving the daylight behind, the steps lead down into {desc}."]), { desc });
  }
  if (!side) return sentence(fill(pick(id, "in", ["{desc} opens out ahead", "Ahead lies {desc}", "The way leads into {desc}"]), { desc }));
  const v = { side, desc, t: d.via ? EXIT_NOUN[d.via as ExitType] ?? "" : "" };
  const t =
    d.via === "archway" ? ["Through an archway from the {side}, the way opens onto {desc}.", "An archway to the {side} leads into {desc}.", "Passing beneath an archway from the {side}, {desc} comes into view."]
      : d.via === "wooden" || d.via === "metal" || d.via === "reinforced" ? ["The {t} from the {side} groans open onto {desc}.", "Beyond the {t} to the {side} lies {desc}.", "The {t} on the {side} side swings open on {desc}."]
        : d.via === "portcullis" ? ["Past the raised portcullis to the {side} lies {desc}.", "Under the portcullis from the {side}, {desc} waits."]
          : d.via === "curtain" ? ["Pushing through a curtain from the {side} reveals {desc}.", "A heavy curtain to the {side} parts on {desc}."]
            : d.via === "slab" ? ["Behind the toppled stone slab to the {side} lies {desc}.", "With the slab to the {side} tipped over, {desc} is revealed."]
              : ["From the {side}, the way leads into {desc}.", "Coming in from the {side}, {desc} opens out."];
  return sentence(fill(pick(id, "in", t), v));
}

function exitsSentence(id: string, d: RoomData): string {
  if (!d.exits.length) return d.exitsKnown && d.kind !== "entrance" ? pick(id, "exits", ["It is a dead end.", "No other way leads on: a dead end.", "There is no other way out."]) : "";
  // a side with a door check gets its own sentence about the lock: don't say "locked" twice
  const checked = new Set((d.doors ?? []).map((f) => f.side));
  const list = andList(d.exits.map((e) => `${article(`${e.locked && !checked.has(e.side) ? "locked " : ""}${EXIT_NOUN[e.type]}`)} to the ${SIDE[e.side]}`));
  const n = d.exits.length;
  const t = n === 1
    ? ["One way leads on: {list}.", "The only way on is {list}.", "{list} leads on."]
    : ["{count} ways lead on: {list}.", "From here, {list} lead on.", "There are {count} ways on: {list}."];
  return sentence(fill(pick(id, "exits", t), { list, count: NUM[n] ?? n }));
}

function encounterSentence(id: string, i: number, x: string): string {
  const t = softCaps(x);
  if (t.length > 40 || /[.!?]$/.test(t)) return sentence(t);
  return fill(pick(id, `enc${i}`, ["{x} waits in the shadows.", "Waiting here: {x}.", "Something stirs: {x}.", "Not alone after all: {x}."]), { x: t });
}

/** "The wooden door to the east is locked." — a Leave-step check on one of this room's exits. */
function doorSentence(f: DoorFact): string {
  const what = `${f.check === "slab" ? "stone slab" : f.check === "portcullis" ? "portcullis" : f.type === "unknown" || f.type === "archway" ? "door" : EXIT_NOUN[f.type]} to the ${SIDE[f.side]}`;
  if (f.check === "door") return `The ${what} is ${f.ok ? "not locked" : "locked"}.`;
  if (f.check === "pick") return f.ok ? `The lock on the ${what} gives way to a careful pick.` : `The lock on the ${what} won't give, and the pick leaves it damaged.`;
  if (f.check === "slab") return `The ${what} ${f.ok ? "tips over" : "doesn't budge"}.`;
  return sentence(`At the ${what}: ${f.detail ? softCaps(f.detail) : "the lever is tried"}`);
}

export function roomStory(id: string, d: RoomData): Story {
  const parts = [
    entrySentence(id, d),
    d.description ? sentence(d.description) : "",
    exitsSentence(id, d),
    ...d.encounters.map((x, i) => encounterSentence(id, i, x)),
    ...(d.doors ?? []).map(doorSentence),
    d.stairs ? pick(id, "stairs", ["Stairs lead down to the next level from here.", "Here the stairs lead down into the dark.", "A stairway in the corner leads further down."]) : "",
  ];
  return { heading: `Level ${d.level} · Room ${d.n} — ${roomName(d)}`, body: parts.filter(Boolean).join(" ") };
}

const plural = (s: string) => (/(s|x|ch|sh)$/i.test(s) ? `${s}es` : `${s}s`);
function foesText(foes: string[]): { text: string; many: boolean } {
  const counts = new Map<string, number>();
  for (const f of foes.map(softCaps)) counts.set(f, (counts.get(f) ?? 0) + 1);
  const parts = [...counts].map(([f, n]) => (n > 1 ? `${n} ${plural(f)}` : f));
  return { text: andList(parts) || "a foe", many: foes.length > 1 };
}

export function fightStory(id: string, d: FightData): Story {
  const { text: foes, many } = foesText(d.foes);
  const v = { foes, r: d.rounds, rounds: d.rounds === 1 ? "round" : "rounds", lie: many ? "lie" : "lies", fall: many ? "fall" : "falls", prove: many ? "prove" : "proves" };
  const t = d.outcome === "won"
    ? ["After {r} {rounds}, {foes} {lie} defeated.", "{foes} {fall} after a hard fight of {r} {rounds}.", "The fight with {foes} lasts {r} {rounds} and ends in victory."]
    : ["After {r} {rounds}, {foes} {prove} too strong, and the adventurer falls.", "The fight with {foes} goes badly: after {r} {rounds} the adventurer falls."];
  const parts = [
    sentence(fill(pick(id, "fight", t), v)),
    d.banked ? `${d.banked} XP banked.` : d.outcome === "won" && d.xp ? `Worth ${d.xp} XP.` : "",
    d.loot.length ? sentence(`Treasure: ${d.loot.map(softCaps).join("; ")}`) : "",
  ];
  return { heading: `Fight — ${foes}`, body: parts.filter(Boolean).join(" ") };
}

export function milestoneStory(id: string, d: MilestoneData): Story {
  if (d.kind === "descend")
    return {
      heading: `Down to level ${d.to}`,
      body: fill(pick(id, "m", ["The stairs spiral down from level {from} into the darkness of level {to}.", "Leaving level {from} behind, the stairs lead down to level {to}.", "Down again: level {from} is done, and level {to} waits below."]), d),
    };
  if (d.kind === "achievement")
    return { heading: `Achievement — ${d.title}`, body: fill(pick(id, "m", ["Achievement unlocked: {title}.", "A deed worth remembering: {title}."]), d) };
  if (d.kind === "levelup")
    return {
      heading: `Level ${d.level} — ${d.title}`,
      body: fill(pick(id, "m", ["Hard-won experience: the adventurer reaches level {level}, {title}.", "Now level {level}: {title}.", "Every fight has taught something. Level {level} at last: {title}."]), d),
    };
  if (d.kind === "rest")
    return d.ration
      ? { heading: "A rest on the stairs", body: fill(pick(id, "m", ["A ration eaten on the stairs restores {hp} HP.", "Resting on the stairs over a ration: +{hp} HP.", "A meal and a moment's rest on the stairs: {hp} HP back."]), d) }
      : { heading: "No ration", body: fill(pick(id, "m", ["With nothing to eat, hunger costs {hp} HP.", "No ration left: the long rest without food costs {hp} HP."]), d) };
  return {
    heading: "An exit shaft",
    body: fill(pick(id, "m", ["An exit shaft is found on level {level}: a way back up to daylight, when it's needed.", "An exit shaft is found on level {level}, its square marked on the map."]), d),
  };
}

const TYPE_DESC = (type: string | undefined, size: number) =>
  /unique/i.test(type ?? "") ? "a unique site" : /string/i.test(type ?? "") ? `a string of ${size} squares` : /area/i.test(type ?? "") ? `an area of ${size} square${size === 1 ? "" : "s"}` : `${size} square${size === 1 ? "" : "s"}`;

export function realmStory(id: string, d: RealmData): Story {
  if (d.kind === "plot") {
    const land = titleCase(d.land || "Unknown land");
    const parts = [
      fill(pick(id, "p", ["Exploring the realm turns up {land}: {desc}.", "Scouts come back with news of {land}: {desc}.", "Beyond the known plots lies {land}: {desc}."]), { land, desc: TYPE_DESC(d.type, d.size) }),
      d.claimed ? pick(id, "c", ["It is claimed for the realm.", "It is ours now, claimed and recorded."]) : d.owner ? `It belongs to ${d.owner}.` : "Someone else holds it.",
      d.encounter ? sentence(`Encounter: ${softCaps(d.encounter)}`) : "",
    ];
    return { heading: `Plot ${d.tag} — ${land}`, body: parts.filter(Boolean).join(" ") };
  }
  const body = d.events.length
    ? d.events.map((e) => sentence(`${e.title}: ${softCaps(e.text)}`)).join(" ")
    : pick(id, "q", ["A quiet month in the realm.", "The month passes quietly.", "Nothing of note troubles the realm this month."]);
  return { heading: d.ended ? `Year ${d.year}, month ${d.month} ends` : `Year ${d.year}, month ${d.month}`, body };
}

/** The entry's heading and the text shown: the player's edit when there is one, else the story. */
export function entryStory(e: JournalEntry): Story & { generated: string } {
  const s =
    e.kind === "room" ? roomStory(e.id, e.data)
      : e.kind === "fight" ? fightStory(e.id, e.data)
        : e.kind === "milestone" ? milestoneStory(e.id, e.data)
          : realmStory(e.id, e.data);
  return { heading: s.heading, body: e.edited && e.text ? e.text : s.body, generated: s.body };
}
