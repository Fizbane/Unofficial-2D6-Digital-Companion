// The combat log as saved state keeps it: data, never markup (a saved state can come from an imported
// backup). Shared by 2D6 Dungeon's and 2D6 Void's Combat. Text is escaped when drawn; only the elements,
// classes and icons listed here are made.
import { plainText } from "../shell/journalprose";
import { ICON_NAMES, icon, type IconName } from "../ui/icon";
import { html, type Raw } from "../ui/html";

/** One piece of a log entry: text, an element with children, an icon, or book text (drawn with `inline`). */
export type LogNode = string | { el: "strong" | "em" | "span"; cls?: LogClass; kids: LogNode[] } | { icon: IconName } | { book: string };
const LOG_DEPTH = 8;
const LOG_CLASSES = ["tone-prime", "tone-exact", "tone-miss", "muted", "deflect", "vc-effect"] as const; // vc-effect: 2D6 Void's card effects
export type LogClass = (typeof LOG_CLASSES)[number];
export interface LogEntry { r: number; n: LogNode[] }
export const strong = (kids: LogNode[], cls?: LogClass): LogNode => ({ el: "strong", kids, ...(cls ? { cls } : {}) });
export const em = (...kids: LogNode[]): LogNode => ({ el: "em", kids });
export const span = (cls: LogClass, kids: LogNode[]): LogNode => ({ el: "span", cls, kids });

/** A log entry as markup; `inline` renders book text. Anything unexpected in a saved entry is drawn as text or dropped. */
export function logHtml(e: LogEntry | string, inline: (s: string) => Raw): Raw {
  if (typeof e === "string") return html`${plainText(e)}`;
  return html`<span class="muted">R${Number(e.r) || 0}</span> ${logNodes(e.n, inline)}`;
}

/** Log nodes as markup (also 2D6 Void's combat log). Text is escaped; only the elements, classes and icons above are made. */
export function logNodes(list: unknown, inline: (s: string) => Raw): Raw {
  const node = (n: LogNode, depth = 0): Raw | string => {
    if (typeof n === "string") return n;
    if (!n || typeof n !== "object") return "";
    if ("icon" in n) return (ICON_NAMES as readonly string[]).includes(n.icon) ? icon(n.icon, { size: 14 }) : "";
    if ("book" in n) return inline(String(n.book));
    // nesting is capped: deeper kids are dropped (our own entries nest 2 levels at most)
    const kids = depth < LOG_DEPTH - 1 && Array.isArray(n.kids) ? n.kids.map((k) => node(k, depth + 1)) : [];
    const cls = n.cls && (LOG_CLASSES as readonly string[]).includes(n.cls) ? html` class="${n.cls}"` : "";
    if (n.el === "strong") return html`<strong${cls}>${kids}</strong>`;
    if (n.el === "em") return html`<em${cls}>${kids}</em>`;
    if (n.el === "span") return html`<span${cls}>${kids}</span>`;
    return html`${kids}`;
  };
  return html`${Array.isArray(list) ? (list as LogNode[]).map((k) => node(k)) : ""}`;
}

