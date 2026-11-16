// The character card on hover over a portrait in a game's character strip (the card under the map):
// the same card the name chip's flyout shows, opened just under the portrait. Mouse only: hovering the
// portrait opens it after a short pause, leaving the portrait (and the card) closes it. Esc, a scroll or a
// click outside closes it. Touch and narrow screens keep their own way in (the name chip).
import { setHTML, type Raw } from "../ui/html";

const OPEN_DELAY = 150;
const CLOSE_DELAY = 220;

export interface PortraitCardOpts {
  /** The card's markup now (null: nothing to show). */
  content(): Raw | null;
  /** Wire the card's own buttons (HP, the way to the full sheet) after each draw. */
  wire(card: HTMLElement): void;
  onDispose(fn: () => void): void;
}

let card: HTMLElement | null = null;
let timer = 0;
let anchor: HTMLElement | null = null;

const ensure = (): HTMLElement => {
  if (card) return card;
  card = document.createElement("div");
  card.className = "portrait-card char-flyout";
  card.setAttribute("role", "tooltip");
  card.hidden = true;
  document.body.append(card);
  // leaving the card closes it; entering it again keeps it open (the pointer may cross the gap)
  card.addEventListener("pointerover", (e) => {
    if (e.pointerType === "mouse") clearTimeout(timer);
  });
  card.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse") return;
    const to = e.relatedTarget as Element | null;
    if (to && (anchor?.contains(to) || card?.contains(to))) return;
    later(hide, CLOSE_DELAY);
  });
  return card;
};

const later = (fn: () => void, ms: number) => {
  clearTimeout(timer);
  timer = window.setTimeout(fn, ms);
};

function hide() {
  clearTimeout(timer);
  if (!card || card.hidden) return;
  card.hidden = true;
  card.replaceChildren();
  anchor = null;
}

function show(el: HTMLElement, o: PortraitCardOpts) {
  const body = o.content();
  if (!body) return;
  const c = ensure();
  anchor = el;
  setHTML(c, body);
  o.wire(c);
  c.hidden = false;
  // under the portrait, kept on screen
  const a = el.getBoundingClientRect();
  const w = c.offsetWidth || 320;
  c.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - w - 8))}px`;
  const h = c.offsetHeight || 0;
  const below = a.bottom + 6;
  c.style.top = `${below + h > window.innerHeight - 8 && a.top - h - 6 >= 8 ? a.top - h - 6 : below}px`;
}

/** Watch the page for hovers on the strip's portrait. Listeners are removed through `onDispose`. */
export function watchPortraits(o: PortraitCardOpts): void {
  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as Element).closest<HTMLElement>(".play-status .portrait");
    if (el) {
      clearTimeout(timer);
      if (anchor !== el) later(() => show(el, o), OPEN_DELAY);
    }
  };
  const onOut = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = (e.target as Element).closest(".play-status .portrait");
    if (!el) return;
    const to = e.relatedTarget as Element | null;
    if (to && (el.contains(to) || card?.contains(to))) return;
    if (!card || card.hidden) return clearTimeout(timer);
    later(hide, CLOSE_DELAY);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && card && !card.hidden) hide();
  };
  document.addEventListener("pointerover", onOver);
  document.addEventListener("pointerout", onOut);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", hide, true);
  o.onDispose(() => {
    document.removeEventListener("pointerover", onOver);
    document.removeEventListener("pointerout", onOut);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", hide, true);
    hide();
  });
}
