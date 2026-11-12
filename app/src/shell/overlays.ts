// Is a menu, dialog or popover open? Shell-wide keys (Esc for drawers, / for search) leave those
// to handle their own keys. A popover that is not a menu or dialog marks itself data-popover-open.
const POPOVER = '[role="menu"], [role="dialog"], [data-popover-open]';

/** True when any menu, dialog or popover is on screen. */
export function popoverOpen(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(POPOVER)) if (el.getClientRects().length) return true;
  return false;
}

/** True when `t` is inside a menu, dialog or popover. */
export const inPopover = (t: EventTarget | null): boolean => !!(t as Element | null)?.closest?.(POPOVER);

/** Is `t` a text field (or contenteditable)? Shell-wide single-key shortcuts leave those alone. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!t) return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
