// Combat helper for 2D6 Dungeon (rules: docs/spec-dungeon.md §3).
import type { ToolContext } from "../main";
import type { Section } from "../types";
import { rollDice } from "../dice3d";
import { followOns, isLockedTable, isTableRef, lockedFollowOns, tableByCode } from "../rolltable";
import { onContentChange } from "../content";
import { lockedCard } from "../ui/locked";
import { makeCardsArrangeable } from "../shell/arrangecards";
import { bus } from "../shell/events";
import { rollAndLog } from "../shell/panels/results";
import { button, card, chip, eyebrow, statBlock } from "../ui/components";
import { icon, type IconName } from "../ui/icon";
import { em, logHtml, span, strong, type LogEntry, type LogNode } from "./combatlog";
export { logHtml, type LogEntry, type LogNode } from "./combatlog";
import { isCreatureTable, load, save } from "./common";
import { LEVELS, levelOf, loadChar, saveChar, stats } from "./sheet";
import { addXp, levelChangeText } from "../shell/charmodel";
import { html, joinHtml, type Raw, setHTML } from "../ui/html";
import { playSfx } from "../audio/sound";

// ---------- creature cards ----------
interface Man { a: number; b: number; name: string; dmg: { n: number; mod: number }; extra: string; text: string }
interface Interrupt { name: string; die: "P" | "S" | "A"; values: number[]; mod: number | null; text: string } // A = either die
export interface Creature {
  key: string; name: string; level: number; type: string; hp: number; xp: number; sh: number; treasure: string;
  interrupts: Interrupt[]; interruptText: string; man: Man[]; mishap: string; prime: string; desc: string; sectionId: string;
}
interface Foe extends Creature { id: number; hpNow: number }

