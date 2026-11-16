// The name chip's flyout: the compact character card (charcard.ts) under the chip.
// Mouse: opens on hover, stays while the pointer is over the chip or the flyout, closes 200ms
// after it leaves. A click, tap or Enter on the chip (or the Shift chip) pins it open; another
// one closes it. Closes on Esc (focus back to the chip) and outside click. Not shown under 900px.
import { load } from "../tools/common";
import { fatigueText } from "./charmodel";
import { NARROW_MQ } from "./layout";
import { charCard, wireCharCard } from "./panels/charcard";
import { html, setHTML, type Raw } from "../ui/html";
import { wireVoidCharCard } from "./vcharbar";
import { icon } from "../ui/icon";
import { isVoid } from "../games";

type SheetModule = typeof import("../tools/sheet");

const OPEN_DELAY = 120;
const CLOSE_DELAY = 200;

/** Under the card: the way to the other characters (pages/characters.ts). */
const switchLink = (): Raw =>
  html`<a class="btn btn-ghost btn-sm char-switch" href="#/play/characters">${icon("user", { size: 15 })}<span>${isVoid() ? "Switch survivor" : "Switch character"}</span></a>`;

export interface CharFlyout {
  isOpen(): boolean;
  open(focus: boolean): void;
  close(focusChip?: boolean): void;
  toggle(focus: boolean): void;
  redraw(): void;
}

export function initCharFlyout(
  bar: HTMLElement,
  /** `busy`: a chip popover is open, so hovering the name chip doesn't open (and close it). */
  o: {
    sheet(): SheetModule | null; openSheet(): void; closeOthers(): void; busy(): boolean;
    /** 2D6 Void: the survivor's card (null while there is none). Replaces the Dungeon sheet card. */
    voidCard?: () => Raw | null;
    /** Where the name chip is (the player group, on either bar); default `bar`. Hover is watched there. */
    chipRoot?: HTMLElement;
  },
): CharFlyout {
  const fly = document.createElement("div");
  fly.className = "char-flyout";
  fly.setAttribute("role", "dialog");
  fly.setAttribute("aria-label", "Character");
  fly.hidden = true;
  bar.append(fly);
  const narrow = window.matchMedia(NARROW_MQ);
  const root = o.chipRoot ?? bar;
  const chip = () => root.querySelector<HTMLElement>("[data-name-chip]");
  let timer = 0;
  let pinned = false; // opened (or kept) by a click: the pointer leaving doesn't close it
  const later = (fn: () => void, ms: number) => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };

  function draw() {
    if (fly.hidden) return;
    if (o.voidCard) {
      const card = o.voidCard();
      if (card) setHTML(fly, html`${card}${switchLink()}`);
      return;
    }
    const sheet = o.sheet();
    if (!sheet) return;
    const c = sheet.loadChar();
    const focused = fly.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.hp : undefined;
    setHTML(fly, html`${charCard(
      c,
      sheet.stats(c),
      fatigueText(load<{ phase?: string; fatigue?: number } | null>("combat", null)),
    )}${switchLink()}`);
    if (focused) fly.querySelector<HTMLElement>(`[data-hp="${focused}"]`)?.focus();
  }

  function onOutside(e: Event) {
    const t = e.target as HTMLElement;
    if (!fly.contains(t) && !t.closest("[data-name-chip], [data-char]")) close();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close(fly.contains(document.activeElement) || document.activeElement === chip());
  }

  function open(focus: boolean) {
    clearTimeout(timer);
    const c = chip();
    if (narrow.matches || !c || !(o.voidCard ? o.voidCard() : o.sheet())) return;
    if (fly.hidden) {
      o.closeOthers();
      fly.hidden = false;
      draw();
      const a = c.getBoundingClientRect();
      const f = bar.getBoundingClientRect();
      fly.style.left = `${Math.max(4, a.left - f.left)}px`;
      fly.style.top = `${a.bottom - f.top + 4}px`;
      c.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
    }
    if (focus) fly.querySelector<HTMLElement>("button")?.focus();
  }

  function close(focusChip = false) {
    clearTimeout(timer);
    if (fly.hidden) return;
    pinned = false;
    fly.hidden = true;
    fly.replaceChildren();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    const c = chip();
    c?.setAttribute("aria-expanded", "false");
    if (focusChip) c?.focus();
  }

  // hover (mouse and pen hover only; touch "enter" comes with a tap, handled as a toggle)
  const isHover = (e: PointerEvent) => e.pointerType === "mouse";
  const watch = (el: HTMLElement) => {
    el.addEventListener("pointerover", (e) => {
      if (!isHover(e)) return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-name-chip]")) {
        if (!fly.hidden) clearTimeout(timer);
        else if (!o.busy()) later(() => !o.busy() && open(false), OPEN_DELAY);
      }
      else if (fly.contains(t)) clearTimeout(timer);
    });
    el.addEventListener("pointerout", (e) => {
      if (!isHover(e)) return;
      const to = e.relatedTarget as HTMLElement | null;
      if (to && (fly.contains(to) || to.closest?.("[data-name-chip]"))) return;
      if (fly.hidden) return clearTimeout(timer); // left before the open delay
      // leaving the chip or the flyout: close unless the keyboard is inside it
      if (!pinned && !fly.contains(document.activeElement)) later(() => close(), CLOSE_DELAY);
    });
  };
  // the name chip's group, and the flyout itself (it hangs off `bar`, which may be another bar than the chip's)
  watch(root);
  if (!root.contains(fly)) watch(fly);

  const openSheet = () => {
    close();
    o.openSheet();
  };
  fly.addEventListener("click", (e) => {
    if ((e.target as Element).closest(".char-switch")) close();
  });
  if (o.voidCard) wireVoidCharCard(fly, openSheet);
  else wireCharCard(fly, { source: "strip", sheet: o.sheet, openSheet });
  narrow.addEventListener("change", () => narrow.matches && close());

  return {
    isOpen: () => !fly.hidden,
    open,
    close,
    toggle(focus) {
      if (fly.hidden || !pinned) {
        open(focus); // a click on a hover-opened flyout keeps it open
        pinned = !fly.hidden;
      } else close(focus);
    },
    redraw: draw,
  };
}
