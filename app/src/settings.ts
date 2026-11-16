// Settings page: dice looks/colours/D66 tens die, theme and backdrop prefs, map tiles and view, text size, sound,
// books (unlock from your own PDF, lock) and data backup.
import { gk, isVoid } from "./games";
import type { ToolContext } from "./main";
import { DEFAULT_SETTINGS, LOOKS, PRESETS, dieName, getSettings, lookById, rollDice, saveSettings, swatch, type DiceSettings, type DieStyle } from "./dice3d";
import { bus } from "./shell/events";
import { reloadWithToast } from "./shell/shell";
import { resetAchievements } from "./shell/achievements";
import { getPrefs, setPrefs, type Prefs } from "./shell/prefs";
import { defaultPack, FACES, PACKS, ROLES, applyFonts, cleanChoice, faceById, packById, resolveFonts, type Role } from "./fonts";
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
import { arrangeBars, resetBars } from "./shell/bottombar";
import { beginTutorial, tutorialFor, tutorialRunning } from "./tutorial/run";
import { showVoidIntro, voidUnlockNotice } from "./ui/voidintro";
import { voidLocked } from "./shell/voidgate";
import { button, card } from "./ui/components";
import { icon, type IconName } from "./ui/icon";
import { SECTION_KEY } from "./ui/settingsnav";
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
  applyFonts(fontChoice());
}
/** This game's saved typeface choice: a pack, plus any single roles the player changed. */
const fontChoice = () => cleanChoice(get("fontpack", defaultPack()), get("fonts", {}));

