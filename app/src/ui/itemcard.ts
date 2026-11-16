// An item's card, shared by the Items page and both character sheets.
//   allItems()                 every item in the open books (itemsmodel.ts), worked out once per library change
//   itemCardBody(e, actions)   the card's markup (the Items page and the sheets' popup show the same thing)
//   itemTipAttrs(e)            data-tip attributes for the hover card (hovertip.ts)
//   itemLink(name, o)          a sheet line as a chip: hover for its card, click to open it, and (packs) an
//                              Equip toggle and a remove button
//   packChips(items, o)        a pack list (large slots, small items, treasure) as item chips, for both sheets
//   equipToggle(list, name)    equip or take off a carried item (taking off always works)
//   wireItemCards(root, o)     clicks on [data-item-card] open the card; "Open in the book" opens its section
import { inline, lib } from "../library";
import { bookLabel } from "../content";
import { catOf, itemEntries, type ItemEntry } from "../tools/itemsmodel";
import { canEquip, findItem, isEquipped, itemMods, modsText, toggleEquip, type Equipped } from "../tools/gear";
import { button } from "./components";
import { icon } from "./icon";
import { html, type Raw } from "./html";
import { openModal } from "./modal";

let cache: { sections: unknown; items: ItemEntry[] } | null = null;
/** Every item in the open books; worked out again only when the library changes. */
export function allItems(): ItemEntry[] {
  if (!cache || cache.sections !== lib.sections) cache = { sections: lib.sections, items: itemEntries(lib.sections) };
  return cache.items;
}

export const lookupItem = (name: string): ItemEntry | undefined => findItem(allItems(), name);

export function itemCardBody(e: ItemEntry, actions: Raw, id = "item-title"): Raw {
  const c = catOf(e.cat);
  const mods = modsText(itemMods(e));
  return html`<div class="item-full">
    <header class="item-full-head"><span class="item-ico">${icon(c.icon, { size: 26 })}</span><div><span class="eyebrow">${c.label} · ${bookLabel(e.book)} · p. ${e.page}</span><h3 id="${id}">${e.name}</h3></div>${e.cost ? html`<span class="item-cost item-full-cost">${e.cost}</span>` : ""}</header>
    ${e.text ? html`<p class="item-full-text">${inline(e.text)}</p>` : ""}
    ${e.lines.length ? html`<div class="item-full-lines">${e.lines.map(([k, v]) => html`<div class="ifl-row"><span class="ifl-k">${k}</span><span class="ifl-v">${inline(v)}</span></div>`)}</div>` : ""}
    ${mods && canEquip(e) ? html`<p class="item-full-found"><strong>When equipped</strong> ${mods}</p>` : ""}
    ${e.foundOn.length ? html`<p class="item-full-found"><strong>Turns up on</strong> ${e.foundOn.join(", ")}</p>` : ""}
    <div class="beast-full-actions">${actions}</div>
  </div>`;
}

/** The hover card's text: what it is, its details, and its bonuses. */
export function itemTipText(e: ItemEntry): string {
  const parts = [`${catOf(e.cat).label}${e.cost ? ` · ${e.cost}` : ""}`];
  if (e.text) parts.push(e.text);
  for (const [k, v] of e.lines.slice(0, 6)) parts.push(`${k}: ${v}`);
  const mods = canEquip(e) ? modsText(itemMods(e)) : "";
  if (mods) parts.push(`When equipped: ${mods}`);
  parts.push("Click for the full card.");
  return parts.join("\n");
}
export const itemTipAttrs = (e: ItemEntry | undefined): Raw =>
  e ? html` data-tip-title="${e.name}" data-tip="${itemTipText(e)}"` : html``;

export interface ItemLinkOpts {
  /** Show an Equip toggle (packs); `equipped` is its state. */
  equip?: { on: boolean; attrs: Raw };
  /** Markup for a remove button's data attributes. */
  remove?: Raw;
}
/** One carried item as a chip: its name opens its card (when the books have it), hover shows the details. */
export function itemLink(name: string, o: ItemLinkOpts = {}): Raw {
  const e = lookupItem(name);
  const label = e
    ? html`<button type="button" class="pack-chip-name is-linked" data-item-card="${name}"${itemTipAttrs(e)}>${name}</button>`
    : html`<span class="pack-chip-name" title="Not found in your open books">${name}</span>`;
  const equip = o.equip && (o.equip.on || (e && canEquip(e))) // offered for book items you can wear or wield; always shown once on
    ? html`<button type="button" class="pack-chip-eq${o.equip.on ? " is-on" : ""}" aria-pressed="${String(o.equip.on)}" title="${o.equip.on ? "Equipped: click to take it off" : "Not equipped: click to equip"}" ${o.equip.attrs}>${icon(o.equip.on ? "check" : "plus", { size: 12 })}<span>${o.equip.on ? "Equipped" : "Equip"}</span></button>`
    : "";
  const remove = o.remove ? html`<button type="button" class="pack-chip-x" aria-label="Remove ${name}" title="Remove" ${o.remove}>${icon("x", { size: 12 })}</button>` : "";
  return html`<span class="pack-chip${o.equip?.on ? " is-equipped" : ""}">${label}${equip}${remove}</span>`;
}

/**
 * A pack list as chips, shared by both sheets. `items` are the list's filled entries with their place in the list
 * (a large-item slot, or a line of the small-items text); `list` names the list for the remove button.
 * `equipable` says whether a line may show an Equip toggle at all (Void armour is worn from the Armour card).
 */
export function packChips(items: readonly { v: string; i: number }[], o: { list: string; equipped: readonly Equipped[] | undefined; equipable?: (name: string) => boolean }): Raw {
  return items.length
    ? html`<div class="pack-chips">${items.map(({ v, i }) => itemLink(v, {
        equip: o.equipable && !o.equipable(v) && !isEquipped(o.equipped, v) ? undefined : { on: isEquipped(o.equipped, v), attrs: html`data-equip="${v}"` },
        remove: html`data-pack-del="${o.list}|${i}"`,
      }))}</div>`
    : html`<p class="muted sheet-hint">Nothing yet.</p>`;
}

/**
 * Equip or take off a carried item: the new equipped list and a message for a toast. Null when it can't be
 * equipped (a potion, say). Taking an item off always works, whatever the books now say it is.
 */
export function equipToggle(list: readonly Equipped[] | undefined, name: string): { list: Equipped[]; msg: string } | null {
  const e = lookupItem(name);
  const on = !isEquipped(list, name);
  if (on && e && !canEquip(e)) return null;
  const mods = e ? modsText(itemMods(e)) : "";
  return { list: toggleEquip(list, name, e ? itemMods(e) : {}), msg: on ? `${name} equipped${mods ? `: ${mods}` : ""}.` : `${name} taken off.` };
}

/** Clicks on an item chip (or anything with data-item-card) open its card. */
export function wireItemCards(root: HTMLElement, o: { openTab(hash: string): void }): void {
  root.addEventListener("click", (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-item-card]");
    if (!t) return;
    const e = lookupItem(t.dataset.itemCard!);
    if (!e) return;
    ev.preventDefault();
    const m = openModal({
      labelledBy: "item-card-title",
      cls: "modal-item",
      body: itemCardBody(e, button("Open in the book", { icon: "book-open", variant: "ghost", attrs: html`data-item-book="${e.sectionId}"` }), "item-card-title"),
    });
    m.card.addEventListener("click", (x) => {
      const b = (x.target as HTMLElement).closest<HTMLElement>("[data-item-book]");
      if (!b) return;
      m.close();
      o.openTab(`#/s/${b.dataset.itemBook}`);
    });
  });
}
