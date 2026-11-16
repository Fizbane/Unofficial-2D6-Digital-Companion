// "Is there a newer version?" for both ways the app runs:
//   desktop app: the Electron wrapper checks GitHub Releases (electron/updates.cjs) and talks to us through
//                window.desktop.updates. The installed app downloads and installs; the portable .exe opens the
//                download page.
//   web (a clone run with npm run dev / preview): the local server's /__2d6/update endpoint compares this copy
//                with GitHub through git, and can `git pull` it (scripts/vite-update.ts).
// The page itself never talks to GitHub (CSP connect-src 'self'). Nothing here is part of a game save, but the
// "check automatically" choice lives under a 2d6: key so a backup carries it.
import { isNewer } from "./version";

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

export const RELEASES_URL = "https://github.com/Fizbane/Unofficial-2D6-Digital-Companion/releases/latest";
export const UPDATE_URL = "__2d6/update"; // relative: the app is served from the site root of its own server

/** installed / portable / dev: the desktop app. git: a clone with the update endpoint. web: not known yet. none: no way to update from here. */
export type UpdateHow = "installed" | "portable" | "dev" | "git" | "web" | "none";

export type UpdateStatus =
  | { s: "idle" }
  | { s: "checking" }
  | { s: "current" }
  | { s: "available"; latest: string; canUpdate?: boolean; reason?: string }
  | { s: "downloading"; latest: string; percent: number }
  | { s: "ready"; latest: string }
  | { s: "updated"; latest: string; needsInstall: boolean }
  | { s: "error"; message: string };

interface DesktopUpdates {
  info(): Promise<{ version: string; how: "installed" | "portable" | "dev"; status: UpdateStatus | null }>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  onStatus(cb: (s: UpdateStatus) => void): () => void;
}
const bridge = (): DesktopUpdates | undefined =>
  typeof window !== "undefined" ? (window as unknown as { desktop?: { updates?: DesktopUpdates } }).desktop?.updates : undefined;

// ---- the "check automatically" pref and the time of the last check ----

// read and written directly (not through games.ts keyFor), so one setting covers both games
export const UPDATES_KEY = "2d6:shell:updates";
export interface UpdatePrefs { auto: boolean; last: number }
/** Checked at most this often on its own (a check from Settings always runs). */
export const AUTO_EVERY_MS = 20 * 60 * 60 * 1000;

type KV = Pick<Storage, "getItem" | "setItem">;
const kv = (): KV | undefined => (typeof localStorage !== "undefined" ? localStorage : undefined);

