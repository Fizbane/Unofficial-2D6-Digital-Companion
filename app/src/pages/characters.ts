// Characters: every character of the current game, with Play, Export and Delete, plus New and
// Import. Each one keeps its own sheet, progress, journal, notes, rolls and open tabs (roster.ts).
import type { ToolContext } from "../main";
import { gameId, isVoid, switchCharacter } from "../games";
import { characterFile, createCharacter, deleteCharacter, importCharacterFile, listCharacters, validateCharacterFile, type CharacterSummary } from "../roster";
import { button } from "../ui/components";
import { icon } from "../ui/icon";
import { html, setHTML, type Raw } from "../ui/html";
import { stageReloadToast } from "../shell/reloadtoast";
import { ValidationError } from "../lock/validate";

const WORD = () => (isVoid() ? { one: "survivor", One: "Survivor", unnamed: "Unnamed survivor" } : { one: "character", One: "Character", unnamed: "Unnamed adventurer" });

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

function line(c: CharacterSummary, dungeonLevel: (xp: number) => number): string {
  const level = c.level ?? (isVoid() ? null : dungeonLevel(c.xp));
  const parts = [
    c.profession,
    c.cls === "constable" ? "Constable" : "",
    level ? `Level ${level}` : "",
    c.hp !== null ? `${c.hp} HP` : "",
    c.delve ? `${isVoid() ? "Hulk" : "Dungeon"} L${c.delve.level} · ${c.delve.rooms} room${c.delve.rooms === 1 ? "" : "s"}` : "",
    c.journal ? `${c.journal} journal entr${c.journal === 1 ? "y" : "ies"}` : "",
  ];
  return parts.filter(Boolean).join(" · ") || "Not started yet";
}

function cardFor(c: CharacterSummary, dungeonLevel: (xp: number) => number): Raw {
  const w = WORD();
  const pic = c.portrait ? html`<img src="${c.portrait}" alt="" width="64" height="64">` : icon("user", { size: 30 });
  return html`<section class="card char-card${c.active ? " is-active" : ""}" data-char="${c.id}">
    <div class="char-card-pic">${pic}</div>
    <div class="char-card-body">
      <h2 class="char-card-name">${c.name || w.unnamed}${c.active ? html` <span class="char-card-badge">Playing</span>` : ""}</h2>
      <p class="char-card-line">${line(c, dungeonLevel)}</p>
      <p class="char-card-when muted">Last played ${when(c.lastPlayed)}</p>
      <div class="char-card-actions">
        ${c.active ? button("Open sheet", { icon: "scroll", variant: "primary", size: "sm", attrs: html`data-act="sheet"` }) : button("Play", { icon: "play", variant: "primary", size: "sm", attrs: html`data-act="play"` })}
        ${button("Export", { icon: "download", variant: "ghost", size: "sm", attrs: html`data-act="export"` })}
        ${c.active ? "" : button("Delete", { icon: "trash", variant: "ghost", size: "sm", attrs: html`data-act="delete" aria-label="Delete ${c.name || w.unnamed}"` })}
      </div>
    </div>
  </section>`;
}

export async function render(root: HTMLElement, ctx: ToolContext) {
  root.classList.add("play-page", "characters-page");
  const levelOf: (xp: number, cls?: "constable") => number = isVoid() ? () => 0 : (await import("../tools/sheet")).levelOf;
  const sheetRoute = isVoid() ? "#/play/vsheet" : "#/play/sheet";

  const draw = () => {
    const w = WORD();
    const list = listCharacters();
    setHTML(root, html`
      <header class="play-head">
        <div class="play-title"><h1>${icon("user", { size: 26 })}<span>${w.One}s</span></h1></div>
        <div class="play-actions">
          ${button(`New ${w.one}`, { icon: "plus", variant: "primary", attrs: html`data-act="new"` })}
          ${button("Import", { icon: "upload", variant: "ghost", attrs: html`data-act="import"` })}
        </div>
        <p class="muted">Each ${w.one} keeps their own sheet, ${isVoid() ? "hulk" : "dungeon and realm"} progress, journal, notes, rolls and open tabs. Pick one to play; the others wait here unchanged.</p>
      </header>
      <div class="roster-list">${list.map((c) => cardFor(c, (xp) => levelOf(xp, c.cls)))}</div>`);
  };

  const download = (id: string, name: string) => {
    const blob = new Blob([JSON.stringify(characterFile(id), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${gameId() === "void" ? "void-survivor" : "character"}-${(name || "unnamed").replace(/[^\w-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const file = validateCharacterFile(JSON.parse(await f.text()));
        if (file.game !== gameId()) return void alert(`That file is a ${file.game === "void" ? "2D6 Void survivor" : "2D6 Dungeon character"}. Switch to that game first, then import it.`);
        if (!importCharacterFile(file)) return void alert("Couldn't import: this device's storage is full.");
        ctx.toast(`${WORD().One} imported. Press Play to switch to them.`);
        draw();
      } catch (e) {
        alert(e instanceof ValidationError ? `That file isn't a 2D6 Companion ${WORD().one} (problem at "${e.path}").` : `That file isn't a 2D6 Companion ${WORD().one}.`);
      }
    };
    input.click();
  };

  root.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.closest<HTMLElement>("[data-char]")?.dataset.char;
    const c = id ? listCharacters().find((x) => x.id === id) : undefined;
    const name = c?.name || WORD().unnamed;
    if (act === "new") {
      if (isVoid()) {
        if (!createCharacter({}, undefined, (nid) => switchCharacter(nid, sheetRoute))) ctx.toast("Couldn't make a new survivor: this device's storage is full.");
      } else {
        const { startNewAdventurer } = await import("../tools/sheet");
        if (!(await startNewAdventurer(ctx.byId))) ctx.toast("Couldn't make a new character: this device's storage is full.");
      }
    } else if (act === "import") importFile();
    else if (act === "sheet") ctx.openTab(sheetRoute);
    else if (act === "play" && c) {
      stageReloadToast(`Now playing ${name}.`);
      switchCharacter(c.id);
    } else if (act === "export" && c) download(c.id, c.name);
    else if (act === "delete" && c) {
      if (!confirm(`Delete ${name} and everything saved with them (sheet, progress, journal, notes)? This can't be undone. Export them first to keep a copy.`)) return;
      if (deleteCharacter(c.id)) ctx.toast(`${name} deleted.`);
      draw();
    }
  });

  draw();
}

