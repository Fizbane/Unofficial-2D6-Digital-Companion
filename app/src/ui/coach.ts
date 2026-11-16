// The gameplay coach: a card pinned to the bottom of the screen that walks through a script of steps on the real
// play tools. Each step says what to do and why, outlines the control to use, links the rules it teaches (they
// open in a new tab, so the tool stays where it is), and moves on by itself once the step is done. Game-agnostic:
// a script (tutorial/void.ts) supplies the steps; the sandbox (tutorial/session.ts) holds the progress.
//
// Unlike the site tour this isn't a dialog: the page behind stays fully usable (no focus trap, no Esc), and the
// card can be folded down to a small bar while you read or play.
import { clearRig, rig, type RigEntry } from "../dice/rig";
import { bus } from "../shell/events";
import { button } from "./components";
import { makeDraggable } from "./drag";
import { icon } from "./icon";
import { html, setHTML, type Raw } from "./html";

export interface CoachRule {
  /** Our own words for the link ("Making a survivor"), never a book heading. */
  label: string;
  /** The book section id ("void/p9-1"). */
  section: string;
}

export interface CoachStep {
  id: string;
  title: string;
  /** Plain sentences; no markup. */
  body: string[];
  rules?: CoachRule[];
  /** The tab this step happens on; it is opened (or brought forward) when the step starts. */
  route?: string;
  /** CSS selector of the control to outline; the first visible match is used. */
  target?: string;
  /** The step is done (checked after every play event); without it the step waits for Next. */
  done?: () => boolean;
  /** Scripted dice armed while this step is the current one. */
  rig?: () => RigEntry[];
}

export interface CoachScript {
  id: string;
  name: string;
  steps: readonly CoachStep[];
  /** What this game calls the tutorial's character in the card's own buttons ("survivor" when not given). */
  who?: string;
  /** Saved state the tutorial character starts with (roster keys such as "play:character"); none means a blank one. */
  seed?: () => Promise<Record<string, unknown>>;
}

export interface CoachHost {
  openTab(route: string, opts?: { newTab?: boolean }): void;
  /** The step reached changed (save it). */
  onStep(i: number): void;
  /** Finished: `keep` is true when the player keeps the tutorial survivor. */
  onFinish(keep: boolean): void;
  /** Ended early with "End tutorial". */
  onQuit(): void;
}

export const ruleHref = (section: string): string => `#/s/${encodeURIComponent(section)}`;

/** The card's markup for step `i` (pure, for tests). */
export function coachBody(script: CoachScript, i: number, o: { folded?: boolean; confirmQuit?: boolean } = {}): Raw {
  const n = script.steps.length;
  const s = script.steps[i];
  const last = i === n - 1;
  const waiting = !!s.done && !last;
  const who = script.who ?? "survivor";
  const head = html`<div class="coach-head drag-handle" data-drag-handle title="Drag to move this card. Double-click to put it back.">
      <p class="tour-step">${icon("grip-vertical", { size: 14 })} ${script.name} · ${i + 1} of ${n}</p>
      <button type="button" class="btn btn-sm btn-ghost coach-fold" data-coach-act="fold" aria-expanded="${o.folded ? "false" : "true"}" aria-label="${o.folded ? "Show the tutorial" : "Fold the tutorial down"}" title="${o.folded ? "Show the tutorial" : "Fold the tutorial down"}">${icon(o.folded ? "arrow-up" : "chevron-down", { size: 15 })}</button>
    </div>`;
  if (o.folded) return html`${head}<h2 id="coach-title" class="coach-title-sm">${s.title}</h2>`;
  const rules = s.rules?.length
    ? html`<div class="coach-rules"><span class="coach-rules-label">${icon("book-open", { size: 14 })} Rules</span>${s.rules.map((r) => html`<a class="coach-rule" href="${ruleHref(r.section)}" data-coach-rule="${r.section}">${r.label}</a>`)}</div>`
    : "";
  const actions = o.confirmQuit
    ? html`<p class="coach-confirm">End the tutorial? Your tutorial ${who} is deleted and you go back to your own character.</p>
      <div class="step-actions">${button("End tutorial", { variant: "primary", attrs: html`data-coach-act="quit-yes"` })}${button("Carry on", { variant: "ghost", attrs: html`data-coach-act="quit-no"` })}</div>`
    : last
      ? html`<div class="step-actions">${i > 0 ? button("Back", { variant: "ghost", attrs: html`data-coach-act="back"` }) : ""}
        ${button("Finish and go back to my character", { variant: "primary", attrs: html`data-coach-act="finish"` })}
        ${button(`Keep this ${who}`, { variant: "ghost", attrs: html`data-coach-act="keep"` })}</div>`
      : html`<div class="step-actions">${i > 0 ? button("Back", { variant: "ghost", attrs: html`data-coach-act="back"` }) : ""}
        ${button(waiting ? "Skip ahead" : "Next", { variant: waiting ? "ghost" : "primary", attrs: html`data-coach-act="next"` })}
        ${button("End tutorial", { variant: "ghost", attrs: html`data-coach-act="quit"` })}</div>`;
  return html`${head}<h2 id="coach-title">${s.title}</h2>
    ${s.body.map((p) => html`<p>${p}</p>`)}
    ${waiting ? html`<p class="coach-wait">${icon("compass", { size: 14 })} Do this on the page and the tutorial carries on by itself.</p>` : ""}
    ${rules}${actions}`;
}

