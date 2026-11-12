// Settings page: dice looks/colours/D66 tens die, theme and backdrop prefs, map tiles and view, text size, sound,
// books (unlock from your own PDF, lock) and data backup.
import { gk, isVoid } from "./games";
import type { ToolContext } from "./main";
import { LOOKS, PRESETS, dieName, getSettings, lookById, rollDice, saveSettings, swatch, type DiceSettings, type DieStyle } from "./dice3d";
import { bus } from "./shell/events";
import { reloadWithToast } from "./shell/shell";
import { resetAchievements } from "./shell/achievements";
import { getPrefs, setPrefs, type Prefs } from "./shell/prefs";
import { playSfx } from "./audio/sound";
import { AUTO_PAIR, THEMES, applyTheme, backdropUrl, themeById, type Theme } from "./themes";
import { renderMap, type DungeonMap } from "./tools/dmap";
import { TILESETS, getMapView, getTileSetId, setMapView, setTileSetId, type MapView } from "./tools/dmaptiles";
import { renderBooks } from "./ui/books";
import { renderBackupCard } from "./ui/backupui";
import { renderUpdateCard } from "./ui/updateui";
import { here } from "./shell/platform";
import { renderPlaylist } from "./ui/playlistui";
import { retakeTour } from "./ui/firstrun";
import { showVoidIntro, voidUnlockNotice } from "./ui/voidintro";
import { voidLocked } from "./shell/voidgate";
import { button, card, eyebrow } from "./ui/components";
import { icon } from "./ui/icon";
import { html, setHTML, type Raw } from "./ui/html";
import { applyBackup, collectBackup, validateBackup } from "./lock/backup";
import { ValidationError } from "./lock/validate";

