// The character bar, under the top bar: chips (name with portrait: hover flyout
// with the character card, charflyout.ts; HP, Bloodied, Soaked, XP, Fatigue: − / + popovers saved
// with source "strip", charbar-pop.ts; Shift opens the flyout too) and the quick dice
// D6 · 2D6 · D66 · D3 with Re-roll last. Under 900px it is just the HP chip and a dice button that
// opens the quick dice as a popover (CSS).
import type { Character } from "../tools/sheet";
import { load } from "../tools/common";
import { rollDice } from "../dice3d";
import { button, chip } from "../ui/components";
import { bus } from "./events";
import { fatigueEditable, fatigueText, signed } from "./charmodel";
import { initCharPops, type PopKind } from "./charbar-pop";
import { initCharFlyout } from "./charflyout";
import { portrait } from "./panels/charcard";
import { hasLast, logDice, rerollLast } from "./panels/results";
import { NARROW_MQ } from "./layout";
import { icon } from "../ui/icon";
import { html, setHTML } from "../ui/html";
import { isVoid } from "../games";
import { voidCard, voidChips } from "./vcharbar";

const SOURCE = "strip";
const DICE = ["D6", "2D6", "D66", "D3"];

type SheetModule = typeof import("../tools/sheet");
let sheet: SheetModule | null = null;

interface Opts {
  toast(msg: string): void;
  openTab(route: string): void;
  isSearchOpen(): boolean;
}

