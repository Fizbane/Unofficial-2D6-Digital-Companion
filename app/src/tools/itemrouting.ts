// Where an item from the Items page goes on a character sheet ("Add to character"), DOM-free. Each item kind has
// its own field: armour into the armour rows, a potion into the potion rows, a gem into treasure, and so on.
// Where the book's own table row is known it is used, so the sheet row reads the same as one added from the
// sheet's picker; otherwise the item goes in by name. The caller saves the character when `ok`.
import type { Section } from "../types";
import type { Character } from "./sheet";
import { addLine, armourPicks, fillFirstEmpty, potionPicks, scrollPicks, pickFor, type RowPick } from "./sheetpicks";
import { MAX_STIMS, addLarge, armourPiece, armourTable, rangedProblem, stimTable, weaponCards, weaponFromCard, wearProblem, type VoidCharacter } from "./void/sheetmodel";
import type { ItemEntry } from "./itemsmodel";

export interface Routed { ok: boolean; msg: string }
const done = (msg: string): Routed => ({ ok: true, msg });
const no = (msg: string): Routed => ({ ok: false, msg });
const norm = (s: string) => s.toLowerCase().replace(/['‘’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const NOT_CARRIED = (e: ItemEntry) => no(`${e.name} is an upgrade, not something you carry. Note it on the sheet yourself.`);

/** Put an item on a 2D6 Dungeon character. */
export function addToDungeonChar(c: Character, e: ItemEntry, byId: ReadonlyMap<string, Section>): Routed {
  const into = (list: "armour" | "scrolls" | "potions", n: number, picks: RowPick[], fallback: string[], what: string): Routed => {
    const row = pickFor(picks, e.name)?.row ?? fallback;
    if (c[list].slice(0, n).every((r) => r[0]?.trim())) return no(`Every ${what} row is full (${n} / ${n}). Clear one first.`);
    fillFirstEmpty(c[list], row);
    return done(`${e.name} added to your ${what} rows.`);
  };
  switch (e.cat) {
    case "armour": return into("armour", 3, armourPicks(byId), [e.name, "", ""], "armour");
    case "scroll": return into("scrolls", 3, scrollPicks(byId), [e.name, "", "", e.text], "scroll");
    case "potion": return into("potions", 5, potionPicks(byId), [e.name, e.text], "potion");
    case "gem": c.treasure = addLine(c.treasure, e.name); return done(`${e.name} added to your treasure.`);
    case "weapon": {
      const i = c.large.findIndex((v) => !v.trim());
      if (i < 0) return no("All large item slots are full. Drop something first.");
      c.large[i] = e.name;
      return done(`${e.name} added to your large items.`);
    }
    case "upgrade": return NOT_CARRIED(e);
    default: c.small = addLine(c.small, e.name); return done(`${e.name} added to your small items.`);
  }
}

/** Put an item on a 2D6 Void survivor. */
export function addToVoidChar(c: VoidCharacter, e: ItemEntry): Routed {
  const largeOrFail = (): Routed => (addLarge(c, e.name) ? done(`${e.name} added to your large items.`) : no("All large item slots are full. Drop something first."));
  switch (e.cat) {
    case "armour": {
      const r = armourTable().find((x) => norm(x.name) === norm(e.name));
      if (!r) return largeOrFail();
      const why = wearProblem(c, r.name);
      if (why) return no(why);
      c.armour.push(armourPiece(r));
      return done(`${r.name} is now worn.`);
    }
    case "weapon": {
      const card = weaponCards().find((w) => norm(w.name) === norm(e.name));
      const w = card ? weaponFromCard(card.id) : null;
      if (!w) return largeOrFail();
      const why = rangedProblem(c, w.size);
      if (why) return no(`${why} Leave one behind first.`);
      c.ranged.push(w);
      return done(`${w.name} added to your ranged weapons.`);
    }
    case "stim": {
      const s = stimTable().find((x) => norm(x.type) === norm(e.name));
      if (!s) return no(`${e.name} is not in the stims table.`);
      if (c.stims.length >= MAX_STIMS) return no(`All ${MAX_STIMS} injectors are taken. Discard one first.`);
      c.stims.push({ type: s.type });
      return done(`${s.type} stim added.`);
    }
    case "artefact": c.artefacts = addLine(c.artefacts, e.name); return done(`${e.name} added to your artefacts.`);
    case "upgrade": return NOT_CARRIED(e);
    default: c.small = addLine(c.small, e.name); return done(`${e.name} added to your small items.`);
  }
}
