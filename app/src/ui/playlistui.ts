// Settings -> Sound -> Music playlist: switch any song off, add your own, say where each of yours plays.
import { TRACKS } from "../audio/manifest";
import {
  MAX_SONGS, addSongFile, isBuiltinOn, onPlaylistChange, patchSong, playlist, removeSongFile, sceneOf, setBuiltinOn, trackLabel,
} from "../audio/playlist";
import { musicState, onMusicChange } from "../audio/sound";
import { button } from "./components";
import { html, setHTML, type Raw } from "./html";
import { here } from "../shell/platform";

const row = (id: string, on: boolean, name: string, tag: string, extra: Raw | "" = "") =>
  html`<li class="pl-row${on ? "" : " is-off"}"><label class="pl-switch"><input type="checkbox" role="switch" data-pl-toggle="${id}" ${on ? "checked" : ""} aria-label="Play ${name}">
    <span class="switch-track" aria-hidden="true"></span></label>
    <span class="pl-name">${name}<span class="muted pl-tag">${tag}</span></span>${extra}</li>`;

function body(note: string): Raw {
  const st = playlist();
  const builtin = Object.keys(TRACKS).map((id) => row(id, isBuiltinOn(id), trackLabel(id), sceneOf(id) === "combat" ? "Fights" : "Exploring"));
  const mine = st.songs.map((s) =>
    row(s.id, s.enabled, s.name, "Yours", html`<select data-pl-scene="${s.id}" aria-label="Where ${s.name} plays">
        <option value="any" ${s.scene === "any" ? "selected" : ""}>Everywhere</option>
        <option value="explore" ${s.scene === "explore" ? "selected" : ""}>Exploring</option>
        <option value="combat" ${s.scene === "combat" ? "selected" : ""}>Fights</option></select>
      ${button("Remove", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-pl-remove="${s.id}" aria-label="Remove ${s.name}"` })}`));
  const m = musicState();
  return html`<h3 class="pl-head">Playlist</h3>
    <p class="muted set-note">Switch off any song you don't want to hear. With several on, they play one after another, and the rail's skip buttons move through the ones that are on.</p>
    <p class="set-note" role="status">${m.enabled ? (m.track ? html`Now playing: <strong>${trackLabel(m.track)}</strong>${m.paused ? " (paused)" : ""}` : "Nothing is playing.") : "Music is off."}</p>
    <ul class="pl-list">${builtin}${mine}</ul>
    <div class="step-actions">
      ${button("Add your own songs…", { icon: "upload", attrs: html`data-pl-add` })}
      <input type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac,.opus" multiple hidden data-pl-file>
    </div>
    <p class="muted set-note">Your songs stay in ${here()} (up to ${MAX_SONGS}, 40 MB each) and are not part of backups. A fight uses the fight songs that are on, and yours play where you say.</p>
    ${note ? html`<p class="warn" role="status">${note}</p>` : ""}`;
}

/** Fills the host and keeps it current while the page is up. Returns a stop function. */
export function renderPlaylist(host: HTMLElement): () => void {
  let note = "";
  const draw = () => setHTML(host, body(note));
  const change = (e: Event) => {
    const el = e.target as HTMLInputElement & HTMLSelectElement;
    if (el.dataset.plToggle) {
      const id = el.dataset.plToggle;
      if (id in TRACKS) setBuiltinOn(id, el.checked);
      else patchSong(id, { enabled: el.checked });
    } else if (el.dataset.plScene) patchSong(el.dataset.plScene, { scene: el.value as "any" | "explore" | "combat" });
    else if (el.matches("[data-pl-file]")) {
      const files = [...(el.files ?? [])];
      el.value = "";
      void (async () => {
        const problems: string[] = [];
        for (const f of files) {
          const why = await addSongFile(f);
          if (why) problems.push(why);
        }
        note = problems.join(" ");
        draw();
      })();
    }
  };
  const click = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-pl-add]")) host.querySelector<HTMLInputElement>("[data-pl-file]")?.click();
    const rm = t.closest<HTMLElement>("[data-pl-remove]");
    if (rm) void removeSongFile(rm.dataset.plRemove!);
  };
  host.addEventListener("change", change);
  host.addEventListener("click", click);
  const offs = [onPlaylistChange(draw), onMusicChange(() => { if (!host.contains(document.activeElement)) draw(); })];
  draw();
  return () => {
    host.removeEventListener("change", change);
    host.removeEventListener("click", click);
    offs.forEach((f) => f());
  };
}
