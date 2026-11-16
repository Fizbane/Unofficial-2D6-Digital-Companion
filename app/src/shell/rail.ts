// The icon rail: Hide (collapse contents), Home, Play, Characters, Library, Bestiary, Items, Tables, Achievements, Statistics, Search on top; music and Theme at the bottom.
// Characters opens a picker of the current game's characters (charpick.ts) to switch between them.
// Achievements and Statistics show only when the game has that page (#/play/achievements, #/play/statistics).
// The mode (Library or Play) picks what the tree shows and is saved as "rail" in the layout state.
import { railMode, type Layout, type RailMode } from "./layout";
import type { Tree } from "./tree";
import { AUTO_PAIR, THEMES } from "../themes";
import { applyDisplay } from "../settings";
import { icon, type IconName } from "../ui/icon";
import { store } from "../pages/store";
import { html, setHTML, type Raw } from "../ui/html";
import { playlist } from "../audio/playlist";
import { trackLabel } from "../audio/playlist";
import { musicState, onMusicChange, skipMusic, toggleMusicPause } from "../audio/sound";
import { isVoid, switchCharacter } from "../games";
import { listCharacters } from "../roster";
import { charPickHtml, pickWords } from "./charpick";

const trackName = (id: string) => trackLabel(id);

export interface RailOptions {
  layout: Layout;
  tree: Tree;
  openSearch(): void;
  openTab(route: string): void;
  /** Is this route a page the current game has? */
  hasRoute(route: string): boolean;
  /** Start a new character in the current game (it switches to them); false if storage is full. */
  newCharacter(): Promise<boolean>;
  toast(msg: string): void;
  /** A Dungeon character's level from their XP (the sheet's table); Void stores its own. */
  levelOf(xp: number, cls?: "constable"): Promise<number>;
}

const CHARS_ROUTE = "#/play/characters";

const ACH_ROUTE = "#/play/achievements";
const STATS_ROUTE = "#/play/statistics";
const BEAST_ROUTE = "#/play/bestiary";
const ITEMS_ROUTE = "#/play/items";
const TABLES_ROUTE = "#/play/tables";

/** A rail button. `short` is the word printed under the icon (none for the music controls); each button's
 *  colour comes from its data-rail id (shell.css). */
const btn = (id: string, label: string, ic: IconName, pressed?: boolean, short?: string) =>
  html`<button type="button" class="rail-btn${short ? " has-label" : ""}" data-rail="${id}" aria-label="${label}" title="${label}"${
    pressed === undefined ? "" : html` aria-pressed="${String(pressed)}"`
  }>${icon(ic, { size: 20 })}${short ? html`<span class="rail-label" aria-hidden="true">${short}</span>` : ""}</button>`;

function themeGrid(current: string): Raw {
  const pick = (id: string, name: string, bg: string, accent: string, ink: string) =>
    html`<button type="button" class="theme-swatch" data-theme="${id}" aria-pressed="${String(current === id)}" title="${name}"><span class="sw" style="background:${bg};color:${ink}"><i style="background:${accent}"></i></span><span class="sw-name">${name}</span></button>`;
  // "Match device" swatch: the current game's light and dark palettes (Void has no "light"/"dark" ids)
  const light = THEMES.find((t) => t.id === AUTO_PAIR[0])!.t, dark = THEMES.find((t) => t.id === AUTO_PAIR[1])!.t;
  return (
    html`<div class="theme-grid"><button type="button" class="theme-swatch" data-theme="auto" aria-pressed="${String(current === "auto")}" title="Match device"><span class="sw sw-split" style="background:linear-gradient(135deg, ${light.bg} 50%, ${dark.bg} 50%)"><i style="background:${light.accent}"></i></span><span class="sw-name">Match device</span></button>${THEMES.map((t) => pick(t.id, t.name, t.t.bg, t.t.accent, t.t.ink))}</div>`
  );
}

