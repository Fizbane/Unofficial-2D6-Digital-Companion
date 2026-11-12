// Digital character sheet for 2D6 Dungeon (fields and rules from docs/spec-dungeon.md §2).
import type { ToolContext } from "../main";
import { rollDice } from "../dice3d";
import { tableBySection } from "../rolltable";
import { makeCardsArrangeable } from "../shell/arrangecards";
import { bus } from "../shell/events";
import { rollAndLog } from "../shell/panels/results";
import { exportJSON, importJSON, load, save, stepper, wireSteppers } from "./common";
import { button, card, eyebrow, statBlock } from "../ui/components";
import { icon } from "../ui/icon";
import { applyXp, importedLastLevel, levelChangeText, setPortrait } from "../shell/charmodel";
import { playSfx } from "../audio/sound";
import { charHeader, portrait } from "../shell/panels/charcard";
import { portraitFromFile, portraitFromUrl } from "../ui/picture";
import { PORTRAITS, portraitUrl } from "../ui/portraits";
import { html, type Raw, setHTML } from "../ui/html";
import { arr, bool, jsonValue, num, obj, opt, str } from "../lock/validate";
import { here } from "../shell/platform";

export const LEVELS = [
  { title: "Raw", man: 2, maxMan: 1, next: 100, shift: 2, disc: 1, prec: 0, hp: 10 },
  { title: "Novice", man: 2, maxMan: 1, next: 500, shift: 2, disc: 1, prec: 1, hp: 20 },
  { title: "Apprentice", man: 2, maxMan: 1, next: 1000, shift: 2, disc: 2, prec: 1, hp: 30 },
  { title: "Skilful", man: 2, maxMan: 2, next: 2000, shift: 2, disc: 2, prec: 2, hp: 40 },
  { title: "Experienced", man: 2, maxMan: 2, next: 3000, shift: 3, disc: 3, prec: 2, hp: 50 },
  { title: "Adept", man: 3, maxMan: 2, next: 5000, shift: 3, disc: 3, prec: 3, hp: 60 },
  { title: "Accomplished", man: 3, maxMan: 2, next: 10000, shift: 3, disc: 3, prec: 4, hp: 70 },
  { title: "Expert", man: 3, maxMan: 3, next: 15000, shift: 3, disc: 4, prec: 4, hp: 80 },
  { title: "Professional", man: 3, maxMan: 3, next: 25000, shift: 4, disc: 4, prec: 4, hp: 90 },
  { title: "Master", man: 3, maxMan: 3, next: Infinity, shift: 4, disc: 5, prec: 5, hp: 100 },
];
export const GODS = ["Grakada the Core", "Intuneric the Murk", "Maduva the Rot", "Murataynie the Pulp", "Nevazator the Blind", "Radacina the Radix"];
const WEAPONS = ["Longsword", "Greataxe", "Heavy Mace"];
const STARTING_ARMOUR = [
  ["Jerkin", "[4]", "-1 Damage"],
  ["Padded Tunic", "[5]", "-1 Damage"],
  ["Quilted Coat", "[3]", "-1 Damage"],
  ["Hide Doublet", "[2]", "-1 Damage"],
];
const STARTING_SCROLLS = ["BALANCE", "MENTAL WHIP", "REFLEXES", "MELT METAL"];

export interface Character {
  name: string;
  weapon: string;
  xp: number;
  hp: number;
  bonusHp: number; // permanent baseline bonuses (e.g. Kaladear gift +5)
  bonusShift: number;
  bonusDisc: number;
  bonusPrec: number;
  runes: string;
  manoeuvres: string[][]; // [name, dice, modifier]
  armour: string[][]; // [piece, dice, modifier]
  scrolls: string[][]; // [scroll, orbit, dispel, effect]
  potions: string[][]; // [potion, effect]
  legend: boolean[];
  bloodied: number;
  soaked: number;
  gc: number;
  sc: number;
  cc: number;
  treasure: string;
  prisoners: number;
  quests: string;
  favour: number[];
  narrative: string;
  large: string[];
  notes: string;
  rations: number;
  small: string;
  lockup: string;
  lastLevel: number;
  portrait?: string; // a square JPEG data: URL (256×256), set from the sheet's Identity card
}

