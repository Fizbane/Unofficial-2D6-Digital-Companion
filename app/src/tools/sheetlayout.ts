// The pure pieces of the character sheets' layout: the row of stat tiles and the tabs of the panel
// (the 2D6 Dungeon sheet's tabs are here; 2D6 Void's are in void/sheetlayout.ts). Kept apart from the
// sheets so they can be tested.
import { html, type Raw } from "../ui/html";
import type { IconName } from "../ui/icon";

/** The id an arrow / Home / End key moves to from `cur` in a tab list, or null for any other key. Arrows wrap round. */
export function stepIn<T extends string>(ids: readonly T[], cur: T, key: string): T | null {
  const i = Math.max(0, ids.indexOf(cur));
  if (!ids.length) return null;
  if (key === "ArrowRight") return ids[(i + 1) % ids.length];
  if (key === "ArrowLeft") return ids[(i - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}

/** A tile: label, big value, an optional small line under it, and optional details shown on hover. */
export type Tile = [label: string, value: string, sub?: string, tip?: string];

/** A row of framed stat tiles. `prefix` names the classes. A tile with details can be reached with the keyboard. */
export function tiles(prefix: string, rows: Tile[]): Raw {
  return html`<dl class="${prefix}-tiles">${rows.map(([k, v, sub, tip]) => html`<div class="${prefix}-tile"${tip ? html` tabindex="0" data-tip-title="${k}" data-tip="${tip}"` : ""}><dt>${k}</dt><dd>${v}</dd>${sub ? html`<dd class="${prefix}-tile-sub">${sub}</dd>` : ""}</div>`)}</dl>`;
}

/** The tabs of the Dungeon sheet's panel, in order. Combat things (HP, armour, weapon, scrolls, favour) are always on screen. */
export const DSHEET_TABS = [
  { id: "items", label: "Items", icon: "backpack" },
  { id: "story", label: "Story", icon: "scroll" },
  { id: "companion", label: "Companion", icon: "heart" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

export type DSheetTab = (typeof DSHEET_TABS)[number]["id"];

export const isDSheetTab = (v: unknown): v is DSheetTab => DSHEET_TABS.some((t) => t.id === v);

/** The tabs a character has: the Companion tab only for one who plays with Animal Companions. */
export const dsheetTabs = (companion: boolean) => DSHEET_TABS.filter((t) => companion || t.id !== "companion");
