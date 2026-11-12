// Sound effects and music on the Web Audio API. Nothing plays until the first tap or key press
// (browsers block audio before that); effects asked for earlier are dropped, and the music that
// was asked for starts then. Volumes and on/off come from the shell prefs. Without Web Audio
// (old browsers, tests) every call does nothing.
import { bus } from "../shell/events";
import { getPrefs, type Prefs } from "../shell/prefs";
import { SFX, STINGS, TRACKS, sfxUrl, stingUrl, trackUrl, type SfxId, type StingId, type TrackId } from "./manifest";
import { getSongFile, nextEntry, onPlaylistChange, queueFor } from "./playlist";

const FADE = 1.5; // music crossfade, seconds
const DUCK = 0.25; // music level under a sting

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let prefs: Prefs = getPrefs();

const sfxBuffers = new Map<string, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<SfxId, number>();
// Music buffers are large (~30 MB decoded for 90 s), so only the latest two are kept.
const musicBuffers = new Map<string, Promise<AudioBuffer | null>>();

let wanted: TrackId | null = null;
let playing: { id: string; user: boolean; src: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number; buf: AudioBuffer; loopStart: number } | null = null;
// The player's own picks from the rail controls: a skipped-to track holds until the game asks for a
// different one (a fight starting, say), and pause holds until play or a skip.
let picked: string | null = null; // a built-in track id or one of the player's own song ids
let pickedOver: TrackId | null = null; // the game's track when the pick was made
let paused = false;
let resumeAt: { id: string; offset: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

const supported = () => typeof window !== "undefined" && typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) === "function";

