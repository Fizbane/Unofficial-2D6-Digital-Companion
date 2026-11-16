// The character chips, as two groups the player can move (Settings -> Arrange the bars): the player (name
// chip) and the stats, each on the top bar beside the game logos or on the lower bar, in any order
// (barlayout.ts). The lower bar hides when it is empty. Under 900px both sit in the lower bar, where only
// the HP chip shows. The chips: name with portrait (hover flyout with the character card, charflyout.ts;
// HP, Bloodied, Soaked, XP, Fatigue: − / + popovers saved with source "strip", charbar-pop.ts; Shift opens
// the flyout too). The dice are the floating button, dicefab.ts.
import type { Character } from "../tools/sheet";
import { load } from "../tools/common";
import { button, chip } from "../ui/components";
import { bus } from "./events";
import { fatigueEditable, fatigueText, signed } from "./charmodel";
import { initCharPops, type PopKind } from "./charbar-pop";
import { initCharFlyout } from "./charflyout";
import { portrait } from "./panels/charcard";
import { NARROW_MQ } from "./layout";
import { icon } from "../ui/icon";
import { html, setHTML } from "../ui/html";
import { isVoid } from "../games";
import { voidCard, voidChipParts } from "./vcharbar";
import { canStep, barOf, DEFAULT_BARS, GROUP_LABEL, GROUPS, placeGroup, readBars, stepGroup, swapBar, writeBars, type BarId, type BarLayout, type GroupId } from "./barlayout";

const SOURCE = "strip";

type SheetModule = typeof import("../tools/sheet");
let sheet: SheetModule | null = null;

interface Opts {
  /** The top bar's slot for the chips (from 900px wide); their popovers hang off `popHost`. */
  chipsSlot: HTMLElement;
  popHost: HTMLElement;
  toast(msg: string): void;
  openTab(route: string): void;
  isSearchOpen(): boolean;
}

/** Settings' "Arrange the bars": turns arrange mode on (set once the bars are built). */
let arrange: (() => void) | null = null;
export const arrangeBars = () => arrange?.();
let relayout: (() => void) | null = null;
/** Put the three groups back where they start (player and stats on top, dice below). */
export function resetBars() {
  writeBars(DEFAULT_BARS);
  relayout?.();
}

