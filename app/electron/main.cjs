// Desktop wrapper: serves the built app (dist/) from a private app:// origin, so fetch, module workers,
// IndexedDB and localStorage behave as they do on a web server. Nothing is loaded from the network.
// The origin (app://2d6) must never change, or saved games on this machine would no longer be found.
const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { setupUpdates } = require("./updates.cjs");

const SCHEME = "app";
const HOST = "2d6";
const ORIGIN = `${SCHEME}://${HOST}`;
const DIST = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

/** Map an app:// request to a file inside dist/; anything that escapes dist/ is refused. */
function resolveFile(requestUrl) {
  const { host, pathname } = new URL(requestUrl);
  if (host !== HOST) return null;
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(DIST, rel);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return null;
  return file;
}

/** The main window (pop-outs such as the map window are its children). */
let mainWin = null;

function createWindow() {
  const win = (mainWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 500,
    backgroundColor: "#17140f",
    title: "2D6 Companion",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  }));
  win.on("closed", () => {
    mainWin = null;
    BrowserWindow.getAllWindows().forEach((w) => w.close()); // the map pop-out goes with it
  });
  guardWindow(win.webContents, true);
  win.loadURL(`${ORIGIN}/index.html`);
}

/**
 * Keep a window on app://. Links to other sites (the publisher links) open in the system browser. The main
 * window may open the app's own pop-outs (the live map window) as app windows; those may not open more.
 */
function guardWindow(wc, mayPopOut) {
  wc.on("will-navigate", (e, url) => {
    if (url.startsWith(ORIGIN + "/")) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (mayPopOut && url.startsWith(ORIGIN + "/"))
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#17140f", icon: path.join(__dirname, "icon.png") } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (mayPopOut) wc.on("did-create-window", (child) => guardWindow(child.webContents, false));
}

// One window only: a second launch focuses the first (two windows would fight over the same saves).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWin;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle(SCHEME, async (req) => {
      const file = resolveFile(req.url);
      if (!file) return new Response("Not found", { status: 404 });
      const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
      if (res && res.ok) return res;
      return new Response("Not found", { status: 404 });
    });
    setupUpdates(() => mainWin, ORIGIN);
    createWindow();
    app.on("activate", () => {
      if (!mainWin) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
