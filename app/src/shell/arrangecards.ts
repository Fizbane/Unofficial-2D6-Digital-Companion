// Lets players rearrange the cards on a play page (Combat, Character sheet, Realm and their Void
// versions). An "Arrange" button in the page header turns on arrange mode: every card gets a bar with a
// grip (drag to move it), earlier/later buttons, and a half/full width toggle. The layout is saved per
// page. Cards are moved with CSS `order` and a width flag, never by moving elements, so the tools'
// own redraws (they rebuild the page's HTML) just get the saved arrangement applied again.
import { html, setHTML } from "../ui/html";
import { icon } from "../ui/icon";
import { readState, writeState } from "./state";

export type Span = "half" | "full";
interface GroupLayout { order: string[]; span: Record<string, Span> }
export interface CardLayout { v: 1; groups: Record<string, GroupLayout> }
const EMPTY: CardLayout = { v: 1, groups: {} };

const isLayout = (v: unknown): v is CardLayout => {
  const o = v as Partial<CardLayout> | null;
  return !!o && o.v === 1 && typeof o.groups === "object" && o.groups !== null;
};

/** The cards' ids in their new order: saved order first (ones that still exist), new cards after. */
export function orderIds(natural: string[], saved: string[] | undefined): string[] {
  const have = new Set(natural);
  const kept = (saved ?? []).filter((id) => have.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...natural.filter((id) => !keptSet.has(id))];
}

/** Move `id` one place earlier (-1) or later (1) in `ids`. */
export function nudge(ids: string[], id: string, d: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = ids.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Move `id` to sit where `target` is (dragging). */
export function moveTo(ids: string[], id: string, target: string): string[] {
  const i = ids.indexOf(id);
  const j = ids.indexOf(target);
  if (i < 0 || j < 0 || i === j) return ids;
  const out = ids.slice();
  out.splice(i, 1);
  out.splice(j, 0, id);
  return out;
}

interface Group { gid: string; el: HTMLElement; cards: HTMLElement[]; ids: string[] }

/** Containers holding two or more cards as direct children (not inside another card). */
function findGroups(root: HTMLElement): Group[] {
  const out: Group[] = [];
  const seen = new Map<string, number>();
  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    if (el !== root && el.parentElement?.closest(".card") && el.closest(".card") !== el) continue;
    if (el.classList.contains("card")) continue;
    const cards = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.matches("section.card, .card"));
    if (cards.length < 2) continue;
    const base = el === root ? "page" : el.classList[0] ?? el.tagName.toLowerCase();
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const used = new Map<string, number>();
    const ids = cards.map((c, i) => {
      const t = c.dataset.arrange ?? c.querySelector(":scope > .card-head .card-title")?.textContent?.trim() ?? `card-${i + 1}`;
      const k = used.get(t) ?? 0;
      used.set(t, k + 1);
      return k ? `${t}#${k + 1}` : t;
    });
    out.push({ gid: n ? `${base}#${n + 1}` : base, el, cards, ids });
  }
  return out;
}

/**
 * Make the cards of `root` arrangeable. `key` is where the layout is saved. Call once after the first
 * draw (it keeps itself up to date as the tool redraws) and again never; it stops with the page.
 */