/** Build the bars' three groups and place them on the top bar (`o.chipsSlot`) and the lower bar (`bar`). */
export function initBottomBar(bar: HTMLElement, o: Opts): void {
  setHTML(bar, html`<div class="strip-row strip-main" data-bar="lower"></div>`);
  const lower = bar.querySelector<HTMLElement>(".strip-main")!;
  const top = o.chipsSlot;
  top.dataset.bar = "top";
  const groupEl = (g: GroupId, inner: ReturnType<typeof html>) => {
    const el = document.createElement("div");
    el.className = "bar-group";
    el.dataset.group = g;
    setHTML(el, inner);
    return el;
  };
  const groups: Record<GroupId, HTMLElement> = {
    player: groupEl("player", html`<div class="strip-chips strip-player" role="group" aria-label="Character"></div>`),
    stats: groupEl("stats", html`<div class="strip-chips strip-stats" role="group" aria-label="Character stats"></div>`),
  };
  const playerChips = groups.player.querySelector<HTMLElement>(".strip-chips")!;
  const statChips = groups.stats.querySelector<HTMLElement>(".strip-chips")!;
  const narrowMq = window.matchMedia(NARROW_MQ);
  let layout: BarLayout = readBars();
  let arranging = false;

  // ---------- placing the groups ----------
  function place() {
    const bars: Record<BarId, GroupId[]> = narrowMq.matches ? { top: [], lower: [...GROUPS] } : { top: layout.top, lower: layout.lower };
    top.replaceChildren(...bars.top.map((g) => groups[g]));
    lower.replaceChildren(...bars.lower.map((g) => groups[g]));
    if (arranging) lower.append(arrangeBar);
    bar.classList.toggle("is-empty", !lower.children.length);
    for (const g of GROUPS) drawHandle(g);
  }
  narrowMq.addEventListener("change", () => {
    closeOthers();
    if (narrowMq.matches) stopArrange();
    place();
  });
  relayout = () => {
    layout = readBars();
    place();
  };
  const commitLayout = (l: BarLayout) => {
    layout = l;
    writeBars(l);
    place();
  };

  // ---------- arrange mode ----------
  const arrangeBar = document.createElement("div");
  arrangeBar.className = "bar-arrange-actions";
  setHTML(arrangeBar, html`<span class="muted">Drag a group by its grip, or use its arrows.</span>
    ${button("Reset", { icon: "rotate-ccw", variant: "ghost", size: "sm", attrs: html`data-bars="reset"` })}
    ${button("Done", { icon: "check", variant: "primary", size: "sm", attrs: html`data-bars="done"` })}`);
  arrangeBar.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-bars]")?.dataset.bars;
    if (act === "done") stopArrange();
    else if (act === "reset") commitLayout(DEFAULT_BARS);
  });
  function drawHandle(g: GroupId) {
    let h = groups[g].querySelector<HTMLElement>(":scope > .bar-handle");
    if (!arranging) return void h?.remove();
    if (!h) {
      h = document.createElement("div");
      h.className = "bar-handle";
      groups[g].prepend(h);
    }
    const name = GROUP_LABEL[g];
    const onTop = barOf(layout, g) === "top";
    const other = onTop ? "lower bar" : "top bar";
    setHTML(h, html`<button type="button" class="bar-grip" data-grip="${g}" title="Drag to move ${name}" aria-label="Move ${name}: drag, or use the arrows">${icon("grip-vertical", { size: 16 })}<span>${name}</span></button>
      <button type="button" class="bar-step" data-step="-1" data-g="${g}" aria-label="Move ${name} earlier" title="Earlier"${canStep(layout, g, -1) ? "" : " disabled"}>${icon("chevron-left", { size: 16 })}</button>
      <button type="button" class="bar-step" data-step="1" data-g="${g}" aria-label="Move ${name} later" title="Later"${canStep(layout, g, 1) ? "" : " disabled"}>${icon("chevron-right", { size: 16 })}</button>
      <button type="button" class="bar-step" data-swap="${g}" aria-label="Move ${name} to the ${other}" title="To the ${other}">${icon(onTop ? "arrow-down" : "arrow-up", { size: 16 })}</button>`);
  }
  function startArrange() {
    if (narrowMq.matches) return o.toast("Widen the window (900px or more) to arrange the bars.");
    if (arranging) return;
    closeOthers();
    arranging = true;
    top.classList.add("is-arranging");
    bar.classList.add("is-arranging");
    place();
    document.addEventListener("keydown", onArrangeKey, true);
    groups[layout.top[0] ?? layout.lower[0]].querySelector<HTMLElement>(".bar-grip")?.focus();
  }
  function stopArrange() {
    if (!arranging) return;
    arranging = false;
    top.classList.remove("is-arranging");
    bar.classList.remove("is-arranging");
    arrangeBar.remove();
    document.removeEventListener("keydown", onArrangeKey, true);
    place();
  }
  const onArrangeKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopArrange();
    }
  };
  arrange = startArrange;
  const onHandleClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const step = t.closest<HTMLElement>("[data-step]");
    const swap = t.closest<HTMLElement>("[data-swap]")?.dataset.swap as GroupId | undefined;
    const g = (step?.dataset.g ?? swap) as GroupId | undefined;
    if (!g) return;
    commitLayout(step ? stepGroup(layout, g, +step.dataset.step! as -1 | 1) : swapBar(layout, g));
    // keep the keyboard on the same button of the moved group
    groups[g].querySelector<HTMLElement>(step ? `[data-step="${step.dataset.step}"]:not(:disabled)` : "[data-swap]")?.focus();
  };
  // drag a group by its grip onto either bar; it lands before the first group whose middle is right of the pointer
  function drag(e: PointerEvent, g: GroupId) {
    e.preventDefault();
    const moving = groups[g];
    moving.classList.add("is-dragging");
    let target: { bar: BarId; index: number } | null = null;
    const barAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-bar]");
      return el === top || el === lower ? el : null;
    };
    const move = (ev: PointerEvent) => {
      const el = barAt(ev.clientX, ev.clientY);
      top.classList.toggle("is-drop", el === top);
      lower.classList.toggle("is-drop", el === lower);
      if (!el) return void (target = null);
      const id = el.dataset.bar as BarId;
      const index = layout[id].filter((x) => {
        if (x === g) return false;
        const r = groups[x].getBoundingClientRect();
        return r.left + r.width / 2 < ev.clientX;
      }).length;
      target = { bar: id, index };
    };
    const up = (ev: PointerEvent) => {
      if (ev.type === "pointerup") move(ev); // the drop is where the pointer is let go
      else target = null;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      moving.classList.remove("is-dragging");
      top.classList.remove("is-drop");
      lower.classList.remove("is-drop");
      if (target) commitLayout(placeGroup(layout, g, target.bar, target.index));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }
  for (const g of GROUPS) {
    groups[g].addEventListener("click", (e) => {
      if (arranging && (e.target as HTMLElement).closest(".bar-handle")) onHandleClick(e);
    });
    groups[g].addEventListener("pointerdown", (e) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>("[data-grip]");
      if (arranging && grip && e.button === 0) drag(e, g);
    });
  }


  // ---------- chips ----------
  function drawChips() {
    // 2D6 Void: its own survivor's chips (vcharbar.ts); each opens the Void sheet
    if (isVoid()) {
      const p = voidChipParts();
      setHTML(playerChips, p.player);
      setHTML(statChips, p.stats);
      if (pops.kind()) pops.redraw();
      if (flyout.isOpen()) flyout.redraw();
      return;
    }
    if (!sheet) {
      setHTML(playerChips, html`<span class="muted strip-loading">Loading the character…</span>`);
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
    setHTML(playerChips, html`<button type="button" class="chip strip-name" data-name-chip aria-haspopup="dialog" aria-expanded="${String(flyout.isOpen())}" title="Character">${portrait(c, "sm")}<span class="chip-label">${c.name || "Adventurer"} · Lv ${s.level}</span></button>`);
    setHTML(statChips, html`<button type="button" class="chip strip-hp" data-hp-chip data-pop="hp" ${exp("hp")} title="Change HP"><span class="chip-label">HP</span><span class="strip-hp-bar" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="chip-value">${c.hp}/${s.baseline}</span></button>${cond("bloodied", "Bloodied")}${cond("soaked", "Soaked")}${chip("XP", { value: String(c.xp), attrs: html`data-pop="xp" ${exp("xp")} title="Change XP"` })}${chip("Shift", { value: signed(s.shift), attrs: html`data-char aria-haspopup="dialog" title="Show the character"` })}${(fatigueEditable(combat)
        ? chip("Fatigue", { value: fatigueText(combat), attrs: html`data-pop="fatigue" ${exp("fatigue")} title="Change the Fatigue die"` })
        : chip("Fatigue", { value: "—", attrs: html`aria-disabled="true" data-off title="The Fatigue die is only used during a fight"` }))}${chip("Rations", { value: String(c.rations ?? 0), attrs: html`data-pop="rations" ${exp("rations")} title="Change rations"` })}`);
    if (open) pops.redraw();
    if (flyout.isOpen()) flyout.redraw();
  }

  // only one popover at a time: chips and flyout
  const closeOthers = () => {
    pops.close();
    flyout.close();
  };
  const pops = initCharPops(o.popHost, { sheet: () => sheet, toast: o.toast, closeOthers: () => closeOthers(), scope: () => statChips });
  const flyout = initCharFlyout(o.popHost, {
    sheet: () => sheet,
    openSheet: () => o.openTab(isVoid() ? "#/play/vsheet" : "#/play/sheet"),
    closeOthers: () => closeOthers(),
    busy: () => pops.kind() !== null,
    ...(isVoid() ? { voidCard } : {}),
    chipRoot: groups.player,
  });

  // name and Shift chips: a click, tap or Enter toggles the flyout (hover alone also shows it);
  // from the keyboard, focus moves into it
  const onChipClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (arranging) return;
    if (isVoid()) {
      // the name chip toggles the survivor flyout (as in Dungeon); the other chips open the sheet
      if (t.closest("[data-name-chip]")) return flyout.toggle(e.detail === 0);
      const p = t.closest<HTMLElement>("[data-pop]");
      if (p) return pops.toggle(p.dataset.pop as PopKind, p);
      if (t.closest("[data-vchip]")) o.openTab("#/play/vsheet");
      return;
    }
    if (t.closest("[data-name-chip], [data-char]")) return flyout.toggle(e.detail === 0);
    const p = t.closest<HTMLElement>("[data-pop]");
    if (p) return pops.toggle(p.dataset.pop as PopKind, p);
  };
  playerChips.addEventListener("click", onChipClick);
  statChips.addEventListener("click", onChipClick);

  place();

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

