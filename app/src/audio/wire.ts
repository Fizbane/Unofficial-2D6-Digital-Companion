// Connects the app's events to sounds: dungeon checks, rooms, milestones and fight endings from the
// journal events, music from the fight's phase (not the screen), and soft clicks (none in the library contents)
// from the shell. Combat blows, dice and sheet moments call playSfx where they happen.
import { bus } from "../shell/events";
import { load } from "../tools/common";
import { PACK, doorSfx, type CombatPhase } from "./manifest";
import { initSound, playSfx, playSting, setMusic } from "./sound";

function combatPhase(): CombatPhase | null {
  return load<{ phase: CombatPhase | null }>(PACK.combatKey, { phase: null }).phase;
}
const syncMusic = () => setMusic(PACK.trackFor(combatPhase()));

let wired = false;
export function initAudio(): void {
  if (wired) return;
  wired = true;
  initSound();
  syncMusic();

  bus.on("combat:changed", syncMusic);
  bus.on("void:changed", syncMusic); // a Void fight started or ended, or the hulk level changed

  bus.on("journal:door", (ev) => playSfx(doorSfx(ev)));
  bus.on("journal:room", (ev) => {
    if (ev.phase === "start" && ev.kind !== "entrance") playSfx("room-new");
  });
  bus.on("journal:milestone", (ev) => {
    if (ev.kind === "descend") playSfx("descend");
    else if (ev.kind === "rest" && ev.ration) playSfx("eat");
  });
  bus.on("journal:fight", (ev) => {
    if (ev.phase === "end") playSting(ev.outcome === "won" ? "victory" : "defeat");
  });

  // A soft click for every button (quiet enough to sit under a dice or fight sound).
  document.addEventListener(
    "click",
    (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.("button, [role=tab], summary");
      if (!b || (b as HTMLButtonElement).disabled) return;
      if (b.closest(".tree")) return; // browsing the library contents stays silent
      if (b.closest(".tb-tab, [role=tab]")) return; // so does switching or closing a tab
      playSfx("click", { gap: 60 });
    },
    { capture: true },
  );
}
