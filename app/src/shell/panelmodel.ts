// DOM-free helpers for the right panel and its Results tab: saved tab, badge bookkeeping,
// follow-on root resolution.
import type { ResultCard } from "./types";

export type PanelId = "results" | "notes" | "journal";
export const PANEL_IDS: readonly PanelId[] = ["results", "notes", "journal"];

export const isPanelId = (v: unknown): v is PanelId => typeof v === "string" && (PANEL_IDS as readonly string[]).includes(v);

/** The saved panel tab (`2d6:shell:layout.panelTab`); missing or invalid (e.g. the removed "character" and "map" tabs) means Results. */
export const panelTab = (s: Record<string, unknown>): PanelId => (isPanelId(s.panelTab) ? s.panelTab : "results");

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
