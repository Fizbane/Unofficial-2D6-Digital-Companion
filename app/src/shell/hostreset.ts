// What a content change (a book unlocked or locked) does to the tab hosts. Kept apart from tabs.ts (DOM-heavy)
// so it can be tested without a DOM.

/** The parts of a tab host this touches. */
export interface HostLike {
  el: { replaceChildren(): void };
  route: string | null;
  page: unknown;
  token: number;
}

/**
 * Section and Home hosts are marked stale (re-mounted by the caller's sync() when shown); tools redraw
 * themselves. When content was `removed` (a Lock) every hidden tab is also emptied (its page disposed, any
 * mount in flight dropped), so no locked text stays in a hidden tab's DOM. An unlock or import removes nothing,
 * so a hidden tool keeps its DOM, and any half-filled form in it.
 */
export function resetForContentChange<H extends HostLike>(
  hosts: ReadonlyMap<string, H>, shown: string | null, isTool: (route: string) => boolean, dispose: (h: H) => void,
  removed: boolean,
): void {
  for (const [id, h] of hosts) {
    if (id === shown || !removed) {
      if (h.route && !isTool(h.route)) h.route = null;
      continue;
    }
    h.token++;
    dispose(h);
    h.el.replaceChildren();
    h.page = null;
    h.route = null;
  }
}