function load(url: string, cache: Map<string, Promise<AudioBuffer | null>>, keep = Infinity, bytes?: () => Promise<ArrayBuffer>): Promise<AudioBuffer | null> {
  let p = cache.get(url);
  if (!p) {
    p = (bytes ? bytes() : fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${url}`)))))
      .then((b) => ctx!.decodeAudioData(b))
      .catch((e) => {
        console.warn("Sound failed to load", e);
        cache.delete(url); // try again next time
        return null;
      });
    cache.set(url, p);
    while (cache.size > keep) cache.delete(cache.keys().next().value!);
  }
  return p;
}

function applyLevels() {
  if (!ctx || !sfxBus || !musicBus) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(prefs.sound ? prefs.sfxVolume : 0, t, 0.05);
  musicBus.gain.setTargetAtTime(prefs.music ? prefs.musicVolume : 0, t, 0.1);
}

/** Make the AudioContext (on a user gesture) and start any music already asked for. */
function unlock() {
  if (!supported()) return;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    musicBus.connect(ctx.destination);
    sfxBus.gain.value = 0;
    musicBus.gain.value = 0;
    applyLevels();
  }
  if (ctx.state === "suspended" && document.visibilityState === "visible") void ctx.resume();
  void syncMusic();
}

/** Play a sound effect (dropped when effects are off or audio isn't unlocked yet). */
export function playSfx(id: SfxId, o: { volume?: number; gap?: number } = {}): void {
  if (!ctx || !sfxBus || !prefs.sound || prefs.sfxVolume <= 0 || SFX[id] === undefined) return; // not in this game's pack
  const now = performance.now();
  if (now - (lastPlayed.get(id) ?? -1e9) < (o.gap ?? 40)) return; // the same effect twice at once sounds like one loud one
  lastPlayed.set(id, now);
  void load(sfxUrl(id), sfxBuffers).then((buf) => {
    if (!buf || !ctx || !sfxBus) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08; // a little variety on repeats
    const g = ctx.createGain();
    g.gain.value = (SFX[id] ?? 0) * (o.volume ?? 1);
    src.connect(g).connect(sfxBus);
    src.start();
  });
}

/** Ask for a music track (null = silence). It crossfades in when it has loaded. */
export function setMusic(id: TrackId | null): void {
  if (id !== pickedOver) picked = null; // the game moved on: its track wins again
  wanted = id;
  void syncMusic();
  emit();
}

/** The enabled songs for the current scene (the playlist decides; the game's own pick leads). */
const queue = () => queueFor(wanted, Object.keys(TRACKS));
/** The song to play: the player's pick (while it is still enabled), else the first enabled song for the scene. */
function chosen(): string | null {
  if (picked && queue().some((e) => e.id === picked)) return picked;
  picked = null;
  return queue()[0]?.id ?? null;
}

/** Pause or resume the music (it picks up where it stopped). */
export function toggleMusicPause(): void {
  paused = !paused;
  void syncMusic();
  emit();
}

/** Skip to the next (+1) or previous (-1) enabled song; it plays until the game changes scene. */
export function skipMusic(dir: 1 | -1): void {
  const ids = queue().map((e) => e.id);
  if (!ids.length) return;
  const i = ids.indexOf(playing?.id ?? chosen() ?? ids[0]);
  picked = ids[(i + dir + ids.length) % ids.length];
  pickedOver = wanted;
  paused = false;
  resumeAt = null;
  void syncMusic();
  emit();
}

/** The rail controls' view: the track chosen, whether it is paused, and whether music is on in Settings. */
export function musicState(): { track: string | null; paused: boolean; enabled: boolean } {
  return { track: chosen(), paused, enabled: prefs.music };
}

/** Call back on any change to musicState(); returns an unsubscribe. */
export function onMusicChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Where a playing loop is now, in seconds into the file. */
function position(p: NonNullable<typeof playing>): number {
  const dur = p.buf.duration;
  let t = p.offset + (ctx!.currentTime - p.startedAt);
  if (t >= dur) {
    const span = dur - p.loopStart;
    t = span > 0 ? p.loopStart + ((t - dur) % span) : t % dur;
  }
  return t;
}

async function syncMusic() {
  if (!ctx || !musicBus) return;
  const want = () => (prefs.music && !paused ? chosen() : null);
  const target = want();
  if (playing?.id === target) return updateLooping();
  if (paused && playing) resumeAt = { id: playing.id, offset: position(playing) };
  fadeOut(paused ? 0.3 : FADE);
  if (!target) return;
  const user = !(target in TRACKS);
  const buf = await load(user ? `user:${target}` : trackUrl(target as TrackId), musicBuffers, 2, user ? async () => {
    const blob = await getSongFile(target);
    if (!blob) throw new Error("song file missing");
    return blob.arrayBuffer();
  } : undefined);
  // another change may have happened while it loaded
  if (!buf && user) { picked = null; return void (queue().length && want() === target ? syncMusic() : undefined); } // a missing file: skip it
  if (!buf || !ctx || !musicBus || want() !== target || playing?.id === target) return;
  fadeOut();
  const tr = (user ? undefined : TRACKS[target as TrackId]) ?? { loopStart: 0, volume: 0.8 };
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = queue().length <= 1; // one enabled song loops; several play one after another
  if (src.loop && tr.loopStart > 0 && tr.loopStart < buf.duration) {
    src.loopStart = tr.loopStart;
    src.loopEnd = buf.duration;
  }
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  const offset = resumeAt?.id === target && resumeAt.offset < buf.duration ? resumeAt.offset : 0;
  resumeAt = null;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(tr.volume, t + (offset ? 0.3 : FADE));
  src.connect(gain).connect(musicBus);
  src.start(0, offset);
  playing = { id: target, user, src, gain, startedAt: t, offset, buf, loopStart: src.loopStart };
  src.onended = () => {
    // it ran to its end (we did not stop it): on to the next enabled song
    if (playing?.src !== src) return;
    playing = null;
    const n = nextEntry(queue(), target);
    if (n) {
      picked = n.id;
      pickedOver = wanted;
    }
    void syncMusic();
    emit();
  };
}

/** The loop flag follows the playlist: switching songs off down to one makes it loop, adding more lets it move on. */
function updateLooping() {
  if (!playing) return;
  const one = queue().length <= 1;
  if (playing.src.loop === one) return;
  playing.src.loop = one;
  const tr = playing.user ? undefined : TRACKS[playing.id as TrackId];
  if (one && tr && tr.loopStart > 0 && tr.loopStart < playing.buf.duration) {
    playing.src.loopStart = tr.loopStart;
    playing.src.loopEnd = playing.buf.duration;
  }
}

function fadeOut(fade = FADE) {
  if (!playing || !ctx) return;
  const { src, gain } = playing;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + fade);
  src.stop(t + fade + 0.05);
  playing = null;
}

/** A short piece over the music (victory, defeat): the music dips under it, then comes back. */
export function playSting(id: StingId): void {
  if (!ctx || !sfxBus) return;
  if (!prefs.music && !prefs.sound) return;
  void load(stingUrl(id), sfxBuffers).then((buf) => {
    if (!buf || !ctx || !sfxBus || !musicBus) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = STINGS[id];
    // a sting is music: it follows the music volume, or the effects volume when music is off
    src.connect(g).connect(prefs.music ? musicBus : sfxBus);
    if (playing) {
      // it shares the music bus, so dip the loop itself, not the bus
      const loop = playing.gain;
      const lv = (playing.user ? undefined : TRACKS[playing.id as TrackId])?.volume ?? 0.8;
      const t = ctx.currentTime;
      loop.gain.cancelScheduledValues(t);
      loop.gain.setValueAtTime(loop.gain.value, t);
      loop.gain.linearRampToValueAtTime(lv * DUCK, t + 0.3);
      loop.gain.setValueAtTime(lv * DUCK, t + buf.duration);
      loop.gain.linearRampToValueAtTime(lv, t + buf.duration + 2);
    }
    src.start();
  });
}

/** For checks and debugging: the track playing now. */
export const currentTrack = (): string | null => playing?.id ?? null;

let started = false;
/** Listen for the first gesture, prefs changes and the page being hidden. Call once at startup. */
export function initSound(): void {
  if (started || !supported()) return;
  started = true;
  const onGesture = () => unlock();
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });
  onPlaylistChange(() => {
    void syncMusic();
    emit();
  });
  bus.on("prefs:changed", (p) => {
    prefs = p;
    applyLevels();
    void syncMusic();
    emit();
  });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.visibilityState === "hidden") void ctx.suspend();
    else void ctx.resume();
  });
}
