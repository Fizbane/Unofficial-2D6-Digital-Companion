// Escape-by-default HTML. Book text comes from the owner's PDF (OCR) and from Claude-filled packs, so
// every string the UI renders is untrusted. Markup is built with the `html` tagged template, which
// escapes each interpolated value unless it is already `Raw` (markup made by `html` itself), and it
// reaches the page only through `setHTML`, the one audited place that assigns `innerHTML`.
// `raw()` marks a string as markup without escaping it: for audited helpers only (nohtml.test.ts
// counts every use).

/** Escape text for an HTML text or quoted-attribute context (& < > " '). Null-safe. */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let make: (h: string) => Raw;

/** Markup that is safe to render: built by `html` (or `raw`). Stringifies to its HTML. */
export class Raw {
  readonly #h: string;
  private constructor(h: string) {
    this.#h = h;
  }
  toString(): string {
    return this.#h;
  }
  static {
    make = (h) => new Raw(h);
  }
}

/** A value `html` accepts: text and numbers are escaped, `Raw` is kept, arrays are joined, nothing renders as "". */
export type HtmlValue = Raw | string | number | false | null | undefined | readonly HtmlValue[];

function render(v: HtmlValue): string {
  if (v instanceof Raw) return v.toString();
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

/** `html\`<b>${text}</b>\``: markup with every interpolation escaped (a nested `Raw` is kept as is). */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return make(out);
}

/** Mark a trusted string as markup without escaping it. Audited helpers only. */
export const raw = (s: string): Raw => make(s);

/** Join a list of markup with a separator (the separator is escaped like any text). */
export const joinHtml = (list: readonly HtmlValue[], sep: HtmlValue = ""): Raw =>
  make(list.map(render).join(render(sep)));

/**
 * A colour for a style attribute: `v` if it is a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa), else
 * `fallback`. Escaping keeps markup out of an attribute, but not CSS out of a style: stored colours
 * (settings, an imported backup) go through this.
 */
export const cssColor = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : fallback;

/** The one place that assigns `innerHTML`. Throws on anything that isn't `Raw`. */
export function setHTML(el: Element, h: Raw): void {
  if (!(h instanceof Raw)) throw new TypeError("setHTML takes Raw markup from html``");
  el.innerHTML = h.toString();
}

declare global {
  interface Array<T> {
    /** Joining markup with `.join` gives a plain string that `html` would escape: use html`${list}` or joinHtml. */
    join(this: Raw[], separator?: string): { readonly "use html`${list}` or joinHtml, not .join": never };
  }
  interface ReadonlyArray<T> {
    join(this: readonly Raw[], separator?: string): { readonly "use html`${list}` or joinHtml, not .join": never };
  }
}
