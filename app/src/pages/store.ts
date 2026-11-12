import { gk } from "../games";
// Best-effort "2d6:<key>" storage for the book pages (bookmarks, recent, open tree groups).

/** `v` when it is an array of strings, else [] (a hand-edited or corrupt saved value). */
export const asStringList = (v: unknown): string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? v : [];

export const store = {
  /** A saved string list ("open", "bookmarks", "recent"); [] when missing or malformed. */
  list(k: string): string[] {
    return asStringList(store.get<unknown>(k, []));
  },
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(gk("2d6:" + k));
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(gk("2d6:" + k), JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};
