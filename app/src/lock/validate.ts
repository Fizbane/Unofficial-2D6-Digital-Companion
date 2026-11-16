// Small strict schema combinators for untrusted JSON (manifest, to-do and pack files).
// Each validator is (x, path) => T and throws a ValidationError naming the failing path. No eval, no Function.

export type V<T> = (x: unknown, path: string) => T;

/** Thrown with the path of the first bad value; callers prefix it, e.g. "manifest: sections[3].blocks[0].h". */
export class ValidationError extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

export const fail = (path: string): never => {
  throw new ValidationError(path);
};

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const OPTIONAL = Symbol("optional");

export const key = (path: string, k: string) => (path ? `${path}.${k}` : k);
export const idx = (path: string, i: number) => `${path}[${i}]`;

const ID = "[a-z]+/p[0-9]{1,5}-[0-9]{1,4}"; // locked section ids only: ${book}/p${page}-${n}
const CODE = "[A-Z0-9]{2,8}";
const HASH = "[A-Za-z0-9_-]{22}";
const DICE = "1D6|2D6|D66|[0-9D+]{2,8}";
const FP = "[0-9a-f]{64}";
const EDITION = "[a-z0-9]{1,12}(?:-[a-z0-9]{1,12})?";

export const RE = {
  id: new RegExp(`^${ID}$`),
  code: new RegExp(`^${CODE}$`),
  hash: new RegExp(`^${HASH}$`),
  dice: new RegExp(`^(${DICE})$`),
  fp: new RegExp(`^${FP}$`),
  edition: new RegExp(`^${EDITION}$`),
};
export const BOOK_NAMES = ["Core Rules", "Tables Codex", "Realm", "Animal Companions", "Lairs Omnibus", "Legendary Dungeon", "2D6 Void", "PAL-BOT", "Space Pirates"] as const;

/** Every manifest string must match this: an id, code, hash, dice spec, fingerprint, edition id or book name. */
export const MANIFEST_STRING = new RegExp(
  `^(${ID}|${CODE}|${HASH}|${DICE}|${FP}|${EDITION}|${BOOK_NAMES.join("|")})$`,
);

function plain(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const p = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
}

function ownKeys(x: Record<string, unknown>, path: string): string[] {
  const ks = Object.keys(x);
  for (const k of ks) if (FORBIDDEN.has(k)) fail(key(path, k));
  return ks;
}

/** Marks a field optional inside obj(); a missing or undefined value is allowed. */
export function opt<T>(v: V<T>): V<T | undefined> {
  const w: V<T | undefined> = (x, path) => (x === undefined ? undefined : v(x, path));
  (w as unknown as Record<symbol, boolean>)[OPTIONAL] = true;
  return w;
}

/** A plain object with exactly these keys (optional ones via opt). Extra keys fail unless extra: true (then dropped). */
export function obj<T>(shape: { [K in keyof T]-?: V<T[K]> }, o: { extra: boolean; rest?: V<unknown> } = { extra: false }): V<T> {
  const fields = Object.keys(shape) as (keyof T & string)[];
  return (x, path) => {
    if (!plain(x)) return fail(path);
    const ks = ownKeys(x, path);
    if (!o.extra) for (const k of ks) if (!Object.prototype.hasOwnProperty.call(shape, k)) fail(key(path, k));
    const out = {} as T;
    for (const f of fields) {
      const v = shape[f];
      const has = Object.prototype.hasOwnProperty.call(x, f);
      if (!has && !(v as unknown as Record<symbol, boolean>)[OPTIONAL]) fail(key(path, f));
      const r = v(has ? x[f] : undefined, key(path, f));
      if (r !== undefined) out[f] = r;
    }
    // unknown keys: dropped, or (with `rest`) kept after being checked by `rest`
    if (o.extra && o.rest) {
      const extras = ks.filter((k) => !Object.prototype.hasOwnProperty.call(shape, k));
      if (extras.length > 200) fail(path);
      for (const k of extras) if (k.length > 64) fail(key(path, k));
    }
    if (o.extra && o.rest)
      for (const k of ks) if (!Object.prototype.hasOwnProperty.call(shape, k)) (out as Record<string, unknown>)[k] = o.rest(x[k], key(path, k));
    return out;
  };
}

/** A plain object used as a map: every key passes keyRe, every value passes of. */
export function rec<T>(keyRe: RegExp, of: V<T>, max: number): V<Record<string, T>> {
  return (x, path) => {
    if (!plain(x)) return fail(path);
    const ks = ownKeys(x, path);
    if (ks.length > max) fail(path);
    const out: Record<string, T> = {};
    for (const k of ks) {
      if (!keyRe.test(k)) fail(key(path, k));
      out[k] = of(x[k], key(path, k));
    }
    return out;
  };
}

/** An array of at most max items. */
export function arr<T>(of: V<T>, max: number): V<T[]> {
  return (x, path) => {
    if (!Array.isArray(x) || x.length > max) return fail(path);
    return x.map((e, i) => of(e, idx(path, i)));
  };
}

/** A fixed-length array, one validator per position. */
export function tuple<T extends unknown[]>(...of: { [K in keyof T]: V<T[K]> }): V<T> {
  return (x, path) => {
    if (!Array.isArray(x) || x.length !== of.length) return fail(path);
    return of.map((v, i) => v(x[i], idx(path, i))) as T;
  };
}

/** A string of at most max characters, matching re when given. */
export function str(max: number, re?: RegExp): V<string> {
  return (x, path) => {
    if (typeof x !== "string" || x.length > max || (re && !re.test(x))) return fail(path);
    return x;
  };
}

/** A finite number, optionally an integer and within [min, max]. */
export function num(o: { int?: boolean; min?: number; max?: number } = {}): V<number> {
  return (x, path) => {
    if (typeof x !== "number" || !Number.isFinite(x)) return fail(path);
    if (o.int && !Number.isInteger(x)) fail(path);
    if (o.min !== undefined && x < o.min) fail(path);
    if (o.max !== undefined && x > o.max) fail(path);
    return x;
  };
}

/** One of these literal values (compared with ===). */
export function oneOf<const T extends readonly (string | number | boolean | null)[]>(...vals: T): V<T[number]> {
  return (x, path) => (vals.includes(x as T[number]) ? (x as T[number]) : fail(path));
}

export const bool: V<boolean> = (x, path) => (typeof x === "boolean" ? x : fail(path));

/** v, or null. */
export function orNull<T>(v: V<T>): V<T | null> {
  return (x, path) => (x === null ? null : v(x, path));
}

/** Any JSON value of bounded depth and size (keys of at most 64 characters, no prototype keys). */
export const jsonValue = (depth: number): V<unknown> => (x, path) => {
  if (x === null || typeof x === "boolean") return x;
  if (typeof x === "number") return Number.isFinite(x) ? x : fail(path);
  if (typeof x === "string") return str(20000)(x, path);
  if (depth <= 0) return fail(path);
  return Array.isArray(x) ? arr(jsonValue(depth - 1), 500)(x, path) : rec(/^.{1,64}$/, jsonValue(depth - 1), 100)(x, path);
};
