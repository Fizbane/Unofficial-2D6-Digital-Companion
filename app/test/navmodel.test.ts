import { describe, it, expect } from "vitest";
import type { Book, Section } from "../src/types";
import { PLAY_TOOLS } from "../src/tools/common";
import {
  bookmarksGroup, countLinks, crumbsFor, filterTree, isRouteHref, libraryTree, newTabItems, playTree, revealPath, treeFooter,
  type NavData,
} from "../src/shell/navmodel";

const book = (slug: string, title: string): Book => ({ slug, title, missing_pages: [], page_images: [] });
const sec = (id: string, bookSlug: string, title: string, level: number, chapter: string | null = null): Section => ({
  id, book: bookSlug, title, level, chapter, pages: [1], blocks: [],
});

const sections = [
  sec("core/intro", "core", "Introduction", 2),
  sec("core/loose", "core", "Loose page", 3),
  sec("core/rooms", "core", "Dungeon Rooms", 2),
  sec("core/rooms-size", "core", "Room size", 3, "core/rooms"),
  sec("core/rooms-exits", "core", "Exits and doors", 3, "core/rooms"),
  sec("codex/enat1", "codex", "ENAT1 - Encounters", 2),
];
const data: NavData = {
  books: [book("core", "Core Rules"), book("codex", "Tables Codex")],
  sections,
  byId: new Map(sections.map((s) => [s.id, s])),
};
const tools = [{ id: "combat", title: "Combat", icon: "swords" as const }];

describe("libraryTree", () => {
  it("nests books → chapters → sections and keeps chapterless sections under the book", () => {
    const t = libraryTree(data);
    expect(t.map((b) => b.key)).toEqual(["core", "codex"]);
    expect(t[0].children!.map((c) => c.key)).toEqual(["core/intro", "core/loose", "core/rooms"]);
    expect(t[0].children![0].children).toBeUndefined(); // chapter with no sections is a plain link
    expect(t[0].children![2].children!.map((c) => c.label)).toEqual(["Room size", "Exits and doors"]);
    expect(t[0].children![2].href).toBe("#/s/core%2Frooms");
  });
  it("counts links below a group", () => {
    const t = libraryTree(data);
    expect(countLinks(t[0])).toBe(5);
    expect(countLinks(t[0].children![2])).toBe(2);
  });
});

describe("bookmarksGroup and playTree", () => {
  it("lists existing bookmarks in saved order and drops missing ones", () => {
    const g = bookmarksGroup(["codex/enat1", "gone", "core/intro"], data.byId);
    expect(g.children!.map((c) => c.label)).toEqual(["ENAT1 - Encounters", "Introduction"]);
    expect(countLinks(g)).toBe(2);
  });
  it("lists the tools then Settings", () => {
    expect(playTree(tools).map((n) => n.href)).toEqual(["#/play/combat", "#/play/settings"]);
  });
});

describe("filterTree", () => {
  const t = libraryTree(data);
  it("returns everything for an empty query", () => {
    const r = filterTree(t, "  ");
    expect(r.nodes).toEqual(t);
    expect(r.open.size).toBe(0);
  });
  it("keeps matches case-insensitively with their parents, opened", () => {
    const r = filterTree(t, "EXIT");
    expect(r.nodes.map((n) => n.key)).toEqual(["core"]);
    expect(r.nodes[0].children!.map((n) => n.key)).toEqual(["core/rooms"]);
    expect(r.nodes[0].children![0].children!.map((n) => n.label)).toEqual(["Exits and doors"]);
    expect([...r.open]).toEqual(["core/rooms", "core"]);
  });
  it("keeps a matching group whole (unopened) when none of its children match", () => {
    const r = filterTree(t, "dungeon rooms");
    const rooms = r.nodes[0].children![0];
    expect(rooms.children!.length).toBe(2);
    expect(r.open.has("core/rooms")).toBe(false);
    expect(r.open.has("core")).toBe(true);
  });
  it("returns nothing when nothing matches", () => {
    expect(filterTree(t, "zzz").nodes).toEqual([]);
  });
});

