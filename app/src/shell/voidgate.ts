// 2D6 Void is a paid game: its tools need the owner's core rulebook. Until a Void book is loaded on this
// device, every Void screen except Settings (where the book is unlocked) sends the user back to Settings.
// Switching to 2D6 Dungeon is not a route (it saves the game choice and reloads), so it is never blocked.
import { voidBookLoaded } from "../content";
import { isVoid } from "../games";

/** Where a locked Void sends everyone: Settings, with the Books card that unlocks the book. */
export const VOID_UNLOCK_ROUTE = "#/play/settings";

/** Void has its rulebook loaded (nothing is gated in Dungeon, which has its own free content). */
export const voidUnlocked = (): boolean => voidBookLoaded();

/** True while Void is the current game and no Void book is loaded. */
export const voidLocked = (): boolean => isVoid() && !voidUnlocked();

/**
 * The route to show instead of `route`, or null when `route` is allowed. Only Settings is allowed while
 * locked; the route's query-free form is compared, so "#/play/settings" is the one open door.
 */
export function guardRoute(route: string, locked: boolean): string | null {
  if (!locked) return null;
  return route === VOID_UNLOCK_ROUTE ? null : VOID_UNLOCK_ROUTE;
}
