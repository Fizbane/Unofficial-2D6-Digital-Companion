// The rail's character picker: a popover listing the current game's characters (roster.ts), most recently
// played first. Clicking one switches to it (games.ts switchCharacter reloads into their tabs); the footer
// starts a new one or opens the Characters page for export, import and delete.
import type { CharacterSummary } from "../roster";
import { icon } from "../ui/icon";
import { html, type Raw } from "../ui/html";

export interface PickWords { one: string; unnamed: string }

export const pickWords = (isVoidGame: boolean): PickWords =>
  isVoidGame ? { one: "survivor", unnamed: "Unnamed survivor" } : { one: "character", unnamed: "Unnamed adventurer" };

/** "Level 3 · 40 HP" (Void adds the profession); "Not started yet" for an empty sheet. */
export function pickLine(c: CharacterSummary, level: number | null): string {
  const parts = [c.profession, level ? `Level ${level}` : "", c.hp !== null ? `${c.hp} HP` : ""];
  return parts.filter(Boolean).join(" · ") || "Not started yet";
}

/** The popover's contents. `levelOf` works a Dungeon level out from XP (Void stores its own). */
export function charPickHtml(list: CharacterSummary[], w: PickWords, levelOf: (c: CharacterSummary) => number | null): Raw {
  const row = (c: CharacterSummary) => {
    const pic = c.portrait ? html`<img src="${c.portrait}" alt="" width="36" height="36">` : icon("user", { size: 20 });
    const name = c.name || w.unnamed;
    return html`<li><button type="button" class="char-pick-row" data-pick="${c.id}" aria-current="${c.active ? "true" : "false"}"${c.active ? html` title="Playing now"` : html` title="Switch to ${name}"`}>
      <span class="char-pick-pic">${pic}</span>
      <span class="char-pick-body"><span class="char-pick-name">${name}</span><span class="char-pick-line">${pickLine(c, levelOf(c))}</span></span>
      ${c.active ? html`<span class="char-pick-badge">Playing</span>` : ""}
    </button></li>`;
  };
  return html`<p class="char-pick-head">${w.one === "survivor" ? "Survivors" : "Characters"}</p>
    <ul class="char-pick-list">${list.map(row)}</ul>
    <div class="char-pick-foot">
      <button type="button" class="btn btn-ghost btn-sm" data-pick-act="new">${icon("plus", { size: 15 })}<span>New ${w.one}</span></button>
      <button type="button" class="btn btn-ghost btn-sm" data-pick-act="all">${icon("user", { size: 15 })}<span>All ${w.one}s…</span></button>
    </div>`;
}

/** Start a new character in the current game, as the Characters page's New does; false if storage is full. */
export async function startNewCharacter(isVoidGame: boolean, byId: Parameters<typeof import("../tools/sheet").startNewAdventurer>[0]): Promise<boolean> {
  if (isVoidGame) {
    const { createCharacter } = await import("../roster");
    const { switchCharacter } = await import("../games");
    return createCharacter({}, undefined, (id) => switchCharacter(id, "#/play/vsheet"));
  }
  const { startNewAdventurer } = await import("../tools/sheet");
  return startNewAdventurer(byId);
}
