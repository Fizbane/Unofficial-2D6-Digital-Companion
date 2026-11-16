// The character creator: one dialog with every choice on the left (class, weapon, manoeuvres, armour,
// scroll, expansions) and the character it makes on the right, updated as you go. Nothing is saved until
// "Create character". Options and their details come from the Core Rules and Tables Codex tables.
import type { Section } from "../types";
import { bookInfo } from "../content";
import { inline } from "../library";
import { html, type Raw, setHTML } from "./html";
import { icon, type IconName } from "./icon";
import { openModal } from "./modal";
import { portraitFromUrl } from "./picture";
import { PORTRAITS, portraitUrl } from "./portraits";
import { EXPANSION_NAMES, EXPANSIONS, levelsFor, stats, type Character, type Expansion } from "../tools/sheet";
import {
  armourOptions, averageDamage, blankDraft, buildCharacter, problems, randomDraft, scrollOptions, START_MANOEUVRES,
  toggleManoeuvre, weaponManoeuvres, WEAPONS, withWeapon, type Draft, type Manoeuvre,
} from "../tools/creatormodel";

type ById = ReadonlyMap<string, Section>;

const EXPANSION_NOTES: Record<Expansion, string> = {
  realm: "Marks this character as playing with the Realm. The Realm tool works either way.",
  lairs: "Turns on the Lairs rule in Combat: creatures below your level give no experience. The Lairs and Haunted House tools ask for it.",
  codex: "Marks this character as playing with the full Tables Codex. No rule changes in the app yet.",
  companions: "Adds an animal companion card to this character's sheet.",
  legendary: "Marks this character as playing the Legendary Dungeon. No rule changes in the app yet.",
};
const avg = (m: Manoeuvre): string => {
  const a = averageDamage(m.damage);
  return a === null ? "" : `about ${a % 1 ? a.toFixed(1) : a} on average`;
};

