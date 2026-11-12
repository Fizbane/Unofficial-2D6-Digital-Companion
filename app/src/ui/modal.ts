// A small modal dialog: a backdrop and a card, with focus kept inside, Esc to close, and focus handed back
// afterwards. Used by the 2D6 Void introduction, the backup set-up and the first-visit tour.
import { html, setHTML, type Raw } from "./html";

export interface ModalOptions {
  /** The card's inner markup (it should have an element with id `labelledBy`). */
  body: Raw;
  labelledBy: string;
  /** Extra class on the card (e.g. a wider one). */
  cls?: string;
  /** Called after the modal closed (for any reason). */
  onClose?: () => void;
  /** Esc and a click on the backdrop close it (default true). The tour closes through its own Skip. */
  dismissable?: boolean;
  /** "tour": no dimming, card at the bottom, the page stays visible and usable behind it. */
  variant?: "modal" | "tour";
}
export interface Modal { el: HTMLElement; card: HTMLElement; close(): void; update(body: Raw): void }

let stack: Modal[] = [];

export function openModal(o: ModalOptions): Modal {
  const backdrop = document.createElement("div");
  backdrop.className = o.variant === "tour" ? "modal-backdrop modal-tour" : "modal-backdrop";
  const card = document.createElement("div");
  card.className = `modal-card ${o.cls ?? ""}`.trim();
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", o.labelledBy);
  card.tabIndex = -1;
  setHTML(card, o.body);
  backdrop.append(card);
  const previous = document.activeElement as HTMLElement | null;
  const dismissable = o.dismissable !== false;
  let closed = false;

  const modal: Modal = {
    el: backdrop,
    card,
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      stack = stack.filter((m) => m !== modal);
      previous?.focus?.();
      o.onClose?.();
    },
    update(body) {
      setHTML(card, body);
      (card.querySelector<HTMLElement>("[data-autofocus], button, a[href]") ?? card).focus();
    },
  };
  const onKey = (e: KeyboardEvent) => {
    if (stack[stack.length - 1] !== modal) return; // only the top dialog reacts
    if (e.key === "Escape" && dismissable) {
      e.preventDefault();
      e.stopPropagation();
      modal.close();
    } else if (e.key === "Tab") {
      const f = [...card.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    }
  };
  backdrop.addEventListener("mousedown", (e) => {
    if (dismissable && e.target === backdrop) modal.close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  stack.push(modal);
  (card.querySelector<HTMLElement>("[data-autofocus]") ?? card).focus();
  return modal;
}

export { html };
