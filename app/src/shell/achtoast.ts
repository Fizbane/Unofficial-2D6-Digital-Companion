// The achievement toast: a queued card above the plain toast, one unlock at a time, so a burst of
// unlocks (or an ordinary toast) never hides one. Clicking it opens the Achievements page.
import { icon } from "../ui/icon";
import { html, setHTML } from "../ui/html";
import type { AchDef } from "./achievementsmodel";

const SHOW_MS = 3500;
const queue: AchDef[] = [];
let busy = false;
let openPage: () => void = () => {};

export function initAchToast(open: () => void): void {
  openPage = open;
  const el = document.getElementById("ach-toast");
  el?.addEventListener("click", () => {
    el.hidden = true;
    openPage();
  });
}

export function achToast(d: AchDef): void {
  queue.push(d);
  if (!busy) next();
}

function next() {
  const el = document.getElementById("ach-toast");
  const d = queue.shift();
  if (!el || !d) {
    busy = false;
    return;
  }
  busy = true;
  setHTML(el, html`<span class="ach-toast-icon">${icon(d.icon, { size: 22 })}</span>
    <span class="ach-toast-text"><span class="ach-toast-eyebrow">Achievement unlocked</span><strong>${d.title}</strong></span>`);
  el.title = d.blurb;
  el.classList.remove("is-leaving");
  el.hidden = true;
  void el.offsetWidth; // restart the slide-in
  el.hidden = false;
  window.setTimeout(() => {
    // slide back out (160ms = --dur), hide, then show the next one
    if (!el.hidden) el.classList.add("is-leaving");
    window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove("is-leaving");
    }, 160);
    window.setTimeout(next, 200);
  }, SHOW_MS);
}
