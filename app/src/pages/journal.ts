// Play -> Journal: the Journal panel tab as a full page, the story of the run with room pictures, editing,
// Write… and Export. It shares the journal with the panel tab (panels/journal.ts), and like it, rebuilds
// only while it is the tab on screen.
import type { ToolContext } from "../main";
import { mountJournal } from "../shell/panels/journal";

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "journal-page");
  const scroller = () => root.closest<HTMLElement>(".tab-page");
  const shows: (() => void)[] = [];
  const visible = () => root.isConnected && root.offsetParent !== null;
  let wasVisible = true;
  const off = ctx.events.on("tabs:changed", () => {
    const now = visible();
    if (now && !wasVisible) shows.forEach((fn) => fn());
    wasVisible = now;
  });
  ctx.onDispose(off);
  ctx.onDispose(mountJournal(root, { openTab: (r) => ctx.openTab(r), toast: ctx.toast }, {
    visible,
    onShow: (fn) => void shows.push(fn),
    scroller,
  }));
}
