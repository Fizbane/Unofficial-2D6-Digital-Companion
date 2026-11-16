// A one-line question in a dialog: the app's own stand-in for window.prompt(), which Electron does not
// implement (it returns null), so the desktop app would never get an answer. Cancel, Esc and a click
// outside all answer null, and the caller then leaves things as they were.
import { html } from "./html";
import { openModal } from "./modal";

let seq = 0;

/** Ask for a line of text. Resolves with what was typed (maybe ""), or null when the dialog was cancelled. */
export function askText(message: string, value = "", o: { ok?: string; numeric?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const id = `ask-${++seq}`;
    let answer: string | null = null;
    const m = openModal({
      labelledBy: id,
      cls: "modal-ask",
      body: html`<form class="ask-form" novalidate>
        <label class="ask-label" id="${id}" for="${id}-in">${message}</label>
        <input class="ask-input" id="${id}-in" type="text"${o.numeric ? html` inputmode="numeric"` : ""} value="${value}" autocomplete="off" data-autofocus>
        <div class="ask-actions">
          <button type="button" class="btn btn-ghost" data-ask="cancel"><span>Cancel</span></button>
          <button type="submit" class="btn btn-primary"><span>${o.ok ?? "OK"}</span></button>
        </div>
      </form>`,
      onClose: () => resolve(answer),
    });
    const input = m.card.querySelector<HTMLInputElement>("input")!;
    input.select();
    m.card.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      answer = input.value;
      m.close();
    });
    m.card.querySelector("[data-ask=cancel]")!.addEventListener("click", () => m.close());
  });
}

/** What a typed answer means as a whole number: null for cancel (null) or anything that isn't one. */
export const parseWhole = (answer: string | null): number | null => {
  if (answer === null) return null;
  const t = answer.trim().replace("−", "-"); // a typed minus sign as printed in the books
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : null;
};

/**
 * Ask for a whole number. Resolves with the number, with `fallback` when the box was left empty or holds
 * something else, or with null when the dialog was cancelled.
 */
export async function askNumber(message: string, fallback: number, o: { ok?: string } = {}): Promise<number | null> {
  const a = await askText(message, String(fallback), { ...o, numeric: true });
  return a === null ? null : parseWhole(a) ?? fallback;
}