let running: { stop(): void } | null = null;

/** Show the coach for `script` from step `from`. Returns a handle to take it down. */
export function startCoach(script: CoachScript, from: number, host: CoachHost): { stop(): void } {
  running?.stop();
  let i = Math.max(0, Math.min(from, script.steps.length - 1));
  let folded = false;
  let confirmQuit = false;
  let spot: Element | null = null;
  let stopped = false;

  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop modal-tour coach-wrap";
  const card = document.createElement("section");
  card.className = "modal-card coach-card";
  card.setAttribute("role", "region");
  card.setAttribute("aria-labelledby", "coach-title");
  card.setAttribute("aria-live", "polite");
  wrap.append(card);
  document.body.append(wrap);
  const undrag = makeDraggable(card, "coach"); // the card can cover the control a step is about

  const unspot = () => {
    spot?.classList.remove("tour-spot");
    spot = null;
  };
  const findTarget = (): HTMLElement | null => {
    const sel = script.steps[i].target;
    if (!sel) return null;
    return [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.getClientRects().length > 0) ?? null;
  };
  /** Outline the step's control (tools redraw often, so this runs after each event). */
  const respot = (scroll = false) => {
    const el = findTarget();
    if (el === spot && el?.classList.contains("tour-spot")) return;
    unspot();
    if (!el) return;
    spot = el;
    el.classList.add("tour-spot");
    if (scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const draw = () => {
    setHTML(card, coachBody(script, i, { folded, confirmQuit }));
    card.classList.toggle("is-folded", folded);
  };
  /** Enter step i: open its tab, arm its dice, save progress. */
  const enter = () => {
    const s = script.steps[i];
    confirmQuit = false;
    clearRig();
    const r = s.rig?.();
    if (r?.length) rig(r);
    host.onStep(i);
    if (s.route && normal(location.hash) !== s.route) host.openTab(s.route, { newTab: true });
    draw();
    unspot();
    setTimeout(() => respot(true), 60);
  };
  /** Move past every step that is already done (after a play event, or when resuming). */
  const advance = () => {
    let moved = false;
    while (i < script.steps.length - 1 && script.steps[i].done?.()) {
      i++;
      moved = true;
    }
    if (moved) enter();
  };

  card.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const link = t.closest<HTMLAnchorElement>("a[data-coach-rule]");
    if (link) {
      e.preventDefault();
      host.openTab(ruleHref(link.dataset.coachRule!), { newTab: true });
      return;
    }
    const act = t.closest<HTMLElement>("[data-coach-act]")?.dataset.coachAct;
    if (!act) return;
    if (act === "fold") {
      folded = !folded;
      draw();
    } else if (act === "next" && i < script.steps.length - 1) {
      i++;
      enter();
      advance();
    } else if (act === "back" && i > 0) {
      i--;
      enter();
    } else if (act === "quit") {
      confirmQuit = true;
      folded = false;
      draw();
    } else if (act === "quit-no") {
      confirmQuit = false;
      draw();
    } else if (act === "quit-yes") {
      stop();
      host.onQuit();
    } else if (act === "finish" || act === "keep") {
      stop();
      host.onFinish(act === "keep");
    }
  });

  const later = () => setTimeout(() => {
    if (stopped) return;
    advance();
    respot();
  }, 30);
  const offs = [
    bus.on("void:changed", later),
    bus.on("dungeon:changed", later),
    bus.on("character:changed", later),
    bus.on("combat:changed", later),
    bus.on("journal:room", later),
    bus.on("journal:fight", later),
    bus.on("journal:door", later),
    bus.on("dice:rolled", later),
    bus.on("tabs:changed", later),
  ];
  // tools also redraw on clicks and inputs that emit nothing: keep the outline on the live element
  const onClick = () => setTimeout(() => !stopped && respot(), 120);
  document.addEventListener("click", onClick, true);

  function stop() {
    if (stopped) return;
    stopped = true;
    for (const off of offs) off();
    document.removeEventListener("click", onClick, true);
    unspot();
    clearRig();
    undrag();
    wrap.remove();
    if (running === handle) running = null;
  }
  const handle = { stop };
  running = handle;
  enter();
  advance();
  return handle;
}

const normal = (hash: string): string => (hash || "#/").replace(/\?.*$/, "");