const text = str(20000);
const n = num({ min: -1e9, max: 1e9 });
const rows = (cols: number) => arr(arr(text, cols), 100);
/** A character from untrusted JSON. Every field is optional (an older export lacks newer ones; the sheet fills them in), every present one is checked. */
const characterShape = obj<Partial<Character>>(
  {
    name: opt(str(200)), weapon: opt(str(200)), xp: opt(n), hp: opt(n), bonusHp: opt(n), bonusShift: opt(n), bonusDisc: opt(n), bonusPrec: opt(n),
    runes: opt(text), manoeuvres: opt(rows(6)), armour: opt(rows(6)), scrolls: opt(rows(6)), potions: opt(rows(6)),
    legend: opt(arr(bool, 100)), bloodied: opt(n), soaked: opt(n), gc: opt(n), sc: opt(n), cc: opt(n), treasure: opt(text), prisoners: opt(n),
    quests: opt(text), favour: opt(arr(n, 100)), narrative: opt(text), large: opt(arr(text, 100)), notes: opt(text), rations: opt(n),
    small: opt(text), lockup: opt(text), lastLevel: opt(n),
    portrait: opt(str(400000, /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]*$/)),
  },
  { extra: true, rest: jsonValue(6) },
);
export const validateCharacter = (x: unknown): Partial<Character> => characterShape(x, "character");

export function blankCharacter(): Character {
  return {
    name: "",
    weapon: "Longsword",
    xp: 0,
    hp: 10,
    bonusHp: 0,
    bonusShift: 0,
    bonusDisc: 0,
    bonusPrec: 0,
    runes: "",
    manoeuvres: [["", "", ""], ["", "", ""], ["", "", ""]],
    armour: [["", "", ""], ["", "", ""], ["", "", ""]],
    scrolls: [["", "", "", ""], ["", "", "", ""], ["", "", "", ""]],
    potions: [["Potion of Healing", "Heals up to 10 HP (not above baseline)"], ["", ""], ["", ""], ["", ""], ["", ""]],
    legend: Array(10).fill(false),
    bloodied: 0,
    soaked: 0,
    gc: 0,
    sc: 0,
    cc: 0,
    treasure: "",
    prisoners: 0,
    quests: "",
    favour: Array(6).fill(0),
    narrative: "",
    large: Array(10).fill(""),
    notes: "",
    rations: 3,
    small: "Flint and steel, lantern, pouch, wax sealing kit, large backpack",
    lockup: "",
    lastLevel: 1,
  };
}

export const loadChar = () => load<Character>("character", blankCharacter());
/** Save the character and tell the panels and tools; `source` names who changed it. */
export const saveChar = (c: Character, source?: string) => {
  save("character", c);
  bus.emit("character:changed", { source: source ?? "sheet" });
};

