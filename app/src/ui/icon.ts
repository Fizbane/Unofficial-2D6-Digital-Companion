// Lucide icons from the sprite at public/icons.svg (built by scripts/build-icons.mjs and inlined
// into the page by the shell, so <use href="#i-name"> resolves).
import { html, type Raw } from "./html";

export const ICON_NAMES = [
  "book", "swords", "key", "castle", "scroll", "settings", "search", "star", "star-filled",
  "map", "notebook", "user", "dice", "rotate-ccw", "plus", "x", "chevron-left", "chevron-right",
  "chevron-down", "panel-left", "panel-right", "palette", "image", "external-link", "pencil",
  "more-horizontal", "file-text", "trash", "download", "upload", "minus", "menu", "check",
  "shield", "skull", "trophy", "crosshair", "zap", "heart", "door-closed", "utensils", "arrow-down", "circle-x", "key-round",
  "arrow-up", "arrow-left-right", "compass", "calendar", "flag", "coins", "hammer", "landmark", "backpack", "wand-sparkles", "sun-moon", "type", "layout-grid", "crown", "droplet", "triangle-alert", "sparkles", "book-open", "gem", "hard-hat",
  "skip-back", "skip-forward", "pause", "play",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Inline SVG for an icon; decorative (aria-hidden) unless a label is given. */
export function icon(name: IconName, opts: { size?: number; label?: string } = {}): Raw {
  const size = opts.size ?? 18;
  const a11y = opts.label ? html`role="img" aria-label="${opts.label}"` : html`aria-hidden="true"`;
  return html`<svg class="icon" width="${size}" height="${size}" ${a11y}><use href="#i-${name}"></use></svg>`;
}
