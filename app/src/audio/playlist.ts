// The music playlist: which songs may play, and the player's own uploads. The game still decides the scene
// (exploring or fighting); the playlist decides which enabled songs fill that scene. With one enabled song a
// scene loops it, as before; with several they play one after another. A song switched off is never played:
// if every fight song is off, the exploring songs carry on through a fight; if all are off, there is silence.
import { readState, writeState } from "../shell/state";
import type { TrackId } from "./manifest";
import { here } from "../shell/platform";

export type Scene = "explore" | "combat";
export interface UserSong { id: string; name: string; scene: Scene | "any"; enabled: boolean }
export interface PlaylistState { v: 1; /** Built-in track ids switched off. */ off: string[]; songs: UserSong[] }
export interface Entry { id: string; user: boolean }

export const MAX_SONGS = 24;
export const MAX_SONG_BYTES = 40 * 1024 * 1024;
const KEY = "2d6:shell:playlist"; // shared by both games (games.ts SHARED); the audio files live in IndexedDB, not here

/** The scene a built-in track belongs to. */
export const sceneOf = (id: string): Scene => (id === "combat" || id === "fight" ? "combat" : "explore");

const isSong = (x: unknown): x is UserSong => {
  const s = x as Partial<UserSong> | null;
  return !!s && typeof s.id === "string" && /^[a-z0-9-]{4,40}$/.test(s.id) && typeof s.name === "string" && s.name.length <= 120 &&
    (s.scene === "any" || s.scene === "explore" || s.scene === "combat") && typeof s.enabled === "boolean";
};
const isState = (x: unknown): x is PlaylistState => {
  const o = x as Partial<PlaylistState> | null;
  return !!o && o.v === 1 && Array.isArray(o.off) && o.off.every((t) => typeof t === "string") && Array.isArray(o.songs) && o.songs.every(isSong);
};
const fresh = (): PlaylistState => ({ v: 1, off: [], songs: [] });

let state: PlaylistState = readState(KEY, isState, fresh);
const listeners = new Set<() => void>();
const commit = (next: PlaylistState) => {
  state = next;
  writeState(KEY, state);
  listeners.forEach((f) => f());
};

export const playlist = (): PlaylistState => state;
export function onPlaylistChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const isBuiltinOn = (id: string): boolean => !state.off.includes(id);
export function setBuiltinOn(id: string, on: boolean): void {
  const off = new Set(state.off);
  if (on) off.delete(id);
  else off.add(id);
  commit({ ...state, off: [...off] });
}
export function addSong(song: UserSong): void {
  commit({ ...state, songs: [...state.songs, song] });
}
export function patchSong(id: string, patch: Partial<Pick<UserSong, "enabled" | "scene" | "name">>): void {
  commit({ ...state, songs: state.songs.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}
export function removeSong(id: string): void {
  commit({ ...state, songs: state.songs.filter((s) => s.id !== id) });
}

/** A readable name from an uploaded file's name: no extension, tidy spaces, at most 80 characters. */
export function songNameFromFile(file: string): string {
  const n = file.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return n || "Untitled song";
}
export const newSongId = (): string => "u" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/**
 * The songs to play for a scene, in order: the scene's own track first, then the other enabled songs of the
 * scene, then the player's uploads that suit it. Empty when music is off for the scene (nothing enabled).
 */
export function queueFor(scenic: TrackId | null, all: readonly string[], st: PlaylistState = state): Entry[] {
  if (!scenic) return [];
  const off = new Set(st.off);
  const pick = (scene: Scene): Entry[] => {
    const own = all.filter((t) => sceneOf(t) === scene && !off.has(t));
    own.sort((a, b) => Number(b === scenic) - Number(a === scenic)); // the game's pick leads
    const mine = st.songs.filter((s) => s.enabled && (s.scene === "any" || s.scene === scene));
    return [...own.map((id) => ({ id, user: false })), ...mine.map((s) => ({ id: s.id, user: true }))];
  };
  const scene = sceneOf(scenic);
  const q = pick(scene);
  return q.length || scene === "explore" ? q : pick("explore"); // a fight with no fight songs keeps the music going
}

/** The song after `current` in `queue`, wrapping round (the first when `current` is not in it). */
export function nextEntry(queue: readonly Entry[], current: string | null): Entry | undefined {
  if (!queue.length) return undefined;
  const i = queue.findIndex((e) => e.id === current);
  return queue[(i + 1) % queue.length];
}

/** What the playlist and the rail call a track: a built-in's name, or the name of one of the player's own songs. */
const LABELS: Record<string, string> = {
  tavern: "Tavern", dungeon: "The dungeon", combat: "Battle", realm: "Your realm",
  bay: "Ship bay", hulk: "The Dark Hulk", fight: "Fight!", nullvoid: "The Null Void", hive: "The AI Hive",
};
export const trackLabel = (id: string): string => state.songs.find((s) => s.id === id)?.name ?? LABELS[id] ?? id[0].toUpperCase() + id.slice(1);

// ---------------------------------------------------------------------------------------------- the files

const DB = "2d6-music";
const STORE = "songs";
let dbp: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx<T>(mode: IDBTransactionMode, fn: (os: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result as T);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
export const putSongFile = (id: string, blob: Blob): Promise<void> => tx<void>("readwrite", (os) => os.put(blob, id));
export const getSongFile = (id: string): Promise<Blob | undefined> => tx<Blob | undefined>("readonly", (os) => os.get(id));
export const deleteSongFile = (id: string): Promise<void> => tx<void>("readwrite", (os) => os.delete(id));

/** Why a file can't be added, or null when it can. */
export function refuseSong(file: { name: string; type: string; size: number }, count = state.songs.length): string | null {
  if (count >= MAX_SONGS) return `The playlist holds up to ${MAX_SONGS} of your own songs. Remove one first.`;
  if (file.size > MAX_SONG_BYTES) return `"${songNameFromFile(file.name)}" is over ${MAX_SONG_BYTES / 1024 / 1024} MB.`;
  if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i.test(file.name)) return `"${songNameFromFile(file.name)}" isn't an audio file.`;
  return null;
}

/** Add an uploaded file to the playlist (stored on this device only). Returns an error message, or null. */
export async function addSongFile(file: File): Promise<string | null> {
  const why = refuseSong(file);
  if (why) return why;
  const id = newSongId();
  try {
    await putSongFile(id, file);
  } catch {
    return `Couldn't store that song in ${here()}.`;
  }
  addSong({ id, name: songNameFromFile(file.name), scene: "any", enabled: true });
  return null;
}

export async function removeSongFile(id: string): Promise<void> {
  removeSong(id);
  try {
    await deleteSongFile(id);
  } catch {
    /* the entry is gone; a stray file is harmless */
  }
}
