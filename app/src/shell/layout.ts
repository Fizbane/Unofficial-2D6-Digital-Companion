// Pane widths, collapse flags, breakpoints and drawers for the shell grid, saved in
// "2d6:shell:layout". The pure helpers (isLayoutState, clampWidth, gridColumns, breakpointOf, …)
// are DOM-free; initLayout wires the DOM.
//   ≥1280px  wide:   tree and panel pinned (each collapsible, flags saved).
//   900–1279 mid:    tree pinned; the panel is an overlay opened from its tab icons, which stay
//                    on screen as a slim strip on the right edge.
//   <900px   narrow: rail + tree in a left drawer, panel in a right drawer, both over a scrim.
import { readState, writeState } from "./state";
import { isContext, type Context } from "./status";

export const LAYOUT_KEY = "2d6:shell:layout";
export const MIN_W = 200;
export const MAX_W = 480;
export const WIDE_MQ = "(min-width: 1280px)";
export const NARROW_MQ = "(max-width: 899px)";

/** Later tasks add fields (rail mode, panel tab…); unknown fields are kept as-is. */
export interface LayoutState {
  v: 1;
  tree: number;
  panel: number;
  treeCollapsed: boolean;
  panelCollapsed: boolean;
  [k: string]: unknown;
}

export const defaultLayout = (): LayoutState => ({ v: 1, tree: 280, panel: 340, treeCollapsed: false, panelCollapsed: false });

const isWidth = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function isLayoutState(v: unknown): v is LayoutState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as LayoutState;
  return s.v === 1 && isWidth(s.tree) && isWidth(s.panel) && typeof s.treeCollapsed === "boolean" && typeof s.panelCollapsed === "boolean";
}

export type RailMode = "library" | "play";
/** The saved rail mode; layouts saved before the rail existed (or with a bad value) mean Library. */
export const railMode = (s: LayoutState): RailMode => (s.rail === "play" ? "play" : "library");

/** The last dungeon/realm context used, for the top-bar status on other pages; null if none (or bad). */
export const lastContext = (s: LayoutState): Context | null => (isContext(s.lastContext) ? s.lastContext : null);

export type Breakpoint = "wide" | "mid" | "narrow";
export const breakpointOf = (width: number): Breakpoint => (width >= 1280 ? "wide" : width >= 900 ? "mid" : "narrow");

export const clampWidth = (w: number): number => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));

/** grid-template-columns for rail | tree | centre | panel. */
export function gridColumns(s: LayoutState, bp: Breakpoint = "wide"): string {
  if (bp === "narrow") return "0px 0px minmax(0, 1fr) 0px";
  const tree = s.treeCollapsed ? 0 : clampWidth(s.tree);
  if (bp === "mid") return `var(--rail-w) ${tree}px minmax(0, 1fr) var(--strip-w)`;
  const panel = s.panelCollapsed ? 0 : clampWidth(s.panel);
  return `var(--rail-w) ${tree}px minmax(0, 1fr) ${panel}px`;
}

export type Pane = "tree" | "panel";

export interface Layout {
  readonly state: LayoutState;
  readonly bp: Breakpoint;
  /** Is this pane on screen (pinned and expanded, or its overlay/drawer open)? */
  shown(pane: Pane): boolean;
  /** Show or hide a pane the way the current breakpoint does it; `collapsed` forces a state. */
  toggle(pane: Pane, collapsed?: boolean): void;
  /** Close an open drawer or overlay; returns false when there was none. */
  closeTransient(): boolean;
  /** Save extra fields (e.g. `rail`) alongside the widths and flags. */
  set(patch: Record<string, unknown>): void;
  /** Runs after any change to what is shown (toggle, breakpoint). */
  onChange(fn: () => void): () => void;
}

