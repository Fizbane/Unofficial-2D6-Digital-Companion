// Achievements page: lifetime goals by group, with progress toward each one. Read-only: the
// recorder (shell/achievements.ts) keeps the progress, and this page redraws when it changes.
import type { ToolContext } from "../main";
import { bus } from "../shell/events";
import { achState } from "../shell/achievements";
import { achView, type AchCard } from "../shell/achievementsmodel";
import { eyebrow } from "../ui/components";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";

/** One view of both games: each game's groups under its own heading, the shared dice between. */
const GAME_ORDER = [
  { id: "dungeon", title: "2D6 Dungeon" },
  { id: "both", title: "Both games" },
  { id: "void", title: "2D6 Void" },
] as const;

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function cardHtml(c: AchCard): Raw {
  const done = c.unlocked !== undefined;
  const foot = done
    ? html`<span class="ach-date">${icon("check", { size: 14 })} ${DATE.format(c.unlocked)}</span>`
    : c.hidden
      ? ""
      : html`<div class="ach-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.def.goal}" aria-valuenow="${c.value}" aria-label="${c.title} progress"><span style="width:${Number(c.pct) || 0}%"></span></div>
         <span class="ach-count">${c.value.toLocaleString()} / ${c.def.goal.toLocaleString()}</span>`;
  return html`<li class="ach-card${done ? " is-done" : ""}${c.hidden ? " is-secret" : ""}">
    <span class="ach-icon">${icon(c.hidden ? "sparkles" : c.def.icon, { size: 22 })}</span>
    <div class="ach-main"><strong class="ach-title">${c.title}</strong><span class="ach-blurb muted">${c.blurb}</span>${foot}</div>
  </li>`;
}

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "page-wide", "ach-page");

  const draw = () => {
    const v = achView(achState());
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title">${eyebrow("Play")}<h1>${icon("trophy", { size: 26 })}<span>Achievements</span></h1></div>
        <div class="play-actions"><span class="ach-total"><strong>${v.done}</strong> / ${v.total} unlocked</span></div>
      </header>
      <p class="muted ach-note">Lifetime goals across every character, in both games. Dice progress is shared: every roll in 2D6 Dungeon or 2D6 Void counts. They're kept when you clear play data, and they're part of a backup.</p>
      ${GAME_ORDER.map((g) => {
        const secs = v.sections.filter((s) => s.game === g.id);
        const got = secs.reduce((n, s) => n + s.cards.filter((c) => c.unlocked !== undefined).length, 0);
        const all = secs.reduce((n, s) => n + s.cards.length, 0);
        return html`<h2 class="ach-game">${g.title} <span class="muted">${got} / ${all}</span></h2>${secs.map((s) => {
          const n = s.cards.filter((c) => c.unlocked !== undefined).length;
          return html`<section class="card ach-group" aria-labelledby="ach-${s.id}">
            <header class="card-head"><h3 class="card-title" id="ach-${s.id}">${s.title}</h3><span class="muted">${n} / ${s.cards.length}</span></header>
            <ul class="ach-grid">${s.cards.map(cardHtml)}</ul>
          </section>`;
        })}`;
      })}`);
  };

  draw();
  ctx.onDispose(bus.on("achievements:changed", draw));
}
