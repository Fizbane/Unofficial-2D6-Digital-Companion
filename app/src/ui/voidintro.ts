// The 2D6 Void introduction popup: Void is a paid game, and its tools need the owner's core rulebook.
// Shown the first time someone enters Void without a book (and again from the Books card's About button).
import { isVoid, gk } from "../games";
import { readState, writeState } from "../shell/state";
import { voidLocked } from "../shell/voidgate";
import { button } from "./components";
import { html, setHTML, type Raw } from "./html";
import { here } from "../shell/platform";

export const DR_GAMES_URL = "https://drgames.co.uk/";
export const DRIVETHRU_URL = "https://www.drivethrurpg.com/en/publisher/15325/dr-games";

const SEEN_KEY = "2d6:shell:voidIntro"; // per game by gk(): "2d6v:shell:voidIntro"
const isSeen = (v: unknown): v is { seen: boolean } => typeof (v as { seen?: unknown })?.seen === "boolean";

/** The popup's markup (also what the About button reopens). */
export function voidIntroHtml(): Raw {
  return html`<div class="modal-backdrop" data-void-intro>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="void-intro-title" tabindex="-1">
      <p class="eyebrow">Welcome aboard</p>
      <h2 id="void-intro-title">2D6 Void is a paid game</h2>
      <p>2D6 Void is published by DR Games. This companion doesn't contain the book: to use the Void tools you need to provide your own copy of the <strong>2D6 Void core rulebook</strong> (the PDF).</p>
      <p>You open it once in Settings. It is read on this device only, kept in ${here()}, and never uploaded. You can lock it away again at any time.</p>
      <p class="modal-links">Get the game from
        <a href="${DR_GAMES_URL}" target="_blank" rel="noopener noreferrer" data-link="drgames">DR Games</a> or
        <a href="${DRIVETHRU_URL}" target="_blank" rel="noopener noreferrer" data-link="drivethru">DR Games on DriveThruRPG</a>.</p>
      <div class="step-actions">${button("I have the book", { icon: "key-round", variant: "primary", attrs: html`data-void-intro-close` })}</div>
    </div>
  </div>`;
}

/** The note at the top of Settings → Books while Void has no book: what to do, and the About button. */
export function voidUnlockNotice(): Raw {
  return html`<div class="void-lock-note" data-void-lock>
    <p><strong>2D6 Void needs your core rulebook.</strong> Open the 2D6 Void core rulebook PDF below to unlock the Void tools. Everything in Void stays locked until then.</p>
    <p class="muted">Get the game from <a href="${DR_GAMES_URL}" target="_blank" rel="noopener noreferrer">DR Games</a> or <a href="${DRIVETHRU_URL}" target="_blank" rel="noopener noreferrer">DriveThruRPG</a>.</p>
    <div class="step-actions">${button("About 2D6 Void", { icon: "book-open", variant: "ghost", attrs: html`data-void-about` })}</div>
  </div>`;
}

/** Whether to pop it up on entering the app: Void, no book loaded, and not dismissed before. */
export const shouldShowVoidIntro = (): boolean =>
  isVoid() && voidLocked() && !readState(gk(SEEN_KEY), isSeen, () => ({ seen: false })).seen;

let open: HTMLElement | null = null;

/** Show the popup (once at a time); closing it remembers that it was seen. */
export function showVoidIntro(): void {
  if (open || typeof document === "undefined") return;
  const host = document.createElement("div");
  setHTML(host, voidIntroHtml());
  const backdrop = host.firstElementChild as HTMLElement;
  const card = backdrop.querySelector<HTMLElement>(".modal-card")!;
  const previous = document.activeElement as HTMLElement | null;
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    open = null;
    writeState(gk(SEEN_KEY), { seen: true });
    // hand focus to the unlock card (or back to where it was)
    const target = document.querySelector<HTMLElement>("#books [data-act=\"unlock-file\"], #books") ?? previous;
    target?.focus?.();
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
    if (t === backdrop || t.closest("[data-void-intro-close]")) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  open = backdrop;
  card.focus();
}

/** Called once the shell is up: pop the introduction up the first time a locked Void is opened. */
export function maybeShowVoidIntro(): void {
  if (shouldShowVoidIntro()) showVoidIntro();
}
