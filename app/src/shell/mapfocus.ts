// Ask the Map page to show one dungeon room's details (the Journal's room pictures do). An open
// Map page hears "map:focus" at once; a Map page opened next picks the request up when it mounts.
import { bus } from "./events";

let pending: number | null = null;

export function requestMapFocus(room: number): void {
  pending = room;
  bus.emit("map:focus", { room });
}

/** The room asked for since the last call, if any (cleared by reading it). */
export function takeMapFocus(): number | null {
  const r = pending;
  pending = null;
  return r;
}
