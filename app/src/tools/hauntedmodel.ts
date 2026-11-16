// The Haunted House tool's model, DOM-free: the book sections it reads and the Fear and door arithmetic.
// The rules and wording live in the owner's imported Lairs book (docs/spec-lairs.md §5), never here.

/** Section ids in the Lairs book (its Haunted House chapter). */
export const HOUSE = {
  intro: "lairs/p79-1",
  rules: "lairs/p83-1",
  fear: "lairs/p86-1",
  door: "lairs/p90-1",
  bane: "lairs/p96-1",
  small: "lairs/p91-1",
  level1: "lairs/p92-1",
  level2: "lairs/p94-1",
  loft: "lairs/p90-2",
  creatures: ["lairs/p89-1", "lairs/p89-2", "lairs/p89-3"],
  search: ["lairs/p97-2", "lairs/p88-2", "lairs/p88-1", "lairs/p97-1", "lairs/p96-2"],
} as const;

/** Fear Points run 0–10; at 10 the constable flees and the house is failed. */
export const FEAR_MAX = 10;
export const clampFear = (n: number): number => Math.max(0, Math.min(FEAR_MAX, Math.floor(Number.isFinite(n) ? n : 0)));
export const brokenByFear = (n: number): boolean => clampFear(n) >= FEAR_MAX;

/**
 * The Fear effects in force: effects are cumulative, so `points` Fear Points means the rows numbered 1..points.
 * `rows` is the book's Fear table ([number, mark, effect]); a row whose number does not parse is left out.
 */
export function activeFears(rows: readonly string[][], points: number): { n: number; effect: string }[] {
  const p = clampFear(points);
  return rows
    .map((r) => ({ n: parseInt(r[0] ?? "", 10), effect: (r[r.length - 1] ?? "").trim() }))
    .filter((x) => Number.isFinite(x.n) && x.n >= 1 && x.n <= p && x.effect);
}

/** Using a door: on a D6 roll of 5 or 6 something strange happens (the Haunted Door table). Never when backtracking. */
export const doorIsHaunted = (d6: number, backtracking = false): boolean => !backtracking && d6 >= 5;

/** The room table for a level of the house: 1 and 2 have their own, 3 is the loft (one room). */
export const roomTableFor = (level: number): string => (level === 1 ? HOUSE.level1 : level === 2 ? HOUSE.level2 : HOUSE.loft);
