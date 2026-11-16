// Desktop updates from GitHub Releases (electron-updater). Nothing downloads until the player says so.
//   Installed app: check → "available" → download (on request) → "ready" → restart and install.
//   Portable .exe: electron-updater can't replace it, so "download" opens the release page instead.
//   Unpacked dev run (`npm run desktop`): no update feed, so checks say so.
// Statuses go to the page as { s: "checking" | "current" | "available" | "downloading" | "ready" | "error", ... },
// the same shape src/shell/updates.ts uses.
const { app, ipcMain, shell } = require("electron");

const OWNER = "Fizbane";
const REPO = "Unofficial-2D6-Digital-Companion"; // the public repo (this private one is exported there by scripts/export-public.mjs)
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** A plain-words reason for a failed check or download. */
function friendly(err) {
  const m = String((err && err.message) || err);
  if (/\b404\b/.test(m)) return "No release has been published yet.";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|net::/i.test(m))
    return "Couldn't reach GitHub. Check your internet connection and try again.";
  return "Couldn't check for updates. Try again later.";
}

function setupUpdates(getWindow, origin) {
  const how = !app.isPackaged ? "dev" : process.env.PORTABLE_EXECUTABLE_DIR ? "portable" : "installed";
  let last = null;
  const send = (s) => {
    last = s;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("updates:status", s);
  };

  let autoUpdater = null;
  if (how !== "dev") {
    ({ autoUpdater } = require("electron-updater"));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true; // a downloaded update also installs when the app is next closed
    autoUpdater.logger = null;
    let latest = "";
    autoUpdater.on("checking-for-update", () => send({ s: "checking" }));
    autoUpdater.on("update-available", (i) => send({ s: "available", latest: (latest = i.version) }));
    autoUpdater.on("update-not-available", () => send({ s: "current" }));
    autoUpdater.on("download-progress", (p) => send({ s: "downloading", latest, percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (i) => send({ s: "ready", latest: i.version }));
    autoUpdater.on("error", (e) => send({ s: "error", message: friendly(e) }));
  }

  // Only the app's own page may ask.
  const fromApp = (e) => {
    const url = (e.senderFrame && e.senderFrame.url) || "";
    return url === origin || url.startsWith(origin + "/");
  };
  const handle = (name, fn) =>
    ipcMain.handle(name, (e, ...args) => {
      if (!fromApp(e)) throw new Error("not allowed");
      return fn(...args);
    });

  handle("updates:info", () => ({ version: app.getVersion(), how, status: last }));
  handle("updates:check", async () => {
    if (!autoUpdater) return send({ s: "error", message: "Updates are checked by the installed app, not a development run." });
    await autoUpdater.checkForUpdates().catch((e) => send({ s: "error", message: friendly(e) }));
  });
  handle("updates:download", async () => {
    if (how === "portable" || !autoUpdater) return void shell.openExternal(RELEASES);
    await autoUpdater.downloadUpdate().catch((e) => send({ s: "error", message: friendly(e) }));
  });
  handle("updates:install", () => {
    if (autoUpdater && last && last.s === "ready") setImmediate(() => autoUpdater.quitAndInstall(true, true)); // silent install, then reopen the app
  });
}

module.exports = { setupUpdates };
