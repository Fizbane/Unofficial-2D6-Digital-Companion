// The character bar's chip popovers: a small − / + panel next to the chip that opened it.
//   hp       HP ± (stepHp), HP bonus ± (bonusHp, raises the baseline), "+ Bloodied" / "+ Soaked"
//   xp       XP ± 1 and a typed value (level changes toast like the sheet)
//   fatigue  the combat Fatigue die, 1–6, only while a fight is on (writes "2d6:play:combat")
//   bloodied / soaked   0–8 ± and Clear
// In 2D6 Void the same kinds edit the survivor (void/sheetmodel.ts), plus stunned (0–8 ± and Clear)
// and marks (the Ranged Hits bar ± and "Hit a new enemy"); the XP popover also lists the XP sources.
// Character edits save with source "strip"; the chips and this popover redraw through
// character:changed / combat:changed. Esc closes and returns focus to the chip; outside click closes.
import { bus } from "./events";
import { load, save } from "../tools/common";
import { button } from "../ui/components";
import { playSfx } from "../audio/sound";
import { applyXp, fatigueEditable, levelChangeText, signed, stepBonusHp, stepCondition, stepFatigue, stepHp, stepRations } from "./charmodel";
import { isVoid } from "../games";
import { addRangedHit, levelChangeText as vLevelText, loadVChar, rangedBarText, RANGED_HITS_BAR, saveVChar, setRangedHits, setXp as setVXp, vstats, XP_SOURCES, type LevelChange, type RangedHitResult, type VoidCharacter } from "../tools/void/sheetmodel";
import { html, type Raw, setHTML } from "../ui/html";

export type PopKind = "hp" | "xp" | "fatigue" | "bloodied" | "soaked" | "rations" | "stunned" | "marks";
type SheetModule = typeof import("../tools/sheet");
type Combat = { phase?: string; fatigue?: number } & Record<string, unknown>;

const SOURCE = "strip";
const LABEL: Record<PopKind, string> = { hp: "Hit points", xp: "Experience", fatigue: "Fatigue die", rations: "Rations", bloodied: "Bloodied", soaked: "Soaked", stunned: "Stunned", marks: "Marksmanship" };
const AFTER8 = { bloodied: "After 8: FEVER, −1 HP per room.", soaked: "After 8: PNEUMONIA, −1 HP per room." };

const loadCombat = () => load<Combat | null>("combat", null);

export interface CharPops {
  toggle(kind: PopKind, anchor: HTMLElement): void;
  close(focusChip?: boolean): void;
  /** Redraw the open popover (after a save); closes it if its chip is gone. */
  redraw(): void;
  kind(): PopKind | null;
}

/** `bar` holds the popover (positioned against it); `scope` (default `bar`) is where the chips are, which on
 *  narrow screens is the character bar while the popover still hangs off the top bar. */
