// Results panel model: table/dice rolls become result cards; the last 100 are kept for saving.
import type { RollResult } from "../dice";
import { followOns, type TableRoll } from "../rolltable";
import type { ResultCard } from "./types";

export type { FollowOn, ResultCard } from "./types";

export type LastRoll = { kind: "table"; key: string; modifier: number } | { kind: "dice"; die: string };
export interface ResultsState { v: 1; cards: ResultCard[] }
export type CardInput = Omit<ResultCard, "id" | "at" | "parent">;

const CAP = 100;

function isCard(v: unknown): v is ResultCard {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === "string" && typeof c.at === "number" && typeof c.eyebrow === "string" &&
    typeof c.title === "string" && typeof c.text === "string" && typeof c.dice === "string" && Array.isArray(c.follow);
}

export function isResultsState(v: unknown): v is ResultsState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return s.v === 1 && Array.isArray(s.cards) && s.cards.every(isCard);
}

/** "CODE · Title", or just the title when it already starts with the code ("ENAT1 - Encounters"). */
function eyebrowFor(code: string | null | undefined, title: string): string {
  if (!code || title.trim().toUpperCase().startsWith(code.toUpperCase())) return title;
  return `${code} · ${title}`;
}

export function cardFromTableRoll(r: TableRoll, context?: string): CardInput {
  const hit = r.rowIndex >= 0;
  const code = r.ref.table.code;
  const mod = r.modifier ? ` ${r.modifier > 0 ? "+" : ""}${r.modifier}${r.clamped ? " (clamped)" : ""} → ${r.value}` : "";
  const card: CardInput = {
    eyebrow: eyebrowFor(code, r.ref.title),
    // cells[0] is the roll-range column; the first result cell is the title.
    title: hit ? r.cells[1] ?? r.cells[0] ?? "" : "No match",
    text: hit ? r.cells.slice(2).join(" — ") : `No row for ${r.value} on this table.`,
    dice: `${r.roll.label}: ${r.roll.text}${mod}`,
    sectionId: r.ref.sectionId,
    follow: hit ? followOns(r.cells.join(" ")).map((f) => ({ key: f.ref.key, modifier: f.modifier, label: f.label })) : [],
  };
  if (context) card.context = context;
  return card;
}

export function cardFromDice(r: RollResult): CardInput {
  return { eyebrow: r.label, title: String(r.value), text: "", dice: `${r.label}: ${r.text}`, follow: [] };
}

export class ResultStore {
  readonly state: ResultsState;
  last: LastRoll | null = null;
  private seq: number;

  constructor(state?: ResultsState) {
    this.state = state ?? { v: 1, cards: [] };
    this.seq = this.state.cards.reduce((n, c) => Math.max(n, /^c(\d+)$/.exec(c.id) ? +c.id.slice(1) : 0), 0);
  }

  add(card: CardInput, parent?: string, now: number = Date.now()): ResultCard {
    const c: ResultCard = { ...card, id: `c${++this.seq}`, at: now };
    if (parent) c.parent = parent;
    this.state.cards.push(c);
    // the root the new card hangs under (itself when top-level) is never the one evicted
    let root: ResultCard = c;
    for (let p = c.parent; p; ) {
      const up = this.state.cards.find((x) => x.id === p);
      if (!up) break;
      root = up;
      p = up.parent;
    }
    while (this.state.cards.length > CAP) {
      const oldest = this.state.cards.find((x) => !x.parent && x !== root);
      if (!oldest) {
        // only the new card's own tree is left: drop its oldest other card
        this.state.cards.splice(this.state.cards.findIndex((x) => x !== c && x !== root), 1);
        continue;
      }
      this.state.cards = this.state.cards.filter((x) => x !== oldest && x.parent !== oldest.id);
    }
    return c;
  }

  /** Top-level cards, newest first. */
  top(): ResultCard[] {
    return this.state.cards.filter((c) => !c.parent).reverse();
  }

  /** Children of a card, oldest first. */
  children(id: string): ResultCard[] {
    return this.state.cards.filter((c) => c.parent === id);
  }

  clear(): void {
    this.state.cards = [];
  }
}
