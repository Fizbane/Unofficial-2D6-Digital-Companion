// Statistics page: how play has gone in this game, counted from the adventure so far and every adventure
// before it. Read-only: the recorder (shell/statistics.ts) keeps the numbers, and this page redraws when they change.
import type { ToolContext } from "../main";
import { bus } from "../shell/events";
import { statsState } from "../shell/statistics";
import { statsView, type Adventure } from "../shell/statisticsmodel";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const TOP = 10; // how many rows of each ranked list to show
const KINDS: [string, string][] = [["entrance", "Entrances"], ["corridor", "Corridors"], ["small", "Small rooms"], ["regular", "Regular rooms"], ["large", "Large rooms"]];

const n = (v: number | undefined): string => (v ?? 0).toLocaleString();

function tile(value: number | undefined, label: string): Raw {
  return html`<div class="stat-tile"><strong class="stat-value">${n(value)}</strong><span class="stat-label">${label}</span></div>`;
}

function list(rows: [string, number][], empty: string): Raw {
  if (!rows.length) return html`<p class="muted">${empty}</p>`;
  return html`<ul class="stat-list">${rows.slice(0, TOP).map(([name, count]) => html`<li><span>${name}</span><span class="muted">${n(count)}</span></li>`)}</ul>`;
}

function adventures(past: Adventure[], current: Adventure | null): Raw {
  const now = current ? html`<p class="muted">In progress: ${n(current.rooms)} rooms, ${n(current.fights)} fights, ${n(current.foesDefeated)} foes defeated.</p>` : "";
  if (!past.length) return html`${now}<p class="muted">No adventures finished yet.</p>`;
  return html`${now}<table class="stat-table"><thead><tr><th>Ended</th><th>How</th><th class="num">Rooms</th><th class="num">Fights</th><th class="num">Foes</th><th class="num">Deepest</th></tr></thead><tbody>${past.map((a) => html`<tr><td>${DATE.format(a.endedAt)}</td><td>${a.how === "escape" ? "Escaped" : "Died"}</td><td class="num">${n(a.rooms)}</td><td class="num">${n(a.fights)}</td><td class="num">${n(a.foesDefeated)}</td><td class="num">${n(a.deepest)}</td></tr>`)}</tbody></table>`;
}

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "stat-page");

  const draw = () => {
    const s = statsState();
    const v = statsView(s);
    const t = v.totals;
    const kinds: [string, number][] = KINDS.map(([k, label]) => [label, t[`roomsKind:${k}`] ?? 0]);
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title"><h1>${icon("scroll", { size: 26 })}<span>Statistics</span></h1></div>
      </header>
      <p class="muted ach-note">How your play has gone in this game. The numbers are kept with play data and are part of a backup.</p>
      <div class="stat-grid">
        ${tile(t.foesDefeated, "Foes defeated")}
        ${tile(t.fightsWon, "Fights won")}
        ${tile(t.fightsLost, "Fights lost")}
        ${tile(t.longestFight, "Longest fight (rounds)")}
        ${tile(t.rooms, "Rooms explored")}
        ${tile(t.dice, "Dice rolled")}
        ${tile(t.doubles, "Doubles rolled")}
        ${tile(t.adventures, "Adventures ended")}
      </div>
      <div class="stat-cols">
        <section class="card"><header class="card-head"><h2 class="card-title">Rooms by kind</h2></header>${list(kinds, "No rooms explored yet.")}</section>
        <section class="card"><header class="card-head"><h2 class="card-title">Room types</h2></header>${list(v.roomTypes, "No room types recorded yet.")}</section>
        <section class="card"><header class="card-head"><h2 class="card-title">Foes defeated</h2></header>${list(v.foes, "No foes defeated yet.")}</section>
      </div>
      <section class="card"><header class="card-head"><h2 class="card-title">Adventures</h2></header>${adventures(v.past, v.current)}</section>`);
  };

  draw();
  ctx.onDispose(bus.on("statistics:changed", draw));
}
