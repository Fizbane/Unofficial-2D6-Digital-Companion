// The Combat log tab: every event of the current fight, newest first, read from Combat's saved state (2D6
// Dungeon's "combat", 2D6 Void's "vcombat"). The tab only shows while you are somewhere a fight happens: a
// dungeon level, a lair, the haunted house, the Dark Hulk, or any fight that is under way (panelmodel
// combatLogShown). It redraws when Combat saves, and badges its tab when an event arrives off screen.
import { isVoid, gameId } from "../../games";
import { load } from "../../tools/common";
import { logHtml, logNodes, type LogEntry } from "../../tools/combatlog";
import { html, type Raw, setHTML } from "../../ui/html";
import { bus } from "../events";
import { plainText } from "../journalprose";
import { combatLogShown } from "../panelmodel";
import { badge, onPanelShow, panelVisible, setPanelTabHidden } from "../rightpanel";

interface Opts { inline(s: string): Raw }
interface Fight { phase?: unknown; stage?: unknown; round?: unknown; log?: unknown; foes?: unknown }

const fight = (): Fight => load<Fight>(isVoid() ? "vcombat" : "combat", {});
const entries = (f: Fight): unknown[] => (Array.isArray(f.log) ? f.log : []);
const fighting = (f: Fight): boolean => typeof f.phase === "string" && f.phase !== "setup";
const saved = (key: string): unknown => load<Record<string, unknown> | null>(key, null);

/** Should the tab show right now? */
const shown = (): boolean =>
  combatLogShown(gameId(), { dungeon: saved("dungeon"), lairs: saved("lairs"), haunted: saved("haunted"), vhulk: saved("vhulk"), fighting: fighting(fight()) });

/** One log line: Dungeon's rounds ("R2"), or Void's stage tag ("Shots", "Pre", "R2"). */
function line(e: unknown, inline: (s: string) => Raw): Raw {
  if (typeof e === "string") return html`${plainText(e)}`;
  if (!e || typeof e !== "object") return html``;
  const v = e as { t?: unknown; n?: unknown };
  if (isVoid()) return html`<span class="muted">${typeof v.t === "string" ? v.t : ""}</span> ${logNodes(v.n, inline)}`;
  return logHtml(e as LogEntry, inline);
}

export function initCombatLog(pane: HTMLElement, o: Opts): void {
  let count = entries(fight()).length;
  let stale = true;
  const draw = () => {
    stale = false;
    const f = fight();
    const log = entries(f);
    const names = Array.isArray(f.foes) ? f.foes.map((x) => String((x as { name?: unknown } | null)?.name ?? "")).filter(Boolean) : [];
    setHTML(pane, html`<header class="results-head pane-head"><h2>Combat log</h2><span class="muted">${log.length ? `${log.length} event${log.length === 1 ? "" : "s"}` : "No fight yet"}</span></header>
      ${log.length
        ? html`${names.length ? html`<p class="muted clog-foes">${names.join(", ")}</p>` : ""}<ol class="combat-log clog-list" reversed>${log.map((e) => html`<li>${line(e, o.inline)}</li>`)}</ol>`
        : html`<p class="muted clog-empty">Each blow, shift and interrupt of a fight is listed here as it happens. Start a fight from a room's Fight button, or on the Combat page.</p>`}`);
  };
  const refresh = () => {
    setPanelTabHidden("combat", !shown());
    const n = entries(fight()).length;
    if (n > count) badge("combat"); // new events while the tab is off screen
    count = n;
    if (panelVisible("combat")) draw();
    else stale = true;
  };
  onPanelShow((id) => {
    if (id === "combat" && stale) draw();
  });
  // Combat saved (either game), the level changed, or another tool was opened (lairs and the haunted house save without an event)
  bus.on("combat:changed", refresh);
  bus.on("void:changed", refresh);
  bus.on("dungeon:changed", refresh);
  bus.on("tabs:changed", refresh);
  window.addEventListener("storage", refresh); // a fight played in another window
  refresh();
}
