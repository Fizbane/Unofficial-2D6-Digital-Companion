// The icon rail: Collapse contents, Library / Play / Achievements / Search on top; Theme at the bottom.
// Achievements shows only when the game has an Achievements page (#/play/achievements).
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

const trackName = (id: string) => trackLabel(id);

export interface RailOptions {
  layout: Layout;
  tree: Tree;
  openSearch(): void;
  openTab(route: string): void;
  /** Is this route a page the current game has? */
  hasRoute(route: string): boolean;
}

const ACH_ROUTE = "#/play/achievements";

const btn = (id: string, label: string, ic: IconName, pressed?: boolean) =>
  html`<button type="button" class="rail-btn" data-rail="${id}" aria-label="${label}" title="${label}"${
    pressed === undefined ? "" : html` aria-pressed="${String(pressed)}"`
  }>${icon(ic, { size: 20 })}</button>`;

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
  setHTML(rail, html`<div class="rail-group">${btn("collapse", "Collapse contents", "panel-left", !o.layout.shown("tree"))}${btn("library", "Library", "book", mode === "library")}${btn("play", "Play", "dice", mode === "play")}${o.hasRoute(ACH_ROUTE) ? btn("achievements", "Achievements", "trophy") : ""}${btn("search", "Search (/ or Ctrl+K)", "search")}</div><div class="rail-group rail-bottom"><div class="rail-music" role="group" aria-label="Music">${btn("music-prev", "Previous song", "skip-back")}${btn("music-pause", "Pause music", "pause")}${btn("music-next", "Next song", "skip-forward")}</div><div class="rail-pop-anchor">${btn("theme", "Theme", "palette")}<div class="theme-pop" role="dialog" aria-label="Theme" hidden></div></div></div>`);
  const $ = (id: string) => rail.querySelector<HTMLButtonElement>(`[data-rail="${id}"]`)!;
  const pop = rail.querySelector<HTMLElement>(".theme-pop")!;

  const sync = () => {
    $("library").setAttribute("aria-pressed", String(mode === "library"));
    $("play").setAttribute("aria-pressed", String(mode === "play"));
    const collapsed = !o.layout.shown("tree");
    $("collapse").setAttribute("aria-pressed", String(collapsed));
    const label = collapsed ? "Show contents" : "Collapse contents";
    $("collapse").setAttribute("aria-label", label);
    $("collapse").title = label;
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
    if (!(e.target as HTMLElement).closest?.(".rail-pop-anchor")) closePop();
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
      case "achievements":
        return o.openTab(ACH_ROUTE);
      case "search":
        return o.openSearch();
      case "theme":
        return pop.hidden ? openPop() : closePop();
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
