// Lets a floating card (the gameplay coach, the site tour) be dragged out of the way by its handle: any
// element inside it marked data-drag-handle. The card keeps its place in the layout and is shifted with a
// transform, so "put it back" is just a zero offset. The offset is remembered for the browser session (per
// `name`), so the coach stays where it was put when the tutorial reloads the page. Double-click the handle
// to put the card back.

export interface Offset { x: number; y: number }
/** Where an element sits with no offset applied, and the viewport it must stay inside. */
export interface DragBounds { left: number; top: number; width: number; height: number; viewW: number; viewH: number }

/**
 * The nearest offset to `o` that keeps the whole card inside the viewport, so its buttons never end up off
 * screen. A card wider or taller than the viewport is held at the left / top edge, where its handle is.
 */
export function clampOffset(o: Offset, b: DragBounds): Offset {
  const minX = -b.left;
  const maxX = Math.max(minX, b.viewW - b.width - b.left);
  const minY = -b.top;
  const maxY = Math.max(minY, b.viewH - b.height - b.top);
  const within = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { x: Math.round(within(o.x, minX, maxX)) || 0, y: Math.round(within(o.y, minY, maxY)) || 0 }; // || 0: never -0
}

const key = (name: string) => `2d6:drag:${name}`;
function readOffset(name: string): Offset {
  try {
    const v = JSON.parse(sessionStorage.getItem(key(name)) ?? "null") as Partial<Offset> | null;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x!, y: v.y! };
  } catch {
    /* no storage, or not ours: start where the layout puts it */
  }
  return { x: 0, y: 0 };
}
function saveOffset(name: string, o: Offset): void {
  try {
    if (o.x || o.y) sessionStorage.setItem(key(name), JSON.stringify(o));
    else sessionStorage.removeItem(key(name));
  } catch {
    /* not remembered, that's all */
  }
}

const INTERACTIVE = "button, a, input, select, textarea, label";

/** Make `el` draggable by its [data-drag-handle] parts. Returns a function that takes the behaviour off again. */
export function makeDraggable(el: HTMLElement, name: string): () => void {
  let off = readOffset(name); // where the card should be
  let shown: Offset = { x: 0, y: 0 }; // the offset the card's style holds now (none until first applied)
  let drag: { id: number; startX: number; startY: number; from: Offset } | null = null;

  const bounds = (): DragBounds => {
    const r = el.getBoundingClientRect();
    return { left: r.left - shown.x, top: r.top - shown.y, width: r.width, height: r.height, viewW: window.innerWidth, viewH: window.innerHeight };
  };
  const apply = (o: Offset) => {
    off = clampOffset(o, bounds());
    shown = off;
    el.style.transform = off.x || off.y ? `translate(${off.x}px, ${off.y}px)` : "";
  };

  const onDown = (e: PointerEvent) => {
    const t = e.target as Element | null;
    if (e.button !== 0 || !t?.closest("[data-drag-handle]") || t.closest(INTERACTIVE)) return;
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, from: off };
    el.setPointerCapture?.(e.pointerId);
    el.classList.add("is-dragging");
    e.preventDefault(); // no text selection while dragging
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    apply({ x: drag.from.x + e.clientX - drag.startX, y: drag.from.y + e.clientY - drag.startY });
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.releasePointerCapture?.(e.pointerId);
    el.classList.remove("is-dragging");
    saveOffset(name, off);
  };
  const onDouble = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (!t?.closest("[data-drag-handle]") || t.closest(INTERACTIVE)) return;
    apply({ x: 0, y: 0 });
    saveOffset(name, off);
  };
  // a smaller window, or a card that changed size: keep it reachable
  const onResize = () => apply(off);

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("dblclick", onDouble);
  window.addEventListener("resize", onResize);
  // the card is laid out by now when it is in the page; if not yet, the first frame is
  requestAnimationFrame(() => apply(off));

  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("dblclick", onDouble);
    window.removeEventListener("resize", onResize);
    el.style.transform = "";
    el.classList.remove("is-dragging");
  };
}