export function getUpdatePrefs(store: KV | undefined = kv()): UpdatePrefs {
  try {
    const v = JSON.parse(store?.getItem(UPDATES_KEY) ?? "null") as Partial<UpdatePrefs> | null;
    return { auto: v?.auto !== false, last: typeof v?.last === "number" && Number.isFinite(v.last) ? v.last : 0 };
  } catch {
    return { auto: true, last: 0 };
  }
}
export function setUpdatePrefs(patch: Partial<UpdatePrefs>, store: KV | undefined = kv()): UpdatePrefs {
  const next = { ...getUpdatePrefs(store), ...patch };
  try {
    store?.setItem(UPDATES_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the choice lasts for this visit only */
  }
  return next;
}
/** Whether an automatic check is due. */
export const autoCheckDue = (p: UpdatePrefs, now = Date.now()): boolean => p.auto && now - p.last >= AUTO_EVERY_MS;

// ---- state ----

let how: UpdateHow = bridge() ? "dev" : "web";
let version = APP_VERSION;
let status: UpdateStatus = { s: "idle" };
const listeners = new Set<() => void>();
const set = (s: UpdateStatus) => {
  status = s;
  listeners.forEach((f) => f());
};

export const updateStatus = (): UpdateStatus => status;
export const updateHow = (): UpdateHow => how;
export const appVersion = (): string => version;
export function onUpdateStatus(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

let ready: Promise<void> | null = null;
/** Learn how this copy runs (asks the desktop wrapper once). */
export function initUpdates(): Promise<void> {
  return (ready ??= (async () => {
    const b = bridge();
    if (!b) return;
    try {
      const i = await b.info();
      how = i.how;
      version = i.version || version;
      if (i.status) status = i.status;
      b.onStatus(set);
    } catch {
      how = "none";
    }
  })());
}

/** What the update endpoint answered, in the shape scripts/vite-update.ts sends. */
interface GitCheck { how: "git"; current: string; latest?: string; available: boolean; canUpdate: boolean; reason?: string }

/** Turn the endpoint's answer into a status (exported for tests). */
export function statusFromGit(r: GitCheck): UpdateStatus {
  if (r.available && r.latest && isNewer(r.latest, r.current)) return { s: "available", latest: r.latest, canUpdate: r.canUpdate, reason: r.reason };
  if (r.reason) return { s: "error", message: r.reason };
  return { s: "current" };
}

export const NO_ENDPOINT =
  "This copy can't check for updates by itself. Get the newest version from GitHub, or run the app from a git clone with npm run dev.";

/** Check now. Resolves once the answer is in (for the desktop app, once the wrapper has replied). */
export async function checkForUpdates(): Promise<UpdateStatus> {
  await initUpdates();
  setUpdatePrefs({ last: Date.now() });
  const b = bridge();
  if (b) {
    const done = new Promise<UpdateStatus>((ok) => {
      const finish = () => {
        clearTimeout(timer);
        off();
        ok(status);
      };
      const off = onUpdateStatus(() => status.s !== "checking" && finish());
      // the wrapper always answers, but never leave "Checking…" up for good
      const timer = setTimeout(() => {
        if (status.s === "checking") set({ s: "error", message: "Couldn't check for updates. Try again later." });
        finish();
      }, 60_000);
    });
    set({ s: "checking" });
    try {
      await b.check();
    } catch {
      set({ s: "error", message: "Couldn't check for updates. Try again later." }); // this also settles `done`
    }
    return done;
  }
  set({ s: "checking" });
  try {
    const res = await fetch(UPDATE_URL, { headers: { "X-2D6-Update": "1" }, cache: "no-store" });
    const json = (res.headers.get("content-type") ?? "").includes("application/json");
    if (!json) {
      how = "none";
      set({ s: "error", message: NO_ENDPOINT });
    } else {
      const body = (await res.json()) as GitCheck | { error: string };
      how = "git";
      set("error" in body ? { s: "error", message: body.error } : statusFromGit(body));
    }
  } catch {
    set({ s: "error", message: "Couldn't check for updates. Try again later." });
  }
  return status;
}

/**
 * The next step for an available update. Installed app: download, then (once ready) restart into it.
 * Portable: open the download page. Git: pull it in.
 */
export async function installUpdate(): Promise<UpdateStatus> {
  const b = bridge();
  if (b) {
    try {
      if (status.s === "ready") await b.install();
      else await b.download();
    } catch {
      set({ s: "error", message: "The update could not be downloaded or installed. Try again later." });
    }
    return status;
  }
  if (status.s !== "available" || !status.canUpdate) return status;
  const latest = status.latest;
  set({ s: "downloading", latest, percent: 0 });
  try {
    const res = await fetch(UPDATE_URL, { method: "POST", headers: { "X-2D6-Update": "1" }, cache: "no-store" });
    const body = (await res.json()) as { updated?: string; needsInstall?: boolean; error?: string };
    set(res.ok && body.updated ? { s: "updated", latest: body.updated, needsInstall: !!body.needsInstall } : { s: "error", message: body.error ?? "Couldn't update." });
  } catch {
    set({ s: "error", message: "Couldn't update. Try again later." });
  }
  return status;
}

/** For tests: back to a fresh start. */
export function resetUpdates(): void {
  how = bridge() ? "dev" : "web";
  version = APP_VERSION;
  status = { s: "idle" };
  ready = null;
  listeners.clear();
}
