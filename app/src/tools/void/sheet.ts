// 2D6 Void character sheet (fields p46–49, rules docs/spec-void.md §1 and §4). The model and the
// rules live in sheetmodel.ts; this file draws the sheet and wires its controls.
import type { ToolContext } from "../../main";
import { rollDice } from "../../dice3d";
import { tableBySection } from "../../rolltable";
import { makeCardsArrangeable } from "../../shell/arrangecards";
import { rollAndLog } from "../../shell/panels/results";
import { exportJSON, importJSON, stepper, wireSteppers } from "../common";
import { html, joinHtml, setHTML, type Raw } from "../../ui/html";
import { button, card, eyebrow, statBlock } from "../../ui/components";
import { icon } from "../../ui/icon";
import { playSfx } from "../../audio/sound";
import { setPortrait, signed } from "../../shell/charmodel";
import { portrait } from "../../shell/panels/charcard";
import { portraitFromFile, portraitFromUrl } from "../../ui/picture";
import { VOID_ART_STYLES, portraitsIn, voidPortraitUrl, type VoidArtStyle } from "../../ui/voidportraits";
import { here } from "../../shell/platform";
import {
  GASES, GAS_NAMES, MAX_LARGE, MAX_STIMS, MELEE_WEAPONS, PROFESSIONS, RANGED_HITS_BAR, SPECIAL_SKILLS, STE_TASKS, XP_SOURCES,
  addLarge, addRangedHit, addXp, applyDamage, armourPiece, armourTable, camoRest, craftingItems, eatBetweenLevels, endCombat,
  enterRoom, fillStim, hasVChar, heal, largeCount, levelChangeText, levelTable, loadVChar, newVoidCharacter, normaliseVChar,
  parseDiceSet, rangedProblem, reload, restBetweenLevels, saveVChar, setXp, skillCheck, specialApplies, startHulkLevel, stimInfo,
  stimTable, stun, tentAllowed, tickSte, useStim, validateVChar, vstats, weaponCards, weaponFromCard, weaponManoeuvres, wearProblem,
  type LevelChange, type MeleeWeapon, type Profession, type SteTask, type VoidCharacter,
} from "./sheetmodel";

const SOURCE = "vsheet";
const STYLE_KEY = "2d6v:vsheet:portrait-style"; // per-viewer: the last gallery tab

function readStyle(): VoidArtStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (VOID_ART_STYLES.some((s) => s.id === v)) return v as VoidArtStyle;
  } catch {
    /* blocked storage */
  }
  return "anime";
}
function writeStyle(s: VoidArtStyle) {
  try {
    localStorage.setItem(STYLE_KEY, s);
  } catch {
    /* blocked storage */
  }
}

/** Set a value on `obj` by a dotted path ("gas.Ca", "access.alpha"). */
function setPath(obj: any, path: string, v: unknown) {
  const ks = path.split(".");
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks[ks.length - 1]] = v;
}

const rule = (text: string) => html`<p class="vs-rule">${icon("book-open", { size: 13 })}<span>${text}</span></p>`;
const count = (text: string) => html`<span class="sheet-count">${text}</span>`;
/** A list of rows, or a muted line when it is empty. */
const orNone = (rows: Raw[], none: string): Raw => (rows.length ? html`${rows}` : html`<p class="muted">${none}</p>`);