const get = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(gk("2d6:" + k));
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const set = (k: string, v: unknown) => {
  try {
    localStorage.setItem(gk("2d6:" + k), JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

/** Apply theme + display prefs (backdrop, transparency) + text size (at startup and when changed). */
export function applyDisplay() {
  const theme = get("theme", "auto");
  const size = get("font", 17);
  applyTheme(themeById(theme) || theme === "auto" ? theme : "auto", getPrefs());
  document.documentElement.style.setProperty("--fs", `${size}px`);
}
// "Match device" follows the OS switching between light and dark
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (get("theme", "auto") === "auto") applyDisplay();
});
// a display pref changed (here, or by an imported backup): re-apply the theme with it
bus.on("prefs:changed", () => applyDisplay());

/**
 * A theme tile's picture: the theme's backdrop image over its gradient fallback, with a palette
 * swatch on top. The image is a CSS background, so a missing file just leaves the gradient.
 */
const tileArt = (th: Theme) => {
  const { bg, panel, line, ink, accent, danger } = th.t;
  return html`<span class="tp-art" style="background-color:${bg};background-image:url('${backdropUrl(th.id)}'),radial-gradient(ellipse at 50% 0%, ${accent}38, transparent 65%),linear-gradient(180deg, ${bg}, ${panel})">
      <span class="tp-swatch" style="background:${panel};border-color:${line}">${[bg, ink, accent, danger].map((c) => html`<i style="background:${c}"></i>`)}</span></span>`;
};

/** A theme tile: backdrop thumbnail + palette swatch, then the name and blurb. */
const themeCard = (id: string, current: string) => {
  const th = id === "auto" ? null : themeById(id)!;
  const art = th ? tileArt(th) : html`<span class="tp-split">${tileArt(themeById(AUTO_PAIR[0])!)}${tileArt(themeById(AUTO_PAIR[1])!)}</span>`;
  const on = current === id;
  return html`<button type="button" class="theme-pick${on ? " on" : ""}" data-theme-pick="${id}" aria-pressed="${String(on)}">
    ${art}<span class="tp-meta"><span class="tp-name">${th ? th.name : html`${icon("sun-moon", { size: 15 })} Match device`}</span>
    <span class="tp-blurb">${th ? th.blurb : "Parchment by day, Dungeon by night"}</span></span>
    <span class="tp-check">${icon("check", { size: 14 })}</span></button>`;
};

/** A tiny sample dungeon, drawn in each tile set and view for the Map tiles pickers. */
const SAMPLE_MAP: DungeonMap = {
  w: 9, h: 6, sel: null, stairs: 2, nextId: 20, entrance: null,
  rooms: [
    { id: 1, n: 1, x: 0, y: 1, w: 4, h: 4, kind: "regular", label: isVoid() ? "Med Bay" : "Library", sub: "" },
    { id: 2, n: 2, x: 5, y: 0, w: 4, h: 4, kind: "large", label: isVoid() ? "Cargo Hold" : "Coffin Room", sub: "" },
  ],
  exits: [
    { id: 10, room: 1, side: "E", x: 4, y: 2, type: "wooden", to: 2 },
    { id: 11, room: 2, side: "S", x: 6, y: 4, type: "archway" },
  ],
};
// sized and made inert by .tp-art > .dmap (settings.css)
const previewSvg = (tiles: string, view: MapView) => renderMap(SAMPLE_MAP, 1, null, tiles, view);
const VIEWS: { id: MapView; name: string; blurb: string }[] = [
  { id: "top", name: "Top-down", blurb: "Flat, like drawing on paper. Easiest to read." },
  { id: "iso", name: "Isometric", blurb: "A 3D look: back walls stand up, front walls are cut away so you can see in." },
];
/** A map tile (tile set or view): a live preview of the sample dungeon, then the name and blurb. */
const mapPick = (attr: string, id: string, on: boolean, tiles: string, view: MapView, name: string, blurb: string) => {
  const t = TILESETS.find((x) => x.id === tiles) ?? TILESETS[0];
  return html`<button type="button" class="theme-pick${on ? " on" : ""}" ${attr}="${id}" aria-pressed="${String(on)}">
    <span class="tp-art" style="height:auto;background:${t.paper}">${previewSvg(tiles, view)}</span>
    <span class="tp-meta"><span class="tp-name">${name}</span><span class="tp-blurb">${blurb}</span></span>
    <span class="tp-check">${icon("check", { size: 14 })}</span></button>`;
};
const tilesCards = () => html`${TILESETS.map((t) => mapPick("data-tiles-pick", t.id, getTileSetId() === t.id, t.id, "top", t.name, t.blurb))}`;
const viewCards = () => html`${VIEWS.map((v) => mapPick("data-view-pick", v.id, getMapView() === v.id, getTileSetId(), v.id, v.name, v.blurb))}`;

/** An on/off switch row (a checkbox with role="switch"). */
const switchRow = (attrs: Raw, checked: boolean, label: string, hint: string) =>
  html`<label class="switch-row"><input type="checkbox" role="switch" ${attrs} ${checked ? "checked" : ""}>
    <span class="switch-track" aria-hidden="true"></span>
    <span class="switch-text"><span class="switch-label">${label}</span><span class="muted">${hint}</span></span></label>`;

const lookOptions = (current: string) => {
  const groups = [...new Set(LOOKS.map((l) => l.group))];
  return html`${groups
    .map((g) => html`<optgroup label="${g}">${LOOKS.filter((l) => l.group === g)
      .map((l) => html`<option value="${l.id}" ${l.id === current ? "selected" : ""}>${l.name}${l.pips ? " (pips)" : ""}${l.tint ? "" : " · fixed colours"}</option>`)}</optgroup>`)}`;
};

const dieChip = (d: DieStyle, big = false) => {
  const look = lookById(d.look);
  const c = swatch(d);
  const bg =
    look.id === "galaxy" ? "radial-gradient(circle at 30% 30%, #6b5bd6, #1a1240 70%)"
    : look.id === "lava" ? "radial-gradient(circle at 40% 40%, #ffb347, #c43a00 45%, #1d1714 75%)"
    : look.id === "marble" ? "linear-gradient(135deg,#ff8fb1,#ffd36e,#7fe0c3,#8fb1ff)"
    : ["gold", "silver", "copper", "weathered"].includes(look.id) ? `linear-gradient(160deg, #fff8 0%, ${c} 35%, ${c} 65%, #0005 100%)`
    : look.id === "glass" ? `linear-gradient(135deg, #fff9, ${c}cc 40%, ${c}88)`
    : c;
  const mark = look.id === "starOrb" ? "★" : look.id === "pirate" ? "☠" : look.pips ? "⚄" : "6";
  const ink = look.id === "starOrb" ? "#d81e1e" : look.id === "pirate" ? "#f5f0e1" : isLight(c) && !["galaxy", "lava"].includes(look.id) ? "#222" : "#fff";
  return html`<span class="die-chip ${big ? "big" : ""}" style="background:${bg};color:${ink}">${mark}</span>`;
};
function isLight(hex: string) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return false;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 175;
}

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "settings-page");
  let s: DiceSettings = getSettings();
  const commit = () => {
    saveSettings(s);
    draw();
  };

  const dieCard = (i: 0 | 1) => {
    const d = s.dice[i];
    const look = lookById(d.look);
    return html`<div class="die-card ${s.tens === i ? "is-tens" : ""}">
      <div class="die-card-head">${dieChip(d, true)}
        <div><strong>Die ${i + 1}</strong>
          <div class="die-role">${s.tens === i ? "Tens digit · Primary die" : "Units digit · Secondary die"}</div></div></div>
      <label class="field">Name<input data-die="${i}" data-f="name" value="${d.name}" placeholder="${look.name}"></label>
      <label class="field">Look<select data-die="${i}" data-f="look">${lookOptions(d.look)}</select></label>
      ${
        look.tint
          ? html`<label class="field">Colour<span class="color-row"><input type="color" data-die="${i}" data-f="color" value="${d.color || look.color || "#888888"}">
              ${["#b8432a", "#e9dfc7", "#202020", "#f7a21b", "#3d6bb3", "#2f8f5b", "#7b3fa0", "#e9c46a", "#c1121f", "#7fd3ff"]
                .map((c) => html`<button type="button" class="swatch" style="background:${c}" data-die="${i}" data-color="${c}" aria-label="${c}"></button>`)}</span></label>`
          : html`<p class="muted fixed-note">This look has its own fixed colours.</p>`
      }
      <label class="tens-pick"><input type="radio" name="tens" value="${i}" ${s.tens === i ? "checked" : ""}> Use as the <strong>tens</strong> digit for D66</label>
    </div>`;
  };

  let booksOff: (() => void) | undefined;
  let backupOff: (() => void) | undefined;
  let playlistOff: (() => void) | undefined;
  let updatesOff: (() => void) | undefined;
  ctx.onDispose(() => { booksOff?.(); backupOff?.(); playlistOff?.(); updatesOff?.(); });

  function draw() {
    const theme = get("theme", "auto");
    const font = get("font", 17);
    const p: Prefs = getPrefs();
    const osSolid = matchMedia("(prefers-reduced-transparency: reduce)").matches;
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow("Play")}<h1>${icon("settings", { size: 26 })}<span>Settings</span></h1></div>
      </header>
      <div class="settings-grid">
      ${card(
        html`${switchRow(html`id="s-3d"`, s.enabled, "Throw 3D dice", "Off = instant rolls, no dice thrown")}
        <label class="field size-field">Dice size<input type="range" id="s-size" min="3" max="7" step="0.25" value="${s.size}"></label>

        <h3 class="set-sub">Quick looks</h3>
        <div class="preset-row">${PRESETS.map(
          (p, i) => html`<button type="button" class="preset" data-preset="${i}">${dieChip(p.dice[0])}${dieChip(p.dice[1])}<span>${p.name}</span></button>`,
        )}</div>

        <h3 class="set-sub">Your two dice</h3>
        <div class="die-cards">${dieCard(0)}${dieCard(1)}</div>
        <p class="muted set-note">
          In a <strong>D66</strong> roll the tens die gives the first digit and the other die gives the second
          (e.g. ${dieName(s, s.tens)} 3 and ${dieName(s, 1 - s.tens)} 5 = 35).
          The tens die is also the <strong>Primary</strong> die the books talk about (room width, manoeuvre dice sets).
          Extra dice in bigger rolls alternate between the two styles.
        </p>
        <div class="step-actions">
          ${button("Test D66", { icon: "dice", variant: "primary", attrs: html`data-test="D66"` })}
          ${button("Test 2D6", { icon: "dice", variant: "primary", attrs: html`data-test="2D6"` })}
          ${button("Swap the dice", { icon: "arrow-left-right", attrs: html`data-act="swap"` })}
          ${button("Reset dice", { icon: "rotate-ccw", variant: "ghost", attrs: html`data-act="reset-dice"` })}
        </div>
        <div class="result-box" id="s-result"></div>`,
        { eyebrow: "Rolling", title: "Dice", attrs: html`data-span="2"` },
      )}

      ${card(
        html`<div class="theme-tiles">${["auto", ...THEMES.map((t) => t.id)].map((id) => themeCard(id, theme))}</div>
        <div class="switch-list">
          ${switchRow(html`data-pref="backdrop"`, p.backdrop, "Backdrop image", "The painted scene behind the panels. Off = a plain gradient in the theme's colours.")}
          ${switchRow(html`data-pref="reduceTransparency"`, p.reduceTransparency, "Reduce transparency", osSolid ? "Your device asks for reduced transparency, so panels are solid whatever this says." : "Solid panels, no frosted glass over the backdrop.")}
        </div>`,
        { eyebrow: "Look", title: "Theme & backdrop", attrs: html`data-span="2"` },
      )}

      ${card(
        html`<p class="muted set-note">How the ${isVoid() ? "Dark Hulk" : "dungeon"} map is drawn: the tile set, and a flat or 3D view. This is separate from the colour theme.</p>
        <h3 class="set-sub">Tile set</h3>
        <div class="theme-tiles" id="s-tiles" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${tilesCards()}</div>
        <h3 class="set-sub">View</h3>
        <div class="theme-tiles" id="s-views" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${viewCards()}</div>`,
        { eyebrow: "Dungeon", title: "Map tiles & view", attrs: html`data-span="2"` },
      )}

      ${card(
        html`<label class="field">Text size (${font}px)<input type="range" id="s-font" min="14" max="24" step="1" value="${font}"></label>
        <p class="muted set-note">Scales the whole app: book text, tables, panels and buttons.</p>`,
        { eyebrow: "Reading", title: "Display" },
      )}

      ${card(html`${isVoid() && voidLocked() ? voidUnlockNotice() : ""}<div id="s-books"></div>`, { eyebrow: "Your PDFs", title: "Books", attrs: html`data-span="2" id="books"` })}

      ${card(
        html`<div class="switch-list">
          ${switchRow(html`data-pref="sound"`, p.sound, "Sound effects", "Dice, blows, doors and locks, and soft clicks.")}
          ${switchRow(html`data-pref="music"`, p.music, "Music", "Quiet music that changes only for a fight or a deeper level. Choose the songs in the playlist below.")}
        </div>
        <label class="field">Effects volume<input type="range" data-vol="sfxVolume" min="0" max="1" step="0.05" value="${p.sfxVolume}"></label>
        <label class="field">Music volume<input type="range" data-vol="musicVolume" min="0" max="1" step="0.05" value="${p.musicVolume}"></label>
        <div class="step-actions">${button("Test sound", { icon: "dice", attrs: html`data-act="test-sound"` })}</div>
        <div id="s-playlist"></div>`,
        { eyebrow: "Listening", title: "Sound" },
      )}

      ${card(
        html`<p class="muted set-note">A short walk through the site: the rail, contents, tabs, the side panel, settings and backups.</p>
        <div class="step-actions">${button("Take the tour", { icon: "compass", variant: "ghost", attrs: html`data-act="tour"` })}</div>`,
        { eyebrow: "New here?", title: "Site tour" },
      )}

      ${card(html`<div id="s-updates"></div>`, { eyebrow: "Stay current", title: "Updates", attrs: html`id="updates"` })}

      ${card(html`<div id="s-autobackup"></div>`, { eyebrow: "Keep it safe", title: "Automatic backups", attrs: html`data-span="2" id="autobackup"` })}

      ${card(
        html`<p class="muted set-note">Characters, realm, dungeon progress, bookmarks, notes, the journal, results and settings are saved in ${here()} on this device. Back them up, or move them to another device, with one file.</p>
        <div class="step-actions">
          ${button("Export everything", { icon: "download", attrs: html`data-act="export-all"` })}
          ${button("Import a backup", { icon: "upload", attrs: html`data-act="import-all"` })}
          ${button("Clear play data…", { icon: "trash", variant: "danger", attrs: html`data-act="clear-play"` })}
          ${button("Reset achievements…", { icon: "trophy", variant: "danger", attrs: html`data-act="reset-ach"` })}
        </div>
        <p class="muted set-note">Clear play data removes the character, realm and dungeon progress. Bookmarks, notes, achievements and settings are kept.</p>`,
        { eyebrow: "Your data", title: "Backup", attrs: html`data-span="2"` },
      )}
      </div>`);
    // the Books card is redrawn with the page: mount it again
    booksOff?.();
    booksOff = renderBooks(root.querySelector<HTMLElement>("#s-books")!);
    playlistOff?.();
    playlistOff = renderPlaylist(root.querySelector<HTMLElement>("#s-playlist")!);
    backupOff?.();
    backupOff = renderBackupCard(root.querySelector<HTMLElement>("#s-autobackup")!);
    updatesOff?.();
    updatesOff = renderUpdateCard(root.querySelector<HTMLElement>("#s-updates")!);
  }

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-void-about]")) showVoidIntro();
    else if (t.closest('[data-act="tour"]')) retakeTour();
  });

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id === "s-size") {
      s.size = +el.value;
      saveSettings(s);
    } else if (el.dataset.vol === "sfxVolume" || el.dataset.vol === "musicVolume") {
      setPrefs({ [el.dataset.vol]: +el.value });
    } else if (el.id === "s-font") {
      set("font", +el.value);
      applyDisplay();
      el.previousSibling && ((el.parentElement!.firstChild as Text).textContent = `Text size (${el.value}px)`);
    } else if (el.dataset.die && el.dataset.f === "name") {
      s.dice[+el.dataset.die as 0 | 1].name = el.value;
      saveSettings(s);
    } else if (el.dataset.die && el.dataset.f === "color") {
      s.dice[+el.dataset.die as 0 | 1].color = el.value;
      saveSettings(s);
      const chip = el.closest(".die-card")?.querySelector(".die-chip");
      if (chip) {
        const t = document.createElement("template");
        setHTML(t, dieChip(s.dice[+el.dataset.die as 0 | 1], true));
        chip.replaceWith(t.content);
      }
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.pref) {
      // backdrop / reduceTransparency re-apply the theme via "prefs:changed"
      setPrefs({ [el.dataset.pref]: el.checked });
      return;
    }
    if (el.id === "s-3d") {
      s.enabled = el.checked;
      commit();
    } else if (el.name === "tens") {
      s.tens = +el.value as 0 | 1;
      commit();
    } else if (el.dataset.die && el.dataset.f === "look") {
      const i = +el.dataset.die as 0 | 1;
      const look = lookById(el.value);
      s.dice[i] = { ...s.dice[i], look: look.id, color: look.tint ? s.dice[i].color || look.color || "" : "" };
      if (!s.dice[i].name || LOOKS.some((l) => l.name === s.dice[i].name) || /^(Red|Ivory)$/.test(s.dice[i].name)) s.dice[i].name = look.name;
      commit();
    }
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.tilesPick || b.dataset.viewPick) {
      if (b.dataset.tilesPick) setTileSetId(b.dataset.tilesPick);
      if (b.dataset.viewPick) setMapView(b.dataset.viewPick as MapView);
      const tiles = root.querySelector("#s-tiles"), views = root.querySelector("#s-views");
      if (tiles) setHTML(tiles, tilesCards());
      if (views) setHTML(views, viewCards()); // the view previews follow the tile set
      ctx.toast(b.dataset.tilesPick ? `Map tiles: ${TILESETS.find((t) => t.id === b.dataset.tilesPick)?.name}` : `Map view: ${VIEWS.find((v) => v.id === b.dataset.viewPick)?.name}`);
      return;
    }
    if (b.dataset.themePick) {
      set("theme", b.dataset.themePick);
      applyDisplay();
      root.querySelectorAll<HTMLButtonElement>("[data-theme-pick]").forEach((x) => {
        const on = x.dataset.themePick === b.dataset.themePick;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", String(on));
      });
      return;
    }
    if (b.dataset.preset) {
      const p = PRESETS[+b.dataset.preset];
      s.dice = [{ ...p.dice[0] }, { ...p.dice[1] }];
      commit();
    } else if (b.dataset.color && b.dataset.die) {
      s.dice[+b.dataset.die as 0 | 1].color = b.dataset.color;
      commit();
    } else if (b.dataset.test) {
      b.disabled = true;
      const r = await rollDice(b.dataset.test);
      b.disabled = false;
      const out = root.querySelector("#s-result");
      if (out) setHTML(out, html`<strong>${r.label}:</strong> ${r.text}`);
    } else if (b.dataset.act === "test-sound") {
      playSfx("dice-land");
    } else if (b.dataset.act === "swap") {
      s.dice = [s.dice[1], s.dice[0]];
      s.tens = (1 - s.tens) as 0 | 1;
      commit();
    } else if (b.dataset.act === "reset-dice") {
      s = { ...getSettings(), dice: [{ look: "classic", color: "#b8432a", name: "Red" }, { look: "classic", color: "#e9dfc7", name: "Ivory" }], tens: 0, size: 4.5 };
      commit();
    } else if (b.dataset.act === "export-all") {
      const { data, omitted } = collectBackup(localStorage); // both games ("2d6:" and Void's "2d6v:"), never book content
      if (omitted.length) alert(`These items are too large for a backup and were left out: ${omitted.join(", ")}`);
      const blob = new Blob([JSON.stringify({ app: "2d6-companion", saved: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `2d6-companion-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (b.dataset.act === "import-all") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = async () => {
        try {
          const f = input.files?.[0];
          if (!f) return;
          const j = validateBackup(JSON.parse(await f.text()));
          if (!confirm("Replace this device's characters, realm, progress and settings with the backup?")) return;
          const done = applyBackup(localStorage, j.data);
          if (done !== "ok") return void alert(done === "restored" ? "Couldn't restore the backup (storage full). Nothing was changed." : "Couldn't fully restore your previous data after the backup failed (storage full). Check your characters and realm, or import a backup again.");
          // open tabs, panels and in-memory stores still hold the old data: start again from storage
          reloadWithToast("Backup restored.");
        } catch (e) {
          alert(e instanceof ValidationError ? `That file isn't a 2D6 Companion backup (problem at "${e.path}").` : "That file isn't a 2D6 Companion backup.");
        }
      };
      input.click();
    } else if (b.dataset.act === "clear-play") {
      if (!confirm("Delete your character, realm and dungeon progress on this device? This can't be undone (export first to keep a copy).")) return;
      // this game's play data only
      const prefix = gk("2d6:play:");
      for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
      // open Sheet/Dungeon/Realm/Combat tabs would save their old state again: start from storage
      reloadWithToast("Play data cleared.");
    } else if (b.dataset.act === "reset-ach") {
      if (!confirm("Reset all achievements and their progress on this device? This can't be undone (export first to keep a copy).")) return;
      resetAchievements();
      reloadWithToast("Achievements reset.");
    }
  });

  // another Settings tab (or an imported backup) changed a pref: keep these switches in step
  ctx.onDispose(
    bus.on("prefs:changed", (p) => {
      root.querySelectorAll<HTMLInputElement>("input[data-pref]").forEach((el) => {
        el.checked = p[el.dataset.pref as "backdrop" | "reduceTransparency" | "sound" | "music"];
      });
      root.querySelectorAll<HTMLInputElement>("input[data-vol]").forEach((el) => {
        if (document.activeElement !== el) el.value = String(p[el.dataset.vol as "sfxVolume" | "musicVolume"]);
      });
    }),
  );
  draw();
}
