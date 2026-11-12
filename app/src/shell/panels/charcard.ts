// The compact character card shown in the character bar's name-chip flyout:
// a portrait header (picture, name, "Level N") and a short read of the sheet with HP ± and
// "Open full sheet". Also the portrait markup used by the name chip and the sheet's Identity card.
import type { Character, stats as statsFn } from "../../tools/sheet";
import { button, statBlock } from "../../ui/components";
import { icon } from "../../ui/icon";
import { safePortrait, signed, stepHp, xpPct } from "../charmodel";
import { html, type Raw } from "../../ui/html";

type Stats = ReturnType<typeof statsFn>;
type SheetModule = typeof import("../../tools/sheet");

/** A square portrait: the picture, or the name's initial on an accent tint (the user icon with no name). */
export function portrait(c: Pick<Character, "name" | "portrait">, size: "sm" | "lg"): Raw {
  const src = safePortrait(c.portrait);
  const initial = c.name.trim().charAt(0).toUpperCase();
  const inner = src
    ? html`<img src="${src}" alt="">`
    : initial
      ? html`<span class="portrait-initial">${initial}</span>`
      : icon("user", { size: size === "lg" ? 32 : 14 });
  return html`<span class="portrait portrait-${size}${src ? "" : " is-empty"}" aria-hidden="true">${inner}</span>`;
}

/** The header: 72px portrait, the name in the display font, "Level N". `pic` replaces the portrait (the sheet's picture button). */
export function charHeader(c: Character, level: number, pic?: Raw): Raw {
  return html`<header class="char-head">${pic ?? portrait(c, "lg")}<div class="char-head-text">
    <h2 class="char-name">${c.name || "Adventurer"}</h2><span class="char-level">Level ${level}</span></div></header>`;
}

/** The whole compact card; `actions` adds buttons beside "Open full sheet". */
export function charCard(c: Character, s: Stats, fatigue: string, actions: Raw | "" = ""): Raw {
  const hpPct = Math.max(0, Math.min(100, (c.hp / s.baseline) * 100));
  const next = Number.isFinite(s.nextXp) ? `${c.xp} / ${s.nextXp} XP` : `${c.xp} XP · top level`;
  const armour = c.armour.filter((a) => a[0]);
  return html`${charHeader(c, s.level)}
    <div class="char-body">
      <div class="char-meter">
        <div class="char-meter-label"><span>XP</span><span class="muted">${next}</span></div>
        <div class="char-bar char-bar-xp"><div style="width:${xpPct(c.xp, s.nextXp)}%"></div></div>
      </div>
      <div class="char-meter">
        <div class="char-hp">
          <span>HP</span>
          ${button("", { icon: "minus", variant: "ghost", size: "sm", attrs: html`data-hp="-1" aria-label="Lose 1 HP"` })}
          <strong class="char-hp-value">${c.hp}</strong><span class="muted">/ ${s.baseline}</span>
          ${button("", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-hp="1" aria-label="Gain 1 HP"` })}
        </div>
        <div class="char-bar"><div style="width:${hpPct}%"></div></div>
      </div>
      ${statBlock([["Shift", signed(s.shift)], ["Discipline", signed(s.disc)], ["Precision", signed(s.prec)], ["Fatigue", fatigue]])}
      <h3>Armour</h3>
      ${armour.length ? html`<ul class="char-list">${armour.map((a) => html`<li><span>${a[0]}</span><span class="muted">${a[1] || "—"}</span></li>`)}</ul>` : html`<p class="muted">None worn.</p>`}
      <h3>Gear</h3>
      <ul class="char-list">
        <li><span>Weapon</span><span>${c.weapon || "—"}</span></li>
        <li><span>Coins</span><span>${c.gc} GC · ${c.sc} SC · ${c.cc} CC</span></li>
        <li><span>Rations</span><span>${c.rations}</span></li>
      </ul>
      <div class="char-actions">${button("Open full sheet", { icon: "scroll", variant: "ghost", size: "sm", attrs: html`data-open-sheet` })}${actions}</div>
    </div>`;
}

/** Clicks inside a card: HP ± (saved with `source`) and "Open full sheet". */
export function wireCharCard(root: HTMLElement, o: { source: string; sheet: () => SheetModule | null; openSheet(): void }): void {
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-open-sheet]")) return o.openSheet();
    const b = t.closest<HTMLElement>("[data-hp]");
    const sheet = o.sheet();
    if (!b || !sheet) return;
    const c = sheet.loadChar();
    const hp = stepHp(c.hp, +b.dataset.hp!);
    if (hp === c.hp) return;
    c.hp = hp;
    sheet.saveChar(c, o.source); // redraws through character:changed
    root.querySelector<HTMLElement>(`[data-hp="${b.dataset.hp}"]`)?.focus();
  });
}
