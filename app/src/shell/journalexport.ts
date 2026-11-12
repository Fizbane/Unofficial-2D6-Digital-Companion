// "Export journal": the whole journal as one standalone, printable HTML page (chapters, entries,
// the player's own words and the room pictures inlined as SVG). DOM-free: returns the page text.
import { journalView, type JournalChapter, type JournalEntry, type JournalState } from "./journalmodel";
import { entryStory } from "./journalprose";
import { renderSnap, type MapSnap } from "./journalsnap";
import { html, joinHtml, type Raw } from "../ui/html";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "11 Nov 2026, 14:05" (local time). */
export function entryDate(at: number): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const chapterTitle = (c: JournalChapter) => `Chapter ${c.n} — Level ${c.level}, ${c.date}`;

const paras = (text: string) => html`${text.split(/\n{2,}/).map((p) => html`<p>${joinHtml(p.split("\n"), html`<br>`)}</p>`)}`;

function entryHtml(e: JournalEntry, draw: (s: MapSnap, id: string) => Raw, nested = false): Raw {
  const st = entryStory(e);
  const pic = e.kind === "room" && e.snap ? html`<figure class="pic">${draw(e.snap, `x${e.id.replace(/\W/g, "")}`)}</figure>` : "";
  return html`<article class="entry entry-${e.kind}${nested ? " nested" : ""}">
    <header><h3>${st.heading}</h3><time>${entryDate(e.at)}</time></header>
    ${pic}<div class="story">${paras(st.body)}</div>
    ${e.addition ? html`<div class="own">${paras(e.addition)}</div>` : ""}`;
}

/** The printable page, as text for the download. `draw` renders a room picture (the live map renderer by default). */
export function exportJournalHtml(s: JournalState, draw: (snap: MapSnap, id: string) => Raw = renderSnap): string {
  const view = journalView(s);
  const chapters = joinHtml(view
    .map(
      (c) => html`<section class="chapter"><h2>${chapterTitle(c.chapter)}</h2>
      ${joinHtml(c.entries.map((v) => html`${entryHtml(v.entry, draw)}${v.fights.map((f) => html`${entryHtml(f, draw, true)}</article>`)}</article>`), "\n")}
    </section>`,
    ), "\n");
  return String(html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>2D6 Journal</title>
<style>
  body { margin: 0 auto; max-width: 42rem; padding: 2rem 1.25rem; color: #241f18; background: #fbf8f1;
    font-family: "Crimson Pro", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; font-size: 12pt; line-height: 1.5; }
  h1 { font-size: 2rem; margin: 0 0 1.5rem; text-align: center; letter-spacing: .02em; }
  h2 { font-size: 1.5rem; margin: 0 0 1rem; border-bottom: 1px solid #c9bea8; padding-bottom: .3rem; }
  .chapter { page-break-before: always; break-before: page; }
  .chapter:first-of-type { page-break-before: auto; break-before: auto; }
  .entry { margin: 0 0 1.25rem; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
  .entry header { display: flex; align-items: baseline; gap: .75rem; }
  .entry h3 { font-size: 1.1rem; font-style: italic; margin: 0; flex: 1; }
  .entry time { color: #6f6556; font-size: .8rem; white-space: nowrap; }
  .entry p { margin: .35rem 0; }
  .nested { margin: .5rem 0 0 1.25rem; padding-left: .75rem; border-left: 2px solid #d9cfbb; }
  .nested h3 { font-size: 1rem; }
  .pic { float: right; width: 11rem; margin: .4rem 0 .5rem 1rem; }
  .pic svg { display: block; width: 100%; height: auto; border-radius: 6px; }
  .own { font-style: italic; color: #3d3427; }
  .empty { text-align: center; color: #6f6556; }
  @media print { body { background: none; padding: 0; } }
</style></head>
<body><h1>Journal</h1>
${view.length ? chapters : html`<p class="empty">The journal is empty.</p>`}
</body></html>
`);
}
