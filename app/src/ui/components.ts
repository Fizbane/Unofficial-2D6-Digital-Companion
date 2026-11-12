// Shared UI building blocks. Each helper returns markup (`Raw`, built with html``); callers wire events
// through data-attributes, as the tools do today. Plain-text inputs are escaped; `attrs` is markup the
// caller builds with html`` (so its values are escaped too). Styles live in styles/components.css.
import type { ResultCard } from "../shell/types";
import { html, type Raw } from "./html";
import { icon, type IconName } from "./icon";

const sp = (attrs?: Raw) => (attrs ? html` ${attrs}` : "");
const cls = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function button(
  label: string,
  o: { icon?: IconName; variant?: "primary" | "ghost" | "danger"; attrs?: Raw; size?: "sm" | "lg" } = {},
): Raw {
  const c = cls("btn", o.variant && `btn-${o.variant}`, o.size && `btn-${o.size}`, !label && o.icon && "btn-icon");
  const ic = o.icon ? icon(o.icon, { size: o.size === "sm" ? 15 : o.size === "lg" ? 20 : 17 }) : "";
  const text = label ? html`<span>${label}</span>` : "";
  return html`<button type="button" class="${c}"${sp(o.attrs)}>${ic}${text}</button>`;
}

export function eyebrow(text: string): Raw {
  return html`<div class="eyebrow">${text}</div>`;
}

export function card(
  body: Raw,
  o: { eyebrow?: string; title?: string; titleIcon?: IconName; attrs?: Raw; tone?: "default" | "accent" | "danger" } = {},
): Raw {
  const c = cls("card", o.tone && o.tone !== "default" && `card-${o.tone}`);
  const head =
    o.eyebrow || o.title
      ? html`<header class="card-head">${o.eyebrow ? eyebrow(o.eyebrow) : ""}${o.title ? html`<h3 class="card-title">${o.titleIcon ? html`${icon(o.titleIcon, { size: 22 })} ` : ""}${o.title}</h3>` : ""}</header>`
      : "";
  return html`<section class="${c}"${sp(o.attrs)}>${head}<div class="card-body">${body}</div></section>`;
}

export function chip(
  label: string,
  o: { icon?: IconName; value?: string; attrs?: Raw; active?: boolean; disabled?: boolean } = {},
): Raw {
  const c = cls("chip", o.active && "is-active");
  const ic = o.icon ? icon(o.icon, { size: 14 }) : "";
  const val = o.value != null && o.value !== "" ? html`<span class="chip-value">${o.value}</span>` : "";
  const state = html`${o.active != null ? html` aria-pressed="${o.active ? "true" : "false"}"` : ""}${o.disabled ? html` disabled` : ""}`;
  return html`<button type="button" class="${c}"${state}${sp(o.attrs)}>${ic}<span class="chip-label">${label}</span>${val}</button>`;
}

export function tabsBar(items: { id: string; label: string; icon?: IconName }[], active: string, attrs?: Raw): Raw {
  const tabs = items.map((it) => {
    const on = it.id === active;
    return html`<button type="button" class="tab${on ? " is-active" : ""}" role="tab" data-tab="${it.id}" aria-selected="${String(on)}" tabindex="${on ? 0 : -1}">${it.icon ? icon(it.icon, { size: 16 }) : ""}<span>${it.label}</span></button>`;
  });
  return html`<div class="tabs-bar" role="tablist"${sp(attrs)}>${tabs}</div>`;
}

export function statBlock(rows: [string, string][]): Raw {
  return html`<dl class="stat-block">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

const LEAD_RE = /^(.{2,60}?)\s*(?:[–—:]|\s-\s|\.\s)\s*(.+)$/s;
const DASH_RE = /^(.{2,60}?)\s*(?:[–—:]|\s-\s)\s*(.+)$/s;

/**
 * Display split for a long result title (render-time only; the stored card is unchanged). A row's
 * first cell is often a label plus rule text ("ARCHAEOLOGY – Over the year…"): the label becomes the
 * title and the rest leads the text. A long title with no label is flagged `long` (shown in reading type).
 * A lead counts as a label when it has no lower-case letters, or is at most 4 words before a dash/colon.
 */
export function splitResultTitle(title: string): { title: string; rest?: string; long: boolean } {
  const t = title.trim();
  if (t.length <= 60) return { title: t, long: false };
  const caps = t.match(LEAD_RE);
  if (caps && !/\p{Ll}/u.test(caps[1])) return { title: caps[1].trim(), rest: caps[2].trim(), long: false };
  const dash = t.match(DASH_RE);
  if (dash && dash[1].trim().split(/\s+/).length <= 4) return { title: dash[1].trim(), rest: dash[2].trim(), long: false };
  return { title: t, long: true };
}

const hhmm = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * A roll result card (spec §5.1). `inline` renders title/text (it escapes and adds links);
 * follow-on buttons carry data-follow="KEY|mod"; a section link carries data-open-section; `children` (nested follow-on cards) goes inside.
 */
export function resultCard(c: ResultCard, inline: (s: string) => Raw, children?: Raw): Raw {
  const follow = c.follow.map(
    (f) =>
      html`<button type="button" class="btn btn-sm btn-ghost" data-follow="${`${f.key}|${f.modifier}`}">${icon("dice", { size: 15 })}<span>${f.label}</span></button>`,
  );
  const notes = html`<button type="button" class="btn btn-sm btn-ghost" data-to-notes="${c.id}" aria-label="Copy to notes">${icon("notebook", { size: 15 })}<span>Notes</span></button>`;
  const table = c.sectionId
    ? html`<a class="btn btn-sm btn-ghost" href="#/s/${encodeURIComponent(c.sectionId)}" data-open-section="${c.sectionId}" aria-label="Open the table">${icon("book", { size: 15 })}<span>Table</span></a>`
    : "";
  const head = splitResultTitle(c.title);
  return html`<article class="result-card${c.parent ? " is-child" : ""}" data-card="${c.id}">${c.context ? html`<div class="rc-context">${c.context}</div>` : ""}<header class="rc-head">${eyebrow(c.eyebrow)}<time class="rc-time" datetime="${new Date(c.at).toISOString()}">${hhmm(c.at)}</time></header><div class="rc-title${head.long ? " is-long" : ""}">${inline(head.title)}</div>${head.rest ? html`<div class="rc-text">${inline(head.rest)}</div>` : ""}${c.text ? html`<div class="rc-text">${inline(c.text)}</div>` : ""}${c.dice ? html`<div class="rc-dice">${c.dice}</div>` : ""}<div class="rc-actions">${follow}${notes}${table}</div>${children ? html`<div class="rc-children">${children}</div>` : ""}</article>`;
}
