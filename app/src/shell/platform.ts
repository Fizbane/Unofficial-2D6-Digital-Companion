// Where the app is running: the desktop app (Electron, electron/preload.cjs adds window.desktop) or a web browser.
// Used for the few messages that name the place saves live ("this app" / "this browser").

export const isDesktop = (): boolean => typeof window !== "undefined" && "desktop" in window;

/** "this app" in the desktop app, "this browser" on the web. */
export const here = (): string => (isDesktop() ? "this app" : "this browser");
