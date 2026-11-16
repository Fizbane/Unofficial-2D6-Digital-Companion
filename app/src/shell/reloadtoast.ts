// A message shown once after the next page load (shell.ts takes it at boot). Light, with no DOM
// imports, so the play tools can stage one before a character switch reloads the page.
export const RELOAD_TOAST = "2d6-companion:reload-toast"; // sessionStorage: not part of a backup

/** Show `msg` after the next page load (for a reload something else starts, e.g. a character switch). */
export function stageReloadToast(msg: string) {
  try {
    sessionStorage.setItem(RELOAD_TOAST, msg);
  } catch {
    /* no sessionStorage: reload without the message */
  }
}
