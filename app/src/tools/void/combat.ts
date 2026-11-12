// 2D6 Void Combat (rules: docs/spec-void.md §3, state machine §3.6; UNCLEAR readings in combatmodel.ts).
// Setup → pre-combat throw → ranged phase (firing cases) → close combat rounds → victory or defeat.
// HP, ammo, armour, stims, XP and Marksmanship live on the character (sheetmodel.ts) so the
// character bar follows the fight. Saved under "vcombat"; its `phase` drives the fight music.
import type { ToolContext } from "../../main";
import { rollDice } from "../../dice3d";
import { followOns, isTableRef, tableByCode } from "../../rolltable";
import { makeCardsArrangeable } from "../../shell/arrangecards";
import { bus } from "../../shell/events";
import { rollAndLog } from "../../shell/panels/results";
import { button, card, chip, eyebrow } from "../../ui/components";
import { icon } from "../../ui/icon";
import { playSfx } from "../../audio/sound";
import { load, save } from "../common";
import { html, joinHtml, setHTML, type Raw } from "../../ui/html";
import { plainText } from "../../shell/journalprose";
import { voidBookLoaded } from "../../content";
import { em, logNodes, span, strong, type LogNode } from "../combatlog";
import {
  addRangedHit, addXp, applyDamage, bloody, damageArmour, endCombat, hasVChar, heal, levelChangeText, loadVChar, marksmanship, meleeManoeuvres,
  parseDamage, reload, saveVChar, setHp, shiftPoints, stun, useAmmo, useStim, vstats, type VoidCharacter,
} from "./sheetmodel";
import {
  CASE_TEXT, D66, THROWS, TURRET_PRESETS, TYPE_NAMES, alienChoice, alienDeflect, alienIndex, armourCheck, armourSets, burstAmmo, cardEffect, conditional,
  damageFromFaces, diceAvg, diceText, doublesEffect, doublesRow, fatigueBonus, fightXp, finalDamage, findAlien, firingCase, firingPlan, hullAllows,
  hullOkName, insightMod, interruptFor, makeTurret, meleeDeflect, outnumberedBonus, parseDoubles, parseSettings, rangedDeflect, reachable,
  patrolSpecial, resolveThrow, searchAliens, shotHits, stimCombat, stimShotMod, throwProblem, tooPowerful, weaponSpecial,
  type Alien, type CardEffect, type Dice, type KillBy, type ThrowKind,
} from "./combatmodel";

const KEY = "vcombat";
type Phase = "setup" | "you" | "foes" | "won" | "lost";
type Stage = "pre" | "ranged" | "melee";

interface Foe extends Alien {
  id: number;
  hpNow: number;
  hpMax: number;
  shMod: number; // patrol SPECIAL / room text / gadgets, whole fight
  netted: boolean; // Charged Net or Grappling Hook: Shift 0 (still gains Fatigue Shift)
  restrained: boolean; // −2 to your Shot Rolls until freed
  skip: number; // attacks it will miss
  shiftNext: { n: number; round: number } | null;
  firstRoundShift: number; // weapons that slow the target: Shift in melee round 1
  earlyShift: number; // patrol SPECIAL: Shift in the first earlyRounds rounds
  earlyRounds: number;
  killedBy: KillBy | null;
  noXp: boolean;
  ticked: boolean; // Ranged Hits ticked for this enemy
  shotsUsed: number;
  noReturnFire: boolean; // knocked back: misses its next shot
  diffused: boolean; // Diffusion Grenade: no pre-combat fire, can't defend your first melee attack
}

/** What the Hulk turn hands over: one or more aliens to fight, and the room's conditions. */
interface Pending {
  name: string;
  sectionId?: string;
  from?: string; // "vhulk"
  level?: number;
  room?: number;
  special?: string; // a patrol table's SPECIAL text
  hp?: number;
  note?: string;
  hull?: boolean;
  reinforced?: boolean;
  surprised?: boolean;
  alienFirst?: boolean;
}

/** A combat-log entry: the stage tag ("R2", "Shots", "Pre") and its nodes (data, never markup: see combatlog.ts). */
interface VLog { t: string; n: LogNode[] }

interface Cond { hull: boolean; reinforced: boolean; surprised: boolean; alienFirst: boolean; outnumbered: boolean; armourChecks: boolean; stealth: boolean }

interface State {
  phase: Phase;
  stage: Stage;
  foes: Foe[];
  nextId: number;
  cond: Cond;
  // ranged
  rcase: 0 | 1 | 2 | 3 | 4;
  plan: ("you" | "alien")[];
  step: number;
  alienIdx: number; // which armed alien fires next in an "alien" step
  closing: boolean; // case 3: you've chosen to close in
  alienMod: number; // −1 when you charge (case 4)
  weapon: number;
  setting: number;
  locked: number[]; // weapons that can't fire again this combat
  turretDone: boolean;
  // close combat
  round: number;
  fatigue: number;
  target: number | null;
  attack: { p: number; s: number } | null;
  foeTurn: number;
  killedRound1: boolean;
  momentumUsed: boolean;
  oilRounds: number; // Oil Bomb: no interrupts through this round
  youSkip: number;
  youShiftNext: { n: number; round: number } | null;
  firstHitDone: boolean;
  freeShot: boolean;
  thrown: boolean;
  pipe: "none" | "recover" | "lost" | "done";
  throwKind: ThrowKind;
  throwMod: number;
  xpBanked: boolean;
  log: (VLog | string)[]; // a `string` was saved as markup by an older version: shown as plain text
  pending: Pending[] | Pending | null;
}

const COND0: Cond = { hull: false, reinforced: false, surprised: false, alienFirst: false, outnumbered: false, armourChecks: false, stealth: false };
const fresh = (): State => ({
  phase: "setup", stage: "pre", foes: [], nextId: 1, cond: { ...COND0 }, rcase: 0, plan: [], step: 0, alienIdx: 0, closing: false, alienMod: 0, weapon: 0, setting: 0,
  locked: [], turretDone: false, round: 1, fatigue: 1, target: null, attack: null, foeTurn: 0, killedRound1: false, momentumUsed: false, oilRounds: 0, youSkip: 0,
  youShiftNext: null, firstHitDone: false, freeShot: false, thrown: false, pipe: "none", throwKind: "pipe", throwMod: 0, xpBanked: false, log: [], pending: null,
});

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
const diceFaces = (a: number, b: number) =>
  html`<span class="dice-pair" aria-label="${D66(a, b)}"><span class="die-face">${a}</span><span class="die-face">${b}</span></span>`;
