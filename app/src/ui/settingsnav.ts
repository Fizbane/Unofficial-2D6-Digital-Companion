// Which Settings section is on show (settings.ts draws one section at a time beside its side menu).
// Kept for this visit only (sessionStorage, never in a backup); other code can open Settings on a section.
export const SECTION_KEY = "2d6-companion:settings-section";

/** Open Settings on section `id` the next time it draws, and switch an open Settings page to it now. */
export function settingsSection(id: string): void {
  try {
    sessionStorage.setItem(SECTION_KEY, id);
  } catch {
    /* no sessionStorage: Settings opens on its first section */
  }
  for (const b of document.querySelectorAll<HTMLElement>(`[data-set-nav="${id}"]`)) if (b.getAttribute("aria-current") !== "page") b.click();
}