export function initRail(rail: HTMLElement, o: RailOptions): void {
  let mode: RailMode = railMode(o.layout.state);
  setHTML(rail, html`<div class="rail-group">${btn("collapse", "Collapse contents", "panel-left", !o.layout.shown("tree"), "Hide")}${btn("home", "Home", "house", undefined, "Home")}${btn("play", "Play", "dice", mode === "play", "Play")}${o.hasRoute(CHARS_ROUTE) ? html`<div class="rail-pop-anchor rail-chars">${btn("chars", isVoid() ? "Survivors" : "Characters", "user", undefined, isVoid() ? "Crew" : "Heroes")}<div class="char-pop" role="dialog" aria-label="${isVoid() ? "Survivors" : "Characters"}" hidden></div></div>` : ""}${btn("library", "Library", "book", mode === "library", "Library")}${o.hasRoute(BEAST_ROUTE) ? btn("bestiary", "Bestiary", "skull", undefined, "Bestiary") : ""}${o.hasRoute(ITEMS_ROUTE) ? btn("items", "Items", "backpack", undefined, "Items") : ""}${o.hasRoute(TABLES_ROUTE) ? btn("tables", "Tables", "table", undefined, "Tables") : ""}${o.hasRoute(ACH_ROUTE) ? btn("achievements", "Achievements", "trophy", undefined, "Achievements") : ""}${o.hasRoute(STATS_ROUTE) ? btn("statistics", "Statistics", "chart-column", undefined, "Stats") : ""}${btn("search", "Search (/ or Ctrl+K)", "search", undefined, "Search")}</div><div class="rail-group rail-bottom"><div class="rail-music" role="group" aria-label="Music">${btn("music-prev", "Previous song", "skip-back")}${btn("music-pause", "Pause music", "pause")}${btn("music-next", "Next song", "skip-forward")}</div><div class="rail-pop-anchor">${btn("theme", "Theme", "palette", undefined, "Theme")}<div class="theme-pop" role="dialog" aria-label="Theme" hidden></div></div></div>`);
  const $ = (id: string) => rail.querySelector<HTMLButtonElement>(`[data-rail="${id}"]`)!;
  const pop = rail.querySelector<HTMLElement>(".theme-pop")!;
  const charPop = rail.querySelector<HTMLElement>(".char-pop");

  const sync = () => {
    $("library").setAttribute("aria-pressed", String(mode === "library"));
    $("play").setAttribute("aria-pressed", String(mode === "play"));
    const collapsed = !o.layout.shown("tree");
    $("collapse").setAttribute("aria-pressed", String(collapsed));
    const label = collapsed ? "Show contents" : "Collapse contents";
    $("collapse").setAttribute("aria-label", label);
    $("collapse").title = label;
    const short = $("collapse").querySelector(".rail-label");
    if (short) short.textContent = collapsed ? "Show" : "Hide";
  };

  function setMode(m: RailMode) {
    if (m === mode) {
      o.layout.toggle("tree"); // the active mode again collapses (or reopens) the tree
    } else {
      mode = m;
      o.layout.set({ rail: m });
      o.tree.setMode(m);
      if (!o.layout.shown("tree")) o.layout.toggle("tree", false);
    }
    sync();
  }
  const syncMusicBtns = () => {
    const m = musicState();
    const name = m.track ? trackName(m.track) : "";
    const pb = $("music-pause");
    const label = m.paused ? `Play music${name ? ` (${name})` : ""}` : `Pause music${name ? ` (${name})` : ""}`;
    setHTML(pb, icon(m.paused ? "play" : "pause", { size: 20 }));
    pb.setAttribute("aria-label", label);
    pb.title = m.enabled ? label : "Music is off in Settings";
    for (const id of ["music-prev", "music-pause", "music-next"]) $(id).disabled = !m.enabled;
  };
  onMusicChange(syncMusicBtns);
  syncMusicBtns();

  o.layout.onChange(sync); // the tree is also shown or hidden from the top bar, scrim, Esc and breakpoints

  const onOutside = (e: Event) => {
    if (!(e.target as HTMLElement).closest?.(".rail-pop-anchor:not(.rail-chars)")) closePop();
  };
  function openPop() {
    setHTML(pop, themeGrid(store.get<string>("theme", "auto")));
    pop.hidden = false;
    $("theme").setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    pop.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }
  function closePop(focus = false) {
    if (pop.hidden) return;
    pop.hidden = true;
    $("theme").setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (focus) $("theme").focus();
  }
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePop(true);
    }
  });
  // ---- character picker
  const onOutsideChars = (e: Event) => {
    if (!(e.target as HTMLElement).closest?.(".rail-chars")) closeChars();
  };
  async function openChars() {
    if (!charPop) return;
    closePop();
    const list = listCharacters();
    const levels = new Map<string, number | null>();
    for (const c of list) levels.set(c.id, c.level ?? (isVoid() ? null : await o.levelOf(c.xp, c.cls)));
    setHTML(charPop, charPickHtml(list, pickWords(isVoid()), (c) => levels.get(c.id) ?? null));
    charPop.hidden = false;
    $("chars").setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutsideChars, true);
    (charPop.querySelector<HTMLElement>('[aria-current="true"]') ?? charPop.querySelector<HTMLElement>("button"))?.focus();
  }
  function closeChars(focus = false) {
    if (!charPop || charPop.hidden) return;
    charPop.hidden = true;
    $("chars").setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutsideChars, true);
    if (focus) $("chars").focus();
  }
  if (charPop) {
    $("chars").setAttribute("aria-haspopup", "dialog");
    $("chars").setAttribute("aria-expanded", "false");
    charPop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeChars(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...charPop.querySelectorAll<HTMLElement>("button")];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        e.preventDefault();
      }
    });
    charPop.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>("[data-pick]");
      if (row) {
        if (row.getAttribute("aria-current") === "true") {
          // the character you're playing: bring up their sheet (its open tab if there is one)
          closeChars();
          return o.openTab(isVoid() ? "#/play/vsheet" : "#/play/sheet");
        }
        return switchCharacter(row.dataset.pick!); // reloads into that character's own tabs
      }
      const act = t.closest<HTMLElement>("[data-pick-act]")?.dataset.pickAct;
      if (act === "all") {
        closeChars();
        o.openTab(CHARS_ROUTE);
      } else if (act === "new") {
        closeChars();
        if (!(await o.newCharacter())) o.toast(`Couldn't make a new ${pickWords(isVoid()).one}: this device's storage is full.`);
      }
    });
  }

  $("theme").setAttribute("aria-haspopup", "dialog");
  $("theme").setAttribute("aria-expanded", "false");

  rail.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const sw = t.closest<HTMLButtonElement>(".theme-swatch");
    if (sw) {
      store.set("theme", sw.dataset.theme); // same key and shape the Settings page writes
      applyDisplay();
      pop.querySelectorAll(".theme-swatch").forEach((x) => x.setAttribute("aria-pressed", String(x === sw)));
      // keep an open Settings tab's theme cards in step
      document.querySelectorAll<HTMLElement>(".theme-pick").forEach((x) => {
        const on = x.dataset.themePick === sw.dataset.theme;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", String(on));
      });
      return;
    }
    const b = t.closest<HTMLButtonElement>("[data-rail]");
    if (!b) return;
    switch (b.dataset.rail) {
      case "library":
      case "play":
        return setMode(b.dataset.rail);
      case "home":
        return o.openTab("#/");
      case "bestiary":
        return o.openTab(BEAST_ROUTE);
      case "items":
        return o.openTab(ITEMS_ROUTE);
      case "tables":
        return o.openTab(TABLES_ROUTE);
      case "achievements":
        return o.openTab(ACH_ROUTE);
      case "statistics":
        return o.openTab(STATS_ROUTE);
      case "search":
        return o.openSearch();
      case "theme":
        closeChars();
        return pop.hidden ? openPop() : closePop();
      case "chars":
        return charPop?.hidden ? void openChars() : closeChars();
      case "music-prev":
        return skipMusic(-1);
      case "music-next":
        return skipMusic(1);
      case "music-pause":
        return toggleMusicPause();
      case "collapse":
        return o.layout.toggle("tree"); // sync runs through onChange
    }
  });
}
