// Route parsing and hash -> tab-model navigation. Pure: no DOM, no storage.
import type { TabModel } from "./tabmodel";

export type Route =
  | { kind: "section"; id: string; find: string | null }
  | { kind: "tool"; id: string }
  | { kind: "home" };

/** "" and "#" mean Home. */
export const normalizeRoute = (hash: string): string => (hash && hash !== "#" ? hash : "#/");

export function parseRoute(route: string): Route {
  const m = route.match(/^#\/s\/(.+)$/);
  if (m) {
    const [rawId, query] = m[1].split("?find=");
    let id = rawId, find: string | null = null;
    try {
      id = decodeURIComponent(rawId);
      find = query ? decodeURIComponent(query) : null;
    } catch {
      /* malformed escape: keep the raw text */
    }
    return { kind: "section", id, find };
  }
  const p = route.match(/^#\/play\/(\w+)/);
  if (p) return { kind: "tool", id: p[1] };
  return { kind: "home" };
}

/** A section id that exists, a known tool, or Home ("#/"). */
export function isValidRouteWith(route: string, hasSection: (id: string) => boolean, tools: readonly string[]): boolean {
  if (route === "#/") return true;
  const r = parseRoute(route);
  if (r.kind === "section") return hasSection(r.id);
  if (r.kind === "tool") return tools.includes(r.id) && route === `#/play/${r.id}`;
  return false;
}

/**
 * Apply a browser hash change we did not cause: one step back or forward in the active tab's
 * history when the hash matches its neighbour entry, otherwise open it (current tab, or the tab
 * already showing it). A route failing `isValid` (a typed "#/play/mapwindow", a missing
 * section) opens Home instead. Returns false when the hash already matches the active tab.
 */
export function applyHash(model: TabModel, hash: string, isValid: (route: string) => boolean = () => true): boolean {
  let route = normalizeRoute(hash);
  if (!isValid(route)) route = "#/";
  const t = model.active;
  if (t) {
    if (model.current(t) === route) return false;
    if (t.history[t.index - 1] === route) return model.back();
    if (t.history[t.index + 1] === route) return model.forward();
  }
  model.open(route);
  return true;
}
