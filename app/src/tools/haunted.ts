// The Haunted House play tool (a Dungeon adventure for a level 1 constable, from the Lairs book): Fear
// Points and their effects, haunted doors, the three levels' room tables, creatures, search tables and Magic
// banes. Rules and tables are read from the owner's imported book; only section ids live in code.
import type { ToolContext } from "../main";
import { getContent, type Locked } from "../content";
import { rollDice } from "../dice3d";
import { bus } from "../shell/events";
import { load, save } from "./common";
import { button, card, eyebrow } from "../ui/components";
import { html, type Raw, setHTML } from "../ui/html";
import { classOf, hasExpansion, loadChar, saveChar } from "./sheet";
import { noteHtml, rollNote, type Note } from "./rollnote";
import { activeFears, brokenByFear, clampFear, doorIsHaunted, FEAR_MAX, HOUSE, roomTableFor } from "./hauntedmodel";

interface State {
  level: number; // 1, 2, or 3 (the loft)
  fear: number;
  banes: string[];
  rooms: [number, number]; // rooms explored on levels 1 and 2
  loftCleared: boolean;
  note: Note | null;
}
const fresh = (): State => ({ level: 1, fear: 0, banes: [], rooms: [0, 0], loftCleared: false, note: null });

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "haunted-page");
  let s: State = load<State>("haunted", fresh());
  s.fear = clampFear(s.fear);
  if (!Array.isArray(s.banes)) s.banes = [];
  if (!Array.isArray(s.rooms) || s.rooms.length !== 2) s.rooms = [0, 0];
  let lockedNote: Locked | null = null;
  let live = true;
  ctx.onDispose(() => (live = false));
  const persist = () => {
    if (live) save("haunted", s);
  };
  const titleOf = (id: string) => ctx.byId.get(id)?.title?.trim() || id;
  const fearRows = (): string[][] => {
    const c = getContent(HOUSE.fear);
    const t = c?.ok ? c.section.blocks.find((b) => b.type === "table") : undefined;
    return t && t.type === "table" ? t.table.rows : [];
  };
  const addFear = (n: number, why: string) => {
    const before = s.fear;
    s.fear = clampFear(s.fear + n);
    if (s.fear !== before) ctx.toast(`${why}: Fear ${s.fear} of ${FEAR_MAX}.${brokenByFear(s.fear) ? " You flee the house." : ""}`);
  };

  async function roll(id: string, after?: (n: Note) => void) {
    const r = await rollNote(id, "Haunted House");
    if (!live) return;
    if (!r) return ctx.toast("That table isn't in your imported book.");
    if ("locked" in r) lockedNote = r.locked;
    else {
      lockedNote = null;
      s.note = r;
      after?.(r);
      persist();
    }
    draw();
  }

  /** The book's sections as paragraphs (tables skipped). */
  const prose = (id: string): Raw => {
    const c = getContent(id);
    if (!c?.ok) return html``;
    return html`${c.section.blocks.map((b) => (b.type === "para" ? html`<p>${ctx.inline(b.text)}</p>` : b.type === "heading" ? html`<h4>${b.text}</h4>` : ""))}`;
  };

  function draw() {
    const c = loadChar();
    const broken = brokenByFear(s.fear);
    const effects = activeFears(fearRows(), s.fear);
    const levelName = (n: number) => (n === 3 ? "Loft" : `Level ${n}`);
    const who = classOf(c) === "constable"
      ? ""
      : card(html`<p>The Haunted House is played by a constable, not an adventurer. Make a new character and choose the Constable class to play it as written.</p>`, { eyebrow: "Character", title: "This character is an adventurer" });
    const gate = hasExpansion(c, "lairs") ? "" : card(html`<p>This character doesn't play with the Lairs expansion.</p>
      <div class="step-actions">${button("Enable Lairs for this character", { icon: "check", variant: "primary", attrs: html`data-act="enable"` })}</div>`, { eyebrow: "Character", title: "Lairs not enabled" });

    const fear = card(html`
      <p class="haunted-fear${broken ? " is-broken" : ""}"><strong>${s.fear}</strong> / ${FEAR_MAX} Fear</p>
      ${broken ? html`<p class="warn">Fear has reached ten: you crack and flee the house. This attempt has failed.</p>` : ""}
      <div class="step-actions">
        ${button("Gain 1", { size: "sm", icon: "plus", attrs: html`data-fear="1"` })}
        ${button("Lose 1", { size: "sm", icon: "minus", attrs: html`data-fear="-1"` })}
        ${button("Made a noise (+1)", { size: "sm", icon: "triangle-alert", attrs: html`data-act="noise"` })}
      </div>
      ${effects.length ? html`<ol class="haunted-effects">${effects.map((e) => html`<li value="${e.n}">${ctx.inline(e.effect)}</li>`)}</ol>` : html`<p class="muted">No Fear effects yet.</p>`}`,
      { eyebrow: "Fear Sheet", title: "Fear" });

    const doors = card(html`<p class="muted sheet-hint">Each time you use a door, roll a D6: on 5 or 6 something strange happens. No roll when backtracking.</p>
      <div class="step-actions">${button("Use a door", { icon: "door-closed", attrs: html`data-act="door"` })}</div>`, { eyebrow: "Doors", title: "Haunted doors" });

    const rooms = card(html`
      <div class="step-actions">${[1, 2, 3].map((n) => button(levelName(n), { size: "sm", variant: s.level === n ? "primary" : "ghost", attrs: html`data-level="${n}"` }))}</div>
      <div class="step-actions">
        ${s.level < 3 ? button("Room", { size: "sm", icon: "dice", attrs: html`data-roll="${roomTableFor(s.level)}"` }) : button("Loft room", { size: "sm", icon: "dice", attrs: html`data-roll="${HOUSE.loft}"` })}
        ${s.level < 3 ? button("Small room (6 or fewer squares)", { size: "sm", icon: "dice", attrs: html`data-roll="${HOUSE.small}"` }) : ""}
      </div>
      ${s.level < 3
        ? html`<p class="muted sheet-hint">${levelName(s.level)} rooms explored: <strong>${s.rooms[s.level - 1]}</strong> ${button("", { icon: "plus", size: "sm", attrs: html`data-act="room+" aria-label="Room explored"` })} ${button("", { icon: "minus", size: "sm", attrs: html`data-act="room-" aria-label="Undo a room"` })}</p>`
        : html`<label class="field"><span><input type="checkbox" data-act="loft"${s.loftCleared ? " checked" : ""}> The loft is cleared (and every room below it)</span></label>`}
      ${s.loftCleared && !broken ? html`<p><strong>The house is cleared.</strong> The front door opens and you can leave.</p>` : ""}
      <div class="lair-note">${noteHtml(s.note, lockedNote, (t) => ctx.inline(t), "Roll a room, a door, a creature or a search table to see it here. Every roll is also kept in the Results panel.")}</div>`,
      { eyebrow: "The house", title: levelName(s.level) });

    const tables = card(html`
      <h4>Creatures</h4><div class="step-actions">${HOUSE.creatures.map((id) => button(titleOf(id), { size: "sm", icon: "skull", attrs: html`data-roll="${id}"` }))}</div>
      <h4>Search</h4><div class="step-actions">${HOUSE.search.map((id) => button(titleOf(id), { size: "sm", icon: "search", attrs: html`data-roll="${id}"` }))}</div>`,
      { eyebrow: "Tables", title: "Creatures and searching" });

    const banes = card(html`
      ${s.banes.length ? html`<ul class="haunted-banes">${s.banes.map((b, i) => html`<li><details><summary>${b.split(/(?<=\.)\s/)[0]}</summary>${ctx.inline(b)}</details> ${button("Use (+1 Fear)", { size: "sm", attrs: html`data-bane="${i}"` })}</li>`)}</ul>` : html`<p class="muted">No banes found yet. Each works once, gives 1 Fear when used, and has no power outside the house.</p>`}
      <div class="step-actions">${button("Found a bane: roll it", { size: "sm", icon: "wand-sparkles", attrs: html`data-act="bane"` })}</div>`,
      { eyebrow: "Fear Sheet", title: "Banes" });

    const rules = card(html`<details class="sheet-more"><summary>The Haunted House: its rules</summary>${prose(HOUSE.intro)}</details>
      <details class="sheet-more"><summary>Rooms and doors in the house</summary>${prose(HOUSE.rules)}</details>
      <div class="step-actions">${button("Start a new house", { icon: "rotate-ccw", size: "sm", variant: "ghost", attrs: html`data-act="new"` })}</div>`,
      { eyebrow: "Rules", title: "How the house works" });

    setHTML(root, html`${eyebrow("2D6 Dungeon · Lairs")}<h2 class="page-title">Haunted House</h2>
      ${who}${gate}${fear}${doors}${rooms}${tables}${banes}${rules}`);
  }

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.act === "loft") {
      s.loftCleared = el.checked;
      persist();
      draw();
    }
  });
  root.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-act],[data-roll],[data-fear],[data-level],[data-bane]");
    if (!b) return;
    if (b.dataset.roll) return void roll(b.dataset.roll);
    if (b.dataset.fear) addFear(+b.dataset.fear, b.dataset.fear === "1" ? "Fear gained" : "Fear lost");
    else if (b.dataset.level) s.level = Math.max(1, Math.min(3, +b.dataset.level));
    else if (b.dataset.bane) {
      const i = +b.dataset.bane;
      if (s.banes[i] !== undefined) {
        s.banes.splice(i, 1);
        addFear(1, "Used a bane");
      }
    } else
      switch (b.dataset.act) {
        case "noise": addFear(1, "A scream answers your noise"); break;
        case "room+": s.rooms[s.level - 1]++; break;
        case "room-": s.rooms[s.level - 1] = Math.max(0, s.rooms[s.level - 1] - 1); break;
        case "new": s = fresh(); lockedNote = null; break;
        case "door": {
          const d = await rollDice("D6");
          if (!live) return;
          if (doorIsHaunted(d.value)) return void roll(HOUSE.door);
          ctx.toast(`Door: rolled ${d.value}. It opens normally.`);
          break;
        }
        case "bane":
          return void roll(HOUSE.bane, (n) => {
            // the table has no name column: keep the whole entry (the list shows its first sentence)
            const text = n.rows[0]?.[1]?.trim();
            if (text) s.banes.push(text.slice(0, 2000));
          });
        case "enable": {
          const ch = loadChar();
          ch.expansions = { ...ch.expansions, lairs: true };
          saveChar(ch, "haunted");
          break;
        }
      }
    persist();
    draw();
  });
  ctx.onDispose(bus.on("character:changed", (p) => { if (p?.source !== "haunted" && live) draw(); }));

  draw();
}
