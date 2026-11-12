// What a new visitor meets, one thing at a time: the tour of the site, then the backup set-up, then (in a locked
// 2D6 Void) the paid-game introduction. Each is shown once; the tour can be retaken from Settings.
import { needsBackupSetup } from "../shell/autobackup";
import { showBackupSetup } from "./backupui";
import { startTour, tourSeen } from "./tour";
import { maybeShowVoidIntro } from "./voidintro";

export function runFirstVisit(): void {
  const last = () => maybeShowVoidIntro();
  const backups = () => (needsBackupSetup() ? showBackupSetup(last) : last());
  if (tourSeen()) backups();
  else startTour({ after: backups, openBackups: () => showBackupSetup(last) });
}

/** The tour again, from Settings. */
export const retakeTour = (): void => startTour({ openBackups: () => showBackupSetup() });
