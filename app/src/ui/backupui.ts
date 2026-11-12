// The backup screens: the first-run "where should backups go?" prompt, and the Backups card in Settings.
import {
  BACKUP_INTERVAL_MS, BACKUP_KEEP, backupNow, backupStatus, browserCopies, chooseBackupFolder, markBackupAsked, onBackupStatus,
  reconnectFolder, turnBackupsOff, useBrowserBackups, type BackupStatus,
} from "../shell/autobackup";
import { button } from "./components";
import { html, setHTML, type Raw } from "./html";
import { openModal, type Modal } from "./modal";
import { here, isDesktop } from "../shell/platform";

/** "just now", "5 minutes ago", "yesterday at 14:30": plain words for a time. */
export function ago(t: number, now = Date.now()): string {
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minute${Math.round(s / 60) === 1 ? "" : "s"} ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleString();
}

const MINUTES = BACKUP_INTERVAL_MS / 60000;

/** What a backup holds, in the player's words. */
export const BACKUP_COVERS = "characters, realm and dungeon progress, notes, bookmarks, the journal, achievements, your content fixes and your settings, for both games";

/** The folder suggestions shown wherever a folder is asked for. */
export function folderTips(): Raw {
  return html`<p>Pick a folder inside <strong>OneDrive</strong>, <strong>Google Drive</strong> or <strong>iCloud Drive</strong> and your backups are copied to the cloud for you, so they survive losing this computer.</p>`;
}

function setupBody(s: BackupStatus): Raw {
  return html`<p class="eyebrow">Keep your game safe</p>
    <h2 id="backup-setup-title">Set up automatic backups</h2>
    <p>Everything you save here lives in ${here()}. If it is cleared, or you change computer, it is gone. Backups copy it to a folder of your choice every ${MINUTES} minutes while the app is open, and keep the newest ${BACKUP_KEEP}.</p>
    ${folderTips()}
    <p class="muted">A backup holds your ${BACKUP_COVERS}. It never holds the book itself: you open your PDF again on a new device.</p>
    ${s.pickerSupported
      ? html`<div class="step-actions">${button("Choose a backup folder…", { icon: "download", variant: "primary", attrs: html`data-backup-choose data-autofocus` })}
          ${button(`Keep backups in ${here()}`, { icon: "shield", variant: "ghost", attrs: html`data-backup-browser` })}
          ${button("Not now", { variant: "ghost", attrs: html`data-backup-skip` })}</div>`
      : html`<p class="muted">This browser can't save to a folder on its own (Chrome and Edge can). Backups will be kept inside the browser, and you can download a file from Settings at any time.</p>
          <div class="step-actions">${button(`Keep backups in ${here()}`, { icon: "shield", variant: "primary", attrs: html`data-backup-browser data-autofocus` })}
          ${button("Not now", { variant: "ghost", attrs: html`data-backup-skip` })}</div>`}
    ${s.error ? html`<p class="warn" role="alert">${s.error}</p>` : ""}`;
}

let open: Modal | null = null;

/** The first-run prompt. `done` runs when it closes, whatever the answer. */
export function showBackupSetup(done?: () => void): void {
  if (open) return;
  const m = (open = openModal({
    body: setupBody(backupStatus()),
    labelledBy: "backup-setup-title",
    onClose: () => {
      open = null;
      markBackupAsked();
      done?.();
    },
  }));
  m.card.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-backup-choose]")) {
      if (await chooseBackupFolder()) m.close();
      else m.update(setupBody(backupStatus()));
    } else if (t.closest("[data-backup-browser]")) {
      useBrowserBackups();
      m.close();
    } else if (t.closest("[data-backup-skip]")) m.close();
  });
}

// ---------------------------------------------------------------------------------------------- Settings card

function cardBody(s: BackupStatus, copies: number): Raw {
  const where = s.mode === "folder" ? html`<strong>${s.folderName || "your folder"}</strong>` : s.mode === "browser" ? html`<strong>${here()}</strong>` : "";
  return html`${s.mode === "off"
      ? html`<p class="muted set-note">Automatic backups are off. Your saves live only in ${here()} until you turn them on.</p>`
      : html`<p class="set-note">Backing up every ${MINUTES} minutes to ${where}, keeping the newest ${BACKUP_KEEP}. Last backup: <strong>${ago(s.last)}</strong>${s.mode === "browser" ? html` (${copies} kept)` : ""}.</p>`}
    ${s.needsPermission ? html`<p class="warn" role="alert">${isDesktop() ? "The app" : "The browser"} needs your OK to use the backup folder again after a restart. ${button("Reconnect", { variant: "primary", size: "sm", attrs: html`data-backup-act="reconnect"` })}</p>` : ""}
    ${s.error ? html`<p class="warn" role="alert">${s.error}</p>` : ""}
    <p class="muted set-note">Backups hold your ${BACKUP_COVERS}. Not the book PDFs.</p>
    ${s.mode === "off" || s.mode === "browser" ? folderTips() : ""}
    <div class="step-actions">
      ${s.pickerSupported ? button(s.mode === "folder" ? "Change folder…" : "Choose a backup folder…", { icon: "download", variant: s.mode === "off" ? "primary" : "ghost", attrs: html`data-backup-act="choose"` }) : ""}
      ${s.mode !== "off" ? button("Back up now", { icon: "rotate-ccw", attrs: html`data-backup-act="now"` }) : ""}
      ${s.mode === "off" ? button(`Keep backups in ${here()}`, { icon: "shield", variant: "ghost", attrs: html`data-backup-act="browser"` }) : ""}
      ${s.mode !== "off" ? button("Turn off", { variant: "ghost", attrs: html`data-backup-act="off"` }) : ""}
    </div>`;
}

/** Fills the Backups card's host and keeps it current. Returns a stop function. */
export function renderBackupCard(host: HTMLElement): () => void {
  let note = "";
  const draw = async () => {
    const s = backupStatus();
    const copies = s.mode === "browser" ? (await browserCopies()).length : 0;
    setHTML(host, html`${cardBody(s, copies)}${note ? html`<p class="muted" role="status">${note}</p>` : ""}`);
  };
  const click = async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-backup-act]");
    if (!b) return;
    switch (b.dataset.backupAct) {
      case "choose": await chooseBackupFolder(); note = ""; break;
      case "browser": useBrowserBackups(); break;
      case "now": { const r = await backupNow(true); note = r.ok ? "Backed up." : r.error ?? ""; break; }
      case "off": turnBackupsOff(); break;
      case "reconnect": await reconnectFolder(); break;
    }
    void draw();
  };
  host.addEventListener("click", click);
  const off = onBackupStatus(() => void draw());
  void draw();
  return () => {
    host.removeEventListener("click", click);
    off();
  };
}
