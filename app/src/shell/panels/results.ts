// The Results tab: every table and dice roll becomes a result card (newest first), follow-on
// rolls nest inside their root card, the last 100 are kept in "2d6:shell:results".
// Replaces the old roll-log drawer; tools call rollAndLog exactly as they called it there.
import { gk } from "../../games";
import type { RollResult } from "../../dice";
import { rollDice } from "../../dice3d";
import { inline } from "../../library";
import { rollOnTable, rollableByCode, tableBySection, type TableRef, type TableRoll } from "../../rolltable";
import { button, resultCard } from "../../ui/components";
import { bus } from "../events";
import { rootId } from "../panelmodel";
import { ResultStore, cardFromDice, cardFromTableRoll, isResultsState, type CardInput, type ResultCard, type ResultsState } from "../resultstore";
import { noteFromCard } from "../notesmodel";
import { badge } from "../rightpanel";
import { appendNote } from "./notes";
import { readState, writeState } from "../state";
import { html, setHTML, type Raw } from "../../ui/html";

export const RESULTS_KEY = gk("2d6:shell:results");
const EMPTY = "No rolls yet. Roll on any table and the result lands here.";

const store = new ResultStore(readState<ResultsState>(RESULTS_KEY, isResultsState, () => ({ v: 1, cards: [] })));
/** The exact table behind store.last (section-only tables have no code to look up again). */
let lastRef: TableRef | null = null;

interface View {
  pane: HTMLElement;
  list: HTMLElement;
  count: HTMLElement;
  openTab(route: string): void;
  toast(msg: string): void;
}
let view: View | null = null;

const fmt = (s: string) => inline(s);
const save = () => writeState(RESULTS_KEY, store.state);

/** HTML for a top-level card with its follow-ons (oldest first) inside. */
export function cardHtml(id: string): Raw | "" {
  const c = store.state.cards.find((x) => x.id === id);
  if (!c) return "";
  const kids = store.children(c.id).map((k) => resultCard(k, fmt));
  return resultCard(c, fmt, kids.length ? html`${kids}` : undefined);
}

function draw() {
  if (!view) return;
  const top = store.top();
  view.count.textContent = store.state.cards.length ? String(store.state.cards.length) : "";
  setHTML(view.list, top.length ? html`${top.map((c) => cardHtml(c.id))}` : html`<p class="results-empty muted">${EMPTY}</p>`);
}

function add(input: CardInput, parentId?: string): ResultCard {
  const parent = parentId ? rootId(store.state.cards, parentId) : undefined;
  const c = store.add(input, parent && store.state.cards.some((x) => x.id === parent) ? parent : undefined);
  save();
  draw();
  if (view) {
    const el = view.list.querySelector<HTMLElement>(`[data-card="${c.id}"]`);
    if (c.parent) el?.scrollIntoView({ block: "nearest" });
    else view.pane.scrollTop = 0;
  }
  badge("results");
  bus.emit("roll", c);
  return c;
}

/** Add a finished table roll as a card (nested under parentId's root card when given). */
export function logTableRoll(r: TableRoll, parentId?: string, context?: string): ResultCard {
  store.last = { kind: "table", key: r.ref.key, modifier: r.modifier };
  lastRef = r.ref;
  return add(cardFromTableRoll(r, context), parentId);
}

/** Add a plain dice roll (quick dice, top-bar dice) as a card. */
export function logDice(r: RollResult): ResultCard {
  store.last = { kind: "dice", die: r.label };
  lastRef = null;
  return add(cardFromDice(r));
}

/** Roll on a table and add the result to Results. Returns the roll. */
export async function rollAndLog(ref: TableRef, modifier = 0, parentId?: string, context?: string): Promise<TableRoll> {
  const r = await rollOnTable(ref, modifier);
  logTableRoll(r, parentId, context);
  return r;
}

// follow-ons are only made for rollable tables (rolltable.followOns), so a locked code never lands here
const findTable = (key: string): TableRef | undefined => rollableByCode(key) ?? tableBySection(key);

/** Is there a roll to repeat (anything rolled since the page loaded)? */
export const hasLast = (): boolean => store.last !== null;

/** Repeat the last roll of any kind (no-op when nothing has been rolled this session). */
export async function rerollLast(): Promise<void> {
  const last = store.last;
  if (!last) return;
  if (last.kind === "dice") {
    logDice(await rollDice(last.die));
    return;
  }
  const ref = lastRef && lastRef.key === last.key ? lastRef : findTable(last.key);
  if (ref) await rollAndLog(ref, last.modifier);
}

/**
 * Handle a click inside rendered result cards (Results, or a book page's .table-result):
 * follow-on rolls, → Notes (appends to the session log), and the table link. Resolves true when it handled the click;
 * a follow-on resolves after its card was added.
 */
export async function handleCardClick(e: MouseEvent, o: { openTab(route: string): void; toast(msg: string): void }): Promise<boolean> {
  const t = e.target as HTMLElement;
  const follow = t.closest<HTMLButtonElement>("button[data-follow]");
  if (follow) {
    if (follow.disabled) return true;
    follow.disabled = true;
    try {
      const [key, mod] = follow.dataset.follow!.split("|");
      const ref = findTable(key);
      const parent = follow.closest<HTMLElement>("[data-card]")?.dataset.card;
      if (ref) await rollAndLog(ref, +mod || 0, parent);
      else o.toast(`Couldn't find table ${key}`);
    } finally {
      follow.disabled = false;
    }
    return true;
  }
  const toNotes = t.closest<HTMLElement>("[data-to-notes]");
  if (toNotes) {
    const c = store.state.cards.find((x) => x.id === toNotes.dataset.toNotes);
    if (c) {
      appendNote(noteFromCard(c));
      o.toast("Added to Notes");
    }
    return true;
  }
  const link = t.closest<HTMLAnchorElement>("a[data-open-section]");
  if (link) {
    // modified/middle clicks fall through to the tabs' new-tab handler
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return false;
    e.preventDefault();
    o.openTab(`#/s/${encodeURIComponent(link.dataset.openSection!)}`);
    return true;
  }
  return false;
}

/** Build the Results tab into its panel pane. */
export function initResults(pane: HTMLElement, o: { openTab(route: string): void; toast(msg: string): void }): void {
  setHTML(pane, html`<header class="results-head"><h2>Results</h2><span class="results-count" aria-label="Cards"></span>${button("Clear", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-results-clear aria-label="Clear results"` })}</header><div class="results-list"></div>`);
  view = {
    pane,
    list: pane.querySelector(".results-list")!,
    count: pane.querySelector(".results-count")!,
    ...o,
  };
  pane.querySelector<HTMLElement>("[data-results-clear]")!.onclick = () => {
    store.clear();
    save();
    draw();
    bus.emit("results:cleared", { source: "results" });
  };
  view.list.addEventListener("click", (e) => void handleCardClick(e, o));
  draw();
}
