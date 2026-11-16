// DOM-free helpers for the right panel and its Results tab: saved tab, badge bookkeeping,
// follow-on root resolution.
import type { ResultCard } from "./types";

export type PanelId = "results" | "notes" | "journal" | "combat";
export const PANEL_IDS: readonly PanelId[] = ["results", "notes", "journal", "combat"];

export const isPanelId = (v: unknown): v is PanelId => typeof v === "string" && (PANEL_IDS as readonly string[]).includes(v);

/** The saved panel tab (`2d6:shell:layout.panelTab`); missing or invalid (e.g. the removed "character" and "map" tabs) means Results. */
export const panelTab = (s: Record<string, unknown>): PanelId => (isPanelId(s.panelTab) ? s.panelTab : "results");

/** The tab an arrow key, Home or End moves to from `active`, skipping tabs that aren't showing. */
export function stepPanel<T extends string>(ids: readonly T[], active: T, to: 1 | -1 | "first" | "last", hidden: ReadonlySet<string>): T {
  const on = ids.filter((id) => !hidden.has(id));
  if (!on.length) return active;
  if (to === "first") return on[0];
  if (to === "last") return on[on.length - 1];
  const i = on.indexOf(active);
  return on[(i + to + on.length) % on.length];
}

/** The saved play state the Combat log tab looks at (each as loaded, or null). */
export interface DelveState { dungeon: unknown; lairs: unknown; haunted: unknown; vhulk: unknown; fighting: boolean }
/**
 * Does the Combat log tab show? Only somewhere a fight happens: a dungeon level that has begun, a lair, the
 * haunted house (2D6 Dungeon), or a Dark Hulk level that has been entered (2D6 Void). A fight under way shows
 * it wherever you are, so its log is never out of reach.
 */
export function combatLogShown(game: "dungeon" | "void", s: DelveState): boolean {
  if (s.fighting) return true;
  const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  if (game === "void") return !!o(s.vhulk).map;
  const d = o(s.dungeon), l = o(s.lairs), h = o(s.haunted);
  const count = (v: unknown) => (Array.isArray(v) ? v.reduce<number>((a, x) => a + (typeof x === "number" ? x : 0), 0) : 0);
  return (Array.isArray(d.rooms) && d.rooms.length > 0) || !!d.current
    || (typeof l.lair === "string" && l.lair !== "")
    || count(h.rooms) > 0 || (typeof h.fear === "number" && h.fear > 0) || h.loftCleared === true;
}

/**
 * The top-level card a follow-on should nest under. The store keeps one nesting level, so a
 * follow-on rolled from a child card goes under that child's root. Unknown ids resolve to
 * themselves (the card may have been evicted); cycles stop at the last card seen.
 */
export function rootId(cards: readonly ResultCard[], id: string): string {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    const c = byId.get(cur);
    if (!c?.parent || seen.has(cur) || !byId.has(c.parent)) return cur;
    seen.add(cur);
    cur = c.parent;
  }
}

/** Which panel tabs hold content the user hasn't seen yet. */
export class Badges {
  private unseen = new Set<PanelId>();

  /** New content arrived on `id`; badge it unless it is on screen right now. Returns true when badged. */
  mark(id: PanelId, visible: boolean): boolean {
    if (visible) return false;
    this.unseen.add(id);
    return true;
  }

  /** `id` is on screen: clear its badge. */
  seen(id: PanelId): void {
    this.unseen.delete(id);
  }

  has(id: PanelId): boolean {
    return this.unseen.has(id);
  }

  /** True when any tab has unseen content (drives the dot on the panel toggle). */
  any(): boolean {
    return this.unseen.size > 0;
  }
}
