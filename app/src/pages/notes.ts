// Play -> Notes: the Notes panel tab as a full page (this room's notes, Capture a moment, the session log).
// Both views share the saved notes and redraw when either changes them (panels/notes.ts).
import type { ToolContext } from "../main";
import { mountNotes } from "../shell/panels/notes";

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "notes-page");
  ctx.onDispose(mountNotes(root));
}
