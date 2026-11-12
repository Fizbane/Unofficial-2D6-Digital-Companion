// The first-visit tour: a short walk through the site itself (not the game): where things are, how tabs, search,
// the side panel, themes and sound work, and how backups protect the player's saves. Skippable at every step,
// shown once, and available again from Settings.
import { readState, writeState } from "../shell/state";
import { button } from "./components";
import { html, type Raw } from "./html";
import { openModal, type Modal } from "./modal";
import { here, isDesktop } from "../shell/platform";

export interface TourStep {
  id: string;
  title: string;
  /** Plain sentences; no markup. */
  body: string[];
  /** CSS selector of the part of the page to outline (skipped quietly when it isn't on screen). */
  target?: string;
  /** A button on the backup step that opens the backup set-up. */
  action?: "backups";
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", title: "Welcome to 2D6 Companion", body: [
    "A quick tour of the site, about a minute. It covers where things are and how they work, not how to play.",
    "You can skip it now or at any step, and take it again later from Settings." ] },
  { id: "rail", title: "The rail", target: ".rail", body: [
    "The icons down the left are your workspace: Home, the library of book sections, the play tools, achievements, search and Settings.",
    "Hover an icon for its name." ] },
  { id: "tree", title: "Contents and search", target: ".tree", body: [
    "The contents list is the whole library by chapter. Click an entry to open it.",
    "Press / or use the Search button at the top to find any rule, table or table code. Bookmark a page from its menu to keep it handy." ] },
  { id: "tabs", title: "Tabs", target: ".tabbar", body: [
    "Every page opens in a tab, like a browser. Use + for a new one, or hold Ctrl and click (or middle-click) any link to open it in a new tab.",
    "Your open tabs are remembered, so you can pick up where you left off." ] },
  { id: "panel", title: "The side panel", target: ".panel", body: [
    "Results shows every dice roll you make, Notes is a scratchpad that follows you from page to page, and the Journal writes up your session.",
    "Open or close the panel with its button at the top right." ] },
  { id: "dice", title: "Your character and dice", target: ".charbar", body: [
    "The bar along the bottom keeps your character's numbers in view and has quick dice for any roll you need.",
    "Click the character's name to adjust the details without leaving the page." ] },
  { id: "settings", title: "Settings", target: ".topbar-settings", body: [
    "Settings is where you change how the site looks and sounds: colour themes, dice skins, map styles, sound effects and music, including choosing which songs play and adding your own.",
    "It also holds the Books card, where you open your own PDF to unlock book content." ] },
  { id: "games", title: "Two games", target: ".game-switch", body: [
    "This companion holds 2D6 Dungeon and 2D6 Void, each with its own saves and look. Use the logo switch at the top to move between them.",
    "2D6 Void is a paid game, so its tools unlock with your own copy of the core rulebook." ] },
  { id: "backups", title: "Backups", action: "backups", body: [
    `Everything you save lives in ${here()}. To keep it safe, ${isDesktop() ? "the app" : "the site"} can back it up automatically every 10 minutes while it is open, and keep the newest 10 copies.`,
    "Choose a folder inside OneDrive, Google Drive or iCloud Drive and your backups are copied to the cloud for you. To restore one, use Import a backup in Settings." ] },
  { id: "done", title: "That's the tour", body: [
    "You're ready. You can retake the tour any time from Settings." ] },
];

const KEY = "2d6:shell:tutorial"; // shared by both games (games.ts SHARED)
const isState = (v: unknown): v is { done: boolean } => typeof (v as { done?: unknown })?.done === "boolean";

/** The tour has been seen (finished or skipped). */
export const tourSeen = (): boolean => readState(KEY, isState, () => ({ done: false })).done;
export const markTourSeen = (): void => void writeState(KEY, { done: true });

/** The text and buttons of step `i`. */
export function stepBody(i: number): Raw {
  const n = TOUR_STEPS.length;
  const s = TOUR_STEPS[i];
  const last = i === n - 1;
  return html`<p class="tour-step">Tour · ${i + 1} of ${n}</p>
    <h2 id="tour-title">${s.title}</h2>
    ${s.body.map((p) => html`<p>${p}</p>`)}
    <div class="tour-dots" aria-hidden="true">${TOUR_STEPS.map((_, k) => html`<i class="${k === i ? "is-on" : ""}"></i>`)}</div>
    <div class="step-actions">
      ${i > 0 ? button("Back", { variant: "ghost", attrs: html`data-tour="back"` }) : ""}
      ${s.action === "backups" ? button("Set up backups", { icon: "download", variant: "primary", attrs: html`data-tour="backups"` }) : ""}
      ${button(last ? "Finish" : "Next", { variant: s.action ? "ghost" : "primary", attrs: html`data-tour="next" data-autofocus` })}
      ${last ? "" : button("Skip tour", { variant: "ghost", attrs: html`data-tour="skip"` })}
    </div>`;
}

let running: Modal | null = null;

/** Run the tour. `after` runs once when it ends (finished, skipped or Esc); `openBackups` runs instead when the backup button was used. */
export function startTour(o: { after?: () => void; openBackups?: () => void } = {}): void {
  if (running) return;
  let i = 0;
  let spot: Element | null = null;
  let wantBackups = false;
  const unspot = () => {
    spot?.classList.remove("tour-spot");
    spot = null;
  };
  const m: Modal = (running = openModal({
    body: stepBody(0),
    labelledBy: "tour-title",
    variant: "tour",
    onClose: () => {
      unspot();
      running = null;
      markTourSeen();
      if (wantBackups) o.openBackups?.();
      else o.after?.();
    },
  }));
  const show = () => {
    unspot();
    const t = TOUR_STEPS[i].target;
    const el = t ? document.querySelector(t) : null;
    if (el && (el as HTMLElement).getClientRects().length) {
      spot = el;
      el.classList.add("tour-spot");
    }
    m.update(stepBody(i));
  };
  m.card.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tour]");
    if (!b) return;
    const a = b.dataset.tour;
    if (a === "next") {
      if (i >= TOUR_STEPS.length - 1) m.close();
      else {
        i++;
        show();
      }
    } else if (a === "back" && i > 0) {
      i--;
      show();
    } else if (a === "skip") m.close();
    else if (a === "backups") {
      wantBackups = true;
      m.close();
    }
  });
  show();
}
