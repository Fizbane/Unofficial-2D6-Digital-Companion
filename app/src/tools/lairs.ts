// The Lairs play tool: pick a lair, step its rooms (size, room table, incident), track the lair's own
// counters (flooded rooms, fires, retreats) and find the level variant of a creature. The book's rules and
// tables are read from the owner's imported Lairs book (docs/spec-lairs.md); only section ids live in code.
import type { ToolContext } from "../main";
import { getContent, type Locked } from "../content";
import { bus } from "../shell/events";
import { noteHtml as noteMarkup, rollNote, type Note } from "./rollnote";
import { load, save } from "./common";
import { button, card, eyebrow } from "../ui/components";
import { html, type Raw, setHTML } from "../ui/html";
import { hasExpansion, loadChar, saveChar, stats } from "./sheet";
import { askText } from "../ui/ask";
import { closestVariant, groupVariants, intimidation, lairById, LAIRS, type LairDef, type LairId } from "./lairsmodel";
import { addLairRoom, addSecretExit, exitsForRoll, exploredFraction, LAIR_MAPS, lairRooms, newLairMap } from "./lairmap";
import { mapHint, openExits, renderMap, type DungeonMap } from "./dmap";
import { rollDice } from "../dice3d";

interface State {
  lair: string;
  rooms: number;
  flooded: number; // flooded rooms in a row (Swamp)
  fires: number; // fires lit (Swamp)
  soaked: boolean;
  retreats: Record<string, number>; // by creature name (Vol 2)
  note: Note | null;
  maps: (DungeonMap | null)[]; // one per level, made when the level is first opened
  mapLevel: number; // 1-based
}
const fresh = (): State => ({ lair: "", rooms: 0, flooded: 0, fires: 0, soaked: false, retreats: {}, note: null, maps: [], mapLevel: 1 });

