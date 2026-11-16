// 2D6 Void's character-bar chips (bottombar.ts draws these instead of Dungeon's in Void mode):
// name with portrait, HP bar, XP, Marksmanship, and Bloodied / Stunned when ticked. The name chip
// opens the survivor flyout; the others open a quick-edit popover (charbar-pop.ts, data-pop).
import { button, chip, statBlock } from "../ui/components";
import { html, type Raw } from "../ui/html";
import { portrait } from "./panels/charcard";
import { signed, stepHp, xpPct } from "./charmodel";
import { hasVChar, loadVChar, saveVChar, vstats, type VStats, type VoidCharacter } from "../tools/void/sheetmodel";

/** The Void bar chips in two groups: the player (name chip) and the stats; bottombar.ts places each. */
export function voidChipParts(): { player: Raw; stats: Raw } {
  if (!hasVChar())
    // no survivor yet: still the name chip, so hovering shows the flyout (voidCard's empty card), as in Dungeon;
    // data-hp-chip keeps it on narrow screens, where the bar shows only that chip
    return { player: html`<button type="button" class="chip strip-name" data-name-chip data-vchip data-hp-chip aria-haspopup="dialog" aria-expanded="false" title="Create your survivor">${portrait({ name: "", portrait: "" }, "sm")}<span class="chip-label">New survivor</span></button>`, stats: html`` };
  const c = loadVChar();
  const s = vstats(c);
  const pct = Math.max(0, Math.min(100, (c.hp / s.baseline) * 100)) || 0;
  const cond = (n: number, label: string, max = 8) =>
    n > 0 ? chip(label, { value: `${Math.min(max, n)}/${max}`, attrs: html`data-pop="${label.toLowerCase()}" aria-haspopup="dialog" title="Change ${label}"${n >= max ? html` data-full=""` : ""}` }) : "";
  return {
    player: html`<button type="button" class="chip strip-name" data-name-chip data-vchip aria-haspopup="dialog" aria-expanded="false" title="Survivor">${portrait(c, "sm")}<span class="chip-label">${c.name || "Survivor"} · Lv ${s.level}</span></button>`,
    stats: html`<button type="button" class="chip strip-hp" data-pop="hp" data-hp-chip aria-haspopup="dialog" title="Change HP"><span class="chip-label">HP</span><span class="strip-hp-bar" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="chip-value">${c.hp}/${s.baseline}</span></button>${cond(c.bloodied, "Bloodied")}${cond(c.stunned, "Stunned")}${chip("XP", { value: String(c.xp), attrs: html`data-pop="xp" aria-haspopup="dialog" title="Change XP or add XP from a source"` })}${chip("Marks", { value: String(s.marksmanship), attrs: html`data-pop="marks" aria-haspopup="dialog" title="Marksmanship ${s.marksmanship} · ranged hits ${c.rangedHits}/10: tick a hit"` })}${chip("Rations", { value: String(c.rations), attrs: html`data-pop="rations" aria-haspopup="dialog" title="Change rations"` })}`,
  };
}

/** Both groups' chips together. */
export function voidChips(): Raw {
  const p = voidChipParts();
  return html`${p.player}${p.stats}`;
}

/** The compact survivor card for the name-chip flyout (the Void counterpart of panels/charcard.ts). */
export function voidCharCard(c: VoidCharacter, s: VStats): Raw {
  const hpPct = Math.max(0, Math.min(100, (c.hp / s.baseline) * 100)) || 0;
  const next = Number.isFinite(s.nextXp) ? `${c.xp} / ${s.nextXp} XP` : `${c.xp} XP · top level`;
  const armour = c.armour.filter((a) => a.name);
  return html`<header class="char-head">${portrait(c, "lg")}<div class="char-head-text">
      <h2 class="char-name">${c.name || "Survivor"}</h2><span class="char-level">Level ${s.level} · ${c.profession}</span></div></header>
    <div class="char-body">
      <div class="char-meter">
        <div class="char-meter-label"><span>XP</span><span class="muted">${next}</span></div>
        <div class="char-bar char-bar-xp"><div style="width:${xpPct(c.xp, s.nextXp)}%"></div></div>
      </div>
      <div class="char-meter">
        <div class="char-hp">
          <span>HP</span>
          ${button("", { icon: "minus", variant: "ghost", size: "sm", attrs: html`data-vhp="-1" aria-label="Lose 1 HP"` })}
          <strong class="char-hp-value">${c.hp}</strong><span class="muted">/ ${s.baseline}</span>
          ${button("", { icon: "plus", variant: "ghost", size: "sm", attrs: html`data-vhp="1" aria-label="Gain 1 HP"` })}
        </div>
        <div class="char-bar"><div style="width:${hpPct}%"></div></div>
      </div>
      ${statBlock([["Shift", String(s.shift)], ["Technical", signed(s.technical)], ["Coding", signed(s.coding)], ["Marksmanship", String(s.marksmanship)]])}
      ${statBlock([["Bloodied", `${Math.min(8, c.bloodied)}/8`], ["Stunned", c.stunned > 0 ? `${c.stunned} room${c.stunned === 1 ? "" : "s"}` : "—"]])}
      <h3>Armour</h3>
      ${armour.length ? html`<ul class="char-list">${armour.map((a) => html`<li><span>${a.name}</span><span class="muted">${a.mod ? signed(a.mod) : "—"}</span></li>`)}</ul>` : html`<p class="muted">None worn.</p>`}
      <h3>Gear</h3>
      <ul class="char-list">
        <li><span>Melee</span><span>${c.weapon || "—"}</span></li>
        <li><span>Credits</span><span>${c.credits}</span></li>
        <li><span>Rations</span><span>${c.rations}</span></li>
      </ul>
      <div class="char-actions">${button("Open full sheet", { icon: "scroll", variant: "ghost", size: "sm", attrs: html`data-open-sheet` })}</div>
    </div>`;
}

/** Clicks in the Void card: HP ± (saved as "strip") and "Open full sheet". */
export function wireVoidCharCard(root: HTMLElement, openSheet: () => void): void {
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-open-sheet]")) return openSheet();
    const b = t.closest<HTMLElement>("[data-vhp]");
    if (!b) return;
    const c = loadVChar();
    const hp = stepHp(c.hp, +b.dataset.vhp!);
    if (hp === c.hp) return;
    c.hp = hp;
    saveVChar(c, "strip");
    root.querySelector<HTMLElement>(`[data-vhp="${b.dataset.vhp}"]`)?.focus();
  });
}

/** The flyout's card for the current survivor, or null when none is saved yet. */
/** The flyout's card: the survivor's, or (none made yet) a prompt to create one on the sheet. */
export function voidCard(): Raw | null {
  if (!hasVChar())
    return html`<header class="char-head">${portrait({ name: "", portrait: "" }, "lg")}<div class="char-head-text">
      <h2 class="char-name">New survivor</h2><span class="char-level">Not created yet</span></div></header>
    <div class="char-body"><p class="muted">Pick a name, profession, weapon and armour on the character sheet to start.</p>
      <div class="step-actions">${button("Create your survivor", { icon: "scroll", variant: "primary", size: "sm", attrs: html`data-open-sheet` })}</div></div>`;
  const c = loadVChar();
  return voidCharCard(c, vstats(c));
}
