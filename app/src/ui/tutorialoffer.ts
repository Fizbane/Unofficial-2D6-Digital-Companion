// The one-time offer of the gameplay tutorial: shown after the first-visit chain in a game that has a
// tutorial, once its rules are unlocked, while there's no character yet and no tutorial running.
import { gk, isVoid } from "../games";
import { readState, writeState } from "../shell/state";
import { voidUnlocked } from "../shell/voidgate";
import { hasSaved } from "../tools/common";
import { hasVChar } from "../tools/void/sheetmodel";
import { beginTutorial, tutorialFor, tutorialRunning } from "../tutorial/run";
import { button } from "./components";
import { html } from "./html";
import { openModal } from "./modal";

const KEY = () => gk("2d6:shell:coachOffer");
const isSeen = (v: unknown): v is { seen: boolean } => typeof (v as { seen?: unknown })?.seen === "boolean";

/** Should the offer be shown now? */
export function shouldOfferTutorial(): boolean {
  if (!tutorialFor() || tutorialRunning()) return false;
  if (readState(KEY(), isSeen, () => ({ seen: false })).seen) return false;
  // Void: its rules must be unlocked and no survivor made yet. Dungeon (free rules): no adventurer's sheet saved yet
  return isVoid() ? voidUnlocked() && !hasVChar() : !hasSaved("character");
}

export function maybeOfferTutorial(): void {
  if (!shouldOfferTutorial()) return;
  writeState(KEY(), { seen: true });
  const m = openModal({
    labelledBy: "coach-offer-title",
    body: html`<h2 id="coach-offer-title">Want a guided first game?</h2>
      <p>${isVoid()
        ? "The tutorial walks you through making a survivor, entering the Dark Hulk and playing the first three rooms, with links to each rule as you meet it."
        : "The tutorial walks you through your adventurer's sheet, entering the dungeon and playing the first three rooms, including a fight, with links to each rule as you meet it."}</p>
      <p class="muted">It uses a separate tutorial ${isVoid() ? "survivor" : "adventurer"}, and you can start it again any time from Settings.</p>
      <div class="step-actions">${button("Start the tutorial", { icon: "compass", variant: "primary", attrs: html`data-offer="go" data-autofocus` })}${button("Not now", { variant: "ghost", attrs: html`data-offer="no"` })}</div>`,
  });
  m.card.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-offer]")?.dataset.offer;
    if (!a) return;
    m.close();
    if (a === "go") void beginTutorial();
  });
}
