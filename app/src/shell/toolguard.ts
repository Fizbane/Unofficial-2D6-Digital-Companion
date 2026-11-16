// A safety net for the play tools: saved state comes from storage (and from imported backups), so a tool's first
// draw can throw on a shape it didn't expect. This wraps a tool once, where tabs mounts it. Nothing is deleted
// without a confirm(); "Keep it" leaves the data alone.
import type { ToolContext } from "./shell";
import { PLAY_TOOLS } from "../tools/common";
import { button, card } from "../ui/components";
import { html, setHTML } from "../ui/html";
import { keyFor } from "../games";

export interface Guarded {
  render(root: HTMLElement, ctx: ToolContext, route: string): void | Promise<void>;
  onShow?(): void;
  onHide?(): void;
}

/** What the guard needs from the page: a confirm() and the storage it clears (injectable for tests). */
export interface GuardEnv {
  confirm(message: string): boolean;
  storage: { removeItem(k: string): void; keys(): string[] };
}

const browserEnv = (): GuardEnv => ({
  confirm: (m) => confirm(m),
  storage: { removeItem: (k) => localStorage.removeItem(k), keys: () => Object.keys(localStorage) },
});

/** The saved-game keys a tool owns ("Start over" clears these and nothing else). Map and Settings keep none of their own. */
// in the current game and the active character's slot (games.ts keyFor); the Hulk map, like Map, keeps none of its own
const KEYS: Record<string, string[]> = {
  dungeon: ["2d6:play:dungeon"],
  sheet: ["2d6:play:character"],
  combat: ["2d6:play:combat"],
  realm: ["2d6:play:realm"],
  lairs: ["2d6:play:lairs"],
  haunted: ["2d6:play:haunted"],
  vhulk: ["2d6:play:vhulk"],
  vcombat: ["2d6:play:vcombat"],
  vsheet: ["2d6:play:vsheet"],
};
const VOID_TOOLS = new Set(["vhulk", "vcombat", "vsheet"]);
export const toolKeys = (id: string): string[] => (KEYS[id] ?? []).map((k) => keyFor(k, VOID_TOOLS.has(id) ? "void" : "dungeon"));

/** `page` with its render wrapped: if it throws, show the recovery card instead of the generic error. */
export function guardTool(id: string, page: Guarded, env: GuardEnv = browserEnv()): Guarded {
  const title = PLAY_TOOLS.find((t) => t.id === id)?.title ?? id;
  const blurb = PLAY_TOOLS.find((t) => t.id === id)?.blurb ?? "";
  const keys = toolKeys(id);
  if (!keys.length) return page; // nothing saved to lose: the generic error and Retry are enough

  async function render(root: HTMLElement, ctx: ToolContext, route: string): Promise<void> {
    try {
      await page.render(root, ctx, route);
    } catch (e) {
      console.error(e);
      showFailure(root, ctx, route);
    }
  }

  function showFailure(root: HTMLElement, ctx: ToolContext, route: string) {
    setHTML(root, card(
      html`<p class="err-msg">This saved game couldn't be read.</p><p class="muted">Nothing has been deleted.</p><div class="err-actions">${button("Keep it", { icon: "check", attrs: html`data-guard="keep"` })}${keys.length ? button("Start over", { variant: "primary", icon: "rotate-ccw", attrs: html`data-guard="reset"` }) : ""}</div>`,
      { title: "This page hit an error", tone: "danger" },
    ));
    const keep = root.querySelector<HTMLElement>('[data-guard="keep"]');
    if (keep) keep.onclick = () => {
      setHTML(root, card(html`<p>${blurb}</p><p class="muted">Your saved game is still on this device, untouched. Export a backup from Settings to keep a copy.</p>${keys.length ? button("Start over", { attrs: html`data-guard="reset"` }) : ""}`, { title }));
      wireReset(root, ctx, route);
    };
    wireReset(root, ctx, route);
  }

  function wireReset(root: HTMLElement, ctx: ToolContext, route: string) {
    const reset = root.querySelector<HTMLElement>('[data-guard="reset"]');
    if (!reset) return;
    reset.onclick = async () => {
      if (!env.confirm(`Delete this tool's saved game on this device? This can't be undone (export a backup from Settings first to keep a copy).`)) return;
      const have = new Set(env.storage.keys());
      for (const k of keys) if (have.has(k)) env.storage.removeItem(k);
      root.replaceChildren?.();
      await render(root, ctx, route);
    };
  }

  const out: Guarded = { ...page, render };
  if (page.onShow) out.onShow = () => safely(() => page.onShow!());
  if (page.onHide) out.onHide = () => safely(() => page.onHide!());
  return out;
}

function safely(fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(e);
  }
}
