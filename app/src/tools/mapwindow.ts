// The dungeon map on its own, for a separate browser window (second screen / side by side).
// Stays live: re-draws whenever the main window saves the dungeon, and tapping an exit
// here chooses it in the main window too (both share this device's saved state).
import type { ToolContext } from "../main";
import { legendHtml, mapHint, newMap, openExits, renderMap, type DungeonMap } from "./dmap";
import { load, save } from "./common";
import { html, setHTML } from "../ui/html";

interface Saved { level: number; current: { mapRoom?: number } | null; map?: DungeonMap }
const KEY = "2d6:play:dungeon";

export function render(root: HTMLElement, _ctx: ToolContext) {
  document.body.classList.add("map-only");
  const draw = () => {
    const st = load<Saved>("dungeon", { level: 1, current: null });
    const m = st.map ?? newMap(st.level);
    const open = openExits(m).length;
    document.title = `Level ${st.level} map · 2D6 Companion`;
    setHTML(root, html`
      <div class="mapwin">
        <div class="map-head"><h2>Level ${st.level} map</h2>
          <span class="muted" style="font-size:0.85rem">${m.rooms.length ? `${m.rooms.length} rooms · ${open} unexplored exit${open === 1 ? "" : "s"}` : "No rooms yet: roll the entrance room in the main window."}</span></div>
        ${m.rooms.length ? html`<div class="map-wrap">${renderMap(m, st.current?.mapRoom ?? null)}</div>
        <p class="muted mapwin-hint">${mapHint(m, !!st.current)}</p>${legendHtml()}` : ""}
      </div>`);
  };
  root.addEventListener("click", (e) => {
    const ex = (e.target as Element).closest?.("[data-exit]");
    if (!ex) return;
    const st = load<Saved>("dungeon", { level: 1, current: null });
    if (!st.map) return;
    const id = +ex.getAttribute("data-exit")!;
    st.map.sel = st.map.sel === id ? null : id;
    save("dungeon", st);
    draw();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) draw();
  });
  draw();
}
