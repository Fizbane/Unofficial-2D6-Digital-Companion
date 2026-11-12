// The one bridge between the page and the desktop wrapper: update checks. The page gets these calls and
// nothing else (no Node, no file system).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  updates: {
    /** { version, how: "installed" | "portable" | "dev" } */
    info: () => ipcRenderer.invoke("updates:info"),
    check: () => ipcRenderer.invoke("updates:check"),
    /** Installed app: download the update. Portable: open the download page. */
    download: () => ipcRenderer.invoke("updates:download"),
    /** Close the app and run the downloaded installer. */
    install: () => ipcRenderer.invoke("updates:install"),
    /** The latest status pushed by the wrapper; returns an "unsubscribe". */
    onStatus: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on("updates:status", h);
      return () => ipcRenderer.removeListener("updates:status", h);
    },
  },
});
