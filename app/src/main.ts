// Bootstrap: load the content gateway and the library on it (which indexes the tables), then build
// the shell (or the bare map window).
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/crimson-pro/400.css";
import "@fontsource/crimson-pro/400-italic.css";
import "@fontsource/crimson-pro/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/book.css";
import "./styles/tools.css";
import "./styles/dungeon.css";
import "./styles/combat.css";
import "./styles/sheet.css";
import "./styles/vsheet.css";
import "./styles/vcombat.css";
import "./styles/realm.css";
import "./styles/settings.css";
import "./styles/void.css";
import { loadLibrary } from "./library";
import { html, setHTML, type Raw } from "./ui/html";
import { applyDisplay } from "./settings";
import { preload as preloadDice } from "./dice3d";
import { bareContext, buildShell } from "./shell/shell";
import { initAudio } from "./audio/wire";
import { isVoid, markDocument, switchGame } from "./games";
import { runFirstVisit } from "./ui/firstrun";
import { startAutoBackup } from "./shell/autobackup";
import { startUpdateCheck } from "./ui/updateui";

export type { ToolContext } from "./shell/shell";

markDocument();
const app = document.getElementById("app")!;
const isMapWindow = /^#\/play\/mapwindow/.test(location.hash);
applyDisplay();

loadLibrary()
  .then(async () => {
    if (isMapWindow) {
      const { render } = await import("./tools/mapwindow");
      render(app, bareContext());
      return;
    }
    preloadDice();
    buildShell(app);
    initAudio();
    startAutoBackup();
    startUpdateCheck();
    runFirstVisit();
  })
  .catch((err) => {
    setHTML(app, html`<div class="boot-error"><h1>Couldn't load the library</h1><p>Run <code>.venv\\Scripts\\python pipeline\\build.py</code> first.</p>${switchBack()}<pre>${String(err)}</pre></div>`);
    document.getElementById("boot-dungeon")?.addEventListener("click", () => switchGame("dungeon"));
  });

// The desktop app (Electron) serves files locally, so it needs no offline cache.
if ("serviceWorker" in navigator && import.meta.env.PROD && !navigator.userAgent.includes("Electron")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/** On a boot error in Void, offer a way back to Dungeon (wired once the markup is in the page). */
function switchBack(): Raw | "" {
  if (!isVoid()) return "";
  return html`<p><button type="button" id="boot-dungeon" class="btn">Back to 2D6 Dungeon</button></p>`;
}
