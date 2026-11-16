// The pure pieces of the 2D6 Void character sheet's layout (tools/void/sheet.ts): the tabs of its
// right-hand panel and the row of stat tiles. Kept apart from the sheet so they can be tested.
import type { Raw } from "../../ui/html";
import { stepIn, tiles, type Tile } from "../sheetlayout";
import type { IconName } from "../../ui/icon";

/** The tabs of the panel under the columns, in order. Combat, survival (armour, stims) and tech (skill check,
 *  task experience) are always on screen. */
export const SHEET_TABS = [
  { id: "items", label: "Items", icon: "backpack" },
  { id: "story", label: "Story", icon: "scroll" },
  { id: "rest", label: "Rest", icon: "utensils" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

export type SheetTab = (typeof SHEET_TABS)[number]["id"];

export const isSheetTab = (v: unknown): v is SheetTab => SHEET_TABS.some((t) => t.id === v);

/** The tab an arrow / Home / End key moves to from `cur`, or null for any other key. Arrows wrap round. */
export const stepTab = (cur: SheetTab, key: string): SheetTab | null => stepIn(SHEET_TABS.map((t) => t.id), cur, key);

/** A row of framed stat tiles: label, big value, and an optional small line under it. */
export const statTiles = (rows: Tile[]): Raw => tiles("vs", rows);