/** Open the creator. Resolves with the finished character, or null when it was cancelled. */
export function openCreator(byId: ById): Promise<Character | null> {
  return new Promise((resolve) => {
    let d: Draft = blankDraft();
    const unlocked = EXPANSIONS.filter((e) => bookInfo(e).unlocked);
    for (const e of unlocked) d.expansions[e] = true; // every book you own starts ticked
    const canConstable = bookInfo("lairs").unlocked;
    let result: Character | null = null;
    let busy = false;
    const tips = new Map<string, Raw>();
    let tipSeq = 0;
    const tip = (body: Raw): Raw => {
      const id = `t${++tipSeq}`;
      tips.set(id, body);
      return html`data-tip="${id}"`;
    };

    const m = openModal({
      labelledBy: "cc-title",
      cls: "modal-creator",
      body: html`<header class="cc-head">
          <div><div class="eyebrow">New character</div><h2 id="cc-title">Create your character</h2></div>
          <div class="cc-head-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-cc="random">${icon("dice", { size: 15 })}<span>Surprise me</span></button>
            <button type="button" class="btn btn-ghost btn-icon" data-cc="cancel" aria-label="Close">${icon("x", { size: 17 })}</button>
          </div>
        </header>
        <div class="cc-body"><div class="cc-choices"></div><aside class="cc-summary" aria-label="Your character so far"></aside></div>
        <div class="cc-pop" role="tooltip" hidden></div>`,
      dismissable: false, // a stray click outside must not throw the choices away; Esc and Cancel still close
      onClose: () => resolve(result),
    });
    m.card.addEventListener("keydown", (e) => {
      if (e.key === "Escape") m.close();
    });
    let picsOpen = false;
    const choices = m.card.querySelector<HTMLElement>(".cc-choices")!;
    const summary = m.card.querySelector<HTMLElement>(".cc-summary")!;
    const pop = m.card.querySelector<HTMLElement>(".cc-pop")!;

    // ---------- the choices ----------
    const opt = (key: string, on: boolean, body: Raw, tipBody: Raw) =>
      html`<button type="button" class="cc-opt${on ? " is-on" : ""}" data-k="${key}" aria-pressed="${String(on)}" ${tip(tipBody)}>${body}<span class="cc-check" aria-hidden="true">${on ? icon("check", { size: 14 }) : ""}</span></button>`;
    const section = (id: string, n: number, title: string, hint: string, done: boolean, body: Raw) =>
      html`<section class="cc-sec${done ? " is-done" : ""}" id="cc-${id}"><h3><span class="cc-num">${done ? icon("check", { size: 14 }) : n}</span>${title}<span class="cc-hint">${hint}</span></h3>${body}</section>`;

    function weaponTip(w: string): Raw {
      const all = weaponManoeuvres(byId, w);
      if (!all.length) return html`<p>You wield this weapon for the whole adventure.</p>`;
      return html`<p>You wield this weapon for the whole adventure. Its manoeuvres:</p>
        ${[1, 2, 3].map((l) => html`<p class="cc-pop-h">Level ${l}${l === 1 ? " (you start with two of these)" : ""}</p><ul>${all.filter((x) => x.level === l).map((x) => html`<li>${inline(x.dice)} ${x.name} <span class="muted">${x.damage}</span></li>`)}</ul>`)}`;
    }
    const best = (list: Manoeuvre[]) => list.reduce<Manoeuvre | null>((b, x) => ((averageDamage(x.damage) ?? 0) > (b ? (averageDamage(b.damage) ?? 0) : -1) ? x : b), null);

    function drawChoices() {
      tips.clear();
      tipSeq = 0;
      const l1 = weaponManoeuvres(byId, d.weapon).filter((x) => x.level === 1);
      const picked = d.manoeuvres.filter((n) => l1.some((x) => x.name === n)).length;
      const ladder = (cls: "adventurer" | "constable") => levelsFor(cls);
      let n = 0;
      const identity = section("who", ++n, "Who are you?", "A name, and a face if you like", !!d.name.trim(), html`
        <label class="cc-name">Name<input type="text" data-cc-name value="${d.name}" maxlength="80" autocomplete="off" placeholder="Your character's name" data-autofocus></label>
        ${canConstable ? html`<div class="cc-grid cc-grid-2">${(["adventurer", "constable"] as const).map((k) => opt(`cls:${k}`, d.cls === k,
          html`<span class="cc-opt-title">${k === "adventurer" ? "Adventurer" : "Constable"}</span><span class="cc-opt-sub">${k === "adventurer" ? "Delves the dungeon, its lairs and the realm" : "Keeps the town safe: the Haunted House"}</span>`,
          html`<p>${k === "adventurer" ? "The standard character, with ten levels." : "A town constable, with their own five-level ladder from your Lairs book. They never go down into dungeons or lairs."}</p>
            <ul>${ladder(k).map((L, i) => html`<li>Level ${i + 1} ${L.title} <span class="muted">${L.hp} HP${L.next === Infinity ? "" : ` · next at ${L.next} XP`}</span></li>`)}</ul>`))}</div>` : ""}
        <details class="cc-portraits"${d.portrait || picsOpen ? html` open` : ""}><summary>Portrait (optional)</summary><div class="cc-portrait-grid">
          ${PORTRAITS.map((p) => html`<button type="button" class="cc-portrait${d.portrait === p.id ? " is-on" : ""}" data-k="pic:${p.id}" aria-pressed="${String(d.portrait === p.id)}" title="${p.name}" aria-label="${p.name}"><img src="${portraitUrl(p.id)}" alt="" loading="lazy" width="48" height="48"></button>`)}
        </div></details>`);
      const weapon = section("weapon", ++n, "Weapon", "Choose one. You keep it for the whole adventure", !!d.weapon, html`<div class="cc-grid cc-grid-3">
        ${WEAPONS.map((w) => {
          const all = weaponManoeuvres(byId, w);
          const b1 = best(all.filter((x) => x.level === 1)), b3 = best(all.filter((x) => x.level === 3));
          return opt(`weapon:${w}`, d.weapon === w,
            html`<span class="cc-opt-title">${icon("swords", { size: 16 })} ${w}</span>
              ${b1 ? html`<span class="cc-opt-sub">Best opening hit: ${b1.name} (${b1.damage.replace(/\s*damage/i, "")})</span>` : ""}
              ${b3 ? html`<span class="cc-opt-sub">Later: ${b3.name} (${b3.damage.replace(/\s*damage/i, "")})</span>` : ""}`,
            weaponTip(w));
        })}</div>`);
      const mans = section("manoeuvres", ++n, "Manoeuvres", `Pick ${START_MANOEUVRES} of your weapon's level 1 manoeuvres`, picked === START_MANOEUVRES || (!!d.weapon && !l1.length),
        !d.weapon ? html`<p class="muted">Choose a weapon first.</p>`
        : !l1.length ? html`<p class="muted">The weapon table isn't available, so pick your manoeuvres on the sheet afterwards.</p>`
        : html`<div class="cc-grid cc-grid-2">${l1.map((x) => opt(`man:${x.name}`, d.manoeuvres.includes(x.name),
            html`<span class="cc-opt-title">${x.name}</span><span class="cc-opt-sub"><span class="cc-dice">${inline(x.dice)}</span> ${x.damage}</span>`,
            html`<p><strong>${x.name}</strong></p><p>You hit with this when your attack roll shows ${inline(x.dice)}. You can nudge the dice towards it with your Shift (+2 at level 1).</p><p>Damage: ${x.damage}${avg(x) ? `, ${avg(x)}` : ""}.</p><p class="muted">Dice sets close to each other are easier to shift between.</p>`))}</div>`);
      const armour = section("armour", ++n, "Armour", "Choose one starting piece", !!d.armour, html`<div class="cc-grid cc-grid-2">
        ${armourOptions(byId).map((a) => opt(`armour:${a.name}`, d.armour === a.name,
          html`<span class="cc-opt-title">${icon("shield", { size: 16 })} ${a.name}</span><span class="cc-opt-sub"><span class="cc-dice">${inline(a.dice)}</span> ${a.modifier}</span>`,
          html`<p><strong>${a.name}</strong></p><p>When an enemy's hit shows ${inline(a.dice)} on either die, this takes ${a.modifier.replace(/^-/, "").toLowerCase()} off. The four starting pieces differ only in which number they block.</p><p class="muted">You can wear up to three pieces, one per body part, as you find more.</p>`))}</div>`);
      const scroll = section("scroll", ++n, "Magic scroll", "Choose one. A scroll is used up when cast", !!d.scroll, html`<div class="cc-grid cc-grid-2">
        ${scrollOptions(byId).map((s) => opt(`scroll:${s.name}`, d.scroll === s.name,
          html`<span class="cc-opt-title">${icon("scroll", { size: 16 })} ${s.name}</span><span class="cc-opt-sub">${s.summary || s.effect}</span>`,
          html`<p><strong>Scroll of ${s.name}</strong></p>${s.description ? html`<p>${s.description}</p>` : ""}
            <dl class="kv">${[["Effect", s.effect], ["Lasts", s.duration], ["Orbit", s.orbit], ["Dispel", s.dispel], ["Fail modifier", s.fail]].filter((r) => r[1]).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
            <p class="muted">Cast it at the very start of a fight (the creature then attacks first) or outside combat.</p>`))}</div>`);
      const exp = unlocked.length ? section("expansions", ++n, "Expansions", "Books you own that this character plays with. You can change these later", true, html`<div class="cc-grid cc-grid-2">
        ${unlocked.map((e) => opt(`exp:${e}`, !!d.expansions[e], html`<span class="cc-opt-title">${EXPANSION_NAMES[e]}</span>`, html`<p><strong>${EXPANSION_NAMES[e]}</strong></p><p>${EXPANSION_NOTES[e]}</p>`))}</div>`) : "";
      setHTML(choices, html`${identity}${weapon}${mans}${armour}${scroll}${exp}`);
    }

    // ---------- the character so far ----------
    function drawSummary() {
      const c = buildCharacter(d, byId);
      const st = stats(c);
      const miss = problems(d, byId);
      const row = (ic: IconName, label: string, value: Raw | string, goto: string, missing = false) =>
        html`<button type="button" class="cc-row${missing ? " is-missing" : ""}" data-goto="${goto}">${icon(ic, { size: 15 })}<span class="cc-row-label">${label}</span><span class="cc-row-value">${value}</span></button>`;
      const fixed = (ic: IconName, label: string, value: Raw | string) =>
        html`<div class="cc-row is-fixed">${icon(ic, { size: 15 })}<span class="cc-row-label">${label}</span><span class="cc-row-value">${value}</span></div>`;
      const none = html`<em>not chosen</em>`;
      const mans = c.manoeuvres.filter((r) => r[0]);
      const exps = unlocked.filter((e) => d.expansions[e]).map((e) => EXPANSION_NAMES[e]);
      setHTML(summary, html`
        <div class="cc-id">
          <span class="cc-face">${d.portrait ? html`<img src="${portraitUrl(d.portrait)}" alt="" width="56" height="56">` : icon("user", { size: 28 })}</span>
          <div><div class="cc-id-name">${d.name.trim() || html`<em>Unnamed</em>`}</div><div class="muted">Level ${st.level} ${st.title} · ${d.cls === "constable" ? "Constable" : "Adventurer"}</div></div>
        </div>
        <div class="cc-stats">${[["HP", String(st.baseline)], ["Shift", `+${st.shift}`], ["Discipline", `+${st.disc}`], ["Precision", `+${st.prec}`]].map(([k, v]) => html`<div><strong>${v}</strong><span>${k}</span></div>`)}</div>
        ${row("swords", "Weapon", d.weapon || none, "weapon", !d.weapon)}
        ${row("zap", "Manoeuvres", mans.length ? html`${mans.map((r) => html`<span class="cc-line">${r[0]} <span class="muted">${inline(r[1])} ${r[2]}</span></span>`)}${mans.length < START_MANOEUVRES ? html`<span class="cc-line"><em>${START_MANOEUVRES - mans.length} more to pick</em></span>` : ""}` : none, "manoeuvres", miss.some((p) => p.startsWith("Pick")))}
        ${row("shield", "Armour", d.armour ? html`${c.armour[0][0]} <span class="muted">${inline(c.armour[0][1])} ${c.armour[0][2]}</span>` : none, "armour", !d.armour)}
        ${row("scroll", "Scroll", d.scroll ? html`${d.scroll} <span class="muted">${c.scrolls[0][3]}</span>` : none, "scroll", !d.scroll)}
        ${fixed("droplet", "Potion", html`${c.potions[0][0]} <span class="muted">${c.potions[0][1]}</span>`)}
        ${fixed("utensils", "Rations", String(c.rations))}
        ${fixed("backpack", "Gear", c.small)}
        ${fixed("coins", "Coins", "None to start")}
        ${unlocked.length ? row("book", "Expansions", exps.length ? exps.join(", ") : "None", "expansions") : ""}
        <div class="cc-foot">
          ${miss.length ? html`<ul class="cc-todo">${miss.map((p) => html`<li>${p}</li>`)}</ul>` : html`<p class="cc-ready">${icon("check", { size: 15 })} Ready. You can still change anything.</p>`}
          <div class="cc-actions">
            <button type="button" class="btn btn-ghost" data-cc="cancel"><span>Cancel</span></button>
            <button type="button" class="btn btn-primary" data-cc="create"${miss.length || busy ? html` disabled` : ""}><span>${busy ? "Creating…" : "Create character"}</span></button>
          </div>
        </div>`);
    }

    function redraw(focusKey?: string) {
      hideTip();
      drawChoices();
      drawSummary();
      if (focusKey) choices.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }

    // ---------- hover and focus popups ----------
    function showTip(el: HTMLElement) {
      const body = tips.get(el.dataset.tip ?? "");
      if (!body) return;
      setHTML(pop, body);
      pop.hidden = false;
      const r = el.getBoundingClientRect(), card = m.card.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      // beside the option when there is room (over the summary), else under or over it
      let left = r.right + 8, top = r.top;
      if (left + pw > card.right - 8) {
        left = Math.max(card.left + 8, Math.min(r.left, card.right - pw - 8));
        top = r.bottom + 6;
        if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      }
      top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    }
    function hideTip() {
      pop.hidden = true;
    }
    const tipTarget = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    choices.addEventListener("pointerover", (e) => { const t = tipTarget(e); if (t) showTip(t); });
    choices.addEventListener("pointerout", (e) => { if (tipTarget(e) && !(e.relatedTarget as HTMLElement | null)?.closest?.("[data-tip]")) hideTip(); });
    choices.addEventListener("focusin", (e) => { const t = tipTarget(e); if (t) showTip(t); else hideTip(); });
    choices.addEventListener("focusout", hideTip);
    choices.addEventListener("scroll", hideTip);
    choices.addEventListener("toggle", (e) => { if ((e.target as HTMLElement).matches(".cc-portraits")) picsOpen = (e.target as HTMLDetailsElement).open; }, true);

    // ---------- input ----------
    choices.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.ccName === undefined) return;
      d = { ...d, name: el.value };
      drawSummary(); // the choices stay as they are, so typing keeps its place
      choices.querySelector("#cc-who")?.classList.toggle("is-done", !!d.name.trim());
    });
    m.card.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>("[data-cc]")?.dataset.cc;
      if (act === "cancel") return m.close();
      if (act === "random") {
        d = randomDraft(d, byId);
        return redraw();
      }
      if (act === "create") {
        if (busy || problems(d, byId).length) return;
        busy = true;
        drawSummary();
        const c = buildCharacter(d, byId);
        if (d.portrait) {
          try {
            c.portrait = await portraitFromUrl(portraitUrl(d.portrait));
          } catch {
            /* the character is made without its picture; it can be set on the sheet */
          }
        }
        result = c;
        return m.close();
      }
      const goto = t.closest<HTMLElement>("[data-goto]")?.dataset.goto;
      if (goto) {
        const sec = choices.querySelector<HTMLElement>(`#cc-${goto}`);
        sec?.scrollIntoView({ block: "start", behavior: "smooth" });
        sec?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
        return;
      }
      const key = t.closest<HTMLElement>("[data-k]")?.dataset.k;
      if (!key) return;
      const i = key.indexOf(":");
      const kind = key.slice(0, i), val = key.slice(i + 1);
      if (kind === "cls") d = { ...d, cls: val === "constable" ? "constable" : "adventurer" };
      else if (kind === "weapon") d = withWeapon(d, val, byId);
      else if (kind === "man") d = toggleManoeuvre(d, val);
      else if (kind === "armour") d = { ...d, armour: val };
      else if (kind === "scroll") d = { ...d, scroll: val };
      else if (kind === "pic") d = { ...d, portrait: d.portrait === val ? "" : val };
      else if (kind === "exp") d = { ...d, expansions: { ...d.expansions, [val]: !d.expansions[val as Expansion] } };
      redraw(key);
    });

    redraw();
    choices.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  });
}
