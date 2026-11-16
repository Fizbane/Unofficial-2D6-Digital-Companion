// A details card that appears when the pointer rests on (or the keyboard reaches) anything carrying
// `data-tip`, with an optional `data-tip-title`. One card is shared by the whole app. The text is set as
// plain text, never as markup. It never takes the pointer, and it goes as soon as the player presses a
// key or a button, so it can sit over rows of inputs without getting in the way of typing.
const DELAY = 280; // ms the pointer rests before the card shows
const GAP = 8;

let card: HTMLElement | null = null;
let shownFor: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function ensureCard(): HTMLElement {
  if (card?.isConnected) return card;
  card = document.createElement("div");
  card.className = "hover-tip";
  card.setAttribute("role", "tooltip");
  card.hidden = true;
  document.body.append(card);
  return card;
}

/** Where to put a card of `w`×`h` for a target at `r` in a `vw`×`vh` window: under it, or above when there is no room. */
export function tipPosition(r: { left: number; top: number; bottom: number }, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = Math.max(GAP, Math.min(r.left, vw - w - GAP));
  const below = r.bottom + GAP;
  const top = below + h <= vh - GAP ? below : Math.max(GAP, r.top - GAP - h);
  return { left, top };
}

function show(el: HTMLElement) {
  const body = el.dataset.tip?.trim();
  if (!body || !el.isConnected) return;
  const c = ensureCard();
  c.replaceChildren();
  const title = el.dataset.tipTitle?.trim();
  if (title) {
    const h = document.createElement("strong");
    h.className = "hover-tip-title";
    h.textContent = title;
    c.append(h);
  }
  const p = document.createElement("span");
  p.className = "hover-tip-body";
  p.textContent = body;
  c.append(p);
  c.hidden = false;
  const pos = tipPosition(el.getBoundingClientRect(), c.offsetWidth, c.offsetHeight, window.innerWidth, window.innerHeight);
  c.style.left = `${pos.left}px`;
  c.style.top = `${pos.top}px`;
  shownFor = el;
}

function hide() {
  clearTimeout(timer);
  timer = undefined;
  shownFor = null;
  if (card) card.hidden = true;
}

const tipTarget = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null);

/** Show details cards for the `[data-tip]` elements inside `root`. `onDispose` is given the clean-up. */
export function wireHoverTips(root: HTMLElement, onDispose: (fn: () => void) => void): void {
  const over = (e: PointerEvent) => {
    if (e.pointerType === "touch") return; // a touch has no hover; the text is on the sheet or in the book
    const el = tipTarget(e.target);
    if (el === shownFor) return;
    hide();
    if (el) timer = setTimeout(() => show(el), DELAY);
  };
  const out = (e: PointerEvent) => {
    const to = tipTarget(e.relatedTarget);
    if (to && to === tipTarget(e.target)) return; // moving about inside the same element
    hide();
  };
  // the keyboard: only things that are not typed into (a tile, a chip), so a card never covers a field in use
  const focus = (e: FocusEvent) => {
    const el = e.target instanceof HTMLElement && e.target.matches("[data-tip]:not(input, textarea, select)") ? e.target : null;
    if (el?.matches(":focus-visible")) show(el);
  };
  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);
  root.addEventListener("focusin", focus);
  root.addEventListener("focusout", hide);
  root.addEventListener("pointerdown", hide);
  root.addEventListener("keydown", hide);
  window.addEventListener("scroll", hide, true);
  onDispose(() => {
    hide();
    window.removeEventListener("scroll", hide, true);
  });
}
