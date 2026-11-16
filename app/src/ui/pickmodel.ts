// The data side of the "find and add" picker: what a choice is and how a search narrows the list. DOM-free so
// it can be tested. Every sheet hands the picker its own choices (built from the books' tables), so the picker
// itself holds no book text.

export interface PickChoice {
  /** Unique within one picker. */
  id: string;
  name: string;
  /** A short line next to the name: dice and modifier, cost, level. */
  meta?: string;
  /** What it does, in full: shown under the name and searched. */
  detail?: string;
  /** A heading the list can be narrowed to (armour, scroll, a book). */
  group?: string;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);

/** How well a choice matches the words typed: 0 best (name starts with the first word) … 3 (only the details match); -1 no match. */
function score(c: PickChoice, q: string[]): number {
  if (!q.length) return 0;
  const name = c.name.toLowerCase();
  const all = `${name} ${(c.meta ?? "").toLowerCase()} ${(c.detail ?? "").toLowerCase()} ${(c.group ?? "").toLowerCase()}`;
  if (!q.every((w) => all.includes(w))) return -1;
  if (name.startsWith(q[0])) return 0;
  if (q.every((w) => name.includes(w))) return name.split(/[^a-z0-9]+/).some((n) => n.startsWith(q[0])) ? 1 : 2;
  return 3;
}

/**
 * The choices that match the typed text (every word must be somewhere in name, meta, details or group) and the
 * group, best match first and otherwise in the order given. With nothing typed it is the whole (grouped) list.
 */
export function filterChoices(all: readonly PickChoice[], text: string, group = ""): PickChoice[] {
  const q = words(text);
  return all
    .filter((c) => !group || c.group === group)
    .map((c, i) => ({ c, i, s: score(c, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.c);
}

/** The groups the choices fall in, in first-seen order. */
export const groupsOf = (all: readonly PickChoice[]): string[] => [...new Set(all.map((c) => c.group ?? "").filter(Boolean))];

/** True when a typed name is already one of the choices (so "add it as written" is not offered). */
export const hasChoiceNamed = (all: readonly PickChoice[], text: string): boolean => {
  const t = text.trim().toLowerCase();
  return !!t && all.some((c) => c.name.toLowerCase() === t);
};
