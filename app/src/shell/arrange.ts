// Lets players arrange the two boxes of a play page (the map and the steps): drag the divider between
// them to resize, use its swap button to move the map to the other side (or above/below when the page
// is narrow and stacked), double-click the divider to put it back. The choice is saved per page.
import { html, setHTML } from "../ui/html";
import { icon } from "../ui/icon";
import { readState, writeState } from "./state";

export interface PaneLayout { v: 1; frac: number; swapped: boolean }
export const MIN_FRAC = 0.2;
export const MAX_FRAC = 0.8;
export const DEFAULT_LAYOUT: PaneLayout = { v: 1, frac: 4 / 9, swapped: false };

const isLayout = (v: unknown): v is PaneLayout => {
  const o = v as Partial<PaneLayout> | null;
  return !!o && o.v === 1 && typeof o.frac === "number" && typeof o.swapped === "boolean";
};
export const clampFrac = (f: number) => Math.min(MAX_FRAC, Math.max(MIN_FRAC, Number.isFinite(f) ? f : DEFAULT_LAYOUT.frac));

/** The grid-template-columns for a layout: the map's share on its side, the divider, the steps. */
export function columnsFor(l: PaneLayout): string {
  const f = clampFrac(l.frac);
  const a = `minmax(0, ${f}fr)`;
  const b = `minmax(0, ${1 - f}fr)`;
  return l.swapped ? `${b} 10px ${a}` : `${a} 10px ${b}`;
}

/**
 * Make `grid` (holding `.dturn-map` and `.dturn-main`) arrangeable. `key` is the localStorage key
 * the arrangement is saved under.
 */
export function makeArrangeable(grid: HTMLElement, key: string): void {
  const map = grid.querySelector<HTMLElement>(".dturn-map");
  const main = grid.querySelector<HTMLElement>(".dturn-main");
  if (!map || !main) return;
  let l = readState(key, isLayout, () => ({ ...DEFAULT_LAYOUT }));
  l = { ...l, frac: clampFrac(l.frac) };

  const handle = document.createElement("div");
  handle.className = "dturn-divider";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize the map and steps");
  handle.tabIndex = 0;
  handle.title = "Drag to resize. Double-click to reset.";
  setHTML(handle, html`<button type="button" class="dturn-swap" title="Swap sides" aria-label="Swap the map and steps">${icon("arrow-left-right", { size: 14 })}</button>`);
  map.after(handle);
  grid.classList.add("is-arrangeable");

  const paint = () => {
    grid.style.setProperty("--pane-cols", columnsFor(l));
    grid.classList.toggle("is-swapped", l.swapped);
    handle.setAttribute("aria-valuenow", String(Math.round(l.frac * 100)));
    handle.setAttribute("aria-valuemin", String(MIN_FRAC * 100));
    handle.setAttribute("aria-valuemax", String(MAX_FRAC * 100));
  };
  const commit = () => {
    paint();
    writeState(key, l);
  };
  paint();

  handle.querySelector<HTMLButtonElement>(".dturn-swap")!.addEventListener("click", (e) => {
    e.stopPropagation();
    l = { ...l, swapped: !l.swapped };
    commit();
  });
  handle.addEventListener("dblclick", () => {
    l = { ...DEFAULT_LAYOUT };
    commit();
  });

  handle.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".dturn-swap")) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("is-dragging");
    const move = (ev: PointerEvent) => {
      const r = grid.getBoundingClientRect();
      if (r.width <= 0) return;
      const x = (ev.clientX - r.left) / r.width; // pointer position across the grid
      l = { ...l, frac: clampFrac(l.swapped ? 1 - x : x) };
      paint();
    };
    const up = () => {
      handle.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      writeState(key, l);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    let d = 0;
    if (e.key === "ArrowLeft") d = -step;
    else if (e.key === "ArrowRight") d = step;
    else if (e.key === "Home") l = { ...l, frac: MIN_FRAC };
    else if (e.key === "End") l = { ...l, frac: MAX_FRAC };
    else return;
    e.preventDefault();
    if (d) l = { ...l, frac: clampFrac(l.frac + (l.swapped ? -d : d)) };
    commit();
  });
}