export function levelOf(xp: number) {
  let lvl = 1;
  for (let i = 0; i < 9; i++) if (xp >= LEVELS[i].next) lvl = i + 2;
  return lvl;
}
export function stats(c: Character) {
  const lvl = levelOf(c.xp);
  const L = LEVELS[lvl - 1];
  return {
    level: lvl,
    title: L.title,
    shift: L.shift + c.bonusShift,
    disc: L.disc + c.bonusDisc,
    prec: L.prec + c.bonusPrec,
    baseline: L.hp + c.bonusHp,
    manoeuvres: L.man,
    maxManLevel: L.maxMan,
    nextXp: L.next,
  };
}
const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** Weapon manoeuvres from the Codex table: [{level, dice, text}] for the weapon. */
function weaponManoeuvres(ctx: ToolContext, weapon: string) {
  const s = ctx.byId.get("codex/weapon-manoeuvres-table-1");
  const t = s?.blocks.find((b) => b.type === "table");
  if (!t || t.type !== "table") return [];
  const col = t.table.columns.findIndex((c) => c.toUpperCase().includes(weapon.toUpperCase()));
  if (col < 0) return [];
  return t.table.rows
    .map((r) => ({ level: +(r[0].match(/Level (\d)/)?.[1] ?? 0), dice: r[1], text: r[col] }))
    .filter((m) => m.level && m.text);
}

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "sheet-page");
  let c = loadChar();
  let gallery = false; // the built-in portrait gallery is open

  const draw = () => {
    const st = stats(c);
    const hpPct = Math.max(0, Math.min(100, (c.hp / st.baseline) * 100));
    const rows = (key: keyof Character, cols: string[], n: number) =>
      html`<div class="rows">${(c[key] as string[][])
        .slice(0, n)
        .map(
          (r, i) => html`<div class="row">${cols
            .map((h, j) => html`<input data-arr="${key}" data-i="${i}" data-j="${j}" placeholder="${h}" value="${r[j] ?? ""}">`)}</div>`,
        )}</div>`;
    const bonusNote = [
      c.bonusShift ? `${sign(c.bonusShift)} Shift` : "",
      c.bonusDisc ? `${sign(c.bonusDisc)} Discipline` : "",
      c.bonusPrec ? `${sign(c.bonusPrec)} Precision` : "",
    ].filter(Boolean);
    const count = (text: string) => html`<span class="sheet-count">${text}</span>`;
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow(`Play · Level ${st.level} ${st.title}`)}<h1>${icon("user", { size: 26 })}<span>Character sheet</span></h1></div>
        <div class="play-actions">
          ${button("New character", { icon: "plus", variant: "ghost", attrs: html`data-act="new"` })}
          ${button("Export", { icon: "download", variant: "ghost", attrs: html`data-act="export"` })}
          ${button("Import", { icon: "upload", variant: "ghost", attrs: html`data-act="import"` })}
        </div>
        <p class="muted sheet-note">Saved automatically on this device. Use Export to back it up or move it to your tablet.</p>
      </header>

      <div class="sheet-grid">
      ${card(
        html`${charHeader(c, st.level, html`<button type="button" class="portrait-btn" data-act="portrait" aria-label="${c.portrait ? "Change picture" : "Choose a picture"}" title="${c.portrait ? "Change picture" : "Choose a picture"}">${portrait(c, "lg")}</button>`)}
        <div class="portrait-actions">
          ${button(gallery ? "Hide portraits" : "Choose a portrait", { icon: "user", variant: "ghost", size: "sm", attrs: html`data-act="gallery" aria-expanded="${String(gallery)}" aria-controls="portrait-gallery"` })}
          ${button("Upload picture", { icon: "image", variant: "ghost", size: "sm", attrs: html`data-act="portrait"` })}
          ${c.portrait ? button("Remove picture", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-act="no-portrait"` }) : ""}
          <input type="file" accept="image/*" data-portrait-file hidden>
        </div>
        ${gallery ? html`<div class="portrait-gallery" id="portrait-gallery" role="group" aria-label="Portraits">${PORTRAITS.map((p) => html`<button type="button" class="portrait-pick" data-pick="${p.id}" title="${p.name}" aria-label="${p.name}"><img src="${portraitUrl(p.id)}" alt="" loading="lazy" width="64" height="64"></button>`)}</div>` : ""}
        <div class="grid">
          <label class="field">Name<input data-k="name" value="${c.name}"></label>
          <label class="field">Weapon<select data-k="weapon">${WEAPONS.map((w) => html`<option ${w === c.weapon ? "selected" : ""}>${w}</option>`)}</select></label>
          ${stepper("xp", c.xp, { label: "XP", min: 0, step: 10 })}
          <div class="field level-field">Level<strong>${st.level} · ${st.title}</strong>
            <span>${st.nextXp === Infinity ? "Max level" : `${st.nextXp - c.xp} XP to level ${st.level + 1}`}</span></div>
        </div>
        <label class="field">Applied runes (max 5 on main weapon)<input data-k="runes" value="${c.runes}"></label>`,
        { eyebrow: "Adventurer", title: "Identity" },
      )}

      ${card(
        html`${statBlock([
          ["Level", `${st.level} ${st.title}`],
          ["Shift", sign(st.shift)],
          ["Discipline", sign(st.disc)],
          ["Precision", sign(st.prec)],
        ])}
        ${bonusNote.length ? html`<p class="muted sheet-hint">Includes permanent bonuses: ${bonusNote.join(", ")}.</p>` : ""}
        <details class="sheet-more"><summary>Permanent stat bonuses</summary><div class="grid">
          ${stepper("bonusShift", c.bonusShift, { label: "Shift bonus" })}
          ${stepper("bonusDisc", c.bonusDisc, { label: "Discipline bonus" })}
          ${stepper("bonusPrec", c.bonusPrec, { label: "Precision bonus" })}
        </div></details>`,
        { eyebrow: "From your level", title: "Stats" },
      )}

      ${card(
        html`<div class="grid">
          ${stepper("hp", c.hp, { label: `HP (baseline ${st.baseline})`, min: 0 })}
          ${stepper("bonusHp", c.bonusHp, { label: "Permanent HP bonus" })}
        </div>
        <div class="hp-line-big"><div class="hp-bar"><div style="width:${hpPct}%"></div></div><span class="hp-num">${c.hp} / ${st.baseline}</span></div>
        <div class="step-actions">
          ${button("Heal to baseline", { icon: "heart", size: "sm", attrs: html`data-heal="baseline"` })}
          ${button("Potion of Healing (+10)", { icon: "droplet", size: "sm", attrs: html`data-heal="10"` })}
        </div>
        ${(["bloodied", "soaked"] as const)
          .map(
            (k) => html`<div class="condition">
              <div class="condition-head"><strong>${k === "bloodied" ? "Bloodied" : "Soaked"}</strong>
              <span class="muted">Tick 1 per room. After 8: ${k === "bloodied" ? "FEVER" : "PNEUMONIA"} −1 HP per room</span></div>
              <div class="boxes cond-boxes">${Array.from({ length: 8 }, (_, i) => html`<label><input type="checkbox" data-box="${k}" data-n="${i + 1}" ${c[k] > i ? "checked" : ""} aria-label="${k === "bloodied" ? "Bloodied" : "Soaked"} ${i + 1}"></label>`)}
              ${button("Clear", { variant: "ghost", size: "sm", attrs: html`data-clear="${k}"` })}</div></div>`,
          )}`,
        { eyebrow: "Health", title: "HP & conditions" },
      )}

      ${card(
        html`<p class="muted sheet-hint">${st.manoeuvres} slots, up to level ${st.maxManLevel}.</p>
        ${rows("manoeuvres", ["Manoeuvre", "Dice set", "Damage"], 3)}
        <details class="sheet-more"><summary>${c.weapon} manoeuvres you can learn</summary>
          <ul class="learn-list">${weaponManoeuvres(ctx, c.weapon)
            .filter((m) => m.level <= st.maxManLevel)
            .map((m) => html`<li><span class="learn-lvl">L${m.level}</span><span class="learn-text">${ctx.inline(m.text)}</span>${button("Add", { icon: "plus", size: "sm", attrs: html`data-learn="${m.text}"` })}</li>`)}</ul></details>`,
        { eyebrow: c.weapon, title: "Weapon & manoeuvres" },
      )}

      ${card(
        html`<p class="muted sheet-hint">Max 3, one per body part.</p>
        ${rows("armour", ["Armour piece", "Dice set", "Modifier"], 3)}`,
        { eyebrow: "Protection", title: "Armour" },
      )}

      ${card(
        html`<p class="muted sheet-hint">Max 3.</p>
        <div class="rows scroll-rows">${c.scrolls
          .map(
            (r, i) => html`<div class="row">${["Scroll", "Orbit", "Dispel doubles", "Effect"]
              .map((h, j) => html`<input data-arr="scrolls" data-i="${i}" data-j="${j}" placeholder="${h}" value="${r[j] ?? ""}">`)}${button("Cast", { icon: "wand-sparkles", size: "sm", attrs: html`data-cast="${i}" ${r[0] ? "" : "disabled"} title="Cast: roll D66, a double succeeds"` })}</div>`,
          )}</div>
        <p class="muted sheet-hint">Cast at the start of combat or outside it. A double succeeds unless it's a dispel double; Discipline can shift the dice. 5 XP per level per attempt.</p>`,
        { eyebrow: "Magic", title: "Scrolls" },
      )}

      ${card(
        html`<div class="favour-list">${GODS.map(
          (g, gi) => html`<div class="favour-row"><span class="favour-god">${g}</span>
            <span class="boxes">${Array.from({ length: 6 }, (_, i) => html`<label><input type="checkbox" data-fp="${gi}" data-n="${i + 1}" ${c.favour[gi] > i ? "checked" : ""} aria-label="${g} favour ${i + 1}"></label>`)}</span>
            ${button("Call", { icon: "sparkles", size: "sm", attrs: html`data-call="${gi}" ${c.favour[gi] ? "" : "disabled"}` })}</div>`,
        )}</div>
        <p class="muted sheet-hint">Calling: roll D6, success if ≤ your FP (success clears that god's FP). Once per level. Below 1 (with modifiers) also brings the god's gift.</p>`,
        { eyebrow: "The gods", title: "Favour" },
      )}

      ${card(
        html`<div class="grid">
          ${stepper("gc", c.gc, { label: "Gold (GC)", min: 0 })}
          ${stepper("sc", c.sc, { label: "Silver (SC)", min: 0 })}
          ${stepper("cc", c.cc, { label: "Copper (CC)", min: 0 })}
          ${stepper("rations", c.rations, { label: "Rations", min: 0 })}
          ${stepper("prisoners", c.prisoners, { label: "Liberated prisoners", min: 0 })}
        </div>
        <div class="step-actions">${button("Change up coins (10 CC = 1 SC, 10 SC = 1 GC)", { icon: "coins", size: "sm", attrs: html`data-act="coins"` })}</div>
        <div class="notes-grid">
          <label class="field">Treasure (gems etc.)<textarea data-k="treasure">${c.treasure}</textarea></label>
          <label class="field">Small items (unlimited; lock picks go here)<textarea data-k="small">${c.small}</textarea></label>
        </div>
        <div class="notes-grid">
          <div><h4 class="sheet-sub">Magic potions ${count("max 5")}</h4>
          ${rows("potions", ["Potion", "Effect"], 5)}</div>
          <div><h4 class="sheet-sub">Large &amp; heavy items ${count("max 10")}</h4>
          <div class="rows large-rows">${c.large.map((v, i) => html`<div class="row"><input data-large="${i}" placeholder="${i + 1}." value="${v}"></div>`)}</div></div>
        </div>`,
        { eyebrow: "Pack", title: "Items & coins" },
      )}

      ${card(
        html`<h4 class="sheet-sub">Legend status ${count("one box per dungeon level")}</h4>
        <div class="boxes legend-boxes">${c.legend.map((v, i) => html`<label title="Level ${i + 1}"><input type="checkbox" data-legend="${i}" ${v ? "checked" : ""} aria-label="Legend, level ${i + 1}"><span>${i + 1}</span></label>`)}</div>
        <div class="notes-grid">
          <label class="field">Side quests<textarea data-k="quests">${c.quests}</textarea></label>
          <label class="field">Narrative moments<textarea data-k="narrative">${c.narrative}</textarea></label>
          <label class="field">Additional notes<textarea data-k="notes">${c.notes}</textarea></label>
          <label class="field">Loot lockup (town storage)<textarea data-k="lockup">${c.lockup}</textarea></label>
        </div>`,
        { eyebrow: "Story", title: "Legend & notes", attrs: html`data-span="2"` },
      )}
      </div>`);
  };

  // a closed tab whose cast was still awaiting dice must not write over the newer saved sheet
  let live = true;
  ctx.onDispose(() => (live = false));
  const commit = (redraw = false) => {
    if (!live) return;
    // Level up: +10 HP now (may exceed baseline); a correction below a threshold takes it back.
    const ch = applyXp(c, c.xp, levelOf);
    if (ch.to !== ch.from) {
      if (ch.to > ch.from) playSfx("level-up");
      ctx.toast(levelChangeText(ch, LEVELS[ch.to - 1].title)!);
      redraw = true;
    }
    saveChar(c);
    if (redraw) draw();
  };

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.k) {
      (c as any)[el.dataset.k] = el.value;
      if (el.dataset.k === "name") {
        // the header shows the name and its initial: refresh them without redrawing the inputs
        const head = root.querySelector(".char-head");
        const fresh = document.createElement("div");
        setHTML(fresh, charHeader(c, stats(c).level));
        head?.querySelector(".char-name")?.replaceWith(fresh.querySelector(".char-name")!);
        if (!c.portrait) head?.querySelector(".portrait")?.replaceWith(fresh.querySelector(".portrait")!);
      }
    }
    else if (el.dataset.arr) (c as any)[el.dataset.arr][+el.dataset.i!][+el.dataset.j!] = el.value;
    else if (el.dataset.large) c.large[+el.dataset.large] = el.value;
    else if (el.name && el.type === "number") {
      (c as any)[el.name] = parseInt(el.value, 10) || 0;
      commit(["xp", "hp", "bonusHp", "bonusShift", "bonusDisc", "bonusPrec"].includes(el.name));
      return;
    }
    commit(el.tagName === "SELECT");
  });
  root.addEventListener("change", async (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.portraitFile != null) {
      const f = el.files?.[0];
      el.value = "";
      if (!f) return;
      let pic: string;
      try {
        pic = await portraitFromFile(f);
      } catch {
        return ctx.toast(`That file isn't a picture ${here()} can open.`);
      }
      if (!live) return;
      // a failed save puts the old picture back, so later saves don't keep carrying the new one
      if (!setPortrait(c, pic, (x) => saveChar(x), () => loadChar().portrait))
        ctx.toast("Couldn't save the picture on this device (storage is full). Try a smaller image.");
      draw();
      return;
    }
    if (el.type !== "checkbox") return;
    const n = +el.dataset.n!;
    if (el.dataset.box) {
      const k = el.dataset.box as "bloodied" | "soaked";
      c[k] = el.checked ? n : n - 1;
    } else if (el.dataset.fp) {
      const g = +el.dataset.fp;
      c.favour[g] = el.checked ? n : n - 1;
    } else if (el.dataset.legend) c.legend[+el.dataset.legend] = el.checked;
    commit(true);
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.pick) {
      let pic: string;
      try {
        pic = await portraitFromUrl(portraitUrl(b.dataset.pick));
      } catch {
        return ctx.toast("Couldn't load that portrait.");
      }
      if (!live) return;
      if (!setPortrait(c, pic, (x) => saveChar(x), () => loadChar().portrait))
        ctx.toast("Couldn't save the picture on this device (storage is full).");
      gallery = false;
      draw();
      root.querySelector<HTMLElement>('[data-act="gallery"]')?.focus();
      return;
    }
    if (b.dataset.act === "gallery") {
      gallery = !gallery;
      draw();
      root.querySelector<HTMLElement>('[data-act="gallery"]')?.focus();
    } else if (b.dataset.act === "portrait") root.querySelector<HTMLInputElement>("[data-portrait-file]")?.click();
    else if (b.dataset.act === "no-portrait") {
      delete c.portrait;
      saveChar(c);
      draw();
      root.querySelector<HTMLElement>('[data-act="portrait"]')?.focus();
    } else if (b.dataset.act === "new") {
      if (!confirm("Start a new character? The current sheet will be replaced (export it first if you want to keep it).")) return;
      c = blankCharacter();
      const weapon = prompt(`Weapon? (${WEAPONS.join(", ")})`, "Longsword") || "Longsword";
      c.weapon = WEAPONS.find((w) => w.toLowerCase() === weapon.toLowerCase()) ?? "Longsword";
      const a = +(prompt(`Starting armour?\n${STARTING_ARMOUR.map((r, i) => `${i + 1}. ${r[0]} ${r[1]}`).join("\n")}`, "1") || 1) - 1;
      c.armour[0] = [...(STARTING_ARMOUR[a] ?? STARTING_ARMOUR[0])];
      const s = +(prompt(`Starting scroll?\n${STARTING_SCROLLS.map((r, i) => `${i + 1}. ${r}`).join("\n")}`, "1") || 1) - 1;
      const scrollName = STARTING_SCROLLS[s] ?? STARTING_SCROLLS[0];
      const st = ctx.byId.get("codex/magic-scroll-table-1")?.blocks.find((x) => x.type === "table");
      const row = st && st.type === "table" ? st.table.rows.find((r) => r[0].toUpperCase() === scrollName) : null;
      c.scrolls[0] = row ? [`Scroll of ${row[0]}`, row[3], row[4], row[7]] : [`Scroll of ${scrollName}`, "", "", ""];
      saveChar(c, "sheet-new");
      draw();
      ctx.toast("New adventurer created. Now pick 2 level-1 manoeuvres for your weapon.");
    } else if (b.dataset.act === "export") exportJSON(`character-${c.name || "adventurer"}`, c);
    else if (b.dataset.act === "import") {
      const d = await importJSON(validateCharacter);
      if (d && live) {
        c = { ...blankCharacter(), ...d };
        c.lastLevel = importedLastLevel({ xp: c.xp, lastLevel: d.lastLevel }, levelOf); // a file without it mustn't grant level-up HP
        saveChar(c, "sheet-import");
        draw();
      }
    } else if (b.dataset.act === "coins") {
      c.sc += Math.floor(c.cc / 10);
      c.cc %= 10;
      c.gc += Math.floor(c.sc / 10);
      c.sc %= 10;
      commit(true);
    } else if (b.dataset.heal) {
      const base = stats(c).baseline;
      c.hp = b.dataset.heal === "baseline" ? Math.max(c.hp, base) : Math.max(c.hp, Math.min(base, c.hp + 10));
      commit(true);
    } else if (b.dataset.clear) {
      c[b.dataset.clear as "bloodied" | "soaked"] = 0;
      commit(true);
    } else if (b.dataset.learn) {
      const m = b.dataset.learn.match(/^(\[\d\]\[\d\])\s*-\s*(.+?)\s*=\s*(.+)$/);
      if (m && c.manoeuvres.some((r) => r[0] === m[2])) return ctx.toast(`You already know ${m[2]}.`);
      const slot = c.manoeuvres.findIndex((r) => !r[0]);
      if (slot < 0) return ctx.toast("All 3 manoeuvre slots are full. Clear one first.");
      c.manoeuvres[slot] = m ? [m[2], m[1], m[3]] : [b.dataset.learn, "", ""];
      commit(true);
    } else if (b.dataset.call) {
      const g = +b.dataset.call;
      const mod = parseInt(prompt("Any modifier to the favour roll? (e.g. -2 at a mural)", "0") || "0", 10) || 0;
      const r = await rollDice("D6");
      const total = r.value + mod;
      const ok = total <= c.favour[g];
      if (ok) playSfx("favour");
      ctx.toast(`${GODS[g]}: rolled ${r.value}${mod ? ` ${sign(mod)} = ${total}` : ""}. ${ok ? (total < 1 ? "Success, and the god appears with a gift!" : "Favour granted!") : "No answer (FP kept)."}`);
      if (ok) c.favour[g] = 0;
      commit(true);
    } else if (b.dataset.cast) {
      const s = c.scrolls[+b.dataset.cast];
      const r = await rollDice("D66");
      const [p, q] = r.dice;
      const dispel = (s[2] || "").match(/\[(\d)\]\[(\d)\]|\b(\d)s?\b/g)?.map((x) => x.replace(/\D/g, "")[0]) ?? [];
      const isDouble = p === q;
      const dispelled = isDouble && dispel.includes(String(p));
      c.xp += 5 * stats(c).level;
      playSfx(isDouble && !dispelled ? "scroll-cast" : "scroll-fail");
      ctx.toast(`${s[0]}: rolled ${p} and ${q}. ${isDouble && !dispelled ? (p === 6 ? "Cast! Double 6: double damage." : p === 1 ? "Cast, but double 1: half damage." : "Cast succeeds!") : dispelled ? "Dispel double: it fails." : "Not a double. Shift with Discipline, or it fails."}`);
      if (!isDouble || dispelled) {
        const ref = tableBySection("codex/ftcct1-failed-to-cast-correctly-table-1");
        if (ref && confirm("Did the cast fail? Roll on FTCCT1 (Failed To Cast Correctly)?")) await rollAndLog(ref, 0, undefined, `Failed cast: ${s[0]}`);
      }
      // the scroll is used up either way
      if (confirm(`Remove ${s[0]} from your sheet? (scrolls are used up even if the cast fails)`)) c.scrolls[+b.dataset.cast] = ["", "", "", ""];
      commit(true);
    }
  });
  wireSteppers(root);
  // another tool or panel changed the character: show it (our own saves are already on screen)
  ctx.onDispose(
    bus.on("character:changed", ({ source }) => {
      if (source === "sheet") return;
      c = loadChar();
      draw();
    }),
  );
  draw();
  makeCardsArrangeable(root, "2d6:shell:panes:sheet", ctx.onDispose);
}
