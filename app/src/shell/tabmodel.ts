// Live tabs, each with its own back/forward history of routes. Pure: no DOM, no storage.
export interface Tab { id: string; history: string[]; index: number } // history holds routes, e.g. "#/s/dungeon/enat1", "#/play/combat", "#/"
export interface TabsState { v: 1; tabs: Tab[]; active: string | null }

function isTab(v: unknown): v is Tab {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Tab;
  return (
    typeof t.id === "string" &&
    Array.isArray(t.history) &&
    t.history.length > 0 &&
    t.history.every((r) => typeof r === "string") &&
    Number.isInteger(t.index) &&
    t.index >= 0 &&
    t.index < t.history.length
  );
}

export function isTabsState(v: unknown): v is TabsState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as TabsState;
  return s.v === 1 && Array.isArray(s.tabs) && s.tabs.every(isTab) && (typeof s.active === "string" || s.active === null);
}

/** The route without its "?find=…" parameter, used for "already open" checks. */
export const routeKey = (route: string): string => {
  const q = route.indexOf("?");
  if (q < 0) return route;
  const params = route
    .slice(q + 1)
    .split("&")
    .filter((p) => p !== "" && !p.startsWith("find="));
  return route.slice(0, q) + (params.length ? "?" + params.join("&") : "");
};

/** Counter ids "t1", "t2", … starting past the highest "t<n>" already in `tabs`. */
function counterIds(tabs: Tab[]): () => string {
  let n = 0;
  for (const t of tabs) {
    const m = /^t(\d+)$/.exec(t.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return () => `t${++n}`;
}

/** Most routes kept in one tab's history; older entries are dropped. */
export const HISTORY_CAP = 50;

/** Play tools hold live state, so only one tab may show each at a time. */
const isExclusive = (route: string): boolean => route.startsWith("#/play/");

export class TabModel {
  private s: TabsState;
  private newId: () => string;

  constructor(state?: TabsState, newId?: () => string) {
    this.s = state
      ? { v: 1, tabs: state.tabs.map((t) => ({ id: t.id, history: [...t.history], index: t.index })), active: state.active }
      : { v: 1, tabs: [], active: null };
    this.newId = newId ?? counterIds(this.s.tabs);
  }

  /** Plain object, safe to writeState. */
  get state(): TabsState {
    return this.s;
  }

  get active(): Tab | null {
    return this.s.tabs.find((t) => t.id === this.s.active) ?? null;
  }

  current(tab: Tab): string {
    return tab.history[tab.index];
  }

  open(route: string, opts?: { newTab?: boolean }): Tab {
    const key = routeKey(route);
    const existing = this.s.tabs.find((t) => routeKey(this.current(t)) === key);
    if (existing) {
      this.s.active = existing.id;
      existing.history[existing.index] = route;
      return existing;
    }
    const active = this.active;
    if (opts?.newTab || !active) {
      const tab: Tab = { id: this.newId(), history: [route], index: 0 };
      const at = active ? this.s.tabs.indexOf(active) + 1 : this.s.tabs.length;
      this.s.tabs.splice(at, 0, tab);
      this.s.active = tab.id;
      return tab;
    }
    active.history.splice(active.index + 1);
    active.history.push(route);
    if (active.history.length > HISTORY_CAP) active.history.splice(0, active.history.length - HISTORY_CAP);
    active.index = active.history.length - 1;
    return active;
  }

  back(): boolean {
    return this.step(-1);
  }

  forward(): boolean {
    return this.step(1);
  }

  /**
   * Move the active tab one entry along its history. When that entry is a play tool another tab
   * is already showing, switch to that tab instead and leave this tab where it was, so a tool is
   * never live twice.
   */
  private step(by: -1 | 1): boolean {
    const t = this.active;
    if (!t) return false;
    const i = t.index + by;
    if (i < 0 || i >= t.history.length) return false;
    const route = t.history[i];
    const holder = isExclusive(route) ? this.s.tabs.find((o) => o !== t && this.current(o) === route) : undefined;
    if (holder) this.s.active = holder.id;
    else t.index = i;
    return true;
  }

  activate(id: string): void {
    if (this.s.tabs.some((t) => t.id === id)) this.s.active = id;
  }

  close(id: string): void {
    const i = this.s.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.s.tabs.splice(i, 1);
    if (this.s.active !== id) return;
    const next = this.s.tabs[i] ?? this.s.tabs[i - 1];
    this.s.active = next ? next.id : null;
  }

  /** Drop routes failing `isValidRoute`, then tabs left empty, and repoint `active` if needed. */
  restore(isValidRoute: (route: string) => boolean): void {
    const kept: Tab[] = [];
    for (const t of this.s.tabs) {
      const history: string[] = [];
      let index = 0;
      t.history.forEach((r, i) => {
        if (!isValidRoute(r)) return;
        history.push(r);
        if (i <= t.index) index = history.length - 1; // last surviving entry at or before the old index
      });
      if (history.length) kept.push({ id: t.id, history, index });
    }
    this.s.tabs = kept;
    if (!kept.some((t) => t.id === this.s.active)) this.s.active = kept[0]?.id ?? null;
  }
}