describe("revealPath", () => {
  const t = [bookmarksGroup(["core/rooms-size"], data.byId), ...libraryTree(data)];
  it("opens the book and chapter, preferring the library over Bookmarks", () => {
    expect(revealPath(t, "#/s/core%2Frooms-size")).toEqual(["core", "core/rooms"]);
  });
  it("ignores ?find= and falls back to Bookmarks, or null", () => {
    expect(revealPath(t, "#/s/core%2Frooms-size?find=x")).toEqual(["core", "core/rooms"]);
    expect(revealPath([t[0]], "#/s/core%2Frooms-size")).toEqual(["bookmarks"]);
    expect(revealPath(t, "#/play/combat")).toBeNull();
  });
  it("isRouteHref compares route keys", () => {
    expect(isRouteHref("#/play/combat", "#/play/combat")).toBe(true);
    expect(isRouteHref("#/s/a", "#/s/a?find=b")).toBe(true);
    expect(isRouteHref(undefined, "#/")).toBe(false);
  });
});

describe("crumbsFor", () => {
  it("builds Book › Chapter › Section", () => {
    expect(crumbsFor("#/s/core%2Frooms-size", data, tools)).toEqual([
      { label: "Core Rules", href: "#/s/core%2Fintro" },
      { label: "Dungeon Rooms", href: "#/s/core%2Frooms" },
      { label: "Room size" },
    ]);
  });
  it("leaves out the chapter for a chapter page and the book link on the book's first page", () => {
    expect(crumbsFor("#/s/core%2Frooms", data, tools)).toEqual([{ label: "Core Rules", href: "#/s/core%2Fintro" }, { label: "Dungeon Rooms" }]);
    expect(crumbsFor("#/s/core%2Fintro", data, tools)).toEqual([{ label: "Core Rules" }, { label: "Introduction" }]);
  });
  it("handles tools, Settings, Home and missing sections", () => {
    expect(crumbsFor("#/play/combat", data, tools)).toEqual([{ label: "Play" }, { label: "Combat" }]);
    expect(crumbsFor("#/play/settings", data, tools)).toEqual([{ label: "Play" }, { label: "Settings" }]);
    expect(crumbsFor("#/", data, tools)).toEqual([{ label: "Home" }]);
    expect(crumbsFor("#/s/nope", data, tools)).toEqual([{ label: "Missing section" }]);
  });
});

describe("treeFooter", () => {
  it("pluralises", () => {
    expect(treeFooter(3, 996)).toBe("3 books · 996 sections");
    expect(treeFooter(1, 1)).toBe("1 book · 1 section");
  });
});

describe("Map is a play tool", () => {
  it("is in PLAY_TOOLS (after Realm) and so in the Play tree", () => {
    expect(PLAY_TOOLS.map((t) => t.id)).toEqual(["dungeon", "combat", "sheet", "realm", "map", "achievements"]);
    expect(PLAY_TOOLS.find((t) => t.id === "map")).toMatchObject({ title: "Map", icon: "map" });
    expect(playTree(PLAY_TOOLS).map((n) => n.href)).toContain("#/play/map");
  });
});

describe("newTabItems (the tab bar's + picker)", () => {
  it("lists Home, the play tools, Settings, then Search the books", () => {
    const items = newTabItems(PLAY_TOOLS);
    expect(items.map((i) => i.label)).toEqual(["Home", "Dungeon turn", "Combat", "Character sheet", "Realm", "Map", "Achievements", "Settings", "Search the books…"]);
    expect(items.map((i) => i.route ?? i.action)).toEqual([
      "#/", "#/play/dungeon", "#/play/combat", "#/play/sheet", "#/play/realm", "#/play/map", "#/play/achievements", "#/play/settings", "search",
    ]);
    expect(items.map((i) => i.icon)).toEqual(["book", "key", "swords", "scroll", "castle", "map", "trophy", "settings", "search"]);
  });
  it("follows the tool list it is given", () => {
    expect(newTabItems(tools).map((i) => i.id)).toEqual(["home", "combat", "settings", "search"]);
  });
});