/** Build the character bar (chips + quick dice, under the top bar) into `bar`. */
export function initBottomBar(bar: HTMLElement, o: Opts): void {
  setHTML(bar, html`
    <div class="strip-row strip-main">
      <div class="strip-chips" role="group" aria-label="Character"></div>
      <button type="button" class="chip strip-dice-btn" data-dice-menu aria-haspopup="true" aria-expanded="false" aria-label="Quick dice" title="Quick dice">${icon("dice", { size: 16 })}<span class="chip-label">Dice</span></button>
      <div class="strip-dice" role="group" aria-label="Quick dice">
        ${DICE.map((d) => button(d, { size: "sm", attrs: html`data-die="${d}" aria-label="Roll ${d}"` }))}
        ${button("Re-roll last", { icon: "rotate-ccw", variant: "ghost", size: "sm", attrs: html`data-reroll title="Repeat the last roll" disabled` })}
      </div>
    </div>`);
  const chips = bar.querySelector<HTMLElement>(".strip-chips")!;
  const reroll = bar.querySelector<HTMLButtonElement>("[data-reroll]")!;

  // ---------- chips ----------
  function drawChips() {
    // 2D6 Void: its own survivor's chips (vcharbar.ts); each opens the Void sheet
    if (isVoid()) {
      setHTML(chips, voidChips());
      if (flyout.isOpen()) flyout.redraw();
      return;
    }
    if (!sheet) {
      setHTML(chips, html`<span class="muted strip-loading">Loading the character…</span>`);
      return;
    }
    const c: Character = sheet.loadChar();
    const s = sheet.stats(c);
    const pct = Math.max(0, Math.min(100, (c.hp / s.baseline) * 100));
    const combat = load<{ phase?: string; fatigue?: number } | null>("combat", null);
    const open = pops.kind();
    const exp = (k: string) => html`aria-haspopup="dialog" aria-expanded="${String(open === k)}"`;
    const cond = (k: "bloodied" | "soaked", label: string) =>
      c[k] > 0
        ? chip(label, { value: `${Math.min(8, c[k])}/8`, attrs: html`data-pop="${k}" ${exp(k)} title="Change ${label}"${c[k] >= 8 ? html` data-full=""` : ""}` })
        : "";
    setHTML(chips, html`<button type="button" class="chip strip-name" data-name-chip aria-haspopup="dialog" aria-expanded="${String(flyout.isOpen())}" title="Character">${portrait(c, "sm")}<span class="chip-label">${c.name || "Adventurer"} · Lv ${s.level}</span></button><button type="button" class="chip strip-hp" data-hp-chip data-pop="hp" ${exp("hp")} title="Change HP"><span class="chip-label">HP</span><span class="strip-hp-bar" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="chip-value">${c.hp}/${s.baseline}</span></button>${cond("bloodied", "Bloodied")}${cond("soaked", "Soaked")}${chip("XP", { value: String(c.xp), attrs: html`data-pop="xp" ${exp("xp")} title="Change XP"` })}${chip("Shift", { value: signed(s.shift), attrs: html`data-char aria-haspopup="dialog" title="Show the character"` })}${(fatigueEditable(combat)
        ? chip("Fatigue", { value: fatigueText(combat), attrs: html`data-pop="fatigue" ${exp("fatigue")} title="Change the Fatigue die"` })
        : chip("Fatigue", { value: "—", attrs: html`aria-disabled="true" data-off title="The Fatigue die is only used during a fight"` }))}`);
    if (open) pops.redraw();
    if (flyout.isOpen()) flyout.redraw();
  }

  // only one popover at a time: chips, flyout, quick dice
  const closeOthers = () => {
    pops.close();
    flyout.close();
    closeDice();
  };
  const pops = initCharPops(bar, { sheet: () => sheet, toast: o.toast, closeOthers: () => closeOthers() });
  const flyout = initCharFlyout(bar, {
    sheet: () => sheet,
    openSheet: () => o.openTab(isVoid() ? "#/play/vsheet" : "#/play/sheet"),
    closeOthers: () => closeOthers(),
    busy: () => pops.kind() !== null,
    ...(isVoid() ? { voidCard } : {}),
  });

  // name and Shift chips: a click, tap or Enter toggles the flyout (hover alone also shows it);
  // from the keyboard, focus moves into it
  chips.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (isVoid()) {
      // the name chip toggles the survivor flyout (as in Dungeon); the other chips open the sheet
      if (t.closest("[data-name-chip]")) return flyout.toggle(e.detail === 0);
      if (t.closest("[data-vchip]")) o.openTab("#/play/vsheet");
      return;
    }
    if (t.closest("[data-name-chip], [data-char]")) return flyout.toggle(e.detail === 0);
    const p = t.closest<HTMLElement>("[data-pop]");
    if (p) return pops.toggle(p.dataset.pop as PopKind, p);
  });

  // ---------- dice ----------
  const dice = bar.querySelector<HTMLElement>(".strip-dice")!;
  const diceBtn = bar.querySelector<HTMLElement>("[data-dice-menu]")!;
  // narrow screens: the dice are a popover opened from the dice button
  function onOutsideDice(e: Event) {
    const t = e.target as HTMLElement;
    if (!dice.contains(t) && !diceBtn.contains(t)) closeDice();
  }
  function openDice() {
    closeOthers();
    dice.setAttribute("data-popover-open", "");
    diceBtn.setAttribute("aria-expanded", "true");
    const a = diceBtn.getBoundingClientRect();
    const f = bar.getBoundingClientRect();
    dice.style.right = `${Math.max(0, f.right - a.right)}px`;
    dice.style.top = `${a.bottom - f.top + 4}px`;
    document.addEventListener("pointerdown", onOutsideDice, true);
    dice.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }
  function closeDice(focusBtn = false) {
    if (!dice.hasAttribute("data-popover-open")) return;
    dice.removeAttribute("data-popover-open");
    dice.style.right = dice.style.top = "";
    diceBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutsideDice, true);
    if (focusBtn) diceBtn.focus();
  }
  diceBtn.addEventListener("click", () => (dice.hasAttribute("data-popover-open") ? closeDice() : openDice()));
  dice.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dice.hasAttribute("data-popover-open")) {
      e.preventDefault();
      closeDice(true);
    }
  });
  const narrow = window.matchMedia(NARROW_MQ);
  const closeIfWide = () => !narrow.matches && closeDice();
  narrow.addEventListener("change", closeIfWide);
  window.addEventListener("resize", closeIfWide);

  const syncReroll = () => (reroll.disabled = !hasLast());
  dice.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const die = t.closest<HTMLElement>("[data-die]")?.dataset.die;
    if (die || t.closest("[data-reroll]")) closeDice(true);
    if (die) {
      const r = await rollDice(die);
      logDice(r);
      o.toast(`${r.label}: ${r.text}`);
      return;
    }
    if (t.closest("[data-reroll]") && !reroll.disabled) {
      reroll.disabled = true;
      try {
        await rerollLast();
      } finally {
        syncReroll();
      }
    }
  });
  bus.on("roll", syncReroll);
  syncReroll();

  bus.on("character:changed", drawChips);
  bus.on("combat:changed", drawChips);
  if (isVoid()) bus.on("void:changed", drawChips);
  drawChips();
  // Dungeon's sheet (the chips, popovers and flyout read it); Void never opens them
  if (!isVoid()) void import("../tools/sheet").then((m) => {
    sheet = m;
    drawChips();
  });
}

