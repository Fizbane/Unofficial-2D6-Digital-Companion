// What a room's rolls changed on the character by themselves (conditions a result states, loot it finds,
// prisoners freed), kept on the room so Undo turn or rolling the room again can take it back.
//   revertAuto(c, log)   undo what the log recorded; a value changed since (by the player, a fight) is left alone
//   findRoll(state, id)  the saved roll with this stable id anywhere in a tool's saved state
import { joinItems, normItem, splitItems } from "./gear";

export interface AutoLog {
  conds?: { field: "bloodied" | "stunned"; before: number; after: number }[];
  loot?: string[];
  prisoners?: number;
}

/** Take one line per item out of a pack list. */
export function removeLoot(text: string, items: readonly string[]): string {
  const lines = splitItems(text);
  for (const it of items) {
    const i = lines.findIndex((l) => l === it || normItem(l) === normItem(it));
    if (i >= 0) lines.splice(i, 1);
  }
  return joinItems(lines);
}

/** Undo what `log` recorded on `c`. Returns what was taken back, for a toast. */
export function revertAuto(c: { small: string; bloodied?: number; stunned?: number; prisoners?: number }, log: AutoLog): string[] {
  const out: string[] = [];
  for (const x of [...(log.conds ?? [])].reverse()) {
    if (c[x.field] === x.after) {
      c[x.field] = x.before;
      out.push(x.field === "bloodied" ? "Bloodied" : "Stunned");
    }
  }
  if (log.loot?.length) {
    c.small = removeLoot(c.small ?? "", log.loot);
    out.push(log.loot.join(", "));
  }
  if (log.prisoners && typeof c.prisoners === "number") {
    c.prisoners = Math.max(0, c.prisoners - log.prisoners);
    out.push(`${log.prisoners} prisoner tall${log.prisoners === 1 ? "y" : "ies"}`);
  }
  return out;
}

/** A short, stable id for a saved roll (kept with it, so a button can find it again after a redraw). */
export const rollId = (): string => Math.random().toString(36).slice(2, 10);

/** The object with `lid === id` anywhere inside `state` (saved rolls sit in rooms, loose results and door notes). */
export function findRoll<T extends { lid?: string }>(state: unknown, id: string): T | undefined {
  const seen = new Set<unknown>();
  const walk = (v: unknown): T | undefined => {
    if (!v || typeof v !== "object" || seen.has(v)) return undefined;
    seen.add(v);
    if ((v as { lid?: unknown }).lid === id) return v as T;
    for (const x of Array.isArray(v) ? v : Object.values(v)) {
      const hit = walk(x);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(state);
}
