// Pure navigation data for the tree and the page header: tree nodes, filtering, reveal paths,
// breadcrumbs. No DOM, no storage.
import type { Book, Section } from "../types";
import type { IconName } from "../ui/icon";
import { parseRoute } from "./routes";
import { routeKey } from "./tabmodel";

export interface TreeNode {
  /** Stable key: book slug, chapter id (both kept in "2d6:open"), "bookmarks", "play:<id>", "bm:<id>", section id. */
  key: string;
  label: string;
  href?: string;
  icon?: IconName;
  children?: TreeNode[];
}

export interface NavData {
  books: Book[];
  sections: Section[];
  byId: Map<string, Section>;
}

export interface NavTool { id: string; title: string; icon: IconName }

export const BOOKMARKS = "bookmarks";
export const sectionHref = (id: string) => `#/s/${encodeURIComponent(id)}`;

/**
 * The Bookmarks group: the saved section ids that still exist, in saved order. `lockedLabel` names
 * a bookmark whose section is locked (by its place, not its title); other ids are left out.
 */
export function bookmarksGroup(ids: readonly string[], byId: Map<string, Section>, lockedLabel: (id: string) => string | undefined = () => undefined): TreeNode {
  const children: TreeNode[] = [];
  for (const id of ids) {
    const label = byId.get(id)?.title ?? lockedLabel(id);
    if (label !== undefined) children.push({ key: `bm:${id}`, label, href: sectionHref(id) });
  }
  return { key: BOOKMARKS, label: "Bookmarks", icon: "star", children };
}

/** Books → chapters (level 2) → their sections. Sections with no chapter sit directly under the book. */
export function libraryTree(data: NavData): TreeNode[] {
  return data.books.map((b) => {
    const secs = data.sections.filter((s) => s.book === b.slug);
    const children: TreeNode[] = [];
    for (const s of secs) {
      if (s.level === 2) {
        const kids = secs.filter((k) => k.chapter === s.id).map((k) => ({ key: k.id, label: k.title, href: sectionHref(k.id) }));
        children.push({ key: s.id, label: s.title, href: sectionHref(s.id), ...(kids.length ? { children: kids } : {}) });
      } else if (!s.chapter || !data.byId.has(s.chapter)) children.push({ key: s.id, label: s.title, href: sectionHref(s.id) });
    }
    return { key: b.slug, label: b.title, icon: "book" as IconName, children };
  });
}

/** Tools with their own button on the rail: the Play list leaves them out (the "+" picker still has them). */
const ON_RAIL = new Set(["characters", "bestiary", "items", "tables", "achievements", "statistics"]);

/** The play tools (not those on the rail), then Settings. */
export function playTree(tools: readonly NavTool[]): TreeNode[] {
  return [
    ...tools.filter((t) => !ON_RAIL.has(t.id)).map((t) => ({ key: `play:${t.id}`, label: t.title, href: `#/play/${t.id}`, icon: t.icon })),
    { key: "play:settings", label: "Settings", href: "#/play/settings", icon: "settings" as IconName },
  ];
}

/** One row of the tab bar's "+" picker: a route to open in a new tab, or the search action. */
export interface NewTabItem { id: string; label: string; icon: IconName; route?: string; action?: "search" }

/** The "+" picker: Home, the play tools, Settings, then "Search the books…". */
export function newTabItems(tools: readonly NavTool[]): NewTabItem[] {
  return [
    { id: "home", label: "Home", icon: "book", route: "#/" },
    ...tools.map((t) => ({ id: t.id, label: t.title, icon: t.icon, route: `#/play/${t.id}` })),
    { id: "settings", label: "Settings", icon: "settings", route: "#/play/settings" },
    { id: "search", label: "Search the books…", icon: "search", action: "search" },
  ];
}

/** Number of links below a group (its sections, bookmarks…), not counting the group itself. */
export function countLinks(n: TreeNode): number {
  return (n.children ?? []).reduce((sum, c) => sum + (c.href ? 1 : 0) + countLinks(c), 0);
}

/**
 * Case-insensitive substring filter on labels. A node is kept when its label matches or a
 * descendant does; groups kept for a matching descendant show only the matching branch and are
 * listed in `open` so they render expanded. A matching group with no matching descendants keeps
 * all its children (collapsed). An empty query returns the tree unchanged.
 */
export function filterTree(nodes: readonly TreeNode[], query: string): { nodes: TreeNode[]; open: Set<string> } {
  const q = query.trim().toLowerCase();
  const open = new Set<string>();
  if (!q) return { nodes: [...nodes], open };
  const walk = (list: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of list) {
      const kids = n.children ? walk(n.children) : [];
      if (kids.length) {
        open.add(n.key);
        out.push({ ...n, children: kids });
      } else if (n.label.toLowerCase().includes(q)) out.push(n);
    }
    return out;
  };
  return { nodes: walk(nodes), open };
}

/** Does tree link `href` point at `route` (ignoring "?find=")? */
export const isRouteHref = (href: string | undefined, route: string | null): boolean => !!href && !!route && routeKey(route) === routeKey(href);

/**
 * Keys of the groups to open so the link for `route` shows. Prefers a match outside the
 * Bookmarks group; null when the route is not in the tree.
 */
export function revealPath(nodes: readonly TreeNode[], route: string): string[] | null {
  let fallback: string[] | null = null;
  const walk = (list: readonly TreeNode[], path: string[]): string[] | null => {
    for (const n of list) {
      if (isRouteHref(n.href, route)) {
        if (!path.includes(BOOKMARKS)) return path;
        fallback ??= path;
      }
      if (n.children) {
        const hit = walk(n.children, [...path, n.key]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(nodes, []) ?? fallback;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const treeFooter = (books: number, sections: number) => `${plural(books, "book")} · ${plural(sections, "section")}`;

export interface Crumb { label: string; href?: string }

/** Book › Chapter › Section; Play › Tool; Home. The last crumb is the page itself (no link). */
export function crumbsFor(route: string, data: NavData, tools: readonly NavTool[]): Crumb[] {
  const r = parseRoute(route);
  if (r.kind === "section") {
    const s = data.byId.get(r.id);
    if (!s) return [{ label: "Missing section" }];
    const book = data.books.find((b) => b.slug === s.book);
    const first = data.sections.find((x) => x.book === s.book);
    const out: Crumb[] = [];
    if (book) out.push({ label: book.title, ...(first && first.id !== s.id ? { href: sectionHref(first.id) } : {}) });
    const ch = s.chapter ? data.byId.get(s.chapter) : undefined;
    if (ch) out.push({ label: ch.title, href: sectionHref(ch.id) });
    out.push({ label: s.title });
    return out;
  }
  if (r.kind === "tool") {
    const title = tools.find((t) => t.id === r.id)?.title ?? (r.id === "settings" ? "Settings" : r.id);
    return [{ label: "Play" }, { label: title }];
  }
  return [{ label: "Home" }];
}