/** Apply the saved layout to `app`, add drag handles to the tree and panel edges, and track the breakpoint. */
export function initLayout(app: HTMLElement, tree: HTMLElement, panel: HTMLElement, rail: HTMLElement): Layout {
  const s = readState(LAYOUT_KEY, isLayoutState, defaultLayout);
  s.tree = clampWidth(s.tree);
  s.panel = clampWidth(s.panel);
  delete s.hideUI; // Hide UI was removed; an old saved `hideUI: true` is ignored
  const wideMq = window.matchMedia(WIDE_MQ);
  const narrowMq = window.matchMedia(NARROW_MQ);
  const bpNow = (): Breakpoint => (wideMq.matches ? "wide" : narrowMq.matches ? "narrow" : "mid");
  let bp = bpNow();
  let drawer: Pane | null = null; // narrow
  let overlay = false; // mid
  let opener: HTMLElement | null = null; // focus goes back here when a drawer or overlay closes
  const listeners = new Set<() => void>();

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.hidden = true;
  app.append(scrim);

  const shown = (pane: Pane): boolean => {
    if (pane === "tree") return bp === "narrow" ? drawer === "tree" : !s.treeCollapsed;
    return bp === "wide" ? !s.panelCollapsed : bp === "mid" ? overlay : drawer === "panel";
  };

  const apply = () => {
    app.style.gridTemplateColumns = gridColumns(s, bp);
    app.style.setProperty("--tree-w", `${clampWidth(s.tree)}px`);
    app.style.setProperty("--panel-w", `${clampWidth(s.panel)}px`);
    for (const b of ["wide", "mid", "narrow"] as const) app.classList.toggle(`bp-${b}`, bp === b);
    app.classList.toggle("tree-collapsed", s.treeCollapsed);
    app.classList.toggle("panel-collapsed", s.panelCollapsed);
    app.classList.toggle("overlay-open", bp === "mid" && overlay);
    app.classList.toggle("drawer-tree", bp === "narrow" && drawer === "tree");
    app.classList.toggle("drawer-panel", bp === "narrow" && drawer === "panel");
    scrim.hidden = !(bp === "narrow" && drawer);
    // closed drawers and the closed overlay are out of reach of Tab and screen readers
    const offTree = bp === "narrow" && drawer !== "tree";
    const offPanel = (bp === "narrow" && drawer !== "panel") || (bp === "wide" && s.panelCollapsed);
    rail.inert = offTree;
    tree.inert = offTree || (bp !== "narrow" && s.treeCollapsed);
    panel.inert = offPanel;
    for (const fn of [...listeners]) fn();
  };
  const save = () => writeState(LAYOUT_KEY, s);

  /** Focus into a just-opened drawer/overlay; remember where focus was. */
  const focusInto = (host: HTMLElement) => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = host.querySelector<HTMLElement>('[aria-selected="true"], button, a[href], input');
    target?.focus({ preventScroll: true });
  };
  const closeAll = () => {
    const had = drawer !== null || overlay;
    const active = document.activeElement;
    const inside = !active || active === document.body || [rail, tree, panel].some((el) => el.contains(active));
    drawer = null;
    overlay = false;
    if (had && inside && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
    return had;
  };

  const handle = (pane: Pane, host: HTMLElement) => {
    const h = document.createElement("div");
    h.className = `resize-handle resize-${pane}`;
    h.setAttribute("role", "separator");
    h.setAttribute("aria-orientation", "vertical");
    h.setAttribute("aria-label", pane === "tree" ? "Resize contents" : "Resize panel");
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX, startW = s[pane];
      h.setPointerCapture(e.pointerId);
      app.classList.add("resizing");
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        s[pane] = clampWidth(pane === "tree" ? startW + dx : startW - dx);
        app.style.gridTemplateColumns = gridColumns(s, bp);
        app.style.setProperty(`--${pane}-w`, `${s[pane]}px`);
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        app.classList.remove("resizing");
        save();
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    host.append(h);
  };
  handle("tree", tree);
  handle("panel", panel);

  const onBp = () => {
    const next = bpNow();
    if (next === bp) return;
    closeAll();
    bp = next;
    apply();
  };
  wideMq.addEventListener("change", onBp);
  narrowMq.addEventListener("change", onBp);
  window.addEventListener("resize", onBp); // some emulated viewports resize without a media-query change event
  scrim.addEventListener("click", () => {
    if (closeAll()) apply();
  });
  // the mid-width overlay closes on a click anywhere outside it (or its toggle buttons)
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (bp !== "mid" || !overlay) return;
      const t = e.target as Element | null;
      if (panel.contains(t as Node) || t?.closest?.("[data-panel-toggle]")) return;
      closeAll();
      apply();
    },
    true,
  );
  apply();

  const layout: Layout = {
    get state() {
      return s;
    },
    get bp() {
      return bp;
    },
    shown,
    toggle(pane, collapsed) {
      const hide = collapsed ?? shown(pane);
      if (bp === "wide" || (bp === "mid" && pane === "tree")) {
        const key = pane === "tree" ? "treeCollapsed" : "panelCollapsed";
        s[key] = hide;
        save();
      } else if (bp === "mid") {
        if (overlay === !hide) return;
        if (hide) closeAll();
        else {
          overlay = true;
          apply();
          return focusInto(panel);
        }
      } else if (hide) {
        if (drawer !== pane) return;
        closeAll();
      } else {
        if (drawer === pane) return;
        if (drawer) closeAll();
        drawer = pane;
        apply();
        return focusInto(pane === "tree" ? rail : panel);
      }
      apply();
    },
    closeTransient() {
      if (!closeAll()) return false;
      apply();
      return true;
    },
    set(patch) {
      Object.assign(s, patch);
      save();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return layout;
}
