// Where the bar groups sit: the player (name chip) and the stats (HP, XP, Shift, Fatigue and the condition
// chips), each on the top bar (beside the game logos) or the lower bar, in an order the player picks
// (bottombar.ts arrange mode). Saved once, shared by both games. The dice are not a group: they are the
// floating button (dicefab.ts). A layout saved with the old "dice" group loses it on read. Pure: no DOM.
import { readState, writeState } from "./state";

export const GROUPS = ["player", "stats"] as const;
export type GroupId = (typeof GROUPS)[number];
export type BarId = "top" | "lower";
export interface BarLayout { v: 1; top: GroupId[]; lower: GroupId[] }

export const BAR_KEY = "2d6:shell:bars";
export const DEFAULT_BARS: BarLayout = { v: 1, top: ["player", "stats"], lower: [] };

export const GROUP_LABEL: Record<GroupId, string> = { player: "Player", stats: "Stats" };

const isGroup = (x: unknown): x is GroupId => typeof x === "string" && (GROUPS as readonly string[]).includes(x);

/** A well-formed layout: every group exactly once (missing ones go where the default puts them). */
export function normalizeBars(v: unknown): BarLayout {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<BarId, unknown>>;
  const seen = new Set<GroupId>();
  const pick = (a: unknown): GroupId[] => (Array.isArray(a) ? a : []).filter((g): g is GroupId => isGroup(g) && !seen.has(g) && !!seen.add(g));
  const top = pick(o.top), lower = pick(o.lower);
  for (const g of GROUPS) if (!seen.has(g)) (DEFAULT_BARS.top.includes(g) ? top : lower).push(g);
  return { v: 1, top, lower };
}

export const readBars = (): BarLayout => normalizeBars(readState<unknown>(BAR_KEY, (x): x is unknown => true, () => DEFAULT_BARS));
export const writeBars = (l: BarLayout) => writeState(BAR_KEY, normalizeBars(l));

export function barOf(l: BarLayout, g: GroupId): BarId {
  return l.top.includes(g) ? "top" : "lower";
}

/** Put `g` on `bar` at `index` (clamped; past the end appends). */
export function placeGroup(l: BarLayout, g: GroupId, bar: BarId, index: number): BarLayout {
  const out: BarLayout = { v: 1, top: l.top.filter((x) => x !== g), lower: l.lower.filter((x) => x !== g) };
  const list = out[bar];
  list.splice(Math.max(0, Math.min(list.length, index)), 0, g);
  return out;
}

/** One step earlier (-1) or later (+1) in reading order: along its bar, then onto the other bar's near end. */
export function stepGroup(l: BarLayout, g: GroupId, dir: -1 | 1): BarLayout {
  const bar = barOf(l, g);
  const i = l[bar].indexOf(g);
  const j = i + dir;
  if (j >= 0 && j < l[bar].length) return placeGroup(l, g, bar, j);
  // off the end of its bar: the top bar's end leads to the lower bar's start, and back
  if (bar === "top" && dir === 1) return placeGroup(l, g, "lower", 0);
  if (bar === "lower" && dir === -1) return placeGroup(l, g, "top", l.top.length);
  return l;
}

/** Move `g` to the other bar, at its end. */
export const swapBar = (l: BarLayout, g: GroupId): BarLayout => {
  const to: BarId = barOf(l, g) === "top" ? "lower" : "top";
  return placeGroup(l, g, to, l[to].length);
};

/** Can `g` move one step that way? */
export function canStep(l: BarLayout, g: GroupId, dir: -1 | 1): boolean {
  const bar = barOf(l, g);
  const i = l[bar].indexOf(g);
  return dir === -1 ? !(bar === "top" && i === 0) : !(bar === "lower" && i === l.lower.length - 1);
}