const hpBar = (pct: number, foe = false) => html`<div class="hp-bar${foe ? " foe-bar" : ""}"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
const rule = (text: string) => html`<p class="vc-rule">${icon("book-open", { size: 13 })}<span>${text}</span></p>`;

async function rollD(d: Dice) {
  if (d.dice <= 0) return damageFromFaces(d, []);
  const r = await rollDice(`${d.dice}D6`);
  return damageFromFaces(d, r.dice);
}

export function render(root: HTMLElement, ctx: ToolContext) {
  const all = alienIndex(ctx.lib.sections);
  root.classList.add("play-page", "vcombat-page");
  let st: State = { ...fresh(), ...load<State>(KEY, fresh()) };
  st.cond = { ...COND0, ...st.cond };
  if (!Array.isArray(st.log)) st.log = [];
  let query = "";
  let live = true;
  ctx.onDispose(() => (live = false));
  const persist = () => {
    if (!live) return;
    save(KEY, st);
    bus.emit("void:changed", { source: KEY });
  };
  const log = (...n: LogNode[]) => st.log.unshift({ t: st.stage === "melee" ? `R${st.round}` : st.stage === "ranged" ? "Shots" : "Pre", n });
  const logEntry = (e: VLog | string): Raw =>
    typeof e === "string" ? html`${plainText(e)}` : html`<span class="muted">${String(e?.t ?? "")}</span> ${logNodes(e?.n, ctx.inline)}`;
  const alive = () => st.foes.filter((f) => f.hpNow > 0);
  const meleeFoes = () => alive().filter((f) => !f.turret);
  const targetFoe = () => st.foes.find((f) => f.id === st.target && f.hpNow > 0) ?? alive()[0];
  const ctxRoom = () => ({ hull: st.cond.hull, reinforced: st.cond.reinforced || st.foes.some((f) => f.turret) });
  const turretFight = () => st.foes.length > 0 && st.foes.every((f) => f.turret);

  const char = (): VoidCharacter | null => (hasVChar() ? loadVChar() : null);
  const saveC = (c: VoidCharacter) => saveVChar(c, KEY);

  // ---------- derived ----------
  function youShift(c: VoidCharacter) {
    return (
      shiftPoints(c) + fatigueBonus(st.fatigue) + (st.killedRound1 && st.round === 2 && st.foes.length > 1 ? 2 : 0) + (st.youShiftNext && st.youShiftNext.round === st.round ? st.youShiftNext.n : 0)
    );
  }
  function foeShift(f: Foe) {
    const living = meleeFoes();
    const i = living.findIndex((x) => x.id === f.id);
    const fat = f.interrupts.some((x) => /not affected by fatigue/i.test(x.special)) ? 0 : fatigueBonus(st.fatigue);
    return Math.max(
      0,
      (f.netted ? 0 : f.sh + f.shMod) + fat + (st.cond.outnumbered ? outnumberedBonus(i) : 0) + (f.shiftNext && f.shiftNext.round === st.round ? f.shiftNext.n : 0) + (st.round === 1 ? f.firstRoundShift : 0) + (st.round <= (f.earlyRounds ?? 0) ? f.earlyShift ?? 0 : 0),
    );
  }
  /** Why weapon i can't fire now, or null. */
  function weaponProblem(c: VoidCharacter, i: number, f?: Foe): string | null {
    const w = c.ranged[i];
    if (!w) return "No weapon.";
    if (st.locked.includes(i)) return "It can't fire again this combat.";
    if (!hullAllows(ctxRoom(), hullOkName(w.name))) return "This room touches the outer hull: only weapons marked * may fire.";
    const set = parseSettings(w.settings)[st.setting] ?? parseSettings(w.settings)[0];
    const need = set.burst ? burstAmmo(w.capacity) : 1;
    if (w.ammo < need) return w.ammo ? `Burst needs ${need} rounds loaded.` : "Out of ammo.";
    if (f && weaponSpecial(w.special).bioOnly && f.type !== "B") return "This weapon only works against Biological aliens.";
    return null;
  }
  const youCanFire = (c: VoidCharacter | null) => !!c && !st.cond.surprised && c.ranged.some((_w, i) => !st.locked.includes(i) && hullAllows(ctxRoom(), hullOkName(c.ranged[i].name)) && c.ranged[i].ammo > 0);
  const alienCanFire = (f: Foe) =>
    f.hpNow > 0 && !!f.ranged && hullAllows(ctxRoom(), f.ranged.hullOk) && !(f.ranged.uses && f.shotsUsed >= f.ranged.uses) && !f.diffused;
  const armedFoes = () => alive().filter(alienCanFire);

  // ---------- views ----------
  function foeCard(f: Foe) {
    const dead = f.hpNow <= 0;
    const targeted = st.target === f.id && !dead && st.phase !== "setup";
    const c = char();
    const tp = c && !f.turret && tooPowerful(f, armourSets(c.armour));
    const setupCtl =
      st.phase === "setup"
        ? html`<div class="vc-foe-ctl">
        <label class="vc-mini">Shift ${f.shMod ? signed(f.shMod) : "±0"} <span class="stepper-ctl"><button data-fsh="${f.id}" data-d="-1" aria-label="Lower Shift">${icon("minus", { size: 13 })}</button><button data-fsh="${f.id}" data-d="1" aria-label="Raise Shift">${icon("plus", { size: 13 })}</button></span></label>
        <label class="vc-check"><input type="checkbox" data-fflag="skip" data-id="${f.id}" ${f.skip ? "checked" : ""}> misses the first round</label>
        <label class="vc-check"><input type="checkbox" data-fflag="netted" data-id="${f.id}" ${f.netted ? "checked" : ""}> netted (Shift 0)</label>
        <label class="vc-check"><input type="checkbox" data-fflag="restrained" data-id="${f.id}" ${f.restrained ? "checked" : ""}> restrained (−2 to your shots)</label>
        ${tp ? html`<p class="vc-warn">${icon("shield", { size: 13 })} Too powerful: your armour cancels all its attacks. ${button("It dies", { size: "sm", attrs: html`data-toopowerful="${f.id}"` })}</p>${rule("U40 reading: every manoeuvre's highest damage is cancelled by the armour piece that deflects it.")}` : ""}
      </div>`
        : "";
    const badges = [
      f.turret ? "turret" : "",
      f.netted ? "netted" : "",
      f.restrained ? "restrained" : "",
      f.diffused ? "EMP'd" : "",
      f.skip ? `misses ${f.skip === 1 ? "next" : f.skip} round${f.skip > 1 ? "s" : ""}` : "",
    ].filter(Boolean);
    return html`<div class="foe ${dead ? "dead" : ""} ${targeted ? "targeted" : ""}" data-foe="${f.id}">
      <div class="foe-head"><div class="foe-name"><strong>${f.name}</strong><span class="muted">${f.turret ? "Turret" : `L${f.level} ${TYPE_NAMES[f.type] ?? ""}`} · SH ${signed(f.sh)} · ${f.xp} XP${f.ranged ? ` · ${f.ranged.name} M${f.ranged.marks}` : ""}</span></div>
        ${
          dead
            ? html`<span class="badge">${icon("skull", { size: 13 })} ${f.killedBy === "melee" ? "defeated" : f.killedBy === "ranged" ? "shot down" : "down"}</span>`
            : st.phase !== "setup"
              ? button("Target", { icon: targeted ? "crosshair" : undefined, size: "sm", variant: targeted ? "primary" : undefined, attrs: html`data-target="${f.id}" aria-pressed="${String(targeted)}"` })
              : button("Remove", { icon: "x", size: "sm", variant: "ghost", attrs: html`data-remove="${f.id}"` })
        }</div>
      ${badges.length ? html`<div class="vc-badges">${badges.map((b) => html`<span class="badge">${b}</span>`)}</div>` : ""}
      <div class="hp-line"><span class="stepper-ctl"><button data-fhp="${f.id}" data-d="-1" aria-label="Lower ${f.name} HP">${icon("minus", { size: 15 })}</button><input value="${f.hpNow}" readonly aria-label="${f.name} HP"><button data-fhp="${f.id}" data-d="1" aria-label="Raise ${f.name} HP">${icon("plus", { size: 15 })}</button></span>
        <span class="muted">/ ${f.hpMax} HP</span></div>
      ${hpBar((f.hpNow / Math.max(1, f.hpMax)) * 100, true)}
      ${setupCtl}
      <details><summary class="muted">Card</summary>
        <dl class="kv"><dt>Manoeuvres</dt><dd>${f.man.length ? joinHtml(f.man.map((m) => m.text), html`<br>`) : "—"}</dd>
        <dt>Interrupt</dt><dd>${f.interruptText || "None"}</dd>
        <dt>Deflection</dt><dd>${f.deflectionText || "none"} <span class="muted">(red-boxed, for your shots)</span></dd>
        <dt>Ranged</dt><dd>${f.rangedText || "None"}</dd>
        ${f.mishap ? html`<dt>[1][1] Mishap</dt><dd>${ctx.inline(f.mishap)}</dd>` : ""}${f.prime ? html`<dt>[6][6] Prime</dt><dd>${ctx.inline(f.prime)}</dd>` : ""}
        <dt>Cache</dt><dd>${ctx.inline(f.cache || "None")}</dd></dl>
        ${f.desc ? html`<p class="muted">${f.desc}</p>` : ""}
        ${f.sectionId ? html`<a href="#/s/${encodeURIComponent(f.sectionId)}">Open the card in the book</a>` : ""}</details>
    </div>`;
  }

  const pendingList = (): Pending[] => (Array.isArray(st.pending) ? st.pending : st.pending ? [st.pending] : []);

  function setupView() {
    const list = searchAliens(all, query).slice(0, 80);
    const c = char();
    const cb = (k: keyof Cond, label: string, hint = "") =>
      html`<label class="vc-check"><input type="checkbox" data-cond="${k}" ${st.cond[k] ? "checked" : ""}><span>${label}${hint ? html` <span class="muted">${hint}</span>` : ""}</span></label>`;
    const pend = pendingList();
    return html`${!c ? card(html`<p>Create your survivor on the <a href="#/play/vsheet">Character sheet</a> first: Combat uses its HP, manoeuvres, armour, guns and stims.</p>`, { eyebrow: "No survivor", title: "Who's fighting?", tone: "danger" }) : ""}
      ${pend.length ? card(html`<p>From the Hulk turn: <strong>${pend.map((p) => p.name).join(", ")}</strong>.</p><div class="step-actions">${button("Add to the fight", { icon: "plus", variant: "primary", attrs: html`data-act="take-pending"` })}${button("Dismiss", { variant: "ghost", attrs: html`data-act="drop-pending"` })}</div>`, { eyebrow: "Encounter", title: "A fight is waiting", tone: "accent" }) : ""}
      ${card(
        html`<label class="cb-search-wrap">${icon("search", { size: 17 })}<input id="cb-search" class="cb-search" placeholder="Search alien cards (name, or L3 for level 3)" value="${query}"></label>
      <div class="cb-list">${
        list.length
          ? list.map((a) => html`<button class="cb-pick" data-add="${a.key}"><strong>${a.name}</strong><span class="muted">L${a.level} ${a.type} · ${a.hp} HP · SH ${signed(a.sh)}${a.ranged ? html` · ${icon("crosshair", { size: 11 })}M${a.ranged.marks}` : ""}</span></button>`)
          : html`<p class="muted">${voidBookLoaded() ? "No alien matches." : "No alien cards yet: open your 2D6 Void rulebook in Settings → Books to load them. You can still add a turret below."}</p>`
      }</div>
      <div class="vc-turrets"><span class="eyebrow">Turrets</span>${TURRET_PRESETS.map((t, i) => button(`${t.name} (${t.from})`, { size: "sm", icon: "crosshair", attrs: html`data-turret="${i}"` }))}</div>`,
        { eyebrow: "Setup", title: "Which alien?" },
      )}
      ${card(
        html`<div class="vc-conds">
          ${cb("hull", "The room touches the outer hull", "(no ranged fire, except weapons marked *)")}
          ${cb("reinforced", "Reinforced room *", "(ranged fire allowed)")}
          ${cb("surprised", "You are surprised", "(you can't shoot; it attacks first)")}
          ${cb("alienFirst", "It attacks first", "(Alarm Check, patrol SPECIAL, SLDT1 9)")}
          ${cb("outnumbered", "Optional: Outnumbered", "(each extra alien +1 Shift)")}
          ${cb("armourChecks", "Optional: Armour Checks", "(after a deflection, D6: 5 damaged, 6 destroyed)")}
          ${cb("stealth", "Stealth Shield", "(you fire twice; it can't fire back)")}
        </div>
        ${rule("U25 reading: surprised = no ranged phase and the alien makes the first melee attack. \"Attacks first\" = it makes the first melee attack; shooting happens as normal.")}`,
        { eyebrow: "Conditions", title: "The room" },
      )}
      ${
        st.foes.length
          ? card(
              html`<div class="foes">${st.foes.map(foeCard)}</div>
        <div class="step-actions">${button("Start the fight", { icon: "swords", size: "lg", variant: "primary", attrs: html`data-act="start"${c ? "" : " disabled"}` })}</div>
        <p class="muted step-note">Patrol SPECIAL or room text: set each alien's HP and Shift above. Stims used now are free; in close combat a stim takes your attack.</p>`,
              { eyebrow: `Aliens (${st.foes.length})`, title: "Ready to fight" },
            )
          : ""
      }`;
  }

  function weaponPicker(c: VoidCharacter) {
    if (!c.ranged.length) return html`<p class="muted">You carry no ranged weapon.</p>`;
    const w = c.ranged[st.weapon] ?? c.ranged[0];
    const sets = parseSettings(w.settings);
    return html`<div class="vc-weapons">${c.ranged
      .map((x, i) => chip(x.name, { icon: "crosshair", value: `${x.ammo}/${x.capacity}${st.locked.includes(i) ? " ✕" : ""}`, active: i === st.weapon, attrs: html`data-weapon="${i}"` }))
      }</div>
      <div class="vc-weapons">${sets
        .map((s, i) => chip(s.name, { value: s.burst ? `${s.marks}M +${s.dmg}d · ${burstAmmo(w.capacity)} rds` : `${diceText(parseDamage(w.damage))}`, active: i === st.setting, attrs: html`data-setting="${i}"` }))
        }
        ${w.reserve > 0 && w.ammo < w.capacity ? button(`Reload (${w.reserve} spare)`, { size: "sm", icon: "rotate-ccw", attrs: html`data-act="reload"` }) : ""}</div>
      ${w.special ? html`<p class="muted vc-small">${icon("sparkles", { size: 12 })} ${w.special}</p>` : ""}
      ${sets.length > 1 ? rule("U26 reading: Burst uses a third of the capacity, rounded up, and needs that many rounds loaded.") : ""}`;
  }

  function preView(c: VoidCharacter) {
    const f = targetFoe();
    const prob = throwProblem(st.throwKind, ctxRoom());
    const body = st.thrown
      ? html`<p class="muted">You've used your throw.</p>`
      : html`<div class="vc-weapons">${(Object.keys(THROWS) as ThrowKind[]).map((k) => chip(THROWS[k].name, { active: k === st.throwKind, attrs: html`data-throw="${k}"` }))}</div>
        <p class="vc-small">${THROWS[st.throwKind].text}</p>
        <label class="vc-mini">Damage modifier ${st.throwMod ? signed(st.throwMod) : "±0"} <span class="stepper-ctl"><button data-tmod="-1" aria-label="Lower">${icon("minus", { size: 13 })}</button><button data-tmod="1" aria-label="Raise">${icon("plus", { size: 13 })}</button></span></label>
        ${prob ? html`<p class="vc-warn">${prob}</p>` : ""}
        <div class="step-actions">${button(`Throw at ${f?.name ?? "it"} (D66)`, { icon: "zap", variant: "primary", attrs: html`data-act="throw"${prob || !f ? " disabled" : ""}` })}</div>
        ${rule("It always hits. Primary matching a Primary interrupt, or Secondary a Secondary one, subtracts it (both: both). U35: a pipe does nothing to non-Biological aliens; an Oil Bomb does no damage.")}`;
    return card(
      html`${body}<div class="step-actions">${button("Go to the ranged phase", { icon: "crosshair", size: "lg", variant: st.thrown ? "primary" : undefined, attrs: html`data-act="to-ranged"` })}</div>
      <p class="muted step-note">One throwing weapon at the start, if you carry one (it doesn't use your shot or attack). Profession gadgets: set them on each alien in Setup.</p>`,
      { eyebrow: "Before the fight", title: "Throwing weapon", tone: "accent" },
    );
  }

  function rangedView(c: VoidCharacter) {
    const who = st.plan[st.step];
    const f = targetFoe();
    const caseNote = turretFight() ? "A turret: you can't get closer. Exchange shots until one of you is down, or retreat (it gets one last shot)." : CASE_TEXT[st.rcase];
    const notes = [
      st.rcase === 2 ? rule("U30 reading: you → it → you.") : "",
      st.rcase === 3 && !turretFight() ? rule("U31 reading: guns may fire several times in a shootout.") : "",
      st.foes.length > 1 ? rule("U32 reading: the best armed alien's Marksmanship sets the case; every armed alien fires.") : "",
      turretFight() ? rule("U41 reading: you, then the turret, repeated.") : "",
      rule("U34 reading: shots aren't combat rounds; the Fatigue Die starts with close combat."),
    ];
    if (who === "you") {
      const prob = weaponProblem(c, st.weapon, f);
      const rollMod = (st.rcase === 1 ? -1 : 0) + (f?.restrained ? -2 : 0) + stimShotMod(c.effects);
      const set = parseSettings(c.ranged[st.weapon]?.settings ?? "")[st.setting];
      const need = marksmanship(c) + (set?.marks ?? 0) - rollMod;
      const canClose = st.rcase === 3 && !turretFight() && !st.closing;
      return card(
        html`<p class="vc-small">${caseNote}</p>
        ${weaponPicker(c)}
        ${prob ? html`<p class="vc-warn">${prob}</p>` : html`<p class="vc-small">Hit on 2D6 ≤ <strong>${need}</strong> (Marksmanship ${marksmanship(c)}${set?.marks ? ` ${signed(set.marks)} Burst` : ""}${rollMod ? `, roll ${signed(rollMod)}` : ""}).</p>`}
        <div class="step-actions">
          ${button(`Fire at ${f?.name ?? "it"} (2D6)`, { icon: "crosshair", size: "lg", variant: "primary", attrs: html`data-act="shoot"${prob ? " disabled" : ""}` })}
          ${canClose ? button("Shoot and charge", { icon: "swords", attrs: html`data-act="shoot-close"${prob ? " disabled" : ""}` }) : ""}
          ${canClose || prob ? button(turretFight() ? "Retreat" : prob && st.rcase !== 3 ? "Skip the shot" : "Charge without firing", { variant: "ghost", attrs: html`data-act="${turretFight() ? "retreat" : prob && st.rcase !== 3 ? "skip-shot" : "charge"}"` }) : ""}
          ${turretFight() && !prob ? button("Retreat", { variant: "ghost", attrs: html`data-act="retreat"` }) : ""}
        </div>${notes}
        ${rule("Deflection Roll D66 against its red-boxed numbers (Primary against Primary, Secondary against Secondary). U27 reading: only the best one applies.")}`,
        { eyebrow: `Ranged phase · your shot`, title: `Case ${st.rcase}${st.closing ? " · closing in" : ""}`, tone: "accent" },
      );
    }
    const shooters = armedFoes();
    const s = shooters[st.alienIdx] ?? shooters[0];
    return card(
      html`<p class="vc-small">${caseNote}</p>
      ${s ? html`<p class="vc-small"><strong>${s.name}</strong>: ${s.ranged!.name}, Marksmanship ${s.ranged!.marks}${st.alienMod ? ` (roll ${signed(st.alienMod)})` : ""}, damage ${diceText(s.ranged!.dmg)}.</p>` : ""}
      <div class="step-actions">${s ? button(`Roll for ${s.name} (2D6)`, { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="alien-shoot"` }) : button("Continue", { size: "lg", attrs: html`data-act="alien-skip"` })}</div>
      ${notes}${rule("Your Deflection Roll D66: only the yellow dice of your armour block shots. U29 reading: one piece, the best one. U28: an alien's double has no doubles table.")}`,
      { eyebrow: "Ranged phase · its shot", title: s ? `${s.name} fires` : "No shot", tone: "danger" },
    );
  }

  function attackOptions(c: VoidCharacter): { tone: "" | "prime" | "miss"; body: Raw } {
    const a = st.attack!;
    const mans = meleeManoeuvres(c);
    const pts = youShift(c);
    if (a.p === 1 && a.s === 1) return { tone: "miss", body: html`<div class="rc-title">[1][1]: automatic miss.</div><div class="rc-actions">${button("Continue", { size: "lg", attrs: html`data-act="miss"` })}</div>` };
    if (a.p === 6 && a.s === 6)
      return {
        tone: "prime",
        body: html`<div class="rc-title">${icon("zap", { size: 20 })} [6][6] Prime Attack!</div>
        <div class="rc-text">Pick any manoeuvre as performed exactly. Your total Shift (${pts}) is added and interrupts can't reduce it.</div>
        <div class="man-grid">${mans.map((m, i) => chip(m.name, { icon: "zap", value: `${diceText(m.damage)} +${pts}`, attrs: html`data-hit="${i}" data-prime="1"` }))}</div>
        ${rule("U37 reading: Shift is added once (no Exact Strike bonus on top).")}`,
      };
    const ms = mans.map((m) => ({ ...m, p: m.primary, s: m.secondary }));
    const opts = reachable(a.p, a.s, ms, pts);
    const rest = ms.filter((m) => !opts.some((o) => o.m === m)).map((m) => ({ m, cost: Math.abs(m.p - a.p) + Math.abs(m.s - a.s) }));
    const grid = html`<div class="man-grid">${[
      ...opts.map(({ m, cost }) => chip(`${m.name} ${D66(m.p, m.s)}`, { value: cost ? `shift ${cost}` : "exact", attrs: html`data-hit="${ms.indexOf(m)}"` })),
      ...rest.map(({ m, cost }) => chip(`${m.name} ${D66(m.p, m.s)}`, { value: `shift ${cost}`, disabled: true, attrs: html`title="Out of reach"` })),
    ]}</div>`;
    if (!opts.length)
      return { tone: "miss", body: html`<div class="rc-title">No manoeuvre within reach with ${pts} Shift. Miss.</div>${grid}<div class="rc-actions">${button("Continue", { size: "lg", attrs: html`data-act="miss"` })}</div>` };
    return {
      tone: "",
      body: html`<div class="rc-text">${opts[0].cost === 0 ? html`<strong>Exact Strike!</strong> Your total Shift is added to the damage.` : html`You have <strong>${pts}</strong> Shift point${pts === 1 ? "" : "s"} to move the dice (no wrapping from 6 to 1).`}</div>
      ${grid}<div class="rc-actions">${button("Don't hit", { variant: "ghost", attrs: html`data-act="miss"` })}</div>`,
    };
  }

  function meleeView(c: VoidCharacter) {
    const living = meleeFoes();
    const last = st.log[0] ? html`<div class="last-event"><span class="eyebrow">Last</span> ${logEntry(st.log[0])}</div>` : "";
    if (st.phase === "you") {
      const target = living.length > 1 ? html`<p class="muted step-note">Target: <strong>${targetFoe()?.name ?? ""}</strong> (tap Target on an alien to change)</p>` : "";
      if (st.youSkip > 0)
        return card(html`${last}<p>You miss this round.</p><div class="step-actions">${button("Continue", { size: "lg", variant: "primary", attrs: html`data-act="you-skip"` })}</div>`, { eyebrow: `Round ${st.round} · Your turn`, title: "You're out of action", tone: "accent" });
      if (st.attack) {
        const o = attackOptions(c);
        return html`<article class="result-card attack-card${o.tone ? ` is-${o.tone}` : ""}">
          <header class="rc-head">${eyebrow(`Round ${st.round} · Your attack`)}<span class="rc-dice">D66</span></header>
          ${diceFaces(st.attack.p, st.attack.s)}${o.body}${target}</article>`;
      }
      const stims = c.stims.map((s, i) => ({ s, i })).filter((x) => x.s.type);
      const usable = c.ranged.some((_w, i) => !weaponProblem(c, i));
      return card(
        html`${last}${target}<div class="step-actions">${button("Roll your attack (D66)", { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="attack"` })}
          ${st.freeShot && usable ? button("Take the free shot", { icon: "crosshair", attrs: html`data-act="free-shot"` }) : ""}</div>
        ${stims.length ? html`<div class="vc-weapons"><span class="muted vc-small">Or use a stim (takes your attack):</span>${stims.map((x) => chip(x.s.type, { icon: "droplet", attrs: html`data-stim="${x.i}"` }))}</div>` : ""}
        ${st.round >= 7 ? rule("Round 7 onwards: movement and item interrupts stop counting (U39 reading by name). Armour-like ones still apply.") : ""}`,
        { eyebrow: `Round ${st.round} · Your turn`, title: st.momentumUsed && st.round === 2 ? "Momentum: your free attack" : "Your attack", tone: "accent" },
      );
    }
    const f = living[st.foeTurn];
    return f
      ? card(
          html`${last}<p class="vc-small">Shift ${foeShift(f)} · it shifts to its strongest manoeuvre in reach.</p><div class="step-actions">${button(`Roll for ${f.name} (D66)`, { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="foe-attack"` })}</div>
          ${rule("Your armour: the one piece that deflects most, if its dice match the final dice by position. U38 reading: armour doesn't reduce Prime card damage.")}`,
          { eyebrow: `Round ${st.round} · Its turn`, title: `${f.name} attacks`, tone: "danger" },
        )
      : "";
  }

  function wonView(c: VoidCharacter | null) {
    const xp = fightXp(st.foes);
    const ins = c ? stimCombat(c.effects, vstats(c).level).insight : false;
    const anyRanged = st.foes.some((f) => f.killedBy === "ranged" || f.killedBy === "throw");
    return card(
      html`<div class="step-actions">${
        xp > 0
          ? button(st.xpBanked ? "XP added" : `Add ${xp} XP to your sheet`, { icon: st.xpBanked ? "check" : "plus", size: "lg", variant: st.xpBanked ? undefined : "primary", attrs: html`data-act="bank-xp"${st.xpBanked ? " disabled" : ""}` })
          : html`<p class="muted">No XP: aliens killed only by shots or throws give none.</p>`
      }</div>
      ${anyRanged ? rule("Ranged kills give no XP; a shot then a close-combat kill gives full XP. Thrown-weapon kills are counted as ranged.") : ""}
      ${st.foes
        .filter((f) => f.cache && !/^none$/i.test(f.cache))
        .map(
          (f) => html`<article class="result-card step-result"><header class="rc-head">${eyebrow(`${f.name} cache`)}</header><div class="rc-text">${ctx.inline(f.cache)}</div>
          <div class="rc-actions">${followOns(f.cache)
            .map((o) => {
              const mod = o.modifier + (ins ? insightMod(o.ref.table.dice) : 0);
              return button(`Roll ${o.ref.table.code ?? o.label}${mod ? ` ${signed(mod)}` : ""}`, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-loot="${o.ref.key}|${mod}"` });
            })
            }</div></article>`,
        )
        }
      ${st.pipe === "recover" ? html`<div class="step-actions">${button("Recover the metal pipe (D6: 4–6)", { icon: "dice", attrs: html`data-act="pipe"` })}</div>` : ""}
      <p class="muted step-note">Now resolve the rest of the room, and note the alien on the map.</p>`,
      { eyebrow: st.stage === "melee" ? `Round ${st.round} · All aliens down` : "All aliens down", title: "Victory!", titleIcon: "trophy", tone: "accent" },
    );
  }

  function lostView() {
    return card(
      html`<p>Your HP is 0. If an enemy brought you down, they finish you off and the mission is over. If something else did (your own weapon, poison), roll on RFUT1.</p>
      <div class="step-actions">${button("RFUT1 (recovery)", { icon: "dice", size: "lg", attrs: html`data-loot="RFUT1|0"` })}</div>`,
      { eyebrow: "Defeat", title: "You've fallen", titleIcon: "skull", tone: "danger" },
    );
  }

  function fightView() {
    const c = char();
    if (!c) return card(html`<p>No survivor saved. <a href="#/play/vsheet">Create one</a>.</p>`, { title: "No survivor" });
    const s = vstats(c);
    const fb = fatigueBonus(st.fatigue);
    const f0 = targetFoe() ?? st.foes[0];
    let action: Raw | "" = "";
    if (st.phase === "won") action = wonView(c);
    else if (st.phase === "lost") action = lostView();
    else if (st.stage === "pre") action = preView(c);
    else if (st.stage === "ranged") action = rangedView(c);
    else action = meleeView(c);
    const sorted = f0 ? [...f0.man].sort((x, y) => diceAvg(x.dmg) - diceAvg(y.dmg)) : [];
    const foeSide = f0
      ? card(
          html`<dl class="stat-block">
            <div><dt>HP</dt><dd>${f0.hpNow} / ${f0.hpMax}</dd></div>
            <div><dt>Shift</dt><dd>${f0.turret ? "—" : foeShift(f0)}</dd></div>
            <div><dt>Damage</dt><dd>${sorted.length ? (sorted.length > 1 ? `${diceText(sorted[0].dmg)} – ${diceText(sorted[sorted.length - 1].dmg)}` : diceText(sorted[0].dmg)) : "—"}</dd></div>
            <div><dt>Ranged</dt><dd>${f0.ranged ? `M${f0.ranged.marks}${f0.ranged.hullOk ? "*" : ""}, ${diceText(f0.ranged.dmg)}` : "None"}</dd></div>
            <div><dt>Interrupts</dt><dd>${f0.interrupts.length ? joinHtml(f0.interrupts.map((x) => `${x.name} ${x.die}${x.values.join(",")} −${x.reduce}`), html`<br>`) : "None"}</dd></div>
          </dl>${hpBar((f0.hpNow / Math.max(1, f0.hpMax)) * 100, true)}`,
          { eyebrow: f0.hpNow <= 0 ? "Down" : alive().length > 1 ? `Target · ${alive().length} standing` : "Facing", title: f0.name, attrs: html`data-side="foe"` },
        )
      : "";
    const w = c.ranged[st.weapon];
    const youSide = card(
      html`<dl class="stat-block">
        <div><dt>HP</dt><dd><span class="stepper-ctl"><button data-yhp="-1" aria-label="Lower your HP">${icon("minus", { size: 15 })}</button><input value="${c.hp}" readonly aria-label="Your HP"><button data-yhp="1" aria-label="Raise your HP">${icon("plus", { size: 15 })}</button></span> <span class="muted">/ ${s.baseline}</span></dd></div>
        <div><dt>Shift</dt><dd>${youShift(c)}${fb ? html` <span class="muted">(+${fb} fatigue)</span>` : ""}</dd></div>
        <div><dt>Marksmanship</dt><dd>${marksmanship(c)}</dd></div>
        <div><dt>Ammo</dt><dd>${w ? `${w.ammo}/${w.capacity}` : "—"}</dd></div>
        <div><dt>Fatigue die</dt><dd><span class="fatigue">${st.stage === "melee" ? st.fatigue : "—"}</span></dd></div>
        ${c.stunned ? html`<div><dt>Stunned</dt><dd>${c.stunned} (−1 Shift)</dd></div>` : ""}
      </dl>${hpBar((c.hp / Math.max(1, s.baseline)) * 100)}`,
      { eyebrow: "You", title: c.name || "You", attrs: html`data-side="you"` },
    );
    const stageLabel = st.stage === "melee" ? `Round ${st.round}` : st.stage === "ranged" ? "Ranged phase" : "Before the fight";
    return html`<div class="round-bar">${eyebrow(stageLabel)}
          ${st.stage === "melee" && fb ? html`<span class="badge">+${fb} Shift to all</span>` : ""}
          ${st.killedRound1 && st.round === 2 && st.foes.length > 1 ? html`<span class="badge is-accent">Fearful Momentum +2 Shift</span>` : ""}
          ${st.oilRounds >= st.round && st.stage === "melee" ? html`<span class="badge">Oil Bomb: no interrupts</span>` : ""}
          ${st.cond.hull ? html`<span class="badge">${st.cond.reinforced ? "Reinforced *" : "Outer hull"}</span>` : ""}
          ${st.round >= 7 && st.stage === "melee" ? html`<span class="warn">Round 7+: movement interrupts stop counting</span>` : ""}
          ${pendingList().length ? html`<span class="badge">Waiting: ${pendingList().map((p) => p.name).join(", ")} (after this fight)</span>` : ""}
        </div>
      <div class="combat-face">${foeSide}<div class="vs" aria-hidden="true">${icon(st.stage === "melee" ? "swords" : "crosshair", { size: 20 })}</div>${youSide}</div>
      ${action}
      ${card(html`<div class="foes">${st.foes.map(foeCard)}</div>`, { eyebrow: `${alive().length} of ${st.foes.length} standing`, title: "Aliens" })}
      ${card(html`<ol class="combat-log">${st.log.map((l) => html`<li>${logEntry(l)}</li>`)}</ol>`, { eyebrow: `${st.log.length} event${st.log.length === 1 ? "" : "s"}`, title: "Combat log" })}`;
  }

  function draw() {
    setHTML(root, html`<header class="play-head">
        <div class="play-title">${eyebrow(st.phase === "setup" ? "Play · Setup" : "Play")}<h1>${icon("crosshair", { size: 26 })}<span>Combat</span></h1></div>
        <div class="play-actions">${st.phase !== "setup" ? button(st.phase === "won" || st.phase === "lost" ? "New fight" : "End fight", { icon: st.phase === "won" || st.phase === "lost" ? "rotate-ccw" : "x", attrs: html`data-act="end"` }) : ""}
        <a class="btn btn-ghost" href="#/s/void%2Fcombat">${icon("book", { size: 17 })}<span>Combat rules</span></a></div></header>
      ${st.phase === "setup" ? setupView() : fightView()}`);
    if (st.phase === "setup") {
      const inp = root.querySelector<HTMLInputElement>("#cb-search");
      inp?.addEventListener("input", () => {
        query = inp.value;
        const pos = inp.selectionStart;
        draw();
        const again = root.querySelector<HTMLInputElement>("#cb-search")!;
        again.focus();
        again.setSelectionRange(pos, pos);
      });
    }
  }

  // ---------- adding aliens ----------
  function addFoe(a: Alien, hpBonus = 0) {
    const hp = Math.max(1, a.hp + hpBonus);
    st.foes.push({
      ...a, id: st.nextId++, hpNow: hp, hpMax: hp, shMod: 0, netted: false, restrained: false, skip: 0, shiftNext: null, firstRoundShift: 0,
      earlyShift: 0, earlyRounds: 0, killedBy: null, noXp: false, ticked: false, shotsUsed: 0, noReturnFire: false, diffused: false,
    });
  }
  async function takePending() {
    const list = pendingList();
    st.pending = null;
    for (const p of list) {
      const a = findAlien(all, p.name, p.sectionId);
      if (!a) {
        ctx.toast(`No alien card found for ${p.name}.`);
        continue;
      }
      let sp = patrolSpecial(p.special ?? "");
      let rolled = "";
      if (sp.roll) {
        const r = await rollDice("D6");
        sp = patrolSpecial(p.special ?? "", r.value);
        rolled = ` D6 ${r.value}`;
      }
      addFoe(a, (p.hp ?? 0) + sp.hp);
      const f = st.foes[st.foes.length - 1];
      f.shMod += sp.shift;
      f.earlyShift = sp.earlyShift;
      f.earlyRounds = sp.earlyRounds;
      if (sp.skip) f.skip = 1;
      if (sp.first) st.cond.alienFirst = true;
      if (p.from === "vhulk") log(em(`From the Hulk turn${p.level ? `, level ${p.level}` : ""}${p.room ? ` room ${p.room}` : ""}: ${a.name}.`));
      if (p.special) {
        const what = sp.applied.length ? `applied: ${sp.applied.join(", ")}` : sp.manual ? "apply it by hand" : sp.roll ? "no effect" : "apply it by hand";
        log(em(`Patrol SPECIAL: ${p.special}${rolled} (${what}).`));
        if (sp.manual) ctx.toast(`Patrol SPECIAL: ${sp.manual}`);
      }
      for (const k of ["hull", "reinforced", "surprised", "alienFirst"] as const) if (p[k] !== undefined) st.cond[k] = !!p[k];
      if (p.note) log(em(String(p.note)));
    }
  }

  // ---------- flow ----------
  function kill(f: Foe, by: KillBy) {
    if (f.hpNow > 0 || f.killedBy) return;
    f.killedBy = by;
    setTimeout(() => playSfx("foe-down"), 350);
    if (by === "melee" && st.round === 1 && st.stage === "melee" && st.foes.length > 1) st.killedRound1 = true;
  }
  function damageFoe(f: Foe, n: number, by: KillBy) {
    f.hpNow = Math.max(0, f.hpNow - Math.max(0, n));
    if (f.hpNow <= 0) kill(f, by);
  }
  function checkWon(): boolean {
    if (alive().length) {
      if (!alive().some((f) => f.id === st.target)) st.target = alive()[0].id;
      return false;
    }
    st.phase = "won";
    st.attack = null;
    log(strong(["All aliens down."]));
    return true;
  }
  function hurtYou(c: VoidCharacter, n: number): boolean {
    const r = applyDamage(c, n);
    if (n > 0) playSfx("hurt");
    saveC(c);
    if (r.down) {
      st.phase = "lost";
      log(strong([{ icon: "skull" }, " You're down."], "tone-miss"));
    }
    return r.down;
  }

  function startFight() {
    const keepFoes = st.foes, keepCond = st.cond, keepId = st.nextId;
    st = { ...fresh(), foes: keepFoes, cond: keepCond, nextId: keepId, phase: "you", stage: "pre", target: keepFoes.find((f) => f.hpNow > 0)?.id ?? null };
    for (const f of st.foes) if (f.hpNow <= 0 && !f.killedBy) f.killedBy = "other";
    const c = char();
    if (c) {
      st.weapon = Math.max(0, c.ranged.findIndex((w) => w.ammo > 0 && hullAllows(ctxRoom(), hullOkName(w.name))));
      st.throwKind = "pipe";
    }
    log(em(`The fight begins${st.cond.surprised ? ": you're surprised" : ""}.`));
    if (checkWon()) return;
    if (st.cond.surprised) toMelee();
  }

  function toRanged() {
    const c = char();
    const armed = armedFoes();
    const best = armed.length ? Math.max(...armed.map((f) => f.ranged!.marks)) : null;
    st.rcase = firingCase(youCanFire(c), best, c ? marksmanship(c) : 0);
    st.plan = firingPlan(st.rcase, st.cond.stealth && youCanFire(c));
    st.step = 0;
    st.alienIdx = 0;
    st.closing = false;
    st.alienMod = st.rcase === 4 ? -1 : 0;
    st.stage = "ranged";
    if (turretFight() && st.rcase !== 0) {
      st.plan = youCanFire(c) ? ["you", "alien"] : ["alien"];
      st.rcase = youCanFire(c) ? 3 : 4;
    }
    log(em(`Ranged phase: case ${st.rcase}. ${turretFight() ? "Turret exchange." : CASE_TEXT[st.rcase]}`));
    if (!st.plan.length) {
      if (turretFight()) {
        log(em("You can't shoot the turret and it can't reach you. You leave the room out of bounds."));
        endFight("retreat");
        return;
      }
      toMelee();
      return;
    }
    st.phase = st.plan[0] === "you" ? "you" : "foes";
  }

  function nextRangedStep() {
    if (checkWon()) return;
    st.step++;
    st.alienIdx = 0;
    if (st.step >= st.plan.length) {
      const again = (st.rcase === 3 && !st.closing) || turretFight();
      if (again && (youCanFire(char()) || turretFight())) {
        if (turretFight() && !youCanFire(char())) st.plan = ["alien"];
        st.step = 0;
      } else return toMelee();
    }
    const who = st.plan[st.step];
    if (who === "alien" && !armedFoes().length) return nextRangedStep();
    st.phase = who === "you" ? "you" : "foes";
  }

  function toMelee() {
    if (turretFight()) return;
    st.stage = "melee";
    st.round = 1;
    st.fatigue = 1;
    st.attack = null;
    st.foeTurn = 0;
    if (!meleeFoes().some((f) => f.id === st.target)) st.target = meleeFoes()[0]?.id ?? null;
    const alienFirst = st.cond.surprised || st.cond.alienFirst;
    st.phase = alienFirst ? "foes" : "you";
    log(em(`Close combat. Fatigue die 1.${alienFirst ? " It attacks first." : ""}`));
    if (!meleeFoes().length) checkWon();
  }

  const alienFirstRound = () => (st.cond.surprised || st.cond.alienFirst) && st.round === 1;
  function afterYou() {
    st.attack = null;
    if (checkWon()) return;
    const c = char();
    if (c && st.round === 2 && !st.momentumUsed && stimCombat(c.effects, 1).momentum) {
      st.momentumUsed = true;
      log(em("Momentum: a free extra attack."));
      return;
    }
    if (alienFirstRound()) return endRound();
    st.phase = "foes";
    st.foeTurn = 0;
  }
  function afterFoe() {
    st.foeTurn++;
    if (st.foeTurn < meleeFoes().length) return;
    if (alienFirstRound()) {
      st.phase = "you";
      return;
    }
    endRound();
  }
  function endRound() {
    st.round++;
    st.fatigue = Math.min(6, st.fatigue + 1);
    st.phase = "you";
    st.foeTurn = 0;
    log(em(`Round ${st.round} begins. Fatigue die ${st.fatigue}.`));
  }

  function endFight(how: "reset" | "retreat") {
    const c = char();
    if (c && st.phase !== "setup") {
      endCombat(c);
      saveC(c);
    }
    if (how === "retreat") ctx.toast("You retreat. The room is out of bounds until you find a ranged option.");
    st = { ...fresh(), pending: st.pending };
  }

  // ---------- effects from card text ----------
  async function applyEffect(e: CardEffect, f: Foe, c: VoidCharacter, armourFree: boolean): Promise<LogNode[]> {
    const out: LogNode[][] = [];
    for (const d of e.foeDamage) {
      const r = await rollD(d);
      const n = Math.max(0, r.total);
      damageFoe(f, n, st.stage === "melee" ? "melee" : "other");
      out.push([`${f.name} loses ${d.dice ? `${r.text} = ` : ""}`, strong([String(n)]), " HP"]);
    }
    for (const d of e.foeHeal) {
      const r = await rollD(d);
      f.hpNow = Math.min(f.hpMax, f.hpNow + Math.max(0, r.total));
      out.push([`${f.name} heals ${Math.max(0, r.total)} HP`]);
    }
    for (const d of e.youDamage) {
      const r = await rollD(d);
      const tough = stimCombat(c.effects, vstats(c).level).toughen;
      const n = finalDamage(r.total, tough, r.six);
      out.push([`you take ${d.dice ? `${r.text}${tough ? ` − ${tough} Toughen Skin` : ""} = ` : ""}`, strong([String(n)]), armourFree ? " (armour can't stop it)" : ""]);
      if (hurtYou(c, n)) break;
    }
    if (e.foeSkip) {
      f.skip += 1;
      out.push([`${f.name} misses its next attack`]);
    }
    if (e.youSkip) {
      st.youSkip += 1;
      out.push(["you miss your next attack"]);
    }
    if (e.stun) {
      stun(c, e.stun);
      out.push([`Stunned ${c.stunned}`]);
    }
    if (e.bloodied) {
      bloody(c);
      out.push(["you're Bloodied"]);
    }
    if (e.foeDies && f.hpNow > 0) {
      f.hpNow = 0;
      kill(f, "melee");
      out.push([`${f.name} dies`]);
    }
    if (e.noXp) f.noXp = true;
    if (e.freeShot) {
      st.freeShot = true;
      out.push(["you may take a free shot"]);
    }
    if (e.youShiftNext) st.youShiftNext = { n: e.youShiftNext, round: st.round + 1 };
    if (e.foeShiftNext) f.shiftNext = { n: e.foeShiftNext, round: st.round + 1 };
    if (e.foeShift) f.shMod += e.foeShift;
    saveC(c);
    return out.length ? [" ", span("vc-effect", ["→ ", ...out.flatMap((x, i) => (i ? ["; ", ...x] : x)), "."])] : [];
  }
  /** A manoeuvre or interrupt special: roll its D6 when it has one, then apply what it says. */
  async function special(text: string, f: Foe, c: VoidCharacter): Promise<LogNode[]> {
    if (!text) return [];
    const cond = conditional(text);
    if (cond) {
      const r = await rollDice("D6");
      const on = r.value >= cond.lo && r.value <= cond.hi;
      const more = on ? await applyEffect(cardEffect(cond.then, "prime"), f, c, false) : [];
      return [" ", em(text), ` (D6 ${r.value}: ${on ? "yes" : "no"})`, ...more];
    }
    return [" ", em(text), ...(await applyEffect(cardEffect(text, "prime"), f, c, false))];
  }

  // ---------- armour checks ----------
  async function armourCheckFor(c: VoidCharacter, index: number): Promise<LogNode[]> {
    if (!st.cond.armourChecks) return [];
    const a = c.armour[index];
    if (!a) return [];
    const r = await rollDice("D6");
    const res = armourCheck(a.name, r.value);
    if (res === "damaged") damageArmour(c, index);
    if (res === "destroyed") c.armour.splice(index, 1);
    saveC(c);
    return res === "ok" ? [" ", span("muted", [`(Armour Check ${r.value}: fine)`])] : [" ", strong([`Armour Check ${r.value}: ${a.name} ${res}.`], "tone-miss")];
  }

  // ---------- your shot ----------
  async function shoot(free = false) {
    const c = char();
    if (!c) return;
    const f = targetFoe();
    if (!f) return;
    const prob = weaponProblem(c, st.weapon, f);
    if (prob) return ctx.toast(prob);
    const w = c.ranged[st.weapon];
    const set = parseSettings(w.settings)[st.setting] ?? parseSettings(w.settings)[0];
    const need = set.burst ? burstAmmo(w.capacity) : 1;
    const sp = weaponSpecial(w.special);
    let rollMod = (st.rcase === 1 && !free ? -1 : 0) + (f.restrained ? -2 : 0) + stimShotMod(c.effects);
    const r = await rollDice("2D6");
    playSfx("shot");
    const line: LogNode[] = [`You fire the ${w.name}${set.burst ? " (Burst)" : ""} at ${f.name}: ${r.dice.join(" + ")}`];
    let bonus: Dice = { dice: 0, sides: 6, mod: 0 };
    let doubled = false;
    let fired = true;
    let extraAmmo = 0;
    if (r.dice[0] === r.dice[1]) {
      const rows = parseDoubles(w.doubles);
      const d = await rollDice("D6");
      const row = doublesRow(rows, d.value);
      const eff = doublesEffect(row.text);
      line.push(". ", strong(["Double!"]), ` Doubles table D6 ${d.value}: `, em(row.text));
      if (eff.selfDamage) {
        const sd = await rollD(eff.selfDamage);
        const n = Math.max(0, sd.total);
        line.push(" You take ", strong([String(n)]), ".");
        if (hurtYou(c, n)) {
          log(...line);
          return;
        }
      }
      if (eff.lock) {
        st.locked.push(st.weapon);
        if (eff.broken) ctx.toast(`${w.name} needs repairing: note it on your sheet.`);
      }
      if (eff.bonus) bonus = eff.bonus;
      doubled = eff.doubleDmg;
      rollMod += eff.shotMod;
      extraAmmo = eff.extraAmmo;
      if (eff.foeSkip) f.skip = Math.max(f.skip, 1);
      fired = !eff.noFire;
    }
    // ammo
    const spend = extraAmmo === Infinity ? w.ammo : fired ? Math.max(0, need + (extraAmmo < 0 ? -need : extraAmmo)) : Math.max(0, extraAmmo);
    useAmmo(c, st.weapon, Math.min(w.ammo, spend));
    if (sp.oncePerCombat && fired) st.locked.push(st.weapon);
    if (!fired) {
      playSfx("miss");
      log(...line, " ", strong(["It doesn't fire."], "tone-miss"));
      saveC(c);
      return;
    }
    const hit = shotHits(r.dice, rollMod, marksmanship(c), set.marks);
    if (!hit.hit) {
      playSfx("miss");
      log(...line, ` = ${hit.total} vs ${hit.target}: `, strong(["miss"], "tone-miss"), ".");
      saveC(c);
      return;
    }
    // damage
    let dmgLine = "";
    let dmgSpecial: LogNode[] = []; // the weapon special's D6, after the damage sum
    let raw = 0;
    let six = false;
    if (sp.robotKiller) {
      if (f.type === "R") raw = f.hpNow;
      dmgLine = f.type === "R" ? "it destroys the robot" : "no effect on a non-robot";
    } else {
      const base = await rollD(parseDamage(w.damage));
      raw = base.total;
      six = base.six;
      dmgLine = base.text;
      if (set.dmg) (raw += set.dmg), (dmgLine += ` + ${set.dmg} Burst`);
      if (bonus.dice || bonus.mod) {
        const b = await rollD(bonus);
        raw += b.total;
        dmgLine += ` ${b.total >= 0 ? "+" : "−"} ${Math.abs(b.total)} doubles`;
      }
      if (sp.bioBonus && f.type === "B") (raw += sp.bioBonus), (dmgLine += ` + ${sp.bioBonus} vs Biological`);
      const stims = stimCombat(c.effects, vstats(c).level);
      if (!st.firstHitDone && stims.firstHit) (raw += stims.firstHit), (dmgLine += ` + ${stims.firstHit} stim`);
      if (stims.perHit) (raw += stims.perHit), (dmgLine += ` + ${stims.perHit} Muscle Boost`);
      if (doubled) (raw *= 2), (dmgLine = `(${dmgLine}) × 2`);
      if (sp.onHit) {
        const h = await rollDice("D6");
        const on = h.value >= sp.onHit.lo && h.value <= sp.onHit.hi;
        dmgSpecial = [`; special D6 ${h.value}`, ...(on ? [": ", em(sp.onHit.then)] : [": no"])];
        if (on) {
          raw += sp.onHit.bonus;
          if (sp.onHit.foeSkip) f.skip = Math.max(f.skip, 1);
          if (sp.onHit.noReturnFire) f.noReturnFire = true;
        }
      }
      if (sp.firstMeleeShift) f.firstRoundShift += sp.firstMeleeShift;
    }
    st.firstHitDone = true;
    // the Deflection Roll against its red-boxed interrupts
    const d = await rollDice("D66");
    const defl = sp.robotKiller ? null : alienDeflect(f, d.dice[0], d.dice[1]);
    const dmg = sp.robotKiller ? raw : finalDamage(raw, defl?.reduce ?? 0, six);
    damageFoe(f, dmg, "ranged");
    playSfx(dmg > 0 ? "hit" : "armour-block");
    line.push(
      ` = ${hit.total} vs ${hit.target}: `, strong(["hit"]), `. Damage ${dmgLine}`, ...dmgSpecial, `. Deflection ${D66(d.dice[0], d.dice[1])}`,
      ...(defl ? [": ", em(defl.interrupt?.name ?? "red box"), ` −${defl.reduce}`] : [": no red box"]),
      ". ", strong([String(dmg)]), " damage", ...(f.hpNow <= 0 ? [". ", strong([`${f.name} is down!`])] : [` (${f.hpNow} HP left).`]),
    );
    // splash (Ore Cannon, Starburn Cannon)
    if (sp.splash) {
      const others = alive().filter((x) => x.id !== f.id);
      if (sp.splash === "same") for (const o of others) damageFoe(o, dmg, "ranged");
      else if (others[0]) {
        const s2 = await rollDice("D6");
        damageFoe(others[0], s2.value, "ranged");
      }
      if (others.length) line.push(" Others in the room are hit too.");
    }
    // Ranged Hits: once per different enemy
    if (!f.ticked) {
      f.ticked = true;
      const rh = addRangedHit(c);
      if (rh.filled) {
        const lvl = levelChangeText(c, rh.level);
        ctx.toast(`Ranged Hits bar full: +1 Marksmanship and ${rh.xp} XP.${lvl ? ` ${lvl}` : ""}`);
        if (rh.level.to > rh.level.from) playSfx("level-up");
      }
    }
    saveC(c);
    log(...line);
  }

  // ---------- an alien's shot ----------
  async function alienShoot(f: Foe) {
    const c = char();
    if (!c || !f.ranged) return;
    if (f.noReturnFire) {
      f.noReturnFire = false;
      log(`${f.name} is knocked back and can't fire.`);
      return;
    }
    f.shotsUsed++;
    const r = await rollDice("2D6");
    playSfx("shot");
    const total = r.value + st.alienMod;
    const head = `${f.name} fires its ${f.ranged.name}: ${r.dice.join(" + ")}${st.alienMod ? ` ${signed(st.alienMod)}` : ""} = ${total} vs ${f.ranged.marks}`;
    if (total > f.ranged.marks) {
      playSfx("miss");
      log(`${head}: `, strong(["miss"], "tone-miss"), ".");
      return;
    }
    const dmg = await rollD(f.ranged.dmg);
    const d = await rollDice("D66");
    const sets = armourSets(c.armour);
    const a = rangedDeflect(sets, d.dice[0], d.dice[1]);
    const tough = stimCombat(c.effects, vstats(c).level).toughen;
    const n = finalDamage(dmg.total, (a?.reduce ?? 0) + tough, dmg.six);
    if (a) playSfx("armour-block");
    const line: LogNode[] = [
      `${head}: `, strong(["hit"]), `, ${dmg.text}. Your Deflection ${D66(d.dice[0], d.dice[1])}`,
      ...(a ? [": ", span("deflect", [{ icon: "shield" }, ` ${a.name} −${a.reduce}`])] : [": no yellow die"]),
      `${tough ? `, Toughen Skin −${tough}` : ""}. You take `, strong([String(n)]), ".",
    ];
    if (a) line.push(...(await armourCheckFor(c, a.index)));
    log(...line);
    hurtYou(c, n);
  }

  // ---------- throw ----------
  async function doThrow() {
    const f = targetFoe();
    if (!f) return;
    const kind = st.throwKind;
    const r = await rollDice("D66");
    playSfx("grenade");
    const res = resolveThrow(kind, f, r.dice[0], r.dice[1], st.throwMod);
    st.thrown = true;
    const line: LogNode[] = [`You throw a ${THROWS[kind].name} at ${f.name}: ${D66(r.dice[0], r.dice[1])}`];
    if (res.hits.length && kind !== "diffusion") line.push(", deflected by ", ...res.hits.flatMap((x, i): LogNode[] => [...(i ? [" and "] : []), em(x.name), ` −${x.reduce}`]));
    if (kind === "oil") {
      if (res.works) st.oilRounds = 2;
      line.push(res.works ? ". It can't use interrupts in the first 2 rounds." : ". It doesn't work.");
    } else if (kind === "diffusion") {
      const hitAll = alive().filter((x) => x.type === "R" || x.type === "C");
      for (const x of hitAll) x.diffused = true;
      line.push(hitAll.length ? `. EMP: ${hitAll.map((x) => x.name).join(", ")} can't fire and can't defend your first melee attack.` : ". No robots or cyborgs here: no effect.");
    } else {
      damageFoe(f, res.damage, "throw");
      line.push(`. ${res.note ? res.note + " " : ""}`, strong([String(res.damage)]), " damage", ...(f.hpNow <= 0 ? [". ", strong([`${f.name} is down!`])] : [` (${f.hpNow} HP left)`]), ".");
      if (kind === "pipe" || kind === "spiked") st.pipe = res.deflected ? "lost" : "recover";
      if (res.deflected && (kind === "pipe" || kind === "spiked")) line.push(" The pipe is lost.");
    }
    playSfx(res.damage > 0 ? "hit" : "miss");
    log(...line);
    checkWon();
  }

  // ---------- your melee attack ----------
  async function yourHit(i: number, prime: boolean) {
    const c = char();
    if (!c) return;
    const m = meleeManoeuvres(c)[i];
    const f = targetFoe();
    const a = st.attack;
    if (!m || !f || !a) return;
    const exact = !prime && m.primary === a.p && m.secondary === a.s;
    const pts = youShift(c);
    const r = await rollD(m.damage);
    const stims = stimCombat(c.effects, vstats(c).level);
    let raw = r.total + (exact || prime ? pts : 0);
    let text = `${m.name}: ${r.text}${exact || prime ? ` + Shift ${pts}` : ""}`;
    if (!st.firstHitDone && stims.firstHit) (raw += stims.firstHit), (text += ` + ${stims.firstHit} stim`);
    if (stims.perHit) (raw += stims.perHit), (text += ` + ${stims.perHit} Muscle Boost`);
    st.firstHitDone = true;
    // Diffusion: it can't defend against your first melee attack (U35 reading: no interrupt)
    const intr = prime ? null : interruptFor(f, m.primary, m.secondary, { round: st.round, disabled: st.oilRounds >= st.round || f.diffused });
    if (f.diffused) f.diffused = false; // it defends from now on (its ranged fire is past)
    const dmg = finalDamage(raw, intr?.reduce ?? 0, r.six);
    const intrText: LogNode[] = intr ? [` ${f.name}'s `, em(intr.name), ` (${intr.die === "P" ? `Primary ${m.primary}` : `Secondary ${m.secondary}`}) −${intr.reduce}`] : [];
    damageFoe(f, dmg, "melee");
    playSfx(prime || exact ? "hit-crit" : "hit");
    const line: LogNode[] = [
      ...(prime ? [strong([{ icon: "zap" }, " Prime Attack!"], "tone-prime"), " "] : exact ? [strong(["Exact Strike!"], "tone-exact"), " "] : []),
      `You hit ${f.name}: ${text}`, ...intrText, " = ", strong([String(dmg)]), " damage.",
      ...(f.hpNow <= 0 ? [" ", strong([`${f.name} is defeated!`])] : [` (${f.hpNow} HP left)`]),
    ];
    if (intr?.special && f.hpNow > 0) line.push(...(await special(intr.special, f, c)));
    log(...line);
    afterYou();
  }

  // ---------- an alien's melee attack ----------
  async function foeAttack() {
    const f = meleeFoes()[st.foeTurn];
    const c = char();
    if (!f || !c) return;
    if (f.skip > 0) {
      f.skip--;
      log(`${f.name} misses this round.`);
      return afterFoe();
    }
    const r = await rollDice("D66");
    const [p, s] = r.dice;
    if (p === 1 && s === 1) {
      playSfx("fumble");
      const e = await applyEffect(cardEffect(f.mishap, "mishap"), f, c, false);
      log(`${f.name} rolls [1][1], a `, strong(["Mishap"], "tone-miss"), ": ", { book: f.mishap }, ...e, followOns(f.mishap).length ? " (roll the table from the card)" : "");
      if (st.phase === "lost") return;
      if (checkWon()) return;
      return afterFoe();
    }
    if (p === 6 && s === 6) {
      playSfx("hit-crit");
      const e = await applyEffect(cardEffect(f.prime, "prime"), f, c, true);
      log(`${f.name} rolls [6][6], a `, strong([{ icon: "zap" }, " Prime Attack"], "tone-prime"), ": ", { book: f.prime }, ...e);
      if (st.phase === "lost") return;
      if (checkWon()) return;
      return afterFoe();
    }
    const pts = foeShift(f);
    const pick = alienChoice(p, s, f.man, pts);
    if (!pick) {
      playSfx("miss");
      log(`${f.name} rolls ${D66(p, s)} and can't reach a manoeuvre with ${pts} Shift: `, strong(["miss"], "tone-miss"), ".");
      return afterFoe();
    }
    const m = pick.m;
    const d = await rollD(m.dmg);
    const noArmour = /armour cannot deflect/i.test(m.special);
    const sets = armourSets(c.armour);
    const a = noArmour ? null : meleeDeflect(sets, m.p, m.s);
    const tough = stimCombat(c.effects, vstats(c).level).toughen;
    const n = finalDamage(d.total, (a?.reduce ?? 0) + tough, d.six);
    if (a) playSfx("armour-block");
    const line: LogNode[] = [
      `${f.name} rolls ${D66(p, s)}${pick.cost ? `, shifts ${pick.cost}` : ""} → `, strong([m.name]), ` ${D66(m.p, m.s)}: ${d.text}.`,
      ...(a ? [" ", span("deflect", [{ icon: "shield" }, " Your ", em(a.name), ` deflects −${a.reduce}.`])] : []),
      `${tough ? ` Toughen Skin −${tough}.` : ""} You take `, strong([String(n)]), " damage",
    ];
    if (a) line.push(...(await armourCheckFor(c, a.index)));
    const down = hurtYou(c, n);
    line.push(` (${c.hp} HP left).`);
    if (!down && m.special && !noArmour) line.push(...(await special(m.special, f, c)));
    else if (m.special) line.push(" ", em(m.special));
    log(...line);
    if (st.phase === "lost") return;
    afterFoe();
  }

  // ---------- events ----------
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.cond) {
      st.cond[t.dataset.cond as keyof Cond] = t.checked;
      if (t.dataset.cond === "reinforced" && t.checked) st.cond.hull = true;
    } else if (t.dataset.fflag) {
      const f = st.foes.find((x) => x.id === +t.dataset.id!);
      if (!f) return;
      if (t.dataset.fflag === "skip") f.skip = t.checked ? 1 : 0;
      else if (t.dataset.fflag === "netted") f.netted = t.checked;
      else if (t.dataset.fflag === "restrained") f.restrained = t.checked;
    } else return;
    persist();
    draw();
  });

  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    b.disabled = true;
    const phaseBefore = st.phase;
    try {
      const act = b.dataset.act;
      if (b.dataset.add) {
        const a = all.find((x) => x.key === b.dataset.add);
        if (a) addFoe(a);
      } else if (b.dataset.turret) {
        const t = TURRET_PRESETS[+b.dataset.turret];
        addFoe(makeTurret(t.name, t.hp, t.weapon));
      } else if (b.dataset.remove) st.foes = st.foes.filter((f) => f.id !== +b.dataset.remove!);
      else if (b.dataset.fsh) {
        const f = st.foes.find((x) => x.id === +b.dataset.fsh!);
        if (f) f.shMod += +b.dataset.d!;
      } else if (b.dataset.toopowerful) {
        const f = st.foes.find((x) => x.id === +b.dataset.toopowerful!);
        if (f) {
          f.hpNow = 0;
          f.killedBy = "melee";
          log(em(`${f.name} is too powerful for nothing: your armour cancels it and it dies.`));
        }
      } else if (act === "take-pending") await takePending();
      else if (act === "drop-pending") st.pending = null;
      else if (act === "start") startFight();
      else if (b.dataset.throw) st.throwKind = b.dataset.throw as ThrowKind;
      else if (b.dataset.tmod) st.throwMod += +b.dataset.tmod;
      else if (act === "throw") await doThrow();
      else if (act === "to-ranged") {
        if (st.cond.surprised) toMelee();
        else toRanged();
      } else if (b.dataset.weapon) {
        st.weapon = +b.dataset.weapon;
        st.setting = 0;
      } else if (b.dataset.setting) st.setting = +b.dataset.setting;
      else if (act === "reload") {
        const c = char();
        if (c) {
          const n = reload(c, st.weapon);
          saveC(c);
          playSfx("reload");
          log(`You reload the ${c.ranged[st.weapon].name} (+${n}).`);
        }
      } else if (act === "shoot" || act === "shoot-close") {
        if (act === "shoot-close") st.closing = true;
        await shoot();
        if (st.phase !== "lost" && st.phase !== "won") nextRangedStep();
      } else if (act === "skip-shot") {
        log("You can't fire.");
        nextRangedStep();
      } else if (act === "charge") {
        st.closing = true;
        st.alienMod = -1;
        log("You charge without firing.");
        st.step = st.plan.indexOf("alien") >= 0 ? st.plan.indexOf("alien") - 1 : st.plan.length;
        nextRangedStep();
      } else if (act === "retreat") {
        const t = armedFoes()[0];
        if (t) await alienShoot(t);
        if ((st.phase as Phase) !== "lost") endFight("retreat");
      } else if (act === "alien-shoot") {
        const s = armedFoes()[st.alienIdx] ?? armedFoes()[0];
        if (s) await alienShoot(s);
        if (st.phase !== "lost") {
          st.alienIdx++;
          if (st.alienIdx >= armedFoes().length || !armedFoes().length) nextRangedStep();
        }
      } else if (act === "alien-skip") nextRangedStep();
      else if (act === "free-shot") {
        st.freeShot = false;
        await shoot(true);
        checkWon();
      } else if (act === "attack") {
        const r = await rollDice("D66");
        st.attack = { p: r.dice[0], s: r.dice[1] };
        log(`You roll ${D66(r.dice[0], r.dice[1])}.`);
      } else if (b.dataset.hit) await yourHit(+b.dataset.hit, b.dataset.prime === "1");
      else if (act === "miss") {
        playSfx(st.attack?.p === 1 && st.attack?.s === 1 ? "fumble" : "miss");
        log("You ", strong([{ icon: "circle-x" }, " miss"], "tone-miss"), ".");
        afterYou();
      } else if (act === "you-skip") {
        st.youSkip--;
        log("You miss this round.");
        afterYou();
      } else if (b.dataset.stim) {
        const c = char();
        if (c) {
          const r = useStim(c, +b.dataset.stim);
          saveC(c);
          if (r) {
            playSfx("stim");
            log(`You use a ${r.type} stim: ${r.text}.`);
            if (st.phase !== "setup") afterYou();
          }
        }
      } else if (act === "foe-attack") await foeAttack();
      else if (b.dataset.target) st.target = +b.dataset.target;
      else if (b.dataset.fhp) {
        const f = st.foes.find((x) => x.id === +b.dataset.fhp!);
        if (f) {
          f.hpNow = Math.max(0, f.hpNow + +b.dataset.d!);
          if (st.phase === "setup") f.hpMax = Math.max(1, f.hpNow);
          else if (f.hpNow <= 0) kill(f, st.stage === "melee" ? "melee" : "ranged");
          else if (f.hpNow > f.hpMax) f.hpMax = f.hpNow;
          if (f.hpNow > 0) f.killedBy = null;
          if (st.phase !== "setup") checkWon();
        }
      } else if (b.dataset.yhp) {
        const c = char();
        if (c) {
          const d = +b.dataset.yhp;
          if (d < 0) applyDamage(c, -d);
          else setHp(c, c.hp + d);
          saveC(c);
          if (c.hp <= 0 && st.phase !== "won" && st.phase !== "setup") st.phase = "lost";
        }
      } else if (act === "bank-xp") {
        const c = char();
        if (c && !st.xpBanked) {
          const xp = fightXp(st.foes);
          const ch = addXp(c, xp);
          saveC(c);
          st.xpBanked = true;
          const lvl = levelChangeText(c, ch);
          if (ch.to > ch.from) playSfx("level-up");
          ctx.toast(`+${xp} XP added to your sheet.${lvl ? ` ${lvl}` : ""}`);
          bus.emit("journal:fight", { phase: "xp", xp });
        }
      } else if (act === "pipe") {
        const r = await rollDice("D6");
        st.pipe = "done";
        log(`Metal pipe D6 ${r.value}: ${r.value >= 4 ? "recovered" : "lost"}.`);
      } else if (b.dataset.loot) {
        const [code, mod] = b.dataset.loot.split("|");
        const ref = tableByCode(code);
        if (ref && isTableRef(ref)) {
          const r = await rollAndLog(ref, +mod || 0, undefined, "Cache");
          if (st.phase === "won" && r.rowIndex >= 0) bus.emit("journal:fight", { phase: "loot", text: r.cells[1] || `${ref.title} ${r.value}` });
        } else ctx.toast(`Couldn't find table ${code}.`);
      } else if (act === "end") {
        if (st.phase !== "won" && st.phase !== "lost" && !confirm("End this fight?")) return;
        endFight("reset");
      }
      // the fight just ended: combat effects expire; tell the Journal (victory / defeat stings)
      const ended = phaseBefore !== "won" && phaseBefore !== "lost" && phaseBefore !== "setup" && (st.phase === "won" || st.phase === "lost");
      if (ended) {
        const c = char();
        if (c) {
          endCombat(c);
          saveC(c);
        }
        bus.emit("journal:fight", { phase: "end", outcome: st.phase as "won" | "lost", foes: st.foes.map((f) => f.name), rounds: st.stage === "melee" ? st.round : 0, xp: fightXp(st.foes) });
      }
      persist();
      draw();
    } finally {
      b.disabled = false;
    }
  });

  // the Hulk turn put a fight in "vcombat" (pending), or the sheet / character bar changed the survivor
  /** Start setup from the Hulk turn's hand-off, and clear it. A fight already under way keeps it waiting. */
  async function readPending() {
    if (st.phase !== "setup" && st.phase !== "won" && st.phase !== "lost") return draw();
    if (!pendingList().length) return draw();
    if (st.phase !== "setup") endFight("reset"), (st.pending = load<Partial<State>>(KEY, {}).pending ?? null);
    await takePending();
    persist();
    draw();
  }
  ctx.onDispose(
    bus.on("void:changed", ({ source }) => {
      if (source === KEY) return;
      const saved = load<Partial<State>>(KEY, {});
      if (saved.pending && JSON.stringify(saved.pending) !== JSON.stringify(st.pending)) {
        st.pending = saved.pending;
        void readPending();
      } else draw();
    }),
  );
  makeCardsArrangeable(root, "2d6v:shell:panes:vcombat", ctx.onDispose);
  void readPending();
}