export function initCharPops(bar: HTMLElement, o: { sheet(): SheetModule | null; toast(msg: string): void; closeOthers(): void; scope?: () => HTMLElement }): CharPops {
  const pop = document.createElement("div");
  pop.className = "strip-pop";
  pop.setAttribute("role", "dialog");
  pop.hidden = true;
  bar.append(pop);
  let open: PopKind | null = null;

  const chipOf = (k: PopKind) => (o.scope?.() ?? bar).querySelector<HTMLElement>(`[data-pop="${k}"]`);
  const stepBtns = (act: string, what: string) => [
    button("", { icon: "minus", variant: "ghost", size: "sm", attrs: html`data-act="${act}:-1" aria-label="${what} −1"` }),
    button("", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="${act}:1" aria-label="${what} +1"` }),
  ];
  const row = (label: string, act: string, value: Raw) => {
    const [minus, plus] = stepBtns(act, label);
    return html`<div class="pop-row"><span class="pop-label">${label}</span>${minus}<span class="strip-pop-value" aria-live="polite">${value}</span>${plus}</div>`;
  };

  /** The popover's markup, or null when it no longer applies (the chip is gone). */
  function body(k: PopKind, sheet: SheetModule): Raw | null {
    const c = sheet.loadChar();
    const s = sheet.stats(c);
    if (k === "hp") {
      const starts = (["bloodied", "soaked"] as const)
        .filter((x) => !(c[x] > 0))
        .map((x) => button(LABEL[x], { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="start:${x}" title="Start ${LABEL[x]} at 1"` }));
      return (
        html`${row("HP", "hp", html`<strong>${c.hp}</strong><span class="muted"> / ${s.baseline}</span>`)}${row("HP bonus", "bonus", html`<strong>${signed(c.bonusHp || 0)}</strong>`)}${starts.length ? html`<div class="pop-actions">${starts}</div>` : ""}`
      );
    }
    if (k === "xp") {
      const [minus, plus] = stepBtns("xp", "XP");
      const next = Number.isFinite(s.nextXp) ? `${s.nextXp - c.xp} XP to level ${s.level + 1}` : "Top level";
      return html`<div class="pop-row"><span class="pop-label">XP</span>${minus}<input class="pop-input" type="number" min="0" step="1" inputmode="numeric" value="${c.xp}" data-xp-input aria-label="XP">${plus}</div>
        <p class="pop-hint muted">Level ${s.level} · ${next}</p>`;
    }
    if (k === "fatigue") {
      const cb = loadCombat();
      if (!fatigueEditable(cb)) return null;
      return row("Fatigue die", "fatigue", html`<strong>${cb!.fatigue ?? 1}</strong><span class="muted"> / 6</span>`);
    }
    if (k === "rations" || k === "stunned" || k === "marks" || !(c[k] > 0)) return null;
    return (
      html`${row(LABEL[k], "cond", html`<strong>${c[k]}</strong><span class="muted"> / 8</span>`)}<div class="pop-actions">${button("Clear", { variant: "ghost", size: "sm", attrs: html`data-act="clear"` })}</div>
      <p class="pop-hint muted">${AFTER8[k]}</p>`
    );
  }

  /** The Void survivor's popover for kind k, or null when it doesn't apply. */
  function voidBody(k: PopKind): Raw | null {
    const c = loadVChar();
    const s = vstats(c);
    if (k === "hp")
      return html`${row("HP", "vhp", html`<strong>${c.hp}</strong><span class="muted"> / ${s.baseline}</span>`)}${c.bloodied > 0 ? "" : html`<div class="pop-actions">${button("Bloodied", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="vstart" title="Become Bloodied (ticks the first box)"` })}</div>`}`;
    if (k === "xp") {
      const [minus, plus] = stepBtns("vxp", "XP");
      const next = Number.isFinite(s.nextXp) ? `${s.nextXp - c.xp} XP to level ${s.level + 1}` : "Top level";
      return html`<div class="pop-row"><span class="pop-label">XP</span>${minus}<input class="pop-input" type="number" min="0" step="10" inputmode="numeric" value="${c.xp}" data-xp-input aria-label="XP">${plus}</div>
        <p class="pop-hint muted">Level ${s.level} · ${next} · ± steps 10</p>
        <div class="pop-actions pop-xp-sources">${XP_SOURCES.map((x) => button(`${x.label} +${x.per * s.level}`, { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="vxpsrc:${x.per * s.level}" data-label="${x.label}"` }))}</div>`;
    }
    if (k === "bloodied" || k === "stunned") {
      if (!(c[k] > 0)) return null;
      return html`${row(LABEL[k], "vcond", html`<strong>${c[k]}</strong><span class="muted"> / 8</span>`)}<div class="pop-actions">${button("Clear", { variant: "ghost", size: "sm", attrs: html`data-act="vclear"` })}</div>
        <p class="pop-hint muted">${k === "bloodied" ? "After 8: FEVER, −1 HP per room." : "Rooms left stunned."}</p>`;
    }
    if (k === "marks")
      return html`${row("Ranged hits", "vhits", html`<strong>${c.rangedHits}</strong><span class="muted"> / ${RANGED_HITS_BAR}</span>`)}
        <div class="pop-actions">${button("Hit a new enemy", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-act="vhit"` })}</div>
        <p class="pop-hint muted">Marksmanship ${s.marksmanship}. A full bar gives +1 (max 10) and XP.</p>`;
    return null;
  }

  /** The ration count: the Void survivor's in Void, else the Dungeon character's (null until the sheet has loaded). */
  const rationCount = (sheet: SheetModule | null): number | null => (isVoid() ? loadVChar().rations : sheet ? sheet.loadChar().rations ?? 0 : null);

  function draw() {
    const sheet = o.sheet();
    if (!open) return;
    if (open !== "rations" && !sheet && !isVoid()) return;
    const count = open === "rations" ? rationCount(sheet) : null;
    const h = open === "rations" ? (count == null ? null : row("Rations", "rations", html`<strong>${count}</strong>`)) : isVoid() ? voidBody(open) : body(open, sheet!);
    if (h == null) return close(false, true);
    const active = document.activeElement as HTMLElement | null;
    const focused = pop.contains(active) ? (active!.dataset.act ?? (active!.dataset.xpInput != null ? "xp-input" : "")) : "";
    setHTML(pop, h);
    pop.setAttribute("aria-label", LABEL[open]);
    const anc = anchorEl?.isConnected ? anchorEl : chipOf(open); // the chips redraw on each save
    if (anc) place(anc); // the content's width may have changed
    if (focused === "xp-input") pop.querySelector<HTMLElement>("[data-xp-input]")?.focus();
    else if (focused) (pop.querySelector<HTMLElement>(`[data-act="${focused}"]`) ?? pop.querySelector<HTMLElement>("button"))?.focus();
  }

  let anchorEl: HTMLElement | null = null;
  /** Under the chip, kept clear of the right-hand panel (it stacks above the top bar). */
  function place(anchor: HTMLElement) {
    anchorEl = anchor;
    const a = anchor.getBoundingClientRect();
    const f = bar.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>("aside.panel")?.getBoundingClientRect();
    const right = panel && panel.width > 0 && panel.left > a.left ? Math.min(f.right, panel.left) : f.right;
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(4, Math.min(a.left - f.left, right - f.left - w - 8))}px`;
    pop.style.top = `${a.bottom - f.top + 4}px`;
  }

  function onOutside(e: Event) {
    const t = e.target as HTMLElement;
    if (!pop.contains(t) && !t.closest("[data-pop]")) close();
  }

  function show(k: PopKind, anchor: HTMLElement) {
    o.closeOthers();
    open = k;
    pop.hidden = false;
    draw();
    if (!open) return; // nothing to edit after all
    place(anchor);
    anchor.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    (pop.querySelector<HTMLElement>("[data-xp-input]") ?? pop.querySelector<HTMLElement>("button"))?.focus();
  }

  /** `toHp`: the chip is gone (a condition reached 0), so focus goes to the HP chip instead. */
  function close(focusChip = false, toHp = false) {
    if (!open) return;
    const k = open;
    const hadFocus = pop.contains(document.activeElement);
    open = null;
    pop.hidden = true;
    pop.replaceChildren();
    document.removeEventListener("pointerdown", onOutside, true);
    const chip = chipOf(k);
    chip?.setAttribute("aria-expanded", "false");
    if (focusChip || (toHp && hadFocus)) (chip ?? chipOf("hp"))?.focus();
  }

  function setXp(xp: number, sheet: SheetModule) {
    const c = sheet.loadChar();
    if (xp === c.xp) return;
    const ch = applyXp(c, xp, sheet.levelFn(c), sheet.baseHpFn(c));
    sheet.saveChar(c, SOURCE);
    const msg = levelChangeText(ch, sheet.levelTitle(c, ch.to));
    if (ch.to > ch.from) playSfx("level-up");
    if (msg) o.toast(msg);
  }

  /** Toast a Void level change (and play the level-up sound on a gain). */
  const vLevel = (c: VoidCharacter, ch: LevelChange) => {
    const msg = vLevelText(c, ch);
    if (ch.to > ch.from) playSfx("level-up");
    if (msg) o.toast(msg);
  };
  const vHits = (c: VoidCharacter, r: RangedHitResult) => {
    if (!r.filled) return;
    playSfx("level-up");
    o.toast(rangedBarText(c, r));
    vLevel(c, r.level);
  };
  /** A Void popover action. */
  function voidAct(act: string, d: number, b: HTMLElement) {
    const c = loadVChar();
    if (act === "vhp") c.hp = stepHp(c.hp, d);
    else if (act === "vstart") c.bloodied = Math.max(1, c.bloodied);
    else if (act === "vxp") vLevel(c, setVXp(c, c.xp + d * 10));
    else if (act === "vxpsrc") {
      o.toast(`${b.dataset.label}: +${d} XP.`);
      vLevel(c, setVXp(c, c.xp + d));
    } else if (act === "vcond" && (open === "bloodied" || open === "stunned")) c[open] = stepCondition(c[open], d);
    else if (act === "vclear" && (open === "bloodied" || open === "stunned")) c[open] = 0;
    else if (act === "vhits") vHits(c, setRangedHits(c, c.rangedHits + d));
    else if (act === "vhit") vHits(c, addRangedHit(c));
    else return;
    saveVChar(c, SOURCE); // redraws the chips and this popover through void:changed
  }

  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    const sheet = o.sheet();
    if (!b || !open) return;
    const [act, n] = b.dataset.act!.split(":");
    const d = +n || 0;
    if (isVoid() && act !== "rations") return voidAct(act, d, b);
    if (act === "rations") {
      if (isVoid()) {
        const v = loadVChar();
        const r = stepRations(v.rations, d);
        if (r === v.rations) return;
        v.rations = r;
        saveVChar(v, SOURCE);
      } else if (sheet) {
        const c = sheet.loadChar();
        const r = stepRations(c.rations, d);
        if (r === c.rations) return;
        c.rations = r;
        sheet.saveChar(c, SOURCE);
      }
      return;
    }
    if (!sheet) return;
    if (act === "fatigue") {
      const cb = loadCombat();
      if (!cb || !fatigueEditable(cb)) return close(true);
      const f = stepFatigue(cb.fatigue, d);
      if (f === (cb.fatigue ?? 1)) return;
      save("combat", { ...cb, fatigue: f });
      bus.emit("combat:changed", { source: SOURCE }); // the chips, panel and an open Combat tab pick it up
      return;
    }
    if (act === "xp") return setXp(sheet.loadChar().xp + d, sheet);
    const c = sheet.loadChar();
    if (act === "hp") {
      const hp = stepHp(c.hp, d);
      if (hp === c.hp) return;
      c.hp = hp;
    } else if (act === "bonus") c.bonusHp = stepBonusHp(c.bonusHp, d);
    else if (act === "start") c[n as "bloodied" | "soaked"] = 1;
    else if (act === "cond" && (open === "bloodied" || open === "soaked")) {
      const v = stepCondition(c[open], d);
      if (v === c[open]) return;
      c[open] = v;
    } else if (act === "clear" && (open === "bloodied" || open === "soaked")) c[open] = 0;
    else return;
    sheet.saveChar(c, SOURCE); // redraws the chips and this popover through character:changed
  });
  pop.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    const sheet = o.sheet();
    if (el.dataset.xpInput == null) return;
    const v = parseInt(el.value, 10);
    if (Number.isNaN(v)) return draw();
    if (isVoid()) {
      const c = loadVChar();
      if (v !== c.xp) {
        vLevel(c, setVXp(c, v));
        saveVChar(c, SOURCE);
      }
      return draw();
    }
    if (!sheet) return;
    setXp(v, sheet);
    draw();
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  });

  return {
    toggle: (k, anchor) => (open === k ? close() : show(k, anchor)),
    close,
    redraw: draw,
    kind: () => open,
  };
}
