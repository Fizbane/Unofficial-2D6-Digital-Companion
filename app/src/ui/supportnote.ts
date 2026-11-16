// The support note: a word from the author and a request to buy the printed books. Shown at the top of
// Settings → Books, and as a popup when the app opens (the first time, then at most once every 5 hours).
import { button } from "./components";
import { html, setHTML, type Raw } from "./html";

export const SHOP_URL = "https://drgames.co.uk/dr-games-online-shop/";

/** The note's body (shared by the Books panel and the popup). */
export function supportNoteBody(): Raw {
  return html`<div class="support-note" data-support-note>
    <p class="eyebrow">A note from the author</p>
    <p>This is a passion project that I hope drives interest in the game. If it harms the game or sales in any way, I will revoke it instantly, no questions asked. Toby retains all rights to everything, and if he asks me to change or remove something, it will be done, no questions asked.</p>
    <h3>Support the books</h3>
    <p>The 2D6 Companion is free, and the books behind it are how the game gets made. The tables, the flowcharts and the art took years of work, and the physical books are what keep that work going.</p>
    <p>If you enjoy using the app, please buy the printed books. A physical copy:</p>
    <ul>
      <li>is the version the designer earns the most from, so it's the best way to say thanks;</li>
      <li>is easier to use at the table, with no screens to juggle and no battery to run out;</li>
      <li>lives on the shelf as a book you keep and can use to bring your friends into the game.</li>
    </ul>
    <p class="muted">The PDFs are a useful backup and a way to unlock the app's Books features, but they're not a substitute for the printed books. You can get them from the <a href="${SHOP_URL}" target="_blank" rel="noopener noreferrer" data-link="drgames-shop">DR Games online shop</a>.</p>
  </div>`;
}

/** The popup's markup. */
export function supportPopupHtml(): Raw {
  return html`<div class="modal-backdrop" data-support-popup>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="support-popup-title" tabindex="-1">
      <h2 id="support-popup-title">Enjoying the 2D6 Companion?</h2>
      ${supportNoteBody()}
      <div class="step-actions">${button("Continue", { icon: "check", variant: "primary", attrs: html`data-support-close` })}</div>
    </div>
  </div>`;
}

let open: HTMLElement | null = null;

/** Show the popup (once at a time); closing it only dismisses it. */
export function showSupportPopup(): void {
  if (open || typeof document === "undefined") return;
  const host = document.createElement("div");
  setHTML(host, supportPopupHtml());
  const backdrop = host.firstElementChild as HTMLElement;
  const card = backdrop.querySelector<HTMLElement>(".modal-card")!;
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    open = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      // keep focus inside the dialog
      const f = [...card.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === card)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    }
  };
  backdrop.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === backdrop || t.closest("[data-support-close]")) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  open = backdrop;
  card.focus();
}

/** When the popup last showed (ms since 1970), shared by both games. */
const SHOWN_KEY = "2d6:shell:support-shown";
/** How long after it shows before it may show again. */
export const SUPPORT_GAP_MS = 5 * 60 * 60 * 1000;

/** May the popup show now? Yes the first time, then only once the gap has passed (a clock set back counts as passed). */
export const supportDue = (last: number | null, now: number): boolean =>
  last === null || !Number.isFinite(last) || now - last >= SUPPORT_GAP_MS || now < last;

const lastShown = (): number | null => {
  try {
    const v = localStorage.getItem(SHOWN_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};

/** Called once the shell is up: pop the support note up on app open, at most once every 5 hours. Waits out any other dialog rather than stacking on it. */
export function maybeShowSupportPopup(): void {
  if (typeof document === "undefined" || document.querySelector(".modal-backdrop")) return;
  const now = Date.now();
  if (!supportDue(lastShown(), now)) return;
  try {
    localStorage.setItem(SHOWN_KEY, String(now));
  } catch {
    // no storage (private window): it shows on each open, as before
  }
  showSupportPopup();
}
