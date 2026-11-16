// The locked placeholder: what every view shows in place of a section the owner hasn't unlocked yet.
// It names only the book and the page, never the section's title or text.
import { storeAvailable, type Locked } from "../content";
import { html, type Raw } from "./html";
import { button } from "./components";
import { noteUnlock } from "./books";

/** "🔒 Tables Codex · p. 52": plain text (titles, breadcrumbs, tab names); html`` escapes it in markup. */
export const lockedLabel = (l: Locked): string => `🔒 ${l.bookName} · p. ${l.page}`;

/**
 * The card: "🔒 Open your <em>Tables Codex</em> PDF to unlock" and an Unlock… button (data-act="unlock").
 * `quiet`: inside a step-by-step page, where the step's own action is the primary button.
 */
export function lockedCard(l: Locked, quiet = false): Raw {
  return html`<div class="card locked-card" data-locked="${l.book}"><div class="card-body"><p class="locked-copy">🔒 Open your <em>${l.bookName}</em> PDF to unlock</p><p class="muted locked-where">${lockedLabel(l)}</p><div class="step-actions">${button("Unlock…", { icon: "key-round", variant: quiet ? undefined : "primary", attrs: html`data-act="unlock" data-book="${l.book}"` })}</div>${storeAvailable() ? "" : html`<p class="muted locked-note">Saved books can't be read in this browser mode</p>`}</div></div>`;
}

/** Locked cards for a list of placeholders, one per book page. */
export function lockedCards(list: readonly Locked[], quiet = false): Raw {
  const seen = new Set<string>();
  return html`${list
    .filter((l) => {
      const k = `${l.book}:${l.page}`;
      return !seen.has(k) && !!seen.add(k);
    })
    .map((l) => lockedCard(l, quiet))}`;
}

/**
 * Wire every Unlock… button in the document: open Settings → Books, scrolled into view, with the card's
 * book (`data-book`) noted there.
 */
export function initUnlockActions(open: (route: string) => void): void {
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-act="unlock"]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation(); // the page's own button handlers have nothing to do with it
    open("#/play/settings");
    noteUnlock(b.dataset.book);
  }, true);
}