const DMG_RE = /(\d*)\s*D6\s*([+-]\s*\d+)?/i;
function parseDmg(s: string): { n: number; mod: number; extra: string } {
  const m = s.match(DMG_RE);
  if (!m) return { n: 0, mod: parseInt(s, 10) || 0, extra: s };
  const extra = s.slice((m.index ?? 0) + m[0].length).replace(/^\s*damage\s*/i, "").trim();
  return { n: parseInt(m[1] || "1", 10), mod: m[2] ? parseInt(m[2].replace(/\s/g, ""), 10) : 0, extra };
}
export function parseManoeuvre(text: string): Man | null {
  const m = text.match(/\[(\d)\]\s*\[(\d)\]\s*-?\s*(.+?)\s*=\s*(.+)$/);
  if (!m) return null;
  const d = parseDmg(m[4]);
  return { a: +m[1], b: +m[2], name: m[3].trim(), dmg: { n: d.n, mod: d.mod }, extra: d.extra, text };
}
function parseInterrupts(text: string): Interrupt[] {
  const out: Interrupt[] = [];
  // e.g. "Sidestep on Secondary 2s and 5s -3 damage", "Hard Shell Primary 1s, 2s -8 damage", "Blur 1s, 2s ... 6s -10 damage"
  const re = /([A-Za-z][\w' ]*?)\s+(?:on\s+)?(?:(Primary|Secondary)\s+)?((?:\d+s(?:\s*,\s*|\s+and\s+|\s+)?)+)(?:-\s*(\d+)\s*damage)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const values = (m[3].match(/\d+/g) ?? []).map(Number).filter((v) => v >= 1 && v <= 6);
    if (!values.length) continue;
    out.push({ name: m[1].trim(), die: m[2] ? (m[2][0] === "P" ? "P" : "S") : "A", values, mod: m[4] ? +m[4] : null, text: m[0].trim() });
  }
  return out;
}

export function creatureIndex(sections: Section[]): Creature[] {
  const byKey = new Map<string, Creature>();
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.type !== "table") continue;
      const t = b.table;
      if (!isCreatureTable(t)) continue;
      const get = (k: RegExp) => t.rows.filter((r) => k.test(r[0].trim())).map((r) => r[1] ?? "");
      const name = get(/^NAME$/i)[0];
      const hp = parseInt(get(/^(HP|HEALTH POINTS)$/i)[0] ?? "", 10);
      const lvlTxt = get(/^LEVEL( \/ TYPE)?$/i)[0] ?? "";
      const level = parseInt(lvlTxt.match(/L\s*(\d+)/i)?.[1] ?? "0", 10);
      const type = lvlTxt.match(/\{(?:circled )?([A-Z])\b/)?.[1] ?? "";
      const interruptText = get(/^INTERRUPT$/i).join(" | ");
      const c: Creature = {
        key: `${name.toUpperCase()}|${level}`,
        name, level, type, hp,
        xp: parseInt(get(/^XP$/i)[0] ?? "0", 10) || 0,
        sh: parseInt((get(/^(SH|SHIFT)$/i)[0] ?? "0").replace("+", ""), 10) || 0,
        treasure: get(/^TREASURE$/i)[0] ?? "",
        interrupts: parseInterrupts(interruptText),
        interruptText,
        man: get(/^MANOEUVRES?$/i).map(parseManoeuvre).filter((x): x is Man => !!x),
        mishap: t.rows.find((r) => /MISHAP/i.test(r[0]))?.[1] ?? "",
        prime: t.rows.find((r) => /PRIME/i.test(r[0]))?.[1] ?? "",
        desc: t.intro ?? get(/^DESCRIPTION$/i)[0] ?? "",
        sectionId: s.id,
      };
      if (!c.man.length) continue; // example character sheets, not creatures
      // the Core Rules show a few sample cards; prefer the Codex/Realm copies
      if (!byKey.has(c.key) || byKey.get(c.key)!.sectionId.startsWith("core/")) byKey.set(c.key, c);
    }
  }
  return [...byKey.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** The by-hand creature form, as typed. */
export interface ManualFields { name: string; level: string; hp: string; sh: string; xp: string; man: string; int: string }
const blankManual = (): ManualFields => ({ name: "", level: "1", hp: "5", sh: "0", xp: "0", man: "", int: "" });
const MANUAL_KEYS: Record<string, keyof ManualFields> = { "cm-name": "name", "cm-level": "level", "cm-hp": "hp", "cm-sh": "sh", "cm-xp": "xp", "cm-man": "man", "cm-int": "int" };

/** Copy a typed value into the draft when it comes from one of the form's fields; true when it did. */
export function applyManualInput(f: ManualFields, id: string, value: string): boolean {
  const k = MANUAL_KEYS[id];
  if (k) f[k] = value;
  return !!k;
}

/** The by-hand form, filled from the draft so a redraw keeps what was typed. */
export function manualFormHtml(f: ManualFields, open: boolean): Raw {
  return html`<details class="cb-manual"${open ? " open" : ""}><summary>Enter a creature by hand</summary>
    <div class="grid">
      <label class="field">Name<input id="cm-name" value="${f.name}"></label>
      <label class="field">Level<input id="cm-level" type="number" value="${f.level}" min="0"></label>
      <label class="field">HP<input id="cm-hp" type="number" value="${f.hp}" min="1"></label>
      <label class="field">Shift<input id="cm-sh" type="number" value="${f.sh}"></label>
      <label class="field">XP<input id="cm-xp" type="number" value="${f.xp}" min="0"></label>
    </div>
    <label class="field">Manoeuvres, one per line, as on the card: <code>[5][4] Claw = 1D6+1</code><textarea id="cm-man" rows="3">${f.man}</textarea></label>
    <label class="field">Interrupts (optional), e.g. <code>Sidestep on Secondary 2s and 5s -3 damage</code><input id="cm-int" value="${f.int}"></label>
    <div class="step-actions">${button("Add this creature", { icon: "plus", attrs: html`data-act="manual"` })}</div>
  </details>`;
}

/** A creature entered by hand (always offered, whatever is locked), or what's wrong with the entry. */
export function manualCreature(f: ManualFields, key: string): Creature | string {
  const num = (v: string) => parseInt(v.trim(), 10) || 0;
  const name = f.name.trim();
  const hp = num(f.hp);
  const man = f.man.split("\n").map((l) => parseManoeuvre(l.trim())).filter((x): x is Man => !!x);
  if (!name || hp < 1 || !man.length) return "Give it a name, HP of 1 or more and at least one manoeuvre like [5][4] Claw = 1D6+1.";
  const interruptText = f.int.trim();
  return {
    key, name, level: num(f.level), type: "", hp, xp: num(f.xp), sh: num(f.sh), treasure: "",
    interrupts: parseInterrupts(interruptText), interruptText, man, mishap: "", prime: "", desc: "", sectionId: "",
  };
}

// ---------- maths ----------
const avg = (d: { n: number; mod: number }) => d.n * 3.5 + d.mod;
const fatigueBonus = (f: number) => (f >= 6 ? 3 : f === 5 ? 2 : f === 4 ? 1 : 0);
const dice = (a: number, b: number) => `[${a}][${b}]`;

/** Manoeuvres reachable from (p,s) by spending up to `points` (each ±1 on one die, no wrapping). */
function reachable(p: number, s: number, mans: Man[], points: number) {
  return mans
    .map((m) => ({ m, cost: Math.abs(m.a - p) + Math.abs(m.b - s) }))
    .filter((x) => x.cost <= points)
    .sort((x, y) => x.cost - y.cost);
}

/** Armour piece dice set "[5][4]+[2]" → blocked primaries {5,2} and secondaries {4}. */
function armourSets(set: string) {
  const prim: number[] = [], sec: number[] = [];
  for (const grp of set.split("+")) {
    const ds = (grp.match(/\[(\d)\]/g) ?? []).map((x) => +x[1]);
    if (ds[0]) prim.push(ds[0]);
    if (ds[1]) sec.push(ds[1]);
  }
  return { prim, sec };
}

async function rollDamage(d: { n: number; mod: number }) {
  if (d.n <= 0) return { total: Math.max(0, d.mod), text: `${d.mod}`, six: false };
  const r = await rollDice(`${d.n}D6`);
  const sum = r.dice.reduce((t, x) => t + x, 0);
  return { total: sum + d.mod, text: `${r.dice.join(" + ")}${d.mod ? ` ${d.mod > 0 ? "+" : "−"} ${Math.abs(d.mod)}` : ""}`, six: r.dice.includes(6) };
}

// ---------- state ----------
interface State {
  foes: Foe[];
  round: number;
  fatigue: number;
  phase: "setup" | "you" | "foes" | "won" | "lost";
  target: number | null;
  attack: { p: number; s: number } | null; // your current attack roll awaiting a choice
  foeTurn: number; // index into living foes for the enemy phase
  killedRound1: boolean;
  log: (LogEntry | string)[]; // a `string` was saved as markup by an older version: shown as plain text
  nextId: number;
  xpBanked: boolean;
}
const fresh = (): State => ({ foes: [], round: 1, fatigue: 1, phase: "setup", target: null, attack: null, foeTurn: 0, killedRound1: false, log: [], nextId: 1, xpBanked: false });

export function render(root: HTMLElement, ctx: ToolContext) {
  // free creatures, plus those of unlocked books; anything else can be entered by hand
  let all = creatureIndex(ctx.lib.sections);
  ctx.onDispose(onContentChange(() => {
    all = creatureIndex(ctx.lib.sections);
    draw();
  }));
  let lockedMsg: Raw | "" = ""; // the locked card for a treasure table that is still locked
  // the by-hand form, kept as typed across redraws (the search box redraws the setup view)
  let manual = blankManual();
  let manualOpen = false;
  root.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement;
    applyManualInput(manual, el.id, el.value);
  });
  root.addEventListener("toggle", (e) => {
    if ((e.target as HTMLElement).classList?.contains("cb-manual")) manualOpen = (e.target as HTMLDetailsElement).open;
  }, true); // toggle doesn't bubble
  root.classList.add("play-page");
  let st: State = load<State>("combat", fresh());
  let query = "";
  // a closed tab whose roll was still awaiting dice must not write over the newer saved state
  let live = true;
  ctx.onDispose(() => (live = false));
  const persist = () => {
    if (!live) return;
    save("combat", st);
    bus.emit("combat:changed", { source: "combat" });
  };
  const log = (...n: LogNode[]) => st.log.unshift({ r: st.round, n });
  const inline = (t: string) => ctx.inline(t);
  const alive = () => st.foes.filter((f) => f.hpNow > 0);

  const youShift = () => {
    const base = stats(loadChar()).shift;
    return base + fatigueBonus(st.fatigue) + (st.killedRound1 && st.round === 2 ? 2 : 0);
  };
  const myMans = (): Man[] =>
    loadChar()
      .manoeuvres.filter((r) => r[0] && r[1])
      .map((r) => parseManoeuvre(`${r[1]} - ${r[0]} = ${r[2]}`))
      .filter((x): x is Man => !!x);

  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  // display only; a real minus sign so "1D6−3" never wraps at the hyphen
  const dmgText = (d: { n: number; mod: number }) =>
    `${d.n ? `${d.n}D6` : ""}${d.mod ? `${d.mod > 0 ? (d.n ? "+" : "") : "−"}${Math.abs(d.mod)}` : ""}` || "0";
  /** Two dice faces, e.g. [5][3], for the attack card. */
  const diceFaces = (a: number, b: number) =>
    html`<span class="dice-pair" aria-label="${dice(a, b)}"><span class="die-face">${a}</span><span class="die-face">${b}</span></span>`;
  const hpBar = (pct: number, foe = false) => html`<div class="hp-bar${foe ? " foe-bar" : ""}"><div style="width:${pct}%"></div></div>`;

  function foeCard(f: Foe) {
    const pct = Math.max(0, (f.hpNow / f.hp) * 100);
    const dead = f.hpNow <= 0;
    const targeted = st.target === f.id && !dead;
    return html`<div class="foe ${dead ? "dead" : ""} ${targeted ? "targeted" : ""}" data-foe="${f.id}">
      <div class="foe-head"><div class="foe-name"><strong>${f.name}</strong><span class="muted">L${f.level}${f.type ? ` ${f.type}` : ""} · SH ${signed(f.sh)} · ${f.xp} XP</span></div>
        ${
          dead
            ? html`<span class="badge">${icon("skull", { size: 13 })} defeated</span>`
            : st.phase !== "setup"
              ? button("Target", { icon: targeted ? "crosshair" : undefined, size: "sm", variant: targeted ? "primary" : undefined, attrs: html`data-target="${f.id}" aria-pressed="${String(targeted)}"` })
              : button("Remove", { icon: "x", size: "sm", variant: "ghost", attrs: html`data-remove="${f.id}"` })
        }</div>
      <div class="hp-line"><span class="stepper-ctl"><button data-fhp="${f.id}" data-d="-1" aria-label="Lower ${f.name} HP">${icon("minus", { size: 15 })}</button><input value="${f.hpNow}" readonly aria-label="${f.name} HP"><button data-fhp="${f.id}" data-d="1" aria-label="Raise ${f.name} HP">${icon("plus", { size: 15 })}</button></span>
        <span class="muted">/ ${f.hp} HP</span></div>
      ${hpBar(pct, true)}
      <details><summary class="muted">Card</summary>
        <dl class="kv"><dt>Manoeuvres</dt><dd>${f.man.length ? joinHtml(f.man.map((m) => ctx.inline(m.text)), html`<br>`) : "—"}</dd>
        <dt>Interrupt</dt><dd>${ctx.inline(f.interruptText || "None")}</dd>
        <dt>[1][1] Mishap</dt><dd>${ctx.inline(f.mishap)}</dd><dt>[6][6] Prime</dt><dd>${ctx.inline(f.prime)}</dd>
        <dt>Treasure</dt><dd>${ctx.inline(f.treasure)}</dd></dl>
        ${f.sectionId ? html`<a href="#/s/${encodeURIComponent(f.sectionId)}">Open the card in the book</a>` : ""}</details>
    </div>`;
  }

  function setupView() {
    const q = query.trim().toLowerCase();
    const list = all.filter((c) => !q || c.name.toLowerCase().includes(q) || `l${c.level}` === q).slice(0, 60);
    return html`${card(
      html`<label class="cb-search-wrap">${icon("search", { size: 17 })}<input id="cb-search" class="cb-search" placeholder="Search creatures (name, or L3 for level 3)" value="${query}"></label>
      <div class="cb-list">${list.length ? list
        .map((c) => html`<button class="cb-pick" data-add="${c.key}"><strong>${c.name}</strong><span class="muted">L${c.level} · ${c.hp} HP · SH ${signed(c.sh)}</span></button>`) : html`<p class="muted">No creature matches.</p>`}</div>
      ${manualFormHtml(manual, manualOpen)}`,
      { eyebrow: "Setup", title: "Who are you fighting?" },
    )}
      ${
        st.foes.length
          ? card(
              html`<div class="foes">${st.foes.map(foeCard)}</div>
        <div class="step-actions">${button("Start the fight", { icon: "swords", size: "lg", variant: "primary", attrs: html`data-act="start"` })}
          ${button("They attack first", { size: "lg", attrs: html`data-act="start-foes"` })}</div>
        <p class="muted step-note">You attack first, unless an Alarm Check brought them or you cast a scroll at the start (then they attack first: tap "They attack first").</p>`,
              { eyebrow: `Foes (${st.foes.length})`, title: "Ready to fight" },
            )
          : ""
      }`;
  }

  /** The attack card for your current roll: tone + body. */
  function attackOptions(): { tone: "" | "prime" | "miss"; body: Raw } {
    const a = st.attack!;
    const mans = myMans();
    const pts = youShift();
    if (a.p === 1 && a.s === 1)
      return { tone: "miss", body: html`<div class="rc-title">[1][1]: automatic miss.</div><div class="rc-actions">${button("Continue", { size: "lg", attrs: html`data-act="miss"` })}</div>` };
    if (a.p === 6 && a.s === 6)
      return {
        tone: "prime",
        body: html`<div class="rc-title">${icon("zap", { size: 20 })} [6][6] Prime Attack!</div>
        <div class="rc-text">Pick any manoeuvre as if performed exactly. Your total Shift (${pts}) is added, and interrupts and armour can't reduce it.</div>
        <div class="man-grid">${mans.map((m, i) => chip(m.name, { icon: "zap", value: `${dmgText(m.dmg)} +${pts}`, attrs: html`data-hit="${i}" data-prime="1"` }))}</div>`,
      };
    const opts = reachable(a.p, a.s, mans, pts);
    // every manoeuvre, reachable ones first (cheapest first); the rest greyed out with the Shift they'd need
    const rest = mans.filter((m) => !opts.some((o) => o.m === m)).map((m) => ({ m, cost: Math.abs(m.a - a.p) + Math.abs(m.b - a.s) }));
    const grid = html`<div class="man-grid">${[
      ...opts.map(({ m, cost }) => chip(`${m.name} ${dice(m.a, m.b)}`, { value: cost ? `shift ${cost}` : "exact", attrs: html`data-hit="${mans.indexOf(m)}"` })),
      ...rest.map(({ m, cost }) => chip(`${m.name} ${dice(m.a, m.b)}`, { value: `shift ${cost}`, disabled: true, attrs: html`title="Out of reach"` })),
    ]}</div>`;
    if (!opts.length)
      return {
        tone: "miss",
        body: html`<div class="rc-title">No manoeuvre is within reach with ${pts} Shift point${pts === 1 ? "" : "s"}. Miss.</div>${grid}<div class="rc-actions">${button("Continue", { size: "lg", attrs: html`data-act="miss"` })}</div>`,
      };
    return {
      tone: "",
      body: html`<div class="rc-text">${opts[0].cost === 0 ? html`<strong>Exact Strike!</strong> Your Shift is added to the damage.` : html`You have <strong>${pts}</strong> Shift point${pts === 1 ? "" : "s"} to move the dice.`}</div>
      ${grid}<div class="rc-actions">${button("Don't hit", { variant: "ghost", attrs: html`data-act="miss"` })}</div>`,
    };
  }

  /** The foe you're facing in the header: the target, else the first one still standing. */
  function facing(): Foe | undefined {
    return st.foes.find((f) => f.id === st.target && f.hpNow > 0) ?? alive()[0] ?? st.foes[0];
  }

  function fightView() {
    const c = loadChar();
    const cs = stats(c);
    const pct = Math.max(0, Math.min(100, (c.hp / cs.baseline) * 100));
    const fb = fatigueBonus(st.fatigue);
    const living = alive();
    const f0 = facing();
    const last = st.log[0] ? html`<div class="last-event"><span class="eyebrow">Last</span> ${logHtml(st.log[0], inline)}</div>` : "";
    let action: Raw | "" = "";
    if (st.phase === "you") {
      const target = living.length > 1 ? html`<p class="muted step-note">Target: <strong>${(st.foes.find((f) => f.id === st.target)?.name ?? "")}</strong> (tap Target on a foe to change)</p>` : "";
      if (st.attack) {
        const o = attackOptions();
        action = html`<article class="result-card attack-card${o.tone ? ` is-${o.tone}` : ""}">
          <header class="rc-head">${eyebrow(`Round ${st.round} · Your attack`)}<span class="rc-dice">D66</span></header>
          ${diceFaces(st.attack.p, st.attack.s)}${o.body}${target}</article>`;
      } else
        action = card(html`${last}${target}<div class="step-actions">${button("Roll your attack (D66)", { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="attack"` })}</div>`, {
          eyebrow: `Round ${st.round} · Your turn`,
          title: "Your attack",
          tone: "accent",
        });
    } else if (st.phase === "foes") {
      const f = living[st.foeTurn];
      action = f
        ? card(html`${last}<div class="step-actions">${button(`Roll for ${f.name} (D66)`, { icon: "dice", size: "lg", variant: "primary", attrs: html`data-act="foe-attack"` })}</div>`, {
            eyebrow: `Round ${st.round} · Their turn`,
            title: `${f.name} attacks`,
            tone: "danger",
          })
        : "";
    } else if (st.phase === "won") {
      const xp = st.foes.reduce((n, f) => n + f.xp, 0);
      action = card(
        html`<div class="step-actions">${button(st.xpBanked ? "XP added" : `Add ${xp} XP to your sheet`, { icon: st.xpBanked ? "check" : "plus", size: "lg", variant: st.xpBanked ? undefined : "primary", attrs: html`data-act="bank-xp"${st.xpBanked ? " disabled" : ""}` })}</div>
        ${st.foes
          .map(
            (f) => html`<article class="result-card step-result"><header class="rc-head">${eyebrow(`${f.name} treasure`)}</header><div class="rc-text">${ctx.inline(f.treasure)}</div>
          <div class="rc-actions">${followOns(f.treasure).map((o) => button(`Roll ${o.label}`, { icon: "dice", size: "sm", variant: "ghost", attrs: html`data-loot="${o.ref.key}|${o.modifier}"` }))}${
            lockedFollowOns(f.treasure).map((o) => button(`🔒 ${o.code}`, { size: "sm", variant: "ghost", attrs: html`data-loot="${o.code}|0"` }))}</div></article>`,
          )}
        ${lockedMsg}
        <p class="muted step-note">Now resolve the rest of the room. You can't take enemy weapons or armour.</p>`,
        { eyebrow: `Round ${st.round} · All foes defeated`, title: "Victory!", titleIcon: "trophy", tone: "accent" },
      );
    } else if (st.phase === "lost") {
      action = card(
        html`<p>Your HP is 0. In combat, if the enemy finishes you the adventure is over (see the rules). If you were brought to 0 by something other than an enemy, roll on RFUT1.</p>
        <div class="step-actions">${button("RFUT1 (recovery)", { icon: "dice", size: "lg", attrs: html`data-loot="RFUT1|0"` })}</div>${lockedMsg}`,
        { eyebrow: `Round ${st.round}`, title: "You've fallen", titleIcon: "skull", tone: "danger" },
      );
    }
    const foeDmg = f0 ? [...f0.man].sort((x, y) => avg(x.dmg) - avg(y.dmg)) : [];
    const foeSide = f0
      ? card(
          html`${statBlock([
            ["Level", `L${f0.level}${f0.type ? ` ${f0.type}` : ""}`],
            ["HP", `${f0.hpNow} / ${f0.hp}`],
            ["Damage", foeDmg.length ? (foeDmg.length > 1 ? `${dmgText(foeDmg[0].dmg)} – ${dmgText(foeDmg[foeDmg.length - 1].dmg)}` : dmgText(foeDmg[0].dmg)) : "—"],
            ["Interrupts", f0.interrupts.length ? f0.interrupts.map((x) => x.name).join(", ") : f0.interruptText ? "Special" : "None"],
          ])}${hpBar(Math.max(0, (f0.hpNow / f0.hp) * 100), true)}`,
          { eyebrow: f0.hpNow <= 0 ? "Defeated" : living.length > 1 ? `Target · ${living.length} standing` : "Facing", title: f0.name, attrs: html`data-side="foe"` },
        )
      : "";
    const youSide = card(
      html`<dl class="stat-block">
        <div><dt>HP</dt><dd><span class="stepper-ctl"><button data-yhp="-1" aria-label="Lower your HP">${icon("minus", { size: 15 })}</button><input value="${c.hp}" readonly aria-label="Your HP"><button data-yhp="1" aria-label="Raise your HP">${icon("plus", { size: 15 })}</button></span> <span class="muted">/ ${cs.baseline}</span></dd></div>
        <div><dt>Shift</dt><dd>${signed(cs.shift)}${fb ? html` <span class="muted">+${fb}</span>` : ""}</dd></div>
        <div><dt>Fatigue die</dt><dd><span class="fatigue">${st.fatigue}</span></dd></div>
      </dl>${hpBar(pct)}`,
      { eyebrow: "You", title: c.name || "You", attrs: html`data-side="you"` },
    );
    return html`<div class="round-bar">${eyebrow(`Round ${st.round}`)}
          ${fb ? html`<span class="badge">+${fb} Shift to all</span>` : ""}
          ${st.killedRound1 && st.round === 2 ? html`<span class="badge is-accent">Fearful momentum +2 Shift</span>` : ""}
          ${st.round >= 7 ? html`<span class="warn">Round 7+: movement and item interrupts stop working (armour still applies)</span>` : ""}
        </div>
      <div class="combat-face">${foeSide}<div class="vs" aria-hidden="true">${icon("swords", { size: 20 })}</div>${youSide}</div>
      ${action}
      ${card(html`<div class="foes">${st.foes.map(foeCard)}</div>`, { eyebrow: `${living.length} of ${st.foes.length} standing`, title: "Foes" })}
      ${card(html`<ol class="combat-log">${st.log.map((l) => html`<li>${logHtml(l, inline)}</li>`)}</ol>`, { eyebrow: `${st.log.length} event${st.log.length === 1 ? "" : "s"}`, title: "Combat log" })}`;
  }

  function draw() {
    setHTML(root, html`<header class="play-head">
        <div class="play-title">${eyebrow(st.phase === "setup" ? "Play · Setup" : "Play")}<h1>${icon("swords", { size: 26 })}<span>Combat</span></h1></div>
        <div class="play-actions">${st.phase !== "setup" ? button(st.phase === "won" || st.phase === "lost" ? "New fight" : "End fight", { icon: st.phase === "won" || st.phase === "lost" ? "rotate-ccw" : "x", attrs: html`data-act="end"` }) : ""}
        <a class="btn btn-ghost" href="#/s/core%2Fcombat-sequence">${icon("book", { size: 17 })}<span>Combat rules</span></a></div></header>
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

  function setYouHp(delta: number) {
    const c = loadChar();
    c.hp = Math.max(0, c.hp + delta);
    saveChar(c, "combat");
    if (c.hp <= 0 && st.phase !== "won") st.phase = "lost";
    return c.hp;
  }

  function nextAfterYou() {
    st.attack = null;
    if (!alive().length) {
      st.phase = "won";
      log(strong(["All foes defeated."]));
      return;
    }
    if (!alive().some((f) => f.id === st.target)) st.target = alive()[0].id;
    st.phase = "foes";
    st.foeTurn = 0;
  }
  function endRound() {
    st.round++;
    st.fatigue = Math.min(6, st.fatigue + 1);
    st.phase = "you";
    log(em(`Round ${st.round} begins. Fatigue die ${st.fatigue}.`));
  }

  async function yourHit(i: number, prime: boolean) {
    const m = myMans()[i];
    const foe = st.foes.find((f) => f.id === st.target) ?? alive()[0];
    const a = st.attack!;
    const exact = !prime && m.a === a.p && m.b === a.s;
    if (prime || exact) bus.emit("combat:hit", { kind: prime ? "prime" : "exact" });
    const pts = youShift();
    const r = await rollDamage(m.dmg);
    let dmg = r.total + (exact || prime ? pts : 0);
    const parts = [`${m.name}: ${r.text}${exact || prime ? ` + Shift ${pts}` : ""}`];
    // the final dice after shifting are the manoeuvre's dice set
    let intr: LogNode[] = [];
    if (!prime) {
      // only one interrupt per round: the one that hurts you most
      const matches = (x: Interrupt) => (x.die === "P" ? x.values.includes(m.a) : x.die === "S" ? x.values.includes(m.b) : x.values.includes(m.a) || x.values.includes(m.b));
      const hit = foe.interrupts.filter((x) => x.mod !== null && matches(x)).sort((x, y) => y.mod! - x.mod!)[0];
      if (hit) {
        dmg -= hit.mod!;
        intr = [` ${foe.name}'s `, em(hit.name), ` (${hit.die === "P" ? `Primary ${m.a}` : hit.die === "S" ? `Secondary ${m.b}` : "any die"}) −${hit.mod}`];
      } else {
        const special = foe.interrupts.find((x) => x.mod === null && matches(x));
        if (special) intr = [" Interrupt: ", em(special.text), " (apply its effect)."];
      }
    }
    if (dmg < 1 && r.six) dmg = 1; // a 6 on a damage die always does at least 1 damage
    dmg = Math.max(0, dmg);
    foe.hpNow = Math.max(0, foe.hpNow - dmg);
    playSfx(prime || exact ? "hit-crit" : "hit");
    if (foe.hpNow <= 0) setTimeout(() => playSfx("foe-down"), 350);
    log(
      ...(prime ? [strong([{ icon: "zap" }, " Prime Attack!"], "tone-prime"), " "] : exact ? [strong(["Exact Strike!"], "tone-exact"), " "] : []),
      `You hit ${foe.name}: ${parts.join("")}`, ...intr, " = ", strong([String(dmg)]), " damage.",
      ...(m.extra ? [" ", em(m.extra)] : []),
      ...(foe.hpNow <= 0 ? [" ", strong([`${foe.name} is defeated!`])] : [` (${foe.hpNow} HP left)`]),
    );
    if (foe.hpNow <= 0 && st.round === 1) st.killedRound1 = true;
    nextAfterYou();
  }

  async function foeAttack() {
    const f = alive()[st.foeTurn];
    if (!f) return;
    const r = await rollDice("D66");
    const [p, s] = r.dice;
    if (p === 1 && s === 1) playSfx("fumble");
    else if (p === 6 && s === 6) playSfx("hit-crit");
    if (p === 1 && s === 1) log(`${f.name} rolls [1][1], a `, strong(["Mishap"], "tone-miss"), ": ", { book: f.mishap });
    else if (p === 6 && s === 6) log(`${f.name} rolls [6][6], a `, strong([{ icon: "zap" }, " Prime Attack"], "tone-prime"), ": ", { book: f.prime }, " ", span("muted", ["(apply the damage with the − button; armour can't stop it)"]));
    else {
      const pts = Math.max(0, f.sh + fatigueBonus(st.fatigue));
      // shift optimally: the strongest manoeuvre it can reach
      const opts = reachable(p, s, f.man, pts).sort((x, y) => avg(y.m.dmg) - avg(x.m.dmg));
      if (!opts.length) playSfx("miss");
      if (!opts.length) log(`${f.name} rolls ${dice(p, s)} and can't reach a manoeuvre with ${pts} Shift: `, strong(["miss"], "tone-miss"), ".");
      else {
        const m = opts[0].m;
        const d = await rollDamage(m.dmg);
        let dmg = d.total;
        // armour deflection: one piece, the best one, if the final dice match its dice set
        const c = loadChar();
        let armourNote: LogNode[] = [];
        let best = 0;
        for (const a of c.armour) {
          if (!a[0] || !a[1]) continue;
          const sets = armourSets(a[1]);
          if (sets.prim.includes(m.a) || sets.sec.includes(m.b)) {
            const red = Math.abs(parseInt(a[2]?.match(/-?\d+/)?.[0] ?? "0", 10));
            if (red > best) {
              best = red;
              armourNote = [" ", span("deflect", [{ icon: "shield" }, " Your ", em(a[0]), ` deflects −${red}.`])];
            }
          }
        }
        dmg -= best;
        if (dmg < 1 && d.six) dmg = 1;
        dmg = Math.max(0, dmg);
        if (best > 0) playSfx("armour-block");
        if (dmg > 0) playSfx("hurt");
        const hp = setYouHp(-dmg);
        log(
          `${f.name} rolls ${dice(p, s)}${opts[0].cost ? `, shifts ${opts[0].cost}` : ""} → `, strong([m.name]), ` ${dice(m.a, m.b)}: ${d.text}.`,
          ...armourNote, " You take ", strong([String(dmg)]), ` damage (${hp} HP left).`, ...(m.extra ? [" ", em(m.extra)] : []),
        );
        if (hp <= 0) {
          st.phase = "lost";
          return;
        }
      }
    }
    st.foeTurn++;
    if (st.foeTurn >= alive().length) endRound();
  }

  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    b.disabled = true;
    const phaseBefore = st.phase;
    lockedMsg = "";
    try {
      const act = b.dataset.act;
      if (act === "manual") {
        const c = manualCreature(manual, `MANUAL|${st.nextId}`);
        if (typeof c === "string") return ctx.toast(c);
        st.foes.push({ ...c, id: st.nextId++, hpNow: c.hp });
        manual = blankManual(); // ready for the next one; the form stays open
      } else if (b.dataset.add) {
        const c = all.find((x) => x.key === b.dataset.add);
        if (c) st.foes.push({ ...c, id: st.nextId++, hpNow: c.hp });
      } else if (b.dataset.remove) st.foes = st.foes.filter((f) => f.id !== +b.dataset.remove!);
      else if (act === "start" || act === "start-foes") {
        st = { ...fresh(), foes: st.foes, nextId: st.nextId, phase: act === "start" ? "you" : "foes", target: st.foes[0]?.id ?? null };
        log(em(`The fight begins${act === "start-foes" ? ". They attack first" : ""}. Fatigue die 1.`));
      } else if (act === "attack") {
        const r = await rollDice("D66");
        st.attack = { p: r.dice[0], s: r.dice[1] };
        log(`You roll ${dice(r.dice[0], r.dice[1])}.`);
      } else if (b.dataset.hit) await yourHit(+b.dataset.hit, b.dataset.prime === "1");
      else if (act === "miss") {
        playSfx(st.attack?.p === 1 && st.attack?.s === 1 ? "fumble" : "miss");
        log("You ", strong([{ icon: "circle-x" }, " miss"], "tone-miss"), ".");
        nextAfterYou();
      } else if (act === "foe-attack") await foeAttack();
      else if (b.dataset.target) st.target = +b.dataset.target;
      else if (b.dataset.fhp) {
        const f = st.foes.find((x) => x.id === +b.dataset.fhp!)!;
        f.hpNow = Math.max(0, Math.min(f.hp, f.hpNow + +b.dataset.d!));
        if (!alive().length && st.phase !== "setup") st.phase = "won";
      } else if (b.dataset.yhp) setYouHp(+b.dataset.yhp);
      else if (act === "bank-xp") {
        const c = loadChar();
        const xp = st.foes.reduce((n, f) => n + f.xp, 0);
        // a level reached now gives its +10 HP at once (Core Rules: "the minute you have enough XP")
        const ch = addXp(c, xp, levelOf);
        saveChar(c, "combat");
        st.xpBanked = true;
        const lvl = levelChangeText(ch, LEVELS[ch.to - 1].title);
        if (ch.to > ch.from) playSfx("level-up");
        ctx.toast(`+${xp} XP added to your sheet.${lvl ? ` ${lvl}` : ""}`);
        bus.emit("journal:fight", { phase: "xp", xp });
      } else if (b.dataset.loot) {
        const [code, mod] = b.dataset.loot.split("|");
        const ref = tableByCode(code);
        if (isTableRef(ref)) {
          const r = await rollAndLog(ref, +mod || 0, undefined, "Treasure");
          if (st.phase === "won" && r.rowIndex >= 0) bus.emit("journal:fight", { phase: "loot", text: r.cells[1] || `${ref.title} ${r.value}` });
        } else if (isLockedTable(ref)) lockedMsg = lockedCard(ref.locked);
        else ctx.toast(`Couldn't find table ${code}.`);
      } else if (act === "end") {
        if (st.phase !== "won" && st.phase !== "lost" && !confirm("End this fight?")) return;
        st = fresh();
      }
      persist();
      // the fight just ended: tell the Journal
      const ended = phaseBefore !== "won" && phaseBefore !== "lost" && (st.phase === "lost" || (st.phase === "won" && st.foes.some((f) => f.hpNow <= 0)));
      if (ended && (st.phase === "won" || st.phase === "lost"))
        bus.emit("journal:fight", { phase: "end", outcome: st.phase, foes: st.foes.map((f) => f.name), rounds: st.round, xp: st.foes.reduce((n, f) => n + f.xp, 0) });
      draw();
    } finally {
      b.disabled = false;
    }
  });

  // the character bar changed the Fatigue die: take just that field, so our next persist() keeps it
  ctx.onDispose(
    bus.on("combat:changed", ({ source }) => {
      if (source === "combat") return;
      const saved = load<State>("combat", fresh());
      if (saved.fatigue === st.fatigue) return;
      st.fatigue = saved.fatigue;
      draw();
    }),
  );
  // HP changed elsewhere (character bar, sheet): the fight view shows it
  ctx.onDispose(
    bus.on("character:changed", ({ source }) => {
      if (source !== "combat" && st.phase !== "setup") draw();
    }),
  );
  draw();
  makeCardsArrangeable(root, "2d6:shell:panes:combat", ctx.onDispose);
}