export function makeCardsArrangeable(root: HTMLElement, key: string, onDispose: (fn: () => void) => void): void {
  let layout: CardLayout = readState(key, isLayout, () => ({ ...EMPTY, groups: {} }));
  let editing = false;
  let applying = false;

  const save = () => writeState(key, layout);
  const groupLayout = (gid: string): GroupLayout => (layout.groups[gid] ??= { order: [], span: {} });

  function apply() {
    if (applying) return;
    applying = true;
    obs.disconnect();
    try {
      root.classList.toggle("is-arranging", editing);
      const groups = findGroups(root);
      for (const g of groups) {
        const gl = layout.groups[g.gid];
        const grid = getComputedStyle(g.el).display === "grid";
        if (!grid) g.el.classList.add("arr-flow");
        const order = orderIds(g.ids, gl?.order);
        // children keep their slots: the cards fill the card slots in the new order
        const slots = g.cards.map((c) => Array.prototype.indexOf.call(g.el.children, c) as number);
        Array.from(g.el.children).forEach((c, i) => ((c as HTMLElement).style.order = String(i)));
        order.forEach((id, k) => {
          const c = g.cards[g.ids.indexOf(id)];
          c.style.order = String(slots[k]);
        });
        g.cards.forEach((c, i) => {
          const id = g.ids[i];
          if (!c.dataset.arrDefault) c.dataset.arrDefault = grid && c.dataset.span !== "2" ? "half" : "full";
          const span = gl?.span[id] ?? (c.dataset.arrDefault as Span);
          c.dataset.arrSpan = span;
          c.querySelector(":scope > .arr-bar")?.remove();
          if (editing) c.prepend(bar(g, id, order, span));
        });
      }
      toggle(groups.length > 0);
    } finally {
      obs.takeRecords();
      obs.observe(root, { childList: true, subtree: true });
      applying = false;
    }
  }

  function bar(g: Group, id: string, order: string[], span: Span): HTMLElement {
    const el = document.createElement("div");
    el.className = "arr-bar";
    const pos = order.indexOf(id);
    const full = span === "full";
    setHTML(el, html`<button type="button" class="arr-grip" title="Drag to move this box" aria-label="Move ${id}: drag, or use the arrows">${icon("menu", { size: 14 })}</button>
      <button type="button" class="arr-btn" data-d="-1" title="Move earlier" aria-label="Move ${id} earlier" ${pos <= 0 ? "disabled" : ""}>${icon("chevron-left", { size: 14 })}</button>
      <button type="button" class="arr-btn" data-d="1" title="Move later" aria-label="Move ${id} later" ${pos >= order.length - 1 ? "disabled" : ""}>${icon("chevron-right", { size: 14 })}</button>
      <button type="button" class="arr-span" title="${full ? "Make this box half width" : "Make this box full width"}" aria-pressed="${String(full)}">${full ? "Full" : "Half"}</button>`);
    el.querySelectorAll<HTMLButtonElement>(".arr-btn").forEach((b) =>
      b.addEventListener("click", () => {
        groupLayout(g.gid).order = nudge(order, id, Number(b.dataset.d) as -1 | 1);
        save();
        apply();
      }),
    );
    el.querySelector(".arr-span")!.addEventListener("click", () => {
      groupLayout(g.gid).span[id] = span === "full" ? "half" : "full";
      groupLayout(g.gid).order = order;
      save();
      apply();
    });
    el.querySelector<HTMLButtonElement>(".arr-grip")!.addEventListener("pointerdown", (e) => drag(e, g, id));
    return el;
  }

  function drag(e: PointerEvent, g: Group, id: string) {
    e.preventDefault();
    const card = g.cards[g.ids.indexOf(id)];
    card.classList.add("is-dragging");
    let order = orderIds(g.ids, layout.groups[g.gid]?.order);
    const move = (ev: PointerEvent) => {
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => g.cards.includes(n as HTMLElement)) as HTMLElement | undefined;
      if (!under || under === card) return;
      const next = moveTo(order, id, g.ids[g.cards.indexOf(under)]);
      if (next === order) return;
      order = next;
      groupLayout(g.gid).order = order;
      apply();
      // the bars were rebuilt: keep dragging the same card
      g.cards[g.ids.indexOf(id)].classList.add("is-dragging");
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      card.classList.remove("is-dragging");
      save();
      apply();
    };
    // on the document: the bars are rebuilt as the card moves, which would drop the grip's own events
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }

  /** The Arrange / Reset buttons in the page header (the tools rebuild the header, so this re-adds them). */
  function toggle(any: boolean) {
    const head = root.querySelector<HTMLElement>(".play-head");
    if (!head || !any) return;
    let box = head.querySelector<HTMLElement>(".arr-controls");
    if (!box) {
      box = document.createElement("div");
      box.className = "arr-controls";
      (head.querySelector(".play-actions") ?? head).append(box);
    }
    setHTML(box, html`${editing ? html`<button type="button" class="btn btn-ghost" data-arr="reset" title="Put every box back where it started">${icon("rotate-ccw", { size: 17 })}<span>Reset layout</span></button>` : ""}
      <button type="button" class="btn ${editing ? "btn-primary" : "btn-ghost"}" data-arr="toggle" aria-pressed="${String(editing)}" title="Move and resize the boxes on this page">${icon(editing ? "check" : "layout-grid", { size: 17 })}<span>${editing ? "Done" : "Arrange"}</span></button>`);
  }

  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-arr]");
    // (no root.contains check: a tool's own click handler may already have redrawn the page, detaching the button)
    if (!b) return;
    if (b.dataset.arr === "toggle") editing = !editing;
    else if (b.dataset.arr === "reset") {
      layout = { v: 1, groups: {} };
      save();
      root.querySelectorAll<HTMLElement>("[data-arr-span]").forEach((c) => c.removeAttribute("data-arr-span"));
    } else return;
    apply();
  });

  const obs = new MutationObserver(() => apply());
  onDispose(() => obs.disconnect());
  apply();
}

