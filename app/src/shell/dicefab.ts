// The floating dice button: a D6 the player can drag anywhere on the screen. Pressing it opens a dice
// dashboard (D6, 2D6, D66, D3 and Re-roll last); each roll is thrown on screen and logged in Results like any
// other. It stays where it was left (saved in this browser), and the arrow keys move it when it has focus.
import { getSettings, rollDice, swatch } from "../dice3d";
import { bus } from "./events";
import { hasLast, logDice, rerollLast } from "./panels/results";
import { readState, writeState } from "./state";
import { button } from "../ui/components";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";
import { settingsSection } from "../ui/settingsnav";
import { clampFab, cubeColors, defaultFab, isDrag, isFabPos, nudgeFab, panelAt, PIPS, SHOWN_FACES, type FabPos } from "./dicefabmodel";

export const FAB_KEY = "2d6:shell:dicefab";
const DICE = ["D6", "2D6", "D66", "D3"];

/** One face of the cube: a 3x3 grid with the pips of `n` in place. */
const face = (cls: string, n: number): Raw =>
  html`<i class="cube-face ${cls}">${PIPS[n].map((cell) => html`<b style="grid-row:${Math.ceil(cell / 3)};grid-column:${((cell - 1) % 3) + 1}"></b>`)}</i>`;

/** Build the button and its dashboard on the page. Call once, when the shell is up. */
export function initDiceFab(o: { openTab(route: string): void }): void {
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "dice-fab";
  fab.setAttribute("aria-haspopup", "dialog");
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("aria-label", "Dice: press to roll, drag to move");
  fab.title = "Dice (drag to move)";
  setHTML(fab, html`<span class="dice-cube" aria-hidden="true">${face("cube-top", SHOWN_FACES.top)}${face("cube-front", SHOWN_FACES.front)}${face("cube-right", SHOWN_FACES.right)}${face("cube-back", 7 - SHOWN_FACES.front)}${face("cube-left", 7 - SHOWN_FACES.right)}${face("cube-bottom", 7 - SHOWN_FACES.top)}</span>`);

  const panel = document.createElement("div");
  panel.className = "dice-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Roll dice");
  panel.hidden = true;
  setHTML(panel, html`
    <div class="dice-panel-head"><h2>Roll dice</h2><div class="dice-panel-tools">${button("", { icon: "settings", variant: "ghost", size: "sm", attrs: html`data-dice-settings aria-label="Dice settings" title="Dice settings"` })}${button("", { icon: "x", variant: "ghost", size: "sm", attrs: html`data-dice-close aria-label="Close the dice"` })}</div></div>
    <div class="dice-grid">${DICE.map((d) => html`<button type="button" class="dice-tile" data-die="${d}" aria-label="Roll ${d}">${icon("dice", { size: 30 })}<span>${d}</span></button>`)}</div>
    <p class="dice-result" role="status" aria-live="polite"></p>
    <div class="dice-foot">${button("Re-roll last", { icon: "rotate-ccw", variant: "ghost", size: "sm", attrs: html`data-reroll title="Repeat the last roll" disabled` })}</div>`);
  document.body.append(fab, panel);

  const result = panel.querySelector<HTMLElement>(".dice-result")!;
  const reroll = panel.querySelector<HTMLButtonElement>("[data-reroll]")!;
  const vw = () => document.documentElement.clientWidth;
  const vh = () => document.documentElement.clientHeight;

  // ---------- the cube wears the player's first die colour ----------
  const paintCube = () => {
    const c = cubeColors(swatch(getSettings().dice[0]));
    fab.style.setProperty("--die", c.body);
    fab.style.setProperty("--pip", c.pip);
  };
  paintCube();
  window.addEventListener("2d6:dice-settings", paintCube); // the Dice settings changed (dice3d.ts saveSettings)

  // ---------- position ----------
  let pos: FabPos = clampFab(readState<FabPos>(FAB_KEY, isFabPos, () => defaultFab(vw(), vh())), vw(), vh());
  const save = () => writeState(FAB_KEY, pos);
  const isOpen = () => !panel.hidden;

  function placePanel() {
    if (!isOpen()) return;
    const at = panelAt(pos, { w: panel.offsetWidth, h: panel.offsetHeight }, vw(), vh());
    panel.style.left = `${at.left}px`;
    panel.style.top = `${at.top}px`;
    panel.dataset.above = String(at.above);
  }
  function place() {
    fab.style.left = `${pos.x}px`;
    fab.style.top = `${pos.y}px`;
    placePanel();
  }

  // ---------- open and close ----------
  function open() {
    if (isOpen()) return;
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    refit();
    document.addEventListener("pointerdown", onOutside, true);
    panel.querySelector<HTMLElement>("[data-die]")?.focus();
  }
  function close(focusFab = false) {
    if (!isOpen()) return;
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (focusFab) fab.focus();
  }
  function onOutside(e: Event) {
    const t = e.target as Node;
    if (!panel.contains(t) && !fab.contains(t)) close();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen() && !document.querySelector(".modal-backdrop")) {
      e.preventDefault();
      close(true);
    }
  });

  // ---------- dragging: a press that travels is a drag; one that does not is a click ----------
  let drag: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
  let justDragged = false;
  fab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    fab.setPointerCapture(e.pointerId);
  });
  fab.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && !isDrag(dx, dy)) return;
    if (!drag.moved) fab.classList.add("is-dragging");
    drag.moved = true;
    pos = clampFab({ x: drag.ox + dx, y: drag.oy + dy }, vw(), vh());
    place();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      justDragged = true; // the click that follows the release is not a press on the button
      setTimeout(() => (justDragged = false));
      save();
    }
    fab.classList.remove("is-dragging");
    drag = null;
  };
  fab.addEventListener("pointerup", endDrag);
  fab.addEventListener("pointercancel", endDrag);
  fab.addEventListener("click", () => {
    if (justDragged) return;
    if (isOpen()) close();
    else open();
  });
  // from the keyboard: arrows move it (Shift for bigger steps)
  fab.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 48 : 12;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    pos = nudgeFab(pos, m[0], m[1], vw(), vh());
    place();
    save();
  });
  // the window (or a phone's orientation) changed size: keep the button on screen
  const refit = () => {
    const p = clampFab(pos, vw(), vh());
    if (p.x !== pos.x || p.y !== pos.y) pos = p;
    place();
  };
  window.addEventListener("resize", refit);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(refit).observe(document.documentElement);

  // ---------- rolling ----------
  const syncReroll = () => (reroll.disabled = !hasLast());
  const show = (text: string) => (result.textContent = text);
  let busy = false;
  panel.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-dice-close]")) return close(true);
    if (t.closest("[data-dice-settings]")) {
      close();
      settingsSection("dice");
      return o.openTab("#/play/settings");
    }
    const die = t.closest<HTMLElement>("[data-die]")?.dataset.die;
    if ((!die && !t.closest("[data-reroll]")) || busy) return;
    busy = true;
    panel.classList.add("is-rolling");
    fab.classList.add("is-rolling");
    try {
      if (die) {
        const r = await rollDice(die);
        logDice(r);
        show(`${r.label}: ${r.text}`);
      } else if (!reroll.disabled) {
        await rerollLast();
        show("Rolled again. See Results for the outcome.");
      }
    } finally {
      busy = false;
      panel.classList.remove("is-rolling");
      fab.classList.remove("is-rolling");
      syncReroll();
    }
  });
  bus.on("roll", syncReroll);
  syncReroll();
  place();
}
