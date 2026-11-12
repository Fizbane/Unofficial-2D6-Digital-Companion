// Top-bar status text: a one-line summary of the dungeon or realm in play.
export interface DungeonSummary { level: number; room: number; rations: number }
export interface RealmSummary { month: number; round: number; treasury: number }
export type Context = "dungeon" | "realm";

export function contextOf(route: string | null): Context | null {
  if (route == null) return null;
  const path = route.split("?")[0];
  if (path === "#/play/dungeon" || path === "#/play/combat") return "dungeon";
  if (path === "#/play/realm") return "realm";
  return null;
}

export function statusText(o: {
  route: string | null;
  last: Context | null;
  dungeon: DungeonSummary | null;
  realm: RealmSummary | null;
}): { text: string; target: "#/play/dungeon" | "#/play/realm" } | null {
  const ctx = contextOf(o.route) ?? o.last;
  if (ctx === "dungeon" && o.dungeon) {
    const d = o.dungeon;
    return { text: `Level ${d.level} · Room ${d.room} · Rations ${d.rations}`, target: "#/play/dungeon" };
  }
  if (ctx === "realm" && o.realm) {
    const r = o.realm;
    return { text: `Month ${r.month} · Round ${r.round} · Treasury ${r.treasury} gc`, target: "#/play/realm" };
  }
  return null;
}

/** Saved dungeon state, as much of it as the status needs. */
export interface DungeonLike { level: number; rooms: unknown[]; current: { n: number } | null }

/** The dungeon summary, or null when no dungeon has been started (no rooms and no room in progress). */
export function dungeonSummary(d: DungeonLike, rations: number): DungeonSummary | null {
  const rooms = Array.isArray(d.rooms) ? d.rooms : [];
  if (rooms.length === 0 && !d.current) return null;
  return { level: d.level, room: d.current?.n ?? rooms.length, rations };
}

/** The realm summary from the saved realm state, or null when there is none ("2d6:play:realm" missing). */
export function realmSummary(r: { month: number; round: number; gc: number } | null): RealmSummary | null {
  return r ? { month: r.month, round: r.round, treasury: r.gc } : null;
}

export const isContext = (v: unknown): v is Context => v === "dungeon" || v === "realm";

/** Home's Continue card lines, built from the same summaries as the top-bar status. */
export const dungeonLine = (d: DungeonSummary): string => `Level ${d.level} · Room ${d.room}`;
export const realmLine = (r: RealmSummary): string => `Month ${r.month} · Round ${r.round}`;

/**
 * "Name · Lv n · HP n/n" for the saved character, or null while the sheet is blank (no name and
 * no XP). `level` and `baseline` come from the sheet's stats().
 */
export function characterLine(c: { name: string; xp: number; hp: number }, level: number, baseline: number): string | null {
  const name = (c.name ?? "").trim();
  if (!name && !c.xp) return null;
  return `${name || "Unnamed adventurer"} · Lv ${level} · HP ${c.hp}/${baseline}`;
}
