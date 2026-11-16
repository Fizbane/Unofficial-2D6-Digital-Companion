// One "find and add" picker for every list on the character sheets: a modal with a search box, group chips
// and the matching choices, each with what it does. It stays open so several things can be added in a row.
// The sheet decides what a pick does (`onPick`): it returns null when it added the thing, or a sentence
// saying why it could not ("Every armour row is full"), which the picker shows without closing.
import { button } from "./components";
import { html, setHTML, type Raw } from "./html";
import { icon } from "./icon";
import { openModal, type Modal } from "./modal";
import { filterChoices, groupsOf, hasChoiceNamed, type PickChoice } from "./pickmodel";

export type { PickChoice } from "./pickmodel";

export interface PickerOptions {
  /** "Add armour": the modal's heading. */
  title: string;
  /** What is being picked, lower case, for the search placeholder ("armour", "a potion"). */
  noun: string;
  choices: readonly PickChoice[];
  /** Add the choice to the sheet. null = added; a string = why not (shown, picker stays open). */
  onPick(c: PickChoice): string | null;
  /** Add what was typed as written (a house-rule item). Omit where only the book's entries make sense. */
  custom?(text: string): string | null;
  /** Shown when there are no choices (a locked book). */
  emptyNote?: string;
  /** Called when the picker closes. */
  onClose?: () => void;
}

let seq = 0;

export function openPicker(o: PickerOptions): Modal {
  const id = `picker-title-${++seq}`;
  const groups = groupsOf(o.choices);
  let text = "";
  let group = "";
  let active = 0;
  let shown: PickChoice[] = [];
  let added = 0;

  const row = (c: PickChoice, i: number): Raw => html`<li role="presentation"><button type="button" class="picker-row" role="option" data-pick="${c.id}" aria-selected="${String(i === active)}">
      <span class="picker-main"><span class="picker-name">${c.name}</span>${c.meta ? html`<span class="picker-meta">${c.meta}</span>` : ""}</span>
      ${c.detail ? html`<span class="picker-detail">${c.detail}</span>` : ""}
      <span class="picker-add" aria-hidden="true">${icon("plus", { size: 16 })}</span>
    </button></li>`;

  const modal = openModal({
    labelledBy: id,
    cls: "modal-picker",
    onClose: o.onClose,
    body: html`<div class="picker">
      <header class="picker-head"><h3 id="${id}">${o.title}</h3><span class="picker-count" aria-live="polite"></span></header>
      ${o.choices.length ? html`
        <input type="search" class="beast-search picker-search" data-autofocus autocomplete="off" placeholder="Search ${o.noun}…" aria-label="Search ${o.noun}">
        ${groups.length > 1 ? html`<div class="beast-chips" role="group" aria-label="Kind">${groups.map((g) => html`<button type="button" class="chip beast-chip" data-group="${g}" aria-pressed="false">${g}</button>`)}</div>` : ""}
        <ul class="picker-list" role="listbox" aria-label="${o.title}"></ul>`
        : html`<p class="muted picker-empty" data-autofocus tabindex="-1">${o.emptyNote ?? "Nothing to choose from yet. Unlock the book in Settings → Books."}</p>`}
      <p class="picker-msg" role="status" aria-live="polite"></p>
      <footer class="picker-foot">${button("Done", { variant: "primary", size: "sm", attrs: html`data-picker-done` })}</footer>
    </div>`,
  });

  const card = modal.card;
  const list = card.querySelector<HTMLElement>(".picker-list");
  const msg = card.querySelector<HTMLElement>(".picker-msg")!;
  const say = (s: string, bad = false) => { msg.textContent = s; msg.classList.toggle("is-bad", bad); };

  const draw = () => {
    if (!list) return;
    shown = filterChoices(o.choices, text, group);
    active = Math.min(active, Math.max(0, shown.length - 1));
    const asIs = o.custom && text.trim() && !hasChoiceNamed(o.choices, text);
    setHTML(list, html`${shown.map(row)}${asIs ? html`<li role="presentation"><button type="button" class="picker-row picker-custom" data-custom>
        <span class="picker-main"><span class="picker-name">Add “${text.trim()}” as written</span><span class="picker-meta">not from the book</span></span><span class="picker-add" aria-hidden="true">${icon("plus", { size: 16 })}</span></button></li>` : ""}
      ${!shown.length && !asIs ? html`<li class="muted picker-none">No match. Clear the search${groups.length > 1 ? " or the kind" : ""}.</li>` : ""}`);
    card.querySelector<HTMLElement>(".picker-count")!.textContent = shown.length === o.choices.length ? `${o.choices.length}` : `${shown.length} of ${o.choices.length}`;
    card.querySelectorAll<HTMLElement>("[data-group]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === group)));
  };

  const move = (to: number) => {
    if (!shown.length) return;
    active = (to + shown.length) % shown.length;
    list?.querySelectorAll<HTMLElement>(".picker-row[data-pick]").forEach((b, i) => b.setAttribute("aria-selected", String(i === active)));
    list?.querySelectorAll<HTMLElement>(".picker-row[data-pick]")[active]?.scrollIntoView({ block: "nearest" });
  };

  const settle = (name: string, why: string | null) => {
    if (why) return say(why, true);
    added++;
    say(`Added ${name}${added > 1 ? ` (${added} so far)` : ""}.`);
    card.querySelector<HTMLInputElement>(".picker-search")?.select();
  };
  const pick = (c: PickChoice | undefined) => { if (c) settle(c.name, o.onPick(c)); };

  card.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest("[data-picker-done]")) return modal.close();
    const g = t.closest<HTMLElement>("[data-group]");
    if (g) { group = group === g.dataset.group ? "" : g.dataset.group!; active = 0; return draw(); }
    if (t.closest("[data-custom]")) { const n = text.trim(); return settle(n, o.custom!(n)); }
    const p = t.closest<HTMLElement>("[data-pick]");
    if (p) pick(o.choices.find((c) => c.id === p.dataset.pick));
  });
  card.addEventListener("input", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.classList.contains("picker-search")) { text = t.value; active = 0; say(""); draw(); }
  });
  card.addEventListener("keydown", (ev) => {
    if (!(ev.target as HTMLElement).classList.contains("picker-search")) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); move(active + 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); move(active - 1); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (shown.length) pick(shown[active]); else if (o.custom && text.trim()) settle(text.trim(), o.custom(text.trim())); }
  });

  draw();
  return modal;
}