interface Draft { name: string; profession: Profession; weapon: MeleeWeapon; man: string[]; armour: number }

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "sheet-page", "vsheet-page");
  let c: VoidCharacter = loadVChar();
  let creating = !hasVChar();
  let draft: Draft = { name: "", profession: "Freighter Captain", weapon: "Ion Baton", man: [], armour: 0 };
  let gallery = false;
  let style: VoidArtStyle = readStyle();
  let live = true;
  ctx.onDispose(() => (live = false));

  // ---------- creation ----------
  const drawCreate = () => {
    const l1 = weaponManoeuvres(draft.weapon).filter((m) => m.level === 1);
    const start = armourTable().filter((a) => a.start);
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow("Play · New survivor")}<h1>${icon("user", { size: 26 })}<span>Character sheet</span></h1></div>
        <div class="play-actions">
          ${hasVChar() ? button("Back to my survivor", { icon: "chevron-left", variant: "ghost", attrs: html`data-act="cancel-new"` }) : ""}
          ${button("Import", { icon: "upload", variant: "ghost", attrs: html`data-act="import"` })}
        </div>
      </header>
      <div class="sheet-grid vs-create">
        ${card(
          html`<label class="field">Name<input data-draft="name" value="${draft.name}" placeholder="Your survivor's name"></label>
          <div class="vs-choices" role="radiogroup" aria-label="Profession">${PROFESSIONS.map((p) => {
            const L = levelTable(p);
            return html`<label class="vs-choice"><input type="radio" name="vs-prof" data-draft="profession" value="${p}" ${p === draft.profession ? "checked" : ""}>
              <span><strong>${p}</strong><span class="muted">${SPECIAL_SKILLS[p].name}: ${SPECIAL_SKILLS[p].effect}</span>
              <span class="muted">Level 1 ${L[0].title} · top level ${L[L.length - 1].title} (${L[L.length - 1].hp} HP)</span></span></label>`;
          })}</div>
          ${rule("Technical 3, Coding 3, Marksmanship 6. Level 1, XP 0, HP 10, Shift +2.")}`,
          { eyebrow: "Step 1", title: "Name & profession" },
        )}
        ${card(
          html`<div class="vs-choices vs-choices-row" role="radiogroup" aria-label="Melee weapon">${MELEE_WEAPONS.map((w) => html`<label class="vs-choice"><input type="radio" name="vs-weapon" data-draft="weapon" value="${w}" ${w === draft.weapon ? "checked" : ""}><span><strong>${w}</strong></span></label>`)}</div>
          <h4 class="sheet-sub">Two level 1 manoeuvres ${count(`${draft.man.length}/2 chosen`)}</h4>
          <div class="vs-man-pick">${l1.map((m) => html`<label class="vs-choice vs-choice-sm"><input type="checkbox" data-draft-man="${m.name}" ${draft.man.includes(m.name) ? "checked" : ""} ${!draft.man.includes(m.name) && draft.man.length >= 2 ? "disabled" : ""}>
            <span><span class="vs-dice">${m.dice}</span> <strong>${m.name}</strong> <span class="muted">${m.damage}</span></span></label>`)}</div>
          ${rule("The weapon is fixed for the whole adventure.")}`,
          { eyebrow: "Step 2", title: "Melee weapon & manoeuvres" },
        )}
        ${card(
          html`<div class="vs-choices" role="radiogroup" aria-label="Starting armour">${start.map((a, i) => html`<label class="vs-choice"><input type="radio" name="vs-armour" data-draft="armour" value="${i}" ${i === draft.armour ? "checked" : ""}>
            <span><strong>${a.name}</strong><span class="muted"><span class="vs-die is-yellow">${parseDiceSet(a.dice)[0]?.[0] ?? ""}</span> ${a.mod} damage</span></span></label>`)}</div>
          ${rule("All starting armour has a yellow die: it also blocks ranged attacks.")}`,
          { eyebrow: "Step 3", title: "Starting armour" },
        )}
        ${card(
          html`<ul class="vs-list">
            <li>C-12 Pistol with one caseless block of 12 rounds</li>
            <li>1 Medical Stim (+10 HP, can exceed baseline)</li>
            <li>2 rations</li>
            <li>${newVoidCharacter().equipment}</li>
          </ul>
          ${rule("Starting equipment can't be lost and isn't a large item. No starting credits are stated (U4): you start with 0c.")}
          <div class="step-actions">${button("Create survivor", { icon: "check", variant: "primary", attrs: html`data-act="create" ${draft.man.length === 2 ? "" : "disabled"}` })}</div>`,
          { eyebrow: "Step 4", title: "Starting equipment" },
        )}
      </div>`);
  };

  const create = () => {
    const n = newVoidCharacter(draft.profession);
    n.name = draft.name.trim();
    n.weapon = draft.weapon;
    const l1 = weaponManoeuvres(draft.weapon).filter((m) => m.level === 1);
    n.manoeuvres = draft.man.map((name) => l1.find((m) => m.name === name)!).filter(Boolean);
    const a = armourTable().filter((x) => x.start)[draft.armour];
    if (a) n.armour = [armourPiece(a)];
    c = n;
    creating = false;
    saveVChar(c, SOURCE + "-new");
    draw();
    ctx.toast(`${c.name || "Your survivor"} is ready: ${c.profession}, level 1.`);
  };

  // ---------- the sheet ----------
  const drawSheet = () => {
    const st = vstats(c);
    const hpPct = Math.max(0, Math.min(100, (c.hp / st.baseline) * 100));
    const learnable = weaponManoeuvres(c.weapon).filter((m) => m.level <= st.maxManLevel);
    const armourRows = armourTable();
    const stims = stimTable();
    const cards = weaponCards();
    const boxes = (key: string, n: number, filled: number, label: string) =>
      Array.from({ length: n }, (_v, i) => html`<label><input type="checkbox" data-box="${key}" data-n="${i + 1}" ${filled > i ? "checked" : ""} aria-label="${label} ${i + 1}"></label>`);
    const dieChips = (ai: number): Raw =>
      joinHtml(parseDiceSet(c.armour[ai].dice)
        .map((g, gi) => g.map((d, k) => html`<button type="button" class="vs-die${c.armour[ai].yellow[gi]?.[k] ? " is-yellow" : ""}" data-yellow="${ai}:${gi}:${k}" aria-pressed="${String(!!c.armour[ai].yellow[gi]?.[k])}" title="Yellow die (blocks ranged): click to toggle">${d}</button>`)), html`<span class="vs-plus">+</span>`);
    const galleryHtml = gallery
      ? html`<div class="vs-gallery" id="portrait-gallery">
          <div class="vs-style-tabs" role="tablist" aria-label="Art style">${VOID_ART_STYLES.map((s) => html`<button type="button" role="tab" class="vs-style-tab" data-style="${s.id}" aria-selected="${String(s.id === style)}">${s.name}</button>`)}</div>
          <div class="portrait-gallery" role="group" aria-label="${VOID_ART_STYLES.find((s) => s.id === style)!.name} portraits">${portraitsIn(style).map((p) => html`<button type="button" class="portrait-pick" data-pick="${p.id}" title="${p.name}" aria-label="${p.name}"><img src="${voidPortraitUrl(style, p.id)}" alt="" width="64" height="64"></button>`)}</div>
          <p class="muted vs-gallery-empty" hidden>These portraits haven't been added yet.</p>
        </div>`
      : "";

    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow(`Play · Level ${st.level} ${st.title}`)}<h1>${icon("user", { size: 26 })}<span>Character sheet</span></h1></div>
        <div class="play-actions">
          ${button("New survivor", { icon: "plus", variant: "ghost", attrs: html`data-act="new"` })}
          ${button("Export", { icon: "download", variant: "ghost", attrs: html`data-act="export"` })}
          ${button("Import", { icon: "upload", variant: "ghost", attrs: html`data-act="import"` })}
        </div>
        <p class="muted sheet-note">Saved automatically on this device. Use Export to back it up or move it to another device.</p>
      </header>

      <div class="sheet-grid">
      ${card(
        html`<header class="char-head"><button type="button" class="portrait-btn" data-act="portrait" aria-label="${c.portrait ? "Change picture" : "Choose a picture"}" title="${c.portrait ? "Change picture" : "Choose a picture"}">${portrait(c, "lg")}</button>
          <div class="char-head-text"><h2 class="char-name">${c.name || "Survivor"}</h2><span class="char-level">${c.profession} · Level ${st.level} ${st.title}</span></div></header>
        <div class="portrait-actions">
          ${button(gallery ? "Hide portraits" : "Choose a portrait", { icon: "user", variant: "ghost", size: "sm", attrs: html`data-act="gallery" aria-expanded="${String(gallery)}" aria-controls="portrait-gallery"` })}
          ${button("Upload picture", { icon: "image", variant: "ghost", size: "sm", attrs: html`data-act="portrait"` })}
          ${c.portrait ? button("Remove picture", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-act="no-portrait"` }) : ""}
          <input type="file" accept="image/*" data-portrait-file hidden>
        </div>
        ${galleryHtml}
        <div class="grid">
          <label class="field">Name<input data-k="name" value="${c.name}"></label>
          <label class="field">Profession<select data-k="profession">${PROFESSIONS.map((p) => html`<option ${p === c.profession ? "selected" : ""}>${p}</option>`)}</select></label>
          <label class="field">Melee weapon<select data-k="weapon">${MELEE_WEAPONS.map((w) => html`<option ${w === c.weapon ? "selected" : ""}>${w}</option>`)}</select></label>
          ${stepper("xp", c.xp, { label: "XP", min: 0, step: 10 })}
          <div class="field level-field">Level<strong>${st.level} · ${st.title}</strong>
            <span>${Number.isFinite(st.nextXp) ? `${st.nextXp - c.xp} XP to level ${st.level + 1}` : "Top level"}</span></div>
        </div>
        <div class="vs-special"><strong>Special skill: ${st.special.name}</strong><span class="muted">${st.special.effect}</span></div>`,
        { eyebrow: "Survivor", title: "Identity" },
      )}

      ${card(
        html`${statBlock([
          ["Level", `${st.level} ${st.title}`],
          ["Shift", signed(st.shift)],
          ["Technical", String(st.technical)],
          ["Coding", String(st.coding)],
          ["Marksmanship", String(st.marksmanship)],
          ["Manoeuvres", `${st.manoeuvres} · up to L${st.maxManLevel}`],
        ])}
        <p class="muted sheet-hint">Technical ${st.technicalPerm} = 3 + Tech Mods ${st.techMods} + STE / bonus ${c.techBonus}; Coding ${st.codingPerm} = 3 + Coding Mods ${st.codingMods} + ${c.codingBonus}. Cap 10.${c.stunned ? " Stunned: −1 Shift." : ""}${st.technical !== st.technicalPerm || st.coding !== st.codingPerm ? " Stim effects included." : ""}</p>
        <div class="vs-check">
          <h4 class="sheet-sub">Skill check</h4>
          <div class="vs-check-row">
            <select data-check="skill" aria-label="Skill"><option value="technical">Technical (${st.technical})</option><option value="coding">Coding (${st.coding})</option></select>
            <input data-check="mod" type="text" inputmode="text" value="0(1)" aria-label="Modifier and attempts, e.g. −3(2)" title="Modifier and attempts, e.g. −3(2)">
            <select data-check="task" aria-label="Task (for STE)"><option value="">Task (optional)</option>${STE_TASKS.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select>
            ${button("Roll 2D6", { icon: "dice", size: "sm", attrs: html`data-act="check"` })}
          </div>
          ${rule("Roll 2D6 and add the modifier: pass if the result is ≤ the skill. Brackets = attempts. A pass on a task ticks its STE row.")}
        </div>
        <details class="sheet-more"><summary>Permanent bonuses</summary><div class="grid">
          ${stepper("techBonus", c.techBonus, { label: "Technical (STE etc.)" })}
          ${stepper("codingBonus", c.codingBonus, { label: "Coding (STE etc.)" })}
          ${stepper("shiftBonus", c.shiftBonus, { label: "Shift bonus" })}
          ${stepper("baselineBonus", c.baselineBonus, { label: "HP baseline bonus" })}
        </div></details>`,
        { eyebrow: "From your level", title: "Stats & skills" },
      )}

      ${card(
        html`<div class="grid">${stepper("hp", c.hp, { label: `HP (baseline ${st.baseline})`, min: 0 })}</div>
        <div class="hp-line-big"><div class="hp-bar"><div style="width:${hpPct}%"></div></div><span class="hp-num">${c.hp} / ${st.baseline}</span></div>
        <div class="step-actions">
          ${button("Take damage", { icon: "minus", size: "sm", attrs: html`data-act="damage"` })}
          ${button("Heal", { icon: "heart", size: "sm", attrs: html`data-act="heal"` })}
        </div>
        ${rule("Current HP may exceed the baseline from level-ups and stims. Other healing stops at the baseline (U7).")}
        ${c.hp === 0 ? html`<div class="vs-alert">${icon("skull", { size: 16 })}<div><strong>Unconscious.</strong> If an enemy is fighting you, it finishes you off. Reduced to 0 by anything else: roll RFUT1. ${button("Roll RFUT1", { icon: "dice", size: "sm", attrs: html`data-act="rfut1"` })}</div></div>` : ""}
        <div class="condition">
          <div class="condition-head"><strong>Bloodied</strong><span class="muted">Tick 1 per room entered. After 8: FEVER −1 HP per room until washed</span></div>
          <div class="boxes cond-boxes">${boxes("bloodied", 8, c.bloodied, "Bloodied")}
          ${button("Wash", { variant: "ghost", size: "sm", attrs: html`data-clear="bloodied"` })}</div>
        </div>
        <div class="condition">
          <div class="condition-head"><strong>Stunned</strong><span class="muted">−1 Shift until the boxes are unticked (one per room)${c.profession === "Bounty Hunter" ? " · Fast Recovery: −1 to each Stun" : ""}</span></div>
          <div class="boxes cond-boxes">${boxes("stunned", 8, c.stunned, "Stunned")}
          ${button("Stun…", { variant: "ghost", size: "sm", attrs: html`data-act="stun"` })}
          ${button("Clear", { variant: "ghost", size: "sm", attrs: html`data-clear="stunned"` })}</div>
          ${rule("A new Stun while Stunned keeps the larger count (U42). Becoming Bloodied ticks the first box at once (U36).")}
        </div>
        <div class="step-actions">${button("Entered a room", { icon: "door-closed", size: "sm", attrs: html`data-act="room" title="Tick Bloodied, untick Stunned, end room effects"` })}</div>`,
        { eyebrow: "Health", title: "HP & conditions" },
      )}

      ${card(
        html`<p class="muted sheet-hint">${st.manoeuvres} slots, up to manoeuvre level ${st.maxManLevel}. Each level gained you may swap one.${c.meleeBonus ? ` All manoeuvres ${signed(c.meleeBonus)} damage.` : ""}</p>
        <div class="vs-table">${orNone(c.manoeuvres.map((m, i) => html`<div class="vs-trow vs-man">
          <span class="vs-dice">${m.dice}</span><strong>${m.name}</strong><span>${m.damage}${c.meleeBonus ? ` ${signed(c.meleeBonus)}` : ""}</span><span class="muted">L${m.level}</span>
          ${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-unlearn="${i}" aria-label="Forget ${m.name}"` })}</div>`), "No manoeuvres yet.")}</div>
        <details class="sheet-more"><summary>${c.weapon} manoeuvres you can learn</summary>
          <ul class="learn-list">${learnable.map((m) => html`<li><span class="learn-lvl">L${m.level}</span><span class="learn-text"><span class="vs-dice">${m.dice}</span> ${m.name} = ${m.damage}</span>${button("Add", { icon: "plus", size: "sm", attrs: html`data-learn="${m.name}" ${c.manoeuvres.some((x) => x.name === m.name) ? "disabled" : ""}` })}</li>`)}</ul>
          ${rule("Two manoeuvres can't share a dice set (U2): several repeat across levels, so swap rather than hold both.")}
        </details>
        <details class="sheet-more"><summary>Melee damage bonus</summary>${stepper("meleeBonus", c.meleeBonus, { label: "+damage to all manoeuvres (e.g. Tendon Amp)" })}</details>`,
        { eyebrow: c.weapon, title: "Melee weapon & manoeuvres" },
      )}

      ${card(
        html`<p class="muted sheet-hint">Max 3 worn, one per body part. Yellow dice (click to toggle) also block ranged attacks.</p>
        <div class="vs-table">${orNone(c.armour.map((a, i) => html`<div class="vs-trow vs-arm">
          <strong>${a.name}</strong><span class="vs-dieset">${dieChips(i)}</span>
          <label class="vs-mod">Mod <input type="number" data-armod="${i}" value="${a.mod}" max="0" aria-label="${a.name} damage modifier"></label>
          ${a.damaged ? html`<span class="vs-tag">damaged</span>` : ""}
          ${button("", { icon: "backpack", variant: "ghost", size: "sm", attrs: html`data-unwear="${i}" aria-label="Take off ${a.name} (into large items)" title="Take off (into large items)"` })}
          ${button("", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-drop-armour="${i}" aria-label="Discard ${a.name}" title="Discard"` })}</div>`), "No armour worn.")}</div>
        <div class="vs-add">
          <select data-add="armour" aria-label="Armour to wear"><option value="">Wear armour…</option>${armourRows.map((r, i) => html`<option value="${i}">${r.name} ${r.dice} ${r.mod} (${r.cost}c)</option>`)}</select>
          ${button("Wear", { icon: "shield", size: "sm", attrs: html`data-act="wear"` })}
        </div>
        ${rule("ARMOUR TABLE 1 doesn't encode yellow dice; the sheet marks the first die of each pair (and the Void Knight Battlesuit's [3]). The +[x] notation is unexplained (U3). Armour not worn is a large item.")}`,
        { eyebrow: "Protection", title: "Armour" },
      )}

      ${card(
        html`<div class="vs-table">${c.ranged.map((w, i) => html`<div class="vs-weapon">
          <div class="vs-weapon-head"><strong>${w.name}</strong><span class="vs-tag">${w.size}</span>${w.starting ? html`<span class="vs-tag">starting</span>` : ""}
            <span class="muted">${w.damage} · ${w.settings}</span></div>
          <div class="vs-weapon-ammo">
            ${stepper(`ranged.${i}.ammo`, w.ammo, { label: `Ammo /${w.capacity}`, min: 0, max: w.capacity })}
            ${stepper(`ranged.${i}.reserve`, w.reserve, { label: "Spare rounds", min: 0 })}
            ${stepper(`ranged.${i}.spares`, w.spares, { label: "Weapon spares", min: 0 })}
            ${button("Reload", { icon: "rotate-ccw", size: "sm", attrs: html`data-reload="${i}" ${w.reserve && w.ammo < w.capacity ? "" : "disabled"}` })}
            ${w.starting ? "" : button("", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-drop-ranged="${i}" aria-label="Drop ${w.name}"` })}
          </div>
          ${w.ammoType ? html`<p class="muted sheet-hint">Ammo: ${w.ammoType}</p>` : ""}
          ${w.special ? html`<p class="sheet-hint"><strong>Special:</strong> ${w.special}</p>` : ""}
          ${w.doubles ? html`<details class="sheet-more"><summary>On a double</summary><p class="vs-pre">${w.doubles}</p></details>` : ""}
        </div>`)}</div>
        <div class="vs-add">
          <select data-add="ranged" aria-label="Ranged weapon to add"><option value="">Add a weapon…</option>${cards.map((w) => html`<option value="${w.id}">${w.name}</option>`)}</select>
          ${button("Add", { icon: "plus", size: "sm", attrs: html`data-act="add-ranged"` })}
        </div>
        <div class="vs-marks">
          <h4 class="sheet-sub">Marksmanship ${count(`${st.marksmanship}${c.marksTemp ? ` (${signed(c.marksTemp)} this level)` : ""} · max 10`)}</h4>
          <div class="grid">${stepper("marksmanship", c.marksmanship, { label: "Marksmanship", min: 0, max: 10 })}${stepper("marksTemp", c.marksTemp, { label: "This Hulk level only" })}</div>
          <h4 class="sheet-sub">Ranged hits ${count("one tick per different enemy hit")}</h4>
          <div class="boxes vs-hits">${boxes("rangedHits", RANGED_HITS_BAR, c.rangedHits, "Ranged hit")}
          ${button("Hit a new enemy", { icon: "crosshair", size: "sm", attrs: html`data-act="hit"` })}</div>
          ${rule(`A full bar: +1 Marksmanship, clear it and gain 100 XP per level (${100 * st.level} XP now). Kills made only by shooting give 0 XP.`)}
        </div>`,
        { eyebrow: "Max 3: 2 small + 1 large", title: "Ranged weapons" },
      )}

      ${card(
        html`<div class="vs-table">${orNone(c.stims.map((s, i) => {
          const info = s.type ? stimInfo(s.type) : undefined;
          return html`<div class="vs-trow vs-stim">
            <strong>${s.type ? s.type : html`<span class="muted">Empty injector</span>`}</strong>
            <span class="muted">${info?.effect ?? (s.type ? "" : "Fill it in the Stim Dock")}${info ? ` · ${info.duration.toLowerCase()}` : ""}</span>
            ${s.type ? button("Use", { icon: "zap", size: "sm", attrs: html`data-use-stim="${i}"` })
              : html`<select data-fill-type="${i}" aria-label="Stim to make"><option value="">Make…</option>${stims.map((x) => html`<option>${x.type}</option>`)}</select>${button("Fill", { icon: "droplet", size: "sm", attrs: html`data-fill="${i}"` })}`}
            ${button("", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-drop-stim="${i}" aria-label="Discard injector"` })}
          </div>`;
        }), "No stims.")}</div>
        <div class="vs-add">
          <select data-add="stim" aria-label="Stim to add" ${c.stims.length >= MAX_STIMS ? "disabled" : ""}><option value="">Add a stim…</option><option value="-">Empty injector</option>${stims.map((x) => html`<option>${x.type}</option>`)}</select>
          ${button("Add", { icon: "plus", size: "sm", attrs: html`data-act="add-stim" ${c.stims.length >= MAX_STIMS ? "disabled" : ""}` })}
          ${tableBySection("void/p91-5") ? button("Roll STIT1", { icon: "dice", variant: "ghost", size: "sm", attrs: html`data-act="stit1"` }) : ""}
        </div>
        ${rule("Max 5, each in its own injector; empty injectors are kept for refilling and take a slot (U6). Using a stim in combat takes a round. Stims aren't cumulative: an active one is refreshed, not stacked (U9).")}
        <h4 class="sheet-sub">Gas cartridges</h4>
        <div class="vs-gas">${GASES.map((g) => stepper(`gas.${g}`, c.gas[g], { label: `${g} · ${GAS_NAMES[g]}`, min: 0 }))}</div>
        <div class="vs-add">${tableBySection("void/p91-3") ? button("Roll GACT1", { icon: "dice", variant: "ghost", size: "sm", attrs: html`data-act="gact1"` }) : ""}</div>
        ${rule("Making or refilling a stim gives 10 XP per level. Heightened Awareness and Toughen Skin ingredients are read as printed (U10: Ca ×3; “Sa” = S).")}
        <h4 class="sheet-sub">Active effects</h4>
        ${c.effects.length ? html`<ul class="vs-list vs-effects">${c.effects.map((e, i) => html`<li><strong>${e.name}</strong> <span class="muted">${e.text} · ${e.scope === "rooms" ? `${e.rooms} rooms left` : `this ${e.scope}`}</span>${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-end-effect="${i}" aria-label="End ${e.name}"` })}</li>`)}</ul>` : html`<p class="muted">None.</p>`}
        <div class="step-actions">${button("Combat over", { icon: "swords", variant: "ghost", size: "sm", attrs: html`data-act="end-combat"` })}</div>`,
        { eyebrow: "Medicine", title: "Stims & gases" },
      )}

      ${card(
        html`<div class="vs-ste">${STE_TASKS.map((t) => html`<div class="vs-ste-row" title="${t.def}">
          <span>${t.name}</span><span class="muted">+1 ${t.skill === "technical" ? "Technical" : "Coding"}</span>
          <span class="boxes">${Array.from({ length: 4 }, (_v, i) => html`<label><input type="checkbox" data-ste="${t.id}" data-n="${i + 1}" ${c.ste[t.id] > i ? "checked" : ""} aria-label="${t.name} ${i + 1}"></label>`)}</span></div>`)}</div>
        ${rule("Tick one box per successful task; the 4th tick gives +1 to the skill (cap 10) and clears the row. If it's unclear which task applies, tick the row with the fewest ticks.")}`,
        { eyebrow: "Skills", title: "Specific Task Experience" },
      )}

      ${card(
        html`<div class="grid">
          ${stepper("credits", c.credits, { label: "Credits (c)", min: 0 })}
          ${stepper("rations", c.rations, { label: "Rations", min: 0 })}
          ${stepper("rationParts", c.rationParts, { label: "Food parts", min: 0 })}
        </div>
        ${rule("Three types of food make 1 ration. Rations aren't carried items.")}
        <div class="notes-grid">
          <label class="field">Alien artefacts<textarea data-k="artefacts">${c.artefacts}</textarea></label>
          <label class="field">Small items (unlimited)<textarea data-k="small">${c.small}</textarea></label>
        </div>
        <h4 class="sheet-sub">Large &amp; heavy items ${count(`${largeCount(c)}/${MAX_LARGE}`)}</h4>
        <div class="rows large-rows">${c.large.map((v, i) => html`<div class="row"><input data-large="${i}" placeholder="${i + 1}." value="${v}"></div>`)}</div>
        <details class="sheet-more"><summary>Starting equipment (can't be lost)</summary><p class="sheet-hint">${c.equipment}</p></details>`,
        { eyebrow: "Pack", title: "Items & credits" },
      )}

      ${card(
        html`<div class="grid">${stepper("tentUses", c.tentUses, { label: "Camo Tent used this level", min: 0 })}</div>
        <div class="step-actions">
          ${button("Camo Tent rest", { icon: "utensils", size: "sm", attrs: html`data-act="tent"` })}
          ${button("Eat a ration", { icon: "utensils", size: "sm", attrs: html`data-eat="ration"` })}
          ${button("Eat two food parts", { size: "sm", attrs: html`data-eat="parts"` })}
          ${button("Don't eat", { variant: "ghost", size: "sm", attrs: html`data-eat="none"` })}
          ${button("Rest", { icon: "heart", size: "sm", attrs: html`data-rest="0"` })}
          ${button("Rest with cloth", { icon: "heart", size: "sm", attrs: html`data-rest="1"` })}
          ${button("Start next Hulk level", { icon: "arrow-down", variant: "ghost", size: "sm", attrs: html`data-act="next-level"` })}
        </div>
        ${rule(`Camo Tent: once per level (twice on L10), in a normal or large room with no alien when first entered. With a ration, rest to baseline (the ration is eaten); without, + half baseline, not above it (U11). Leaving removes Stunned.`)}
        ${rule("Between levels, eat a ration or lose half your HP (max 20); two food parts lose a quarter. Losses round down and the 20 cap covers both (U8). Rest only if you ate: +2 HP per level, +1 more per level with a cloth or bandage, not above baseline.")}`,
        { eyebrow: "Rest", title: "Camo Tent & between levels" },
      )}

      ${card(
        html`<h4 class="sheet-sub">Hero status ${count("tick each Dark Hulk level completed")}</h4>
        <div class="boxes legend-boxes vs-hero">${c.hero.map((v, i) => html`<label title="Level ${i + 1}"${i === 9 ? html` class="is-final"` : ""}><input type="checkbox" data-hero="${i}" ${v ? "checked" : ""} aria-label="Hero status, level ${i + 1}"><span>${i + 1}</span></label>`)}</div>
        <div class="notes-grid">
          <div>
            <h4 class="sheet-sub">Side quests ${count(`+${50 * st.level} XP each`)}</h4>
            <ul class="vs-list vs-quests">${c.quests.map((q, i) => html`<li class="${q.done ? "is-done" : ""}"><input data-quest="${i}" value="${q.text}" aria-label="Side quest">
              ${q.done ? html`<span class="vs-tag">done</span>` : button("Done", { icon: "check", size: "sm", attrs: html`data-quest-done="${i}"` })}
              ${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-quest-del="${i}" aria-label="Remove quest"` })}</li>`)}</ul>
            ${button("Add quest", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="add-quest"` })}
          </div>
          <div>
            <h4 class="sheet-sub">Bio enhancements ${count(`${c.bio.length}/6`)}</h4>
            <ul class="vs-list vs-bio">${c.bio.map((b, i) => html`<li><span class="vs-bio-n">${i + 1}</span><input data-bio="${i}" value="${b}" placeholder="Benefit" aria-label="Enhancement ${i + 1}">${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-bio-del="${i}" aria-label="Remove"` })}</li>`)}
              <li class="vs-skull ${c.bio.length >= 7 ? "is-on" : ""}">${icon("skull", { size: 16 })}<span>${c.bio.length >= 7 ? "The ship's AI has taken control. Mission failed." : "A 7th enhancement fails the mission."}</span></li></ul>
            ${c.bio.length < 7 ? button("Add enhancement", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="add-bio"` }) : ""}
          </div>
          <div>
            <h4 class="sheet-sub">Access codes</h4>
            <div class="grid">${(["alpha", "beta", "gamma"] as const).map((k) => stepper(`access.${k}`, c.access[k], { label: k[0].toUpperCase() + k.slice(1), min: 0 }))}</div>
          </div>
        </div>
        <div class="notes-grid">
          <label class="field">Narrative moments<textarea data-k="narrative">${c.narrative}</textarea></label>
          <label class="field">Notes (L7 designation, Void Portals, Arc Cells…)<textarea data-k="notes">${c.notes}</textarea></label>
        </div>`,
        { eyebrow: "Story", title: "Hero status, quests & notes", attrs: html`data-span="2"` },
      )}

      ${card(
        html`<ul class="vs-list vs-craft">${craftingItems(c.profession).map((it) => html`<li><div><strong>${it.name}</strong> <span class="muted">${it.ingredients}</span><p class="sheet-hint">${it.effect}</p></div>${button("Craft", { icon: "hammer", size: "sm", attrs: html`data-craft="${it.name}"` })}</li>`)}</ul>
        ${rule("Out of combat, single use. The item and its ingredients are destroyed after use and can't be salvaged. Crafting adds the item to your small items.")}`,
        { eyebrow: c.profession, title: "Profession crafting" },
      )}

      ${card(
        html`<div class="step-actions vs-xp">${XP_SOURCES.map((x) => button(`${x.label} (+${x.per * st.level})`, { icon: "plus", size: "sm", attrs: html`data-xp="${x.per * st.level}" data-xp-label="${x.label}"` }))}</div>
        ${rule("Melee kills give the alien card's XP (Combat adds it). Entering levels 6, 7 and 8 gives +500, +800 and +1000.")}`,
        { eyebrow: "Experience", title: "XP sources" },
      )}
      </div>`);
  };

  const draw = () => {
    // keep focus on the control being edited across a redraw
    const a = document.activeElement as HTMLElement | null;
    const sel = a && root.contains(a)
      ? (["data-k", "name", "data-large", "data-quest", "data-bio", "data-armod", "data-draft"] as const)
          .map((k) => (a.getAttribute(k) != null ? `[${k}="${CSS.escape(a.getAttribute(k)!)}"]` : ""))
          .find(Boolean)
      : "";
    if (creating) drawCreate();
    else drawSheet();
    if (sel) root.querySelector<HTMLElement>(sel)?.focus();
  };

  const notifyLevel = (ch: LevelChange | undefined) => {
    if (!ch) return;
    const msg = levelChangeText(c, ch);
    if (!msg) return;
    if (ch.to > ch.from) playSfx("level-up");
    ctx.toast(msg);
  };
  const commit = (redraw = false) => {
    if (!live) return;
    saveVChar(c, SOURCE);
    if (redraw) draw();
  };

  // hide portrait tiles whose picture is missing; say so when a whole style has none
  root.addEventListener(
    "error",
    (e) => {
      const img = e.target as HTMLElement;
      if (img.tagName !== "IMG" || !img.closest(".vs-gallery")) return;
      const tile = img.closest<HTMLElement>(".portrait-pick");
      if (tile) tile.hidden = true;
      const g = img.closest(".vs-gallery")!;
      if (![...g.querySelectorAll<HTMLElement>(".portrait-pick")].some((t) => !t.hidden))
        g.querySelector<HTMLElement>(".vs-gallery-empty")!.hidden = false;
    },
    true,
  );

  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (creating) {
      if (el.dataset.draft === "name") draft.name = el.value;
      return;
    }
    if (el.dataset.k) {
      const k = el.dataset.k;
      (c as any)[k] = el.value;
      if (k === "name") {
        const h = root.querySelector(".char-name");
        if (h) h.textContent = c.name || "Survivor";
        if (!c.portrait) {
          const t = document.createElement("template");
          setHTML(t, portrait(c, "lg"));
          if (t.content.firstElementChild) root.querySelector(".portrait-btn .portrait")?.replaceWith(t.content.firstElementChild);
        }
      }
      return commit(el.tagName === "SELECT");
    }
    if (el.dataset.large) {
      c.large[+el.dataset.large] = el.value;
      return commit();
    }
    if (el.dataset.quest) {
      c.quests[+el.dataset.quest].text = el.value;
      return commit();
    }
    if (el.dataset.bio) {
      c.bio[+el.dataset.bio] = el.value;
      return commit();
    }
    if (el.dataset.armod) {
      c.armour[+el.dataset.armod].mod = Math.min(0, parseInt(el.value, 10) || 0);
      return commit();
    }
    if (el.name && el.type === "number") {
      const v = parseInt(el.value, 10) || 0;
      if (el.name === "xp") {
        notifyLevel(setXp(c, v));
        return commit(true);
      }
      if (el.name === "stunned" || el.name === "bloodied") return;
      setPath(c, el.name, v);
      return commit(true);
    }
  });

  root.addEventListener("change", async (e) => {
    const el = e.target as HTMLInputElement;
    if (creating) {
      if (el.dataset.draft === "profession") draft.profession = el.value as Profession;
      else if (el.dataset.draft === "weapon") {
        draft.weapon = el.value as MeleeWeapon;
        draft.man = [];
      } else if (el.dataset.draft === "armour") draft.armour = +el.value;
      else if (el.dataset.draftMan) {
        const n = el.dataset.draftMan;
        draft.man = el.checked ? [...draft.man, n].slice(0, 2) : draft.man.filter((x) => x !== n);
      } else return;
      return draw();
    }
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
      if (!setPortrait(c, pic, (x) => saveVChar(x, SOURCE), () => loadVChar().portrait))
        ctx.toast("Couldn't save the picture on this device (storage is full). Try a smaller image.");
      return draw();
    }
    if (el.type !== "checkbox") return;
    const n = +el.dataset.n!;
    if (el.dataset.box) {
      const k = el.dataset.box as "bloodied" | "stunned" | "rangedHits";
      c[k] = el.checked ? n : n - 1;
    } else if (el.dataset.ste) {
      const t = el.dataset.ste as SteTask;
      if (el.checked && n >= 4) {
        c.ste[t] = 3;
        const r = tickSte(c, t);
        ctx.toast(r.gained ? `Specific Task Experience: +1 ${r.gained === "technical" ? "Technical" : "Coding"}.` : "That skill is already at its cap of 10.");
      } else c.ste[t] = el.checked ? n : n - 1;
    } else if (el.dataset.hero) c.hero[+el.dataset.hero] = el.checked;
    commit(true);
  });

  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    const d = b.dataset;
    const act = d.act;
    const st = () => vstats(c);

    // creation
    if (act === "create") return create();
    if (act === "cancel-new") {
      creating = false;
      c = loadVChar();
      return draw();
    }
    if (act === "import") {
      const data = await importJSON(validateVChar);
      if (!data || !live) return;
      c = normaliseVChar(data);
      creating = false;
      saveVChar(c, SOURCE + "-import");
      return draw();
    }
    if (creating) return;

    // portraits
    if (d.style) {
      style = d.style as VoidArtStyle;
      writeStyle(style);
      draw();
      return root.querySelector<HTMLElement>(`[data-style="${style}"]`)?.focus();
    }
    if (d.pick) {
      let pic: string;
      try {
        pic = await portraitFromUrl(voidPortraitUrl(style, d.pick));
      } catch {
        return ctx.toast("Couldn't load that portrait.");
      }
      if (!live) return;
      if (!setPortrait(c, pic, (x) => saveVChar(x, SOURCE), () => loadVChar().portrait)) ctx.toast("Couldn't save the picture on this device (storage is full).");
      gallery = false;
      draw();
      return root.querySelector<HTMLElement>('[data-act="gallery"]')?.focus();
    }
    if (act === "gallery") {
      gallery = !gallery;
      draw();
      return root.querySelector<HTMLElement>('[data-act="gallery"]')?.focus();
    }
    if (act === "portrait") return root.querySelector<HTMLInputElement>("[data-portrait-file]")?.click();
    if (act === "no-portrait") {
      delete c.portrait;
      return commit(true);
    }

    if (act === "new") {
      if (!confirm("Start a new survivor? The current sheet will be replaced when you create one (export it first to keep it).")) return;
      draft = { name: "", profession: "Freighter Captain", weapon: "Ion Baton", man: [], armour: 0 };
      creating = true;
      return draw();
    }
    if (act === "export") return exportJSON(`void-survivor-${c.name || "survivor"}`, c);

    // HP and conditions
    if (act === "damage" || act === "heal") {
      const v = parseInt(prompt(act === "damage" ? "Damage taken?" : "HP healed? (stops at the baseline)", "1") || "", 10);
      if (!(v > 0)) return;
      if (act === "damage") {
        if (applyDamage(c, v).down) ctx.toast("0 HP: you're unconscious.");
      } else heal(c, v);
      return commit(true);
    }
    if (act === "rfut1") {
      const ref = tableBySection("void/p81-2");
      if (ref) await rollAndLog(ref, 0, undefined, "Recovery from unconsciousness");
      return;
    }
    if (d.clear) {
      c[d.clear as "bloodied" | "stunned"] = 0;
      return commit(true);
    }
    if (act === "stun") {
      const v = parseInt(prompt("Stunned for how many rooms?", "3") || "", 10);
      if (!(v > 0)) return;
      stun(c, v);
      return commit(true);
    }
    if (act === "room") {
      const msgs = enterRoom(c);
      if (msgs.length) ctx.toast(msgs.join(" "));
      return commit(true);
    }

    // skill check
    if (act === "check") {
      const skill = root.querySelector<HTMLSelectElement>('[data-check="skill"]')!.value as "technical" | "coding";
      const modText = root.querySelector<HTMLInputElement>('[data-check="mod"]')!.value;
      const task = root.querySelector<HTMLSelectElement>('[data-check="task"]')!.value as SteTask | "";
      const m = modText.replace(/[−–]/g, "-").match(/([+-]?\d+)/);
      const mod = m ? +m[1] : 0;
      const special = task ? specialApplies(c, skill, task) : false;
      const r = await rollDice("2D6");
      if (!live) return;
      const res = skillCheck(c, skill, r.value, mod, special);
      let msg = `${skill === "technical" ? "Technical" : "Coding"} check: rolled ${r.value}${mod ? ` ${signed(mod)}` : ""}${special ? ` −1 (${st().special.name})` : ""} = ${res.total} vs ${res.target}. ${res.pass ? "Pass!" : "Fail."}`;
      if (res.pass && task) {
        const g = tickSte(c, task);
        msg += ` STE: ${STE_TASKS.find((t) => t.id === task)!.name} ticked${g.gained ? `, +1 ${g.gained === "technical" ? "Technical" : "Coding"}!` : "."}`;
        commit(true);
      }
      return ctx.toast(msg);
    }

    // manoeuvres
    if (d.learn) {
      const m = weaponManoeuvres(c.weapon).find((x) => x.name === d.learn);
      if (!m) return;
      if (c.manoeuvres.length >= st().manoeuvres) return ctx.toast(`You have ${st().manoeuvres} manoeuvre slots. Forget one first (you may swap one per level gained).`);
      if (m.level > st().maxManLevel) return ctx.toast(`Level ${m.level} manoeuvres need a higher character level.`);
      const same = c.manoeuvres.find((x) => x.dice === m.dice);
      if (same) return ctx.toast(`${same.name} already uses ${m.dice}. Forget it first to learn ${m.name}.`);
      c.manoeuvres.push(m);
      return commit(true);
    }
    if (d.unlearn) {
      c.manoeuvres.splice(+d.unlearn, 1);
      return commit(true);
    }

    // armour
    if (d.yellow) {
      const [ai, gi, k] = d.yellow.split(":").map(Number);
      const y = c.armour[ai].yellow;
      y[gi] = y[gi] ?? [];
      y[gi][k] = !y[gi][k];
      return commit(true);
    }
    if (act === "wear") {
      const i = root.querySelector<HTMLSelectElement>('[data-add="armour"]')!.value;
      if (i === "") return;
      const r = armourTable()[+i];
      const why = wearProblem(c, r.name);
      if (why) return ctx.toast(why);
      c.armour.push(armourPiece(r));
      const li = c.large.findIndex((s) => s.trim().toLowerCase() === r.name.toLowerCase());
      if (li >= 0) c.large[li] = ""; // putting on a carried piece frees its large slot
      return commit(true);
    }
    if (d.unwear) {
      const a = c.armour[+d.unwear];
      if (!addLarge(c, a.name)) return ctx.toast("All 10 large item slots are full: drop something first.");
      c.armour.splice(+d.unwear, 1);
      return commit(true);
    }
    if (d.dropArmour) {
      if (!confirm(`Discard ${c.armour[+d.dropArmour].name}?`)) return;
      c.armour.splice(+d.dropArmour, 1);
      return commit(true);
    }

    // ranged
    if (act === "add-ranged") {
      const id = root.querySelector<HTMLSelectElement>('[data-add="ranged"]')!.value;
      const w = id ? weaponFromCard(id) : null;
      if (!w) return;
      const why = rangedProblem(c, w.size);
      if (why) return ctx.toast(`${why} Leave one behind first.`);
      c.ranged.push(w);
      return commit(true);
    }
    if (d.dropRanged) {
      if (!confirm(`Leave ${c.ranged[+d.dropRanged].name} behind?`)) return;
      c.ranged.splice(+d.dropRanged, 1);
      return commit(true);
    }
    if (d.reload) {
      reload(c, +d.reload);
      return commit(true);
    }
    if (act === "hit") {
      const r = addRangedHit(c);
      if (r.filled) {
        playSfx("level-up");
        ctx.toast(`Ranged hits bar full: Marksmanship ${c.marksmanship}, +${r.xp} XP.`);
        notifyLevel(r.level);
      }
      return commit(true);
    }

    // stims
    if (d.useStim) {
      const s = c.stims[+d.useStim];
      const info = stimInfo(s.type);
      const choice = info && /Technical or/i.test(info.effect) ? (confirm(`${s.type}: boost Technical? (Cancel for Coding)`) ? "technical" : "coding") : "technical";
      const r = useStim(c, +d.useStim, choice);
      if (!r) return;
      playSfx("stim");
      ctx.toast(`${r.type} stim: ${r.text}`);
      return commit(true);
    }
    if (d.fill) {
      const type = root.querySelector<HTMLSelectElement>(`[data-fill-type="${d.fill}"]`)!.value;
      if (!type) return ctx.toast("Pick the stim to make first.");
      const r = fillStim(c, +d.fill, type);
      if (!r.ok) return ctx.toast(r.reason!);
      ctx.toast(`${type} stim made in the Stim Dock: +${10 * vstats(c).level} XP.`);
      notifyLevel(r.level);
      return commit(true);
    }
    if (d.dropStim) {
      c.stims.splice(+d.dropStim, 1);
      return commit(true);
    }
    if (act === "add-stim") {
      const v = root.querySelector<HTMLSelectElement>('[data-add="stim"]')!.value;
      if (!v || c.stims.length >= MAX_STIMS) return;
      c.stims.push({ type: v === "-" ? "" : v });
      return commit(true);
    }
    if (act === "stit1" || act === "gact1") {
      const ref = tableBySection(act === "stit1" ? "void/p91-5" : "void/p91-3");
      if (!ref) return;
      const r = await rollAndLog(ref, 0, undefined, act === "stit1" ? "Random stim" : "Random gas cartridge");
      if (!live) return;
      const text = r.cells.join(" ");
      if (act === "gact1") {
        const g = GASES.find((x) => text.toLowerCase().includes(GAS_NAMES[x].toLowerCase()));
        if (g) {
          c.gas[g]++;
          ctx.toast(`${GAS_NAMES[g]} gas cartridge added.`);
          commit(true);
        }
      } else {
        const t = stimTable().find((x) => text.toLowerCase().includes(x.type.toLowerCase()));
        if (t && c.stims.length < MAX_STIMS) {
          c.stims.push({ type: t.type });
          ctx.toast(`${t.type} stim added.`);
          commit(true);
        } else if (t) ctx.toast(`${t.type} stim found, but all 5 stim slots are full.`);
      }
      return;
    }
    if (d.endEffect) {
      c.effects.splice(+d.endEffect, 1);
      return commit(true);
    }
    if (act === "end-combat") {
      endCombat(c);
      return commit(true);
    }

    // rest and levels
    if (act === "tent") {
      const hulkLevel = c.hero.filter(Boolean).length + 1;
      if (c.tentUses >= tentAllowed(hulkLevel) && !confirm("You've already used the Camo Tent on this level. Use it anyway?")) return;
      const had = c.rations;
      const g = camoRest(c);
      ctx.toast(`Camo Tent: +${g} HP${had ? " (ration eaten)" : " (no ration: half baseline)"}. Stunned removed.`);
      return commit(true);
    }
    if (d.eat) {
      const food = d.eat as "ration" | "parts" | "none";
      if (food === "ration" && !c.rations) return ctx.toast("You have no rations.");
      if (food === "parts" && c.rationParts < 2) return ctx.toast("You need two food parts.");
      const lost = eatBetweenLevels(c, food);
      ctx.toast(lost ? `You go hungry: −${lost} HP.` : "You eat a ration.");
      return commit(true);
    }
    if (d.rest) {
      const g = restBetweenLevels(c, d.rest === "1");
      ctx.toast(`Rested: +${g} HP (not above baseline).`);
      return commit(true);
    }
    if (act === "next-level") {
      if (!confirm("Start the next Dark Hulk level? Level-long effects and this-level Marksmanship changes end, and the Camo Tent is available again. (Tick the Hero Status box for the level you finished.)")) return;
      startHulkLevel(c);
      return commit(true);
    }

    // story
    if (act === "add-quest") {
      c.quests.push({ text: "", done: false });
      commit(true);
      return root.querySelector<HTMLElement>(`[data-quest="${c.quests.length - 1}"]`)?.focus();
    }
    if (d.questDone) {
      c.quests[+d.questDone].done = true;
      const xp = 50 * st().level;
      ctx.toast(`Side quest complete: +${xp} XP.`);
      notifyLevel(addXp(c, xp));
      return commit(true);
    }
    if (d.questDel) {
      c.quests.splice(+d.questDel, 1);
      return commit(true);
    }
    if (act === "add-bio") {
      c.bio.push("");
      if (c.bio.length >= 7) ctx.toast("A 7th biological enhancement: the ship's AI takes control. The mission has failed.");
      commit(true);
      return root.querySelector<HTMLElement>(`[data-bio="${c.bio.length - 1}"]`)?.focus();
    }
    if (d.bioDel) {
      c.bio.splice(+d.bioDel, 1);
      return commit(true);
    }
    if (d.craft) {
      c.small = [c.small.trim(), `${d.craft} (crafted)`].filter(Boolean).join(", ");
      ctx.toast(`${d.craft} crafted and added to your small items. Remove its ingredients.`);
      return commit(true);
    }
    if (d.xp) {
      const xp = +d.xp;
      ctx.toast(`${d.xpLabel}: +${xp} XP.`);
      notifyLevel(addXp(c, xp));
      return commit(true);
    }
  });

  wireSteppers(root);
  // another tool or the character bar changed the survivor: show it (our own saves are on screen)
  ctx.onDispose(
    ctx.events.on("void:changed", ({ source }) => {
      if (source === SOURCE || creating) return;
      if (source !== "vsheet-new" && source !== "vsheet-import") {
        c = loadVChar();
        draw();
      }
    }),
  );
  draw();
  makeCardsArrangeable(root, "2d6v:shell:panes:vsheet", ctx.onDispose);
}

