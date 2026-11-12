// Home: Continue cards (dungeon, realm, character in progress), the play tools, the books,
// bookmarks and recently viewed sections.
import { books, byId, lib } from "../library";
import { html, setHTML, type Raw } from "../ui/html";
import { firstLocked, getContent, type Locked } from "../content";
import { lockedLabel } from "../ui/locked";
import { hasSaved, load, PLAY_TOOLS } from "../tools/common";
import { characterLine, dungeonLine, dungeonSummary, realmLine, realmSummary, type DungeonLike } from "../shell/status";
import { eyebrow } from "../ui/components";
import { icon, type IconName } from "../ui/icon";
import { store } from "./store";
import { byGame, game, isVoid } from "../games";

/** A link card: icon, title and a muted line. */
const linkCard = (href: string, ic: IconName, title: string, line: string, extra: Raw | "" = ""): Raw =>
  html`<a class="card home-card" href="${href}"><span class="hc-icon">${icon(ic, { size: 20 })}</span><span class="hc-body"><strong class="hc-title">${title}</strong><span class="hc-line">${line}</span>${extra}</span></a>`;

/** The Continue cards for whatever is in progress (dungeon, realm, character). */
async function continueCards(): Promise<{ cards: Raw[]; dungeon: boolean }> {
  const sheet = await import("../tools/sheet");
  const ch = sheet.loadChar();
  const st = sheet.stats(ch);
  const out: Raw[] = [];
  const d = dungeonSummary(load<DungeonLike>("dungeon", { level: 1, rooms: [], current: null }), ch.rations);
  if (d) out.push(linkCard("#/play/dungeon", "key", "Dungeon", dungeonLine(d)));
  const r = realmSummary(hasSaved("realm") ? load("realm", { month: 1, round: 1, gc: 0 }) : null);
  if (r) out.push(linkCard("#/play/realm", "castle", "Realm", realmLine(r)));
  const c = characterLine(ch, st.level, st.baseline);
  if (c) out.push(linkCard("#/play/sheet", "scroll", "Character", c));
  return { cards: out, dungeon: !!d };
}

/** A bookmark or recent item: the section's title, or only its locked label while its book is locked. */
const listItem = (id: string): Raw => {
  const r = getContent(id);
  const href = `#/s/${encodeURIComponent(id)}`;
  if (r && !r.ok) return html`<li><a href="${href}">${lockedLabel(r.locked)}</a></li>`;
  const s = byId.get(id)!;
  return html`<li><a href="${href}">${s.title}</a><span class="muted">${books.get(s.book)?.title ?? s.book}</span></li>`;
};

/**
 * The Bookmarks and Recently viewed items. Ids the gateway doesn't know (an old id of a locked
 * section) are left in storage for the remap after unlocking, but not listed.
 */
export function homeLists(): { marks: Raw[]; recent: Raw[] } {
  const shown = (id: string) => getContent(id) !== undefined;
  return {
    marks: store.list("bookmarks").filter(shown).map(listItem),
    recent: store.list("recent").filter(shown).map(listItem),
  };
}

/** The placeholder for a locked section id. */
const lockedOf = (id: string): Locked | undefined => {
  const r = getContent(id);
  return r && !r.ok ? r.locked : undefined;
};

/** 2D6 Void's Continue cards: the hulk expedition and the survivor. */
async function voidContinueCards(): Promise<{ cards: Raw[]; dungeon: boolean }> {
  const { voidContinue } = await import("../tools/void/status");
  const list = voidContinue();
  return { cards: list.map((c) => linkCard(c.href, c.icon, c.title, c.line)), dungeon: list.some((c) => c.href === "#/play/vhulk") };
}

/** Hero copy and the start button, per game. */
const HERO = byGame({
  dungeon: { eyebrow: "2D6 Companion", fresh: "Into the dark", start: "Start a new dungeon", href: "#/play/dungeon", icon: "key" as IconName },
  void: { eyebrow: "2D6 Void", fresh: "Into the Dark Hulk", start: "Board the Dark Hulk", href: "#/play/vhulk", icon: "door-closed" as IconName },
});

export async function render(root: HTMLElement) {
  const { cards: cont, dungeon: dungeonOn } = await (isVoid() ? voidContinueCards() : continueCards());
  const { marks, recent } = homeLists();

  setHTML(root, html`<div class="home">
    <header class="home-hero">
      ${isVoid()
        ? // Void: the logo names the game, so the heading sits beside it with no eyebrow
          html`<div class="home-brand"><img class="home-logo" src="${game().logo}" alt="${game().logoAlt}">
          <div><h1 class="page-title">${cont.length ? "Welcome back" : HERO.fresh}</h1>
          <p class="home-lede">Your tables, tools and adventure in progress.</p></div></div>`
        : html`${eyebrow(HERO.eyebrow)}
      <h1 class="page-title">${cont.length ? "Welcome back" : HERO.fresh}</h1>
      <p class="home-lede">Your tables, tools and adventure in progress.</p>`}
      ${dungeonOn ? "" : html`<a class="btn btn-primary btn-lg" href="${HERO.href}">${icon(HERO.icon, { size: 20 })}<span>${HERO.start}</span></a>`}
    </header>
    ${cont.length ? html`<section class="home-sec"><h2 class="sub">Continue</h2><div class="cards">${cont}</div></section>` : ""}
    <section class="home-sec"><h2 class="sub">Play</h2><div class="cards">${PLAY_TOOLS.map((t) =>
      linkCard(`#/play/${t.id}`, t.icon, t.title, t.blurb))}</div></section>
    <section class="home-sec"><h2 class="sub">Library</h2><div class="cards">${lib.books
      .map((b) => {
        const secs = lib.sections.filter((s) => s.book === b.slug);
        const tables = secs.reduce((n, s) => n + s.blocks.filter((x) => x.type === "table").length, 0);
        const first = secs[0];
        const warn = b.missing_pages.length ? html`<span class="warn">${b.missing_pages.length} pages still being transcribed</span>` : "";
        const locked = firstLocked(b.slug);
        const lockedCardHtml = locked
          ? linkCard(`#/s/${encodeURIComponent(locked)}`, "key-round", lockedLabel(lockedOf(locked)!), "Unlock it with your own PDF")
          : "";
        return html`${first ? linkCard(`#/s/${encodeURIComponent(first.id)}`, "book", b.title,
          `${secs.filter((s) => s.level === 2).length} chapters · ${secs.length} sections · ${tables} tables`, warn) : ""}${lockedCardHtml}`;
      })}</div></section>
    ${marks.length || recent.length ? html`<div class="home-lists">
      ${marks.length ? html`<section class="card home-list"><h2 class="sub">${icon("star", { size: 16 })} Bookmarks</h2><ul class="kids">${marks}</ul></section>` : ""}
      ${recent.length ? html`<section class="card home-list"><h2 class="sub">${icon("file-text", { size: 16 })} Recently viewed</h2><ul class="kids">${recent}</ul></section>` : ""}
    </div>` : ""}
    <p class="muted tip">Tip: press <kbd>/</kbd> or <kbd>Ctrl</kbd>+<kbd>K</kbd> to search. Table codes like <code>${game().exampleCode}</code> work too.</p>
  </div>`);
}
