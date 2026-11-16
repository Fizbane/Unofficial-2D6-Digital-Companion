// A table roll kept as a small note for a play tool's card (Lairs, Haunted House): the entry's cells by
// column and the tables its text points to, saved with the tool so it survives a reload.
import { entryCells, followOns, isLockedTable, isTableRef, tableFor, type TableRoll } from "../rolltable";
import { rollAndLog } from "../shell/panels/results";
import type { Locked } from "../content";
import { lockedCard } from "../ui/locked";
import { button } from "../ui/components";
import { html, type Raw } from "../ui/html";

export interface Note { title: string; dice: string; rows: [string, string][]; follow: { key: string; label: string }[] }

export function noteOf(r: TableRoll): Note {
  const { columns, cells } = r.rowIndex < 0 ? { columns: [] as string[], cells: [] as string[] } : entryCells(r.ref.table, r.rowIndex, r.half);
  const rows = columns.slice(1).flatMap((c, i): [string, string][] => (cells[i + 1] ? [[c, cells[i + 1]]] : []));
  const follow = followOns(rows.map((x) => x[1]).join(" ")).map((f) => ({ key: f.ref.key, label: f.label }));
  return { title: r.ref.title, dice: `${r.roll.label} ${r.roll.text}${r.modifier ? ` ${r.modifier > 0 ? "+" : ""}${r.modifier} → ${r.value}` : ""}`, rows, follow };
}

/** Roll a table by section id or code and log it in Results: the note, `{ locked }` while its book is locked, or null when it isn't there. */
export async function rollNote(key: string, context: string, modifier = 0): Promise<Note | { locked: Locked } | null> {
  const ref = tableFor(key);
  if (isLockedTable(ref)) return { locked: ref.locked };
  if (!isTableRef(ref)) return null;
  return noteOf(await rollAndLog(ref, modifier, undefined, context));
}

/** The note as card markup; its follow-on tables get "Roll" buttons (`data-roll`). */
export function noteHtml(n: Note | null, locked: Locked | null, inline: (s: string) => Raw, empty: string): Raw {
  if (locked) return lockedCard(locked);
  if (!n) return html`<p class="muted">${empty}</p>`;
  if (!n.rows.length) return html`<strong>${n.title}</strong> <span class="log-roll">${n.dice}</span> <span class="muted">No matching row.</span>`;
  return html`<strong>${n.title}</strong> <span class="log-roll">${n.dice}</span>
    <dl class="kv" style="margin-top:4px">${n.rows.map(([c, v]) => html`<dt>${c}</dt><dd>${inline(v)}</dd>`)}</dl>
    ${n.follow.length ? html`<div class="step-actions">${n.follow.map((f) => button(`Roll ${f.label}`, { size: "sm", icon: "dice", attrs: html`data-roll="${f.key}"` }))}</div>` : ""}`;
}
