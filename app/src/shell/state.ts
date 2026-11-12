// Saved state in this browser: validated reads, failure-tolerant writes.
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

let failHandler: (() => void) | null = null;
let failFired = false;

/** localStorage, or null when it is missing or blocked. */
function defaultKV(): KV | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Parse the saved value for `key`; anything missing, malformed or invalid gives `fallback()`. */
export function readState<T>(key: string, isValid: (v: unknown) => v is T, fallback: () => T, kv?: KV): T {
  try {
    const store = kv ?? defaultKV();
    const raw = store?.getItem(key);
    if (raw == null) return fallback();
    const v: unknown = JSON.parse(raw);
    return isValid(v) ? v : fallback();
  } catch {
    return fallback();
  }
}

/** Save `value` as JSON; returns false (and notifies once per page load) when storage fails. */
export function writeState(key: string, value: unknown, kv?: KV): boolean {
  try {
    const store = kv ?? defaultKV();
    if (!store) throw new Error("storage unavailable");
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    if (!failFired && failHandler) {
      failFired = true;
      failHandler();
    }
    return false;
  }
}

/** Register the handler called on the first write failure of this page load. */
export function onWriteFail(fn: () => void): void {
  failHandler = fn;
}