/** The font card: pick a pack, or customise headings, book text and interface one by one. */
function fontsCard(): Raw {
  const c = fontChoice(), now = resolveFonts(c);
  const customised = Object.keys(c.overrides).length > 0;
  const sample = (r: Role) => `font-family:${faceById(now[r])!.stack}`;
  return html`<div class="font-tiles">${PACKS.map((p) => {
      const on = p.id === c.pack && !customised;
      const f = p.fonts;
      return html`<button type="button" class="font-tile${on ? " on" : ""}" data-fontpack="${p.id}" aria-pressed="${String(on)}">
        <span class="ft-head" style="font-family:${faceById(f.display)!.stack}">${p.name}</span>
        <span class="ft-body" style="font-family:${faceById(f.read)!.stack}">The quick brown fox jumps over the lazy dog. 2D6</span>
        <span class="ft-blurb">${p.blurb}</span></button>`;
    })}</div>
    <details class="font-custom"${customised ? html` open` : ""}><summary>Customise</summary>
      <p class="muted set-note">Change one part and leave the rest on the pack. "Follow the pack" uses ${packById(c.pack).name}'s choice.</p>
      <div class="grid">${ROLES.map((r) => html`<label class="field">${r.label} <span class="muted">· ${r.hint}</span>
        <select data-fontrole="${r.id}"><option value="">Follow the pack (${faceById(packById(c.pack).fonts[r.id])!.name})</option>${FACES.map((f) => html`<option value="${f.id}"${c.overrides[r.id] === f.id ? html` selected` : ""}>${f.name}</option>`)}</select></label>`)}</div>
      <div class="font-sample"><strong style="${sample("display")}">Heading sample</strong><p style="${sample("read")}">Book text sample: the quick brown fox jumps over the lazy dog.</p><p style="${sample("ui")}">Interface sample: Roll 2D6 · Save · Cancel</p></div>
      ${customised ? html`<div class="step-actions">${button("Back to the pack", { icon: "rotate-ccw", variant: "ghost", size: "sm", attrs: html`data-act="font-reset"` })}</div>` : ""}
    </details>`;
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
const previewSvg = (tiles: string, view: MapView) => renderMap(SAMPLE_MAP, 1, null, tiles, view, { roomNumbers: !isVoid() });
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
  const celestial = look.id === "sunCore" || look.id === "moonCore";
  if (celestial) {
    const sun = look.id === "sunCore";
    return html`<span class="die-chip celestial-chip ${big ? "big" : ""}" style="background:${bg};color:${sun ? "#fff0a6" : "#d5e8ff"}" aria-hidden="true"><span>${sun ? "☀" : "☾"}</span></span>`;
  }
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

/** Settings' sections, in the side menu's order. Each card names its section (data-sec). */
const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: "books", label: "Books", icon: "book" },
  { id: "dice", label: "Dice", icon: "dice" },
  { id: "look", label: "Look", icon: "palette" },
  { id: "map", label: "Map", icon: "map" },
  { id: "bars", label: "Top bars", icon: "grip-vertical" },
  { id: "sound", label: "Sound", icon: "play" },
  { id: "learn", label: "Learn", icon: "compass" },
  { id: "data", label: "Backups", icon: "download" },
  { id: "updates", label: "Updates", icon: "rotate-ccw" },
];
const isSection = (v: unknown): v is string => typeof v === "string" && SECTIONS.some((x) => x.id === v);

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "settings-page");
  // the section on show: the one picked this visit; a locked Void opens on Books (it is there to unlock)
  let section = (() => {
    if (isVoid() && voidLocked()) return "books";
    try {
      const v = sessionStorage.getItem(SECTION_KEY);
      return isSection(v) ? v : SECTIONS[0].id;
    } catch {
      return SECTIONS[0].id;
    }
  })();
  const showSection = () => {
    for (const el of root.querySelectorAll<HTMLElement>(".settings-grid > [data-sec]")) el.hidden = el.dataset.sec !== section;
    for (const b of root.querySelectorAll<HTMLElement>("[data-set-nav]")) b.setAttribute("aria-current", b.dataset.setNav === section ? "page" : "false");
    // narrow screens: the menu is a sideways row; keep the current chip in view (without scrolling the page)
    const nav = root.querySelector<HTMLElement>(".settings-nav");
    const cur = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - nav.offsetLeft - 8;
  };
  let s: DiceSettings = getSettings();
  const commit = () => {
    saveSettings(s);
    draw();
  };

  // dice 0 and 1 are Die 1 (Primary) and Die 2 (Secondary); 2 is the D66 tens die
  type DieIx = 0 | 1 | 2;
  const dieAt = (i: DieIx): DieStyle => (i === 2 ? s.tensDie : s.dice[i]);
  const setDie = (i: DieIx, d: DieStyle) => (i === 2 ? (s.tensDie = d) : (s.dice[i] = d));
  const ROLE = ["Primary die · D66 units", "Secondary die", "D66 tens digit only"];
  const dieCard = (i: DieIx) => {
    const d = dieAt(i);
    const look = lookById(d.look);
    return html`<div class="die-card ${i === 2 ? "is-tens" : ""}">
      <div class="die-card-head">${dieChip(d, true)}
        <div><strong>${i === 2 ? "Tens die" : `Die ${i + 1}`}</strong>
          <div class="die-role">${ROLE[i]}</div></div></div>
      <label class="field">Name<input data-die="${i}" data-f="name" value="${d.name}" placeholder="${look.name}"></label>
      <label class="field">Look<select data-die="${i}" data-f="look">${lookOptions(d.look)}</select></label>
      ${
        look.tint
          ? html`<label class="field">Colour<span class="color-row"><input type="color" data-die="${i}" data-f="color" value="${d.color || look.color || "#888888"}">
              ${["#b8432a", "#e9dfc7", "#202020", "#f7a21b", "#3d6bb3", "#2f8f5b", "#7b3fa0", "#e9c46a", "#c1121f", "#7fd3ff"]
                .map((c) => html`<button type="button" class="swatch" style="background:${c}" data-die="${i}" data-color="${c}" aria-label="${c}"></button>`)}</span></label>`
          : html`<p class="muted fixed-note">This look has its own fixed colours.</p>`
      }
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
        <div class="play-title"><h1>${icon("settings", { size: 26 })}<span>Settings</span></h1></div>
      </header>
      <div class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">${SECTIONS.map((x) =>
        html`<button type="button" class="settings-nav-btn" data-set-nav="${x.id}" aria-current="${x.id === section ? "page" : "false"}">${icon(x.icon, { size: 17 })}<span>${x.label}</span></button>`)}</nav>
      <div class="settings-grid">
      ${card(
        html`${switchRow(html`id="s-3d"`, s.enabled, "Throw 3D dice", "Off = instant rolls, no dice thrown")}
        <label class="field size-field">Dice size<input type="range" id="s-size" min="3" max="7" step="0.25" value="${s.size}"></label>

        <h3 class="set-sub">Quick looks</h3>
        <div class="preset-row">${PRESETS.map(
          (p, i) => html`<button type="button" class="preset" data-preset="${i}">${dieChip(p.dice[0])}${dieChip(p.dice[1])}<span>${p.name}</span></button>`,
        )}</div>

        <h3 class="set-sub">Your dice</h3>
        <div class="die-cards">${dieCard(0)}${dieCard(1)}${dieCard(2)}</div>
        <p class="muted set-note">
          <strong>Die 1</strong> and <strong>Die 2</strong> are thrown for every D6 and 2D6 roll, and may look the same.
          Die 1 is the <strong>Primary</strong> die the books talk about (room width, manoeuvre dice sets).
          A <strong>D66</strong> throws the <strong>tens die</strong> for the first digit and Die 1 for the second
          (e.g. ${dieName(s, 2)} 3 and ${dieName(s, 0)} 5 = 35). If the tens die is set to look like Die 1,
          it is thrown in a contrasting colour or partner skin so the two can always be told apart.
        </p>
        <div class="step-actions">
          ${button("Test D66", { icon: "dice", variant: "primary", attrs: html`data-test="D66"` })}
          ${button("Test 2D6", { icon: "dice", variant: "primary", attrs: html`data-test="2D6"` })}
          ${button("Swap dice 1 and 2", { icon: "arrow-left-right", attrs: html`data-act="swap"` })}
          ${button("Reset dice", { icon: "rotate-ccw", variant: "ghost", attrs: html`data-act="reset-dice"` })}
        </div>
        <div class="result-box" id="s-result"></div>`,
        { eyebrow: "Rolling", title: "Dice", attrs: html`data-span="2" data-sec="dice"` },
      )}

      ${card(
        html`<div class="theme-tiles">${["auto", ...THEMES.map((t) => t.id)].map((id) => themeCard(id, theme))}</div>
        <div class="switch-list">
          ${switchRow(html`data-pref="backdrop"`, p.backdrop, "Backdrop image", "The painted scene behind the panels. Off = a plain gradient in the theme's colours.")}
          ${switchRow(html`data-pref="reduceTransparency"`, p.reduceTransparency, "Reduce transparency", osSolid ? "Your device asks for reduced transparency, so panels are solid whatever this says." : "Solid panels, no frosted glass over the backdrop.")}
        </div>`,
        { eyebrow: "Look", title: "Theme & backdrop", attrs: html`data-span="2" data-sec="look"` },
      )}

      ${card(
        html`<p class="muted set-note">How the ${isVoid() ? "Dark Hulk" : "dungeon"} map is drawn: the tile set, and a flat or 3D view. This is separate from the colour theme.</p>
        <h3 class="set-sub">Tile set</h3>
        <div class="theme-tiles" id="s-tiles" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${tilesCards()}</div>
        <h3 class="set-sub">View</h3>
        <div class="theme-tiles" id="s-views" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${viewCards()}</div>`,
        { eyebrow: "Dungeon", title: "Map tiles & view", attrs: html`data-span="2" data-sec="map"` },
      )}

      ${card(
        html`<label class="field">Text size (${font}px)<input type="range" id="s-font" min="14" max="24" step="1" value="${font}"></label>
        <p class="muted set-note">Scales the whole app: book text, tables, panels and buttons.</p>`,
        { eyebrow: "Reading", title: "Display", attrs: html`data-span="2" data-sec="look"` },
      )}

      ${card(fontsCard(), { eyebrow: "Reading", title: "Fonts", attrs: html`data-span="2" data-sec="look"` })}

      ${card(html`${isVoid() && voidLocked() ? voidUnlockNotice() : ""}<div id="s-books"></div>`, { eyebrow: "Your PDFs", title: "Books", attrs: html`data-span="2" id="books" data-sec="books"` })}

      ${card(
        html`<div class="switch-list">
          ${switchRow(html`data-pref="sound"`, p.sound, "Sound effects", "Dice, blows, doors and locks, and soft clicks.")}
          ${switchRow(html`data-pref="music"`, p.music, "Music", "Quiet music that changes only for a fight or a deeper level. Choose the songs in the playlist below.")}
        </div>
        <label class="field">Effects volume<input type="range" data-vol="sfxVolume" min="0" max="1" step="0.05" value="${p.sfxVolume}"></label>
        <label class="field">Music volume<input type="range" data-vol="musicVolume" min="0" max="1" step="0.05" value="${p.musicVolume}"></label>
        <div class="step-actions">${button("Test sound", { icon: "dice", attrs: html`data-act="test-sound"` })}</div>
        <div id="s-playlist"></div>`,
        { eyebrow: "Listening", title: "Sound", attrs: html`data-span="2" data-sec="sound"` },
      )}

      ${card(
        html`<p class="muted set-note">The character name and the stats (HP, XP, Shift, Fatigue) are two groups.
          Put each on the top bar beside the game logos or on the bar below it, in any order. With both on top, the lower bar goes away.
          (On screens under 900px wide they stay in their compact phone layout.)</p>
        <div class="step-actions">${button("Arrange the bars", { icon: "grip-vertical", variant: "primary", attrs: html`data-act="arrange-bars"` })}${button("Reset", { icon: "rotate-ccw", variant: "ghost", attrs: html`data-act="reset-bars"` })}</div>`,
        { eyebrow: "Layout", title: "Top bars", attrs: html`data-span="2" data-sec="bars"` },
      )}

      ${card(
        html`<p class="muted set-note">A short walk through the site: the rail, contents, tabs, the side panel, settings and backups.</p>
        <div class="step-actions">${button("Take the tour", { icon: "compass", variant: "ghost", attrs: html`data-act="tour"` })}</div>`,
        { eyebrow: "New here?", title: "Site tour", attrs: html`data-sec="learn"` },
      )}

      ${card(
        html`<p class="muted set-note">${isVoid()
          ? "A guided first game: make a survivor, enter the Dark Hulk and play the first three rooms, with links to every rule as you meet it. It plays as a separate tutorial survivor, so your own characters aren't touched."
          : "A guided first game: meet your adventurer, enter the dungeon and play the first three rooms, including a fight, with links to every rule as you meet it. It plays as a separate tutorial adventurer, so your own characters aren't touched."}</p>
        ${tutorialFor() && isVoid() && voidLocked() ? html`<p class="muted set-note">Unlock 2D6 Void with your rulebook (Books, above) to take it.</p>` : ""}
        ${tutorialRunning() ? html`<p class="muted set-note">The tutorial is running: its card is at the bottom of the screen.</p>` : ""}
        <div class="step-actions">${button("Start the tutorial", { icon: "compass", variant: "ghost", attrs: html`data-act="tutorial"${tutorialFor() && !tutorialRunning() && !(isVoid() && voidLocked()) ? "" : " disabled"}` })}</div>`,
        { eyebrow: "Learn to play", title: "Gameplay tutorial", attrs: html`data-sec="learn"` },
      )}

      ${card(html`<div id="s-updates"></div>`, { eyebrow: "Stay current", title: "Updates", attrs: html`data-span="2" id="updates" data-sec="updates"` })}

      ${card(html`<div id="s-autobackup"></div>`, { eyebrow: "Keep it safe", title: "Automatic backups", attrs: html`data-span="2" id="autobackup" data-sec="data"` })}

      ${card(
        html`<p class="muted set-note">Characters, realm, dungeon progress, bookmarks, notes, the journal, results and settings are saved in ${here()} on this device. Back them up, or move them to another device, with one file.</p>
        <div class="step-actions">
          ${button("Export everything", { icon: "download", attrs: html`data-act="export-all"` })}
          ${button("Import a backup", { icon: "upload", attrs: html`data-act="import-all"` })}
          ${button("Clear play data…", { icon: "trash", variant: "danger", attrs: html`data-act="clear-play"` })}
          ${button("Reset achievements…", { icon: "trophy", variant: "danger", attrs: html`data-act="reset-ach"` })}
        </div>
        <p class="muted set-note">Clear play data resets the character you are playing now: their sheet, realm and dungeon progress. Their journal and notes, your other characters (see Characters), bookmarks, achievements and settings are kept.</p>`,
        { eyebrow: "Your data", title: "Backup", attrs: html`data-span="2" data-sec="data"` },
      )}
      </div>
      </div>`);
    showSection();
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
    else if (t.closest('[data-act="arrange-bars"]')) arrangeBars();
    else if (t.closest('[data-act="reset-bars"]')) {
      resetBars();
      ctx.toast("Bars reset: the character and stats on top, the dice below.");
    }
    else if (t.closest('[data-act="tutorial"]')) void beginTutorial().then((ok) => !ok && ctx.toast("Couldn't start the tutorial: this browser's storage is full or blocked."));
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
      dieAt(+el.dataset.die as DieIx).name = el.value;
      saveSettings(s);
    } else if (el.dataset.die && el.dataset.f === "color") {
      dieAt(+el.dataset.die as DieIx).color = el.value;
      saveSettings(s);
      const chip = el.closest(".die-card")?.querySelector(".die-chip");
      if (chip) {
        const t = document.createElement("template");
        setHTML(t, dieChip(dieAt(+el.dataset.die as DieIx), true));
        chip.replaceWith(t.content);
      }
    }
  });
  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.fontrole) {
      const c = fontChoice();
      const next = { ...c.overrides };
      if (el.value) next[el.dataset.fontrole as Role] = el.value;
      else delete next[el.dataset.fontrole as Role];
      set("fonts", next);
      applyDisplay();
      draw();
      return;
    }
    if (el.dataset.pref) {
      // backdrop / reduceTransparency re-apply the theme via "prefs:changed"
      setPrefs({ [el.dataset.pref]: el.checked });
      return;
    }
    if (el.id === "s-3d") {
      s.enabled = el.checked;
      commit();
    } else if (el.dataset.die && el.dataset.f === "look") {
      const i = +el.dataset.die as DieIx;
      const look = lookById(el.value);
      const d = { ...dieAt(i), look: look.id, color: look.tint ? dieAt(i).color || look.color || "" : "" };
      if (!d.name || LOOKS.some((l) => l.name === d.name) || /^(Red|Ivory|Gold)$/.test(d.name)) d.name = look.name;
      setDie(i, d);
      commit();
    }
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.setNav) {
      section = b.dataset.setNav;
      try {
        sessionStorage.setItem(SECTION_KEY, section);
      } catch {
        /* this visit only anyway */
      }
      showSection();
      root.closest<HTMLElement>(".tab-page")?.scrollTo({ top: 0 });
      return;
    }
    if (b.dataset.tilesPick || b.dataset.viewPick) {
      if (b.dataset.tilesPick) setTileSetId(b.dataset.tilesPick);
      if (b.dataset.viewPick) setMapView(b.dataset.viewPick as MapView);
      const tiles = root.querySelector("#s-tiles"), views = root.querySelector("#s-views");
      if (tiles) setHTML(tiles, tilesCards());
      if (views) setHTML(views, viewCards()); // the view previews follow the tile set
      ctx.toast(b.dataset.tilesPick ? `Map tiles: ${TILESETS.find((t) => t.id === b.dataset.tilesPick)?.name}` : `Map view: ${VIEWS.find((v) => v.id === b.dataset.viewPick)?.name}`);
      return;
    }
    if (b.dataset.fontpack || b.dataset.act === "font-reset") {
      if (b.dataset.fontpack) set("fontpack", b.dataset.fontpack);
      set("fonts", {}); // a pack is a fresh start; "back to the pack" keeps the pack and drops the overrides
      applyDisplay();
      draw();
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
      dieAt(+b.dataset.die as DieIx).color = b.dataset.color;
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
      commit();
    } else if (b.dataset.act === "reset-dice") {
      s = { ...getSettings(), dice: [{ ...DEFAULT_SETTINGS.dice[0] }, { ...DEFAULT_SETTINGS.dice[1] }], tensDie: { ...DEFAULT_SETTINGS.tensDie }, tens: 0, size: DEFAULT_SETTINGS.size };
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
      if (!confirm("Reset the character you are playing now (their sheet, realm and dungeon progress)? Your other characters are kept. This can't be undone (export first to keep a copy).")) return;
      // this game's play data, active character only ("2d6:play:" is scoped by games.ts keyFor)
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
