// The floating dice button: where it sits, where its dashboard opens, and what counts as a drag. Pure: no DOM,
// no storage (dicefab.ts has those). Positions are the button's top-left corner in CSS pixels.
export interface FabPos { x: number; y: number }

export const FAB_SIZE = 56;
export const FAB_MARGIN = 8;
/** The dice dashboard's gap from the button. */
export const PANEL_GAP = 10;
/** How far the pointer must travel before a press on the button is a drag rather than a click. */
export const DRAG_THRESHOLD = 5;

export const isFabPos = (v: unknown): v is FabPos =>
  !!v && typeof v === "object" && Number.isFinite((v as FabPos).x) && Number.isFinite((v as FabPos).y);

/** Keep the whole button inside the viewport, `margin` from its edges (a viewport too small for it pins to the margin). */
export function clampFab(p: FabPos, vw: number, vh: number, size = FAB_SIZE, margin = FAB_MARGIN): FabPos {
  const clamp = (v: number, max: number) => Math.max(margin, Math.min(v, Math.max(margin, max - size - margin)));
  return { x: clamp(p.x, vw), y: clamp(p.y, vh) };
}

/** Where it starts: low on the right, clear of the side panel's toolbar and the footer. */
export const defaultFab = (vw: number, vh: number, size = FAB_SIZE): FabPos => clampFab({ x: vw - size - 64, y: vh - size - 56 }, vw, vh, size);

/** The button moved by (dx, dy), kept inside the viewport. */
export const nudgeFab = (p: FabPos, dx: number, dy: number, vw: number, vh: number, size = FAB_SIZE): FabPos =>
  clampFab({ x: p.x + dx, y: p.y + dy }, vw, vh, size);

/** Has the pointer moved far enough from where it went down to be dragging? */
export const isDrag = (dx: number, dy: number, threshold = DRAG_THRESHOLD): boolean => Math.hypot(dx, dy) >= threshold;

/**
 * Where the dashboard goes: above the button when there is room (else below), its right edge on the button's right
 * edge when the button is in the right half of the screen (else its left edge on the button's), always inside the viewport.
 */
export function panelAt(fab: FabPos, panel: { w: number; h: number }, vw: number, vh: number, size = FAB_SIZE, margin = FAB_MARGIN, gap = PANEL_GAP): { left: number; top: number; above: boolean } {
  const room = fab.y - gap - margin;
  const above = room >= panel.h || fab.y + size / 2 > vh / 2 && room > vh - (fab.y + size + gap) - margin;
  const top = above ? fab.y - gap - panel.h : fab.y + size + gap;
  const rightHalf = fab.x + size / 2 > vw / 2;
  const left = rightHalf ? fab.x + size - panel.w : fab.x;
  const fit = (v: number, extent: number, max: number) => Math.max(margin, Math.min(v, max - extent - margin));
  return { left: fit(left, panel.w, vw), top: fit(top, panel.h, vh), above };
}

/** Which of a face's nine places (1-9, row by row) hold a pip, for faces 1 to 6. */
export const PIPS: Record<number, number[]> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
/** The three faces the cube shows to the viewer (top, front, right): one from each opposite pair, so the die is a real one. */
export const SHOWN_FACES = { top: 6, front: 3, right: 2 } as const;

/** Is this "#rgb" or "#rrggbb" colour light (so dark pips read on it)? Anything else counts as dark. */
export function isLightColor(hex: string): boolean {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 175;
}

/** The cube's body colour (the player's first die colour, or a fallback) and the pip ink that reads on it. */
export function cubeColors(color: string, fallback = "#b8432a"): { body: string; pip: string } {
  const body = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color.trim()) ? color.trim() : fallback;
  return { body, pip: isLightColor(body) ? "#1c1a17" : "#ffffff" };
}