export function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "lairs-page");
  let s: State = load<State>("lairs", fresh());
  let lockedNote: Locked | null = null; // a table whose book is still locked (not saved)
  let live = true;
  ctx.onDispose(() => (live = false));
  const persist = () => {
    if (live) save("lairs", s);
  };
  if (!Array.isArray(s.maps)) s.maps = [];
  if (!(s.mapLevel >= 1)) s.mapLevel = 1;
  const size = { w: 4, h: 4, exits: 1 }; // the next room's form, kept as typed across redraws (not saved)
  const titleOf = (id: string) => ctx.byId.get(id)?.title?.trim() || id;
  /** The current level's map, made on first use. */
  const mapOf = (l: LairDef): DungeonMap => {
    const spec = LAIR_MAPS[l.id as LairId];
    s.mapLevel = Math.max(1, Math.min(spec.levels, s.mapLevel));
    return (s.maps[s.mapLevel - 1] ??= newLairMap(spec, s.mapLevel));
  };
  function mapHtml(l: LairDef): Raw {
    const spec = LAIR_MAPS[l.id as LairId];
    const m = mapOf(l);
    const pct = Math.round(exploredFraction(m) * 100);
    const rooms = lairRooms(m);
    const stuck = rooms.length > 0 && openExits(m).length === 0;
    const num = (k: "w" | "h" | "exits", label: string, max: number) =>
      html`<label class="field">${label}<input type="number" data-size="${k}" min="${k === "exits" ? 0 : 1}" max="${max}" value="${size[k]}"></label>`;
    return html`
      ${spec.levels > 1 ? html`<div class="step-actions">${Array.from({ length: spec.levels }, (_, i) => button(`Level ${i + 1}`, { size: "sm", variant: s.mapLevel === i + 1 ? "primary" : "ghost", attrs: html`data-maplevel="${i + 1}"` }))}</div>` : ""}
      <div class="map-wrap dmap">${renderMap(m, rooms.length ? rooms[rooms.length - 1].id : null, null, undefined, "top", { label: "Lair map" })}</div>
      <p class="muted sheet-hint">${rooms.length ? mapHint(m, false) : "Draw the first room: it goes in from the entrance at the bottom."}</p>
      <p class="muted sheet-hint">${spec.size}×${spec.size} squares · ${rooms.length} room${rooms.length === 1 ? "" : "s"} · <strong>${pct}%</strong> explored</p>
      <div class="grid">${num("w", "Width", spec.size)}${num("h", "Height", spec.size)}${num("exits", "Exits", 3)}</div>
      <div class="step-actions">
        ${button("Draw the room", { icon: "plus", variant: "primary", attrs: html`data-act="map-room"` })}
        ${button("Roll exits (D6)", { icon: "dice", size: "sm", attrs: html`data-act="map-exits"` })}
        ${button("Undo last room", { icon: "rotate-ccw", size: "sm", variant: "ghost", attrs: html`data-act="map-undo"${rooms.length > (s.mapLevel === 1 && spec.entrance ? 1 : 0) ? "" : " disabled"}` })}
      </div>
      ${stuck && pct < 80 ? html`<p class="warn">Every exit is used and less than 80% is explored: the dead-end rule gives you a secret exit.</p><div class="step-actions">${button("Add a secret exit", { icon: "key-round", attrs: html`data-act="map-secret"` })}</div>` : ""}`;
  }
  const lair = (): LairDef | undefined => lairById(s.lair);
  const variants = groupVariants(ctx.lib.sections);

  /** Roll a table by section id: the card shows it, the results panel logs it. */
  async function roll(id: string) {
    const r = await rollNote(id, "Lairs");
    if (!live) return;
    if (!r) return ctx.toast("That table isn't in your imported book.");
    if ("locked" in r) lockedNote = r.locked;
    else ((lockedNote = null), (s.note = r), persist());
    draw();
  }

  /** The lair's introduction sections as paragraphs (tables skipped); the book's own words. */
  function rulesHtml(l: LairDef): Raw {
    const part = (id: string) => {
      const c = getContent(id);
      if (!c?.ok) return html``;
      return html`${c.section.blocks.map((b) => (b.type === "para" ? html`<p>${ctx.inline(b.text)}</p>` : b.type === "heading" ? html`<h4>${b.text}</h4>` : ""))}`;
    };
    return html`<details class="sheet-more"><summary>${titleOf(l.intro)}: its rules</summary>${part(l.intro)}</details>
      <details class="sheet-more"><summary>Rules for every lair in this volume</summary>${part(l.shared)}</details>`;
  }

  const noteHtml = (n: Note | null): Raw =>
    noteMarkup(n, lockedNote, (t) => ctx.inline(t), "Roll a room or an incident to see it here. Every roll is also kept in the Results panel.");

  function creatureHtml(): Raw {
    const c = loadChar();
    const st = stats(c);
    const frac = st.baseline > 0 ? c.hp / st.baseline : 1;
    const names = [...variants.keys()];
    if (!names.length) return html`<p class="muted">No creature cards were found in your Lairs book.</p>`;
    return html`<label class="field">Creature<select data-pick="creature"><option value="">Choose…</option>${names.map((n) => html`<option value="${n}">${n}</option>`)}</select></label>
      <p class="muted sheet-hint">You are level ${st.level} with ${c.hp} of ${st.baseline} HP.</p>
      <div data-slot="creature"></div>`;
  }
  const showCreature = (name: string) => {
    const slot = root.querySelector<HTMLElement>('[data-slot="creature"]');
    if (!slot) return;
    const c = loadChar();
    const st = stats(c);
    const v = closestVariant(variants.get(name) ?? [], st.level, st.baseline > 0 ? c.hp / st.baseline : 1);
    setHTML(slot, v
      ? html`<div class="step-actions">${button("Fight it in Combat", { icon: "swords", variant: "primary", attrs: html`data-fight="${v.id}"` })}</div><p>Fight <a href="#/s/${v.id}">${v.title}</a>, the closest to your level. ${(variants.get(name) ?? []).length > 1 ? `It also comes as level ${(variants.get(name) ?? []).map((x) => x.level).join(", ")}.` : "It has no other levels."}</p>`
      : html``);
  };

  function draw() {
    const l = lair();
    const c = loadChar();
    const enabled = hasExpansion(c, "lairs");
    const picker = html`<div class="step-actions">${LAIRS.map((d) => button(titleOf(d.intro), { size: "sm", variant: d.id === s.lair ? "primary" : "ghost", attrs: html`data-lair="${d.id}"` }))}</div>`;
    const gate = enabled ? "" : card(html`<p>This character doesn't play with the Lairs expansion, so its rules (such as no XP from creatures below your level) are off.</p>
      <div class="step-actions">${button("Enable Lairs for this character", { icon: "check", variant: "primary", attrs: html`data-act="enable"` })}</div>`, { eyebrow: "Character", title: "Lairs not enabled" });
    const rooms = l ? card(html`
        <div class="step-actions">
          ${button("Small room (6 or fewer squares)", { size: "sm", icon: "dice", attrs: html`data-room="small"` })}
          ${button("Normal room", { size: "sm", icon: "dice", attrs: html`data-room="rooms"` })}
          ${button("Large room (32 or more)", { size: "sm", icon: "dice", attrs: html`data-room="large"` })}
          ${button("Incident", { size: "sm", icon: "sparkles", attrs: html`data-room="incidents"` })}
        </div>
        <p class="muted sheet-hint">Rooms explored: <strong>${s.rooms}</strong> ${button("", { icon: "plus", size: "sm", attrs: html`data-act="room+" aria-label="Room explored"` })} ${button("", { icon: "minus", size: "sm", attrs: html`data-act="room-" aria-label="Undo a room"` })}</p>
        ${l.finalCreature ? html`<div class="step-actions">${button("Final room: creature", { size: "sm", icon: "skull", attrs: html`data-roll="${l.finalCreature}"` })}${l.finalTreasure ? button("Final room: treasure", { size: "sm", icon: "gem", attrs: html`data-roll="${l.finalTreasure}"` }) : ""}</div>` : ""}
        ${l.flooded ? floodHtml(l) : ""}
        <div class="lair-note">${noteHtml(s.note)}</div>`, { eyebrow: "Rooms", title: "Explore" }) : "";
    const retreats = l && l.vol === 2 ? card(html`<p class="muted sheet-hint">Retreating from a fight means leaving the lair; the creature stays put and heals. Each return makes it hit harder.</p>
        ${Object.entries(s.retreats).map(([n, k]) => html`<p>${n}: <strong>+${intimidation(k)} damage</strong> (retreated ${k}) ${button("", { icon: "plus", size: "sm", attrs: html`data-ret="${n}" data-d="1" aria-label="Retreated again"` })} ${button("", { icon: "minus", size: "sm", attrs: html`data-ret="${n}" data-d="-1" aria-label="Undo"` })}</p>`)}
        <div class="step-actions">${button("I retreated from a creature", { size: "sm", icon: "arrow-left-right", attrs: html`data-act="retreat"` })}</div>`, { eyebrow: "Volume 2", title: "Retreats" }) : l ? card(html`<p class="muted">In this volume you may retreat at any point, but you can never re-enter this lair. Start a new one.</p>`, { eyebrow: "Volume 1", title: "Retreating" }) : "";
    setHTML(root, html`
      ${eyebrow("2D6 Dungeon · Lairs")}<h2 class="page-title">Lairs</h2>
      ${card(html`${picker}${l ? rulesHtml(l) : html`<p class="muted">Choose a lair to begin.</p>`}
        <div class="step-actions">${button("Start a new lair", { icon: "rotate-ccw", size: "sm", variant: "ghost", attrs: html`data-act="new"` })}</div>`, { eyebrow: "Lair", title: l ? titleOf(l.intro) : "Choose a lair" })}
      ${gate}${rooms}${l ? card(mapHtml(l), { eyebrow: "Map", title: LAIR_MAPS[l.id as LairId].levels > 1 ? `Level ${s.mapLevel}` : "Lair map" }) : ""}${retreats}
      ${card(creatureHtml(), { eyebrow: "Level variants", title: "Which creature do I fight?" })}`);
  }

  function floodHtml(l: LairDef): Raw {
    return html`<div class="sheet-more"><p class="muted sheet-hint">Flooded rooms in a row: <strong>${s.flooded}</strong> · Fires lit: <strong>${s.fires}</strong> of 2 · ${s.soaked ? "Soaked" : "Dry"}</p>
      <div class="step-actions">
        ${button("Flooded room", { size: "sm", icon: "droplet", attrs: html`data-act="flood"` })}
        ${button("Dry room", { size: "sm", attrs: html`data-act="dry"` })}
        ${button("Light a fire", { size: "sm", icon: "zap", attrs: html`data-act="fire"` })}
        ${l.soakedTable ? button("Roll Soaked table", { size: "sm", icon: "dice", attrs: html`data-roll="${l.soakedTable}"` }) : ""}
      </div>
      ${s.flooded >= 2 ? html`<p class="warn">Two flooded rooms in a row: roll the Soaked table (small rooms do not count).</p>` : ""}</div>`;
  }

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.pick === "creature") showCreature(el.value);
    const k = el.dataset.size as "w" | "h" | "exits" | undefined;
    if (k) size[k] = Math.max(k === "exits" ? 0 : 1, Math.min(+(el as unknown as HTMLInputElement).max || 30, Math.floor(+el.value) || 0));
  });
  root.addEventListener("click", async (e) => {
    // the map: tapping an exit chooses where the next room goes
    const ex = (e.target as Element).closest?.("[data-exit]");
    const l0 = lair();
    if (ex && l0) {
      const m = mapOf(l0), id = +ex.getAttribute("data-exit")!;
      m.sel = m.sel === id ? null : id;
      persist();
      return draw();
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-lair],button[data-room],[data-roll],[data-act],[data-ret],[data-fight],[data-maplevel]");
    if (!b) return;
    if (b.dataset.maplevel) {
      s.mapLevel = +b.dataset.maplevel;
      persist();
      return draw();
    }
    if (b.dataset.fight) {
      const { queueFoe } = await import("./combat");
      const err = queueFoe(ctx.byId.get(b.dataset.fight), "#/play/lairs");
      if (err) return ctx.toast(err);
      return ctx.openTab("#/play/combat");
    }
    const l = lair();
    if (b.dataset.lair) {
      s = { ...fresh(), lair: b.dataset.lair };
      lockedNote = null;
    } else if (b.dataset.room && l) return void roll(l[b.dataset.room as "rooms" | "large" | "small" | "incidents"]);
    else if (b.dataset.roll) return void roll(b.dataset.roll);
    else if (b.dataset.ret) s.retreats[b.dataset.ret] = Math.max(0, (s.retreats[b.dataset.ret] ?? 0) + +b.dataset.d!);
    else
      switch (b.dataset.act) {
        case "new": s = fresh(); lockedNote = null; break;
        case "map-exits": {
          const d = await rollDice("D6");
          if (!live) return;
          size.exits = exitsForRoll(d.value);
          ctx.toast(`Exits: rolled ${d.value}, so ${size.exits}.`);
          break;
        }
        case "map-room": {
          if (!l) break;
          const m = mapOf(l);
          const before = lairRooms(m).length;
          const r = addLairRoom(m, size.w, size.h, size.exits, `Room ${before + 1}`);
          if (!r) ctx.toast(before && !openExits(m).length ? "There is no open exit to go through." : "No room fits there: that exit is blocked. Pick another exit.");
          else {
            s.rooms++;
            if (r.w !== size.w || r.h !== size.h) ctx.toast(`Only ${r.w}×${r.h} fits there, so it is drawn that size.`);
          }
          break;
        }
        case "map-undo": {
          if (!l) break;
          const m = mapOf(l);
          const last = lairRooms(m).pop();
          if (!last) break;
          m.rooms = m.rooms.filter((r) => r.id !== last.id);
          m.exits = m.exits.filter((x) => x.room !== last.id);
          for (const x of m.exits) if (x.to === last.id) delete x.to;
          if (!lairRooms(m).length) m.entrance = null;
          s.rooms = Math.max(0, s.rooms - 1);
          break;
        }
        case "map-secret":
          if (l && !addSecretExit(mapOf(l))) ctx.toast("No wall has room for another exit.");
          break;
        case "room+": s.rooms++; break;
        case "room-": s.rooms = Math.max(0, s.rooms - 1); break;
        case "flood": s.flooded++; s.soaked = true; break;
        case "dry": s.flooded = 0; break;
        case "fire":
          if (!s.soaked) ctx.toast("You are not soaked.");
          else if (s.fires >= 2) ctx.toast("You have no fuel left for another fire.");
          else (s.fires++, (s.soaked = false), (s.flooded = 0));
          break;
        case "retreat": {
          const name = (await askText("Which creature did you retreat from?", ""))?.trim();
          if (name) s.retreats[name] = (s.retreats[name] ?? 0) + 1;
          break;
        }
        case "enable": {
          const ch = loadChar();
          ch.expansions = { ...ch.expansions, lairs: true };
          saveChar(ch, "lairs");
          break;
        }
      }
    persist();
    draw();
  });
  const off = bus.on("character:changed", (p) => { if (p?.source !== "lairs" && live) draw(); });
  ctx.onDispose(off);

  draw();
}
