// The Map page (#/play/map): Dungeon | Realm, drawn large in the centre. The dungeon view is the
// shared live map (mapview.ts: exits, rooms, notes, stairs, Save image, New window); the realm view
// shows the plots, and tapping one shows its details.
import type { ToolContext } from "../main";
import { mountDungeonMap } from "./mapview";
import { load } from "./common";
import { plotCardHtml, plotsForMap, type Bldg, type Land } from "./realm";
import { mapLegendHtml, renderRealmMap } from "./rmap";
import { button, eyebrow, tabsBar } from "../ui/components";
import { icon } from "../ui/icon";
import { bus } from "../shell/events";
import { html, type Raw, setHTML } from "../ui/html";

type View = "dungeon" | "realm";
const REALM_KEY = "2d6:play:realm";

let view: View = "dungeon"; // kept while the app is open, so a reopened Map tab shows the same view

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "map-page");
  setHTML(root, html`
    <header class="play-head">
      <div class="play-title">${eyebrow("Play")}<h1>${icon("map", { size: 26 })}<span>Map</span></h1></div>
      <div class="play-actions">${tabsBar([{ id: "dungeon", label: "Dungeon", icon: "key" }, { id: "realm", label: "Realm", icon: "castle" }], view, html`aria-label="Map view"`)}</div>
    </header>
    <section class="card map-card"><div class="map-body"></div></section>`);
  const bar = root.querySelector<HTMLElement>(".tabs-bar")!;
  bar.classList.add("map-views");
  const body = root.querySelector<HTMLElement>(".map-body")!;

  // each view gets its own host so switching doesn't drop the dungeon view's listeners
  const dungeonHost = document.createElement("div");
  const realmHost = document.createElement("div");
  realmHost.className = "realm-view";
  body.append(dungeonHost, realmHost);
  mountDungeonMap(dungeonHost, { source: "map-page", openTab: ctx.openTab, toast: ctx.toast, onDispose: ctx.onDispose });

  let focus: number | null = null; // plot tapped on the realm map
  function realmHtml(): Raw {
    const s = load<{ lands: Land[]; buildings: Bldg[] }>("realm", { lands: [], buildings: [] });
    const lands = s.lands ?? [];
    const buildings = s.buildings ?? [];
    const plots = plotsForMap(lands, buildings);
    if (!plots.length)
      return html`<div class="map-empty"><p class="muted">No plots on the map yet — explore them in Realm.</p>
        ${button("Open Realm", { icon: "castle", variant: "ghost", size: "sm", attrs: html`data-realm-act="open"` })}</div>`;
    const l = lands.find((x) => x.id === focus && x.cells?.length);
    const kinds = [...new Set(plots.map((p) => p.code))];
    const plotCard = l
      ? plotCardHtml(
          l,
          buildings,
          button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-realm-act="close" aria-label="Close plot details"` }),
          html`<div class="step-actions">${button("Open in Realm", { icon: "castle", variant: "ghost", size: "sm", attrs: html`data-realm-act="open"` })}</div>`,
        )
      : html`<p class="muted map-hint dmv-tip">Tap a plot for its details.</p>`;
    return html`<div class="dmv-grid">
      <div class="dmv-map">
        <div class="map-head"><h2>Realm map</h2>
          <span class="muted map-count">${plots.length} plot${plots.length === 1 ? "" : "s"} · gold border = yours, hatched with a cross = unclaimed</span></div>
        <div class="map-wrap">${renderRealmMap({ plots, focus })}</div>
      </div>
      <div class="dmv-side">
        ${plotCard}
        ${mapLegendHtml(kinds)}
      </div>
    </div>`;
  }
  const drawRealm = () => {
    if (view === "realm") setHTML(realmHost, realmHtml());
  };

  function show(v: View) {
    view = v;
    for (const b of bar.querySelectorAll<HTMLElement>("[data-tab]")) {
      const on = b.dataset.tab === v;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    dungeonHost.hidden = v !== "dungeon";
    realmHost.hidden = v !== "realm";
    drawRealm();
  }

  bar.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab as View | undefined;
    if (id) show(id);
  });
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    show(view === "dungeon" ? "realm" : "dungeon");
    bar.querySelector<HTMLElement>(".is-active")?.focus();
  });
  realmHost.addEventListener("click", (e) => {
    const t = e.target as Element;
    const act = t.closest<HTMLElement>("[data-realm-act]")?.dataset.realmAct;
    if (act === "open") return ctx.openTab("#/play/realm", { newTab: true });
    if (act === "close") focus = null;
    else {
      const plot = t.closest?.("[data-plot]");
      if (!plot) return;
      const id = +plot.getAttribute("data-plot")!;
      focus = focus === id ? null : id;
    }
    drawRealm();
  });
  ctx.onDispose(bus.on("realm:changed", drawRealm));
  const onStorage = (e: StorageEvent) => {
    if (e.key === REALM_KEY) drawRealm();
  };
  window.addEventListener("storage", onStorage);
  ctx.onDispose(() => window.removeEventListener("storage", onStorage));
  show(view);
}

